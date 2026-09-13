import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { motion, AnimatePresence } from "framer-motion";
import {
  TrendingUp,
  BarChart3,
  Equal,
  Grid3X3,
  Loader2,
  X,
} from "lucide-react";

type Tab = "regression" | "stats" | "equation" | "matrix";

export function CalculatorPanel({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("regression");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<unknown>(null);

  const regressionAction = useAction(api.math.linearRegression);
  const statsAction = useAction(api.math.calculateStats);
  const equationAction = useAction(api.math.solveEquation);
  const matrixAction = useAction(api.math.matrixOperation);

  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "regression", label: "Regression", icon: <TrendingUp className="size-3.5" /> },
    { id: "stats", label: "Statistics", icon: <BarChart3 className="size-3.5" /> },
    { id: "equation", label: "Equations", icon: <Equal className="size-3.5" /> },
    { id: "matrix", label: "Matrix", icon: <Grid3X3 className="size-3.5" /> },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.2 }}
      className="border-t bg-background"
    >
      <div className="mx-auto max-w-2xl px-6 py-4">
        {/* Header */}
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">🧮 Calculator</span>
            <span className="text-[10px] text-muted-foreground">ML & Math Tools</span>
          </div>
          <button onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:text-foreground">
            <X className="size-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="mb-3 flex gap-1 rounded-lg bg-muted/50 p-0.5">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => { setTab(t.id); setResult(null); setError(null); }}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                tab === t.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        {/* Content */}
        <AnimatePresence mode="wait">
          {tab === "regression" && (
            <RegressionForm
              key="reg"
              action={regressionAction}
              loading={loading}
              setLoading={setLoading}
              error={error}
              setError={setError}
              result={result}
              setResult={setResult}
            />
          )}
          {tab === "stats" && (
            <StatsForm
              key="stats"
              action={statsAction}
              loading={loading}
              setLoading={setLoading}
              error={error}
              setError={setError}
              result={result}
              setResult={setResult}
            />
          )}
          {tab === "equation" && (
            <EquationForm
              key="eq"
              action={equationAction}
              loading={loading}
              setLoading={setLoading}
              error={error}
              setError={setError}
              result={result}
              setResult={setResult}
            />
          )}
          {tab === "matrix" && (
            <MatrixForm
              key="mat"
              action={matrixAction}
              loading={loading}
              setLoading={setLoading}
              error={error}
              setError={setError}
              result={result}
              setResult={setResult}
            />
          )}
        </AnimatePresence>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="size-3 animate-spin" />
            Computing…
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="mt-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Regression Form
// ---------------------------------------------------------------------------

function RegressionForm({ action, loading, setLoading, error, setError, result, setResult }: FormProps) {
  const [pointsText, setPointsText] = useState("0,0\n1,2\n2,4\n3,5\n4,8");

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const points = pointsText
        .split("\n")
        .filter((l) => l.trim())
        .map((l) => {
          const [x, y] = l.split(/[,\s]+/).map(Number);
          if (isNaN(x) || isNaN(y)) throw new Error(`Invalid point: "${l}"`);
          return { x, y };
        });
      const r = await action({ points });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
      <p className="text-xs text-muted-foreground">Enter x,y points (one per line):</p>
      <textarea
        value={pointsText}
        onChange={(e) => setPointsText(e.target.value)}
        rows={5}
        className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground/50 focus:border-foreground/30"
      />
      <button
        onClick={() => void handleSubmit()}
        disabled={loading}
        className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-40"
      >
        Compute Regression
      </button>
      {result && !error && <RegressionResult data={result as RegressionResult} />}
    </motion.div>
  );
}

interface RegressionResult {
  slope: number;
  intercept: number;
  rSquared: number;
  equation: string;
  predictions: { x: number; y: number }[];
  residuals: number[];
  mse: number;
  rmse: number;
  mae: number;
}

function RegressionResult({ data }: { data: RegressionResult }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="text-lg font-mono font-semibold">{data.equation}</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
        <div><span className="text-muted-foreground">R²:</span> {data.rSquared}</div>
        <div><span className="text-muted-foreground">Slope:</span> {data.slope}</div>
        <div><span className="text-muted-foreground">Intercept:</span> {data.intercept}</div>
        <div><span className="text-muted-foreground">RMSE:</span> {data.rmse}</div>
        <div><span className="text-muted-foreground">MAE:</span> {data.mae}</div>
        <div><span className="text-muted-foreground">MSE:</span> {data.mse}</div>
      </div>
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Residuals</p>
        <div className="flex flex-wrap gap-1">
          {data.residuals.map((r, i) => (
            <span key={i} className={`rounded px-1.5 py-0.5 text-[10px] font-mono ${r > 0 ? "bg-green-500/10 text-green-600" : r < 0 ? "bg-red-500/10 text-red-600" : "bg-muted"}`}>
              {r}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Statistics Form
// ---------------------------------------------------------------------------

function StatsForm({ action, loading, setLoading, error, setError, result, setResult }: FormProps) {
  const [valuesText, setValuesText] = useState("2, 4, 4, 4, 5, 5, 7, 9");

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const values = valuesText.split(/[,\s]+/).map(Number).filter((n) => !isNaN(n));
      if (values.length === 0) throw new Error("Enter at least one number.");
      const r = await action({ values });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
      <p className="text-xs text-muted-foreground">Enter numbers (comma or space separated):</p>
      <input
        value={valuesText}
        onChange={(e) => setValuesText(e.target.value)}
        placeholder="2, 4, 4, 4, 5, 5, 7, 9"
        className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-xs outline-none placeholder:text-muted-foreground/50 focus:border-foreground/30"
      />
      <button
        onClick={() => void handleSubmit()}
        disabled={loading}
        className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-40"
      >
        Calculate Statistics
      </button>
      {result && !error && <StatsResult data={result as StatsResult} />}
    </motion.div>
  );
}

interface StatsResult {
  count: number;
  sum: number;
  mean: number;
  median: number;
  mode: number[];
  min: number;
  max: number;
  range: number;
  variance: number;
  stdDev: number;
  q1: number;
  q3: number;
  iqr: number;
  skewness: number;
  percentiles: Record<string, number>;
}

function StatsResult({ data }: { data: StatsResult }) {
  const Stat = ({ label, value }: { label: string; value: string | number }) => (
    <div className="flex items-baseline justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="font-mono text-xs font-medium">{value}</span>
    </div>
  );

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="grid grid-cols-2 gap-x-6 gap-y-1.5">
        <Stat label="Count" value={data.count} />
        <Stat label="Sum" value={data.sum} />
        <Stat label="Mean" value={data.mean} />
        <Stat label="Median" value={data.median} />
        <Stat label="Mode" value={data.mode.length > 0 ? data.mode.join(", ") : "None"} />
        <Stat label="Min" value={data.min} />
        <Stat label="Max" value={data.max} />
        <Stat label="Range" value={data.range} />
        <Stat label="Variance" value={data.variance} />
        <Stat label="Std Dev" value={data.stdDev} />
        <Stat label="Q1" value={data.q1} />
        <Stat label="Q3" value={data.q3} />
        <Stat label="IQR" value={data.iqr} />
        <Stat label="Skewness" value={data.skewness} />
      </div>
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Percentiles</p>
        <div className="flex flex-wrap gap-1.5">
          {Object.entries(data.percentiles).map(([k, v]) => (
            <span key={k} className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono">
              {k}: {v}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Equation Form
// ---------------------------------------------------------------------------

function EquationForm({ action, loading, setLoading, error, setError, result, setResult }: FormProps) {
  const [eqType, setEqType] = useState<"linear" | "quadratic" | "system2">("linear");
  const [linearA, setLinearA] = useState("2");
  const [linearB, setLinearB] = useState("6");
  const [quadA, setQuadA] = useState("1");
  const [quadB, setQuadB] = useState("-5");
  const [quadC, setQuadC] = useState("6");
  const [sysA1, setSysA1] = useState("2"); const [sysB1, setSysB1] = useState("3"); const [sysC1, setSysC1] = useState("8");
  const [sysA2, setSysA2] = useState("1"); const [sysB2, setSysB2] = useState("-1"); const [sysC2, setSysC2] = useState("-1");

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      let r;
      if (eqType === "linear") {
        r = await action({ type: "linear", a: parseFloat(linearA) || 0, b: parseFloat(linearB) || 0 });
      } else if (eqType === "quadratic") {
        r = await action({ type: "quadratic", a: parseFloat(quadA) || 0, b: parseFloat(quadB) || 0, c: parseFloat(quadC) || 0 });
      } else {
        r = await action({
          type: "system2",
          a1: parseFloat(sysA1) || 0, b1: parseFloat(sysB1) || 0, c1: parseFloat(sysC1) || 0,
          a2: parseFloat(sysA2) || 0, b2: parseFloat(sysB2) || 0, c2: parseFloat(sysC2) || 0,
        });
      }
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
      {/* Type selector */}
      <div className="flex gap-1 rounded-lg bg-muted/50 p-0.5">
        {(["linear", "quadratic", "system2"] as const).map((t) => (
          <button
            key={t}
            onClick={() => { setEqType(t); setResult(null); setError(null); }}
            className={`flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              eqType === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {t === "linear" ? "ax + b = 0" : t === "quadratic" ? "ax²+bx+c=0" : "2×2 System"}
          </button>
        ))}
      </div>

      {/* Input fields */}
      {eqType === "linear" && (
        <div className="flex gap-2">
          <CoeffInput label="a" value={linearA} onChange={setLinearA} />
          <span className="self-center text-sm text-muted-foreground">x +</span>
          <CoeffInput label="b" value={linearB} onChange={setLinearB} />
          <span className="self-center text-sm text-muted-foreground">= 0</span>
        </div>
      )}

      {eqType === "quadratic" && (
        <div className="flex gap-2">
          <CoeffInput label="a" value={quadA} onChange={setQuadA} />
          <span className="self-center text-sm text-muted-foreground">x² +</span>
          <CoeffInput label="b" value={quadB} onChange={setQuadB} />
          <span className="self-center text-sm text-muted-foreground">x +</span>
          <CoeffInput label="c" value={quadC} onChange={setQuadC} />
          <span className="self-center text-sm text-muted-foreground">= 0</span>
        </div>
      )}

      {eqType === "system2" && (
        <div className="space-y-2">
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="w-8 text-center font-medium">Eq 1:</span>
            <CoeffInput label="" value={sysA1} onChange={setSysA1} />x +
            <CoeffInput label="" value={sysB1} onChange={setSysB1} />y =
            <CoeffInput label="" value={sysC1} onChange={setSysC1} />
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <span className="w-8 text-center font-medium">Eq 2:</span>
            <CoeffInput label="" value={sysA2} onChange={setSysA2} />x +
            <CoeffInput label="" value={sysB2} onChange={setSysB2} />y =
            <CoeffInput label="" value={sysC2} onChange={setSysC2} />
          </div>
        </div>
      )}

      <button
        onClick={() => void handleSubmit()}
        disabled={loading}
        className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-40"
      >
        Solve
      </button>
      {result && !error && <EquationResult data={result as EquationResult} />}
    </motion.div>
  );
}

function CoeffInput({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-1">
      {label && <span className="text-[10px] text-muted-foreground">{label} =</span>}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-16 rounded border bg-transparent px-2 py-1 text-center font-mono text-xs outline-none focus:border-foreground/30"
      />
    </div>
  );
}

interface EquationResult {
  type: string;
  equation: string;
  solutions: string[];
  steps: string[];
  discriminant?: number;
  vertex?: { x: number; y: number };
}

function EquationResult({ data }: { data: EquationResult }) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <div className="font-mono text-sm font-semibold">{data.equation}</div>
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Solutions</p>
        {data.solutions.map((s, i) => (
          <p key={i} className="font-mono text-sm font-semibold text-primary">{s}</p>
        ))}
      </div>
      {data.vertex && (
        <p className="text-xs text-muted-foreground">Vertex: ({data.vertex.x}, {data.vertex.y})</p>
      )}
      {data.discriminant !== undefined && (
        <p className="text-xs text-muted-foreground">Discriminant: {data.discriminant}</p>
      )}
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Steps</p>
        <ol className="list-inside list-decimal space-y-0.5">
          {data.steps.map((s, i) => (
            <li key={i} className="text-xs text-muted-foreground">{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Matrix Form
// ---------------------------------------------------------------------------

function MatrixForm({ action, loading, setLoading, error, setError, result, setResult }: FormProps) {
  const [op, setOp] = useState<"determinant" | "inverse" | "transpose" | "multiply" | "eigenvalues">("determinant");
  const [matA, setMatA] = useState("2 1\n1 3");
  const [matB, setMatB] = useState("1 0\n0 1");

  const parseMatrix = (text: string): number[][] =>
    text.trim().split("\n").map((row) => row.split(/[,\s]+/).map(Number).filter((n) => !isNaN(n)));

  const handleSubmit = async () => {
    setLoading(true);
    setError(null);
    try {
      const matrixA = parseMatrix(matA);
      const matrixB = op === "multiply" ? parseMatrix(matB) : undefined;
      const r = await action({ operation: op, matrixA, matrixB });
      setResult(r);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
      {/* Operation selector */}
      <div className="flex flex-wrap gap-1 rounded-lg bg-muted/50 p-0.5">
        {(["determinant", "inverse", "transpose", "multiply", "eigenvalues"] as const).map((o) => (
          <button
            key={o}
            onClick={() => { setOp(o); setResult(null); setError(null); }}
            className={`rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
              op === o ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {o === "determinant" ? "det(A)" : o === "inverse" ? "A⁻¹" : o === "transpose" ? "Aᵀ" : o === "multiply" ? "A·B" : "Eigen"}
          </button>
        ))}
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Matrix A</p>
          <textarea
            value={matA}
            onChange={(e) => setMatA(e.target.value)}
            rows={3}
            className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-foreground/30"
          />
        </div>
        {op === "multiply" && (
          <div className="flex-1">
            <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Matrix B</p>
            <textarea
              value={matB}
              onChange={(e) => setMatB(e.target.value)}
              rows={3}
              className="w-full rounded-lg border bg-transparent px-3 py-2 font-mono text-xs outline-none focus:border-foreground/30"
            />
          </div>
        )}
      </div>

      <button
        onClick={() => void handleSubmit()}
        disabled={loading}
        className="rounded-lg bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-colors hover:opacity-90 disabled:opacity-40"
      >
        Compute
      </button>
      {result && !error && <MatrixResult data={result as MatrixResult} />}
    </motion.div>
  );
}

interface MatrixResult {
  operation: string;
  result: number[][];
  steps: string[];
  determinant?: number;
  eigenvalues?: { real: number; imaginary: number }[];
}

function MatrixResult({ data }: { data: MatrixResult }) {
  const fmtMat = (m: number[][]) => m.map((r) => `[${r.join(", ")}]`).join("\n");

  return (
    <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
      <pre className="font-mono text-xs whitespace-pre-wrap">{fmtMat(data.result)}</pre>
      {data.determinant !== undefined && (
        <p className="text-xs text-muted-foreground">det(A) = {data.determinant}</p>
      )}
      {data.eigenvalues && (
        <div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Eigenvalues</p>
          {data.eigenvalues.map((e, i) => (
            <p key={i} className="font-mono text-xs">
              λ{i + 1} = {e.imaginary === 0 ? e.real : `${e.real} ${e.imaginary > 0 ? "+" : "−"} ${Math.abs(e.imaginary)}i`}
            </p>
          ))}
        </div>
      )}
      <div>
        <p className="mb-1 text-[10px] font-medium uppercase tracking-widest text-muted-foreground">Steps</p>
        <ol className="list-inside list-decimal space-y-0.5">
          {data.steps.map((s, i) => (
            <li key={i} className="text-xs text-muted-foreground">{s}</li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

interface FormProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  action: (...args: any[]) => Promise<any>;
  loading: boolean;
  setLoading: (v: boolean) => void;
  error: string | null;
  setError: (v: string | null) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  result: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  setResult: (v: any) => void;
}
