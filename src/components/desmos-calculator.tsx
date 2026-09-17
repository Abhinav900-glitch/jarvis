import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Loader2, Maximize2, Minimize2, ExternalLink } from "lucide-react";

// ---------------------------------------------------------------------------
// Desmos API lazy loader
// Loads https://www.desmos.com/api/v1.9/calculator.js?libraries=dv3d once and
// caches the promise so every calculator instance shares one script.
// ---------------------------------------------------------------------------

let desmosPromise: Promise<void> | null = null;

function loadDesmos(apiKey: string): Promise<void> {
  if (desmosPromise) return desmosPromise;
  desmosPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Desmos requires a browser"));
      return;
    }
    const w = window as unknown as { Desmos?: unknown };
    if (w.Desmos) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = `https://www.desmos.com/api/v1.9/calculator.js?apiKey=${encodeURIComponent(apiKey)}&libraries=dv3d`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      desmosPromise = null;
      reject(new Error("Failed to load the Desmos API script"));
    };
    document.head.appendChild(script);
  });
  return desmosPromise;
}

// ---------------------------------------------------------------------------
// Spec parsed from a ```desmos code block
// ---------------------------------------------------------------------------
// ```desmos
// mode: graphing | 3d | scientific | geometry   (default: graphing)
// zoom: <number>                                (optional)
// expressions:
// y = x^2
// y = 2x + 1
// ```

export interface DesmosSpec {
  mode: "graphing" | "3d" | "scientific" | "geometry";
  zoom?: number;
  expressions: string[];
}

export function parseDesmosSpec(source: string): DesmosSpec {
  const lines = source.trim().split("\n");
  const spec: DesmosSpec = { mode: "graphing", expressions: [] };

  let inExpressions = false;
  const looksLikeExpr = (s: string) =>
    /^[a-zA-Z0-9_()\\^{}[\]=+\-*/.,\s|<>]+$/.test(s) && /[=,(]|\b(x|y|z|t|sin|cos|tan|ln|log|sqrt|pi|e)\b/.test(s);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!inExpressions) {
      const modeMatch = /^mode\s*:\s*(graphing|3d|scientific|geometry)\s*$/i.exec(line);
      if (modeMatch) {
        spec.mode = modeMatch[1].toLowerCase() as DesmosSpec["mode"];
        continue;
      }
      const zoomMatch = /^zoom\s*:\s*(\d+(?:\.\d+)?)\s*$/i.exec(line);
      if (zoomMatch) {
        spec.zoom = parseFloat(zoomMatch[1]);
        continue;
      }
      if (/^expressions\s*:\s*$/i.test(line)) {
        inExpressions = true;
        continue;
      }
      // Tolerant: an unprefixed line that looks like an expression counts too.
      if (looksLikeExpr(line)) {
        spec.expressions.push(line);
      }
    } else {
      // Only genuine expressions — a stray prose line (any language) must be
      // skipped, never fed to Desmos.
      if (looksLikeExpr(line)) spec.expressions.push(line);
    }
  }
  return spec;
}

// ---------------------------------------------------------------------------
// Minimal typings for the parts of the Desmos API we use
// ---------------------------------------------------------------------------

interface DesmosExpressionItem {
  latex?: string;
  type?: string;
  color?: string;
  fillOpacity?: number;
}

interface DesmosCalc {
  setExpressions: (exprs: DesmosExpressionItem[]) => void;
  setMathBounds?: (bounds: {
    left?: number;
    right?: number;
    top?: number;
    bottom?: number;
  }) => void;
  destroy: () => void;
}

type DesmosConstructor = new (
  el: HTMLElement,
  options?: Record<string, unknown>,
) => DesmosCalc;

interface DesmosGlobal {
  GraphingCalculator: DesmosConstructor;
  GraphingCalculator3D?: DesmosConstructor;
  ScientificCalculator: DesmosConstructor;
  Geometry?: DesmosConstructor;
}

function getDesmos(): DesmosGlobal | null {
  return (window as unknown as { Desmos?: DesmosGlobal }).Desmos ?? null;
}

// ---------------------------------------------------------------------------
// Calculator component
// ---------------------------------------------------------------------------

export function DesmosCalculator({ source }: { source: string }) {
  // Memoize: the effect below depends on spec.expressions (an array), which
  // must keep a stable identity between renders or the calculator would be
  // torn down and recreated on every render.
  const spec = useMemo(() => parseDesmosSpec(source), [source]);
  const config = useQuery(api.config.desmosApiKey);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const calcRef = useRef<DesmosCalc | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let destroyed = false;

    if (!config) return; // still loading the key
    if (!config.apiKey) {
      setStatus("error");
      setErrorMsg("Desmos API key is not configured. Add DESMOS_API_KEY in the Keys tab.");
      return;
    }

    setStatus("loading");
    loadDesmos(config.apiKey)
      .then(() => {
        if (destroyed || !containerRef.current) return;
        const D = getDesmos();
        if (!D) throw new Error("Desmos loaded but the global is missing");

        const options: Record<string, unknown> = {
          keypad: spec.mode === "scientific",
          expressions: spec.mode !== "scientific",
          settingsMenu: false,
          zoomButtons: true,
          lockViewport: false,
          showGrid: true,
          border: false,
          invertedColors: false,
        };

        let calc: DesmosCalc;
        switch (spec.mode) {
          case "3d":
            if (!D.GraphingCalculator3D) throw new Error("3D calculator unavailable (libraries=dv3d missing)");
            calc = new D.GraphingCalculator3D(containerRef.current, options);
            break;
          case "scientific":
            calc = new D.ScientificCalculator(containerRef.current, options);
            break;
          case "geometry":
            if (!D.Geometry) throw new Error("Geometry tool unavailable");
            calc = new D.Geometry(containerRef.current, options);
            break;
          default:
            calc = new D.GraphingCalculator(containerRef.current, options);
        }

        calcRef.current = calc;

        if (spec.expressions.length > 0 && typeof calc.setExpressions === "function") {
          calc.setExpressions(spec.expressions.map((latex) => ({ latex })));
        }
        if (spec.zoom && typeof calc.setMathBounds === "function") {
          const z = spec.zoom;
          calc.setMathBounds({ left: -z, right: z, top: z, bottom: -z });
        }

        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (destroyed) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Failed to load Desmos.");
      });

    return () => {
      destroyed = true;
      try {
        calcRef.current?.destroy();
      } catch {
        // already destroyed
      }
      calcRef.current = null;
    };
  }, [config, spec.mode, spec.zoom, spec.expressions]);

  return (
    <div className="my-4 overflow-hidden rounded-md border">
      <div className="flex items-center justify-between border-b bg-muted/60 px-3 py-1.5">
        <span className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Desmos {spec.mode === "3d" ? "3D" : spec.mode} · {spec.expressions.length} expression{spec.expressions.length === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setExpanded((e) => !e)}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label={expanded ? "Collapse calculator" : "Expand calculator"}
          >
            {expanded ? <Minimize2 className="size-3" /> : <Maximize2 className="size-3" />}
          </button>
          <a
            href="https://www.desmos.com/calculator"
            target="_blank"
            rel="noopener noreferrer"
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            aria-label="Open in Desmos"
          >
            <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
      <div
        style={{ height: expanded ? 560 : 380 }}
        className="relative w-full bg-white transition-[height] duration-200"
      >
        {/* Desmos owns this node's children — React never touches inside it. */}
        <div ref={containerRef} className="absolute inset-0" />
        {(status === "loading" || status === "idle") && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 bg-white text-xs text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading Desmos…
          </div>
        )}
        {status === "error" && (
          <div className="absolute inset-0 flex items-center justify-center bg-white px-4 text-center text-xs text-muted-foreground">
            <p>{errorMsg ?? "Desmos failed to load."}</p>
          </div>
        )}
      </div>
    </div>
  );
}
