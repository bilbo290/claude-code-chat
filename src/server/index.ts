import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import path from "path";

const CLAUDE_CWD = process.env.CLAUDE_CWD || process.cwd();
const DIST_DIR = path.join(import.meta.dir, "../../dist");

// Track running processes for abort functionality
const runningProcesses = new Map<string, { proc: ReturnType<typeof Bun.spawn>; aborted: boolean }>();

// Permission request handling
interface PermissionRequest {
  id: string;
  sessionId: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  timestamp: number;
  resolve: (decision: PermissionDecision) => void;
}

interface PermissionDecision {
  hookSpecificOutput: {
    hookEventName: "PermissionRequest";
    decision: {
      behavior: "allow" | "deny";
      message?: string;
    };
  };
}

const pendingPermissions = new Map<string, PermissionRequest>();

interface StreamMessage {
  type: string;
  message?: {
    content?: Array<{
      type: string;
      text?: string;
      thinking?: string;
    }>;
  };
  result?: string;
}

function parseStreamOutput(output: string): { thinking: string[]; response: string } {
  const lines = output.trim().split("\n");
  const thinking: string[] = [];
  let response = "";

  for (const line of lines) {
    try {
      const parsed: StreamMessage = JSON.parse(line);

      if (parsed.type === "assistant" && parsed.message?.content) {
        for (const block of parsed.message.content) {
          if (block.type === "thinking" && block.thinking) {
            thinking.push(block.thinking);
          }
          if (block.type === "text" && block.text) {
            response += block.text;
          }
        }
      }

      if (parsed.type === "result" && parsed.result) {
        if (!response) {
          response = parsed.result;
        }
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return { thinking, response };
}

const app = new Elysia()
  .use(cors())
  .post(
    "/api/chat",
    async ({ body }) => {
      const { message, sessionId, requestId, permissionMode } = body;

      try {
        const args = [
          "-p",
          message,
          "--permission-mode",
          permissionMode || "default",
          "--output-format",
          "stream-json",
          "--verbose",
        ];

        if (sessionId) {
          args.push("--resume", sessionId);
        }
        // No flag = new session (don't use --continue as it resumes the last session)

        const proc = Bun.spawn(["claude", ...args], {
          cwd: CLAUDE_CWD,
          stdout: "pipe",
          stderr: "pipe",
        });

        // Track process for potential abort
        const processEntry = { proc, aborted: false };
        if (requestId) {
          runningProcesses.set(requestId, processEntry);
        }

        const output = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();

        await proc.exited;

        // Clean up tracking
        if (requestId) {
          runningProcesses.delete(requestId);
        }

        // Check if aborted
        if (processEntry.aborted) {
          return {
            success: false,
            aborted: true,
            error: "Request aborted",
          };
        }

        if (proc.exitCode !== 0) {
          console.error("Claude failed with exit code:", proc.exitCode);
          console.error("stderr:", stderr);
          console.error("stdout:", output);
          return {
            success: false,
            error: stderr || output || `Claude command failed with exit code ${proc.exitCode}`,
          };
        }

        const { thinking, response } = parseStreamOutput(output);

        console.log("Claude succeeded, response length:", response.length);
        if (!response) {
          console.log("Empty response, raw output:", output.slice(0, 500));
        }

        return {
          success: true,
          thinking,
          response,
        };
      } catch (error: unknown) {
        console.error("Chat error type:", typeof error);
        console.error("Chat error:", error);
        console.error("Chat error JSON:", JSON.stringify(error, null, 2));
        const errorMsg = error instanceof Error
          ? error.message
          : typeof error === 'string'
            ? error
            : JSON.stringify(error) || "Unknown error";
        return {
          success: false,
          error: errorMsg,
        };
      }
    },
    {
      body: t.Object({
        message: t.String(),
        sessionId: t.Optional(t.String()),
        requestId: t.Optional(t.String()),
        permissionMode: t.Optional(t.String()),
      }),
    }
  )
  .post(
    "/api/abort",
    async ({ body }) => {
      const { requestId } = body;

      const entry = runningProcesses.get(requestId);
      if (entry) {
        entry.aborted = true;
        entry.proc.kill();
        runningProcesses.delete(requestId);
        return { success: true, message: "Request aborted" };
      }

      return { success: false, error: "No running request found" };
    },
    {
      body: t.Object({
        requestId: t.String(),
      }),
    }
  )
  .get("/api/sessions", async () => {
    try {
      const encodedPath = CLAUDE_CWD.replace(/\//g, "-");
      const sessionsDir = `${process.env.HOME}/.claude/projects/${encodedPath}`;

      const glob = new Bun.Glob("*.jsonl");
      const sessions: { id: string; modified: number; preview: string }[] = [];

      for await (const file of glob.scan({ cwd: sessionsDir })) {
        const filePath = `${sessionsDir}/${file}`;
        const stat = await Bun.file(filePath).stat();

        // Get first user message as preview
        let preview = "";
        try {
          const content = await Bun.file(filePath).text();
          const lines = content.trim().split("\n");
          for (const line of lines) {
            try {
              const parsed = JSON.parse(line);
              if (parsed.type === "user" && parsed.message?.content) {
                const msgContent = parsed.message.content;
                if (typeof msgContent === "string" && !msgContent.startsWith("<")) {
                  preview = msgContent.slice(0, 100);
                  break;
                } else if (Array.isArray(msgContent)) {
                  for (const block of msgContent) {
                    if (block.type === "text" && block.text && !block.text.startsWith("<")) {
                      preview = block.text.slice(0, 100);
                      break;
                    }
                  }
                  if (preview) break;
                }
              }
            } catch {
              // Skip invalid lines
            }
          }
        } catch {
          // Couldn't read file
        }

        sessions.push({
          id: file.replace(".jsonl", ""),
          modified: stat?.mtime?.getTime() || 0,
          preview: preview || "New conversation",
        });
      }

      sessions.sort((a, b) => b.modified - a.modified);

      return { success: true, sessions, cwd: CLAUDE_CWD };
    } catch {
      return { success: true, sessions: [], cwd: CLAUDE_CWD };
    }
  })
  .get("/api/sessions/:id", async ({ params }) => {
    try {
      const encodedPath = CLAUDE_CWD.replace(/\//g, "-");
      const sessionFile = `${process.env.HOME}/.claude/projects/${encodedPath}/${params.id}.jsonl`;

      const content = await Bun.file(sessionFile).text();
      const lines = content.trim().split("\n");

      const messages: Array<{
        role: "user" | "assistant" | "system";
        content: string;
        thinking?: string[];
        toolUse?: Array<{ name: string; input?: Record<string, unknown> }>;
      }> = [];

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);

          if (parsed.type === "user" && parsed.message) {
            let content = "";

            // message.content can be a string or an array
            const msgContent = parsed.message.content;

            if (typeof msgContent === "string") {
              // Check for system messages
              if (msgContent.startsWith("<task-notification>")) {
                // Extract summary from task notification
                const summaryMatch = msgContent.match(/<summary>([^<]+)<\/summary>/);
                if (summaryMatch) {
                  messages.push({ role: "system", content: summaryMatch[1] });
                }
              } else if (!msgContent.startsWith("<system-reminder>")) {
                // Regular user message (skip system-reminder)
                content = msgContent;
              }
            } else if (Array.isArray(msgContent)) {
              // Array content - check for text type (skip tool_result)
              for (const block of msgContent) {
                if (block.type === "text" && block.text) {
                  // Skip system messages like "[Request interrupted by user]"
                  if (!block.text.startsWith("[Request interrupted")) {
                    content += block.text;
                  }
                }
                // Skip tool_result blocks - they're not user messages
              }
            }

            if (content && content.trim()) {
              messages.push({ role: "user", content: content.trim() });
            }
          }

          if (parsed.type === "assistant" && parsed.message?.content) {
            const thinking: string[] = [];
            const toolUse: Array<{ name: string; input?: Record<string, unknown> }> = [];
            let text = "";

            for (const block of parsed.message.content) {
              if (block.type === "thinking" && block.thinking) {
                thinking.push(block.thinking);
              }
              if (block.type === "text" && block.text) {
                text += block.text;
              }
              if (block.type === "tool_use" && block.name) {
                toolUse.push({
                  name: block.name,
                  input: block.input,
                });
              }
            }

            // Only add message if there's text or tool usage
            if (text || toolUse.length > 0) {
              messages.push({
                role: "assistant",
                content: text,
                thinking: thinking.length > 0 ? thinking : undefined,
                toolUse: toolUse.length > 0 ? toolUse : undefined,
              });
            }
          }
        } catch {
          // Skip invalid lines
        }
      }

      return { success: true, messages };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to load session",
        messages: [],
      };
    }
  })
  // Permission request from hook script (long-polling)
  .post(
    "/api/permission-request",
    async ({ body }) => {
      const { tool_name, tool_input, tool_use_id, session_id, permission_mode } = body;
      const id = tool_use_id || crypto.randomUUID();

      console.log(`[Permission] Request for ${tool_name} (mode: ${permission_mode}):`, tool_input);

      // Auto-approve in bypass mode
      if (permission_mode === "bypassPermissions") {
        console.log(`[Permission] Auto-approving (bypass mode)`);
        return {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "allow",
            permissionDecisionReason: "Bypass mode - auto-approved",
          },
        };
      }

      // Create a promise that will be resolved when user responds
      const decision = await new Promise<PermissionDecision>((resolve) => {
        pendingPermissions.set(id, {
          id,
          sessionId: session_id || "",
          toolName: tool_name,
          toolInput: tool_input,
          timestamp: Date.now(),
          resolve,
        });

        // Timeout after 5 minutes - deny by default
        setTimeout(() => {
          if (pendingPermissions.has(id)) {
            pendingPermissions.delete(id);
            resolve({
              hookSpecificOutput: {
                hookEventName: "PreToolUse",
                permissionDecision: "deny",
                permissionDecisionReason: "Permission request timed out",
              },
            } as unknown as PermissionDecision);
          }
        }, 300000);
      });

      return decision;
    },
    {
      body: t.Object({
        tool_name: t.String(),
        tool_input: t.Any(),
        tool_use_id: t.Optional(t.String()),
        session_id: t.Optional(t.String()),
        cwd: t.Optional(t.String()),
        permission_mode: t.Optional(t.String()),
        hook_event_name: t.Optional(t.String()),
        transcript_path: t.Optional(t.String()),
      }),
    }
  )
  // Get pending permission requests (for frontend polling)
  .get("/api/permission-pending", () => {
    const pending = Array.from(pendingPermissions.values()).map((p) => ({
      id: p.id,
      sessionId: p.sessionId,
      toolName: p.toolName,
      toolInput: p.toolInput,
      timestamp: p.timestamp,
    }));
    return { success: true, pending };
  })
  // Respond to a permission request
  .post(
    "/api/permission-respond",
    async ({ body }) => {
      const { id, allow } = body;

      const request = pendingPermissions.get(id);
      if (!request) {
        return { success: false, error: "Permission request not found or expired" };
      }

      console.log(`[Permission] Response for ${request.toolName}: ${allow ? "allow" : "deny"}`);

      pendingPermissions.delete(id);

      // PreToolUse hook format with hookSpecificOutput wrapper
      request.resolve({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: allow ? "allow" : "deny",
          permissionDecisionReason: allow ? "User approved" : "User denied permission",
        },
      } as unknown as PermissionDecision);

      return { success: true };
    },
    {
      body: t.Object({
        id: t.String(),
        allow: t.Boolean(),
      }),
    }
  )
  // Check if permission hook is configured
  .get("/api/hook-status", async () => {
    const hookScriptPath = path.join(import.meta.dir, "../../scripts/permission-hook.sh");
    const globalSettingsPath = `${process.env.HOME}/.claude/settings.json`;
    const projectSettingsPath = path.join(CLAUDE_CWD, ".claude/settings.json");

    const checkSettings = async (filePath: string): Promise<boolean> => {
      try {
        const content = await Bun.file(filePath).text();
        const settings = JSON.parse(content);
        // Check for PreToolUse hook (primary) or PermissionRequest (legacy)
        const hooks = settings?.hooks?.PreToolUse || settings?.hooks?.PermissionRequest;
        if (!Array.isArray(hooks)) return false;
        // Check if any hook points to our script
        return hooks.some((h: { hooks?: Array<{ command?: string }> }) =>
          h.hooks?.some((hook) => hook.command?.includes("permission-hook.sh"))
        );
      } catch {
        return false;
      }
    };

    const globalConfigured = await checkSettings(globalSettingsPath);
    const projectConfigured = await checkSettings(projectSettingsPath);

    return {
      success: true,
      configured: globalConfigured || projectConfigured,
      globalConfigured,
      projectConfigured,
      hookScriptPath,
      globalSettingsPath,
      projectSettingsPath,
      cwd: CLAUDE_CWD,
    };
  })
  // Configure the permission hook
  .post(
    "/api/hook-configure",
    async ({ body }) => {
      const { location } = body; // "global" or "project"
      const hookScriptPath = path.join(import.meta.dir, "../../scripts/permission-hook.sh");

      const settingsPath =
        location === "global"
          ? `${process.env.HOME}/.claude/settings.json`
          : path.join(CLAUDE_CWD, ".claude/settings.json");

      const settingsDir = path.dirname(settingsPath);

      try {
        // Ensure directory exists
        await Bun.$`mkdir -p ${settingsDir}`.quiet();

        // Read existing settings or create new
        let settings: Record<string, unknown> = {};
        try {
          const content = await Bun.file(settingsPath).text();
          settings = JSON.parse(content);
        } catch {
          // File doesn't exist or is invalid, start fresh
        }

        // Add our hook configuration
        const hookConfig = {
          matcher: "",
          hooks: [
            {
              type: "command",
              command: hookScriptPath,
            },
          ],
        };

        if (!settings.hooks) {
          settings.hooks = {};
        }
        const hooks = settings.hooks as Record<string, unknown>;

        if (!hooks.PreToolUse) {
          hooks.PreToolUse = [];
        }
        const permHooks = hooks.PreToolUse as Array<unknown>;

        // Check if our hook is already there
        const alreadyConfigured = permHooks.some(
          (h: unknown) =>
            (h as { hooks?: Array<{ command?: string }> }).hooks?.some((hook) =>
              hook.command?.includes("permission-hook.sh")
            )
        );

        if (!alreadyConfigured) {
          permHooks.push(hookConfig);
        }

        // Write settings
        await Bun.write(settingsPath, JSON.stringify(settings, null, 2));

        return {
          success: true,
          message: `Hook configured in ${location} settings`,
          settingsPath,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to configure hook",
        };
      }
    },
    {
      body: t.Object({
        location: t.Union([t.Literal("global"), t.Literal("project")]),
      }),
    }
  )
  .get("/assets/*", ({ params }) => {
    const filePath = path.join(DIST_DIR, "assets", params["*"]);
    return Bun.file(filePath);
  })
  .get("*", () => Bun.file(path.join(DIST_DIR, "index.html")))
  .listen({ port: 3000, hostname: "0.0.0.0" });

const getLocalIP = () => {
  const interfaces = require("os").networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
};

const localIP = getLocalIP();
console.log(`Chat server running at:`);
console.log(`  Local:   http://localhost:${app.server?.port}`);
console.log(`  Network: http://${localIP}:${app.server?.port}`);
console.log(`Claude CWD: ${CLAUDE_CWD}`);
