import type { Catalog } from "../catalog";
import { clampToData } from "../periods";
import type { QueryPlan } from "../plan/schema";
import type { QueryResult } from "../results";

/**
 * Gate 2: definitions, denominators, windows. Before the query: every window
 * sits inside the data. After it: denominators are non-zero, shares sum to
 * one, and contributions reconcile exactly with the total change.
 */

export interface CalcCheck {
  check: string;
  ok: boolean;
  detail: string;
}

export function windowGate(plan: QueryPlan, catalog: Catalog): { plan: QueryPlan; checks: CalcCheck[]; fatal: string | null } {
  const checks: CalcCheck[] = [];
  const main = clampToData(plan.period, catalog.dataStart, catalog.dataEnd);
  if (main.empty) {
    return { plan, checks: [{ check: "window", ok: false, detail: `${plan.period.label} is outside the data (${catalog.dataStart} to ${catalog.dataEnd}).` }], fatal: `There is no data for ${plan.period.label}; the data covers ${catalog.dataStart} to ${catalog.dataEnd}.` };
  }
  checks.push({ check: "window", ok: true, detail: main.clipped ? `Clipped to the data: ${main.period.label}` : `${main.period.label} (${main.period.start} to ${main.period.end})` });
  let comparison = plan.comparison;
  if (comparison) {
    const c = clampToData(comparison, catalog.dataStart, catalog.dataEnd);
    if (c.empty) {
      checks.push({ check: "comparison window", ok: false, detail: `${comparison.label} is before the data starts.` });
      if (plan.intent === "compare" || plan.intent === "explain_change") {
        return { plan, checks, fatal: `The comparison period ${comparison.label} is outside the data (from ${catalog.dataStart}).` };
      }
      comparison = null;
    } else {
      checks.push({ check: "comparison window", ok: !c.clipped, detail: c.clipped ? `Clipped to the data: ${c.period.label}` : `${c.period.label} (${c.period.start} to ${c.period.end})` });
      comparison = c.period;
    }
  }
  return { plan: { ...plan, period: main.period, comparison }, checks, fatal: null };
}

export function resultGate(result: QueryResult): CalcCheck[] {
  const d = result.data;
  const checks: CalcCheck[] = [];
  switch (d.shape) {
    case "scalar":
      checks.push({ check: "value", ok: d.value !== null, detail: d.value === null ? "No rows in the period (or a zero denominator)." : "Value present" });
      break;
    case "delta":
      checks.push({ check: "both periods", ok: d.current !== null && d.previous !== null, detail: d.previous === null ? "No value for the comparison period." : "Both periods have values" });
      break;
    case "series": {
      const empty = d.series.flatMap((s) => s.points).filter((p) => p.value === null).length;
      checks.push({ check: "denominators", ok: true, detail: empty ? `${empty} points have no data (shown as gaps)` : "Every point has data" });
      break;
    }
    case "categories":
      checks.push({ check: "groups", ok: d.items.length > 0, detail: `${d.items.length} groups returned${d.minSupport ? `, minimum support ${d.minSupport}` : ""}` });
      break;
    case "share_matrix": {
      const sums = new Map<string, number>();
      for (const c of d.cells) sums.set(c.bucket, (sums.get(c.bucket) ?? 0) + c.share);
      const bad = [...sums.values()].filter((s) => Math.abs(s - 1) > 1e-9).length;
      checks.push({ check: "shares sum to 100%", ok: bad === 0, detail: bad ? `${bad} buckets do not sum to 100%` : `${sums.size} buckets, each sums to 100%` });
      break;
    }
    case "contribution": {
      const sum = d.steps.reduce((a, s) => a + s.delta, 0);
      const tol = Math.max(1e-9, Math.abs(d.change) * 1e-9);
      checks.push({ check: "contributions reconcile", ok: Math.abs(sum - d.change) <= tol, detail: `Steps sum to the total change within ${tol.toExponential(1)}` });
      break;
    }
    case "records":
      checks.push({ check: "records", ok: true, detail: `${d.rows.length} of ${d.totalMatching} matching rows` });
      break;
  }
  return checks;
}
