// ---------------------------------------------------------------------------
// JarvisHud — full-screen JARVIS-style live-mode interface (Inspo: the
// arc-reactor/rotating-HUD aesthetic). Opens when Live Mode is active.
//
// Pure CSS animations (keyframes live in index.css) + framer-motion fade.
// All state comes from useLiveMode; the transcript is streamed in through
// the `transcript` prop (live user speech + last Jarvis reply text).
// ---------------------------------------------------------------------------

import { motion } from "framer-motion";
import { SkipForward, X } from "lucide-react";
import { cn } from "@/lib/utils";

export type HudPhase = "listening" | "processing" | "speaking" | "idle";

export interface JarvisHudProps {
  open: boolean;
  phase: HudPhase;
  /** 0..1 live mic level — drives the orb pulse + waveform bars */
  level: number;
  /** Most recent live exchange shown as a caption at the bottom */
  transcript: { user: string; assistant: string } | null;
  /** Selected country/language name for the HUD readout */
  language: string;
  onStop: () => void;
  /** Interrupt the spoken reply — drop straight back to listening */
  onSkip: () => void;
}

const STATUS_LABELS: Record<HudPhase, string> = {
  listening: "LISTENING",
  processing: "PROCESSING",
  speaking: "SPEAKING",
  idle: "STANDBY",
};

function HudRing({ className, spin }: { className?: string; spin: "cw" | "ccw" }) {
  return (
    <div
      className={cn(
        "absolute inset-0 rounded-full border border-cyan-300/25",
        spin === "cw" ? "jarvis-hud-ring-cw" : "jarvis-hud-ring-ccw",
        className,
      )}
    >
      {/* Tick marks around the ring */}
      <div className="absolute inset-0">
        {Array.from({ length: 24 }).map((_, i) => (
          <div
            key={i}
            className="absolute left-1/2 top-1/2 h-full w-px"
            style={{ transform: `rotate(${i * 15}deg) translateY(-50%)`, transformOrigin: "0 0" }}
          >
            <div
              className={cn(
                "w-px bg-cyan-300/40",
                i % 6 === 0 ? "h-3.5" : "h-2",
              )}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 24-bar waveform driven by the live mic level (or a synthetic sweep when speaking). */
function Waveform({ level, phase }: { level: number; phase: HudPhase }) {
  const active = phase === "speaking" || phase === "listening";
  return (
    <div className="flex h-10 items-center justify-center gap-[3px]">
      {Array.from({ length: 24 }).map((_, i) => {
        const wavePhase = Math.sin((Date.now() / 120 + i) * 0.9);
        const base = phase === "speaking" ? 0.5 + 0.5 * wavePhase : level * (0.6 + 0.4 * wavePhase);
        const h = active ? Math.max(2, base * 36) : 2;
        const accent = phase === "speaking" ? "bg-cyan-200/90" : "bg-cyan-400/80";
        return (
          <div
            key={i}
            className={cn("w-[3px] rounded-full transition-[height] duration-75", active ? accent : "bg-cyan-300/20")}
            style={{ height: `${h}px` }}
          />
        );
      })}
    </div>
  );
}

export function JarvisHud({
  open,
  phase,
  level,
  transcript,
  language,
  onStop,
  onSkip,
}: JarvisHudProps) {
  if (!open) return null;

  const speakingPulse = phase === "speaking" ? 1 + level * 0.25 : 1;
  const listeningPulse = phase === "listening" ? 1 + level * 0.35 : 1;
  const orbScale = phase === "processing" ? 0.9 : Math.min(1.4, speakingPulse * listeningPulse);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35 }}
      className="fixed inset-0 z-[80] overflow-hidden bg-[#020610]/97 jarvis-hud-grid jarvis-hud-scanline"
    >
      {/* Corner brackets */}
      <div className="pointer-events-none absolute left-5 top-5 h-10 w-10 border-l-2 border-t-2 border-cyan-400/30" />
      <div className="pointer-events-none absolute right-5 top-5 h-10 w-10 border-r-2 border-t-2 border-cyan-400/30" />
      <div className="pointer-events-none absolute bottom-5 left-5 h-10 w-10 border-b-2 border-l-2 border-cyan-400/30" />

      {/* Top status bar */}
      <div className="pointer-events-none absolute left-0 right-0 top-6 flex items-center justify-center gap-2 text-[10px] font-semibold uppercase tracking-[0.3em] text-cyan-300/70">
        <span className="inline-block h-1.5 w-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.9)] jarvis-hud-blink" />
        <span>J.A.R.V.I.S · Live Uplink · {language}</span>
      </div>

      {/* Close button */}
      <button
        onClick={onStop}
        title="End Live Mode"
        className="absolute right-5 top-5 z-10 inline-flex size-9 items-center justify-center rounded-full border border-red-500/40 bg-red-500/10 text-red-400 transition-colors hover:bg-red-500/20"
      >
        <X className="size-4" />
      </button>

      {/* Center orb */}
      <div className="relative flex h-full w-full items-center justify-center pb-24 pt-16">
        <div className="relative flex size-64 items-center justify-center sm:size-72">
          {/* Glow behind the orb */}
          <div
            className="absolute inset-0 rounded-full bg-cyan-500/20 blur-3xl"
            style={{ transform: `scale(${orbScale})`, transition: "transform 120ms linear" }}
          />
          {/* Rotating rings */}
          <HudRing className="inset-0" spin="cw" />
          <HudRing className="inset-4 border-cyan-400/40" spin="ccw" />
          <HudRing className="inset-8" spin="cw" />
          {/* Tick ring (static) */}
          <div className="absolute inset-12 rounded-full border border-cyan-300/15" />

          {/* Arc-reactor core */}
          <div
            className="absolute inset-20 rounded-full border border-cyan-200/60 bg-gradient-to-b from-cyan-200/30 via-cyan-400/10 to-transparent shadow-[0_0_60px_rgba(34,211,238,0.35)]"
            style={{ transform: `scale(${orbScale})`, transition: "transform 120ms linear" }}
          >
            <div className="absolute inset-2 rounded-full bg-gradient-to-br from-white via-cyan-100 to-cyan-400/80 opacity-90 blur-[1px]" />
            <div className="absolute inset-6 rounded-full bg-white/80 blur-sm" />
          </div>
        </div>

        {/* Status readout */}
        <div className="absolute bottom-16 left-0 right-0 flex flex-col items-center gap-3">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.35em] text-cyan-200">
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)] jarvis-hud-blink" />
            {STATUS_LABELS[phase]}
            <span className="inline-block h-2 w-2 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.9)] jarvis-hud-blink" />
          </div>
          <Waveform level={level} phase={phase} />
          {transcript && (
            <div className="mx-auto max-w-xl px-6 text-center">
              {transcript.user && (
                <p className="text-sm text-cyan-100/90">
                  <span className="font-semibold text-cyan-300">You:</span> {transcript.user}
                </p>
              )}
              {transcript.assistant && (
                <p className="mt-1 line-clamp-2 text-sm text-foreground/80">
                  <span className="font-semibold text-cyan-300/70">Jarvis:</span> {transcript.assistant}
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom controls: skip the spoken reply while Jarvis talks */}
      <div className="absolute bottom-6 left-0 right-0 flex items-center justify-center gap-4">
        {phase === "speaking" && (
          <button
            onClick={onSkip}
            title="Skip reply"
            className="inline-flex size-11 items-center justify-center rounded-full border border-cyan-400/40 bg-cyan-500/10 text-cyan-300 transition-colors hover:bg-cyan-500/20"
          >
            <SkipForward className="size-4" />
          </button>
        )}
      </div>
    </motion.div>
  );
}
