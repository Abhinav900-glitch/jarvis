"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ChatTurn {
  role: "user" | "assistant" | "system";
  content: string;
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

const JARVIS_PROMPT =
  "You are Jarvis, a calm, precise AI assistant. Answer clearly and concisely using short paragraphs. When research material from web search results is provided in the user message, ground your answer in that material and cite sources inline as [n].";

async function callGroq(
  key: string,
  turns: ChatTurn[],
): Promise<LlmResult> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "llama-3.1-8b-instant",
      messages: [{ role: "system", content: JARVIS_PROMPT }, ...turns],
      temperature: 0.6,
      max_tokens: 1500,
    }),
  });
  if (!res.ok) {
    throw new Error(`Groq request failed (${res.status})`);
  }
  const data = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const text = data.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("Groq returned an empty response");
  return { text, model: "groq/llama-3.1-8b-instant", usedFallback: false };
}

async function callHuggingFace(
  token: string,
  turns: ChatTurn[],
): Promise<LlmResult> {
  // Non-gated models first, so the fallback works on any HF token.
  const models = [
    { id: "Qwen/Qwen2.5-7B-Instruct-1M", label: "Qwen2.5-7B" },
    { id: "google/gemma-2-2b-it", label: "Gemma-2-2B" },
  ];

  const failures: string[] = [];
  for (const m of models) {
    const res = await fetch("https://router.huggingface.co/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: m.id,
        messages: [{ role: "system", content: JARVIS_PROMPT }, ...turns],
        temperature: 0.6,
        max_tokens: 1500,
      }),
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
  },
  handler: async (_ctx, args): Promise<LlmResult> => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) {
      throw new Error("Sign in to talk to Jarvis.");
    }

    const history = (args.history ?? [])
      .slice(-12)
      .map((t) => ({ role: t.role as ChatTurn["role"], content: t.content }));

    const groqKey = process.env.GROQ_API_KEY;
    const hfToken = process.env.HUGGING_FACE_TOKEN;

    const failures: string[] = [];

    if (groqKey) {
      try {
        return await callGroq(groqKey, [...history, { role: "user", content: args.prompt }]);
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
          { role: "user", content: args.prompt },
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

    // 1) Search the live web via serpstack.
    const serpstackKey = process.env.SERPSTACK_API_KEY;
    if (!serpstackKey) {
      throw new Error("SERPSTACK_API_KEY is not configured.");
    }

    const data = await serpstackSearch(
      serpstackKey,
      args.query,
    ) as {
      error?: { info?: string };
      organic_results?: { title?: string; url?: string; snippet?: string; domain?: string }[];
    };
    if (data.error) {
      throw new Error(`serpstack: ${data.error.info ?? "search failed"}`);
    }

    const sources: Source[] = (data.organic_results ?? [])
      .slice(0, 8)
      .map((r) => ({
        title: r.title ?? "Untitled result",
        url: r.url ?? "",
        domain: r.domain,
      }))
      .filter((s) => s.url);

    if (sources.length === 0) {
      throw new Error("No search results found for this query.");
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

    const prompt = `Research this topic using the web results below. Answer in a clear, structured summary and cite sources inline as [1], [2], etc.

Web results:
${context}

Topic: ${args.query}`;

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
      `All models failed automatically. ${failures.join(" · ")}`,
    );
  },
});

// serpstack free plans restrict HTTPS — retry over http when https is refused.
async function serpstackSearch(key: string, query: string): Promise<unknown> {
  const qs = `access_key=${encodeURIComponent(key)}&type=web&num=10&query=${encodeURIComponent(query)}`;
  let first: Response | null = null;
  try {
    const res = await fetch(`https://api.serpstack.com/search?${qs}`);
    if (res.ok) return await res.json();
    first = res;
  } catch {
    // fall through to http
  }
  const res2 = await fetch(`http://api.serpstack.com/search?${qs}`);
  if (!res2.ok) {
    throw new Error(
      `serpstack request failed (https: ${first?.status ?? "network error"}, http: ${res2.status})`,
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
