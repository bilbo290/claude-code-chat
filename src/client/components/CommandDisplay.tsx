import { memo } from "react";
import { Terminal, ChevronRight, AlertCircle } from "lucide-react";

interface CommandDisplayProps {
  content: string;
}

// Parse command-related XML tags from content
function parseCommandContent(content: string): {
  type: "command" | "output" | "caveat" | null;
  commandName?: string;
  commandMessage?: string;
  commandArgs?: string;
  output?: string;
  caveat?: string;
} {
  // Check for command invocation
  const commandNameMatch = content.match(/<command-name>([^<]+)<\/command-name>/);
  if (commandNameMatch) {
    const commandMessageMatch = content.match(/<command-message>([^<]*)<\/command-message>/);
    const commandArgsMatch = content.match(/<command-args>([^<]*)<\/command-args>/);
    return {
      type: "command",
      commandName: commandNameMatch[1],
      commandMessage: commandMessageMatch?.[1] || "",
      commandArgs: commandArgsMatch?.[1] || "",
    };
  }

  // Check for command output
  const outputMatch = content.match(/<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/);
  if (outputMatch) {
    // Strip ANSI codes
    const cleanOutput = outputMatch[1].replace(/\x1b\[[0-9;]*m/g, "");
    return {
      type: "output",
      output: cleanOutput.trim(),
    };
  }

  // Check for caveat
  const caveatMatch = content.match(/<local-command-caveat>([\s\S]*?)<\/local-command-caveat>/);
  if (caveatMatch) {
    return {
      type: "caveat",
      caveat: caveatMatch[1].trim(),
    };
  }

  return { type: null };
}

export function hasCommandTags(content: string): boolean {
  return (
    content.includes("<command-name>") ||
    content.includes("<local-command-stdout>") ||
    content.includes("<local-command-caveat>")
  );
}

export const CommandDisplay = memo(function CommandDisplay({ content }: CommandDisplayProps) {
  const parsed = parseCommandContent(content);

  if (parsed.type === "command") {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-blue-500/10 px-3 py-2 text-blue-400">
        <Terminal className="h-4 w-4 shrink-0" />
        <code className="font-mono text-sm">{parsed.commandName}</code>
        {parsed.commandArgs && (
          <>
            <ChevronRight className="h-3 w-3 opacity-50" />
            <span className="text-xs opacity-70">{parsed.commandArgs}</span>
          </>
        )}
      </div>
    );
  }

  if (parsed.type === "output") {
    return (
      <div className="rounded-lg bg-zinc-800 p-2.5">
        <div className="mb-1.5 flex items-center gap-1.5 text-xs text-zinc-500">
          <Terminal className="h-3 w-3" />
          <span>Output</span>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-zinc-300">
          {parsed.output}
        </pre>
      </div>
    );
  }

  if (parsed.type === "caveat") {
    // Hide caveat messages or show minimal indicator
    return null;
  }

  // Fallback - shouldn't happen
  return null;
});
