"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { internal } from "./_generated/api";

// ---------------------------------------------------------------------------
// RAG (Retrieval-Augmented Generation)
//
// Every finished user/assistant exchange is embedded with a small, fast
// sentence-transformer (all-MiniLM-L6-v2, 384 dims, free via HuggingFace) and
// stored in a Convex vector index. When a new message arrives, the most
// semantically similar past messages — across ALL the user's chats — are
// retrieved and injected as context, so Jarvis "remembers" relevant facts
// from conversations that happened days ago in other threads.
// ---------------------------------------------------------------------------

const EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2";
export const EMBED_DIMS = 384;

async function embedTexts(token: string, texts: string[]): Promise<number[][]> {
  // api-inference.huggingface.co is retired — the Inference API lives on the
  // router host now (verified live with this token).
  const res = await fetch(
    `https://router.huggingface.co/hf-inference/models/${EMBED_MODEL}/pipeline/feature-extraction`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: texts,
        options: { wait_for_model: true },
      }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`embedding failed (${res.status}): ${t.slice(0, 120)}`);
  }
  const data = (await res.json()) as number[][] | { embeddings?: number[][] };
  const vectors = Array.isArray(data) ? data : (data.embeddings ?? []);
  if (vectors.length !== texts.length) {
    throw new Error("embedding count mismatch");
  }
  return vectors;
}

/** Store embeddings for a set of messages (called after each exchange). */
export const indexMessages = action({
  args: {
    sessionId: v.id("chatSessions"),
    messages: v.array(
      v.object({
        messageId: v.id("chatMessages"),
        role: v.string(),
        content: v.string(),
      }),
    ),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return { indexed: 0 };

    const token = process.env.HUGGING_FACE_TOKEN;
    if (!token) return { indexed: 0 }; // RAG silently disabled without a token

    const valid = args.messages.filter(
      (m) => m.content.trim().length >= 20 && m.content.length <= 4000,
    );
    if (valid.length === 0) return { indexed: 0 };

    try {
      const vectors = await embedTexts(
        token,
        valid.map((m) => m.content.slice(0, 2000)),
      );
      for (let i = 0; i < valid.length; i++) {
        const vec = vectors[i];
        if (!Array.isArray(vec) || vec.length !== EMBED_DIMS) continue;
        await ctx.runMutation(internal.chats.insertEmbedding, {
          userId,
          sessionId: args.sessionId,
          messageId: valid[i].messageId,
          role: valid[i].role,
          content: valid[i].content.slice(0, 2000),
          vector: vec,
        });
      }
      return { indexed: valid.length };
    } catch (err) {
      // RAG is best-effort — never block the chat on embedding failures
      console.error("[rag] indexing failed:", err);
      return { indexed: 0 };
    }
  },
});

/** Retrieve the most relevant past messages for a query (semantic search). */
export const retrieveContext = action({
  args: {
    query: v.string(),
    limit: v.optional(v.number()),
    currentSessionId: v.optional(v.id("chatSessions")),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ role: string; content: string; sessionId: string }[]> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const token = process.env.HUGGING_FACE_TOKEN;
    if (!token) return [];

    try {
      const [queryVec] = await embedTexts(token, [args.query.slice(0, 2000)]);
      if (!Array.isArray(queryVec) || queryVec.length !== EMBED_DIMS) return [];

      const matches = await ctx.vectorSearch(
        "messageEmbeddings",
        "by_embedding",
        {
          vector: queryVec,
          limit: (args.limit ?? 6) * 2,
          filter: (q) => q.eq("userId", userId),
        },
      );

      // vectorSearch returns ids + scores only — hydrate the documents
      const results = await Promise.all(
        matches.map(async (m) => ({ doc: await ctx.runQuery(internal.chats.getEmbedding, { id: m._id }), score: m._score })),
      );

      return results
        .filter((r) => r.doc !== null && r.score > 0.35) // similarity floor
        .slice(0, args.limit ?? 6)
        .map((r) => ({
          role: r.doc!.role,
          content: r.doc!.content,
          sessionId: String(r.doc!.sessionId),
        }));
    } catch (err) {
      console.error("[rag] retrieval failed:", err);
      return [];
    }
  },
});


