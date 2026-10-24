"use client";

import { formatDelta, formatPct, formatPp, formatTerm, formatValue, formatZar } from "@/core/format";
import type { QueryResult } from "@/core/results";

interface Col {
  label: string;
  numeric: boolean;
}

/** Any result as a table: a top rule per row, a pale header row, mono numbers. */
export function toTable(result: QueryResult): { cols: Col[]; rows: string[][]; caption?: string } {
  const d = result.data;
  const u = result.unit;
  const v = (x: number | null) => formatValue(x, u);
  switch (d.shape) {
    case "scalar":
      return { cols: [{ label: "Metric", numeric: false }, { label: "Period", numeric: false }, { label: "Value", numeric: true }], rows: [[result.metricLabel ?? "", d.period.label, v(d.value)]] };
    case "delta":
      return {
        cols: [{ label: "Period", numeric: false }, { label: result.metricLabel ?? "Value", numeric: true }],
        rows: [
          [d.period.label, v(d.current)],
          [d.comparison.label, v(d.previous)],
          ["Change", u === "ratio" ? (d.deltaPp !== null ? formatPp(d.deltaPp) : "—") : d.delta !== null ? formatDelta(d.delta, u) : "—"],
        ],
      };
    case "series": {
      const n = Math.max(...d.series.map((s) => s.points.length));
      return {
        cols: [{ label: d.grain, numeric: false }, ...d.series.map((s) => ({ label: s.label, numeric: true }))],
        rows: Array.from({ length: n }, (_, i) => [d.series[0]?.points[i]?.label ?? "", ...d.series.map((s) => v(s.points[i]?.value ?? null))]),
      };
    }
    case "categories": {
      const t = result.terms;
      const ratio = t !== null && d.items.some((i) => i.denominator !== null);
      const share = d.items.some((i) => i.share !== null) && result.metricId !== "payment_method_share";
      return {
        cols: [
          { label: "#", numeric: true }, { label: d.dimensionLabel, numeric: false }, { label: result.metricLabel ?? "Value", numeric: true },
          ...(ratio && t ? [{ label: t.numerator.label, numeric: true }, { label: t.denominator.label, numeric: true }] : []), ...(share ? [{ label: "Share", numeric: true }] : []),
        ],
        rows: d.items.map((i) => [
          String(i.rank), i.label, v(i.value),
          ...(ratio && t ? [formatTerm(i.numerator ?? 0, t.numerator.unit), formatTerm(i.denominator ?? 0, t.denominator.unit)] : []),
          ...(share ? [i.share !== null ? formatPct(i.share) : "—"] : []),
        ]),
        caption: d.minSupport ? `${d.groupsBelowSupport.toLocaleString("en-US")} of ${d.groupsTotal.toLocaleString("en-US")} groups have fewer than ${d.minSupport} ${result.terms?.denominator.label ?? "in the denominator"} and are not ranked.` : undefined,
      };
    }
    case "share_matrix":
      return {
        cols: [{ label: d.grain, numeric: false }, ...d.categories.map((c) => ({ label: c, numeric: true }))],
        rows: d.buckets.map((b) => [b.label, ...d.categories.map((c) => formatPct(d.cells.find((x) => x.bucket === b.key && x.category === c)?.share ?? 0))]),
      };
    case "contribution": {
      const step = (x: number) => (d.deltaUnit === "pp" ? formatPp(x * 100) : formatDelta(x, u));
      return {
        cols: [{ label: d.driverLabel, numeric: false }, { label: d.comparison.label, numeric: true }, { label: d.period.label, numeric: true }, { label: "Contribution", numeric: true }],
        rows: [
          ...d.steps.map((s) => [s.label, v(s.previous), v(s.current), step(s.delta)]),
          ["Total", v(d.start), v(d.end), step(d.change)],
        ],
      };
    }
    case "records":
      return {
        cols: d.columns.map((c) => ({ label: c.label, numeric: c.type === "zar" || c.type === "count" })),
        rows: d.rows.map((r) => d.columns.map((c) => {
          const x = r[c.id];
          if (x === null || x === undefined) return "—";
          return c.type === "zar" ? formatZar(Number(x), "exact") : String(x);
        })),
        caption: `${d.rows.length} of ${d.totalMatching} matching ${d.recordLabel.toLowerCase()}, newest first.`,
      };
  }
}

export function TableView({ result }: { result: QueryResult }) {
  const t = toTable(result);
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse" style={{ fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#F4F4F4" }}>
            {t.cols.map((c) => (
              <th key={c.label} className={`label px-2 py-1.5 ${c.numeric ? "text-right" : "text-left"}`} style={{ color: "#0A0A0A" }}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {t.rows.map((r, i) => (
            <tr key={i} className="rule">
              {r.map((cell, j) => (
                <td key={j} className={`px-2 py-1.5 ${t.cols[j]?.numeric ? "text-right font-mono" : ""} ${/^(pay|cus|fp|dsp|ref)_/.test(cell) ? "font-mono" : ""}`} style={{ fontSize: t.cols[j]?.numeric || /^(pay|cus|fp|dsp|ref)_/.test(cell) ? 12 : 13 }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {t.caption && <div className="mono-sm mt-2">{t.caption}</div>}
    </div>
  );
}
