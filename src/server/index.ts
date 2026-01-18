import { Elysia, t } from "elysia";
import { cors } from "@elysiajs/cors";
import path from "path";

const CLAUDE_CWD = process.env.CLAUDE_CWD || process.cwd();
const DIST_DIR = path.join(import.meta.dir, "../../dist");

// Track running processes for abort functionality
const runningProcesses = new Map<string, { proc: ReturnType<typeof Bun.spawn>; aborted: boolean }>();

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
      const { message, sessionId, requestId } = body;

      try {
        const args = [
          "-p",
          message,
          "--permission-mode",
          "acceptEdits",
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
      const sessions: { id: string; modified: number }[] = [];

      for await (const file of glob.scan({ cwd: sessionsDir })) {
        const stat = await Bun.file(`${sessionsDir}/${file}`).stat();
        sessions.push({
          id: file.replace(".jsonl", ""),
          modified: stat?.mtime?.getTime() || 0,
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
