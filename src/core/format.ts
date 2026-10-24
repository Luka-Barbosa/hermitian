import type { Unit } from "./types";

/** Display formatting only. Formatting never changes a value, it only rounds it for reading. */

const en = (n: number, digits = 0) => n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export function formatZar(v: number, mode: "compact" | "exact" = "compact"): string {
  const sign = v < 0 ? "-" : "";
  const a = Math.abs(v);
  if (mode === "exact") return `${sign}R${en(a, 2)}`;
  if (a >= 1e9) return `${sign}R${(a / 1e9).toFixed(2)}bn`;
  if (a >= 1e6) return `${sign}R${(a / 1e6).toFixed(1)}m`;
  if (a >= 1e4) return `${sign}R${en(Math.round(a))}`;
  return `${sign}R${en(a, 2)}`;
}

export function formatCount(v: number): string {
  return en(v);
}

export function formatPct(ratio: number, digits = 1): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function formatSignedPct(ratio: number, digits = 1): string {
  const s = (ratio * 100).toFixed(digits);
  return ratio > 0 ? `+${s}%` : `${s}%`;
}

export function formatPp(pp: number, digits = 1): string {
  const s = pp.toFixed(digits);
  return `${pp > 0 ? "+" : ""}${s} pp`;
}

export function formatValue(v: number | null, unit: Unit | "pp", mode: "compact" | "exact" = "compact"): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (unit === "zar") return formatZar(v, mode);
  if (unit === "count") return formatCount(v);
  if (unit === "pp") return formatPp(v * 100);
  return formatPct(v);
}

export function formatDelta(v: number, unit: Unit | "pp"): string {
  if (unit === "zar") return v > 0 ? `+${formatZar(v)}` : formatZar(v);
  if (unit === "count") return v > 0 ? `+${formatCount(v)}` : formatCount(v);
  return formatPp(v * 100);
}
