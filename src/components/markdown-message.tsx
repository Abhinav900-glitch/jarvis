import { Check, Copy } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import remarkGfm from "remark-gfm";

// ---------------------------------------------------------------------------
// Source type (mirror of convex/ai.ts)
// ---------------------------------------------------------------------------

interface Source {
  title: string;
  url: string;
  domain?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flatten a React node tree to its raw text content. */
function extractText(node: unknown): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && "props" in (node as Record<string, unknown>)) {
    const props = (node as { props?: { children?: unknown } }).props;
    return extractText(props?.children);
  }
  return "";
}

/**
 * Turn literal [1]-style citations into real markdown links so the custom
 * anchor renderer can display them as source chips.
 */
function withCitationLinks(content: string, sources?: Source[]): string {
  if (!sources || sources.length === 0) return content;
  return content.replace(/\[(\d+)\](?!\()/g, (match, n: string) => {
    const src = sources[parseInt(n, 10) - 1];
    return src ? `[${n}](${src.url})` : match;
  });
}

// ---------------------------------------------------------------------------
// Code block — language label + copy button around the highlighted code
// ---------------------------------------------------------------------------

function CodeBlock({ children }: { children?: React.ReactNode }) {
  const [copied, setCopied] = useState(false);

  const first = Array.isArray(children) ? children[0] : children;
  const className =
    typeof first === "object" && first !== null && "props" in first
      ? String(
          (first as { props?: { className?: string } }).props?.className ?? "",
        )
      : "";
  const lang = /language-([\w+-]+)/.exec(className)?.[1] ?? "code";
  const raw = extractText(children);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard unavailable — do nothing.
    }
  };

  return (
    <div className="my-4 overflow-hidden rounded-md border bg-muted/40">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          {lang}
        </span>
        <button
          onClick={copy}
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="size-3" />
          ) : (
            <Copy className="size-3" />
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-6">
        {children}
      </pre>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

const components: Components = {
  // Citations become superscript chips; regular links stay minimal.
  a: ({ href, children }) => {
    const text = extractText(children).trim();
    if (href && /^\d+$/.test(text)) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="mx-px inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-0.5 align-super text-[10px] leading-none text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          {text}
        </a>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium underline underline-offset-2 hover:text-foreground"
      >
        {children}
      </a>
    );
  },
  pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
  // Highlighted blocks carry an `hljs` class from rehype-highlight; inline
  // code does not, so it gets the subtle chip treatment instead.
  code: ({ className, children }) => {
    const isBlock =
      typeof className === "string" &&
      (className.includes("hljs") || className.includes("language-"));
    if (isBlock) {
      return (
        <code className={className}>{children}</code>
      );
    }
    return (
      <code className="rounded-sm border bg-muted/60 px-1 py-0.5 text-[0.85em] font-medium">
        {children}
      </code>
    );
  },
};

function MarkdownMessageBase({
  content,
  sources,
}: {
  content: string;
  sources?: Source[];
}) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {withCitationLinks(content, sources)}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownMessage = memo(MarkdownMessageBase);
