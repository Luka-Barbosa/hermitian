/** Shared vocabulary of the harness. Nothing here is data-source specific. */

export const INTENTS = [
  "lookup",
  "compare",
  "trend",
  "breakdown",
  "ranking",
  "explain_change",
  "record_listing",
  "out_of_scope",
] as const;
export type Intent = (typeof INTENTS)[number];

export const FORMS = ["text", "kpi", "table", "line", "hbar", "waterfall", "stacked100"] as const;
export type Form = (typeof FORMS)[number];

export const FORM_LABELS: Record<Form, string> = {
  text: "Text",
  kpi: "KPI card",
  table: "Table",
  line: "Line chart",
  hbar: "Horizontal bar",
  waterfall: "Waterfall",
  stacked100: "100% stacked bar",
};

/** What each visual is for, shown to System 1 when it picks one of the forms the code allows. */
export const FORM_HELP: Record<Form, string> = {
  text: "A sentence or two with no chart: one figure or a short statement is the whole answer",
  kpi: "One headline number, with its change against another period",
  table: "Exact values in rows and columns, or individual records to read one by one",
  line: "How a value moves over time",
  hbar: "Groups compared and ranked by one value, as bars from longest to shortest",
  waterfall: "How a start value became an end value, as a step for each contribution",
  stacked100: "How a total splits into parts, with every period adding up to 100%",
};

export const PERIOD_PRESETS = [
  "today",
  "yesterday",
  "last_7_days",
  "month_to_date",
  "last_month",
  "last_90_days",
  "last_6_months",
] as const;
export type PeriodPreset = (typeof PERIOD_PRESETS)[number];

export const GRAINS = ["hour", "day", "week", "month"] as const;
export type Grain = (typeof GRAINS)[number];

/** Every Choice question carries this option (CLAUDE.md non-negotiable 8). */
export const NONE_OF_THESE = "none_of_these";

export type Unit = "zar" | "count" | "ratio";

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** An inclusive date range, YYYY-MM-DD. */
export interface Period {
  preset: PeriodPreset | "custom" | "all";
  start: string;
  end: string;
  label: string;
}
