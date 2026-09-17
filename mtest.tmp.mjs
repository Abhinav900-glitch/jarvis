// Ground-truth harness: run the REAL remark-math -> rehype-katex pipeline via
// unified .run() and fail on:
//  (a) any HAST node with class "katex-error"  = the red raw-LaTeX dump
//  (b) any mdast math node whose TeX is pure prose (fence mispairing)
// Display counting uses the MDAST (semantic) — HAST only for katex-error.
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";
import { normalizeMessageContent } from "./src/components/markdown-message.tsx";

const proc = unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeKatex, { throwOnError: false, strict: false, output: "html" });

const parseAst = unified().use(remarkParse).use(remarkMath);

let failures = 0;
async function check(name, content, { minDisplay = 1 } = {}) {
  const norm = normalizeMessageContent(content);

  const hast = await proc.run(proc.parse(norm));
  const errors = [];
  (function visit(node) {
    if (node.type === "element") {
      const cls = node.properties?.className;
      if (Array.isArray(cls) && cls.includes("katex-error")) {
        let src = "";
        (function grab(n) {
          if (n.type === "text") src += n.value;
          if (n.children) n.children.forEach(grab);
        })(node);
        errors.push(src.slice(0, 90));
      }
    }
    if (node.children) node.children.forEach(visit);
  })(hast);

  const ast = parseAst.parse(norm);
  let displayCount = 0;
  const badMath = [];
  const isPureProse = (tex) =>
    /[\u0900-\u097F]/.test(tex) && !/\\|\{|\}|=|\^|_/.test(tex.replace(/\\[,! ]/g, ""));
  (function visit(node) {
    if (node.type === "math") displayCount++;
    if ((node.type === "inlineMath" || node.type === "math") && isPureProse(node.value)) {
      badMath.push(node.value.slice(0, 40));
    }
    if (node.children) node.children.forEach(visit);
  })(ast);

  let ok = errors.length === 0 && badMath.length === 0 && displayCount >= minDisplay;
  const problems = [];
  for (const e of errors) problems.push(`katex-error node with source: "${e}"`);
  for (const b of badMath) problems.push(`prose wrapped as math: "${b}"`);
  if (displayCount < minDisplay)
    problems.push(`expected >=${minDisplay} display blocks, got ${displayCount}`);

  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  for (const p of problems) console.log(`      - ${p}`);
  if (!ok && process.env.DUMP) console.log("NORMALIZED:\n" + norm + "\n");
}

// Real Devanagari via \u escapes; LaTeX backslashes doubled in source.
const C2 =
  "2xm &+ mx^{2}+m^{3}+6m(2x)+(2x)^{2}+2x &=0\\\n" +
  "[2mm] &=2mx+mx^{2}+m^{3}+12mx+4x^{2}+2x &=0 \\end{aligned}$$ \u0938\u092E\u093E\u0928 \u092A\u0926\u094B\u0902 \u0915\u094B \u091C\u094B\u0921\u093C\u0947\u0902:\n" +
  "$$\\boxed{(m+4)x^{2}+(14m+2)x+m^{3}=0}$$ --- ### 2 \u0938\u092D\u0940 $x$ \u0915\u0947 \u0932\u093F\u092F\u0947 \u0936\u0942\u0928\u094D\u092F \u0939\u094B\u0928\u0947 \u0915\u0940 \u0936\u0930\u094D\u0924\n" +
  "$$\\begin{cases} m+4 = 0\\\\[2mm] 14m+2 = 0\\\\[2mm] m^{3}=0 \\end{cases}$$ \u0907\u0928\u0915\u093E \u0939\u0932 \u0915\u094D\u0930\u092E\u0936\u0903:\n" +
  "$$\\begin{aligned} m &= -4,\\\\ m &= -\\dfrac{1}{7},\\\\ m &= 0. \\end{aligned}$$ \u0924\u0940\u0928\u094B\u0902 \u0936\u0930\u094D\u0924\u0947\u0902 \u090F\u0915 \u0939\u0940 $m$ \u092A\u0930 \u0928\u0939\u0940\u0902\u0964";

const C4 =
  "\u0928\u093F\u0937\u094D\u0915\u0930\u094D\u0937 $$\\boxed{\\text{\u0915\u094B\u0908 \u0935\u093E\u0938\u094D\u0924\u0935\u093F\u0915 } m \\text{ \u0928\u0939\u0940\u0902 \u0939\u0948 } y=2x}$$ \u092F\u0926\u093F \u092A\u094D\u0930\u0936\u094D\u0928 \u0915\u093E \u0906\u0936\u092F \u0915\u0947\u0935\u0932 \u090F\u0915 \u092C\u093F\u0902\u0926\u0941 \u0939\u094B\u0964";

const C2b =
  "$$\\begin{aligned} 2xm &+ mx^{2}+m^{3}+6m(2x)+(2x)^{2}+2x &=0\\\n" +
  "[2mm] &=2mx+mx^{2}+m^{3}+12mx+4x^{2}+2x &=0 \\end{aligned}$$ \u0938\u092E\u093E\u0928 \u092A\u0926\u094B\u0902:\n" +
  "$$\\boxed{(m+4)x^{2}+(14m+2)x+m^{3}=0}$$ --- ### 2 \u0938\u092D\u0940 $x$\n" +
  "$$\\begin{cases} m+4 = 0\\\\[2mm] 14m+2 = 0 \\end{cases}$$ \u0907\u0928\u0915\u093E \u0939\u0932:\n" +
  "$$\\begin{aligned} m &= -4,\\\\ m &= 0. \\end{aligned}$$ \u0924\u0940\u0928\u094B\u0902 \u0936\u0930\u094D\u0924\u0947\u0902 $m$ \u092A\u0930\u0964";

await check("C2: orphan closer + Devanagari (screenshot case)", C2, { minDisplay: 3 });
await check("C2b: intact fences + Devanagari", C2b, { minDisplay: 4 });
await check("C4: boxed \\text with Devanagari inside", C4, { minDisplay: 1 });
await check(
  "T1: truncated mid-block",
  "Step:\n$$\\begin{aligned} a &= 1,\\\\ b &= 2 \\end{aligned",
  { minDisplay: 1 },
);
await check("T2: cut right after opener", "Answer:\n$$\\boxed{x = 2", { minDisplay: 1 });
await check(
  "R1: simple inline + display",
  "Value is $x^2$ and\n$$\\boxed{x = \\dfrac{-3 \\pm \\sqrt{5}}{2}}$$\ndone.",
  { minDisplay: 1 },
);
await check(
  "R2: prose parens untouched",
  "The value (r is approximate). See https://en.wikipedia.org/wiki/Mathematics_(field) for more.",
  { minDisplay: 0 },
);
await check("R3: code fence untouched", "Here:\n```python\nx = frac{1}{2}\n```\nDone.", { minDisplay: 0 });
await check(
  "R4: markdown table",
  "| term | quotient |\n|---|---|\n| $x^{6}$ | $\\frac{1}{2}x^{3}$ |",
  { minDisplay: 0 },
);
await check(
  "R5: legacy bracket integral",
  "[ I=\\int\\frac{x^{3}+x^{2}+x^{6}+x^{4}}{4ax^{3}+2ax^{2}+2a}\\,dx ]",
  { minDisplay: 1 },
);
await check("R6: legacy bare frac in prose", "The quotient is frac{1}{2}x^3 so we continue.", { minDisplay: 0 });

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
