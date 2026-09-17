import katex from "katex";
import { Check, Copy } from "lucide-react";
import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { DesmosCalculator } from "@/components/desmos-calculator";

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
export function stripMathArtifacts(input: string): string {
  return input
    .replace(/(\\[a-zA-Z]+)!/g, "$1")
    .replace(/,\s*(d[a-zA-Z])(?![a-zA-Z])/g, "\\,$1")
    .replace(/\\-/g, "-");
}

/**
 * Clean up an inline TeX string before it is wrapped in single `$`:
 *  - `&` is only valid inside aligned environments, so replace it with `\quad`
 *    everywhere else (legacy table rows like `r &\approx -0.618`).
 *  - Close any `\begin{env}` that never got its `\end{env}`.
 */
function sanitizeInlineTex(tex: string): string {
  const cleaned = /\\begin\{(aligned|align|align\*|cases|gathered|split|array)\}/.test(tex)
    ? tex
    : tex.replace(/&/g, " \\quad ");
  return repairMathBlock(cleaned);
}

/**
 * Close any `\begin{env}` that never got its `\end{env}` inside a display
 * block, and open any `\end{env}` whose `\begin{env}` was lost (truncated
 * streams cut messages mid-block — both directions must be healed or KaTeX
 * renders the whole block as raw red text).
 */
function repairMathBlock(tex: string): string {
  // Heal a truncated env command first: `\end{aligned` (no closing brace) is
  // invisible to the begin/end counters below and would get a DUPLICATE
  // \end{aligned} appended. Complete any \begin{x / \end{x missing its } }.
  let pre = tex.replace(/(\\(?:begin|end)\{[a-zA-Z]*)(?=[\s]|$)/g, "$1}");
  const opens = [...pre.matchAll(/\\begin\{([a-zA-Z*]+)\}/g)].map((m) => m[1]);
  const closes = [...pre.matchAll(/\\end\{([a-zA-Z*]+)\}/g)].map((m) => m[1]);
  const count = (arr: string[], s: string) => arr.filter((x) => x === s).length;
  let out = pre;
  // Orphan \end{env} → prepend the missing \begin{env}
  for (const env of new Set(closes)) {
    const missing = count(closes, env) - count(opens, env);
    for (let i = 0; i < missing; i++) out = "\\begin{" + env + "}" + out;
  }
  // Orphan \begin{env} → append the missing \end{env}
  for (const env of new Set(opens)) {
    const missing = count(opens, env) - count(closes, env);
    for (let i = 0; i < missing; i++) out += "\\end{" + env + "}";
  }
  // Heal unbalanced braces (a truncated `\end{aligned` missing its `}`).
  let depth = 0;
  for (let i = 0; i < out.length; i++) {
    if (out[i] === "\\") {
      i++;
      continue;
    }
    if (out[i] === "{") depth++;
    else if (out[i] === "}") depth--;
  }
  while (depth > 0) {
    out += "}";
    depth--;
  }
  return out;
}

export function repairDisplayMath(input: string): string {
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
export function normalizeMathDelimiters(input: string): string {
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
 * Commands the streaming model used to emit without their backslash (common in
 * history saved before the prompt hardening, e.g. a literal `frac{a}{b}`).
 * Only restored when followed by a brace-group, so ordinary prose is untouched.
 */
const BARE_COMMAND =
  /(?<![\\])\b(frac|sqrt|sum|prod|int|iint|iiint|lim|log|ln|exp|sin|cos|tan|arctan|left|right|begin|end|boxed|displaystyle|text|mathrm|mathbf|mathcal|over|cdot|times|pm|infty|partial|theta|alpha|beta|gamma|lambda|mu|pi|Delta|Sigma|Omega)\b(?=\s*\{)/g;

/**
 * Wrap parenthesized math that has no delimiters — legacy text like
 * `(x^{2}+px+q),\qquad q\approx0.618` — in inline `$...$` so KaTeX renders it.
 * Uses a balanced-paren scan so nested groups survive intact.
 */
export function wrapParenMath(segment: string): string {
  let out = "";
  let buf = "";
  let depth = 0;
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];
    if (ch === "(") {
      depth += 1;
      buf += ch;
    } else if (ch === ")") {
      if (depth === 0) {
        out += buf + ch;
        buf = "";
        continue;
      }
      depth -= 1;
      buf += ch;
      if (depth === 0) {
        const inner = buf.slice(1, -1);
        const looksLikeLatex =
          /\\[a-zA-Z]+/.test(inner) ||
          /[_^{}]/.test(inner) ||
          /\b(frac|sqrt|over|sum|prod|lim|log|ln|cdot|times|pm|infty|approx|qquad)\b/.test(
            inner,
          );
        out += looksLikeLatex ? "$" + sanitizeInlineTex(buf) + "$" : buf;
        buf = "";
      }
    } else if (depth > 0) {
      buf += ch;
    } else {
      out += ch;
    }
  }
  return out + buf;
}

/**
 * Legacy-message repair pass. Old replies were saved before the prompt
 * hardening, so they can contain bare `frac{...}` / `sqrt{...}` / `begin{...}`
 * without backslashes and parenthesized math without any delimiters. Running
 * this on every render is what makes history display correctly too.
 */
export function repairLegacyMath(input: string): string {
  // Genuine legacy LaTeX is ASCII. Segments containing non-ASCII characters
  // (Devanagari, emoji, CJK, …) are prose — math-wrapping them corrupts the
  // neighbouring $$ fences (the closing $$ gets absorbed and every later
  // fence in the document then mispairs, producing the raw-red-LaTeX dump).
  const isAsciiMathCandidate = (seg: string) => ! /[^\x00-\x7F]/.test(seg);

  const isProtected = (seg: string) =>
    seg.startsWith("$$") ||
    seg.startsWith("```") ||
    seg.startsWith("`") ||
    (seg.startsWith("$") && seg.endsWith("$"));

  // NOTE: this stage runs AFTER isolateDisplayFences in the pipeline. On
  // isolate-normalized text every $$...$$ span is a well-formed pair on its
  // own lines, so the lazy split regexes below segment correctly. On raw
  // (possibly truncated) text they mispair — never reorder these two stages.

  // 1) Restore missing backslashes everywhere except fenced/inline code.
  const withBackslashes = input
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg) => (seg.startsWith("`") ? seg : seg.replace(BARE_COMMAND, "\\$1")))
    .join("");

  // 1b) Strip orphan \begin{...}/\end{...} tokens left in PROSE (outside any
  //     math or code). They come from truncated streams and are meaningless
  //     outside math — left in place they render as literal garbage text.
  const withEnvStripped = withBackslashes
    .split(/(\$\$[\s\S]+?\$\$|```[\s\S]*?```|`[^`\n]*`|\$[^$\n]+\$)/g)
    .map((seg) =>
      isProtected(seg)
        ? seg
        : seg.replace(/\\(?:begin|end)\{[a-zA-Z*]+\}/g, ""),
    )
    .join("");

  // 2) Wrap parenthesized math, but only in plain ASCII text — never inside
  //    display math, inline math, code, or non-ASCII prose.
  const withParens = withEnvStripped
    .split(/(\$\$[\s\S]+?\$\$|```[\s\S]*?```|`[^`\n]*`|\$[^$\n]+\$)/g)
    .map((seg) =>
      isProtected(seg) || !isAsciiMathCandidate(seg)
        ? seg
        : wrapParenMath(seg),
    )
    .join("");

  // 3) History lines can also have completely undelimited math in prose
  //    (`the quotient is \frac{1}{2}x^3 ...`). Group contiguous mathy tokens
  //    and wrap the maximal runs containing a math command in `$...$`.
  return withParens
    .split(/(\$\$[\s\S]+?\$\$|```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg) =>
      seg.startsWith("$$") || seg.startsWith("`") || !isAsciiMathCandidate(seg)
        ? seg
        : wrapBareMath(seg),
    )
    .join("");
}

/**
 * Wrap runs of bare math in `$...$` on lines that have no `$` yet. A token is
 * "mathy" if it consists only of math-ish characters; a run starts at a token
 * with a math indicator (backslash command, ^, _, {, =, /...) and extends over
 * adjacent mathy tokens, stopping at plain English words ("so", "minus", ...)
 * so prose in between is never typeset as math.
 */
export function wrapBareMath(segment: string): string {
  const MATHY = /^[\w\\^_{}()\[\]=+\-*/.,±≈|:]+$/;
  const INDICATOR =
    /\\|^|_|\{|\}|=|\/|\b(frac|sqrt|over|sum|prod|int|lim|log|ln|exp|approx|cdot|times|pm|infty)\b/;
  const isWord = (t: string) => /^[a-z]{2,}$/.test(t) && !/\\/.test(t);

  return segment
    .split("\n")
    .map((line) => {
      if (line.includes("$") || !/\\[a-zA-Z]/.test(line)) return line;
      const tokens = line.split(/\s+/).filter(Boolean);
      const out: string[] = [];
      let run: string[] = [];
      const flush = () => {
        if (run.length > 0) {
          out.push("$" + sanitizeInlineTex(run.join(" ")) + "$");
          run = [];
        }
      };
      for (let i = 0; i < tokens.length; i++) {
        const t = tokens[i];
        if (!MATHY.test(t) || !INDICATOR.test(t) || isWord(t)) {
          flush();
          out.push(t);
          continue;
        }
        run.push(t);
        while (
          i + 1 < tokens.length &&
          MATHY.test(tokens[i + 1]) &&
          !isWord(tokens[i + 1])
        ) {
          run.push(tokens[++i]);
        }
        flush();
      }
      flush();
      return out.join(" ");
    })
    .join("\n");
}

/** Does this text contain math/markdown worth routing through the pipeline? */
export function looksLikeMathOrMarkdown(text: string): boolean {
  if (!text) return false;
  if (/```/.test(text) || /(^|\n)\s*#{1,6}\s/.test(text)) return true;
  return isLatexish(text) || /\$\$/.test(text) || /\\\(|\\\[/.test(text);
}

/** Full normalization pipeline applied to a message before markdown rendering. */
export function normalizeMessageContent(content: string): string {
  // Order matters: fence ISOLATION must run BEFORE legacy repair. On raw
  // (possibly truncated) text a lazy $$...$$ split pairs a stray closing fence
  // with the next block's opener and every downstream segmenter misaligns.
  // isolateDisplayFences drops bogus pairs and puts every real pair on its own
  // lines, after which the legacy passes segment correctly.
  return repairDisplayMath(
    separateDisplayMath(
      hoistInlineMath(
        repairLegacyMath(
          isolateDisplayFences(
            normalizeMathDelimiters(stripMathArtifacts(content)),
          ),
        ),
      ),
    ),
  );
}

/**
 * Hoist heavy inline math into display blocks. Models still occasionally cram
 * multi-fraction chains into inline $...$, which renders cramped and garbled.
 * Anything with 2+ fractions, integral/sum/root commands, chained equalities,
 * or excessive length becomes its own $$...$$ block — KaTeX renders those
 * beautifully, so this is a pure win. Fenced code and inline code are untouched.
 */
export function hoistInlineMath(input: string): string {
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
          return `\n\n$$\n${tex}\n$$\n\n`;
        },
      );
    })
    .join("");
}

/**
 * Repair row separators inside display TeX. Streaming models sometimes split
 * the `\\` row break across a line ending with a single `\`, which is not
 * valid TeX and corrupts aligned/cases environments.
 */
function fixRowSeparators(tex: string): string {
  return tex.replace(/(^|[^\\])\\\s*\n/g, "$1\\\\\n");
}

/**
 * THE critical structural repair: isolate every $$...$$ span onto its own
 * lines. When a model writes `text $$math$$ more text` (or glues blocks
 * back-to-back), remark-math parses the $$ as INLINE math and pairs fences
 * across the document — display blocks vanish and the closing $$ plus the
 * following prose end up inside one broken KaTeX node (the giant red raw-LaTeX
 * dump). Re-emitting each span on its own lines with blank lines around it
 * forces remark-math's flow parser to pair every fence correctly.
 *
 * This stage also validates every fence PAIR: if the content between two
 * fences contains no math at all (pure prose — Devanagari, markdown, etc.),
 * the first fence was a stray closer from a truncated block. Pairing it with
 * the next fence would swallow the prose between them into one broken math
 * node (the root cause of "half the reply renders as raw red LaTeX"). The
 * stray fence is dropped instead and pairing resumes after it. An unpaired
 * trailing opener (stream cut mid-block) gets closed at the end of the text.
 */
export function isolateDisplayFences(input: string): string {
  const looksLikeMath = (s: string) => /\\[a-zA-Z]|[_^{}=&]/.test(s);

  return input
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((seg) => {
      if (seg.startsWith("`")) return seg;
      let rest = seg;
      let out = "";
      for (;;) {
        const open = rest.indexOf("$$");
        if (open === -1) {
          out += rest;
          break;
        }
        const close = rest.indexOf("$$", open + 2);
        if (close === -1) {
          // Unpaired opener — stream truncated mid-block. Close it here so it
          // cannot pair with a fence further down the document.
          const tex = fixRowSeparators(repairMathBlock(rest.slice(open + 2)));
          out += rest.slice(0, open) + `\n\n$$\n${tex.trim()}\n$$\n\n`;
          break;
        }
        const tex = rest.slice(open + 2, close);
        if (!looksLikeMath(tex)) {
          // Bogus pair: the first fence is an orphan closer. Drop it and
          // rescan from just after it.
          out += rest.slice(0, open);
          rest = rest.slice(open + 2);
          continue;
        }
        const fixed = fixRowSeparators(repairMathBlock(tex));
        // Emit the FLOW form ($$ alone on opening/closing lines): remark-math
        // only parses display math when the fences are line-delimited. A
        // single-line $$x$$ is text (inline) math, and multi-line text math is
        // what mispairs with neighbouring paragraphs.
        out += rest.slice(0, open) + `\n\n$$\n${fixed.trim()}\n$$\n\n`;
        rest = rest.slice(close + 2);
      }
      return out;
    })
    .join("");
}

/**
 * Guarantee blank lines around display-math blocks. When a $$...$$ block sits
 * directly against a text line (no empty line between), remark parses it as a
 * paragraph continuation and the tall KaTeX box overlaps the surrounding text.
 */
export function separateDisplayMath(input: string): string {
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

  // Desmos interactive calculator block: ```desmos
  if (lang === "desmos") {
    return <DesmosCalculator source={raw} />;
  }

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

/**
 * Split a message into display-math blocks and everything else. Rendering
 * each block through its OWN ReactMarkdown instance isolates failures: a
 * broken math node can only ever trash its own block, never cascade red raw
 * LaTeX across the rest of the reply.
 */
function splitDisplayBlocks(text: string): string[] {
  return text
    .split(/(```[\s\S]*?```|\$\$[\s\S]+?\$\$)/g)
    .filter((s) => s.length > 0);
}

function MarkdownMessageBase({
  content,
  sources,
}: {
  content: string;
  sources?: Source[];
}) {
  const normalized = normalizeMessageContent(content);

  const withCitations = sources && sources.length > 0
    ? normalized.replace(/\[(\d+)\](?!\()/g, (match: string, n: string) => {
        const src = sources[parseInt(n, 10) - 1];
        return src ? `[${n}](${src.url})` : match;
      })
    : normalized;

  const blocks = splitDisplayBlocks(withCitations);

  return (
    <div className="md-body">
      {blocks.map((block, i) => {
        if (!block.startsWith("$$")) {
          return <MarkdownChunk key={i} text={block} />;
        }
        // Display block: validate the TeX first. If KaTeX cannot parse it,
        // render the source in a readable code panel instead of letting KaTeX
        // dump raw red LaTeX into the message.
        const tex = block.slice(2, -2);
        let valid = true;
        try {
          katex.renderToString(tex, { displayMode: true, throwOnError: true, strict: false });
        } catch {
          valid = false;
        }
        if (valid) return <MarkdownChunk key={i} text={block} />;
        return (
          <pre
            key={i}
            className="my-3 overflow-x-auto rounded-md border bg-muted/40 px-4 py-3 text-[13px] leading-6 text-muted-foreground"
          >
            {tex.trim()}
          </pre>
        );
      })}
    </div>
  );
}

function MarkdownChunk({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[
        rehypeHighlight,
        [rehypeKatex, { throwOnError: false, strict: false, output: "html" }],
      ]}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
}

export const MarkdownMessage = memo(MarkdownMessageBase);
