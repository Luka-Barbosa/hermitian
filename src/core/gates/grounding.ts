import { daysBetween } from "../periods";
import type { QueryResult } from "../results";

/**
 * Gate 3, code half: every number, date and time in generated text must match
 * a query result. A claim that fails is cut and logged; it never reaches the answer.
 */

export interface Allowed {
  zar: number[];
  pct: number[];
  pp: number[];
  plain: number[];
  /** "MM-DD" */
  dates: Set<string>;
  /** "HH:00" */
  times: Set<string>;
  days: Set<number>;
}

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
  jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_RE = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";

const pad = (n: number) => String(n).padStart(2, "0");

function addDate(a: Allowed, iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(iso);
  if (!m) return;
  a.dates.add(`${m[2]}-${m[3]}`);
  a.days.add(Number(m[3]));
  if (m[4]) a.times.add(`${m[4]}:00`);
}

function addPeriodDates(a: Allowed, p: { start: string; end: string }) {
  let d = p.start;
  for (let i = 0; i < 400 && d <= p.end; i++) {
    addDate(a, d);
    const next = new Date(`${d}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    d = next.toISOString().slice(0, 10);
  }
  a.plain.push(daysBetween(p.start, p.end));
}

export function allowedFrom(results: QueryResult[], context: number[] = []): Allowed {
  const a: Allowed = { zar: [], pct: [], pp: [], plain: [...context], dates: new Set(), times: new Set(), days: new Set() };
  const add = (x: number | null | undefined, unit: string) => {
    if (x === null || x === undefined || !Number.isFinite(x)) return;
    if (unit === "zar") a.zar.push(x);
    else if (unit === "count") a.plain.push(x);
    else if (unit === "ratio") a.pct.push(x * 100);
    else if (unit === "pp") a.pp.push(x);
  };
  const addTerm = (x: number | null | undefined) => {
    add(x, "zar");
    add(x, "count");
  };
  for (const r of results) {
    const d = r.data;
    const u = r.unit;
    switch (d.shape) {
      case "scalar":
        add(d.value, u);
        addTerm(d.numerator);
        addTerm(d.denominator);
        addPeriodDates(a, d.period);
        break;
      case "delta":
        add(d.current, u);
        add(d.previous, u);
        if (u === "ratio") add(d.deltaPp, "pp");
        else add(d.delta, u);
        if (d.pctChange !== null) a.pct.push(d.pctChange * 100);
        for (const x of [d.currentNumerator, d.currentDenominator, d.previousNumerator, d.previousDenominator]) addTerm(x);
        addPeriodDates(a, d.period);
        addPeriodDates(a, d.comparison);
        break;
      case "series":
        for (const s of d.series) for (const p of s.points) {
          add(p.value, u);
          addTerm(p.numerator);
          addTerm(p.denominator);
          addDate(a, p.key);
          if (d.grain === "hour") a.times.add(`${p.key.slice(11, 13)}:00`);
        }
        addPeriodDates(a, d.period);
        a.plain.push(d.series.length);
        break;
      case "categories":
        for (const it of d.items) {
          add(it.value, u);
          if (it.share !== null) a.pct.push(it.share * 100);
          addTerm(it.numerator);
          addTerm(it.denominator);
          if (/^\d{2}:00$/.test(it.label)) a.times.add(it.label);
        }
        a.plain.push(d.items.length, d.groupsTotal, d.groupsBelowSupport);
        if (d.minSupport) a.plain.push(d.minSupport);
        addPeriodDates(a, d.period);
        break;
      case "share_matrix":
        for (const c of d.cells) {
          a.pct.push(c.share * 100);
          a.zar.push(c.value);
        }
        a.plain.push(d.categories.length, d.buckets.length);
        addPeriodDates(a, d.period);
        break;
      case "contribution": {
        const du = d.deltaUnit;
        add(d.start, u);
        add(d.end, u);
        if (du === "pp") a.pp.push(d.change * 100);
        else add(d.change, u);
        if (d.pctChange !== null) a.pct.push(d.pctChange * 100);
        for (const s of d.steps) {
          if (du === "pp") a.pp.push(s.delta * 100);
          else add(s.delta, u);
          add(s.previous, u);
          add(s.current, u);
        }
        addPeriodDates(a, d.period);
        addPeriodDates(a, d.comparison);
        break;
      }
      case "records":
        for (const row of d.rows) for (const c of d.columns) {
          const val = row[c.id];
          if (val === null || val === undefined) continue;
          if (c.type === "zar") a.zar.push(Number(val));
          else if (c.type === "count") a.plain.push(Number(val));
          else if (c.type === "datetime") addDate(a, String(val));
          else for (const n of String(val).match(/\d+(?:\.\d+)?/g) ?? []) a.plain.push(Number(n));
        }
        a.plain.push(d.rows.length, d.totalMatching);
        addPeriodDates(a, d.period);
        break;
    }
  }
  return a;
}

export interface NumberToken {
  raw: string;
  kind: "zar" | "pct" | "pp" | "plain" | "multiple";
  value: number;
  decimals: number;
  scale: number;
}

const SCALES: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mn: 1e6, million: 1e6, bn: 1e9, billion: 1e9 };

function parseNum(s: string): { value: number; decimals: number } {
  const clean = s.replaceAll(",", "");
  const dot = clean.indexOf(".");
  return { value: Number(clean), decimals: dot === -1 ? 0 : clean.length - dot - 1 };
}

export interface Extracted {
  numbers: NumberToken[];
  dates: { month: number | null; day: number; raw: string }[];
  times: string[];
}

export function extract(text: string): Extracted {
  let t = ` ${text} `;
  const dates: Extracted["dates"] = [];
  const times: string[] = [];
  const blank = (m: string) => " ".repeat(m.length);

  t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (m, h) => {
    times.push(`${pad(Number(h))}:00`);
    return blank(m);
  });
  t = t.replace(/\b(1[0-2]|0?[1-9])\s?(am|pm)\b/gi, (m, h, ap) => {
    const hour = (Number(h) % 12) + (ap.toLowerCase() === "pm" ? 12 : 0);
    times.push(`${pad(hour)}:00`);
    return blank(m);
  });
  t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, _y, mo, d) => {
    dates.push({ month: Number(mo), day: Number(d), raw: m });
    return blank(m);
  });
  // Day ranges: "24–30 Sep", "1-15 September".
  t = t.replace(new RegExp(`\\b(\\d{1,2})\\s?[–—-]\\s?(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}\\b`, "gi"), (m, d1, d2, mo) => {
    const month = MONTHS[mo.toLowerCase()] ?? null;
    dates.push({ month, day: Number(d1), raw: m }, { month, day: Number(d2), raw: m });
    return blank(m);
  });
  t = t.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH_RE}\\b`, "gi"), (m, d, mo) => {
    dates.push({ month: MONTHS[mo.toLowerCase()] ?? null, day: Number(d), raw: m });
    return blank(m);
  });
  t = t.replace(new RegExp(`\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?!\\s*\\d{3})`, "gi"), (m, mo, d) => {
    dates.push({ month: MONTHS[mo.toLowerCase()] ?? null, day: Number(d), raw: m });
    return blank(m);
  });
  t = t.replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, (m, d) => {
    dates.push({ month: null, day: Number(d), raw: m });
    return blank(m);
  });
  t = t.replace(/\b20\d\d\b/g, blank);

  const numbers: NumberToken[] = [];
  // Rand amounts: a capital R not inside a word ("for 24" is not R24).
  t = t.replace(/[-−+]?(?<![A-Za-z])R\s?(\d[\d,]*(?:\.\d+)?)\s?(bn|billion|mn|million|m|k|thousand)?\b/g, (m, n, sc) => {
    numbers.push({ raw: m.trim(), kind: "zar", ...parseNum(n), scale: SCALES[(sc ?? "").toLowerCase()] ?? 1 });
    return blank(m);
  });
  t = t.replace(/[-−+]?(\d[\d,]*(?:\.\d+)?)\s?(pp|percentage points?|points?)\b/gi, (m, n) => {
    numbers.push({ raw: m.trim(), kind: "pp", ...parseNum(n), scale: 1 });
    return blank(m);
  });
  t = t.replace(/[-−+]?(\d[\d,]*(?:\.\d+)?)\s?(%|per ?cent\b)/gi, (m, n) => {
    numbers.push({ raw: m.trim(), kind: "pct", ...parseNum(n), scale: 1 });
    return blank(m);
  });
  t = t.replace(/(?<![\w.])[-−+]?(\d[\d,]*(?:\.\d+)?)\s?(x|×|times\b)/gi, (m, n) => {
    numbers.push({ raw: m.trim(), kind: "multiple", ...parseNum(n), scale: 1 });
    return blank(m);
  });
  t.replace(/(?<![\w.])(\d[\d,]*(?:\.\d+)?)\s?(bn|billion|mn|million|thousand)?(?![\w])/gi, (m, n, sc) => {
    numbers.push({ raw: m.trim(), kind: "plain", ...parseNum(n), scale: SCALES[(sc ?? "").toLowerCase()] ?? 1 });
    return blank(m);
  });
  return { numbers, dates, times };
}

function matches(tok: NumberToken, pool: number[]): boolean {
  const half = 0.5 * 10 ** -tok.decimals;
  const lo = (Math.abs(tok.value) - half) * tok.scale - 1e-9;
  const hi = (Math.abs(tok.value) + half) * tok.scale + 1e-9;
  return pool.some((v) => {
    const x = Math.abs(v);
    return x >= lo && x <= hi;
  });
}

export function checkClaim(text: string, allowed: Allowed): { ok: boolean; problems: string[] } {
  const { numbers, dates, times } = extract(text);
  const problems: string[] = [];
  for (const n of numbers) {
    let ok = false;
    if (n.kind === "zar") ok = matches(n, allowed.zar);
    else if (n.kind === "pct") ok = matches(n, allowed.pct);
    else if (n.kind === "pp") ok = matches(n, allowed.pp);
    else if (n.kind === "plain") ok = matches(n, allowed.plain) || matches(n, allowed.zar);
    if (!ok) problems.push(n.kind === "multiple" ? `"${n.raw}" is a derived multiple, not a query result` : `"${n.raw}" does not match any query result`);
  }
  for (const d of dates) {
    const ok = d.month === null ? allowed.days.has(d.day) : allowed.dates.has(`${pad(d.month)}-${pad(d.day)}`);
    if (!ok) problems.push(`date "${d.raw}" is outside the queried data`);
  }
  for (const h of times) if (!allowed.times.has(h)) problems.push(`time "${h}" is not in the results`);
  return { ok: problems.length === 0, problems };
}
