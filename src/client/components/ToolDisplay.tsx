import { useState } from "react";
import { diffLines } from "diff";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Card } from "@/components/ui/card";
import {
  ChevronDown,
  FileEdit,
  FileCode,
  Terminal,
  Search,
  Globe,
  FolderOpen,
  Wrench,
  FilePlus,
} from "lucide-react";

interface ToolInput {
  file_path?: string;
  old_string?: string;
  new_string?: string;
  content?: string;
  command?: string;
  description?: string;
  pattern?: string;
  path?: string;
  [key: string]: unknown;
}

interface ToolDisplayProps {
  name: string;
  input?: ToolInput;
}

const getToolIcon = (name: string) => {
  if (name === "Edit") return FileEdit;
  if (name === "Write") return FilePlus;
  if (name === "Read") return FileCode;
  if (name === "Bash") return Terminal;
  if (name === "Grep" || name === "Glob") return Search;
  if (name === "WebFetch" || name === "WebSearch") return Globe;
  if (name === "Task") return FolderOpen;
  return Wrench;
};

const getLanguageFromPath = (filePath: string): string => {
  const ext = filePath.split(".").pop()?.toLowerCase() || "";
  const langMap: Record<string, string> = {
    ts: "typescript",
    tsx: "tsx",
    js: "javascript",
    jsx: "jsx",
    py: "python",
    rb: "ruby",
    go: "go",
    rs: "rust",
    java: "java",
    cpp: "cpp",
    c: "c",
    h: "c",
    css: "css",
    scss: "scss",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "bash",
    bash: "bash",
    sql: "sql",
  };
  return langMap[ext] || "text";
};

function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const changes = diffLines(oldStr, newStr);

  return (
    <div className="overflow-hidden rounded-md bg-zinc-900 font-mono text-[10px] sm:text-xs">
      {changes.map((change, i) => {
        const lines = change.value.split("\n").filter((_, idx, arr) =>
          idx < arr.length - 1 || arr[idx] !== ""
        );

        return lines.map((line, j) => (
          <div
            key={`${i}-${j}`}
            className={`overflow-hidden px-1.5 py-0.5 sm:px-2 ${
              change.added
                ? "bg-green-900/40 text-green-300"
                : change.removed
                  ? "bg-red-900/40 text-red-300"
                  : "text-zinc-400"
            }`}
          >
            <span className="mr-1.5 inline-block w-3 shrink-0 select-none text-zinc-600 sm:mr-2 sm:w-4">
              {change.added ? "+" : change.removed ? "-" : " "}
            </span>
            <span className="break-all whitespace-pre-wrap">{line || " "}</span>
          </div>
        ));
      })}
    </div>
  );
}

export function ToolDisplay({ name, input }: ToolDisplayProps) {
  const hasExpandableContent =
    (name === "Edit" && input?.old_string && input?.new_string) ||
    (name === "Write" && input?.content) ||
    (name === "Bash" && input?.command);

  const [isOpen, setIsOpen] = useState(hasExpandableContent);
  const ToolIcon = getToolIcon(name);

  const getTitle = () => {
    if (input?.file_path) {
      const fileName = input.file_path.split("/").pop();
      return fileName;
    }
    if (input?.description) {
      return input.description;
    }
    if (name === "Bash" && input?.command) {
      const cmd = input.command;
      return cmd.length > 50 ? cmd.slice(0, 50) + "..." : cmd;
    }
    return name;
  };

  const getSubtitle = () => {
    if (input?.file_path) {
      return input.file_path;
    }
    return "";
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={`flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-[11px] transition-colors sm:gap-2 sm:px-3 sm:py-2 sm:text-xs ${
            hasExpandableContent
              ? "bg-green-500/10 text-green-400 hover:bg-green-500/20"
              : "bg-zinc-800/50 text-zinc-400"
          }`}
        >
          <ToolIcon className="h-3 w-3 shrink-0 sm:h-3.5 sm:w-3.5" />
          <span className="shrink-0 font-medium">{name}</span>
          <span className="min-w-0 flex-1 truncate text-green-400/70">{getTitle()}</span>
          {hasExpandableContent && (
            <ChevronDown
              className={`h-3 w-3 shrink-0 transition-transform sm:h-3.5 sm:w-3.5 ${isOpen ? "rotate-180" : ""}`}
            />
          )}
        </button>
      </CollapsibleTrigger>

      {hasExpandableContent && (
        <CollapsibleContent className="overflow-hidden">
          <Card className="mt-1 overflow-hidden border-green-500/20 bg-zinc-900 p-0">
            {/* File path */}
            {input?.file_path && (
              <div className="truncate border-b border-zinc-800 px-2 py-1 font-mono text-[10px] text-zinc-500 sm:px-3 sm:py-1.5 sm:text-xs">
                {input.file_path}
              </div>
            )}

            {/* Edit diff */}
            {name === "Edit" && input?.old_string && input?.new_string && (
              <DiffView
                oldStr={input.old_string}
                newStr={input.new_string}
              />
            )}

            {/* Write content */}
            {name === "Write" && input?.content && (
              <div className="overflow-hidden">
                <SyntaxHighlighter
                  style={oneDark}
                  language={input?.file_path ? getLanguageFromPath(input.file_path) : "text"}
                  customStyle={{
                    margin: 0,
                    borderRadius: 0,
                    fontSize: "0.625rem",
                    maxHeight: "250px",
                    overflow: "auto",
                  }}
                  wrapLongLines
                >
                  {input.content}
                </SyntaxHighlighter>
              </div>
            )}

            {/* Bash command */}
            {name === "Bash" && input?.command && (
              <div className="overflow-hidden p-1.5 sm:p-2">
                <SyntaxHighlighter
                  style={oneDark}
                  language="bash"
                  customStyle={{
                    margin: 0,
                    borderRadius: "0.25rem",
                    fontSize: "0.625rem",
                    overflow: "hidden",
                    wordBreak: "break-all",
                  }}
                  wrapLongLines
                >
                  {input.command}
                </SyntaxHighlighter>
              </div>
            )}
          </Card>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}
