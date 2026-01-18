import { useState, memo } from "react";
import { diffLines } from "diff";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
    css: "css",
    html: "html",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    md: "markdown",
    sh: "bash",
    sql: "sql",
  };
  return langMap[ext] || "text";
};

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

export const ToolDisplay = memo(function ToolDisplay({ name, input }: ToolDisplayProps) {
  const hasExpandableContent =
    (name === "Edit" && input?.old_string && input?.new_string) ||
    (name === "Write" && input?.content) ||
    (name === "Bash" && input?.command);

  const [isOpen, setIsOpen] = useState(hasExpandableContent);
  const ToolIcon = getToolIcon(name);

  const getTitle = () => {
    if (input?.file_path) {
      return input.file_path.split("/").pop();
    }
    if (input?.description) {
      return input.description.slice(0, 40);
    }
    if (name === "Bash" && input?.command) {
      return input.command.slice(0, 40);
    }
    return name;
  };

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <CollapsibleTrigger asChild>
        <button
          className={`flex w-full items-center gap-1.5 rounded-2xl px-3 py-2 text-left text-xs ${
            hasExpandableContent
              ? "bg-green-500/10 text-green-400"
              : "bg-zinc-800/50 text-zinc-400"
          }`}
        >
          <ToolIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="shrink-0 font-medium">{name}</span>
          <span className="min-w-0 flex-1 truncate opacity-70">{getTitle()}</span>
          {hasExpandableContent && (
            <ChevronDown className={`h-3.5 w-3.5 shrink-0 ${isOpen ? "rotate-180" : ""}`} />
          )}
        </button>
      </CollapsibleTrigger>

      {hasExpandableContent && (
        <CollapsibleContent>
          <div className="mt-1 overflow-hidden rounded-xl bg-zinc-900 text-xs">
            {input?.file_path && (
              <div className="truncate border-b border-zinc-800 bg-zinc-800/50 px-2.5 py-1.5 text-zinc-500">
                {input.file_path}
              </div>
            )}

            {name === "Edit" && input?.old_string && input?.new_string && (
              <DiffView oldStr={input.old_string} newStr={input.new_string} />
            )}

            {name === "Write" && input?.content && (
              <SyntaxHighlighter
                style={oneDark}
                language={input?.file_path ? getLanguageFromPath(input.file_path) : "text"}
                wrapLongLines
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  fontSize: "12px",
                  maxHeight: "200px",
                  overflow: "auto",
                }}
              >
                {input.content}
              </SyntaxHighlighter>
            )}

            {name === "Bash" && input?.command && (
              <SyntaxHighlighter
                style={oneDark}
                language="bash"
                wrapLongLines
                customStyle={{
                  margin: 0,
                  borderRadius: 0,
                  fontSize: "12px",
                  overflow: "auto",
                }}
              >
                {input.command}
              </SyntaxHighlighter>
            )}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
});

const DiffView = memo(function DiffView({ oldStr, newStr }: { oldStr: string; newStr: string }) {
  const changes = diffLines(oldStr, newStr);

  return (
    <div className="max-h-64 overflow-auto">
      {changes.map((change, i) => {
        const lines = change.value.split("\n").filter((_, idx, arr) =>
          idx < arr.length - 1 || arr[idx] !== ""
        );

        return lines.map((line, j) => (
          <div
            key={`${i}-${j}`}
            className={`px-2.5 py-0.5 ${
              change.added
                ? "bg-green-900/40 text-green-300"
                : change.removed
                  ? "bg-red-900/40 text-red-300"
                  : "text-zinc-400"
            }`}
          >
            <span className="mr-2 inline-block w-4 select-none text-zinc-600">
              {change.added ? "+" : change.removed ? "-" : " "}
            </span>
            <span className="whitespace-pre-wrap break-all">{line || " "}</span>
          </div>
        ));
      })}
    </div>
  );
});
