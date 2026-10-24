/**
 * Ask one question from the terminal: `pnpm ask "What was captured value yesterday?"`.
 * Uses the configured backends (replay by default). Prints the answer and its trace.
 */
import { createStitchAdapter } from "../src/adapters/stitch";
import { resolvedDuckdbPath } from "../src/env";
import { formatValue } from "../src/core/format";
import { ask } from "../src/core/pipeline";

const question = process.argv.slice(2).filter((a) => !a.startsWith("--")).join(" ");
const verbose = process.argv.includes("--trace");
if (!question) {
  console.error('Usage: pnpm ask "your question" [--trace]');
  process.exit(1);
}

const adapter = createStitchAdapter(resolvedDuckdbPath());
const answer = await ask({ question }, { adapter, onEvent: (e) => (e.type === "status" && verbose ? console.log(`  … ${e.text}`) : undefined) });

console.log(`\n${answer.topic}`);
console.log(answer.headline);
for (const s of answer.sentences) console.log(`  ${s}`);
console.log(`form: ${answer.form} (valid: ${answer.validForms.join(", ")})  route: ${answer.route}  source: ${answer.source}`);
const primary = answer.results.find((r) => r.id === answer.primaryResultId);
if (primary?.data.shape === "scalar") console.log(`value: ${formatValue(primary.data.value, primary.unit, "exact")}`);
if (answer.cutClaims.length) console.log(`cut: ${answer.cutClaims.map((c) => `"${c.text}" (${c.reasons.join("; ")})`).join(" | ")}`);
if (answer.error) console.log(`ERROR: ${answer.error.message}`);
if (verbose) {
  for (const t of answer.trace) {
    console.log(`\n[${t.kind}] ${t.title} ${t.ok ? "" : "(failed)"} ${t.latencyMs} ms`);
    for (const [k, v] of t.detail) console.log(`  ${k}: ${v}`);
    for (const s of t.slots ?? []) if (s.route !== "ignored") console.log(`  · ${s.slot}: ${s.choice} (${s.confidence?.toFixed(2) ?? "-"}) ${s.route} -> ${s.final}`);
    for (const q of t.sql ?? []) console.log(q.split("\n").map((l) => `    ${l}`).join("\n"));
  }
}
process.exit(answer.error ? 1 : 0);
