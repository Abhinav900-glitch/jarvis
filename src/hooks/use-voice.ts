import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// useVoiceRecorder — MediaRecorder wrapper for the mic button
// ---------------------------------------------------------------------------

export interface VoiceRecorder {
  recording: boolean;
  seconds: number;
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
}

export function useVoiceRecorder(onDone: (audio: Blob) => void): VoiceRecorder {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const clearTimer = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const cleanup = () => {
    clearTimer();
    recorderRef.current?.stream.getTracks().forEach((t) => t.stop());
    recorderRef.current = null;
    chunksRef.current = [];
    setRecording(false);
    setSeconds(0);
  };

  const stop = useCallback(() => {
    if (recorderRef.current?.state === "recording") {
      // onstop below flushes the blob.
      recorderRef.current.stop();
    } else {
      cleanup();
    }
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (recorderRef.current) return;

    // getUserMedia requires a secure context (HTTPS or localhost).
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError(
        "Microphone needs a secure connection — open this app over HTTPS.",
      );
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("Voice input isn't supported in this browser.");
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
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
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, {
          type: rec.mimeType || "audio/webm",
        });
        cleanup();
        if (blob.size > 0) onDoneRef.current(blob);
      };
      rec.start();
      recorderRef.current = rec;
      setRecording(true);
      setSeconds(0);
      timerRef.current = window.setInterval(
        () => setSeconds((s) => s + 1),
        1000,
      );
    } catch {
      setError("Microphone access denied or unavailable.");
    }
  }, []);

  useEffect(() => cleanup, []);

  return { recording, seconds, error, start, stop };
}

// ---------------------------------------------------------------------------
// useVoicePlayer — play WAV bytes returned by the TTS action
// ---------------------------------------------------------------------------

export function useVoicePlayer() {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const urlRef = useRef<string | null>(null);

  const stop = useCallback(() => {
    audioRef.current?.pause();
    audioRef.current = null;
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    setPlayingId(null);
    setLoadingId(null);
  }, []);

  const play = useCallback(
    (id: string, audio: ArrayBuffer) => {
      stop();
      const url = URL.createObjectURL(new Blob([audio], { type: "audio/mpeg" }));
      urlRef.current = url;
      const el = new Audio(url);
      el.onended = stop;
      audioRef.current = el;
      setPlayingId(id);
      void el.play().catch(stop);
    },
    [stop],
  );

  useEffect(() => stop, [stop]);

  return { play, stop, playingId, loadingId, setLoadingId, setPlayingId };
}
