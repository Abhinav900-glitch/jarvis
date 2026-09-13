import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";

interface LightboxProps {
  images?: string[];
  src?: string | null;
  startIndex?: number;
  alt?: string;
  onClose: () => void;
}

/**
 * Full-screen image viewer with arrow / keyboard / touch-swipe navigation.
 * Click backdrop, × button, or press Escape to close.
 */
export function Lightbox({
  images: imagesProp,
  src,
  startIndex = 0,
  alt,
  onClose,
}: LightboxProps) {
  const images = imagesProp ?? (src ? [src] : []);
  const open = images.length > 0;
  const [index, setIndex] = useState(Math.min(startIndex, images.length - 1));
  const [direction, setDirection] = useState(1);
  const touchStartX = useRef<number | null>(null);
  const total = images.length;

  // Keep index in sync when a new gallery opens
  useEffect(() => {
    if (open) setIndex(Math.max(0, Math.min(startIndex, total - 1)));
  }, [open, startIndex, total]);

  const go = useCallback(
    (dir: 1 | -1) => {
      setDirection(dir);
      setIndex((i) => (i + dir + total) % total);
    },
    [total],
  );

  const goNext = useCallback(() => go(1), [go]);
  const goPrev = useCallback(() => go(-1), [go]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") goNext();
      else if (e.key === "ArrowLeft") goPrev();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose, goNext, goPrev]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return;
    const delta = e.changedTouches[0].clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(delta) < 50) return; // too short — not a swipe
    if (delta < 0) goNext();
    else goPrev();
  };

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          key="lightbox-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 sm:p-10 select-none"
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={alt ?? "Image viewer"}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* Close */}
          <button
            onClick={onClose}
            className="absolute top-4 right-4 z-10 flex size-9 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
            title="Close (Esc)"
          >
            <X className="size-4" />
          </button>

          {/* Counter */}
          {total > 1 ? (
            <div className="absolute top-5 left-5 z-10 rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white tabular-nums">
              {index + 1} / {total}
            </div>
          ) : null}

          {/* Prev arrow */}
          {total > 1 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goPrev();
              }}
              className="absolute top-1/2 left-2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:left-4"
              title="Previous (←)"
              aria-label="Previous image"
            >
              <ChevronLeft className="size-5" />
            </button>
          ) : null}

          {/* Next arrow */}
          {total > 1 ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                goNext();
              }}
              className="absolute top-1/2 right-2 z-10 flex size-10 -translate-y-1/2 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 sm:right-4"
              title="Next (→)"
              aria-label="Next image"
            >
              <ChevronRight className="size-5" />
            </button>
          ) : null}

          {/* Image with slide transition */}
          <AnimatePresence mode="popLayout" custom={direction}>
            <motion.img
              key={images[index]}
              src={images[index]}
              alt={alt ?? ""}
              custom={direction}
              initial={{ opacity: 0, x: direction * 60 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -60 }}
              transition={{ duration: 0.2, ease: "easeOut" }}
              draggable={false}
              className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            />
          </AnimatePresence>

          {/* Thumbnail strip */}
          {total > 1 ? (
            <div
              className="absolute bottom-5 left-1/2 z-10 flex max-w-[90vw] -translate-x-1/2 gap-1.5 overflow-x-auto rounded-xl bg-white/10 p-1.5"
              onClick={(e) => e.stopPropagation()}
            >
              {images.map((src, i) => (
                <button
                  key={src + i}
                  onClick={() => {
                    setDirection(i > index ? 1 : -1);
                    setIndex(i);
                  }}
                  className={`h-11 w-11 shrink-0 overflow-hidden rounded-md border-2 transition-opacity ${
                    i === index
                      ? "border-white opacity-100"
                      : "border-transparent opacity-50 hover:opacity-80"
                  }`}
                  aria-label={`Go to image ${i + 1}`}
                >
                  <img
                    src={src}
                    alt=""
                    className="size-full object-cover"
                    draggable={false}
                  />
                </button>
              ))}
            </div>
          ) : null}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
