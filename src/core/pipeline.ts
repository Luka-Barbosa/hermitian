import type { DataAdapter } from "./adapter";
import type { Answer, FollowUpPayload } from "./answer";
import { metricById, recordTypeById } from "./catalog";
import { decide, type ChoiceAnswer, type NoulAnswer } from "./decide";
import { env } from "../env";
import { FixtureMissError } from "./fixtures";
import { resultGate, windowGate } from "./gates/calculation";
import { dataSupportGate } from "./gates/dataSupport";
import { allowedFrom, checkClaim } from "./gates/grounding";
import { factsFor } from "./narrative/facts";
import { templateHeadline } from "./narrative/templates";
import { isValidIsoDate, makePeriod, previousPeriod, rangeLabel, resolvePreset } from "./periods";
import { OPERATIONS_BY_INTENT, operationsFor } from "./plan/operations";
import { QueryPlanSchema, type Filter, type QueryPlan } from "./plan/schema";
import { buildQuery } from "./query/builder";
import type { QueryResult } from "./results";
import { parseAmount, parsePeriod, writeNarrative } from "./system2";
import { Trace, timed, type PipelineEvent } from "./trace";
import { FORM_LABELS, NONE_OF_THESE, type Form, type Intent, type Period } from "./types";
import { CONFIDENCE_THRESHOLD, understand } from "./understand";
import { defaultForm, describeShape, validForms } from "./visuals/filter";

export interface AskInput {
  question: string;
  turn?: number;
  followUp?: FollowUpPayload;
}

const INTENT_TOPIC: Record<Intent, string> = {
  lookup: "LOOKUP",
  compare: "COMPARE",
  trend: "TREND",
  breakdown: "BREAKDOWN",
  ranking: "RANKING",
  explain_change: "EXPLAIN CHANGE",
  record_listing: "RECORDS",
  out_of_scope: "OUT OF SCOPE",
};

const DEFAULT_PERIOD: Record<Intent, "month_to_date" | "last_90_days" | "last_6_months" | "all"> = {
  lookup: "month_to_date",
  compare: "month_to_date",
  trend: "last_90_days",
  breakdown: "last_90_days",
  ranking: "last_90_days",
  explain_change: "month_to_date",
  record_listing: "all",
  out_of_scope: "month_to_date",
};

const PLAYFUL = ["Stitching…", "Counting rands…", "Squaring the ledger…", "Lining up the bars…"];

function questionText(q: string): string {
  return q.trim().replace(/\s+/g, " ");
}

export async function ask(input: AskInput, deps: { adapter: DataAdapter; onEvent?: (e: PipelineEvent) => void }): Promise<Answer> {
  const { adapter } = deps;
  const catalog = adapter.catalog;
  const question = questionText(input.question);
  const trace = new Trace(deps.onEvent);
  const started = performance.now();
  const e = env();
  const backends = { decide: e.DECIDE_BACKEND === "record" ? `record via ${e.RECORD_VIA}` : e.DECIDE_BACKEND, system2: e.SYSTEM2_BACKEND };
  const dataNote = `Data through ${rangeLabel(catalog.asOf, catalog.asOf)} · ${catalog.sourceName}`;
  let playful = 0;
  let modelMs = 0;
  const modelTime = (meta: { latencyMs: number; recordedLatencyMs: number | null } | undefined) => {
    if (meta) modelMs += meta.recordedLatencyMs ?? meta.latencyMs;
  };
  const status = (text: string) => trace.status(text);
  const flourish = () => status(PLAYFUL[playful++ % PLAYFUL.length]!);

  const base = (over: Partial<Answer>): Answer => ({
    turn: input.turn ?? 1, question, topic: "ANSWER", headline: "", sentences: [], cutClaims: [], form: "text", validForms: ["text"],
    primaryResultId: null, results: [], source: "", route: "system1", intentConfidence: null, formConfidence: null, plan: null,
    trace: trace.events, followUp: { question, answer: "", plan: null }, backends, latencyMs: Math.round(performance.now() - started), modelLatencyMs: modelMs,
    outOfScope: false, error: null, dataNote, ...over,
  });

  try {
    status("Reading the question…");
    const { value: u, ms: uMs } = await timed(() => understand(catalog, question, input.followUp ? { question: input.followUp.question, answer: input.followUp.answer } : undefined));
    const intentSlot = u.slots.find((s) => s.slot === "intent");
    modelTime(u.system1);
    modelTime(u.escalation?.meta);
    trace.add({
      kind: "system1", title: "System 1 · read the question", ok: true, latencyMs: uMs,
      detail: [
        ["backend", `${u.system1.backend} (${u.system1.source}, ${u.system1.model})`],
        ["request", u.system1.hash],
        ["questions", String(u.slots.length)],
        ...(u.system1.recordedLatencyMs !== null ? [["recorded latency", `${u.system1.recordedLatencyMs} ms`] as [string, string]] : []),
        ["threshold", `act at confidence ≥ ${CONFIDENCE_THRESHOLD}`],
      ],
      slots: u.slots,
    });
    if (u.escalation) {
      trace.add({
        kind: "escalation", title: "Escalated to System 2", ok: true, latencyMs: u.escalation.meta.latencyMs,
        detail: [
          ["model", `${u.escalation.meta.model} (${u.escalation.meta.backend})`],
          ...u.escalation.changes.map((c) => [c.slot, `${c.from} → ${c.to}: ${c.reason}`] as [string, string]),
        ],
      });
    }

    // Out of scope: answered in code, no query, no LLM text.
    if (u.intent === "out_of_scope") {
      const g = { kind: "gate" as const, title: "Gate 1 · data support", ok: false, latencyMs: 0, detail: [["result", "Out of scope: payment records cannot answer this"], ["out-of-scope score", u.outOfScopeScore.toFixed(2)]] as [string, string][] };
      trace.add(g);
      const examples = catalog.outOfScopeExamples.slice(0, 3).join("; ");
      return base({
        topic: INTENT_TOPIC.out_of_scope, outOfScope: true, route: u.routed, intentConfidence: intentSlot?.confidence ?? null,
        headline: "This data can't answer that",
        sentences: [
          "Hermitian only reads payment records: captured payments, authorization attempts, refunds and chargebacks.",
          `It cannot answer questions about ${examples}.`,
        ],
        followUp: { question, answer: "Out of scope: not answerable from payment records.", plan: null },
      });
    }

    const prev = input.followUp?.plan ? QueryPlanSchema.safeParse(input.followUp.plan) : null;
    const prevPlan = prev?.success ? prev.data : null;

    // Period: preset in code, custom dates from System 2, defaults by intent.
    let period: Period;
    let comparison: Period | null = null;
    if (u.period === "custom") {
      status("Asking Gemini to pin down the dates…");
      const context = input.followUp ? `${question} (previous question: ${input.followUp.question})` : question;
      const { value: p, ms } = await timed(() => parsePeriod(context, { asOf: catalog.asOf, dataStart: catalog.dataStart, dataEnd: catalog.dataEnd, wantsComparison: u.intent === "compare" || u.intent === "explain_change" }));
      const o = p.output;
      modelTime(p.meta);
      const valid = isValidIsoDate(o.start) && isValidIsoDate(o.end) && o.start <= o.end;
      trace.add({
        kind: "system2", title: "System 2 · custom period", ok: valid, latencyMs: ms,
        detail: [["model", `${p.meta.model} (${p.meta.backend})`], ["period", `${o.start} to ${o.end}`], ["comparison", o.comparison_start ? `${o.comparison_start} to ${o.comparison_end}` : "none named"], ["note", o.note]],
      });
      if (!valid) throw new Error(`System 2 returned an invalid period (${o.start} to ${o.end}).`);
      period = makePeriod("custom", o.start, o.end);
      if (o.comparison_start && o.comparison_end && isValidIsoDate(o.comparison_start) && isValidIsoDate(o.comparison_end) && o.comparison_start <= o.comparison_end) {
        comparison = makePeriod("custom", o.comparison_start, o.comparison_end);
      }
    } else if (u.period === "not_stated") {
      if (prevPlan) period = prevPlan.period;
      else {
        // "By month" with no period means the whole history, not the last 90 days.
        const d = u.grain === "month" && (u.intent === "breakdown" || u.intent === "trend") ? "last_6_months" : DEFAULT_PERIOD[u.intent];
        period = d === "all" ? makePeriod("all", catalog.dataStart, catalog.dataEnd) : resolvePreset(d, catalog.asOf);
      }
    } else {
      period = resolvePreset(u.period, catalog.asOf);
    }

    const filters: Filter[] = [...u.filters];
    if (u.wantsAmountFilter) {
      status("Asking Gemini for the amount filter…");
      const { value: a, ms } = await timed(() => parseAmount(question));
      modelTime(a.meta);
      const ok = a.output.present && a.output.op !== null && a.output.value_rand !== null && a.output.value_rand > 0;
      trace.add({ kind: "system2", title: "System 2 · amount filter", ok, latencyMs: ms, detail: [["model", `${a.meta.model} (${a.meta.backend})`], ["filter", ok ? `${a.output.op} R${a.output.value_rand}` : "none found"]] });
      if (ok) filters.push({ kind: "amount", op: a.output.op!, value: a.output.value_rand!, source: "system2" });
    }

    let metric = u.metric;
    const inherited: string[] = [];
    if (prevPlan) {
      if (!metric && u.intent !== "record_listing" && prevPlan.metric) {
        metric = prevPlan.metric;
        inherited.push(`metric ${metric}`);
      }
      for (const f of prevPlan.filters) {
        const taken = filters.some((x) => x.kind === f.kind && (x.kind === "amount" || (f.kind === "dimension" && x.kind === "dimension" && x.dimension === f.dimension)));
        if (!taken) {
          filters.push({ ...f, source: "follow_up" });
          inherited.push(f.kind === "dimension" ? `${f.dimension} = ${f.values.join(", ")}` : `amount ${f.op} R${f.value}`);
        }
      }
      if (u.period === "not_stated") inherited.push(`period ${prevPlan.period.label}`);
    }

    const m = metric ? metricById(catalog, metric) : undefined;
    // On a trend, "by hour" or "by day" is the time grain, not a category to split by.
    let breakdown = u.breakdown;
    let grain = u.grain;
    if (u.intent === "trend" && (breakdown === "hour_of_day" || breakdown === "day_of_week")) {
      grain ??= breakdown === "hour_of_day" ? "hour" : "day";
      inherited.push(`${breakdown} read as the ${grain} grain`);
      breakdown = null;
    }
    const draft: QueryPlan = {
      intent: u.intent,
      metric: metric ?? null,
      period,
      comparison,
      breakdown: breakdown ?? (u.intent === "ranking" || u.intent === "breakdown" ? (m?.shareOf ?? null) : null),
      grain,
      filters,
      // "Which issuer is lowest?" still shows the ranked list; the answer names the first.
      rank: u.intent === "ranking" ? { direction: u.rankDirection ?? "desc", limit: u.limit && u.limit > 1 ? u.limit : 10 } : null,
      records: u.intent === "record_listing" ? { type: u.recordType ?? "payments", limit: u.limit ?? 10 } : null,
      drivers: null,
    };
    let plan = QueryPlanSchema.parse(draft);
    trace.add({
      kind: "plan", title: "Query plan", ok: true, latencyMs: 0,
      detail: [
        ["intent", `${plan.intent} → ${OPERATIONS_BY_INTENT[plan.intent]}`],
        ["metric", m ? `${m.label} (${m.definition})` : plan.records ? `records: ${plan.records.type}` : "none"],
        ["period", `${plan.period.label} (${plan.period.start} to ${plan.period.end})`],
        ...(plan.comparison ? [["comparison", plan.comparison.label] as [string, string]] : []),
        ...(plan.breakdown ? [["breakdown", plan.breakdown] as [string, string]] : []),
        ...(plan.grain ? [["grain", plan.grain] as [string, string]] : []),
        ...plan.filters.map((f) => ["filter", f.kind === "dimension" ? `${f.dimension} = ${f.values.join(", ")} (${f.source})` : `amount ${f.op} R${f.value} (${f.source})`] as [string, string]),
        ...(inherited.length ? [["adjusted", inherited.join("; ")] as [string, string]] : []),
      ],
    });

    // Gate 1: data support.
    status("Checking the data can answer it…");
    const { value: g1, ms: g1ms } = await timed(() => dataSupportGate(plan, adapter));
    trace.add({ kind: "gate", title: "Gate 1 · data support", ok: g1.ok, latencyMs: g1ms, detail: g1.checks.map((c) => [`${c.ok ? "pass" : "fail"} · ${c.check}`, c.detail]) });
    const topicFor = (p: QueryPlan) => `${p.metric ? metricById(catalog, p.metric)!.topic : p.records ? (recordTypeById(catalog, p.records.type)?.label.toUpperCase() ?? "RECORDS") : "ANSWER"} · ${INTENT_TOPIC[p.intent]}`;
    if (!g1.ok) {
      return base({
        topic: topicFor(plan), plan, route: u.routed, intentConfidence: intentSlot?.confidence ?? null,
        headline: "This data can't answer that as asked",
        sentences: [g1.reason ?? "The plan failed the data-support gate."],
        followUp: { question, answer: `Not answerable: ${g1.reason}`, plan },
      });
    }

    // Gate 2 (before the query): windows.
    const needsComparison = plan.intent === "compare" || plan.intent === "explain_change" || plan.intent === "trend";
    const w = windowGate(needsComparison ? { ...plan, comparison: plan.comparison ?? previousPeriod(plan.period) } : plan, catalog);
    trace.add({ kind: "gate", title: "Gate 2 · calculation (windows)", ok: !w.fatal, latencyMs: 0, detail: w.checks.map((c) => [`${c.ok ? "pass" : "note"} · ${c.check}`, c.detail]) });
    if (w.fatal) {
      return base({ topic: topicFor(plan), plan, route: u.routed, headline: "No data for that period", sentences: [w.fatal], followUp: { question, answer: w.fatal, plan } });
    }
    plan = w.plan;

    // Queries.
    const ops = operationsFor(plan, catalog, { trendComparison: plan.comparison !== null });
    const results: QueryResult[] = [];
    for (const [i, op] of ops.entries()) {
      const built = buildQuery(catalog, op);
      status(`Reading ${built.views.join(" and ")}…`);
      if (i === 0) flourish();
      const t = performance.now();
      const rows = [];
      for (const sql of built.sql) rows.push(await adapter.query(sql));
      const latencyMs = Math.round(performance.now() - t);
      const result: QueryResult = {
        id: `q${i + 1}`, op: built.op, metricId: built.metric?.id ?? null, metricLabel: built.metric?.label ?? null, unit: built.unit,
        views: built.views, sql: built.sql, rowCount: rows.reduce((a, r) => a + r.length, 0), latencyMs, notes: built.notes, data: built.toData(rows),
      };
      results.push(result);
      trace.add({
        kind: "query", title: `DuckDB · ${result.id} · ${built.op}`, ok: true, latencyMs,
        detail: [["views", built.views.join(", ")], ["rows", String(result.rowCount)], ["read-only", "yes"], ...built.notes.map((n) => ["note", n] as [string, string])],
        sql: built.sql,
      });
      const checks = resultGate(result);
      trace.add({ kind: "gate", title: `Gate 2 · calculation (${result.id})`, ok: checks.every((c) => c.ok), latencyMs: 0, detail: checks.map((c) => [`${c.ok ? "pass" : "fail"} · ${c.check}`, c.detail]) });
    }
    const primary = results[0] ?? null;

    // Gate 4 + System 1: the visual.
    status("Choosing a visual…");
    const valid = validForms(primary);
    let form: Form = valid[0] ?? "text";
    let formConfidence: number | null = null;
    const vt = performance.now();
    if (primary && valid.length > 1) {
      const res = await decide(
        { question, result: describeShape(primary) },
        { form: { type: "choice", instructions: "Which way of showing `result` best answers `question`?", criteria: { ...Object.fromEntries(valid.map((f) => [f, FORM_LABELS[f]])), [NONE_OF_THESE]: "None of these fits" } } },
        { tag: `form: ${question}` },
      );
      const a = res.answers.form as ChoiceAnswer;
      modelTime(res.meta);
      formConfidence = a.confidence;
      const acted = a.choice !== NONE_OF_THESE && a.confidence >= CONFIDENCE_THRESHOLD && valid.includes(a.choice as Form);
      form = acted ? (a.choice as Form) : defaultForm(plan.intent, valid);
      trace.add({
        kind: "visual", title: "Gate 4 · visual suitability + System 1 choice", ok: true, latencyMs: Math.round(performance.now() - vt),
        detail: [["shape", describeShape(primary)], ["valid forms (code)", valid.join(", ")], ["System 1 chose", `${a.choice} (confidence ${a.confidence.toFixed(2)})`], ["shown", acted ? form : `${form} (default for ${plan.intent}; System 1 ${a.choice === NONE_OF_THESE ? "abstained" : "unsure"})`], ["request", res.meta.hash]],
        slots: [{ slot: "form", choice: a.choice, confidence: a.confidence, route: acted ? "system1" : "default", final: form, top: Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).slice(0, 3).map(([option, p]) => ({ option, p })) }],
      });
    } else {
      trace.add({ kind: "visual", title: "Gate 4 · visual suitability", ok: true, latencyMs: 0, detail: [["shape", primary ? describeShape(primary) : "none"], ["valid forms (code)", valid.join(", ")], ["shown", `${form} (only valid form)`]] });
    }

    // System 2: narrative, then gate 3.
    const topic = topicFor(plan);
    const scope = plan.filters.map((f) => (f.kind === "dimension" ? `${catalog.dimensions.find((d) => d.id === f.dimension)?.label ?? f.dimension} ${f.values.join(", ")}` : `amount ${{ gt: "over", gte: "at least", lt: "under", lte: "at most" }[f.op]} R${f.value.toLocaleString("en-US")}`));
    const facts = primary ? [`Scope: ${plan.period.label}${scope.length ? `; limited to ${scope.join("; ")}` : "; all payments"}.`, ...factsFor(primary)] : [];
    status("Writing the answer…");
    const { value: nar, ms: narMs } = await timed(() => writeNarrative({ question, topic, form, facts, notes: primary?.notes ?? [] }));
    modelTime(nar.meta);
    trace.add({ kind: "system2", title: "System 2 · narrative", ok: true, latencyMs: narMs, detail: [["model", `${nar.meta.model} (${nar.meta.backend})`], ["request", nar.meta.hash], ["facts given", String(facts.length)]] });

    status("Checking every number against the results…");
    const context = [plan.rank?.limit, plan.records?.limit].filter((x): x is number => typeof x === "number");
    const allowed = allowedFrom(results, context);
    const claims = [nar.output.headline, ...nar.output.sentences];
    const codeChecks = claims.map((c) => checkClaim(c, allowed));
    const survivors = claims.map((c, i) => ({ text: c, i })).filter(({ i }) => codeChecks[i]!.ok);
    const cut: Answer["cutClaims"] = claims.flatMap((c, i) => (codeChecks[i]!.ok ? [] : [{ text: c, reasons: codeChecks[i]!.problems }]));
    const gt = performance.now();
    let noulHash = "";
    const supported = new Set<number>();
    if (survivors.length) {
      const res = await decide(
        { facts, claims: survivors.map((s) => s.text) },
        Object.fromEntries(survivors.map((s, k) => [`claim_${k}`, { type: "noul" as const, instructions: `\`claims[${k}]\` is fully supported by \`facts\` and says nothing the facts do not show.` }])),
        { tag: `claims: ${question}` },
      );
      noulHash = res.meta.hash;
      modelTime(res.meta);
      survivors.forEach((s, k) => {
        const a = res.answers[`claim_${k}`] as NoulAnswer;
        if (a.noul >= 0.5) supported.add(s.i);
        else cut.push({ text: s.text, reasons: [`System 1 claim check: p(supported) = ${a.noul.toFixed(2)}`] });
      });
    }
    const headlineOk = supported.has(0);
    const headline = headlineOk ? nar.output.headline : primary ? templateHeadline(primary) : "Answer";
    const sentences = nar.output.sentences.filter((_, j) => supported.has(j + 1));
    trace.add({
      kind: "gate", title: "Gate 3 · narrative grounding", ok: true, latencyMs: Math.round(performance.now() - gt),
      detail: [
        ["claims", String(claims.length)],
        ["numbers matched (code)", `${survivors.length} of ${claims.length} claims`],
        ["claims supported (System 1)", `${supported.size} of ${survivors.length}`],
        ...(noulHash ? [["request", noulHash] as [string, string]] : []),
        ...cut.map((c) => ["cut", `"${c.text}" (${c.reasons.join("; ")})`] as [string, string]),
        ...(headlineOk ? [] : [["headline", "replaced with a template built from the results"] as [string, string]]),
      ],
    });

    const answerSummary = `${headline}. (${m?.label ?? plan.records?.type ?? ""}, ${plan.period.label}${plan.filters.length ? `, filtered` : ""})`;
    return base({
      topic, headline, sentences, cutClaims: cut, form, validForms: valid, primaryResultId: primary?.id ?? null, results,
      source: primary ? `${primary.views.join(" + ")} · ${primary.id}` : "", route: u.routed, intentConfidence: intentSlot?.confidence ?? null, formConfidence, plan,
      followUp: { question, answer: answerSummary, plan },
    });
  } catch (err) {
    const miss = err instanceof FixtureMissError;
    const message = err instanceof Error ? err.message : String(err);
    trace.add({ kind: "error", title: miss ? "Replay fixture missing" : "Error", ok: false, latencyMs: 0, detail: [["message", message], ...(miss ? [["hash", (err as FixtureMissError).hash] as [string, string]] : [])] });
    return base({
      topic: "ERROR", headline: miss ? "No recorded answer for this question" : "Something went wrong",
      sentences: [message], error: { kind: miss ? "fixture_miss" : "error", message, ...(miss ? { hash: (err as FixtureMissError).hash } : {}) },
    });
  }
}
