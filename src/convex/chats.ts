import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import type { Id } from "./_generated/dataModel";

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export const listSessions = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("chatSessions")
      .withIndex("by_user_updated", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const createSession = mutation({
  args: { title: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to start a chat.");

    const now = Date.now();
    const sessionId = await ctx.db.insert("chatSessions", {
      userId,
      title: args.title ?? "New chat",
      createdAt: now,
      updatedAt: now,
    });
    return sessionId;
  },
});

export const renameSession = mutation({
  args: { sessionId: v.id("chatSessions"), title: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    await ctx.db.patch(args.sessionId, { title: args.title });
  },
});

export const deleteSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .collect();
    for (const m of messages) {
      await ctx.db.delete(m._id);
    }
    await ctx.db.delete(args.sessionId);
  },
});

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export const listMessages = query({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) return [];

    return await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", args.sessionId))
      .order("asc")
      .collect();
  },
});

export const appendMessage = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    content: v.string(),
    model: v.optional(v.string()),
    usedFallback: v.optional(v.boolean()),
    usedSearch: v.optional(v.boolean()),
    sources: v.optional(
      v.array(
        v.object({ title: v.string(), url: v.string(), domain: v.optional(v.string()) }),
      ),
    ),
    imageUrl: v.optional(v.string()),
    imagePublicId: v.optional(v.string()),
    images: v.optional(
      v.array(
        v.object({
          url: v.string(),
          publicId: v.optional(v.string()),
        }),
      ),
    ),
    fileUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId) {
      throw new Error("Chat not found.");
    }

    const messageId = await ctx.db.insert("chatMessages", {
      sessionId: args.sessionId,
      userId,
      role: args.role,
      content: args.content,
      model: args.model,
      usedFallback: args.usedFallback,
      usedSearch: args.usedSearch,
      sources: args.sources,
      imageUrl: args.imageUrl,
      imagePublicId: args.imagePublicId,
      images: args.images,
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      fileType: args.fileType,
      fileSize: args.fileSize,
      createdAt: Date.now(),
    });

    await ctx.db.patch(args.sessionId, { updatedAt: Date.now() });
    return messageId;
  },
});

// Convenience: create session + first user message in one mutation.
export const startWithMessage = mutation({
  args: {
    content: v.string(),
    imageUrl: v.optional(v.string()),
    imagePublicId: v.optional(v.string()),
    images: v.optional(
      v.array(
        v.object({
          url: v.string(),
          publicId: v.optional(v.string()),
        }),
      ),
    ),
    fileUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to start a chat.");

    const now = Date.now();
    const title =
      args.content.length > 60
        ? `${args.content.slice(0, 60).trimEnd()}…`
        : args.content;

    const sessionId = await ctx.db.insert("chatSessions", {
      userId,
      title,
      createdAt: now,
      updatedAt: now,
    });

    const messageId = await ctx.db.insert("chatMessages", {
      sessionId,
      userId,
      role: "user",
      content: args.content,
      imageUrl: args.imageUrl,
      imagePublicId: args.imagePublicId,
      images: args.images,
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      fileType: args.fileType,
      fileSize: args.fileSize,
      createdAt: now,
    });

    return { sessionId, messageId };
  },
});

// ---------------------------------------------------------------------------
// Edit / delete messages
// ---------------------------------------------------------------------------

export const editMessage = mutation({
  args: {
    messageId: v.id("chatMessages"),
    content: v.string(),
    imageUrl: v.optional(v.string()),
    imagePublicId: v.optional(v.string()),
    images: v.optional(
      v.array(
        v.object({
          url: v.string(),
          publicId: v.optional(v.string()),
        }),
      ),
    ),
    fileUrl: v.optional(v.string()),
    fileName: v.optional(v.string()),
    fileType: v.optional(v.string()),
    fileSize: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.userId !== userId) throw new Error("Message not found.");
    if (msg.role !== "user") throw new Error("Can only edit user messages.");

    // Delete all messages after this one (the assistant reply + any follow-ups)
    const laterMessages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", (q) => q.eq("sessionId", msg.sessionId))
      .filter((q) => q.gt(q.field("createdAt"), msg.createdAt))
      .collect();
    for (const m of laterMessages) {
      await ctx.db.delete(m._id);
    }

    // Update the user message content
    await ctx.db.patch(args.messageId, {
      content: args.content,
      imageUrl: args.imageUrl,
      imagePublicId: args.imagePublicId,
      images: args.images,
      fileUrl: args.fileUrl,
      fileName: args.fileName,
      fileType: args.fileType,
      fileSize: args.fileSize,
    });

    await ctx.db.patch(msg.sessionId, { updatedAt: Date.now() });
    return { sessionId: msg.sessionId };
  },
});

export const deleteMessage = mutation({
  args: { messageId: v.id("chatMessages") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Not signed in.");

    const msg = await ctx.db.get(args.messageId);
    if (!msg || msg.userId !== userId) throw new Error("Message not found.");

    await ctx.db.delete(args.messageId);
  },
});

// ---------------------------------------------------------------------------
// Search sessions and messages
// ---------------------------------------------------------------------------

export const searchSessions = query({
  args: { query: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];

    const q = args.query.toLowerCase().trim();
    if (!q) return [];

    // Search session titles
    const sessions = await ctx.db
      .query("chatSessions")
      .withIndex("by_user", (qb) => qb.eq("userId", userId))
      .collect();

    const matchedSessions = sessions
      .filter((s) => s.title.toLowerCase().includes(q))
      .slice(0, 10)
      .map((s) => ({ type: "session" as const, id: s._id, title: s.title, updatedAt: s.updatedAt }));

    // Search message content
    const allMessages: { type: "message"; sessionId: Id<"chatSessions">; content: string; role: string; createdAt: number }[] = [];
    for (const session of sessions) {
      const msgs = await ctx.db
        .query("chatMessages")
        .withIndex("by_session", (qb) => qb.eq("sessionId", session._id))
        .collect();
      for (const m of msgs) {
        if (m.content.toLowerCase().includes(q)) {
          allMessages.push({
            type: "message",
            sessionId: session._id,
            content: m.content.slice(0, 200),
            role: m.role,
            createdAt: m.createdAt,
          });
        }
      }
    }

    const matchedMessages = allMessages
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10);

    return { sessions: matchedSessions, messages: matchedMessages };
  },
});
