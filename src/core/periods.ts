import type { Grain, Period, PeriodPreset } from "./types";

const DAY_MS = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const toMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const toIso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function addDays(iso: string, n: number): string {
  return toIso(toMs(iso) + n * DAY_MS);
}

export function daysBetween(start: string, end: string): number {
  return Math.round((toMs(end) - toMs(start)) / DAY_MS) + 1;
}

function monthStart(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

function monthEnd(iso: string): string {
  const d = new Date(toMs(iso));
  return toIso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
}

function addMonths(iso: string, n: number): string {
  const d = new Date(toMs(iso));
  return toIso(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

export function isValidIsoDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && toIso(toMs(s)) === s;
}

const day = (iso: string) => Number(iso.slice(8, 10));
const mon = (iso: string) => Number(iso.slice(5, 7)) - 1;
const yr = (iso: string) => iso.slice(0, 4);

/** "30 Sep 2026", "September 2026", "24–30 Sep 2026", "3 Jul – 30 Sep 2026", "Apr–Sep 2026". */
export function rangeLabel(start: string, end: string): string {
  if (start === end) return `${day(start)} ${MONTHS[mon(start)]} ${yr(start)}`;
  const fullMonths = start === monthStart(start) && end === monthEnd(end);
  if (fullMonths && start.slice(0, 7) === end.slice(0, 7)) return `${MONTHS_LONG[mon(start)]} ${yr(start)}`;
  if (fullMonths && yr(start) === yr(end)) return `${MONTHS[mon(start)]}–${MONTHS[mon(end)]} ${yr(end)}`;
  if (start.slice(0, 7) === end.slice(0, 7)) return `${day(start)}–${day(end)} ${MONTHS[mon(end)]} ${yr(end)}`;
  if (yr(start) === yr(end)) return `${day(start)} ${MONTHS[mon(start)]} – ${day(end)} ${MONTHS[mon(end)]} ${yr(end)}`;
  return `${day(start)} ${MONTHS[mon(start)]} ${yr(start)} – ${day(end)} ${MONTHS[mon(end)]} ${yr(end)}`;
}

export const PRESET_LABELS: Record<PeriodPreset, string> = {
  today: "Today",
  yesterday: "Yesterday",
  last_7_days: "Last 7 days",
  month_to_date: "Month to date",
  last_month: "Last month",
  last_90_days: "Last 90 days",
  last_6_months: "Last 6 months",
};

export function makePeriod(preset: Period["preset"], start: string, end: string): Period {
  return { preset, start, end, label: rangeLabel(start, end) };
}

/** Resolves a preset against the dataset's as-of date ("today"), never the wall clock. */
export function resolvePreset(preset: PeriodPreset, asOf: string): Period {
  switch (preset) {
    case "today":
      return makePeriod(preset, asOf, asOf);
    case "yesterday":
      return makePeriod(preset, addDays(asOf, -1), addDays(asOf, -1));
    case "last_7_days":
      return makePeriod(preset, addDays(asOf, -6), asOf);
    case "month_to_date":
      return makePeriod(preset, monthStart(asOf), asOf);
    case "last_month": {
      const start = addMonths(asOf, -1);
      return makePeriod(preset, start, monthEnd(start));
    }
    case "last_90_days":
      return makePeriod(preset, addDays(asOf, -89), asOf);
    case "last_6_months":
      return makePeriod(preset, addMonths(asOf, -5), asOf);
  }
}

/** The previous equivalent period, used when a comparison is needed but not named. */
export function previousPeriod(p: Period): Period {
  const isFullMonths = p.start === monthStart(p.start) && p.end === monthEnd(p.end);
  if (isFullMonths) {
    const months = (Number(yr(p.end)) - Number(yr(p.start))) * 12 + mon(p.end) - mon(p.start) + 1;
    const start = addMonths(p.start, -months);
    return makePeriod("custom", start, monthEnd(addMonths(p.start, -1)));
  }
  if (p.start === monthStart(p.start)) {
    // Month to date: the same days of the previous month, capped at its length.
    const prevStart = addMonths(p.start, -1);
    const prevEnd = toIso(Math.min(toMs(monthEnd(prevStart)), toMs(prevStart) + (day(p.end) - 1) * DAY_MS));
    return makePeriod("custom", prevStart, prevEnd);
  }
  const n = daysBetween(p.start, p.end);
  return makePeriod("custom", addDays(p.start, -n), addDays(p.start, -1));
}

export function autoGrain(p: Period): Grain {
  const n = daysBetween(p.start, p.end);
  if (n <= 2) return "hour";
  if (n <= 62) return "day";
  if (n <= 120) return "week";
  return "month";
}

export interface ClampResult {
  period: Period;
  clipped: boolean;
  empty: boolean;
}

/** Restricts a period to the data window. */
export function clampToData(p: Period, dataStart: string, dataEnd: string): ClampResult {
  const start = p.start < dataStart ? dataStart : p.start;
  const end = p.end > dataEnd ? dataEnd : p.end;
  if (start > end) return { period: p, clipped: true, empty: true };
  const clipped = start !== p.start || end !== p.end;
  return { period: clipped ? { ...p, start, end, label: rangeLabel(start, end) } : p, clipped, empty: false };
}

/** Day/month names a narrative may legitimately mention for a period. */
export function bucketLabel(key: string, grain: Grain): string {
  if (grain === "hour") return `${key.slice(11, 16)}`;
  if (grain === "month") return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
  if (grain === "week") return `w/c ${day(key)} ${MONTHS[mon(key)]}`;
  return `${day(key)} ${MONTHS[mon(key)]}`;
}
