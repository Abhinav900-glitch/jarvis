"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v2 as cloudinary } from "cloudinary";

/**
 * Generate a signed upload URL for Cloudinary so the client can upload
 * directly without exposing the API secret.
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
      ? `${folder}/${args.filename.replace(/\.[^.]+$/, "")}-${timestamp}`
      : `${folder}/${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

    // Build the params to sign
    const paramsToSign: Record<string, string | number> = {
      timestamp,
      folder,
      public_id: publicId,
      upload_preset: "jarvis_unsigned",
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
 * Confirm a completed upload and return the final URL.
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

    // Build a transformation URL for optimized delivery
    const parts = [
      `https://res.cloudinary.com/${cloudName}/image/upload`,
    ];

    const transforms: string[] = [];
    if (args.width) transforms.push(`w_${args.width}`);
    if (args.height) transforms.push(`h_${args.height}`);
    transforms.push("f_auto", "q_auto");

    if (transforms.length > 0) {
      parts.push(transforms.join(","));
    }

    parts.push(args.publicId);

    return { url: parts.join("/") };
  },
});
