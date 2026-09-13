"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v2 as cloudinary } from "cloudinary";

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
 */
async function uploadBytesToCloudinary(
  bytes: ArrayBuffer,
  publicId: string,
): Promise<{ url: string; publicId: string }> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = cloudinary.utils.api_sign_request(
    { timestamp, public_id: publicId },
    apiSecret,
  );

  const form = new FormData();
  form.append("file", new Blob([bytes], { type: "image/png" }), "generated.png");
  form.append("api_key", apiKey);
  form.append("timestamp", String(timestamp));
  form.append("signature", signature);
  form.append("public_id", publicId);

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
    { method: "POST", body: form },
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
 */
async function generateViaCloudinary(
  prompt: string,
  model?: string,
  aspectRatio?: string,
): Promise<GeneratedImage> {
  const { cloudName, apiKey, apiSecret } = cloudinaryConfig();

  const body: Record<string, unknown> = { prompt };
  if (model && model !== "default") body.model = model;
  if (aspectRatio) body.aspect_ratio = aspectRatio;

  const res = await fetch(
    `https://api.cloudinary.com/v2/generate/${cloudName}/text_to_image`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${apiKey}:${apiSecret}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
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
 * Returns raw PNG bytes, which we then store on Cloudinary.
 */
async function generateViaHuggingFace(
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
    // HF sometimes returns JSON errors with 200; check the body type.
    throw new Error("Hugging Face returned a non-image response.");
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error("Hugging Face returned an empty image.");
  }

  const publicId = `jarvis-gen/hf-${Date.now()}`;
  const stored = await uploadBytesToCloudinary(bytes, publicId);
  return { url: stored.url, publicId: stored.publicId, provider: "huggingface" };
}

/**
 * Provider 3 — Pollinations AI (free, no key required). Final fallback.
 * Returns a JPEG, which we store on Cloudinary.
 */
async function generateViaPollinations(
  prompt: string,
): Promise<GeneratedImage> {
  const encoded = encodeURIComponent(prompt.slice(0, 800));
  const url = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&nologo=true&model=flux`;

  const res = await fetch(url, {
    headers: { Accept: "image/jpeg" },
  });
  if (!res.ok) {
    console.error("Pollinations image error", res.status);
    throw new Error(`Pollinations generation failed (${res.status})`);
  }

  const bytes = await res.arrayBuffer();
  if (bytes.byteLength < 1000) {
    throw new Error("Pollinations returned an empty image.");
  }

  const publicId = `jarvis-gen/poll-${Date.now()}`;
  const stored = await uploadBytesToCloudinary(bytes, publicId);
  return { url: stored.url, publicId: stored.publicId, provider: "pollinations" };
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
 *
 * HF and Pollinations outputs are stored on Cloudinary so every image gets
 * a persistent CDN URL.
 */
export const generateImage = action({
  args: {
    prompt: v.string(),
    // Optional Cloudinary add-on model hint (ignored by fallback providers).
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
          generateViaCloudinary(prompt, args.model, args.aspectRatio),
      },
      {
        name: "huggingface",
        run: () => generateViaHuggingFace(prompt),
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
