import type { Unit } from "./types";

/**
 * The contract between the harness and a data source. An adapter describes its
 * metrics, dimensions and record types here; core builds every query, question
 * and gate from this description and never sees a raw table.
 */

/** One aggregate over one semantic view, restricted to a period by `timeColumn`. */
export interface MetricTerm {
  view: string;
  timeColumn: string;
  /** Aggregate SQL over the view, e.g. `SUM(amount_cents)`. */
  expr: string;
  /** Extra row filter, e.g. `status = 'RefundCompleted'`. */
  where?: string;
  /** The aggregate is divided by this to reach the metric's unit (cents -> rand). */
  divisor?: number;
  /** Unit of the scaled aggregate; defaults to a count. */
  unit?: "zar" | "count";
}

export interface MetricDef {
  id: string;
  label: string;
  /** Upper-case topic label for the answer header. */
  topic: string;
  /** Option text shown to System 1. */
  description: string;
  /** Human definition shown in the trace. */
  definition: string;
  unit: Unit;
  /**
   * additive: sums across groups and periods. ratio: numerator / denominator.
   * distinct: a distinct count (not additive). share: each group's share of an additive base.
   */
  kind: "additive" | "ratio" | "distinct" | "share";
  numerator: MetricTerm;
  denominator?: MetricTerm;
  /** Fields the metric needs; gate 1 checks each exists in its view. */
  requiredFields: string[];
  /** Dimensions this metric can be broken down or filtered by. */
  dimensions: string[];
  /** Dimension forced for share metrics (e.g. payment method). */
  shareOf?: string;
  /** Default drivers for explain-change contribution analysis. */
  drivers?: string[];
  higherIsBetter: boolean;
  /** Minimum denominator per group before a ratio is ranked. */
  minSupport?: number;
  /** Label for the numerator / denominator in facts ("approved attempts"). */
  numeratorLabel?: string;
  denominatorLabel?: string;
}

export interface DimensionDef {
  id: string;
  label: string;
  description: string;
  /** SQL expression for this dimension in each view that has it. */
  columns: Record<string, string>;
  kind: "categorical" | "entity";
  /** Known values, for filter questions. Omit for high-cardinality dimensions. */
  values?: string[];
  /** Entity IDs in questions are matched with this pattern instead of a model. */
  idPattern?: string;
  /** Whether System 1 gets a filter question listing `values`. */
  filterQuestion?: boolean;
  /** Fuzzy-matched filter: options are narrowed to values found in the question. */
  fuzzyFilter?: boolean;
  /** Natural sort order for display (e.g. hours, weekdays). */
  order?: string[];
  /** Label for rows where the dimension does not apply (e.g. no issuer). */
  nullLabel?: string;
}

export interface RecordColumn {
  id: string;
  label: string;
  expr: string;
  type: "id" | "datetime" | "zar" | "text" | "count";
}

export interface RecordTypeDef {
  id: string;
  label: string;
  description: string;
  view: string;
  timeColumn: string;
  columns: RecordColumn[];
  dimensions: string[];
  /** Amount column (cents) for amount filters. */
  amountColumn?: string;
}

export interface Catalog {
  sourceName: string;
  description: string;
  currency: string;
  dataStart: string;
  dataEnd: string;
  asOf: string;
  views: Record<string, { description: string; fields: string[] }>;
  metrics: MetricDef[];
  dimensions: DimensionDef[];
  recordTypes: RecordTypeDef[];
  /** Amount column (cents) per view, for "over R5,000" filters. */
  amountColumns: Record<string, string>;
  /** Subjects the data cannot answer, used in out-of-scope replies. */
  outOfScopeExamples: string[];
}

export function metricById(catalog: Catalog, id: string): MetricDef | undefined {
  return catalog.metrics.find((m) => m.id === id);
}

export function dimensionById(catalog: Catalog, id: string): DimensionDef | undefined {
  return catalog.dimensions.find((d) => d.id === id);
}

export function recordTypeById(catalog: Catalog, id: string): RecordTypeDef | undefined {
  return catalog.recordTypes.find((r) => r.id === id);
}

export function metricViews(m: MetricDef): string[] {
  return [...new Set([m.numerator.view, ...(m.denominator ? [m.denominator.view] : [])])];
}
