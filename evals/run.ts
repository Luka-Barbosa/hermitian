/**
 * `pnpm eval`: runs every question on replay fixtures (offline, free) and grades
 * it against the generator's answer key. `pnpm eval --live` runs System 1 on
 * Jev through the gateway instead (System 2 replays where it can, otherwise
 * records). Results go to evals/results/; misses are listed, never hidden.
 */
import fs from "node:fs";
import path from "node:path";
import { env, resetEnvCache } from "../src/env";
import type { Form } from "../src/core/types";
import { runQuestions, type EvalRow } from "./lib";

const args = process.argv.slice(2);
const liveArg = args.find((a) => a.startsWith("--live"));
if (liveArg) {
  process.env.DECIDE_BACKEND = liveArg === "--live=gemini" ? "gemini" : "jev";
  process.env.SYSTEM2_BACKEND = "record";
} else {
  process.env.DECIDE_BACKEND = "replay";
  process.env.SYSTEM2_BACKEND = "replay";
}
resetEnvCache();
const e = env();
const backendLabel = liveArg ? (e.DECIDE_BACKEND === "jev" ? "live Jev" : "live simulated Jev (Gemini)") : "replay";

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));
console.log(`Eval on ${backendLabel}\n`);
const { rows } = await runQuestions((r) => {
  console.log(`${r.pass ? "PASS" : "MISS"}  ${pad(r.id, 4)} ${pad(r.question, 70)} ${pad(r.chosenForm, 10)} ${pad(r.route, 9)} ${String(r.latencyMs).padStart(5)} ms${r.pass ? "" : `  ← ${!r.intentOk ? `intent ${r.actualIntent}; ` : ""}${!r.formOk ? `form ${r.chosenForm}; ` : ""}${!r.numbersOk ? "numbers; " : ""}${!r.grounded ? "ungrounded; " : ""}${r.error ?? ""}`}`);
});

// Pass bar (docs: Evaluation and pass bar).
const scenarioRows = rows.filter((r) => r.scenario);
const charts: Form[] = ["line", "hbar", "waterfall", "stacked100"];
const bar = [
  { item: "Every planted scenario returns exactly the right numbers from the database", ok: scenarioRows.every((r) => r.numbersOk && !r.error), detail: `${scenarioRows.filter((r) => r.numbersOk && !r.error).length}/${scenarioRows.length} scenario questions` },
  { item: "Questions expected to return text, a table or a chart come back in that form", ok: rows.every((r) => r.formOk), detail: `${rows.filter((r) => r.formOk).length}/${rows.length} in the expected form` },
  { item: "Each chart type appears correctly at least once", ok: charts.every((f) => rows.some((r) => r.chosenForm === f && r.formOk && r.numbersOk)), detail: charts.map((f) => `${f} ${rows.filter((r) => r.chosenForm === f && r.formOk && r.numbersOk).length}`).join(", ") },
  { item: "No ungrounded claim reaches an answer", ok: rows.every((r) => r.grounded), detail: `${rows.filter((r) => r.grounded).length}/${rows.length} answers fully grounded; ${rows.reduce((a, r) => a + r.cutClaims, 0)} claims cut before display` },
  { item: "Misses are logged in a results table and shown in the demo, not hidden", ok: true, detail: "evals/results/latest.md and the app's Eval page" },
];
const passed = rows.filter((r) => r.pass).length;
const meetsBar = bar.every((b) => b.ok);

console.log(`\n${passed}/${rows.length} questions pass.`);
for (const b of bar) console.log(`${b.ok ? "[x]" : "[ ]"} ${b.item} — ${b.detail}`);
console.log(meetsBar ? "\nPass bar met." : "\nPass bar NOT met.");

// Results files.
const dir = path.join(process.cwd(), "evals", "results");
fs.mkdirSync(dir, { recursive: true });
const summary = {
  ranAt: new Date().toISOString(), backend: backendLabel, decideBackend: e.DECIDE_BACKEND, system2Backend: e.SYSTEM2_BACKEND,
  questions: rows.length, passed, meetsBar, bar, rows,
};
const cell = (s: string) => s.replaceAll("|", "\\|").replaceAll("\n", " ");
const table = (rs: EvalRow[]) => [
  "| ID | Question | Expected answer | Actual answer | Expected form | Chosen form | Route | Latency (model) | Result |",
  "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ...rs.map((r) => `| ${r.id} | ${cell(r.question)} | ${cell(r.expectedAnswer)} | ${cell(r.actualAnswer)} | ${r.expectedForm} | ${r.chosenForm} | ${r.route} | ${r.latencyMs} ms (${r.modelLatencyMs} ms) | ${r.pass ? "pass" : `**miss**${!r.intentOk ? ` (intent: ${r.actualIntent})` : ""}${!r.formOk ? " (form)" : ""}${!r.numbersOk ? " (numbers)" : ""}${!r.grounded ? " (ungrounded)" : ""}`} |`),
];
const md = [
  "# Eval results",
  "",
  `Run ${summary.ranAt} on **${backendLabel}** (System 1: ${e.DECIDE_BACKEND}, System 2: ${e.SYSTEM2_BACKEND}). ${passed}/${rows.length} questions pass. Pass bar ${meetsBar ? "met" : "**not met**"}.`,
  "",
  "Expected answers come from `data/scenarios.json`, tallied by the generator from the rows it wrote, never from the agent's query code. Latency is this run's wall time; in brackets, the model time (recorded live latency for replayed calls).",
  "",
  "## Pass bar",
  "",
  ...bar.map((b) => `- [${b.ok ? "x" : " "}] ${b.item} — ${b.detail}`),
  "",
  "## Misses",
  "",
  ...(rows.some((r) => !r.pass) ? table(rows.filter((r) => !r.pass)) : ["None."]),
  "",
  "## All questions",
  "",
  ...table(rows),
  "",
].join("\n");
fs.writeFileSync(path.join(dir, "latest.json"), `${JSON.stringify(summary, null, 2)}\n`);
fs.writeFileSync(path.join(dir, "latest.md"), md);
if (liveArg) fs.writeFileSync(path.join(dir, `live-${summary.ranAt.slice(0, 10)}.json`), `${JSON.stringify(summary, null, 2)}\n`);
console.log(`\nWrote evals/results/latest.md and latest.json`);
process.exit(meetsBar ? 0 : 1);
