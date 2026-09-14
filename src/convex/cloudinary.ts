"use node";

import { v } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v2 as cloudinary } from "cloudinary";
import { internal as internalApi } from "./_generated/api";

// ---------------------------------------------------------------------------
// Cloudinary OAuth 2.0 (authorization code grant)
// Docs: https://cloudinary.com/documentation/using_oauth_to_access_cloudinary_apis
// Env: CLOUDINARY_CLIENT_ID, CLOUDINARY_CLIENT_SECRET
// Access tokens live ~5 minutes; refresh tokens (3 months, single-use) keep
// the connection alive — handled transparently by getFreshAccessToken().
// ---------------------------------------------------------------------------

const OAUTH_AUTHORIZE_URL = "https://oauth.cloudinary.com/oauth2/auth";
const OAUTH_TOKEN_URL = "https://oauth.cloudinary.com/oauth2/token";
const OAUTH_SCOPES = "upload asset_management offline_access";

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function oauthConfig(): { clientId: string; clientSecret: string } | null {
  const clientId = process.env.CLOUDINARY_CLIENT_ID;
  const clientSecret = process.env.CLOUDINARY_CLIENT_SECRET;
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret };
}

/** Build the consent-page URL the user must visit to grant access. */
export const getOAuthStartUrl = action({
  args: { redirectUri: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const cfg = oauthConfig();
    if (!cfg) {
      throw new Error(
        "Cloudinary OAuth app not configured — add CLOUDINARY_CLIENT_ID and CLOUDINARY_CLIENT_SECRET in the Keys tab.",
      );
    }

    const state =
      crypto.randomUUID().replace(/-/g, "") +
      crypto.randomUUID().replace(/-/g, "");
    await ctx.runMutation(internalApi.cloudinaryOAuth.setPendingState, {
      userId,
      state,
      redirectUri: args.redirectUri,
    });

    const url = new URL(OAUTH_AUTHORIZE_URL);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", args.redirectUri);
    url.searchParams.set("scope", OAUTH_SCOPES);
    url.searchParams.set("state", state);

    return { url: url.toString() };
  },
});

/** Exchange the authorization code from the callback for tokens and store them. */
export const exchangeCode = action({
  args: {
    code: v.string(),
    state: v.string(),
    redirectUri: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");

    const cfg = oauthConfig();
    if (!cfg) throw new Error("Cloudinary OAuth app not configured.");

    // Validate state against what we stored at flow start (CSRF protection)
    const stored = await ctx.runQuery(
      internalApi.cloudinaryOAuth.getStoredAuth,
      { userId },
    );
    if (!stored || stored.pendingState !== args.state) {
      throw new Error("OAuth state mismatch — restart the connection flow.");
    }

    const redirectUri = stored.redirectUri ?? args.redirectUri;
    if (!redirectUri) {
      throw new Error("Missing redirect URI — restart the connection flow.");
    }

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: args.code,
      redirect_uri: redirectUri,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });

    const res = await fetch(OAUTH_TOKEN_URL, { method: "POST", body });
    const data = (await res.json()) as TokenResponse;
    if (!res.ok || !data.access_token) {
      console.error("Cloudinary token exchange failed", res.status, data);
      throw new Error(
        `Token exchange failed (${res.status})${
          data.error_description ? `: ${data.error_description}` : ""
        }`,
      );
    }

    await ctx.runMutation(internalApi.cloudinaryOAuth.saveTokens, {
      userId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresIn: data.expires_in,
      scope: data.scope,
    });

    return { ok: true as const };
  },
});

/** User-initiated disconnect. */
export const disconnectCloudinary = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    await ctx.runMutation(internalApi.cloudinaryOAuth.disconnect, { userId });
    return { ok: true as const };
  },
});

/**
 * Get a valid OAuth access token for the signed-in user, auto-refreshing when
 * expired. Returns null when there is no OAuth connection (callers fall back
 * to API key/secret auth).
 */
export async function getFreshAccessToken(
  ctx: ActionCtx,
): Promise<string | null> {
  try {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;

    const row = await ctx.runQuery(internalApi.cloudinaryOAuth.getStoredAuth, {
      userId,
    });
    if (!row?.accessToken) return null;

    // Refresh 30s before expiry to be safe
    if (row.expiresAt && row.expiresAt - 30_000 > Date.now()) {
      return row.accessToken;
    }
    if (!row.refreshToken) return null;

    const cfg = oauthConfig();
    if (!cfg) return null;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: row.refreshToken,
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
    });
    const res = await fetch(OAUTH_TOKEN_URL, { method: "POST", body });
    const data = (await res.json()) as TokenResponse;

    if (res.ok && data.access_token) {
      await ctx.runMutation(internalApi.cloudinaryOAuth.saveTokens, {
        userId,
        accessToken: data.access_token,
        // Refresh tokens are single-use — Cloudinary issues a new one here
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scope: data.scope,
      });
      return data.access_token;
    }

    if (data.error === "invalid_grant") {
      // Refresh token revoked/expired → force reconnect
      await ctx.runMutation(internalApi.cloudinaryOAuth.clearTokens, { userId });
    }
    return null;
  } catch (err) {
    console.error("[cloudinary-oauth] token refresh failed:", err);
    return null; // any failure → fall back to API key/secret
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function cloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary credentials not configured.");
  }
  return { cloudName, apiKey, apiSecret };
}

/**
 * Store generated image bytes on Cloudinary so they persist on the CDN
 * regardless of which provider generated them.
 * Uses the OAuth access token when the user has connected Cloudinary,
 * otherwise falls back to signed API key/secret auth.
 */
async function uploadBytesToCloudinary(
  ctx: ActionCtx,
  bytes: ArrayBuffer,
  publicId: string,
): Promise<{ url: string; publicId: string }> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const oauthToken = await getFreshAccessToken(ctx);
  const timestamp = Math.floor(Date.now() / 1000);

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), "generated.png");
  form.append("timestamp", String(timestamp));
  form.append("public_id", publicId);

  const headers: Record<string, string> = {};
  if (oauthToken) {
    headers["Authorization"] = `Bearer ${oauthToken}`;
  } else {
    const signature = cloudinary.utils.api_sign_request(
      { timestamp, public_id: publicId },
      apiSecret,
    );
    form.append("api_key", apiKey);
    form.append("signature", signature);
  }

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", headers, body: form },
  );
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Cloudinary byte upload failed", res.status, errText);
    throw new Error(`Cloudinary upload failed (${res.status})`);
  }
  const data = (await res.json()) as { secure_url: string; public_id: string };
  return { url: data.secure_url, publicId: data.public_id };
}

// ---------------------------------------------------------------------------
// Image generation providers
// ---------------------------------------------------------------------------

interface GeneratedImage {
  url: string;
  publicId: string;
  provider: string;
}

/**
 * Provider 1 — Cloudinary Image Generation add-on.
 * Returns a URL directly; the asset already lives on Cloudinary.
 * Uses OAuth Bearer auth when connected, else API key/secret Basic auth.
 */
async function generateViaCloudinary(
  ctx: ActionCtx,
  prompt: string,
  model?: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const oauthToken = await getFreshAccessToken(ctx);

  const body: Record<string, unknown> = { prompt };
  if (model && model !== "default") body.model = model;
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (oauthToken) {
    headers["Authorization"] = `Bearer ${oauthToken}`;
  } else {
    headers["Authorization"] = `Basic ${Buffer.from(
      `${apiKey}:${apiSecret}`,
    ).toString("base64")}`;
  }

  const res = await fetch(
    `https://api.cloudinary.com/v2/generate/${cloudName}/text_to_image`,
    {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Cloudinary image generation error", res.status, errText);
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Cloudinary Image Generation add-on is not enabled on this account.",
      );
    }
    if (res.status === 402) {
      throw new Error("Cloudinary image generation quota exhausted.");
    }
    throw new Error(`Cloudinary generation failed (${res.status})`);
  }

  const data = (await res.json()) as {
    public_id?: string;
    secure_url?: string;
    url?: string;
    output?: { public_id?: string; secure_url?: string; url?: string };
    resources?: { public_id?: string; secure_url?: string }[];
  };

  const publicId =
    data.public_id ?? data.output?.public_id ?? data.resources?.[0]?.public_id;
  const directUrl =
    data.secure_url ?? data.url ?? data.output?.secure_url ?? data.output?.url;
  if (!publicId && !directUrl) {
    throw new Error("Cloudinary generation returned no image.");
  }

  return {
    url: directUrl ?? `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`,
    publicId: publicId ?? "",
    provider: "cloudinary",
  };
}

/**
 * Provider 2 — Hugging Face Inference API (FLUX.1-schnell, non-gated).
 * Returns raw PNG bytes, which we store on Cloudinary for a persistent URL.
 */
async function generateViaHuggingFace(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const token = process.env.HUGGING_FACE_TOKEN;
  if (!token) {
    throw new Error("HUGGING_FACE_TOKEN is not configured.");
  }

  const model = "black-forest-labs/FLUX.1-schnell";
  const res = await fetch(
    `https://api-inference.huggingface.co/models/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: { num_inference_steps: 4, guidance_scale: 0.0 },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Hugging Face image error", res.status, errText.slice(0, 300));
    throw new Error(`Hugging Face generation failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error("Hugging Face returned a non-image response.");
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error("Hugging Face returned an empty image.");
  }

  const publicId = `jarvis-gen/hf-${Date.now()}`;
  try {
    const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
    return { url: stored.url, publicId: stored.publicId, provider: "huggingface" };
  } catch {
    // If Cloudinary upload fails, return a data URL so the client can still display it
    const base64 = Buffer.from(bytes).toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;
    return { url: dataUrl, publicId, provider: "huggingface" };
  }
}

/**
 * Provider 3 — Pollinations AI (free, no key required). Final fallback.
 * Returns a direct URL — Pollinations serves images publicly, no need to re-upload.
 */
async function generateViaPollinations(
  prompt: string,
): Promise<GeneratedImage> {
  const encoded = encodeURIComponent(prompt.slice(0, 800));
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&model=flux&seed=${Date.now()}`;

  // Verify the URL actually returns an image (HEAD check)
  const check = await fetch(pollinationsUrl, { method: "HEAD" }).catch(() => null);
  if (!check || !check.ok) {
    throw new Error(`Pollinations generation failed (${check?.status ?? "network error"})`);
  }

  // Use the Pollinations URL directly — it's a public CDN
  return {
    url: pollinationsUrl,
    publicId: `jarvis-gen/poll-${Date.now()}`,
    provider: "pollinations",
  };
}

/**
 * Generate a signed upload payload so the client can upload any file type
 * (images, PDFs, docs...) directly to Cloudinary without exposing the secret.
 */
export const getSignedUploadUrl = action({
  args: {
    folder: v.optional(v.string()),
    filename: v.optional(v.string()),
  },
  handler: async (_ctx, args) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error("Cloudinary credentials not configured.");
    }

    const timestamp = Math.floor(Date.now() / 1000);
    const folder = args.folder ?? "jarvis-chat";
    const publicId = args.filename
      ? `${folder}/${args.filename.replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 60)}-${timestamp}`
      : `${folder}/${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

    const paramsToSign: Record<string, string | number> = {
      timestamp,
      folder,
      public_id: publicId,
    };

    const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret);

    return {
      url: `https://api.cloudinary.com/v1_1/${cloudName}/auto/upload`,
      cloudName,
      apiKey,
      timestamp,
      signature,
      folder,
      publicId,
    };
  },
});

/**
 * Text-to-image generation with automatic provider fallback:
 *   1. Cloudinary Image Generation add-on (best quality, needs add-on)
 *   2. Hugging Face Inference API (FLUX.1-schnell — uses HUGGING_FACE_TOKEN)
 *   3. Pollinations AI (free, no key needed — always-available last resort)
 */
export const generateImage = action({
  args: {
    prompt: v.string(),
    model: v.optional(
      v.union(
        v.literal("default"),
        v.literal("flux"),
        v.literal("gpt-image-1"),
        v.literal("ideogram"),
        v.literal("recraft-20"),
        v.literal("recraft-20b"),
        v.literal("sd15"),
        v.literal("sdxl"),
        v.literal("nano-banana"),
      ),
    ),
    aspectRatio: v.optional(
      v.union(v.literal("1:1"), v.literal("3:2"), v.literal("2:3")),
    ),
  },
  handler: async (
    ctx,
    args,
  ): Promise<{ url: string; publicId: string; provider: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to generate images.");

    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Image prompt is empty.");
    if (prompt.length > 1000) {
      throw new Error(
        "Image prompt too long — keep it under 1000 characters.",
      );
    }

    const attempts: { name: string; run: () => Promise<GeneratedImage> }[] = [
      {
        name: "cloudinary",
        run: () =>
          generateViaCloudinary(ctx, prompt, args.model, args.aspectRatio),
      },
      {
        name: "huggingface",
        run: () => generateViaHuggingFace(ctx, prompt),
      },
      {
        name: "pollinations",
        run: () => generateViaPollinations(prompt),
      },
    ];

    const errors: string[] = [];
    for (const attempt of attempts) {
      try {
        const result = await attempt.run();
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[image-gen] ${attempt.name} failed: ${msg}`);
        errors.push(`${attempt.name}: ${msg}`);
      }
    }

    throw new Error(`All image providers failed. ${errors.join(" | ")}`);
  },
});

/**
 * Build an optimized delivery URL for a stored Cloudinary asset.
 */
export const getOptimizedUrl = action({
  args: {
    publicId: v.string(),
    width: v.optional(v.number()),
    height: v.optional(v.number()),
  },
  handler: async (_ctx, args) => {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    if (!cloudName) throw new Error("CLOUDINARY_CLOUD_NAME not configured.");

    const parts = [`https://res.cloudinary.com/${cloudName}/image/upload`];

    const transforms: string[] = [];
    if (args.width) transforms.push(`w_${args.width}`);
    if (args.height) transforms.push(`h_${args.height}`);
    transforms.push("f_auto", "q_auto");

    parts.push(transforms.join(","));
    parts.push(args.publicId);

    return { url: parts.join("/") };
  },
});
