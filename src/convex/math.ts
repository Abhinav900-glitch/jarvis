"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

// ---------------------------------------------------------------------------
// Linear Regression
// ---------------------------------------------------------------------------

export const linearRegression = action({
  args: {
    points: v.array(v.object({ x: v.number(), y: v.number() })),
  },
  handler: async (_ctx, args): Promise<{
    slope: number;
    intercept: number;
    rSquared: number;
    equation: string;
    predictions: { x: number; y: number }[];
    residuals: number[];
    mse: number;
    rmse: number;
    mae: number;
  }> => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) throw new Error("Sign in to use this tool.");

    const pts = args.points;
    if (pts.length < 2) throw new Error("Need at least 2 points for regression.");

    const n = pts.length;
    const sumX = pts.reduce((s, p) => s + p.x, 0);
    const sumY = pts.reduce((s, p) => s + p.y, 0);
    const sumXY = pts.reduce((s, p) => s + p.x * p.y, 0);
    const sumX2 = pts.reduce((s, p) => s + p.x * p.x, 0);
    const sumY2 = pts.reduce((s, p) => s + p.y * p.y, 0);

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) throw new Error("All x-values are identical — cannot compute slope.");

    const slope = (n * sumXY - sumX * sumY) / denom;
    const intercept = (sumY - slope * sumX) / n;

    // R²
    const meanY = sumY / n;
    const ssTot = pts.reduce((s, p) => s + (p.y - meanY) ** 2, 0);
    const ssRes = pts.reduce((s, p) => s + (p.y - (slope * p.x + intercept)) ** 2, 0);
    const rSquared = ssTot === 0 ? 1 : 1 - ssRes / ssTot;

    // Residuals + error metrics
    const residuals = pts.map((p) => p.y - (slope * p.x + intercept));
    const mse = residuals.reduce((s, r) => s + r * r, 0) / n;
    const rmse = Math.sqrt(mse);
    const mae = residuals.reduce((s, r) => s + Math.abs(r), 0) / n;

    // Predictions across range
    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const range = maxX - minX || 1;
    const predictions = Array.from({ length: 20 }, (_, i) => {
      const x = minX + (range * i) / 19;
      return { x: Math.round(x * 1000) / 1000, y: Math.round((slope * x + intercept) * 1000) / 1000 };
    });

    const formatNum = (n: number) => {
      if (Number.isInteger(n)) return String(n);
      return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    };

    return {
      slope: Math.round(slope * 10000) / 10000,
      intercept: Math.round(intercept * 10000) / 10000,
      rSquared: Math.round(rSquared * 10000) / 10000,
      equation: `y = ${formatNum(slope)}x + ${formatNum(intercept)}`,
      predictions,
      residuals: residuals.map((r) => Math.round(r * 1000) / 1000),
      mse: Math.round(mse * 10000) / 10000,
      rmse: Math.round(rmse * 10000) / 10000,
      mae: Math.round(mae * 10000) / 10000,
    };
  },
});

// ---------------------------------------------------------------------------
// Statistics Calculator
// ---------------------------------------------------------------------------

export const calculateStats = action({
  args: {
    values: v.array(v.number()),
  },
  handler: async (_ctx, args): Promise<{
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
  }> => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) throw new Error("Sign in to use this tool.");

    const vals = [...args.values].sort((a, b) => a - b);
    if (vals.length === 0) throw new Error("Need at least one value.");

    const n = vals.length;
    const sum = vals.reduce((s, v) => s + v, 0);
    const mean = sum / n;

    // Median
    const median = n % 2 === 0
      ? (vals[n / 2 - 1] + vals[n / 2]) / 2
      : vals[Math.floor(n / 2)];

    // Mode
    const freq = new Map<number, number>();
    vals.forEach((v) => freq.set(v, (freq.get(v) ?? 0) + 1));
    const maxFreq = Math.max(...freq.values());
    const mode = maxFreq > 1
      ? [...freq.entries()].filter(([, f]) => f === maxFreq).map(([v]) => v)
      : [];

    // Variance & std dev (population)
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
    const stdDev = Math.sqrt(variance);

    // Quartiles
    const percentile = (p: number) => {
      const idx = (p / 100) * (n - 1);
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      return lo === hi ? vals[lo] : vals[lo] + (vals[hi] - vals[lo]) * (idx - lo);
    };

    const q1 = percentile(25);
    const q3 = percentile(75);
    const iqr = q3 - q1;

    // Skewness (Fisher)
    const m3 = vals.reduce((s, v) => s + (v - mean) ** 3, 0) / n;
    const skewness = stdDev === 0 ? 0 : m3 / (stdDev ** 3);

    const r = (v: number) => Math.round(v * 10000) / 10000;
    return {
      count: n,
      sum: r(sum),
      mean: r(mean),
      median: r(median),
      mode,
      min: vals[0],
      max: vals[n - 1],
      range: vals[n - 1] - vals[0],
      variance: r(variance),
      stdDev: r(stdDev),
      q1: r(q1),
      q3: r(q3),
      iqr: r(iqr),
      skewness: r(skewness),
      percentiles: {
        p10: r(percentile(10)),
        p25: r(q1),
        p50: r(median),
        p75: r(q3),
        p90: r(percentile(90)),
        p95: r(percentile(95)),
        p99: r(percentile(99)),
      },
    };
  },
});

// ---------------------------------------------------------------------------
// Equation Solver
// ---------------------------------------------------------------------------

export const solveEquation = action({
  args: {
    type: v.union(
      v.literal("linear"),
      v.literal("quadratic"),
      v.literal("system2"),
    ),
    // Linear: ax + b = 0
    a: v.optional(v.number()),
    b: v.optional(v.number()),
    // Quadratic: ax² + bx + c = 0
    c: v.optional(v.number()),
    // System: a1*x + b1*y = c1, a2*x + b2*y = c2
    a1: v.optional(v.number()),
    b1: v.optional(v.number()),
    c1: v.optional(v.number()),
    a2: v.optional(v.number()),
    b2: v.optional(v.number()),
    c2: v.optional(v.number()),
  },
  handler: async (_ctx, args): Promise<{
    type: string;
    equation: string;
    solutions: string[];
    steps: string[];
    discriminant?: number;
    vertex?: { x: number; y: number };
  }> => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) throw new Error("Sign in to use this tool.");

    const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");

    if (args.type === "linear") {
      const a = args.a ?? 0;
      const b = args.b ?? 0;
      if (a === 0) {
        if (b === 0) return { type: "linear", equation: `0 = 0`, solutions: ["Infinite solutions (identity)"], steps: ["0 = 0 is always true."] };
        return { type: "linear", equation: `${fmt(b)} = 0`, solutions: ["No solution (contradiction)"], steps: [`${fmt(b)} ≠ 0`] };
      }
      const x = -b / a;
      return {
        type: "linear",
        equation: `${fmt(a)}x + ${fmt(b)} = 0`,
        solutions: [`x = ${fmt(x)}`],
        steps: [
          `${fmt(a)}x = ${fmt(-b)}`,
          `x = ${fmt(-b)} / ${fmt(a)}`,
          `x = ${fmt(x)}`,
        ],
      };
    }

    if (args.type === "quadratic") {
      const a = args.a ?? 0;
      const b = args.b ?? 0;
      const c_val = args.c ?? 0;
      const disc = b * b - 4 * a * c_val;

      if (a === 0) {
        // Degenerate to linear
        if (b === 0) {
          return { type: "quadratic", equation: `${fmt(c_val)} = 0`, solutions: c_val === 0 ? ["Infinite solutions"] : ["No solution"], steps: ["Coefficient of x² is 0."] };
        }
        const x = -c_val / b;
        return { type: "quadratic", equation: `${fmt(b)}x + ${fmt(c_val)} = 0`, solutions: [`x = ${fmt(x)}`], steps: ["Degenerates to linear.", `x = ${fmt(-c_val)} / ${fmt(b)} = ${fmt(x)}`] };
      }

      const vertexX = -b / (2 * a);
      const vertexY = a * vertexX * vertexX + b * vertexX + c_val;

      const steps = [
        `a = ${fmt(a)}, b = ${fmt(b)}, c = ${fmt(c_val)}`,
        `Discriminant Δ = b² − 4ac = ${fmt(b)}² − 4·${fmt(a)}·${fmt(c_val)} = ${fmt(disc)}`,
      ];

      let solutions: string[];
      if (disc > 0) {
        const x1 = (-b + Math.sqrt(disc)) / (2 * a);
        const x2 = (-b - Math.sqrt(disc)) / (2 * a);
        solutions = [`x₁ = ${fmt(x1)}`, `x₂ = ${fmt(x2)}`];
        steps.push(`Δ > 0 → two real roots`);
        steps.push(`x₁ = ${fmt(x1)}, x₂ = ${fmt(x2)}`);
      } else if (disc === 0) {
        const x = -b / (2 * a);
        solutions = [`x = ${fmt(x)} (repeated)`];
        steps.push(`Δ = 0 → one repeated real root`);
        steps.push(`x = ${fmt(x)}`);
      } else {
        const realPart = -b / (2 * a);
        const imagPart = Math.sqrt(-disc) / (2 * a);
        solutions = [`x₁ = ${fmt(realPart)} + ${fmt(imagPart)}i`, `x₂ = ${fmt(realPart)} − ${fmt(imagPart)}i`];
        steps.push(`Δ < 0 → two complex conjugate roots`);
        steps.push(`x = ${fmt(realPart)} ± ${fmt(imagPart)}i`);
      }

      return {
        type: "quadratic",
        equation: `${fmt(a)}x² + ${fmt(b)}x + ${fmt(c_val)} = 0`,
        solutions,
        steps,
        discriminant: Math.round(disc * 10000) / 10000,
        vertex: { x: Math.round(vertexX * 10000) / 10000, y: Math.round(vertexY * 10000) / 10000 },
      };
    }

    if (args.type === "system2") {
      const a1 = args.a1 ?? 0, b1 = args.b1 ?? 0, c1 = args.c1 ?? 0;
      const a2 = args.a2 ?? 0, b2 = args.b2 ?? 0, c2 = args.c2 ?? 0;
      const det = a1 * b2 - a2 * b1;

      const steps = [
        `Eq 1: ${fmt(a1)}x + ${fmt(b1)}y = ${fmt(c1)}`,
        `Eq 2: ${fmt(a2)}x + ${fmt(b2)}y = ${fmt(c2)}`,
        `Determinant D = ${fmt(a1)}·${fmt(b2)} − ${fmt(a2)}·${fmt(b1)} = ${fmt(det)}`,
      ];

      if (Math.abs(det) < 1e-10) {
        // Check if parallel or coincident
        const ratio1 = a1 !== 0 ? b1 / a1 : Infinity;
        const ratio2 = a2 !== 0 ? b2 / a2 : Infinity;
        const isCoincident = Math.abs(ratio1 - ratio2) < 1e-10 &&
          Math.abs((a1 !== 0 ? c1 / a1 : c2 / b2) - (a2 !== 0 ? c1 / a2 : c2 / b2)) < 1e-10;
        if (isCoincident) {
          steps.push("Equations are dependent (coincident lines).");
          return { type: "system2", equation: `System`, solutions: ["Infinite solutions (coincident lines)"], steps };
        }
        steps.push("Equations are parallel (no intersection).");
        return { type: "system2", equation: `System`, solutions: ["No solution (parallel lines)"], steps };
      }

      const x = (c1 * b2 - c2 * b1) / det;
      const y = (a1 * c2 - a2 * c1) / det;
      steps.push(`x = (${fmt(c1)}·${fmt(b2)} − ${fmt(c2)}·${fmt(b1)}) / ${fmt(det)} = ${fmt(x)}`);
      steps.push(`y = (${fmt(a1)}·${fmt(c2)} − ${fmt(a2)}·${fmt(c1)}) / ${fmt(det)} = ${fmt(y)}`);

      return {
        type: "system2",
        equation: `System of 2 equations`,
        solutions: [`x = ${fmt(x)}`, `y = ${fmt(y)}`],
        steps,
      };
    }

    throw new Error("Unknown equation type.");
  },
});

// ---------------------------------------------------------------------------
// Matrix Operations
// ---------------------------------------------------------------------------

export const matrixOperation = action({
  args: {
    operation: v.union(
      v.literal("multiply"),
      v.literal("determinant"),
      v.literal("inverse"),
      v.literal("transpose"),
      v.literal("eigenvalues"),
    ),
    matrixA: v.array(v.array(v.number())),
    matrixB: v.optional(v.array(v.array(v.number()))),
  },
  handler: async (_ctx, args): Promise<{
    operation: string;
    result: number[][];
    steps: string[];
    determinant?: number;
    eigenvalues?: { real: number; imaginary: number }[];
  }> => {
    const userId = await getAuthUserId(_ctx);
    if (userId === null) throw new Error("Sign in to use this tool.");

    const A = args.matrixA;
    const fmt = (n: number) => Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
    const matStr = (m: number[][]) => m.map((r) => `[${r.map(fmt).join(", ")}]`).join("\n");

    if (args.operation === "transpose") {
      const rows = A.length, cols = A[0]?.length ?? 0;
      const result = Array.from({ length: cols }, (_, j) =>
        Array.from({ length: rows }, (_, i) => A[i][j])
      );
      return { operation: "transpose", result, steps: [`A^T = ${matStr(result)}`] };
    }

    if (args.operation === "determinant") {
      const det = determinant(A);
      return { operation: "determinant", result: A, steps: [`det(A) = ${fmt(det)}`], determinant: Math.round(det * 10000) / 10000 };
    }

    if (args.operation === "inverse") {
      const inv = inverseMatrix(A);
      return { operation: "inverse", result: inv, steps: [`A⁻¹ = ${matStr(inv)}`] };
    }

    if (args.operation === "multiply") {
      const B = args.matrixB;
      if (!B) throw new Error("Matrix B is required for multiplication.");
      if (A[0].length !== B.length) throw new Error(`Cannot multiply: A is ${A.length}×${A[0].length}, B is ${B.length}×${B[0].length}.`);
      const result = multiplyMatrices(A, B);
      return { operation: "multiply", result, steps: [`A·B = ${matStr(result)}`] };
    }

    if (args.operation === "eigenvalues") {
      if (A.length !== 2 || A[0].length !== 2) throw new Error("Eigenvalue computation currently supports 2×2 matrices only.");
      const a = A[0][0], b = A[0][1], c = A[1][0], d = A[1][1];
      const trace = a + d;
      const det = a * d - b * c;
      const disc = trace * trace - 4 * det;

      const steps = [
        `Trace = ${fmt(trace)}, Determinant = ${fmt(det)}`,
        `Characteristic eq: λ² − ${fmt(trace)}λ + ${fmt(det)} = 0`,
        `Discriminant = ${fmt(disc)}`,
      ];

      let eigenvalues: { real: number; imaginary: number }[];
      if (disc >= 0) {
        const l1 = (trace + Math.sqrt(disc)) / 2;
        const l2 = (trace - Math.sqrt(disc)) / 2;
        eigenvalues = [{ real: l1, imaginary: 0 }, { real: l2, imaginary: 0 }];
        steps.push(`λ₁ = ${fmt(l1)}, λ₂ = ${fmt(l2)}`);
      } else {
        const real = trace / 2;
        const imag = Math.sqrt(-disc) / 2;
        eigenvalues = [
          { real, imaginary: imag },
          { real, imaginary: -imag },
        ];
        steps.push(`λ = ${fmt(real)} ± ${fmt(imag)}i`);
      }

      return { operation: "eigenvalues", result: A, steps, eigenvalues };
    }

    throw new Error("Unknown operation.");
  },
});

// ---------------------------------------------------------------------------
// Matrix helper functions
// ---------------------------------------------------------------------------

function determinant(m: number[][]): number {
  const n = m.length;
  if (n === 1) return m[0][0];
  if (n === 2) return m[0][0] * m[1][1] - m[0][1] * m[1][0];
  let det = 0;
  for (let j = 0; j < n; j++) {
    const minor = m.slice(1).map((r) => [...r.slice(0, j), ...r.slice(j + 1)]);
    det += ((-1) ** j) * m[0][j] * determinant(minor);
  }
  return det;
}

function inverseMatrix(m: number[][]): number[][] {
  const n = m.length;
  if (n === 1) return [[1 / m[0][0]]];
  if (n === 2) {
    const det = m[0][0] * m[1][1] - m[0][1] * m[1][0];
    if (Math.abs(det) < 1e-10) throw new Error("Matrix is singular (determinant = 0).");
    return [
      [m[1][1] / det, -m[0][1] / det],
      [-m[1][0] / det, m[0][0] / det],
    ];
  }
  // Gaussian elimination for larger matrices
  const aug = m.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) if (Math.abs(aug[k][i]) > Math.abs(aug[maxRow][i])) maxRow = k;
    [aug[i], aug[maxRow]] = [aug[maxRow], aug[i]];
    if (Math.abs(aug[i][i]) < 1e-10) throw new Error("Matrix is singular (determinant ≈ 0).");
    for (let j = i + 1; j < n; j++) {
      const factor = aug[j][i] / aug[i][i];
      for (let k = i; k < 2 * n; k++) aug[j][k] -= factor * aug[i][k];
    }
  }
  for (let i = n - 1; i >= 0; i--) {
    for (let j = i - 1; j >= 0; j--) {
      const factor = aug[j][i] / aug[i][i];
      for (let k = i; k < 2 * n; k++) aug[j][k] -= factor * aug[i][k];
    }
  }
  return aug.map((r) => r.slice(n).map((v) => Math.round(v * 10000) / 10000));
}

function multiplyMatrices(a: number[][], b: number[][]): number[][] {
  const rows = a.length, cols = b[0].length, inner = b.length;
  return Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) =>
      Math.round(a[i].reduce((s, _, k) => s + a[i][k] * b[k][j], 0) * 10000) / 10000
    )
  );
}
