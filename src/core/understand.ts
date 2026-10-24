import type { Catalog, DimensionDef } from "./catalog";
import { decide, type ChoiceAnswer, type ChoiceQuestion, type DecideMeta, type DecideQuestions, type NoulQuestion } from "./decide";
import { noulConfidence } from "./decide/confidence";
import type { DimensionFilter } from "./plan/schema";
import { resolveSlots, type SlotToResolve, type System2Meta } from "./system2";
import type { SlotTrace } from "./trace";
import { GRAINS, INTENTS, NONE_OF_THESE, PERIOD_PRESETS, type Grain, type Intent, type JsonValue, type PeriodPreset } from "./types";

/**
 * System 1 reads the question once and answers a batch of typed questions
 * (intent, metric, period, breakdown, filters, ...). Confidence routes the
 * work: confident choices are acted on, unsure or "none of these" answers on
 * slots that matter for the intent escalate to System 2.
 */

export const CONFIDENCE_THRESHOLD = 0.5;
const OUT_OF_SCOPE_YES = 0.5;

const INTENT_OPTIONS: Record<Intent, string> = {
  lookup: "A single figure for one period: what was, how much, how many",
  compare: "One figure in one period against another period: compare, versus, vs last month, up or down on",
  trend: "How a figure moved over time: trend, over time, daily, hourly, by day or by hour, how has it moved",
  breakdown: "How a total splits across groups, or the mix or share of each group, possibly by month",
  ranking: "Which group is highest or lowest: which, top, worst, best, most, least, rank",
  explain_change: "Why a figure went up or down: why, what drove, what explains the change",
  record_listing: "Individual records: list or show specific payments, refunds or chargebacks",
  out_of_scope: "Cannot be answered from payment records: predictions, forecasts, credit risk, judgements about people, or data not held",
};

const PERIOD_OPTIONS: Record<PeriodPreset | "custom" | "not_stated", string> = {
  today: "Today, the latest day in the data",
  yesterday: "Yesterday",
  last_7_days: "The last 7 days, this week or the past week",
  month_to_date: "This month or month to date (the current month)",
  last_month: "Last month: the previous calendar month as a whole",
  last_90_days: "The last 90 days or the last three months",
  last_6_months: "The last six months, all the data, or month by month over the whole period",
  custom: "A specific date or range not listed above: a named day or month, a quarter, a date like 25 September, or two named periods to compare",
  not_stated: "No time period is mentioned",
};

const GRAIN_OPTIONS: Record<Grain | "not_stated", string> = {
  hour: "Hour by hour (hourly, by hour, during the day)",
  day: "Day by day (daily, each day)",
  week: "Week by week (weekly)",
  month: "Month by month (monthly, by month)",
  not_stated: "No time granularity is mentioned",
};

const LIMITS: Record<string, number> = { one: 1, three: 3, five: 5, ten: 10, twenty: 20 };

export function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

const choice = (instructions: string, criteria: Record<string, string | null>): ChoiceQuestion => ({
  type: "choice",
  instructions,
  criteria: { ...criteria, [NONE_OF_THESE]: "None of these fits the question" },
});

function filterDimensions(catalog: Catalog): DimensionDef[] {
  return catalog.dimensions.filter((d) => d.filterQuestion && d.values?.length);
}

/** Store-like dimensions with many values: only values named in the question become options. */
function fuzzyCandidates(catalog: Catalog, question: string): { dim: DimensionDef; values: string[] }[] {
  const q = question.toLowerCase();
  const out: { dim: DimensionDef; values: string[] }[] = [];
  for (const dim of catalog.dimensions.filter((d) => d.fuzzyFilter && d.values)) {
    const values = dim.values!.filter((v) => {
      const words = v.toLowerCase().split(" ");
      const place = words.slice(1).join(" ");
      return place.length > 2 && q.includes(place);
    });
    if (values.length) out.push({ dim, values });
  }
  return out;
}

export function understandingQuestions(catalog: Catalog, question: string): DecideQuestions {
  const qs: DecideQuestions = {
    intent: choice("What kind of analytics question is `question`?", INTENT_OPTIONS),
    metric: choice(
      "Which metric does `question` ask about?",
      Object.fromEntries(catalog.metrics.map((m) => [m.id, `${m.label}: ${m.description}`])),
    ),
    period: choice("Which time period does `question` ask about? For a comparison, pick the more recent period.", PERIOD_OPTIONS),
    breakdown: choice("Does `question` ask to split, group or rank the metric by something? If so, by what?", {
      no_breakdown: "No grouping is asked for",
      ...Object.fromEntries(catalog.dimensions.filter((d) => d.id !== "payment").map((d) => [d.id, `${d.label}: ${d.description}`])),
    }),
    grain: choice("Does `question` ask for the metric over time at a particular granularity?", GRAIN_OPTIONS),
    rank_direction: choice("If `question` asks which group is highest or lowest, which end does it want?", {
      highest: "Highest, top, best, most",
      lowest: "Lowest, bottom, worst, least",
      not_ranking: "Not a ranking question",
    }),
    limit: choice("How many items or records does `question` ask for?", {
      one: "One (the single highest, lowest or latest)",
      three: "Three",
      five: "Five",
      ten: "Ten",
      twenty: "Twenty",
      not_stated: "No number is given",
    }),
    record_type: choice("If `question` asks to list individual records, which kind?", {
      payments: "Payments or transactions",
      refunds: "Refunds",
      chargebacks: "Chargebacks or disputes",
      not_records: "Not a request for individual records",
    }),
    out_of_scope: {
      type: "noul",
      instructions: "`question` asks for something payment records cannot answer: a prediction or forecast, credit or default risk, a judgement about a person, or data a merchant's payment records do not hold (profit, stock, identities).",
    } satisfies NoulQuestion,
    amount_filter: {
      type: "noul",
      instructions: "`question` limits payments by a rand amount threshold or range, for example 'over R5,000' or 'under R200'.",
    } satisfies NoulQuestion,
  };
  for (const dim of filterDimensions(catalog)) {
    qs[`filter_${dim.id}`] = choice(`Does \`question\` restrict the data to one ${dim.label.toLowerCase()}? If so, which?`, {
      no_filter: `Not restricted to a single ${dim.label.toLowerCase()}`,
      ...Object.fromEntries(dim.values!.map((v) => [slug(v), v])),
    });
  }
  for (const { dim, values } of fuzzyCandidates(catalog, question)) {
    qs[`filter_${dim.id}`] = choice(`Does \`question\` restrict the data to one ${dim.label.toLowerCase()}? If so, which?`, {
      no_filter: `Not restricted to a single ${dim.label.toLowerCase()}`,
      ...Object.fromEntries(values.map((v) => [slug(v), v])),
    });
  }
  return qs;
}

const RELEVANT: Record<Intent, string[]> = {
  lookup: ["metric", "period", "breakdown"],
  compare: ["metric", "period"],
  trend: ["metric", "period", "grain", "breakdown"],
  breakdown: ["metric", "period", "breakdown", "grain"],
  ranking: ["metric", "period", "breakdown", "rank_direction", "limit"],
  explain_change: ["metric", "period", "breakdown"],
  record_listing: ["record_type", "period", "limit"],
  out_of_scope: [],
};

/** Choices where "none of these" is a legitimate answer rather than a cue to escalate. */
const NONE_IS_NO = new Set(["breakdown", "grain", "limit", "rank_direction", "record_type"]);

export interface FollowUpContext {
  question: string;
  answer: string;
}

export interface Understanding {
  intent: Intent;
  metric: string | null;
  period: PeriodPreset | "custom" | "not_stated";
  breakdown: string | null;
  grain: Grain | null;
  filters: DimensionFilter[];
  rankDirection: "asc" | "desc" | null;
  limit: number | null;
  recordType: string | null;
  wantsAmountFilter: boolean;
  outOfScopeScore: number;
  slots: SlotTrace[];
  system1: DecideMeta;
  escalation: { meta: System2Meta; changes: { slot: string; from: string; to: string; reason: string }[] } | null;
  routed: "system1" | "escalated";
}

export function patternFilters(catalog: Catalog, text: string): DimensionFilter[] {
  const out: DimensionFilter[] = [];
  for (const dim of catalog.dimensions) {
    if (!dim.idPattern) continue;
    const found = [...new Set(text.match(new RegExp(`\\b${dim.idPattern}\\b`, "g")) ?? [])];
    if (found.length) out.push({ kind: "dimension", dimension: dim.id, values: found, source: "pattern" });
  }
  return out;
}

export async function understand(catalog: Catalog, question: string, followUp?: FollowUpContext): Promise<Understanding> {
  const state: JsonValue = followUp ? { question, previous_turn: { question: followUp.question, answer: followUp.answer } } : { question };
  const questions = understandingQuestions(catalog, question);
  const res = await decide(state, questions, { tag: `understand: ${question}` });
  const answers = res.answers as Record<string, ChoiceAnswer | { type: "noul"; noul: number }>;
  const choiceOf = (slot: string) => answers[slot] as ChoiceAnswer | undefined;
  const final: Record<string, string> = {};
  for (const [slot, a] of Object.entries(answers)) if (a.type === "choice") final[slot] = a.choice;

  const oos = (answers.out_of_scope as { noul: number } | undefined)?.noul ?? 0;
  const intent0 = final.intent as Intent | typeof NONE_OF_THESE;
  const relevantFor = (intent: string) => {
    const filters = Object.keys(questions).filter((k) => k.startsWith("filter_"));
    return ["intent", ...(RELEVANT[intent as Intent] ?? ["metric", "period"]), ...(intent === "out_of_scope" ? [] : filters)];
  };

  // Decide which slots escalate.
  const toEscalate: SlotToResolve[] = [];
  const intentConflict = (intent0 === "out_of_scope") !== (oos >= OUT_OF_SCOPE_YES);
  for (const slot of relevantFor(intent0)) {
    const a = choiceOf(slot);
    if (!a) continue;
    const unsure = a.confidence < CONFIDENCE_THRESHOLD;
    const abstained = a.choice === NONE_OF_THESE && !NONE_IS_NO.has(slot);
    if (unsure || abstained || (slot === "intent" && intentConflict)) {
      const q = questions[slot] as ChoiceQuestion;
      toEscalate.push({ slot, instructions: q.instructions, options: q.criteria, system1Choice: a.choice, system1Confidence: a.confidence });
    }
  }

  let escalation: Understanding["escalation"] = null;
  if (toEscalate.length) {
    const context = followUp ? `Previous turn: "${followUp.question}" -> ${followUp.answer}` : "";
    const r = await resolveSlots(question, context, toEscalate);
    const changes = r.choices.map((c) => ({ slot: c.slot, from: final[c.slot] ?? "", to: c.choice, reason: c.reason }));
    for (const c of r.choices) final[c.slot] = c.choice;
    escalation = { meta: r.meta, changes };
  }

  const intent = (INTENTS as readonly string[]).includes(final.intent ?? "") ? (final.intent as Intent) : "out_of_scope";
  const relevant = new Set(relevantFor(intent));
  const escalated = new Set(toEscalate.map((s) => s.slot));

  const slots: SlotTrace[] = Object.entries(answers).map(([slot, a]) => {
    if (a.type === "noul") {
      return { slot, choice: a.noul >= 0.5 ? "yes" : "no", confidence: noulConfidence(a.noul), route: "system1" as const, final: `p(yes) = ${a.noul.toFixed(2)}`, top: [{ option: "yes", p: a.noul }] };
    }
    const top = Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([option, p]) => ({ option, p }));
    return {
      slot, choice: a.choice, confidence: a.confidence, top, final: final[slot] ?? a.choice,
      route: escalated.has(slot) ? ("escalated" as const) : relevant.has(slot) ? ("system1" as const) : ("ignored" as const),
    };
  });

  const pick = (slot: string) => (relevant.has(slot) ? final[slot] : undefined);
  const metric = pick("metric");
  const breakdown = pick("breakdown");
  const grain = pick("grain");
  const direction = pick("rank_direction");
  const limit = pick("limit");
  const recordType = pick("record_type");
  const period = (final.period === NONE_OF_THESE ? "custom" : final.period) as Understanding["period"];

  const filters: DimensionFilter[] = [];
  if (intent !== "out_of_scope") {
    for (const key of Object.keys(questions).filter((k) => k.startsWith("filter_"))) {
      const v = final[key];
      if (!v || v === "no_filter" || v === NONE_OF_THESE) continue;
      const dim = catalog.dimensions.find((d) => `filter_${d.id}` === key)!;
      const value = dim.values?.find((x) => slug(x) === v);
      if (value) filters.push({ kind: "dimension", dimension: dim.id, values: [value], source: "system1" });
    }
    filters.push(...patternFilters(catalog, question));
  }

  return {
    intent,
    metric: metric && metric !== NONE_OF_THESE ? metric : null,
    period: [...PERIOD_PRESETS, "custom", "not_stated"].includes(period) ? period : "not_stated",
    breakdown: breakdown && breakdown !== "no_breakdown" && breakdown !== NONE_OF_THESE ? breakdown : null,
    grain: grain && (GRAINS as readonly string[]).includes(grain) ? (grain as Grain) : null,
    filters,
    rankDirection: direction === "highest" ? "desc" : direction === "lowest" ? "asc" : null,
    limit: limit ? (LIMITS[limit] ?? null) : null,
    recordType: recordType && !["not_records", NONE_OF_THESE].includes(recordType) ? recordType : null,
    wantsAmountFilter: ((answers.amount_filter as { noul: number } | undefined)?.noul ?? 0) >= 0.5,
    outOfScopeScore: oos,
    slots,
    system1: res.meta,
    escalation,
    routed: escalation ? "escalated" : "system1",
  };
}
