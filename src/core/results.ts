import type { Grain, Period, Unit } from "./types";
import type { Row } from "./adapter";

/**
 * Typed query results. Every number in here came out of a DuckDB query; charts
 * and tables bind to a result by its id and read only these fields.
 */

export interface ScalarData {
  shape: "scalar";
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  period: Period;
}

export interface DeltaData {
  shape: "delta";
  current: number | null;
  previous: number | null;
  /** current - previous, in the metric's unit (ratio units for ratios). */
  delta: number | null;
  /** Percentage-point change, ratios only. */
  deltaPp: number | null;
  /** Relative change (0.067 = +6.7%). */
  pctChange: number | null;
  currentNumerator: number | null;
  currentDenominator: number | null;
  previousNumerator: number | null;
  previousDenominator: number | null;
  period: Period;
  comparison: Period;
}

export interface SeriesPoint {
  key: string;
  label: string;
  value: number | null;
  numerator: number | null;
  denominator: number | null;
}

export interface Series {
  label: string;
  role: "primary" | "comparison" | "group";
  points: SeriesPoint[];
}

export interface SeriesData {
  shape: "series";
  grain: Grain;
  period: Period;
  series: Series[];
}

export interface CategoryItem {
  key: string;
  label: string;
  value: number | null;
  share: number | null;
  numerator: number | null;
  denominator: number | null;
  rank: number;
}

export interface CategoryData {
  shape: "categories";
  dimension: string;
  dimensionLabel: string;
  period: Period;
  items: CategoryItem[];
  /** Groups before the minimum-support filter and the limit. */
  groupsTotal: number;
  groupsBelowSupport: number;
  direction: "asc" | "desc" | null;
  minSupport: number | null;
}

export interface ShareCell {
  bucket: string;
  category: string;
  value: number;
  share: number;
}

export interface ShareMatrixData {
  shape: "share_matrix";
  grain: Grain;
  dimension: string;
  dimensionLabel: string;
  period: Period;
  buckets: { key: string; label: string }[];
  categories: string[];
  cells: ShareCell[];
}

export interface ContributionStep {
  key: string;
  label: string;
  previous: number | null;
  current: number | null;
  delta: number;
}

export interface ContributionData {
  shape: "contribution";
  drivers: string[];
  driverLabel: string;
  period: Period;
  comparison: Period;
  start: number;
  end: number;
  change: number;
  pctChange: number | null;
  steps: ContributionStep[];
  /** Ratio metrics decompose in rate units; shown as percentage points. */
  deltaUnit: Unit | "pp";
}

export interface RecordColumnMeta {
  id: string;
  label: string;
  type: "id" | "datetime" | "zar" | "text" | "count";
}

export interface RecordsData {
  shape: "records";
  recordType: string;
  recordLabel: string;
  period: Period;
  columns: RecordColumnMeta[];
  rows: Row[];
  totalMatching: number;
}

export type ResultData = ScalarData | DeltaData | SeriesData | CategoryData | ShareMatrixData | ContributionData | RecordsData;
export type ResultShape = ResultData["shape"];

export interface QueryResult {
  /** "q1", "q2", ... within a turn. */
  id: string;
  op: string;
  metricId: string | null;
  metricLabel: string | null;
  unit: Unit;
  views: string[];
  sql: string[];
  rowCount: number;
  latencyMs: number;
  notes: string[];
  data: ResultData;
}
