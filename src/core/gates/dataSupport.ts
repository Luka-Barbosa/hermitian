import type { DataAdapter } from "../adapter";
import { dimensionById, metricById, metricViews, recordTypeById } from "../catalog";
import type { QueryPlan } from "../plan/schema";

/**
 * Gate 1: can this data answer the question? Each metric declares the fields
 * it needs and the dimensions it supports; this gate checks the plan against
 * those declarations and the live schema.
 */

export interface GateResult {
  ok: boolean;
  checks: { check: string; ok: boolean; detail: string }[];
  reason: string | null;
}

export async function dataSupportGate(plan: QueryPlan, adapter: DataAdapter): Promise<GateResult> {
  const { catalog } = adapter;
  const checks: GateResult["checks"] = [];
  const fail = (check: string, detail: string) => checks.push({ check, ok: false, detail });
  const pass = (check: string, detail: string) => checks.push({ check, ok: true, detail });

  if (plan.intent === "out_of_scope") {
    fail("in scope", "The question asks for something payment records cannot support.");
    return { ok: false, checks, reason: "out_of_scope" };
  }

  const fields = await adapter.viewFields();
  if (plan.intent === "record_listing") {
    const rt = plan.records ? recordTypeById(catalog, plan.records.type) : undefined;
    if (!rt) fail("record type", "No supported record type (payments, refunds or chargebacks) was identified.");
    else pass("record type", `${rt.label} from ${rt.view}`);
    for (const f of plan.filters) {
      if (f.kind === "dimension" && rt && !rt.dimensions.includes(f.dimension)) fail("filter", `${rt.label} cannot be filtered by ${f.dimension}.`);
    }
  } else {
    const m = plan.metric ? metricById(catalog, plan.metric) : undefined;
    if (!m) {
      fail("metric", "No supported metric matches the question.");
    } else {
      pass("metric", `${m.label}: ${m.definition}`);
      const missing = m.requiredFields.filter((f) => {
        const [view, field] = f.split(".");
        return !fields[view!]?.includes(field!);
      });
      if (missing.length) fail("required fields", `Missing ${missing.join(", ")}`);
      else pass("required fields", m.requiredFields.join(", "));
      const dims = [plan.breakdown, ...(plan.drivers ?? []), ...plan.filters.map((f) => (f.kind === "dimension" ? f.dimension : null))].filter((d): d is string => Boolean(d));
      for (const d of new Set(dims)) {
        const dim = dimensionById(catalog, d);
        const views = metricViews(m);
        if (!dim || !m.dimensions.includes(d) || views.some((v) => !dim.columns[v])) fail("dimension", `${m.label} cannot be split or filtered by ${dim?.label ?? d}.`);
        else pass("dimension", `${dim.label} available in ${views.join(", ")}`);
      }
      if ((plan.intent === "ranking" || plan.intent === "breakdown") && !plan.breakdown && !m.shareOf) {
        fail("dimension", `A ${plan.intent} needs something to group by (method, issuer, channel, store, ...).`);
      }
      if (plan.intent === "explain_change" && (m.kind === "distinct" || m.kind === "share")) {
        fail("decomposable", `${m.label} does not split into additive contributions, so a change cannot be explained by contribution analysis.`);
      }
    }
  }

  for (const f of plan.filters) {
    if (f.kind === "amount") {
      pass("amount filter", `${f.op} R${f.value}`);
      continue;
    }
    const dim = dimensionById(catalog, f.dimension);
    if (dim?.kind === "entity") {
      for (const v of f.values) {
        if (await adapter.entityExists(f.dimension, v)) pass("entity exists", `${dim.label} ${v}`);
        else fail("entity exists", `No ${dim.label.toLowerCase()} ${v} in the data.`);
      }
    } else if (dim?.values && f.values.some((v) => !dim.values!.includes(v))) {
      fail("filter value", `Unknown ${dim.label.toLowerCase()} ${f.values.join(", ")}`);
    }
  }

  const failed = checks.filter((c) => !c.ok);
  return { ok: failed.length === 0, checks, reason: failed.length ? failed.map((c) => c.detail).join(" ") : null };
}
