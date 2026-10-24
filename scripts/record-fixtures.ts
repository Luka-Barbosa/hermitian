/**
 * `pnpm fixtures:record [--via=jev|gemini] [--only=R1,E1] [--refresh] [--prune]`
 *
 * Runs the eval questions in record mode: existing fixtures are replayed,
 * missing ones are fetched live and saved to fixtures/. Jev calls are capped
 * by MAX_LIVE_JEV_CALLS. `--via=gemini` records simulated Jev on free Gemini.
 * `--refresh` re-records System 1 fixtures that another source produced (e.g. simulated Jev),
 * so `--via=jev --refresh` replaces them with real Jev answers. Without it, existing fixtures replay.
 * `--prune` deletes fixtures no question used (only after a clean full run).
 */
import fs from "node:fs";
import path from "node:path";
import { liveJevCallsMade } from "../src/core/decide/backends/jev";
import { fixturesRoot, usedFixtures } from "../src/core/fixtures";
import { liveGeminiCallsMade } from "../src/core/system2/gemini";
import { env, resetEnvCache } from "../src/env";
import { runQuestions } from "../evals/lib";

const args = process.argv.slice(2);
const via = args.find((a) => a.startsWith("--via="))?.slice(6);
const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",");
const prune = args.includes("--prune");

const base = env();
process.env.DECIDE_BACKEND = "record";
process.env.SYSTEM2_BACKEND = "record";
if (via) process.env.RECORD_VIA = via;
if (args.includes("--refresh")) process.env.RECORD_REFRESH = "1";
// Fast free-tier models per task unless the config names its own.
const chosen: string[] = [];
const prefer = (name: "DECIDE_SIM_MODEL" | "SYSTEM2_MODEL_PARSE" | "SYSTEM2_MODEL_NARRATIVE", model: string) => {
  if (!base[name]) {
    process.env[name] = model;
    chosen.push(`${name}=${model}`);
  }
};
prefer("DECIDE_SIM_MODEL", "gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3-flash-preview");
prefer("SYSTEM2_MODEL_PARSE", "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3-flash-preview");
prefer("SYSTEM2_MODEL_NARRATIVE", "gemini-3.5-flash,gemini-3.5-flash-lite,gemini-flash-lite-latest,gemini-3-flash-preview");
resetEnvCache();
const e = env();
console.log(`Recording: System 1 via ${e.RECORD_VIA}${e.RECORD_VIA === "jev" ? ` (cap ${e.MAX_LIVE_JEV_CALLS} live calls)` : " (simulated Jev)"}, System 2 via Gemini.`);
if (chosen.length) console.log(`Per-task models: ${chosen.join(", ")}`);

let errors = 0;
const { rows } = await runQuestions(
  (r) => {
    if (r.error) errors++;
    console.log(`${r.error ? "ERR " : "ok  "} ${r.id.padEnd(4)} ${r.question.slice(0, 80).padEnd(80)} ${r.error ?? ""}  [live Jev ${liveJevCallsMade()}, Gemini ${liveGeminiCallsMade()}]`);
  },
  only ? new Set(only) : undefined,
);

console.log(`\n${rows.length} questions, ${errors} errors. Live calls this run: Jev ${liveJevCallsMade()}, Gemini ${liveGeminiCallsMade()}.`);
if (prune) {
  if (errors || only) {
    console.log("Not pruning: run every question without errors first.");
  } else {
    let removed = 0;
    for (const kind of ["decide", "system2"]) {
      const dir = path.join(fixturesRoot(), kind);
      if (!fs.existsSync(dir)) continue;
      for (const f of fs.readdirSync(dir)) {
        if (!usedFixtures.has(path.join(kind, f))) {
          fs.rmSync(path.join(dir, f));
          removed++;
        }
      }
    }
    console.log(`Pruned ${removed} unused fixtures.`);
  }
}
process.exit(errors ? 1 : 0);
