import { z } from "zod";
import { env, system2Models } from "../../env";
import { FixtureMissError, readFixture, requestHash, writeFixture } from "../fixtures";
import { geminiObject } from "./gemini";

/**
 * System 2: free Gemini, model configurable per task. It only fills gaps
 * (escalated choices, custom periods, free filter values) and writes the
 * narrative. It never produces a number that reaches the answer unchecked.
 */

export type System2Task = "resolve_slots" | "parse_period" | "parse_amount" | "narrative";

export interface System2Meta {
  task: System2Task;
  backend: "replay" | "record" | "live";
  model: string;
  hash: string;
  tag: string;
  latencyMs: number;
  recordedLatencyMs: number | null;
}

interface System2Fixture {
  hash: string;
  task: System2Task;
  tag: string;
  model: string;
  recordedAt: string;
  latencyMs: number;
  request: { system: string; prompt: string };
  output: unknown;
}

async function run<T>(task: System2Task, tag: string, system: string, prompt: string, schema: z.ZodType<T>): Promise<{ output: T; meta: System2Meta }> {
  const backend = env().SYSTEM2_BACKEND;
  const hash = requestHash({ task, system, prompt });
  const started = performance.now();
  if (backend !== "live") {
    const f = readFixture<System2Fixture>("system2", hash);
    if (f) {
      return {
        output: schema.parse(f.output),
        meta: { task, backend, model: f.model, hash, tag, latencyMs: Math.round(performance.now() - started), recordedLatencyMs: f.latencyMs },
      };
    }
    if (backend === "replay") throw new FixtureMissError("system2", hash, tag);
  }
  const { output, model } = await geminiObject({ models: system2Models(task === "narrative" ? "narrative" : "parse"), system, prompt, schema });
  const latencyMs = Math.round(performance.now() - started);
  if (backend === "record") {
    writeFixture("system2", hash, { hash, task, tag, model, recordedAt: new Date().toISOString(), latencyMs, request: { system, prompt }, output } satisfies System2Fixture);
  }
  return { output, meta: { task, backend, model, hash, tag, latencyMs, recordedLatencyMs: null } };
}

// --- Escalated choices --------------------------------------------------------

export interface SlotToResolve {
  slot: string;
  instructions: string;
  options: Record<string, string | null>;
  system1Choice: string;
  system1Confidence: number;
}

export async function resolveSlots(question: string, context: string, slots: SlotToResolve[]) {
  const schema = z.object({
    choices: z.array(z.object({ slot: z.string(), choice: z.string(), reason: z.string() })),
  });
  const system = [
    "You resolve ambiguous slots for a read-only payments analytics agent.",
    "For each slot, pick exactly one option key from its options. Use none_of_these when nothing fits.",
    "A fast classifier was unsure about these slots; its guess is shown but may be wrong.",
    "Reply with option keys only, plus a one-line reason. Never invent options.",
  ].join("\n");
  const prompt = JSON.stringify({ question, context, slots: slots.map((s) => ({ slot: s.slot, instructions: s.instructions, options: s.options, classifier_guess: s.system1Choice })) }, null, 2);
  const res = await run("resolve_slots", `resolve: ${question}`, system, prompt, schema);
  const valid = res.output.choices.filter((c) => slots.some((s) => s.slot === c.slot && c.choice in s.options));
  return { choices: valid, meta: res.meta };
}

// --- Custom periods -------------------------------------------------------------

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function parsePeriod(question: string, ctx: { asOf: string; dataStart: string; dataEnd: string; wantsComparison: boolean }) {
  const schema = z.object({
    start: isoDate,
    end: isoDate,
    comparison_start: isoDate.nullable(),
    comparison_end: isoDate.nullable(),
    note: z.string(),
  });
  const system = [
    "You turn the time period in an analytics question into explicit dates.",
    `"Today" is ${ctx.asOf}. The data covers ${ctx.dataStart} to ${ctx.dataEnd}. Dates are inclusive, YYYY-MM-DD.`,
    "A single day has start = end. Weeks start on Monday. A named month without a year means the most recent such month on or before today.",
    "If the question names a second period to compare against, return it as comparison_start/comparison_end; otherwise return null for both.",
  ].join("\n");
  const prompt = JSON.stringify({ question, needs_comparison_if_named: ctx.wantsComparison });
  return run("parse_period", `period: ${question}`, system, prompt, schema);
}

// --- Free filter values ---------------------------------------------------------

export async function parseAmount(question: string) {
  const schema = z.object({
    present: z.boolean(),
    op: z.enum(["gt", "gte", "lt", "lte"]).nullable(),
    value_rand: z.number().nullable(),
  });
  const system = [
    "Extract a payment-amount threshold from an analytics question about South African rand payments.",
    "'over R5,000' -> op gt, value_rand 5000. 'at least R1k' -> gte 1000. 'under R200' -> lt 200.",
    "If the question has no amount threshold, return present false and nulls.",
  ].join("\n");
  return run("parse_amount", `amount: ${question}`, system, JSON.stringify({ question }), schema);
}

// --- Narrative --------------------------------------------------------------------

export interface NarrativeInput {
  question: string;
  topic: string;
  form: string;
  facts: string[];
  notes: string[];
}

export async function writeNarrative(input: NarrativeInput) {
  const schema = z.object({
    headline: z.string(),
    sentences: z.array(z.string()).max(3),
  });
  const system = [
    "You write the short narrative for one answer in a payments analytics app.",
    "Use only the facts given. Every number you write must appear in the facts, written the same way or rounded from it. Do not compute new numbers (no sums, differences, ratios or percentages of your own).",
    "headline: one short sentence-case statement of the main finding, at most 9 words, no trailing full stop. Not Title Case.",
    "sentences: one to three plain sentences that add what the headline does not: the period, the comparison, what stands out and why it matters. Do not restate the headline. No filler, no advice, no markdown.",
    "Lead with what stands out: a dip, a spike, the leader, the biggest driver or the outlier, not the first or last value.",
    "Name the period the way the facts do (e.g. 'September 2026', '26 Sep 2026').",
    "Captured value is not revenue; never call it revenue or profit.",
  ].join("\n");
  const res = await run("narrative", `narrative: ${input.question}`, system, JSON.stringify(input, null, 2), schema);
  return res;
}
