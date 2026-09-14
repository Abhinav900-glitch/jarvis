import { cn } from "@/lib/utils";

/**
 * JarvisOrb — a "thinking" animation distinct from Claude's pulsing blob.
 * Concept: a calm reactor core. A fine multi-ring gimbal rotates at different
 * speeds (like a gyroscope stabilizing), while the center core gently breathes
 * and small dots orbit on the rings — thought satellites.
 *
 * Pure CSS animations (defined in index.css) so it stays smooth and cheap.
 */
export function JarvisOrb({
  size = 28,
  label,
  className,
}: {
  size?: number;
  label?: string;
  className?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className="jarvis-orb relative inline-block shrink-0"
        style={{ width: size, height: size }}
        aria-hidden="true"
      >
        {/* Outer gimbal ring with one orbiting satellite */}
        <span className="jarvis-orb-ring jarvis-orb-ring-outer">
          <span className="jarvis-orb-satellite jarvis-orb-satellite-a" />
        </span>
        {/* Inner gimbal ring, counter-rotating, with its own satellite */}
        <span className="jarvis-orb-ring jarvis-orb-ring-inner">
          <span className="jarvis-orb-satellite jarvis-orb-satellite-b" />
        </span>
        {/* Breathing core */}
        <span className="jarvis-orb-core" />
      </span>
      {label ? (
        <span className="text-sm text-muted-foreground">{label}</span>
      ) : null}
    </span>
  );
}
