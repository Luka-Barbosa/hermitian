import type { Unit } from "@/core/types";

/** docs/design.md: colour appears only in plots and the thinking indicator. */
export const INK = "#0A0A0A";
export const MUTED = "#6B6B6B";
export const FILL = "#F4F4F4";
export const PAPER = "#FFFFFF";
export const ACCENT = "#2563EB";
/** Categorical order: blue, orange, green, rose, then grey for "other". */
export const SERIES = ["#2563EB", "#F97316", "#10B981", "#E11D48", "#6B6B6B"];
export const UP = "#10B981";
export const DOWN = "#E11D48";

export const MONO = "var(--font-geist-mono), ui-monospace, monospace";
export const tick = { fill: MUTED, fontSize: 11, fontFamily: MONO };

/** Colour follows the entity, never its rank: assign by sorted name. */
export function colourFor(categories: string[]): Map<string, string> {
  const sorted = [...categories].sort((a, b) => a.localeCompare(b));
  return new Map(sorted.map((c, i) => [c, SERIES[Math.min(i, SERIES.length - 1)]!]));
}

export function axisValue(v: number, unit: Unit | "pp"): string {
  if (!Number.isFinite(v)) return "";
  if (unit === "ratio") return `${Math.round(v * 1000) / 10}%`;
  if (unit === "pp") return `${(v * 100).toFixed(1)} pp`;
  const a = Math.abs(v);
  const s = v < 0 ? "-" : "";
  const p = unit === "zar" ? "R" : "";
  if (a >= 1e6) return `${s}${p}${(a / 1e6).toFixed(a >= 1e7 ? 0 : 1)}m`;
  if (a >= 1e3) return `${s}${p}${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${s}${p}${Math.round(a * 100) / 100}`;
}
