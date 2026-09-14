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
 * Only allow safe URL schemes in rendered links and images. Blocks
 * javascript:, vbscript:, data: (except images), and other injection vectors
 * that markdown renderers otherwise pass through.
 */
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|#)/i;
const SAFE_IMG = /^(https?:\/\/|data:image\/)/i;

export function sanitizeUrl(url: string, allowDataImage = false): string | undefined {
  const pattern = allowDataImage ? SAFE_IMG : SAFE_HREF;
  const trimmed = url.trim();
  if (!trimmed || !pattern.test(trimmed)) return undefined;
  return trimmed;
}

/** Does a snippet look like LaTeX content rather than plain prose/link text? */
function isLatexish(s: string): boolean {
  return (/[\\][a-zA-Z]+/.test(s) || /[_^{}]/.test(s) || /\bfrac\b/.test(s));
}

/**
 * Strip invalid character sequences that LLMs occasionally emit and that KaTeX
 * cannot parse (it then renders raw red LaTeX text):
 *  - `!` glued after a command (e.g. `\int!`, `\arctan!\big`)
 *  - a comma used as a thin space before differentials (e.g. `f(x),dx`)
 */
function stripMathArtifacts(input: string): string {
  return input
    .replace(/(\\[a-zA-Z]+)!/g, "$1")
    .replace(/,\s*(d[a-zA-Z])(?![a-zA-Z])/g, "\\,$1");
}

/**
 * Close any `\begin{env}` that never got its `\end{env}` inside a display
 * block (truncated streams would otherwise fail to parse).
 */
function repairMathBlock(tex: string): string {
  const opens = [...tex.matchAll(/\\begin\{([a-zA-Z*]+)\}/g)].map((m) => m[1]);
  const closes = [...tex.matchAll(/\\end\{([a-zA-Z*]+)\}/g)].map((m) => m[1]);
  const count = (arr: string[], s: string) => arr.filter((x) => x === s).length;
  let out = tex;
  for (const env of new Set(opens)) {
    const missing = count(opens, env) - count(closes, env);
    for (let i = 0; i < missing; i++) out += "\\end{" + env + "}";
  }
  return out;
}

function repairDisplayMath(input: string): string {
  return input.replace(/\$\$([\s\S]+?)\$\$/g, (_m: string, tex: string) => {
    return "$$" + repairMathBlock(tex) + "$$";
  });
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
      const isLink = /^\[.*\]\(.*\)$/.test(inner);
      if (inner && isLatexish(inner) && !isLink) {
        out.push("");
        out.push("$$" + inner + "$$");
        out.push("");
      } else {
        out.push("[" + bracketBuf.join("\n") + "]");
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
        if (inner && isLatexish(inner)) {
          out.push("");
          out.push("$$" + inner + "$$");
          out.push("");
        } else {
          out.push(line);
        }
      } else if (
        /^\s*\[\s+\S/.test(line) &&
        isLatexish(line) &&
        !/\]\s*$/.test(line) &&
        !/\[.*\]\(.*\)/.test(line)
      ) {
        // Multi-line display bracket with content already on the first line:
        // `  [ I = \int f(x) , dx`  ...  `  ]`
        inBracket = true;
        bracketBuf = [line.trim().replace(/^\s*\[\s*/, "")];
      } else {
        out.push(line);
      }
    } else {
      if (/^\s*\]\s*$/.test(line)) {
        flushBracket();
      } else if (/\]\s*$/.test(line)) {
        // Content and the closing bracket share the last line.
        bracketBuf.push(line.replace(/\]\s*$/, ""));
        flushBracket();
      } else {
        bracketBuf.push(line);
      }
    }
  }
  flushBracket();

  return out.join("\n");
}

/**
 * Hoist heavy inline math into display blocks. Models still occasionally cram
 * multi-fraction chains into inline $...$, which renders cramped and garbled.
 * Anything with 2+ fractions, integral/sum/root commands, chained equalities,
 * or excessive length becomes its own $$...$$ block — KaTeX renders those
 * beautifully, so this is a pure win. Fenced code and inline code are untouched.
 */
function hoistInlineMath(input: string): string {
  const shouldHoist = (tex: string): boolean => {
    const fracCount = (tex.match(/\\[dt]?frac\b/g) ?? []).length;
    if (fracCount >= 2) return true;
    if (/\\(?:int|iint|iiint|sum|prod|lim|sqrt|begin\{|cases|over)/.test(tex)) return true;
    if ((tex.match(/=/g) ?? []).length >= 2) return true;
    if (tex.length > 80) return true;
    return false;
  };

  return input
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg) => {
      if (seg.startsWith("`")) return seg;
      return seg.replace(
        /(?<![\\$])\$(?!\s)((?:[^$\n\\]|\\.)+?)(?<!\s)\$(?!\$)/g,
        (match: string, tex: string) => {
          if (!shouldHoist(tex)) return match;
          return `\n\n$$${tex}$$\n\n`;
        },
      );
    })
    .join("");
}

/**
 * Guarantee blank lines around display-math blocks. When a $$...$$ block sits
 * directly against a text line (no empty line between), remark parses it as a
 * paragraph continuation and the tall KaTeX box overlaps the surrounding text.
 */
function separateDisplayMath(input: string): string {
  return input
    .split(/(```[\s\S]*?```)/g)
    .map((seg) => {
      if (seg.startsWith("```")) return seg;
      const out: string[] = [];
      let inDisplay = false;
      for (const line of seg.split("\n")) {
        const prev = out.length > 0 ? out[out.length - 1] : "";
        const trimmed = line.trim();
        const opensDisplay = /^\$\$/.test(trimmed);
        const closesDisplay = /\$\$$/.test(trimmed);
        const prevIsDisplayEnd =
          /^\$\$$/.test(prev.trim()) ||
          /^\$\$[\s\S]+\$\$$/.test(prev.trim());

        if (!inDisplay) {
          // Blank line before a display block that touches text above it
          if (opensDisplay && prev.trim() !== "") out.push("");
          // Blank line between a completed display block and text below it
          if (
            !opensDisplay &&
            trimmed !== "" &&
            prev.trim() !== "" &&
            prevIsDisplayEnd
          ) {
            out.push("");
          }
          out.push(line);
          if (opensDisplay && !closesDisplay) inDisplay = true;
        } else {
          out.push(line);
          if (closesDisplay) inDisplay = false;
        }
      }
      return out.join("\n");
    })
    .join("");
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
      // navigator.clipboard requires HTTPS; fall back for insecure contexts
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(raw);
      } else {
        const ta = document.createElement("textarea");
        ta.value = raw;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
      }
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
    const safeHref = href ? sanitizeUrl(href) : undefined;
    const text = extractText(children).trim();
    if (safeHref && /^\d+$/.test(text)) {
      return (
        <a
          href={safeHref}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="mx-px inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-0.5 align-super text-[10px] leading-none text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
        >
          {text}
        </a>
      );
    }
    if (!safeHref) {
      return <span>{children}</span>;
    }
    return (
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer nofollow"
        className="font-medium underline underline-offset-2 hover:text-foreground"
      >
        {children}
      </a>
    );
  },
  img: ({ src, alt }) => {
    const safeSrc = typeof src === "string" ? sanitizeUrl(src, true) : undefined;
    if (!safeSrc) return null;
    return (
      <img
        src={safeSrc}
        alt={alt ?? ""}
        loading="lazy"
        referrerPolicy="no-referrer"
        className="max-w-full rounded-[var(--radius-sm)]"
      />
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
  const normalized = repairDisplayMath(
    separateDisplayMath(
      hoistInlineMath(normalizeMathDelimiters(stripMathArtifacts(content))),
    ),
  );

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
