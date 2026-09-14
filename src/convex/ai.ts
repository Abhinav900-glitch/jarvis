"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

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

const JARVIS_PROMPT =
  "You are Jarvis, a calm, precise AI assistant. Answer clearly and concisely using short paragraphs. " +
  "Format every response in GitHub-flavored Markdown: use **bold** for key terms, bullet lists for enumerations, " +
  "tables for comparisons, and fenced code blocks with a language tag (```python, ```ts, ...) for any code. " +
  "When research material from web search results is provided in the user message, ground your answer in that material and cite sources inline as [n]." +
  "If the user message includes an image, describe and analyze the image in detail before answering the question." +
  "\n\nMATH & EQUATIONS — Always typeset mathematics in LaTeX for the KaTeX renderer:" +
  "\n- Inline math uses $...$ (e.g. $x^2 + 1$). Display math uses $$...$$ on its own lines." +
  "\n- NEVER use \\(...\\), \\[...\\], or bare [ ... ] delimiters — only $ and $$ work." +
  "\n- Use proper commands: \\frac{a}{b}, \\sqrt{x}, \\int, \\sum, \\lim, \\ln, \\log, \\sin, \\cos, \\tan, \\arctan, \\alpha, \\pi, \\approx, \\neq, \\leq, \\geq, \\to, \\cdot, \\times, \\boxed{...}, \\begin{aligned}...\\end{aligned}." +
  "\n- Wrap final results in \\boxed{...}." +
  "\n\nSOLVING MATH PROBLEMS (algebra, calculus, linear regression, statistics, matrices) — give a structured, textbook-style solution:" +
  "\n1. State what is asked and the method/technique that applies (e.g. polynomial division, u-substitution, partial fractions)." +
  "\n2. Solve step by step: number each step with a bold heading, show the working as display math, and explain WHY each move is valid in one sentence." +
  "\n3. Show intermediate quantities exactly (fractions like \\tfrac{7}{32}, not decimals) unless a numeric approximation is required — then use \\approx and keep 4-6 significant figures." +
  "\n4. Present the final result with \\boxed{} and define any constants introduced (roots, coefficients)." +
  "\n5. End with 1-3 short bullet Remarks: what technique drove the solution, key checks (e.g. differentiate the antiderivative to verify), and how to adapt for special cases." +
  "\nWhen integration is involved: simplify/factor first, split the integrand (polynomial part via division, proper fraction via derivative-alignment u = D(x), then partial fractions), and integrate each piece with a stated rule.";

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
  // Vision-capable model first (when images present), then reasoning, then fast.
  const models = [
    { id: "meta-llama/llama-4-scout-17b-16e-instruct", label: "llama-4-scout" },
    { id: "openai/gpt-oss-120b", label: "gpt-oss-120b" },
    { id: "qwen/qwen3.8-27b", label: "qwen3.8-27b" },
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
        max_tokens: 4096,
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
    return { text, model: `groq/${m.label}`, usedFallback: false };
  }
  throw new Error(`Groq failed: ${failures.join(", ")}`);
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
    imageUrls: v.optional(v.array(v.string())),
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

    const userContent = buildUserContent(args.prompt, args.imageUrls);

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

    const url = args.url.trim();
    if (!url) throw new Error("URL is empty.");
    if (!/^https?:\/\//.test(url)) throw new Error("Please enter a valid URL starting with http:// or https://.");

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

export const getWeather = action({
  args: {
    city: v.string(),
  },
  handler: async (_ctx, args): Promise<{
    city: string;
    country: string;
    temp: number;
    feelsLike: number;
    humidity: number;
    wind: number;
    description: string;
    icon: string;
  }> => {
    const city = args.city.trim();
    if (!city) throw new Error("City name is required.");

    // Use wttr.in (free, no key)
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
    };
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
            model: "llama-3.1-8b-instant",
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
    const res = await fetch(args.url, {
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
