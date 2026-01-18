import ReactMarkdown from "react-markdown";

interface MarkdownProps {
  content: string;
}

export function Markdown({ content }: MarkdownProps) {
  return (
    <ReactMarkdown
      components={{
        code({ className, children, ...props }) {
          const isInline = !className && !String(children).includes("\n");

          if (isInline) {
            return (
              <code
                className="break-all rounded bg-zinc-700 px-1 py-0.5 text-[10px] text-zinc-200"
                {...props}
              >
                {children}
              </code>
            );
          }

          return (
            <pre className="my-2 overflow-auto rounded bg-zinc-800 p-2 text-[10px]">
              <code className="whitespace-pre-wrap break-all text-zinc-200" {...props}>
                {children}
              </code>
            </pre>
          );
        },
        pre({ children }) {
          return <>{children}</>;
        },
        p({ children }) {
          return <p className="mb-2 break-words last:mb-0">{children}</p>;
        },
        ul({ children }) {
          return <ul className="mb-2 ml-4 list-disc">{children}</ul>;
        },
        ol({ children }) {
          return <ol className="mb-2 ml-4 list-decimal">{children}</ol>;
        },
        li({ children }) {
          return <li className="mb-1 break-words">{children}</li>;
        },
        h1({ children }) {
          return <h1 className="mb-2 text-base font-bold">{children}</h1>;
        },
        h2({ children }) {
          return <h2 className="mb-2 text-sm font-bold">{children}</h2>;
        },
        h3({ children }) {
          return <h3 className="mb-2 text-xs font-bold">{children}</h3>;
        },
        a({ href, children }) {
          return (
            <a
              href={href}
              className="break-all text-blue-400 underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              {children}
            </a>
          );
        },
        blockquote({ children }) {
          return (
            <blockquote className="my-2 border-l-2 border-zinc-500 pl-2 italic text-zinc-400">
              {children}
            </blockquote>
          );
        },
        table({ children }) {
          return (
            <div className="my-2 overflow-x-auto">
              <table className="w-full border-collapse text-[10px]">{children}</table>
            </div>
          );
        },
        th({ children }) {
          return (
            <th className="border border-zinc-600 bg-zinc-700 px-2 py-1 text-left">
              {children}
            </th>
          );
        },
        td({ children }) {
          return (
            <td className="border border-zinc-600 px-2 py-1">{children}</td>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
