"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
}

export interface LlmResult {
  text: string;
  model: string;
  usedFallback: boolean;
}

export interface Source {
  title: string;
  url: string;
  domain?: string;
}

// ---------------------------------------------------------------------------
// Provider plumbing — Groq (primary), Hugging Face (automatic fallback)
// ---------------------------------------------------------------------------

/**
 * SSRF guard — validate a user-supplied URL before fetching it server-side.
 * Blocks private/internal ranges, cloud-metadata endpoints, and non-http(s)
 * schemes. Returns the validated URL string or throws.
 */
export function assertSafePublicUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error("Invalid URL.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }

  const host = parsed.hostname.toLowerCase();

  // Block localhost & literal IPs in private/reserved ranges
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host === "0.0.0.0" ||
    host === "169.254.169.254" || // cloud metadata (AWS/GCP/Azure)
    host === "metadata.google.internal"
  ) {
    throw new Error("That URL is not allowed.");
  }
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    const blocked =
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      a === 0;
    if (blocked) throw new Error("That URL is not allowed.");
  }
  // Block IPv6 loopback/link-local/metadata
  if (host.includes(":")) {
    const h = host.replace(/^\[|\]$/g, "");
    if (
      h === "::1" ||
      h.startsWith("fe80") ||
      h.startsWith("fc") ||
      h.startsWith("fd") ||
      h.startsWith("::ffff:127.")
    ) {
      throw new Error("That URL is not allowed.");
    }
  }

  return parsed.toString();
}

const JARVIS_PROMPT =
  "You are Jarvis, a calm, precise AI assistant. Answer clearly and concisely using short paragraphs. " +
  "Format every response in GitHub-flavored Markdown: use **bold** for key terms, bullet lists for enumerations, " +
  "tables for comparisons, and fenced code blocks with a language tag (```python, ```ts, ...) for any code. " +
  "When research material from web search results is provided in the user message, ground your answer in that material and cite sources inline as [n]." +
  "If the user message includes an image, describe and analyze the image in detail before answering the question." +
  "\n\nMATH & EQUATIONS — Always typeset mathematics in LaTeX for the KaTeX renderer:" +
  "\n- Inline math uses $...$ (e.g. $x^2 + 1$). Display math MUST use FLOW FORM: the opening $$ is alone on its own line, the LaTeX starts on the next line, and the closing $$ is alone on its own line. Example:\n$$\n\\begin{aligned} a &= b \\\\ \\end{aligned}\n$$" +
  "\n- NEVER write $$...$$ inline inside a sentence and NEVER put text after the closing $$ on the same line — a block like `$$x=1$$ so we get` corrupts rendering. End the sentence, then start the $$ block on a fresh line, and start new prose on a fresh line after it." +
  "\n- NEVER use \\(...\\), \\[...\\], or bare [ ... ] delimiters — only $ and $$ work." +
  "\n- \\frac must ALWAYS have its backslash: write \\frac{a}{b} — the plain word `frac{a}{b}` without \\ renders as raw text." +
  "\n- Always close every \\begin{...} with its matching \\end{...} on the same math block — an unclosed environment breaks the whole formula." +
  "\n- Use proper commands: \\frac{a}{b}, \\sqrt{x}, \\int, \\sum, \\lim, \\ln, \\log, \\sin, \\cos, \\tan, \\arctan, \\alpha, \\pi, \\approx, \\neq, \\leq, \\geq, \\to, \\cdot, \\times, \\boxed{...}, \\begin{aligned}...\\end{aligned}." +
  "\n- Wrap final results in \\boxed{...}." +
  "\n\nSOLVING MATH PROBLEMS (algebra, calculus, linear regression, statistics, matrices) — give a structured, textbook-style solution:" +
  "\n1. State what is asked and the method/technique that applies (e.g. polynomial division, u-substitution, partial fractions)." +
  "\n2. Solve step by step: number each step with a bold heading (e.g. **Step 1 — Polynomial division**), show the working as display math ($$...$$), and explain WHY each move is valid in one sentence." +
  "\n3. Show intermediate quantities exactly (fractions like \\tfrac{7}{32}, not decimals) unless a numeric approximation is required — then use \\approx and keep 4-6 significant figures." +
  "\n4. Present the final result with \\boxed{} inside its own $$...$$ block, and define any constants introduced (roots, coefficients)." +
  "\n5. End with 1-3 short bullet Remarks: what technique drove the solution, key checks (e.g. differentiate the antiderivative to verify), and how to adapt for special cases." +
  "\nWhen integration is involved: simplify/factor first, split the integrand (polynomial part via division, proper fraction via derivative-alignment u = D(x), then partial fractions), and integrate each piece with a stated rule." +
  "\n\nLATEX LAYOUT RULES (critical for readability):" +
  "\n- ANY expression containing \\frac, \\sqrt, \\int, \\sum, or more than one operator MUST be display math in flow form (opening $$ alone on a line, math on following lines, closing $$ alone on a line) — NEVER inline, never glued to surrounding text." +
  "\n- Inline $...$ is ONLY for single simple tokens like $x$, $a$, $k = -\\frac{9}{4}$ (one fraction max), $f(x)$, $2x^2 - x + 1$." +
  "\n- Never chain multiple equals signs with fractions inline (e.g. NEVER write $a = \\frac{21}{96} = \\frac{7}{32}$ inline — put each equation on its own display line)." +
  "\n- Derivations with consecutive equalities use \\begin{aligned}...\\end{aligned} inside $$...$$ in FLOW FORM (each fence on its own line), aligning on &= , and separating rows with \\\\ — always double backslash, never a single trailing \\ at end of line." +
  "\n- Use \\dfrac for fractions in display math, \\tfrac for coefficients like \\tfrac{7}{32} attached to symbols." +
  "\n- Long products/quotients: break across multiple display lines instead of cramming into one — readability over compactness." +
  "\n- Define every new symbol the moment it appears (e.g. \"where $D(x) = 2x^3 + x^2 + 1$\"), so terms and relationships are never ambiguous." +
  "\n\nINTERACTIVE GRAPHS — Desmos (CRITICAL for any graphing request):" +
  "\n- When the user wants to see, plot, draw, visualize, or graph anything (phrases like \"x² in graph\", \"plot y=sin(x)\", \"show me the graph of ...\", \"3d graph z=x^2+y^2\"), ALWAYS include an interactive Desmos block so the graph renders live inside the chat." +
  "\n- Emit a fenced code block tagged desmos containing: a mode line, an optional zoom line, then `expressions:` followed by ONE expression per line." +
  "\n- Example — user asks \"solve x² in graph\": extract the expression yourself; NEVER ask the user to retype it:" +
  "\n```desmos" +
  "\nmode: graphing" +
  "\nzoom: 10" +
  "\nexpressions:" +
  "\ny = x^2" +
  "\n```" +
  "\n- Modes: `graphing` (2D curves/equations/inequalities), `3d` (surfaces like z = x^2 + y^2), `scientific` (keypad calculator — emit when the user asks to \"open the calculator\"/\"scientifi calculator\"/मशीन or wants numeric evaluation; emit NO expressions section for it), `fourfunction` (basic +−×÷ calculator — emit when the user asks for a \"simple/basic calculator\"/\"four function calculator\"; emit NO expressions section for it), `geometry` (interactive construction tools — emit when the user asks to construct/draw geometric figures: triangles, bisectors, circles through points, angles, transformations; emit NO expressions section, just `mode: geometry`)." +
  "\n- Expression syntax: `y = ...`, `x = ...`, implicit like `x^2 + y^2 = 25`, inequalities `y < x^2`, parametric `(t, t^2)`, 3D `z = f(x,y)`. Powers with ^, plus sqrt(), sin(), cos(), tan(), ln(), log(), pi, e. ONE per line, NO $ signs, NO markdown, NO backslashes — Desmos parses plain text like `y = x^2` directly." +
  "\n- For limits/derivatives/integrals: plot the function itself (and helper curves like tangent lines when useful); keep the analytical work in normal LaTeX math text alongside the block." +
  "\n- Geometry requests: emit `mode: geometry` with NO expressions list, and give written guidance (which tools to use, e.g. the point/line/circle/angle-bisector tools) in your text reply." +
  "\n- Multiple functions (\"compare x^2 and 2^x\"): put ALL of them in ONE graphing block, one per line." +
  "\n- Always add a short written explanation with proper LaTeX math around the block — the graph supports the answer, it does not replace it." +
  "\n- When the user's request mentions graph/plot/visualize IN ANY LANGUAGE (Hindi, Russian, etc.), the same rule applies — emit the desmos block." +
  "\n- If the model is unsure whether a graph helps, default to including it for anything mentioning graph, plot, curve, or visualization." +
  "\n\nFOLLOW-UP SUGGESTIONS — end EVERY complete reply with a final line exactly of the form:" +
  "\nSUGGEST: first short follow-up, second short follow-up, third short follow-up" +
  "\n- Exactly 3 suggestions, comma-separated, each under 6 words, no numbering — e.g. SUGGEST: differentiate this, plot for x in [-5,5], solve for y = 0" +
  "\n- It MUST be the very last line of the reply with nothing after it — it is parsed out and shown to the user as clickable buttons." +
  "\n- Never put the SUGGEST line inside the desmos code block or inside $$ math.";

/**
 * Build the user message content, optionally including vision content
 * when image URLs are provided.
 */
function buildUserContent(
  text: string,
  imageUrls?: string[],
): string | Array<{ type: string; text?: string; image_url?: { url: string } }> {
  if (!imageUrls || imageUrls.length === 0) {
    return text;
  }

  const parts: Array<{ type: string; text?: string; image_url?: { url: string } }> = [];

  // Add the text prompt
  if (text) {
    parts.push({ type: "text", text });
  } else {
    parts.push({ type: "text", text: "Describe this image in detail." });
  }

  // Add each image
  for (const url of imageUrls) {
    parts.push({
      type: "image_url",
      image_url: { url },
    });
  }

  return parts;
}

async function callGroq(
  key: string,
  turns: ChatTurn[],
): Promise<LlmResult> {
  // Model availability is verified live against this Groq key:
  //  - qwen3.8-27b: the ONLY vision-capable model (accepts image_url parts)
  //  - gpt-oss-120b / gpt-oss-20b: strongest text models (no image support)
  // Reasoning models spend part of the token budget thinking, so the cap is
  // generous — and if `content` is empty we surface `reasoning` as a fallback.
  const hasImages = turns.some((t) => Array.isArray(t.content));
  const models = hasImages
    ? [{ id: "qwen/qwen3.8-27b", label: "qwen3.8-27b" }]
    : [
        { id: "openai/gpt-oss-120b", label: "gpt-oss-120b" },
        { id: "qwen/qwen3.8-27b", label: "qwen3.8-27b" },
        { id: "openai/gpt-oss-20b", label: "gpt-oss-20b" },
      ];

  const failures: string[] = [];
  for (const m of models) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: m.id,
        messages: [{ role: "system", content: JARVIS_PROMPT }, ...turns],
        temperature: 0.6,
        max_tokens: 8192,
        reasoning_effort: "low",
      }),
    });
    if (!res.ok) {
      failures.push(`${m.label} (${res.status})`);
      continue;
    }
    const data = (await res.json()) as {
      choices?: {
        message?: {
          content?: string;
          reasoning?: string;
        };
      }[];
    };
    const message = data.choices?.[0]?.message;
    const text = message?.content?.trim() || message?.reasoning?.trim() || "";
    if (!text) {
      failures.push(`${m.label} (empty response)`);
      continue;
    }
    return { text, model: `groq/${m.label}`, usedFallback: false };
  }
  throw new Error(`Groq failed: ${failures.join(", ")}`);
}

async function callHuggingFace(
  token: string,
  turns: ChatTurn[],
): Promise<LlmResult> {
  // Model availability verified live against the router for this token.
  // (Qwen2.5-7B-1M / gemma-2-2b-it are NOT served for this account.)
  const models = [
    { id: "meta-llama/Llama-3.1-8B-Instruct", label: "Llama-3.1-8B" },
    { id: "Qwen/Qwen2.5-72B-Instruct", label: "Qwen2.5-72B" },
    { id: "deepseek-ai/DeepSeek-V3-0324", label: "DeepSeek-V3" },
  ];

  const failures: string[] = [];
  for (const m of models) {
    // HF doesn't support image content, so convert to text-only
    const textTurns = turns.map((t) => ({
      ...t,
      content: typeof t.content === "string"
        ? t.content
        : t.content
            .filter((p) => p.type === "text")
            .map((p) => p.text ?? "")
            .join(""),
    }));

    const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: m.id,
        messages: [{ role: "system", content: JARVIS_PROMPT }, ...textTurns],
        temperature: 0.6,
        max_tokens: 4096,
      }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) {
      failures.push(`${m.label} (${res.status})`);
      continue;
    }
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      failures.push(`${m.label} (empty response)`);
      continue;
    }
    return { text, model: `huggingface/${m.label}`, usedFallback: true };
  }
  throw new Error(`Hugging Face failed: ${failures.join(", ")}`);
}

export const ask = action({
  args: {
    prompt: v.string(),
    history: v.optional(
      v.array(
        v.object({ role: v.string(), content: v.string() }),
      ),
    ),
    imageUrls: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args): Promise<LlmResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Sign in to talk to Jarvis.");
    }

    const history = (args.history ?? [])
      .slice(-12)
      .map((t) => ({ role: t.role as ChatTurn["role"], content: t.content }));

    // RAG: retrieve semantically relevant memories from past conversations
    let ragContext = "";
    try {
      const memories = await ctx.runAction(api.rag.retrieveContext, {
        query: args.prompt,
        limit: 4,
      });
      if (memories.length > 0) {
        ragContext =
          "\n\nRelevant context from the user's past conversations (use if helpful, don't mention where it came from):\n" +
          memories
            .map(
              (m: { role: string; content: string }) =>
                `- ${m.role === "user" ? "User" : "You"}: ${m.content}`,
            )
            .join("\n");
      }
    } catch {
      // RAG is best-effort
    }

    const groqKey = process.env.GROQ_API_KEY;
    const hfToken = process.env.HUGGING_FACE_TOKEN;

    // Prepend RAG context to the text prompt when available
    const effectivePrompt = ragContext
      ? `${args.prompt}\n\n---${ragContext}`
      : args.prompt;
    const userContent = buildUserContent(effectivePrompt, args.imageUrls);

    const failures: string[] = [];

    if (groqKey) {
      try {
        return await callGroq(groqKey, [...history, { role: "user", content: userContent }]);
      } catch (err) {
        failures.push(`groq: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    } else {
      failures.push("groq: GROQ_API_KEY not configured");
    }

    if (hfToken) {
      try {
        return await callHuggingFace(hfToken, [
          ...history,
          { role: "user", content: userContent },
        ]);
      } catch (err) {
        failures.push(`huggingface: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    } else {
      failures.push("huggingface: HUGGING_FACE_TOKEN not configured");
    }

    throw new Error(
      `All models failed automatically. ${failures.join(" · ")}`,
    );
  },
});

// ---------------------------------------------------------------------------
// Deep Research — serpstack web search, summarized by the LLM with fallback
// ---------------------------------------------------------------------------

export const deepResearch = action({
  args: {
    query: v.string(),
    history: v.optional(
      v.array(
        v.object({ role: v.string(), content: v.string() }),
      ),
    ),
  },
  handler: async (_ctx, args): Promise<{ answer: LlmResult; sources: Source[] }> => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) {
      throw new Error("Sign in to use Deep Research.");
    }

    // 1) Search the live web: serpstack primary → SerApi fallback.
    const searchErrors: string[] = [];
    let sources: Source[] = [];

    const serpstackKey = process.env.SERPSTACK_API_KEY;
    if (serpstackKey) {
      try {
        const data = (await serpstackSearch(serpstackKey, args.query)) as {
          error?: { info?: string };
          organic_results?: { title?: string; url?: string; snippet?: string; domain?: string }[];
        };
        if (data.error) {
          const msg = data.error.info ?? "search failed";
          console.error("[deep-research] serpstack error:", msg);
          searchErrors.push(`serpstack: ${msg}`);
        } else {
          sources = (data.organic_results ?? [])
            .slice(0, 8)
            .map((r) => ({
              title: r.title ?? "Untitled result",
              url: r.url ?? "",
              domain: r.domain,
            }))
            .filter((s) => s.url);
          console.log(`[deep-research] serpstack returned ${sources.length} results`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "failed";
        console.error("[deep-research] serpstack exception:", msg);
        searchErrors.push(`serpstack: ${msg}`);
      }
    } else {
      searchErrors.push("serpstack: SERPSTACK_API_KEY not configured");
    }

    // Fallback: SerApi (serpapi.com) Google results
    if (sources.length === 0) {
      const serpApiKey = process.env.SERPAPI_API_KEY;
      if (serpApiKey) {
        try {
          sources = await serpApiSearch(serpApiKey, args.query);
          console.log(`[deep-research] serpapi fallback returned ${sources.length} results`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : "failed";
          console.error("[deep-research] serpapi exception:", msg);
          searchErrors.push(`serpapi: ${msg}`);
        }
      } else {
        searchErrors.push("serpapi: SERPAPI_API_KEY not configured");
      }
    }

    if (sources.length === 0) {
      throw new Error(
        `All search providers failed. ${searchErrors.join(" · ")}`,
      );
    }

    const context = sources
      .map((s, i) => `[${i + 1}] ${s.title} (${s.domain ?? ""})\n${s.url}`)
      .join("\n\n");

    // 2) Have the LLM (with automatic fallback) synthesize the answer.
    const groqKey = process.env.GROQ_API_KEY;
    const hfToken = process.env.HUGGING_FACE_TOKEN;

    const history = (args.history ?? [])
      .slice(-12)
      .map((t) => ({ role: t.role as ChatTurn["role"], content: t.content }));

    const prompt = `Research this topic using the web results below. Answer in a clear, structured summary and cite sources inline as [1], [2], etc.\n\nWeb results:\n${context}\n\nTopic: ${args.query}`;

    const failures: string[] = [];

    if (groqKey) {
      try {
        return {
          answer: await callGroq(groqKey, [
            ...history,
            { role: "user", content: prompt },
          ]),
          sources,
        };
      } catch (err) {
        failures.push(`groq: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    } else {
      failures.push("groq: GROQ_API_KEY not configured");
    }

    if (hfToken) {
      try {
        return {
          answer: await callHuggingFace(hfToken, [
            ...history,
            { role: "user", content: prompt },
          ]),
          sources,
        };
      } catch (err) {
        failures.push(`huggingface: ${err instanceof Error ? err.message : "unknown error"}`);
      }
    } else {
      failures.push("huggingface: HUGGING_FACE_TOKEN not configured");
    }

    throw new Error(
      `Search succeeded (${sources.length} sources) but all AI models failed: ${failures.join(" · ")}`,
    );
  },
});

/**
 * SerApi (serpapi.com) Google search fallback.
 * Returns organic results normalized to the same Source shape as serpstack.
 */
async function serpApiSearch(key: string, query: string): Promise<Source[]> {
  const url =
    `https://serpapi.com/search.json?engine=google` +
    `&q=${encodeURIComponent(query)}&num=10&api_key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`serpapi.com ${res.status}: ${text.slice(0, 120)}`);
  }
  const data = (await res.json()) as {
    error?: string;
    organic_results?: { title?: string; link?: string; snippet?: string; displayed_link?: string }[];
  };
  if (data.error) throw new Error(`serpapi: ${data.error}`);

  const results = (data.organic_results ?? [])
    .slice(0, 8)
    .map((r) => ({
      title: r.title ?? "Untitled result",
      url: r.link ?? "",
      domain: r.displayed_link,
    }))
    .filter((s) => s.url);

  if (results.length === 0) {
    throw new Error("serpapi: no organic results returned");
  }
  return results;
}

// serpstack free plans restrict HTTPS — retry over http when https is refused.
async function serpstackSearch(key: string, query: string): Promise<unknown> {
  const qs = `access_key=${encodeURIComponent(key)}&type=web&num=10&query=${encodeURIComponent(query)}`;
  let firstStatus: number | string = "network error";
  try {
    const res = await fetch(`https://api.serpstack.com/search?${qs}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return await res.json();
    firstStatus = res.status;
  } catch {
    // fall through to http
  }
  const res2 = await fetch(`http://api.serpstack.com/search?${qs}`, {
    signal: AbortSignal.timeout(10_000),
  });
  if (!res2.ok) {
    throw new Error(
      `request failed (https: ${firstStatus}, http: ${res2.status})`,
    );
  }
  return res2.json();
}

// ---------------------------------------------------------------------------
// NLP — apilayer NLP API
// ---------------------------------------------------------------------------

async function apilayerNlp(
  key: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const res = await fetch(`https://api.apilayer.com/nlp/${path}`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`NLP API request failed (${res.status})`);
  }
  return res.json();
}

export const analyzeText = action({
  args: { text: v.string() },
  handler: async (_ctx, args) => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) throw new Error("Sign in to use NLP analysis.");

    const key = process.env.APILAYER_NLP_KEY;
    if (!key) throw new Error("APILAYER_NLP_KEY is not configured.");

    const [similarity, language, entities] = await Promise.all([
      apilayerNlp(key, "similarity", { text1: args.text, text2: args.text }).catch(() => null),
      apilayerNlp(key, "language_detection", { text: args.text }).catch(() => null),
      apilayerNlp(key, "named_entity_recognition", { text: args.text }).catch(() => null),
    ]);

    return { similarity, language, entities };
  },
});

// ---------------------------------------------------------------------------
// News — mediastack
// ---------------------------------------------------------------------------

export const searchNews = action({
  args: { keywords: v.string() },
  handler: async (_ctx, args) => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) throw new Error("Sign in to search the news.");

    const key = process.env.MEDIASTACK_API_KEY;
    if (!key) throw new Error("MEDIASTACK_API_KEY is not configured.");

    // mediastack free plans also restrict HTTPS — same retry pattern.
    const qs = `access_key=${encodeURIComponent(key)}&keywords=${encodeURIComponent(
      args.keywords,
    )}&limit=6&sort=published_desc`;

    const parseNews = (j: unknown) =>
      j as {
        error?: { info?: string };
        data?: {
          title?: string;
          url?: string;
          source?: string;
          published_at?: string;
          description?: string;
        }[];
      };

    let data: ReturnType<typeof parseNews>;
    try {
      const res = await fetch(`https://api.mediastack.com/v1/news?${qs}`);
      if (res.ok) {
        data = parseNews(await res.json());
      } else {
        const res2 = await fetch(`http://api.mediastack.com/v1/news?${qs}`);
        if (!res2.ok) throw new Error(`mediastack request failed (${res.status}/${res2.status})`);
        data = parseNews(await res2.json());
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("mediastack")) throw err;
      const res2 = await fetch(`http://api.mediastack.com/v1/news?${qs}`);
      if (!res2.ok) throw new Error(`mediastack request failed (${res2.status})`);
      data = parseNews(await res2.json());
    }
    if (data.error) {
      throw new Error(`mediastack: ${data.error.info ?? "news search failed"}`);
    }

    return (data.data ?? []).map((a) => ({
      title: a.title ?? "Untitled article",
      url: a.url ?? "",
      source: a.source,
      publishedAt: a.published_at,
      description: a.description,
    }));
  },
});

// ---------------------------------------------------------------------------
// Summarize URL — fetch a webpage and have Jarvis summarize it
// ---------------------------------------------------------------------------

export const summarizeUrl = action({
  args: {
    url: v.string(),
    history: v.optional(
      v.array(
        v.object({ role: v.string(), content: v.string() }),
      ),
    ),
  },
  handler: async (_ctx, args): Promise<LlmResult> => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) throw new Error("Sign in to summarize a URL.");

    const url = assertSafePublicUrl(args.url.trim());

    // Fetch the webpage content
    let html: string;
    try {
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; JarvisBot/1.0)",
          Accept: "text/html,application/xhtml+xml",
        },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      html = await res.text();
    } catch (err) {
      throw new Error(`Failed to fetch URL: ${err instanceof Error ? err.message : "network error"}`);
    }

    // Extract readable text from HTML
    const text = extractReadableText(html);
    if (text.length < 50) {
      throw new Error("The page didn't contain enough readable text to summarize.");
    }

    // Truncate to ~6000 chars to fit context window
    const truncated = text.length > 6000 ? text.slice(0, 6000) + "\n\n[Content truncated...]" : text;

    const history = (args.history ?? [])
      .slice(-8)
      .map((t) => ({ role: t.role as ChatTurn["role"], content: t.content }));

    const prompt = `Summarize the following webpage content clearly and concisely. Include the page title, key points, and any important details. Format in Markdown.

URL: ${url}

Page content:
${truncated}`;

    const groqKey = process.env.GROQ_API_KEY;
    const hfToken = process.env.HUGGING_FACE_TOKEN;
    const failures: string[] = [];

    if (groqKey) {
      try {
        return await callGroq(groqKey, [...history, { role: "user", content: prompt }]);
      } catch (err) {
        failures.push(`groq: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    if (hfToken) {
      try {
        return await callHuggingFace(hfToken, [...history, { role: "user", content: prompt }]);
      } catch (err) {
        failures.push(`huggingface: ${err instanceof Error ? err.message : "unknown"}`);
      }
    }

    throw new Error(`All models failed. ${failures.join(" · ")}`);
  },
});

/**
 * Extract readable text from HTML by stripping tags, scripts, and styles.
 */
function extractReadableText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<nav[\s\S]*?<\/nav>/gi, "")
    .replace(/<header[\s\S]*?<\/header>/gi, "")
    .replace(/<footer[\s\S]*?<\/footer>/gi, "")
    .replace(/<aside[\s\S]*?<\/aside>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// Region features — timezone, currency, weather, country info
// ---------------------------------------------------------------------------

export const getWorldTime = action({
  args: {
    timezone: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<{
    timezone: string;
    datetime: string;
    date: string;
    time: string;
    dayOfWeek: string;
    offset: string;
  }> => {
    const tz = args.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

    // Try worldtimeapi.org first
    try {
      const res = await fetch(`https://worldtimeapi.org/api/timezone/${encodeURIComponent(tz)}`);
      if (res.ok) {
        const data = await res.json() as {
          timezone: string;
          datetime: string;
          utc_offset: string;
          day_of_week: number;
        };
        const date = new Date(data.datetime);
        const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
        return {
          timezone: data.timezone,
          datetime: data.datetime,
          date: date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: tz }),
          time: date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz }),
          dayOfWeek: dayNames[data.day_of_week],
          offset: data.utc_offset,
        };
      }
    } catch { /* fall through */ }

    // Fallback: compute locally
    const now = new Date();
    return {
      timezone: tz,
      datetime: now.toISOString(),
      date: now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: tz }),
      time: now.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: tz }),
      dayOfWeek: now.toLocaleDateString("en-US", { weekday: "long", timeZone: tz }),
      offset: "unknown",
    };
  },
});

export const getCurrencyRate = action({
  args: {
    from: v.string(),
    to: v.string(),
    amount: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<{
    from: string;
    to: string;
    amount: number;
    result: number;
    rate: number;
  }> => {
    const from = args.from.toUpperCase().trim();
    const to = args.to.toUpperCase().trim();
    const amount = args.amount ?? 1;

    if (from === to) {
      return { from, to, amount, result: amount, rate: 1 };
    }

    // Use open.er-api.com (free, no key)
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`);
    if (!res.ok) throw new Error(`Currency API failed (${res.status})`);
    const data = (await res.json()) as {
      result?: string;
      rates?: Record<string, number>;
    };

    if (data.result !== "success" || !data.rates) {
      throw new Error(`Unknown currency: ${from}`);
    }

    const rate = data.rates[to];
    if (!rate) throw new Error(`Unknown target currency: ${to}`);

    return {
      from,
      to,
      amount,
      result: Math.round(amount * rate * 100) / 100,
      rate: Math.round(rate * 10000) / 10000,
    };
  },
});

interface WeatherData {
  city: string;
  country: string;
  temp: number;
  feelsLike: number;
  humidity: number;
  wind: number;
  description: string;
  icon: string;
  high?: number;
  low?: number;
  pressure?: number;
  visibility?: number;
  sunrise?: string;
  sunset?: string;
  provider: string;
}

/** Map OpenWeatherMap condition ids to emoji. */
function owmIcon(id: number): string {
  if (id >= 200 && id < 300) return "⛈️";
  if (id >= 300 && id < 400) return "🌦️";
  if (id >= 500 && id < 600) return "🌧️";
  if (id >= 600 && id < 700) return "❄️";
  if (id >= 700 && id < 800) return "🌫️";
  if (id === 800) return "☀️";
  if (id === 801) return "🌤️";
  if (id === 802) return "⛅";
  return "☁️";
}

export const getWeather = action({
  args: {
    city: v.string(),
  },
  handler: async (_ctx, args): Promise<WeatherData> => {
    const city = args.city.trim();
    if (!city) throw new Error("City name is required.");

    // Primary: OpenWeatherMap (if key configured)
    const owmKey = process.env.OPENWEATHER_API_KEY;
    if (owmKey) {
      try {
        const res = await fetch(
          `https://api.openweathermap.org/data/2.5/weather?q=${encodeURIComponent(city)}&units=metric&appid=${owmKey}`,
        );
        if (res.ok) {
          const d = (await res.json()) as {
            name?: string;
            dt?: number;
            timezone?: number;
            sys?: { country?: string; sunrise?: number; sunset?: number };
            main?: {
              temp?: number;
              feels_like?: number;
              humidity?: number;
              pressure?: number;
              temp_min?: number;
              temp_max?: number;
            };
            wind?: { speed?: number };
            weather?: { main?: string; description?: string; id?: number }[];
            visibility?: number;
          };
          const fmt = (ts?: number, tz?: number) => {
            if (!ts) return undefined;
            const date = new Date((ts + (tz ?? 0)) * 1000);
            return date.toLocaleTimeString("en-US", {
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
              timeZone: "UTC",
            });
          };
          return {
            city: d.name ?? city,
            country: d.sys?.country ?? "",
            temp: Math.round(d.main?.temp ?? 0),
            feelsLike: Math.round(d.main?.feels_like ?? 0),
            humidity: d.main?.humidity ?? 0,
            wind: Math.round((d.wind?.speed ?? 0) * 3.6),
            description: d.weather?.[0]?.description ?? "Unknown",
            icon: owmIcon(d.weather?.[0]?.id ?? 800),
            high: d.main?.temp_max !== undefined ? Math.round(d.main.temp_max) : undefined,
            low: d.main?.temp_min !== undefined ? Math.round(d.main.temp_min) : undefined,
            pressure: d.main?.pressure,
            visibility: d.visibility !== undefined ? Math.round(d.visibility / 1000) : undefined,
            sunrise: fmt(d.sys?.sunrise, d.timezone),
            sunset: fmt(d.sys?.sunset, d.timezone),
            provider: "openweathermap",
          };
        }
        console.error("OpenWeatherMap failed", res.status, "— falling back to wttr.in");
      } catch (err) {
        console.error("OpenWeatherMap error — falling back to wttr.in:", err);
      }
    }

    // Fallback: wttr.in (free, no key)
    const res = await fetch(
      `https://wttr.in/${encodeURIComponent(city)}?format=j1`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) throw new Error(`Weather API failed (${res.status}). Check the city name.`);

    const data = (await res.json()) as {
      current_condition?: {
        temp_C?: string;
       FeelsLikeC?: string;
        humidity?: string;
        windspeedKmph?: string;
        weatherDesc?: { value?: string }[];
        weatherCode?: string;
        pressure?: string;
        visibility?: string;
      }[];
      weather?: {
        mintempC?: string;
        maxtempC?: string;
        astronomy?: { sunrise?: string; sunset?: string }[];
      }[];
      nearest_area?: {
        areaName?: { value?: string }[];
        country?: { value?: string }[];
      }[];
    };

    const current = data.current_condition?.[0];
    const area = data.nearest_area?.[0];
    if (!current) throw new Error("Could not retrieve weather data.");

    const code = current.weatherCode ?? "113";
    const iconMap: Record<string, string> = {
      "113": "☀️", "116": "⛅", "119": "☁️", "122": "☁️",
      "143": "🌫️", "176": "🌦️", "179": "🌨️", "182": "🌨️",
      "185": "🌨️", "200": "⛈️", "227": "❄️", "230": "❄️",
      "248": "🌫️", "260": "🌫️", "263": "🌦️", "266": "🌧️",
      "281": "🌨️", "284": "🌨️", "293": "🌦️", "296": "🌧️",
      "299": "🌧️", "302": "🌧️", "305": "🌧️", "308": "🌧️",
      "311": "🌨️", "314": "🌨️", "317": "🌨️", "320": "🌨️",
      "323": "🌨️", "326": "🌨️", "329": "❄️", "332": "❄️",
      "335": "❄️", "338": "❄️", "350": "🌨️", "353": "🌦️",
      "356": "🌧️", "359": "🌧️", "362": "🌨️", "365": "🌨️",
      "368": "❄️", "371": "❄️", "374": "🌨️", "377": "🌨️",
      "386": "⛈️", "389": "⛈️", "392": "⛈️", "395": "❄️",
    };

    return {
      city: area?.areaName?.[0]?.value ?? city,
      country: area?.country?.[0]?.value ?? "",
      temp: parseInt(current.temp_C ?? "0"),
      feelsLike: parseInt(current.FeelsLikeC ?? "0"),
      humidity: parseInt(current.humidity ?? "0"),
      wind: parseInt(current.windspeedKmph ?? "0"),
      description: current.weatherDesc?.[0]?.value ?? "Unknown",
      icon: iconMap[code] ?? "🌤️",
      high: data.weather?.[0]?.maxtempC !== undefined ? parseInt(data.weather[0].maxtempC) : undefined,
      low: data.weather?.[0]?.mintempC !== undefined ? parseInt(data.weather[0].mintempC) : undefined,
      pressure: current.pressure !== undefined ? parseInt(current.pressure) : undefined,
      visibility: current.visibility !== undefined ? parseInt(current.visibility) : undefined,
      sunrise: data.weather?.[0]?.astronomy?.[0]?.sunrise,
      sunset: data.weather?.[0]?.astronomy?.[0]?.sunset,
      provider: "wttr.in",
    };
  },
});

/**
 * Natural-language weather: detect weather intent and extract the city from
 * phrases like "what's the weather in Tokyo" or "is it raining in Mumbai?".
 * Lets the AI-router answer plain weather questions with live data directly.
 */
export const detectWeatherQuery = action({
  args: { message: v.string() },
  handler: async (
    _ctx,
    args,
  ): Promise<{ isWeather: boolean; city: string | null }> => {
    const msg = args.message.trim();
    if (msg.length > 200) return { isWeather: false, city: null };

    const lower = msg.toLowerCase();
    const hasWeatherWord =
      /\bweather\b|\btemperature\b|\bforecast\b|\bhow (hot|cold|warm|humid)\b|\brain(ing)?\b|\bsnow(ing)?\b/.test(
        lower,
      );
    if (!hasWeatherWord) return { isWeather: false, city: null };

    // Extraction patterns — most specific first
    const patterns = [
      /(?:weather|temperature|forecast)\s*(?:in|at|for|of|near)\s+([a-zA-Z\s,'().-]{2,60})/i,
      /\bhow\s+(?:hot|cold|warm|humid)\s+is\s+it\s+(?:in|at)\s+([a-zA-Z\s,'().-]{2,60})/i,
      /\bis\s+it\s+(?:raining|snowing)\s+in\s+([a-zA-Z\s,'().-]{2,60})/i,
      /(?:in|at)\s+([a-zA-Z\s,'().-]{2,60})\s+(?:today|tomorrow|tonight|now|right now|currently)/i,
    ];

    for (const p of patterns) {
      const m = msg.match(p);
      if (m?.[1]) {
        const city = m[1]
          .replace(/\b(?:today|tomorrow|tonight|now|currently|please)\b/gi, "")
          .replace(/[?.!,]+$/, "")
          .trim();
        if (city.length >= 2) return { isWeather: true, city };
      }
    }

    return { isWeather: true, city: null };
  },
});

export const getCountryInfo = action({
  args: {
    query: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    name: string;
    officialName: string;
    capital: string;
    region: string;
    subregion: string;
    population: number;
    area: number;
    languages: string[];
    currencies: string[];
    timezones: string[];
    flag: string;
    maps: string;
  }> => {
    const query = args.query.trim();
    if (!query) throw new Error("Country name is required.");

    const res = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(query)}?fullText=false`);
    if (!res.ok) throw new Error(`Country not found: ${query}`);

    const data = (await res.json()) as {
      name?: { common?: string; official?: string };
      capital?: string[];
      region?: string;
      subregion?: string;
      population?: number;
      area?: number;
      languages?: Record<string, string>;
      currencies?: Record<string, { name?: string; symbol?: string }>;
      timezones?: string[];
      flags?: { emoji?: string };
      maps?: { googleMaps?: string };
    }[];

    const c = data[0];
    if (!c) throw new Error(`Country not found: ${query}`);

    return {
      name: c.name?.common ?? query,
      officialName: c.name?.official ?? query,
      capital: c.capital?.[0] ?? "N/A",
      region: c.region ?? "",
      subregion: c.subregion ?? "",
      population: c.population ?? 0,
      area: c.area ?? 0,
      languages: Object.values(c.languages ?? {}),
      currencies: Object.values(c.currencies ?? {}).map((cur) => `${cur.name ?? ""} (${cur.symbol ?? ""})`),
      timezones: c.timezones ?? [],
      flag: c.flags?.emoji ?? "",
      maps: c.maps?.googleMaps ?? "",
    };
  },
});

// ---------------------------------------------------------------------------
// AI-generated chat titles
// ---------------------------------------------------------------------------

export const generateTitle = action({
  args: {
    firstMessage: v.string(),
  },
  handler: async (_ctx, args): Promise<{ title: string }> => {
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) {
      // Graceful fallback: truncate
      const t = args.firstMessage.trim().slice(0, 50);
      return { title: t.length < args.firstMessage.trim().length ? `${t}…` : t };
    }

    try {
      const res = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${groqKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-oss-20b",
            messages: [
              {
                role: "system",
                content:
                  "Generate a concise chat title (3-6 words) for the user's message. Reply with ONLY the title, no quotes, no punctuation at the end.",
              },
              { role: "user", content: args.firstMessage.slice(0, 500) },
            ],
            temperature: 0.3,
            max_tokens: 20,
          }),
        },
      );

      if (res.ok) {
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const title = data.choices?.[0]?.message?.content?.trim();
        if (title) return { title: title.slice(0, 60) };
      }
    } catch {
      // fall through to truncation
    }

    const t = args.firstMessage.trim().slice(0, 50);
    return { title: t.length < args.firstMessage.trim().length ? `${t}…` : t };
  },
});

// ---------------------------------------------------------------------------
// PDF text extraction (unpdf — pure JS, works in Convex node runtime)
// ---------------------------------------------------------------------------

export const extractPdfText = action({
  args: { url: v.string() },
  handler: async (_ctx, args): Promise<{ text: string; pages: number }> => {
    const safeUrl = assertSafePublicUrl(args.url);
    const res = await fetch(safeUrl, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JarvisBot/1.0)" },
    });
    if (!res.ok) throw new Error(`Failed to download PDF (${res.status}).`);

    const buffer = await res.arrayBuffer();
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buffer));
    const { text, totalPages } = await extractText(pdf, { mergePages: true });

    const clean = text.replace(/\s+/g, " ").trim();
    if (!clean) {
      throw new Error(
        "No extractable text found in this PDF (it may be scanned images).",
      );
    }

    return { text: clean.slice(0, 60_000), pages: totalPages };
  },
});
