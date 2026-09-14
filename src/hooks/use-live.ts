import { useCallback, useEffect, useRef, useState } from "react";

// ---------------------------------------------------------------------------
// useLiveMode — hands-free voice conversation (ChatGPT / Gemini Live style)
//
// Loop: browser SpeechRecognition listens → on final transcript, calls
// onTurn(text) (Dashboard sends it through the normal AI pipeline) → when the
// reply arrives, speak() reads it aloud via SpeechSynthesis → listening
// resumes automatically. Mic is paused while Jarvis talks so he doesn't
// hear himself.
//
// Uses only browser-native APIs (Web Speech API), so it works with zero
// extra keys and no audio streaming infrastructure. Requires Chrome/Edge
// (SpeechRecognition) and a secure context (HTTPS).
// ---------------------------------------------------------------------------

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: {
    length: number;
    [i: number]: {
      isFinal: boolean;
      length: number;
      [j: number]: { transcript: string };
    };
  };
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface LiveMode {
  active: boolean;
  listening: boolean;
  speaking: boolean;
  interim: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  /** Feed Jarvis's reply into the loop — it gets spoken, then listening resumes. */
  deliverReply: (text: string) => void;
}

export function useLiveMode(onTurn: (text: string) => void): LiveMode {
  const [active, setActive] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [interim, setInterim] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const activeRef = useRef(false);
  const speakingRef = useRef(false);
  const onTurnRef = useRef(onTurn);
  onTurnRef.current = onTurn;

  const startListening = useCallback(() => {
    const rec = recRef.current;
    if (!rec || speakingRef.current || !activeRef.current) return;
    try {
      rec.start();
      setListening(true);
    } catch {
      // start() throws if already started — ignore
    }
  }, []);

  const stop = useCallback(() => {
    activeRef.current = false;
    setActive(false);
    setListening(false);
    setInterim("");
    window.speechSynthesis?.cancel();
    speakingRef.current = false;
    setSpeaking(false);
    recRef.current?.abort();
    recRef.current = null;
  }, []);

  const start = useCallback(() => {
    setError(null);

    if (typeof window !== "undefined" && !window.isSecureContext) {
      setError("Live mode needs a secure connection — open this app over HTTPS.");
      return;
    }
    const Ctor = getRecognitionCtor();
    if (!Ctor) {
      setError(
        "Live mode needs Chrome or Edge (speech recognition isn't available in this browser).",
      );
      return;
    }
    if (!("speechSynthesis" in window)) {
      setError("Speech output isn't supported in this browser.");
      return;
    }

    const rec = new Ctor();
    rec.continuous = false; // one utterance at a time — cleaner turn-taking
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";

    rec.onresult = (e) => {
      let finalText = "";
      let interimText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) {
          finalText += res[0].transcript;
        } else {
          interimText += res[0].transcript;
        }
      }
      setInterim(interimText);
      if (finalText.trim()) {
        setInterim("");
        setListening(false);
        // Hand the turn to the app pipeline
        onTurnRef.current(finalText.trim());
      }
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access denied. Allow mic access and retry.");
        activeRef.current = false;
        setActive(false);
      } else if (e.error === "no-speech") {
        // silence — restart happens in onend
      } else if (e.error !== "aborted") {
        setError(`Voice error: ${e.error}`);
      }
    };

    rec.onend = () => {
      setListening(false);
      // Auto-restart unless Jarvis is speaking or the user stopped live mode
      if (activeRef.current && !speakingRef.current) {
        window.setTimeout(() => startListening(), 350);
      }
    };

    recRef.current = rec;
    activeRef.current = true;
    setActive(true);
    startListening();
  }, [startListening]);

  const deliverReply = useCallback(
    (text: string) => {
      if (!activeRef.current || !text.trim()) {
        // Live mode off or empty reply — just resume listening
        if (activeRef.current) window.setTimeout(() => startListening(), 200);
        return;
      }
      // Strip markdown/math syntax for cleaner speech
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

      const synth = window.speechSynthesis;
      synth.cancel();
      const utter = new SpeechSynthesisUtterance(spoken);
      utter.rate = 1.05;
      utter.onstart = () => {
        speakingRef.current = true;
        setSpeaking(true);
        recRef.current?.abort(); // don't hear ourselves
        setListening(false);
      };
      utter.onend = () => {
        speakingRef.current = false;
        setSpeaking(false);
        if (activeRef.current) {
          window.setTimeout(() => startListening(), 400);
        }
      };
      utter.onerror = () => {
        speakingRef.current = false;
        setSpeaking(false);
        if (activeRef.current) {
          window.setTimeout(() => startListening(), 400);
        }
      };
      synth.speak(utter);
    },
    [startListening],
  );

  // Cleanup on unmount
  useEffect(
    () => () => {
      activeRef.current = false;
      window.speechSynthesis?.cancel();
      recRef.current?.abort();
    },
    [],
  );

  return { active, listening, speaking, interim, error, start, stop, deliverReply };
}
