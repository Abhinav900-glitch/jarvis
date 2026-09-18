// Puter.js integration — free, keyless AI image generation in the browser.
// https://docs.puter.com/AI/txt2img — the script is loaded lazily from
// js.puter.com/v2/ and generation runs under Puter's "User Pays" model
// (the end user's free Puter allowance covers it; first use may show a
// Puter sign-in popup). Generated images are returned as blobs so the app
// can store them on Cloudinary like every other provider's output.

interface PuterAi {
  txt2img: (
    prompt: string,
    testMode?: boolean,
  ) => Promise<Blob | HTMLImageElement | string>;
}

interface PuterGlobal {
  ai: PuterAi;
}

let puterPromise: Promise<PuterGlobal | null> | null = null;

function loadPuter(): Promise<PuterGlobal | null> {
  if (puterPromise) return puterPromise;
  puterPromise = new Promise((resolve) => {
    if (typeof window === "undefined") {
      resolve(null);
      return;
    }
    const w = window as unknown as { puter?: PuterGlobal };
    if (w.puter?.ai) {
      resolve(w.puter);
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.async = true;
    script.onload = () => {
      resolve((window as unknown as { puter?: PuterGlobal }).puter ?? null);
    };
    script.onerror = () => {
      puterPromise = null;
      resolve(null);
    };
    document.head.appendChild(script);
  });
  return puterPromise;
}

async function toBlob(el: Blob | HTMLImageElement | string): Promise<Blob> {
  if (el instanceof Blob) return el;
  const src =
    typeof el === "string"
      ? el
      : el instanceof HTMLImageElement
        ? el.src
        : null;
  if (!src) throw new Error("Puter returned an unexpected image format.");
  const res = await fetch(src);
  if (!res.ok) {
    throw new Error(`Could not fetch the generated image (${res.status}).`);
  }
  return res.blob();
}

/**
 * Generate an image with Puter.js and store it via the provided uploader
 * (the app's signed Cloudinary upload). Throws on any failure so callers
 * can fall back to the server-side provider chain.
 */
export async function generateImageWithPuter(
  prompt: string,
  upload: (
    file: File,
  ) => Promise<{ url: string; publicId: string } | null>,
): Promise<{ url: string; publicId: string; provider: string }> {
  const puter = await loadPuter();
  if (!puter?.ai?.txt2img) {
    throw new Error("Puter.js is unavailable in this browser.");
  }
  const raw = await puter.ai.txt2img(prompt);
  const blob = await toBlob(raw);
  const file = new File([blob], `jarvis-puter-${Date.now()}.png`, {
    type: blob.type || "image/png",
  });
  const stored = await upload(file);
  if (!stored) throw new Error("Could not store the generated image.");
  return { ...stored, provider: "puter" };
}
