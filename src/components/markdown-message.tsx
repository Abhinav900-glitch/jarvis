import { Check, Copy } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";

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
 * Normalize AI-style LaTeX delimiters to remark-math's `$...$` / `$$...$$`.
 * Handles:
 *  - `\[ ... \]` display (OpenAI convention)
 *  - `\( ... \)` inline (OpenAI convention)
 *  - `[ ... ]` standalone display lines (bracket convention)
 */
function normalizeMathDelimiters(input: string): string {
  let text = input;

  // OpenAI-style display: \[ ... \]  ->  $$ ... $$
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m: string, tex: string) => {
    return "\n\n$$" + tex.trim() + "$$\n\n";
  });

  // OpenAI-style inline: \( ... \)  ->  $ ... $
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_m: string, tex: string) => {
    return "$" + tex.trim() + "$";
  });

  // Standalone bracketed display: a line that is only [ ... ] containing
  // LaTeX-ish content (backslash commands, ^, _, {, }). Skips markdown links.
  const lines = text.split("\n");
  const out: string[] = [];
  let inBracket = false;
  let bracketBuf: string[] = [];

  const flushBracket = () => {
    if (bracketBuf.length > 0) {
      const inner = bracketBuf.join("\n").trim();
      const latexish =
        /\\[a-zA-Z]+/.test(inner) || /[_^{}]/.test(inner) || /\bfrac\b/.test(inner);
      const isLink = /^\[.*\]\(.*\)$/.test(inner);
      if (inner && latexish && !isLink) {
        out.push("");
        out.push("$$" + inner + "$$");
        out.push("");
      } else {
        out.push("[" + bracketBuf.join("\n"));
      }
      bracketBuf = [];
    }
    inBracket = false;
  };

  for (const line of lines) {
    if (!inBracket) {
      if (/^\s*\[\s*$/.test(line)) {
        inBracket = true;
        bracketBuf = [];
      } else if (/^\s*\[([\s\S]+)\]\s*$/.test(line) && !/^\s*\[.*\]\(.*\)\s*$/.test(line)) {
        // Single-line [ ... ] bracket display
        const inner = line.trim().slice(1, -1).trim();
        const latexish =
          /\\[a-zA-Z]+/.test(inner) || /[_^{}]/.test(inner) || /\bfrac\b/.test(inner);
        if (inner && latexish) {
          out.push("");
          out.push("$$" + inner + "$$");
          out.push("");
        } else {
          out.push(line);
        }
      } else {
        out.push(line);
      }
    } else {
      if (/^\s*\]\s*$/.test(line)) {
        flushBracket();
      } else {
        bracketBuf.push(line);
      }
    }
  }
  flushBracket();

  return out.join("\n");
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
      // Clipboard unavailable — ignore.
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
// Markdown renderer components
// ---------------------------------------------------------------------------

const components: Components = {
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
  code: ({ className, children }) => {
    const isBlock =
      typeof className === "string" &&
      (className.includes("hljs") || className.includes("language-"));
    if (isBlock) {
      return <code className={className}>{children}</code>;
    }
    return (
      <code className="rounded-sm border bg-muted/60 px-1 py-0.5 text-[0.85em] font-medium">
        {children}
      </code>
    );
  },
};

// ---------------------------------------------------------------------------
// Markdown renderer
// ---------------------------------------------------------------------------

function MarkdownMessageBase({
  content,
  sources,
}: {
  content: string;
  sources?: Source[];
}) {
  const normalized = normalizeMathDelimiters(content);

  const withCitations = sources && sources.length > 0
    ? normalized.replace(/\[(\d+)\](?!\()/g, (match: string, n: string) => {
        const src = sources[parseInt(n, 10) - 1];
        return src ? `[${n}](${src.url})` : match;
      })
    : normalized;

  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          rehypeHighlight,
          [rehypeKatex, { throwOnError: false, strict: false, output: "html" }],
        ]}
        components={components}
      >
        {withCitations}
      </ReactMarkdown>
    </div>
  );
}

export const MarkdownMessage = memo(MarkdownMessageBase);
