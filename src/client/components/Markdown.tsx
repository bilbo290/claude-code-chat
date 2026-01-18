import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";

interface MarkdownProps {
  content: string;
}

export function Markdown({ content }: MarkdownProps) {
  return (
    <ReactMarkdown
      components={{
        code({ className, children, ...props }) {
          const match = /language-(\w+)/.exec(className || "");
          const isInline = !match && !String(children).includes("\n");

          if (isInline) {
            return (
              <code
                className="break-all rounded bg-zinc-700 px-1 py-0.5 text-xs text-zinc-200 sm:px-1.5 sm:text-sm"
                {...props}
              >
                {children}
              </code>
            );
          }

          return (
            <div className="overflow-x-auto">
              <SyntaxHighlighter
                style={oneDark}
                language={match?.[1] || "text"}
                PreTag="div"
                customStyle={{
                  margin: "0.5rem 0",
                  borderRadius: "0.5rem",
                  fontSize: "0.65rem",
                }}
                wrapLongLines
              >
                {String(children).replace(/\n$/, "")}
              </SyntaxHighlighter>
            </div>
          );
        },
        pre({ children }) {
          return <>{children}</>;
        },
        p({ children }) {
          return <p className="mb-2 last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="mb-2 ml-4 list-disc">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="mb-2 ml-4 list-decimal">{children}</ol>;
        },
        li({ children }) {
          return <li className="mb-1">{children}</li>;
        },
        h1({ children }) {
          return <h1 className="mb-2 text-xl font-bold">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="mb-2 text-lg font-bold">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="mb-2 text-base font-bold">{children}</h3>;
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              className="text-blue-400 underline hover:text-blue-300"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          );
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-2 border-l-2 border-zinc-500 pl-3 italic text-zinc-400">
              {children}
            </blockquote>
          );
        },
        table({ children }) {
          return (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-sm">{children}</table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th className="border border-zinc-600 bg-zinc-700 px-3 py-1 text-left">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="border border-zinc-600 px-3 py-1">{children}</td>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
