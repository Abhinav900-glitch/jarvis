"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v2 as cloudinary } from "cloudinary";

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
 * Text-to-image generation via the Cloudinary Image Generation add-on.
 * Requires the add-on to be enabled on the Cloudinary account.
 * Docs: https://cloudinary.com/documentation/image_generation_addon
 */
export const generateImage = action({
  args: {
    prompt: v.string(),
    // Cloudinary-supported model families. Defaults to a stable one.
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
  handler: async (ctx, args): Promise<{ url: string; publicId: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to generate images.");

    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error("Cloudinary credentials not configured.");
    }

    const prompt = args.prompt.trim();
    if (!prompt) throw new Error("Image prompt is empty.");
    if (prompt.length > 1000) {
      throw new Error("Image prompt too long — keep it under 1000 characters.");
    }

    const body: Record<string, unknown> = { prompt };
    if (args.model && args.model !== "default") body.model = args.model;
    if (args.aspectRatio) body.aspect_ratio = args.aspectRatio;

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
          "Image generation requires the Cloudinary Image Generation add-on. Enable it in the Cloudinary console (Add-ons), then try again.",
        );
      }
      if (res.status === 402) {
        throw new Error(
          "Image generation quota exhausted on your Cloudinary plan.",
        );
      }
      throw new Error(
        `Image generation failed (${res.status}): ${errText.slice(0, 200)}`,
      );
    }

    const data = (await res.json()) as {
      // Response shapes vary by model; both give a public id or a direct URL.
      public_id?: string;
      secure_url?: string;
      url?: string;
      asset_id?: string;
      output?: { public_id?: string; secure_url?: string; url?: string };
      resources?: { public_id?: string; secure_url?: string }[];
    };

    const publicId =
      data.public_id ??
      data.output?.public_id ??
      data.resources?.[0]?.public_id;
    const directUrl =
      data.secure_url ?? data.url ?? data.output?.secure_url ?? data.output?.url;

    if (!publicId && !directUrl) {
      throw new Error("Image generation returned no image.");
    }

    // Prefer the canonical delivery URL built from the public id.
    const url = directUrl ?? `https://res.cloudinary.com/${cloudName}/image/upload/${publicId}`;

    return { url, publicId: publicId ?? "" };
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
