import { metricById, type Catalog } from "../catalog";
import { autoGrain, previousPeriod } from "../periods";
import type { Grain, Intent, Period } from "../types";
import type { Filter, QueryPlan } from "./schema";

/**
 * Operations are mapped from the intent in code: the model chooses what to
 * ask about, never how to calculate it.
 */
export type Operation =
  | { op: "aggregate"; metric: string; period: Period; filters: Filter[] }
  | { op: "period_change"; metric: string; period: Period; comparison: Period; filters: Filter[] }
  | {
      op: "time_series";
      metric: string;
      period: Period;
      grain: Grain;
      filters: Filter[];
      breakdown: string | null;
      comparison: { kind: "previous"; period: Period } | { kind: "complement"; dimension: string; values: string[] } | null;
    }
  | { op: "group_share"; metric: string; period: Period; dimension: string; filters: Filter[] }
  | { op: "share_matrix"; metric: string; period: Period; dimension: string; grain: Grain; filters: Filter[] }
  | { op: "group_rank"; metric: string; period: Period; dimension: string; direction: "asc" | "desc"; limit: number; minSupport: number | null; filters: Filter[] }
  | { op: "contribution"; metric: string; period: Period; comparison: Period; drivers: string[]; filters: Filter[] }
  | { op: "filter_records"; recordType: string; period: Period; filters: Filter[]; limit: number };

export const OPERATIONS_BY_INTENT: Record<Intent, string> = {
  lookup: "aggregate (group values when a breakdown is named)",
  compare: "period change",
  trend: "time series with a comparison series",
  breakdown: "group by, share of total",
  ranking: "group by, rank",
  explain_change: "period change, contribution analysis",
  record_listing: "filter records",
  out_of_scope: "none",
};

export function operationsFor(plan: QueryPlan, catalog: Catalog, opts: { trendComparison?: boolean } = {}): Operation[] {
  const metric = plan.metric ? metricById(catalog, plan.metric) : undefined;
  const { period, filters } = plan;
  const need = () => {
    if (!metric) throw new Error(`Intent ${plan.intent} needs a metric`);
    return metric;
  };
  switch (plan.intent) {
    case "out_of_scope":
      return [];
    case "record_listing":
      return [{ op: "filter_records", recordType: plan.records!.type, period, filters, limit: plan.records!.limit }];
    case "lookup": {
      const m = need();
      if (m.kind === "share") return [{ op: "group_share", metric: m.id, period, dimension: plan.breakdown ?? m.shareOf!, filters }];
      if (plan.breakdown) return [{ op: "group_share", metric: m.id, period, dimension: plan.breakdown, filters }];
      return [{ op: "aggregate", metric: m.id, period, filters }];
    }
    case "compare": {
      const m = need();
      return [{ op: "period_change", metric: m.id, period, comparison: plan.comparison ?? previousPeriod(period), filters }];
    }
    case "trend": {
      const m = need();
      const grain = plan.grain ?? autoGrain(period);
      if (m.kind === "share") return [{ op: "share_matrix", metric: m.id, period, dimension: plan.breakdown ?? m.shareOf!, grain, filters }];
      const dimFilter = filters.find((f) => f.kind === "dimension");
      const comparison = plan.breakdown
        ? null
        : dimFilter && dimFilter.kind === "dimension"
          ? { kind: "complement" as const, dimension: dimFilter.dimension, values: dimFilter.values }
          : opts.trendComparison === false
            ? null
            : { kind: "previous" as const, period: plan.comparison ?? previousPeriod(period) };
      return [{ op: "time_series", metric: m.id, period, grain, filters, breakdown: plan.breakdown, comparison }];
    }
    case "breakdown": {
      const m = need();
      const dimension = plan.breakdown ?? m.shareOf;
      if (!dimension) throw new Error("Breakdown needs a dimension");
      if (m.kind === "share" || (plan.grain && m.kind === "additive")) {
        return [{ op: "share_matrix", metric: m.id, period, dimension, grain: plan.grain ?? "month", filters }];
      }
      if (plan.grain) {
        // A rate per group over time is a multi-series trend, not a share.
        return [{ op: "time_series", metric: m.id, period, grain: plan.grain, filters, breakdown: dimension, comparison: null }];
      }
      return [{ op: "group_share", metric: m.id, period, dimension, filters }];
    }
    case "ranking": {
      const m = need();
      const dimension = plan.breakdown ?? m.shareOf;
      if (!dimension) throw new Error("Ranking needs a dimension");
      return [{
        op: "group_rank", metric: m.id, period, dimension,
        direction: plan.rank?.direction ?? "desc",
        limit: plan.rank?.limit ?? 10, minSupport: m.kind === "ratio" ? (m.minSupport ?? null) : null, filters,
      }];
    }
    case "explain_change": {
      const m = need();
      const drivers = plan.drivers ?? (plan.breakdown ? [plan.breakdown] : (m.drivers ?? []));
      return [{ op: "contribution", metric: m.id, period, comparison: plan.comparison ?? previousPeriod(period), drivers, filters }];
    }
  }
}
