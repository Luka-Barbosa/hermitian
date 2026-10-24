import fs from "node:fs";
import path from "node:path";
import { createStitchAdapter } from "../src/adapters/stitch";
import type { Answer } from "../src/core/answer";
import { allowedFrom, checkClaim } from "../src/core/gates/grounding";
import { ask } from "../src/core/pipeline";
import type { QueryResult } from "../src/core/results";
import type { Form } from "../src/core/types";
import { resolvedDuckdbPath } from "../src/env";

/** Shared by `pnpm eval` and `pnpm fixtures:record`: the question set and how each answer is graded. */

export interface Check {
  kind: string;
  [k: string]: unknown;
}

export interface EvalQuestion {
  id: string;
  question: string;
  intent: string | string[];
  forms: Form[];
  scenario?: string;
  followUpOf?: string;
  checks: Check[];
}

export interface CheckOutcome {
  kind: string;
  pass: boolean;
  expected: string;
  actual: string;
}

export interface EvalRow {
  id: string;
  question: string;
  scenario: string | null;
  expectedIntent: string;
  actualIntent: string;
  expectedForm: string;
  chosenForm: string;
  expectedAnswer: string;
  actualAnswer: string;
  route: string;
  latencyMs: number;
  modelLatencyMs: number;
  checks: CheckOutcome[];
  formOk: boolean;
  intentOk: boolean;
  numbersOk: boolean;
  grounded: boolean;
  cutClaims: number;
  error: string | null;
  pass: boolean;
  headline: string;
}

export function loadKey(): Record<string, unknown> {
  const file = path.join(path.dirname(resolvedDuckdbPath()), "scenarios.json");
  if (!fs.existsSync(file)) throw new Error(`Missing ${file}. Run \`pnpm generate\` first.`);
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

export function loadQuestions(): EvalQuestion[] {
  const raw = JSON.parse(fs.readFileSync(path.join(process.cwd(), "evals", "questions.json"), "utf8"));
  return raw.questions as EvalQuestion[];
}

/** Resolves paths like `months[month=2026-09].capturedValue`, `a[0].b`, `list[*].id` against the answer key. */
export function resolvePath(root: unknown, p: string): unknown {
  const parts = p.match(/[^.[\]]+|\[[^\]]*\]/g) ?? [];
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === undefined || cur === null) return undefined;
    if (part.startsWith("[")) {
      const inner = part.slice(1, -1);
      if (inner === "*") continue;
      if (/^\d+$/.test(inner)) {
        cur = (cur as unknown[])[Number(inner)];
        continue;
      }
      const [k, v] = inner.split("=");
      cur = (cur as Record<string, unknown>[]).find((item) => String(resolvePath(item, k!)) === v);
      continue;
    }
    cur = Array.isArray(cur) ? cur.map((x) => (x as Record<string, unknown>)[part]) : (cur as Record<string, unknown>)[part];
  }
  return cur;
}

export function fillTemplate(text: string, key: unknown): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (_, p: string) => String(resolvePath(key, p.trim())));
}

const fmt = (x: unknown) => (typeof x === "number" ? (Number.isInteger(x) ? String(x) : x.toPrecision(10)) : JSON.stringify(x));

function close(actual: unknown, expected: unknown, unit: unknown): boolean {
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  if (unit === "zar") return Math.abs(actual - expected) < 0.005;
  if (unit === "count") return actual === expected;
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

function primary(a: Answer): QueryResult | undefined {
  return a.results.find((r) => r.id === a.primaryResultId);
}

export function runChecks(q: EvalQuestion, a: Answer, key: unknown): CheckOutcome[] {
  const r = primary(a);
  const d = r?.data;
  return q.checks.map((c): CheckOutcome => {
    const exp = (k: string) => resolvePath(key, String(c[k]));
    const out = (pass: boolean, expected: unknown, actual: unknown): CheckOutcome => ({ kind: c.kind, pass, expected: fmt(expected), actual: fmt(actual) });
    switch (c.kind) {
      case "scalar":
        return out(d?.shape === "scalar" && close(d.value, exp("expect"), c.unit), exp("expect"), d?.shape === "scalar" ? d.value : d?.shape);
      case "delta":
        return out(
          d?.shape === "delta" && close(d.current, exp("current"), c.unit) && close(d.previous, exp("previous"), c.unit),
          `${fmt(exp("current"))} vs ${fmt(exp("previous"))}`,
          d?.shape === "delta" ? `${fmt(d.current)} vs ${fmt(d.previous)}` : d?.shape,
        );
      case "series_point": {
        const p = d?.shape === "series" ? d.series[0]?.points.find((x) => x.key === c.key) : undefined;
        return out(close(p?.value, exp("expect"), c.unit), `${c.key}: ${fmt(exp("expect"))}`, `${c.key}: ${fmt(p?.value)}`);
      }
      case "series_max": {
        const pts = d?.shape === "series" ? (d.series[0]?.points ?? []).filter((x) => x.value !== null) : [];
        const max = pts.reduce<(typeof pts)[number] | undefined>((m, x) => (!m || x.value! > m.value! ? x : m), undefined);
        return out(max?.key === c.key, `max at ${c.key}`, `max at ${max?.key}`);
      }
      case "series_min_in": {
        const pts = d?.shape === "series" ? (d.series[0]?.points ?? []).filter((x) => x.value !== null) : [];
        const min = pts.reduce<(typeof pts)[number] | undefined>((m, x) => (!m || x.value! < m.value! ? x : m), undefined);
        return out(Boolean(min && (c.keys as string[]).includes(min.key)), `min in ${(c.keys as string[]).join(", ")}`, `min at ${min?.key}`);
      }
      case "share_cell": {
        const cell = d?.shape === "share_matrix" ? d.cells.find((x) => x.bucket === c.bucket && x.category === c.category) : undefined;
        return out(close(cell?.share, exp("expect"), "ratio"), `${c.bucket} ${c.category}: ${fmt(exp("expect"))}`, `${fmt(cell?.share)}`);
      }
      case "item": {
        const it = d?.shape === "categories" ? d.items.find((x) => x.label === c.label) : undefined;
        return out(close(it?.value, exp("expect"), c.unit), `${c.label}: ${fmt(exp("expect"))}`, `${c.label}: ${fmt(it?.value)}`);
      }
      case "item_share": {
        const it = d?.shape === "categories" ? d.items.find((x) => x.label === c.label) : undefined;
        return out(close(it?.share, exp("expect"), "ratio"), `${c.label} share ${fmt(exp("expect"))}`, `${fmt(it?.share)}`);
      }
      case "top_item": {
        const it = d?.shape === "categories" ? d.items[0] : undefined;
        return out(it?.label === exp("expectLabel") && close(it?.value, exp("expect"), c.unit), `${fmt(exp("expectLabel"))} ${fmt(exp("expect"))}`, `${fmt(it?.label)} ${fmt(it?.value)}`);
      }
      case "top_items_set": {
        const labels = d?.shape === "categories" ? d.items.slice(0, Number(c.n)).map((x) => x.label).sort() : [];
        const want = [...((exp("expect") as string[]) ?? [])].sort();
        return out(JSON.stringify(labels) === JSON.stringify(want), want.join(","), labels.join(","));
      }
      case "contribution": {
        if (d?.shape !== "contribution") return out(false, "contribution", d?.shape);
        const steps = (exp("steps") as { key: string; delta: number }[]) ?? [];
        const stepsOk = steps.every((s) => close(d.steps.find((x) => x.label === s.key)?.delta, s.delta, "zar")) && d.steps.length === steps.length;
        const ok = close(d.start, exp("start"), "zar") && close(d.end, exp("end"), "zar") && close(d.change, exp("change"), "zar") && stepsOk;
        return out(ok, `${fmt(exp("start"))} → ${fmt(exp("end"))}, ${steps.length} steps`, `${fmt(d.start)} → ${fmt(d.end)}, ${d.steps.map((s) => `${s.label} ${s.delta.toFixed(2)}`).join("; ")}`);
      }
      case "contribution_rates": {
        if (d?.shape !== "contribution") return out(false, "contribution", d?.shape);
        return out(close(d.start, exp("start"), "ratio") && close(d.end, exp("end"), "ratio"), `${fmt(exp("start"))} → ${fmt(exp("end"))}`, `${fmt(d.start)} → ${fmt(d.end)}`);
      }
      case "top_step": {
        const s = d?.shape === "contribution" ? [...d.steps].sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))[0] : undefined;
        return out(s?.label === exp("expectLabel"), `largest step ${fmt(exp("expectLabel"))}`, `${fmt(s?.label)}`);
      }
      case "records": {
        if (d?.shape !== "records") return out(false, "records", d?.shape);
        const want = (exp("ids") as string[]).slice(0, d.rows.length);
        const got = d.rows.map((row) => String(row[String(c.idColumn)]));
        return out(JSON.stringify(got) === JSON.stringify(want) && d.totalMatching === exp("total"), `${want.length} ids, ${fmt(exp("total"))} total`, `${got.length} ids${JSON.stringify(got) === JSON.stringify(want) ? " (match)" : ` ${got.join(",")}`}, ${d.totalMatching} total`);
      }
      case "records_total":
        return out(d?.shape === "records" && d.totalMatching === exp("total"), `${fmt(exp("total"))} matching`, d?.shape === "records" ? `${d.totalMatching} matching` : d?.shape);
      case "plan_period":
        return out(a.plan?.period.start === c.start && a.plan?.period.end === c.end, `${c.start} to ${c.end}`, `${a.plan?.period.start} to ${a.plan?.period.end}`);
      case "no_query":
        return out(a.results.length === 0 && a.outOfScope, "no query, out of scope", `${a.results.length} queries${a.outOfScope ? ", out of scope" : ""}`);
      default:
        return out(false, `unknown check ${c.kind}`, "");
    }
  });
}

/** Re-checks the final text against the results: nothing ungrounded may reach the answer. */
export function groundedFinal(a: Answer): boolean {
  if (a.outOfScope || a.error) return true;
  const context = [a.plan?.rank?.limit, a.plan?.records?.limit].filter((x): x is number => typeof x === "number");
  const allowed = allowedFrom(a.results, context);
  return [a.headline, ...a.sentences].every((t) => checkClaim(t, allowed).ok);
}

export function grade(q: EvalQuestion, a: Answer, key: unknown, questionText: string): EvalRow {
  const checks = a.error ? [] : runChecks(q, a, key);
  const intents = Array.isArray(q.intent) ? q.intent : [q.intent];
  const actualIntent = a.outOfScope ? "out_of_scope" : (a.plan?.intent ?? "none");
  const formOk = q.forms.includes(a.form);
  const intentOk = intents.includes(actualIntent);
  const numbersOk = !a.error && checks.every((c) => c.pass);
  const grounded = groundedFinal(a);
  return {
    id: q.id, question: questionText, scenario: q.scenario ?? null,
    expectedIntent: intents.join(" | "), actualIntent, expectedForm: q.forms.join(" | "), chosenForm: a.form,
    expectedAnswer: checks.map((c) => c.expected).join("; ") || "—",
    actualAnswer: a.error ? `error: ${a.error.message}` : checks.map((c) => c.actual).join("; ") || "—",
    route: a.route === "escalated" ? "escalated" : "System 1", latencyMs: a.latencyMs, modelLatencyMs: a.modelLatencyMs,
    checks, formOk, intentOk, numbersOk, grounded, cutClaims: a.cutClaims.length, error: a.error?.message ?? null,
    pass: formOk && intentOk && numbersOk && grounded && !a.error, headline: a.headline,
  };
}

export async function runQuestions(onRow?: (row: EvalRow, answer: Answer) => void, only?: Set<string>) {
  const key = loadKey();
  const questions = loadQuestions();
  const adapter = createStitchAdapter(resolvedDuckdbPath());
  const answers = new Map<string, Answer>();
  const rows: EvalRow[] = [];
  for (const q of questions) {
    if (only && !only.has(q.id) && !(q.followUpOf && only.has(q.followUpOf))) continue;
    const text = fillTemplate(q.question, key);
    const prev = q.followUpOf ? answers.get(q.followUpOf) : undefined;
    const a = await ask({ question: text, turn: rows.length + 1, ...(prev ? { followUp: prev.followUp } : {}) }, { adapter });
    answers.set(q.id, a);
    const row = grade(q, a, key, text);
    rows.push(row);
    onRow?.(row, a);
  }
  return { rows, answers };
}
