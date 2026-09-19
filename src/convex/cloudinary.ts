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
 * Provider 2 — Hugging Face Inference API.
 * Primary model: stabilityai/sdxl-turbo (1-step distilled SDXL — the serverless
 * equivalent of diffusers' DiffusionPipeline("stabilityai/sdxl-turbo")).
 * Fallback model: black-forest-labs/FLUX.1-schnell (4-step).
 * Returns raw image bytes, stored on Cloudinary for a persistent URL.
 */
async function hfImageRequest(
  token: string,
  model: string,
  prompt: string,
  steps: number,
  guidance: number,
): Promise<ArrayBuffer> {
  // api-inference.huggingface.co is retired — Inference API lives on the
  // router host now. NOTE (verified live): HF has deprecated/not-served every
  // text-to-image model for this token, so this step fails in ~1s today and
  // Pollinations takes over. It stays in the chain (fast-fail, 12s cap) so it
  // auto-heals if an inference provider is ever enabled on the HF account.
  const res = await fetch(
    `https://router.huggingface.co/hf-inference/models/${model}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "image/png",
      },
      body: JSON.stringify({
        inputs: prompt,
        parameters: {
          num_inference_steps: steps,
          guidance_scale: guidance,
        },
      }),
      signal: AbortSignal.timeout(12_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error(`HF image error [${model}]`, res.status, errText.slice(0, 300));
    throw new Error(`${model} failed (${res.status})`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.startsWith("image/")) {
    throw new Error(`${model} returned a non-image response.`);
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error(`${model} returned an empty image.`);
  }
  return bytes;
}

async function generateViaHuggingFace(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const token = process.env.HUGGING_FACE_TOKEN;
  if (!token) {
    throw new Error("HUGGING_FACE_TOKEN is not configured.");
  }

  // Single attempt: SDXL-Turbo 1-step. HF currently has no served
  // text-to-image models on this token, so extra attempts only burn the
  // chain's time budget — this stays as a fast-fail, auto-healing step.
  const attempts: { model: string; steps: number; guidance: number }[] = [
    { model: "stabilityai/sdxl-turbo", steps: 1, guidance: 0.0 },
  ];

  const failures: string[] = [];
  for (const a of attempts) {
    try {
      const bytes = await hfImageRequest(
        token,
        a.model,
        prompt,
        a.steps,
        a.guidance,
      );
      const publicId = `jarvis-gen/hf-${Date.now()}`;
      try {
        const stored = await uploadBytesToCloudinary(ctx, bytes, publicId);
        return {
          url: stored.url,
          publicId: stored.publicId,
          provider: `hf/${a.model.split("/")[1]}`,
        };
      } catch {
        // Cloudinary upload failed — data URL so the client still shows the image
        const base64 = Buffer.from(bytes).toString("base64");
        const dataUrl = `data:image/png;base64,${base64}`;
        return { url: dataUrl, publicId, provider: `hf/${a.model.split("/")[1]}` };
      }
    } catch (err) {
      failures.push(err instanceof Error ? err.message : "failed");
    }
  }

  throw new Error(`Hugging Face failed: ${failures.join(" | ")}`);
}

/**
 * Provider 3 — Replicate (uses REPLICATE_API_TOKEN).
 * Calls the official black-forest-labs/flux-schnell model synchronously via
 * the `Prefer: wait` header (no version hash needed with the models
 * endpoint), downloads the generated image and stores it on Cloudinary.
 */
async function generateViaReplicate(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) {
    throw new Error("REPLICATE_API_TOKEN is not configured.");
  }

  const res = await fetch(
    "https://api.replicate.com/v1/models/black-forest-labs/flux-schnell/predictions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        // Blocks until the prediction finishes (bounded by the model's own
        // timeout) so no polling loop is needed.
        Prefer: "wait",
      },
      body: JSON.stringify({
        input: {
          prompt: prompt.slice(0, 950),
          aspect_ratio: "1:1",
          output_format: "png",
        },
      }),
      signal: AbortSignal.timeout(55_000),
    },
  );

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    console.error("Replicate error", res.status, errText.slice(0, 300));
    throw new Error(`Replicate failed (${res.status})`);
  }

  const data = (await res.json()) as {
    status?: string;
    output?: string[] | string;
    error?: string;
  };
  const outputUrl = Array.isArray(data.output) ? data.output[0] : data.output;
  if (!outputUrl) {
    throw new Error(
      `Replicate returned no image (status: ${data.status ?? "unknown"}${data.error ? `, ${data.error}` : ""})`,
    );
  }

  const imgRes = await fetch(outputUrl, {
    signal: AbortSignal.timeout(20_000),
  });
  if (!imgRes.ok) {
    throw new Error(`Replicate image download failed (${imgRes.status}).`);
  }
  const bytes = await imgRes.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error("Replicate returned an empty image.");
  }

  try {
    const stored = await uploadBytesToCloudinary(
      ctx,
      bytes,
      `jarvis-gen/rep-${Date.now()}`,
    );
    return { url: stored.url, publicId: stored.publicId, provider: "replicate" };
  } catch {
    // Cloudinary upload failed — serve straight from Replicate's CDN
    return {
      url: outputUrl,
      publicId: `jarvis-gen/rep-${Date.now()}`,
      provider: "replicate",
    };
  }
}

/**
 * Provider 4 — Perchance AI image generation (free, no key).
 * Unofficial endpoint: request a generation with an arbitrary userKey, then
 * download the temporary image and store it on Cloudinary. Perchance can be
 * slow or block server IPs, so it fails fast into Pollinations.
 */
/**
 * Fetch through corsproxy.io (edge network with rotating clean IPs that
 * passes Perchance's Cloudflare challenge). Needs CORSPROXY_API_KEY.
 */
async function proxiedFetch(url: string, timeoutMs: number): Promise<Response> {
  const proxyKey = process.env.CORSPROXY_API_KEY;
  if (!proxyKey) {
    throw new Error(
      "CORSPROXY_API_KEY is not configured — add it in the Keys tab to enable Perchance through the proxy.",
    );
  }
  return fetch(
    `https://corsproxy.io/?key=${encodeURIComponent(proxyKey)}&url=${encodeURIComponent(url)}`,
    { headers: { Accept: "application/json, image/*" }, signal: AbortSignal.timeout(timeoutMs) },
  );
}

/**
 * Provider 1 — Perchance AI image generation (free, no API cost).
 * Two prerequisites (added in the Keys tab):
 *   - CORSPROXY_API_KEY: routes through corsproxy.io so Cloudflare doesn't
 *     challenge the request (server IPs alone get "Just a moment...").
 *   - PERCHANCE_USER_KEY: a VERIFIED 64-hex userKey. Perchance only accepts
 *     keys activated by its in-page verification in a real browser on
 *     perchance.org — grab one from the network tab while generating an
 *     image there (userKey=... in the api/generate request). Keys stay
 *     valid for a while; if it expires, grab a fresh one.
 */
async function generateViaPerchance(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const userKey = process.env.PERCHANCE_USER_KEY;
  if (!userKey || !/^[a-f0-9]{64}$/.test(userKey)) {
    throw new Error(
      "PERCHANCE_USER_KEY is not configured or not a 64-char hex key — copy it from perchance.org while generating an image there (api/generate?userKey=...).",
    );
  }

  const params =
    `prompt=${encodeURIComponent(`'${prompt.slice(0, 500)}`)}` +
    `&negativePrompt=${encodeURIComponent("'ugly, blurry, low quality, deformed")}` +
    `&userKey=${userKey}` +
    `&__cache_bust=${Math.random()}` +
    `&seed=-1` +
    `&resolution=512x512&guidanceScale=7` +
    `&channel=ai-text-to-image-generator&subChannel=public` +
    `&requestId=${Math.random()}`;
  const genUrl = `https://image-generation.perchance.org/api/generate?${params}`;

  // 25s cap — generation can take a while on Perchance's queue, but fail
  // fast enough that the fallback chain still has budget.
  const genRes = await proxiedFetch(genUrl, 25_000);
  if (!genRes.ok) {
    throw new Error(`Perchance generation failed (${genRes.status})`);
  }
  const rawBody = await genRes.text();
  if (rawBody.trimStart().startsWith("<")) {
    throw new Error(
      "Perchance returned a Cloudflare challenge — check the corsproxy key/quota.",
    );
  }
  let gen: { imageId?: string; status?: string };
  try {
    gen = JSON.parse(rawBody) as { imageId?: string; status?: string };
  } catch {
    throw new Error("Perchance returned a non-JSON response.");
  }
  if (gen.status === "invalid_key" || (!gen.imageId && gen.status)) {
    throw new Error(
      `Perchance rejected the key (${gen.status ?? "unknown"}) — the PERCHANCE_USER_KEY expired; grab a fresh one from perchance.org.`,
    );
  }
  if (!gen.imageId) {
    throw new Error("Perchance returned no image id (may be rate-limited).");
  }

  const imgRes = await proxiedFetch(
    `https://image-generation.perchance.org/api/downloadTemporaryImage?imageId=${encodeURIComponent(gen.imageId)}`,
    20_000,
  );
  const ct = imgRes.headers.get("content-type") ?? "";
  if (!imgRes.ok || !ct.startsWith("image/")) {
    throw new Error(`Perchance download failed (${imgRes.status}).`);
  }
  const bytes = await imgRes.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error("Perchance returned an empty image.");
  }

  try {
    const stored = await uploadBytesToCloudinary(
      ctx,
      bytes,
      `jarvis-gen/per-${Date.now()}`,
    );
    return { url: stored.url, publicId: stored.publicId, provider: "perchance" };
  } catch {
    // Cloudinary upload failed — data URL so the client still shows the image
    const base64 = Buffer.from(bytes).toString("base64");
    return {
      url: `data:image/png;base64,${base64}`,
      publicId: `jarvis-gen/per-${Date.now()}`,
      provider: "perchance",
    };
  }
}

/**
 * Provider 5 — Pollinations AI (free, no key required). Final fallback.
 * Strategy: actually DOWNLOAD the image (GET, with retries) so we can store
 * it on Cloudinary for a permanent URL. This is more reliable than returning
 * the pollinations URL directly: their queue can serve 429/504 on the first
 * few requests, and HEAD checks often pass before generation has finished.
 */
async function generateViaPollinations(
  ctx: ActionCtx,
  prompt: string,
): Promise<GeneratedImage> {
  const encoded = encodeURIComponent(prompt.slice(0, 800));
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&model=flux&seed=${Date.now()}`;

  // GET with retries — generation can be slow or briefly rate-limited.
  // Keep total time bounded: Convex actions have a hard time limit, so the
  // whole fallback chain must finish well under it.
  let bytes: ArrayBuffer | null = null;
  let lastStatus: number | string = "network error";
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(pollinationsUrl, {
        signal: AbortSignal.timeout(45_000),
      });
      const ct = res.headers.get("content-type") ?? "";
      if (res.ok && ct.startsWith("image/")) {
        const buf = await res.arrayBuffer();
        if (buf.byteLength > 1000) {
          bytes = buf;
          break;
        }
        lastStatus = "empty image";
      } else {
        lastStatus = res.status;
      }
    } catch (err) {
      lastStatus = err instanceof Error ? err.message : "network error";
    }
    if (attempt < 1) await new Promise((r) => setTimeout(r, 2000));
  }
  if (!bytes) {
    throw new Error(`Pollinations generation failed (${lastStatus})`);
  }

  // Store on Cloudinary for a permanent CDN URL; fall back to the direct URL
  try {
    const stored = await uploadBytesToCloudinary(
      ctx,
      bytes,
      `jarvis-gen/poll-${Date.now()}`,
    );
    return { url: stored.url, publicId: stored.publicId, provider: "pollinations" };
  } catch {
    return {
      url: pollinationsUrl,
      publicId: `jarvis-gen/poll-${Date.now()}`,
      provider: "pollinations",
    };
  }
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
 *   1. Perchance AI (free, no key — PRIMARY; fast-fails if bot-blocked)
 *   2. Pollinations AI (free, no key — verified fast & reliable fallback)
 *   3. Cloudinary Image Generation add-on (needs add-on)
 *   4. Hugging Face Inference API (uses HUGGING_FACE_TOKEN)
 *   5. Replicate (uses REPLICATE_API_TOKEN)
 */

// Circuit breaker: a provider that keeps failing (e.g. Perchance's Cloudflare
// bot-block) shouldn't tax every request with its full timeout. After 3
// consecutive failures the provider is skipped for a cool-down period.
const providerBreakers = new Map<
  string,
  { failures: number; openUntil: number }
>();

function breakerAllows(name: string): boolean {
  const state = providerBreakers.get(name);
  if (!state) return true;
  if (Date.now() >= state.openUntil) {
    providerBreakers.delete(name);
    return true;
  }
  return false;
}

function breakerRecord(name: string, ok: boolean): void {
  if (ok) {
    providerBreakers.delete(name);
    return;
  }
  const state = providerBreakers.get(name) ?? { failures: 0, openUntil: 0 };
  state.failures += 1;
  if (state.failures >= 3) {
    state.openUntil = Date.now() + 10 * 60_000; // 10-minute cool-down
    state.failures = 0;
  }
  providerBreakers.set(name, state);
}
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
        name: "perchance",
        run: () => generateViaPerchance(ctx, prompt),
      },
      {
        // Verified working (fast, keyless) — #2 so the chain almost always
        // produces an image even when Perchance is bot-blocked.
        name: "pollinations",
        run: () => generateViaPollinations(ctx, prompt),
      },
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
        name: "replicate",
        run: () => generateViaReplicate(ctx, prompt),
      },
    ];

    const errors: string[] = [];
    for (const attempt of attempts) {
      if (!breakerAllows(attempt.name)) {
        errors.push(`${attempt.name}: skipped (cooling down after recent failures)`);
        continue;
      }
      try {
        const result = await attempt.run();
        breakerRecord(attempt.name, true);
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[image-gen] ${attempt.name} failed: ${msg}`);
        breakerRecord(attempt.name, false);
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
