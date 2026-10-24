/**
 * `pnpm doctor [--no-gemini] [--no-jev]`: checks config (presence only, never
 * values), the database, one free Gemini call and one Jev call through the
 * gateway (counted against MAX_LIVE_JEV_CALLS). It can run alongside `pnpm dev`:
 * the database is opened read-only.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createStitchAdapter } from "../src/adapters/stitch";
import { describeRoute, isFreeTierBlock, jevDecide, jevRoute } from "../src/core/decide/backends/jev";
import { geminiObject } from "../src/core/system2/gemini";
import { NONE_OF_THESE } from "../src/core/types";
import { env, resolvedDuckdbPath, system2Models } from "../src/env";

const args = process.argv.slice(2);
const results: { check: string; ok: boolean | null; detail: string }[] = [];
const record = (check: string, ok: boolean | null, detail: string) => {
  results.push({ check, ok, detail });
  console.log(`${ok === null ? "SKIP" : ok ? "ok  " : "FAIL"}  ${check.padEnd(22)} ${detail}`);
};

let e: ReturnType<typeof env>;
try {
  e = env();
  record("config", true, "src/env.ts parsed the configuration");
} catch (err) {
  record("config", false, (err as Error).message);
  process.exit(1);
}

record("Gemini key", Boolean(e.GOOGLE_GENERATIVE_AI_API_KEY), e.GOOGLE_GENERATIVE_AI_API_KEY ? "set" : "GOOGLE_GENERATIVE_AI_API_KEY is missing");
const jev = jevRoute();
record("Jev route", "route" in jev, "route" in jev ? describeRoute(jev.route) : jev.error + " (only needed for live Jev)");
record("backends", true, `DECIDE_BACKEND=${e.DECIDE_BACKEND}, SYSTEM2_BACKEND=${e.SYSTEM2_BACKEND}`);

const dbPath = resolvedDuckdbPath();
if (!fs.existsSync(dbPath)) {
  record("database", false, `${path.relative(process.cwd(), dbPath)} not found; run pnpm generate`);
} else {
  try {
    const adapter = createStitchAdapter(dbPath);
    const fields = await adapter.viewFields();
    const missing = Object.entries(fields).filter(([, f]) => f.length === 0).map(([v]) => v);
    const [row] = await adapter.query("SELECT COUNT(*) AS n FROM v_captured_payments");
    record("database", missing.length === 0, missing.length ? `views missing: ${missing.join(", ")}` : `read-only; ${Number(row?.n).toLocaleString("en-US")} captured payments`);
  } catch (err) {
    record("database", false, (err as Error).message);
  }
}
const key = path.join(path.dirname(dbPath), "scenarios.json");
record("answer key", fs.existsSync(key), fs.existsSync(key) ? "data/scenarios.json present" : "missing; run pnpm generate");
const count = (k: string) => (fs.existsSync(path.join("fixtures", k)) ? fs.readdirSync(path.join("fixtures", k)).length : 0);
record("fixtures", count("decide") > 0, `${count("decide")} System 1, ${count("system2")} System 2`);

if (args.includes("--no-gemini")) record("Gemini call", null, "skipped");
else {
  try {
    const t = performance.now();
    const r = await geminiObject({ models: system2Models("parse"), system: "Reply with ok.", prompt: "ok?", schema: z.object({ reply: z.string() }) });
    record("Gemini call", true, `${r.model} answered in ${Math.round(performance.now() - t)} ms`);
  } catch (err) {
    record("Gemini call", false, (err as Error).message.slice(0, 200));
  }
}

if (args.includes("--no-jev")) record("Jev call", null, "skipped");
else {
  try {
    const t = performance.now();
    const r = await jevDecide({
      state: { question: "What was captured value yesterday?" },
      questions: { metric: { type: "choice", instructions: "Which metric does `question` ask about?", criteria: { captured_value: "Captured payment value", approval_rate: "Approval rate", [NONE_OF_THESE]: "None of these" } } },
    });
    const a = r.answers.metric;
    record("Jev call", true, `via ${"route" in jev ? jev.route.kind : "?"}, ${r.model}: ${a?.type === "choice" ? `${a.choice} @ ${a.confidence.toFixed(2)}` : "answered"} in ${Math.round(performance.now() - t)} ms`);
  } catch (err) {
    // A free-tier account cannot use Jev yet: report it, but it is not a fault in this repo.
    if (isFreeTierBlock(err)) record("Jev call", null, `${"route" in jev ? jev.route.kind : "?"} route: 403, account is on the free tier`);
    else record("Jev call", false, `${"route" in jev ? `${jev.route.kind} route: ` : ""}${(err as Error).message.slice(0, 200)}`);
  }
}

process.exit(results.some((r) => r.ok === false) ? 1 : 0);
