import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkMath from "remark-math";
import remarkRehype from "remark-rehype";
import rehypeKatex from "rehype-katex";

const md = unified()
  .use(remarkParse)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeKatex, { throwOnError: false, strict: false, output: "html" });

function walk(node, stats) {
  if (!node || typeof node !== "object") return;
  if (node.tagName === "span" && node.properties) {
    const cls = node.properties.className ?? [];
    if (cls.includes("katex-display")) stats.display++;
    if (cls.includes("katex-error")) {
      stats.errors++;
      stats.errorTex.push(
        (node.children ?? []).map((c) => (c.type === "text" ? c.value : "")).join(""),
      );
    }
    if (cls.includes("katex")) stats.katex++;
  }
  for (const child of node.children ?? []) walk(child, stats);
}

async function render(name, raw) {
  const tree = await md.run(md.parse(raw));
  const stats = { display: 0, katex: 0, errors: 0, errorTex: [] };
  walk(tree, stats);
  console.log(`${name}: display=${stats.display} katex=${stats.katex} errors=${stats.errors}`);
  for (const tex of stats.errorTex.slice(0, 1))
    console.log("   ERROR:", JSON.stringify(tex.slice(0, 140)));
}

// Multi-line $$ with REAL blank lines around it — the ideal form
await render("M1_multilineBlankLines", `Before.

$$
\\begin{aligned} 2xm &+ mx^{2} &=0\\\\
[2mm] &=2mx
\\end{aligned}
$$

After.`);

// Multi-line $$ opening fence shares line with TeX start
await render("M2_openInlineTeX", `Before.

$$\\begin{aligned} 2xm &+ mx^{2} &=0\\\\
[2mm] &=2mx
\\end{aligned}$$

After.`);

// Multi-line $$ closing fence shares line with \end
await render("M3_closeInlineTeX", `Before.

$$
\\begin{aligned} 2xm &+ mx^{2} &=0\\\\
[2mm] &=2mx \\end{aligned}$$

After.`);

// Both fences share lines with content
await render("M4_bothInline", `Before.

$$\\begin{aligned} 2xm &+ mx^{2} &=0\\\\
[2mm] &=2mx \\end{aligned}$$

After.`);

// Single-line block (known working)
await render("M5_singleLine", `Before.

$$\\begin{aligned} a &= b \\end{aligned}$$

After.`);
