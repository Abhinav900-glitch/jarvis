interface JarvisIconProps {
  className?: string;
  animate?: boolean;
}

/**
 * Jarvis mark — a calm "core": thin outer ring, one bold arc for motion,
 * and a solid center dot. Monochrome by design (uses currentColor).
 */
export function JarvisIcon({ className, animate = false }: JarvisIconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      className={className}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="8.5" strokeWidth={1.25} />
      <path
        d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5"
        strokeWidth={2.25}
        style={
          animate
            ? {
                transformOrigin: "12px 12px",
                animation: "jarvis-spin 3s linear infinite",
              }
            : undefined
        }
      />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
