"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

const ASSEMBLYAI_BASE = "https://api.assemblyai.com";
const MAX_AUDIO_BYTES = 20 * 1024 * 1024; // 20 MB

// ---------------------------------------------------------------------------
// AssemblyAI — speech-to-text with audio intelligence (sentiment, chapters)
// ---------------------------------------------------------------------------

/** Upload raw audio bytes to AssemblyAI and return a public upload URL. */
async function uploadToAssemblyAI(
  key: string,
  audio: ArrayBuffer,
): Promise<string> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/v2/upload`, {
    method: "POST",
    headers: {
      authorization: key,
      "content-type": "application/octet-stream",
    },
    body: audio,
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI upload failed (${res.status})`);
  }
  const data = (await res.json()) as { upload_url?: string };
  if (!data.upload_url) throw new Error("AssemblyAI upload returned no URL");
  return data.upload_url;
}

/** Start a transcription with audio-intelligence features enabled. */
async function createTranscript(
  key: string,
  audioUrl: string,
  enableChapters: boolean,
): Promise<string> {
  const res = await fetch(`${ASSEMBLYAI_BASE}/v2/transcript`, {
    method: "POST",
    headers: {
      authorization: key,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      audio_url: audioUrl,
      sentiment_analysis: true,
      // Chapters give a "what was said" summary for longer notes.
      chapterization: enableChapters,
    }),
  });
  if (!res.ok) {
    throw new Error(`AssemblyAI transcript request failed (${res.status})`);
  }
  const data = (await res.json()) as { id?: string };
  if (!data.id) throw new Error("AssemblyAI did not return a transcript id");
  return data.id;
}

interface TranscriptResult {
  text: string;
  summary?: string;
  sentiment: { positive: number; neutral: number; negative: number };
  chapters?: { headline: string; summary: string }[];
}

/** Poll AssemblyAI until the transcript completes or fails. */
async function pollTranscript(key: string, id: string): Promise<TranscriptResult> {
  const deadline = Date.now() + 90_000; // 90s cap — voice notes are short
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 2500));
    const res = await fetch(`${ASSEMBLYAI_BASE}/v2/transcript/${id}`, {
      headers: { authorization: key },
    });
    if (!res.ok) {
      throw new Error(`AssemblyAI poll failed (${res.status})`);
    }
    const t = (await res.json()) as {
      status: string;
      error?: string;
      text?: string;
      chapters?: { headline: string; summary: string }[];
      sentiment_analysis_results?: { sentiment: string }[];
    };
    if (t.status === "error") {
      throw new Error(`AssemblyAI error: ${t.error ?? "transcription failed"}`);
    }
    if (t.status === "completed") {
      const counts = { positive: 0, neutral: 0, negative: 0 };
      for (const r of t.sentiment_analysis_results ?? []) {
        if (r.sentiment === "POSITIVE") counts.positive++;
        else if (r.sentiment === "NEGATIVE") counts.negative++;
        else counts.neutral++;
      }
      const total = counts.positive + counts.neutral + counts.negative;
      const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
      return {
        text: t.text ?? "",
        summary: t.chapters?.[0]?.summary,
        sentiment: {
          positive: pct(counts.positive),
          neutral: pct(counts.neutral),
          negative: pct(counts.negative),
        },
        chapters: t.chapters?.slice(0, 3),
      };
    }
  }
  throw new Error("Transcription timed out — try again in a moment.");
}

/** Transcribe a recorded voice note with AssemblyAI audio intelligence. */
export const transcribe = action({
  args: { audio: v.bytes() },
  handler: async (ctx, args): Promise<TranscriptResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use voice input.");

    const key = process.env.ASSEMBLYAI_API_KEY;
    if (!key) {
      throw new Error(
        "ASSEMBLYAI_API_KEY is not configured. Add it in the Keys tab to enable voice transcription.",
      );
    }

    if (args.audio.byteLength === 0) throw new Error("Empty audio recording.");
    if (args.audio.byteLength > MAX_AUDIO_BYTES) {
      throw new Error("Recording too large — keep voice notes under 20 MB.");
    }

    const uploadUrl = await uploadToAssemblyAI(key, args.audio);
    const id = await createTranscript(
      key,
      uploadUrl,
      args.audio.byteLength > 500_000,
    );
    const result = await pollTranscript(key, id);

    if (!result.text.trim()) {
      throw new Error("No speech detected in the recording.");
    }
    return result;
  },
});

// ---------------------------------------------------------------------------
// Groq Whisper STT — fast multilingual speech-to-text (live mode engine)
// whisper-large-v3 transcribes in milliseconds and handles Hindi, Russian,
// English, and 90+ other languages natively.
// ---------------------------------------------------------------------------

export const transcribeWhisper = action({
  args: {
    audio: v.bytes(),
    language: v.optional(v.string()), // ISO-639-1 hint e.g. "hi", "ru", "en"
  },
  handler: async (ctx, args): Promise<{ text: string; language: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use voice.");

    const key = process.env.GROQ_API_KEY;
    if (!key) {
      throw new Error("GROQ_API_KEY is not configured.");
    }
    if (args.audio.byteLength === 0) throw new Error("Empty recording.");
    if (args.audio.byteLength > 25 * 1024 * 1024) {
      throw new Error("Recording too large — keep clips under 25 MB.");
    }

    const form = new FormData();
    form.append(
      "file",
      new Blob([args.audio], { type: "audio/webm" }),
      "speech.webm",
    );
    form.append("model", "whisper-large-v3");
    form.append("response_format", "json");
    form.append("temperature", "0");
    if (args.language) {
      form.append("language", args.language);
    }

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("Groq Whisper error", res.status, errText.slice(0, 300));
      throw new Error(`Transcription failed (${res.status}): ${errText.slice(0, 150)}`);
    }

    const data = (await res.json()) as { text?: string; language?: string };
    const text = (data.text ?? "").trim();
    if (!text) throw new Error("No speech detected.");
    return { text, language: data.language ?? args.language ?? "en" };
  },
});

// ---------------------------------------------------------------------------
// Groq PlayAI TTS — Jarvis speaks back (uses the existing GROQ_API_KEY)
// ---------------------------------------------------------------------------

// Groq PlayAI TTS. Voices are passed to the API as "<Name> — PlayAI".
const TTS_VOICES = [
  "Celeste",
  "River",
  "Leo",
  "Mia",
  "Zac",
  "Zoe",
  "Alex",
  "Ethan",
] as const;

const TTS_FALLBACK_VOICE = "Celeste";

// ---------------------------------------------------------------------------
// ElevenLabs TTS — second fallback for Jarvis's voice.
// Activates automatically when ELEVENLABS_API_KEY is set (Keys tab) and Groq
// TTS is unavailable (no Groq key / model terms not accepted / model error).
// eleven_turbo_v2_5 is fast, multilingual (Hindi, Russian, Arabic, ...) and
// cheap — a good match for the multi-country live mode. Override the voice
// with ELEVENLABS_VOICE_ID (defaults to Rachel).
// ---------------------------------------------------------------------------
async function speakWithElevenLabs(
  text: string,
): Promise<{ audio: ArrayBuffer | null; voice: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) return { audio: null, voice: "browser" };

  const voiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM"; // Rachel
  const clipped = text.trim().slice(0, 2500); // keep latency + cost sane
  if (!clipped) return { audio: null, voice: "browser" };

  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: {
          "xi-api-key": apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text: clipped,
          model_id: "eleven_turbo_v2_5",
          voice_settings: { stability: 0.5, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error("ElevenLabs TTS error", res.status, errText.slice(0, 300));
      return { audio: null, voice: "browser" };
    }
    return { audio: await res.arrayBuffer(), voice: "elevenlabs" };
  } catch (err) {
    console.error("ElevenLabs TTS failed:", err instanceof Error ? err.message : err);
    return { audio: null, voice: "browser" };
  }
}

/**
 * Speak text aloud. TTS chain: Groq Orpheus (WAV) → ElevenLabs (MP3) →
 * browser speech synthesis. Returns audio bytes when a server model is
 * available, or { audio: null } when none is — the client falls back to the
 * browser's built-in speech synthesis in that case (no user-facing error).
 */
export const speak = action({
  args: { text: v.string(), voice: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ audio: ArrayBuffer | null; voice: string }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in to use speech output.");

    const key = process.env.GROQ_API_KEY;
    if (!key) return speakWithElevenLabs(args.text);

    const voice = TTS_VOICES.includes((args.voice ?? "") as never)
      ? (args.voice as string)
      : TTS_FALLBACK_VOICE;

    // TTS models cap input at 10K characters.
    const text = args.text.trim().slice(0, 10_000);
    if (!text) return { audio: null, voice: "browser" };

    // playai-tts was decommissioned by Groq; canopylabs/orpheus-v1-english is
    // the current model (requires one-time org terms acceptance on the key).
    const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "canopylabs/orpheus-v1-english",
        input: text,
        voice: "tara",
        response_format: "wav",
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      if (errText.includes("model_terms_required")) {
        console.error(
          "Groq TTS needs one-time activation: accept the orpheus-v1-english model terms at console.groq.com (client falls back to browser voice).",
        );
      } else {
        console.error("Groq TTS error", res.status, errText);
      }
      // Graceful: try ElevenLabs next; the client falls back to browser TTS
      // only when every server provider is unavailable (no user-facing error).
      return speakWithElevenLabs(text);
    }

    const audioBuffer = await res.arrayBuffer();
    return { audio: audioBuffer, voice };
  },
});
