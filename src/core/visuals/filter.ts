import type { QueryResult } from "../results";
import type { Form, Intent } from "../types";

/**
 * Gate 4: rules set the bounds. Code decides which forms fit a result's shape;
 * System 1 picks one inside them, and the user can switch to any other.
 */

export function validForms(result: QueryResult | null): Form[] {
  if (!result) return ["text"];
  const d = result.data;
  switch (d.shape) {
    case "scalar":
      return ["text", "kpi"];
    case "delta":
      return ["kpi", "text"];
    case "series": {
      const n = Math.max(0, ...d.series.map((s) => s.points.length));
      return n >= 3 ? ["line", "table"] : ["table", "text"];
    }
    case "categories": {
      const n = d.items.length;
      if (n === 0) return ["text"];
      if (n === 1) return ["text", "kpi", "table"];
      return n <= 25 ? ["hbar", "table"] : ["table"];
    }
    case "share_matrix":
      return d.categories.length <= 6 ? (d.buckets.length >= 3 ? ["stacked100", "table", "line"] : ["stacked100", "table"]) : ["table"];
    case "contribution":
      return d.steps.length >= 1 ? ["waterfall", "table"] : ["text"];
    case "records":
      return ["table"];
  }
}

const PREFERRED: Record<Intent, Form[]> = {
  lookup: ["text", "kpi", "hbar", "table"],
  compare: ["kpi", "text"],
  trend: ["line", "stacked100", "table"],
  breakdown: ["stacked100", "hbar", "table"],
  ranking: ["hbar", "table"],
  explain_change: ["waterfall", "table"],
  record_listing: ["table"],
  out_of_scope: ["text"],
};

/** Deterministic fallback when System 1 abstains or is unsure. */
export function defaultForm(intent: Intent, valid: Form[]): Form {
  return PREFERRED[intent].find((f) => valid.includes(f)) ?? valid[0] ?? "text";
}

/** A short description of the result's shape for System 1 (no data rows). */
export function describeShape(result: QueryResult): string {
  const d = result.data;
  switch (d.shape) {
    case "scalar":
      return "one value for one period";
    case "delta":
      return "one value in the current period and one in a comparison period, with the change";
    case "series":
      return `a time series by ${d.grain}: ${d.series.length} series of ${d.series[0]?.points.length ?? 0} points`;
    case "categories":
      return `${d.items.length} groups by ${d.dimensionLabel.toLowerCase()}${d.direction ? `, ranked ${d.direction === "asc" ? "lowest first" : "highest first"}` : ""}`;
    case "share_matrix":
      return `shares of ${d.categories.length} ${d.dimensionLabel.toLowerCase()} groups in each of ${d.buckets.length} ${d.grain}s, summing to 100% per ${d.grain}`;
    case "contribution":
      return `a start total, an end total and ${d.steps.length} contributions to the change between them`;
    case "records":
      return `${d.rows.length} individual records with ${d.columns.length} columns`;
  }
}
