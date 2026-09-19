// Client-side Perchance AI image generation, proxied through corsproxy.io.
//
// Why client-side: corsproxy.io's free tier only serves requests from real
// browsers (it fingerprints for browser signals; server-side calls get
// {"error":"Free usage is limited to browser requests"}). The user's own
// browser is a real browser, so the app calls corsproxy from the client and
// corsproxy's edge IPs pass Perchance's Cloudflare challenge.
//
// Requires (Keys tab):
//  - CORSPROXY_API_KEY — your corsproxy.io API key
//  - PERCHANCE_USER_KEY — a VERIFIED 64-hex userKey from perchance.org:
//    open perchance.org/ai-text-to-image-generator, generate an image
//    there, then in DevTools → Network → api/generate copy the userKey
//    query param. Refresh it in the Keys tab when it expires.
//
// Generated images are stored on Cloudinary through the app's signed
// upload path so they persist in chat history like every other provider.

export interface PerchanceKeys {
  corsproxyKey: string;
  perchanceKey: string;
}

export interface PerchanceResult {
  url: string;
  publicId: string;
  provider: string;
}

type UploadFn = (
  file: File,
) => Promise<{ url: string; publicId: string } | null>;

function proxiedUrl(
  keys: PerchanceKeys,
  target: string,
): string {
  return `https://corsproxy.io/?key=${encodeURIComponent(keys.corsproxyKey)}&url=${encodeURIComponent(target)}`;
}

async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Generate an image with Perchance from the browser.
 * Throws with a helpful message on any failure so callers can fall back
 * to the server-side provider chain.
 */
export async function generateImageWithPerchance(
  prompt: string,
  keys: PerchanceKeys,
  upload: UploadFn,
): Promise<PerchanceResult> {
  if (!keys.corsproxyKey) {
    throw new Error("CORSPROXY_API_KEY is not configured.");
  }
  if (!keys.perchanceKey || !/^[a-f0-9]{64}$/.test(keys.perchanceKey)) {
    throw new Error(
      "PERCHANCE_USER_KEY is missing or invalid — it must be the 64-hex userKey copied from perchance.org (DevTools → Network → api/generate).",
    );
  }

  const params =
    `prompt=${encodeURIComponent(`'${prompt.slice(0, 500)}`)}` +
    `&negativePrompt=${encodeURIComponent("'ugly, blurry, low quality, deformed")}` +
    `&userKey=${keys.perchanceKey}` +
    `&__cache_bust=${Math.random()}` +
    `&seed=-1` +
    `&resolution=512x512&guidanceScale=7` +
    `&channel=ai-text-to-image-generator&subChannel=public` +
    `&requestId=${Math.random()}`;
  const genUrl = `https://image-generation.perchance.org/api/generate?${params}`;

  const genRes = await fetchWithTimeout(proxiedUrl(keys, genUrl), 35_000);
  if (!genRes.ok) {
    throw new Error(`Perchance generation failed (${genRes.status}).`);
  }
  const raw = await genRes.text();
  if (raw.trimStart().startsWith("<")) {
    throw new Error(
      "Perchance is still bot-blocked — check the corsproxy key/quota.",
    );
  }
  let gen: { imageId?: string; status?: string };
  try {
    gen = JSON.parse(raw) as { imageId?: string; status?: string };
  } catch {
    throw new Error("Perchance returned a non-JSON response.");
  }
  if (gen.status === "invalid_key" || (!gen.imageId && gen.status)) {
    throw new Error(
      `Perchance rejected the key (${gen.status ?? "unknown"}) — refresh PERCHANCE_USER_KEY from perchance.org.`,
    );
  }
  if (!gen.imageId) {
    throw new Error("Perchance returned no image id (may be rate-limited).");
  }

  const dlUrl = `https://image-generation.perchance.org/api/downloadTemporaryImage?imageId=${encodeURIComponent(gen.imageId)}`;
  const dlRes = await fetchWithTimeout(proxiedUrl(keys, dlUrl), 25_000);
  const ct = dlRes.headers.get("content-type") ?? "";
  if (!dlRes.ok || !ct.startsWith("image/")) {
    throw new Error(`Perchance download failed (${dlRes.status}).`);
  }
  const blob = await dlRes.blob();
  if (blob.size < 1000) {
    throw new Error("Perchance returned an empty image.");
  }

  const file = new File([blob], `jarvis-perchance-${Date.now()}.png`, {
    type: blob.type || "image/png",
  });
  const stored = await upload(file);
  if (!stored) throw new Error("Could not store the generated image.");
  return { ...stored, provider: "perchance" };
}
