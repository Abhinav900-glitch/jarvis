import { useCallback, useEffect, useRef, useState } from "react";
import { getCountry } from "@/lib/languages";

// ---------------------------------------------------------------------------
// useLiveMode — hands-free voice conversation (ChatGPT / Gemini Live style)
//
// Architecture (fully free stack, per the Groq voice pipeline):
//   1. Hearing: MediaRecorder captures your voice → Groq Whisper
//      (whisper-large-v3) transcribes it in milliseconds. Multilingual —
//      Hindi, Russian, Arabic, and 90+ languages, guided by the selected
//      country.
//   2. Thinking: the transcript goes through the normal chat pipeline
//      (Groq LLM with automatic fallback).
//   3. Speaking: the reply is spoken via Web Speech API (browser-native,
//      free) with a voice matched to the selected country's language.
//
// Extras:
//   • Barge-in / natural interruption: mic volume is monitored while Jarvis
//     talks — if you speak over him, speech is cancelled instantly and he
//     listens again.
//   • Auto-restart: after each reply, listening resumes automatically.
// ---------------------------------------------------------------------------

export interface LiveMode {
  active: boolean;
  listening: boolean;
  speaking: boolean;
  processing: boolean;
  /** Live mic level 0..1 — drives the orb pulse */
  level: number;
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Feed Jarvis's reply text — spoken aloud, then listening resumes. */
  deliverReply: (text: string) => void;
}

/**
 * Turn handler: receives the recorded audio + country code, must run the
 * STT → LLM → append pipeline and return the reply text for speaking.
 */
export type LiveTurnHandler = (audio: Blob, countryCode: string) => Promise<string>;

const SILENCE_DB = 0.045; // RMS threshold for barge-in detection

export function useLiveMode(onTurn: LiveTurnHandler, countryCode: string): LiveMode {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const activeRef = useRef(false);
  const speakingRef = useRef(false);
  const processingRef = useRef(false);
  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;
  const countryRef = useRef(countryCode);
  countryRef.current = countryCode;

  // Recording machinery
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const levelRafRef = useRef<number | null>(null);
  const levelTimerRef = useRef<number | null>(null);
  const silenceStartRef = useRef<number | null>(null);
  const bargeInRef = useRef(false);

  const country = getCountry(countryCode);

  // ------------------------------------------------------------------
  // Mic level monitoring + barge-in (interrupt Jarvis by speaking)
  // ------------------------------------------------------------------
  const startLevelMonitor = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const buf = new Float32Array(analyser.fftSize);

    const tick = () => {
      if (!activeRef.current) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      const rms = Math.sqrt(sum / buf.length);
      setLevel(Math.min(1, rms * 6));

      // While Jarvis speaks, watch for the user talking over him
      if (speakingRef.current) {
        if (rms > SILENCE_DB) {
          if (silenceStartRef.current === null) {
            silenceStartRef.current = Date.now();
          } else if (Date.now() - silenceStartRef.current > 350) {
            // 350ms of sustained voice → interrupt
            bargeInRef.current = true;
            window.speechSynthesis.cancel();
          }
        } else {
          silenceStartRef.current = null;
        }
      }
      levelRafRef.current = requestAnimationFrame(tick);
    };
    levelRafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopLevelMonitor = useCallback(() => {
    if (levelRafRef.current !== null) {
      cancelAnimationFrame(levelRafRef.current);
      levelRafRef.current = null;
    }
    setLevel(0);
  }, []);

  // ------------------------------------------------------------------
  // Recording → Whisper STT
  // ------------------------------------------------------------------
  const startRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream || speakingRef.current || processingRef.current || !activeRef.current) return;

    try {
      const mime = MediaRecorder.isTypeSupported("audio/webm")
        ? "audio/webm"
        : MediaRecorder.isTypeSupported("audio/mp4")
          ? "audio/mp4"
          : "";
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        chunksRef.current = [];
        if (blob.size < 3000 || !activeRef.current) {
          // too short / stopped — resume listening
          window.setTimeout(() => startRecording(), 300);
          return;
        }
        processingRef.current = true;
        setProcessing(true);
        try {
          await onTurnRef.current(blob, countryRef.current);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Transcription failed.");
        } finally {
          processingRef.current = false;
          setProcessing(false);
          // Resume listening after the turn completes (reply delivery also
          // triggers resume via deliverReply → utterance end)
          if (!speakingRef.current && activeRef.current) {
            window.setTimeout(() => startRecording(), 400);
          }
        }
      };
      rec.start();
      recorderRef.current = rec;
      setListening(true);
      setError(null);
    } catch {
      setError("Could not start recording.");
    }
  }, []);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.stop();
    }
    setListening(false);
  }, []);

  // ------------------------------------------------------------------
  // Speak a reply via browser TTS with a country-matched voice
  // ------------------------------------------------------------------
  const pickVoice = useCallback((): SpeechSynthesisVoice | null => {
    const synth = window.speechSynthesis;
    if (!synth) return null;
    const voices = synth.getVoices();
    const tag = countryRef.current ? getCountry(countryRef.current).langTag : "en-US";
    const langPrefix = tag.split("-")[0];
    return (
      voices.find((v) => v.lang === tag) ??
      voices.find((v) => v.lang.startsWith(langPrefix)) ??
      voices.find((v) => v.lang.startsWith("en")) ??
      null
    );
  }, []);

  const speakReply = useCallback(
    (text: string, onDone: () => void) => {
      const synth = window.speechSynthesis;
      if (!synth) {
        onDone();
        return;
      }
      // Strip markdown/math for clean speech
      const spoken = text
        .replace(/```[\s\S]*?```/g, " (code block) ")
        .replace(/\$\$[\s\S]*?\$\$/g, " (equation) ")
        .replace(/\$[^$\n]+\$/g, " (expression) ")
        .replace(/\[(\d+)\]\([^)]*\)/g, "[$1]")
        .replace(/[#*_`~>|]/g, "")
        .replace(/\n{2,}/g, ". ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 1200);

      synth.cancel();
      bargeInRef.current = false;
      silenceStartRef.current = null;

      // Long replies: chunk into sentences so cancel() responds quickly
      const sentences = spoken.match(/[^.!?。]+[.!?。]*/g) ?? [spoken];
      const utterances = sentences.map((s) => {
        const u = new SpeechSynthesisUtterance(s.trim());
        const voice = pickVoice();
        if (voice) {
          u.voice = voice;
          u.lang = voice.lang;
        } else {
          u.lang = countryRef.current ? getCountry(countryRef.current).langTag : "en-US";
        }
        u.rate = 1.05;
        return u;
      });

      utterances.forEach((u, i) => {
        u.onstart = () => {
          speakingRef.current = true;
          setSpeaking(true);
        };
        u.onend = () => {
          const isLast = i === utterances.length - 1;
          const interrupted = bargeInRef.current;
          if (interrupted || isLast) {
            speakingRef.current = false;
            setSpeaking(false);
            onDone();
          }
        };
        u.onerror = () => {
          speakingRef.current = false;
          setSpeaking(false);
          onDone();
        };
        synth.speak(u);
      });

      if (utterances.length === 0) onDone();
    },
    [pickVoice],
  );

  // ------------------------------------------------------------------
  // Public API
  // ------------------------------------------------------------------
  const stop = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    setListening(false);
    setProcessing(false);
    speakingRef.current = false;
    setSpeaking(false);
    stopLevelMonitor();
    window.speechSynthesis?.cancel();
    stopRecording();
    recorderRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    void audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, [stopLevelMonitor, stopRecording]);

  const start = useCallback(async () => {
    setError(null);

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("Live mode needs a secure connection — open this app over HTTPS.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setError("Voice isn't supported in this browser.");
      return;
    }
    if (!("speechSynthesis" in window)) {
      setError("Speech output isn't supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      // Set up the analyser for level monitoring + barge-in
      const Ctx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      analyserRef.current = analyser;

      activeRef.current = true;
      setActive(true);
      startLevelMonitor();
      startRecording();
    } catch {
      setError("Microphone access denied. Allow mic access and retry.");
    }
  }, [startLevelMonitor, startRecording]);

  const deliverReply = useCallback(
    (text: string) => {
      if (!activeRef.current) return;
      if (!text.trim()) {
        if (!speakingRef.current) window.setTimeout(() => startRecording(), 300);
        return;
      }
      // Pause the mic while Jarvis talks
      stopRecording();
      speakReply(text, () => {
        if (activeRef.current && !bargeInRef.current) {
          window.setTimeout(() => startRecording(), 400);
        } else if (bargeInRef.current) {
          // Interrupted — listen again immediately
          bargeInRef.current = false;
          window.setTimeout(() => startRecording(), 150);
        }
      });
    },
    [speakReply, startRecording, stopRecording],
  );

  // Cleanup on unmount
  useEffect(
    () => () => {
      activeRef.current = false;
      window.speechSynthesis?.cancel();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (levelRafRef.current !== null) cancelAnimationFrame(levelRafRef.current);
    },
    [],
  );

  return { active, listening, speaking, processing, level, error, start, stop, deliverReply };
}
