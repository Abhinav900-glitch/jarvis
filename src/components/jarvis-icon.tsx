interface JarvisIconProps {
  className?: string;
}

/**
 * Jarvis mark — a calm "core": thin outer ring, one bold arc for motion,
 * and a solid center dot. Monochrome by design (uses currentColor).
 */
export function JarvisIcon({ className }: JarvisIconProps) {
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
      <path d="M12 3.5a8.5 8.5 0 0 1 8.5 8.5" strokeWidth={2.25} />
      <circle cx="12" cy="12" r="2.1" fill="currentColor" stroke="none" />
    </svg>
  );
}
