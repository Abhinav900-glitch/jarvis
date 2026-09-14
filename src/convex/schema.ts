import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove
    }).index("email", ["email"]), // index for the email. do not remove or modify

    // add other tables here

    // Jarvis AI chat sessions
    chatSessions: defineTable({
      userId: v.id("users"),
      title: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(),
    })
      .index("by_user", ["userId"])
      .index("by_user_updated", ["userId", "updatedAt"]),

    // Jarvis AI chat messages
    chatMessages: defineTable({
      sessionId: v.id("chatSessions"),
      userId: v.id("users"),
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
          v.object({
            title: v.string(),
            url: v.string(),
            domain: v.optional(v.string()),
          }),
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
      createdAt: v.number(),
    }).index("by_session", ["sessionId"]),

    // RAG: embeddings of past chat messages for semantic retrieval.
    // Embeddings use HuggingFace feature-extraction (384-dim all-MiniLM-L6-v2).
    messageEmbeddings: defineTable({
      userId: v.id("users"),
      sessionId: v.id("chatSessions"),
      messageId: v.id("chatMessages"),
      content: v.string(),
      role: v.string(),
      vector: v.array(v.float64()),
      createdAt: v.number(),
    })
      .vectorIndex("by_embedding", {
        vectorField: "vector",
        dimensions: 384,
        filterFields: ["userId"],
      })
      .index("by_user_time", ["userId", "createdAt"]),

    // Saved prompt library (per user)
    prompts: defineTable({
      userId: v.id("users"),
      title: v.string(),
      content: v.string(),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    // Cloudinary OAuth 2.0 connection (one row per user)
    cloudinaryAuth: defineTable({
      userId: v.id("users"),
      accessToken: v.optional(v.string()),
      refreshToken: v.optional(v.string()),
      expiresAt: v.optional(v.number()), // ms epoch
      scope: v.optional(v.string()),
      redirectUri: v.optional(v.string()), // redirect used at flow start (must match at exchange)
      pendingState: v.optional(v.string()), // CSRF state while connecting
      connectedAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    // tableName: defineTable({
    //   ...
    //   // table fields
    // }).index("by_field", ["field"])
  },
  {
    schemaValidation: false,
  },
);

export default schema;
