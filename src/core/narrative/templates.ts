import { formatDelta, formatPp, formatSignedPct, formatValue } from "../format";
import type { QueryResult } from "../results";

/** Deterministic headlines, built only from query results. Used when System 2's headline fails grounding. */

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

export function templateHeadline(r: QueryResult): string {
  const d = r.data;
  const m = r.metricLabel ?? "Value";
  const u = r.unit;
  switch (d.shape) {
    case "scalar":
      return `${m} was ${formatValue(d.value, u)} in ${d.period.label}`;
    case "delta": {
      if (d.delta === null || d.pctChange === null) return `${m}: ${d.period.label} against ${d.comparison.label}`;
      const dir = d.delta >= 0 ? "up" : "down";
      const by = u === "ratio" ? formatPp(Math.abs(d.deltaPp ?? 0)) : formatSignedPct(Math.abs(d.pctChange)).replace("+", "");
      return `${m} ${dir} ${by} on ${d.comparison.label}`;
    }
    case "series": {
      const s = d.series[0];
      const pts = s?.points.filter((p) => p.value !== null) ?? [];
      if (!pts.length) return `${m} over ${d.period.label}`;
      const max = pts.reduce((a, b) => (b.value! > a.value! ? b : a));
      const min = pts.reduce((a, b) => (b.value! < a.value! ? b : a));
      return r.metricId && !["chargeback_rate", "refund_rate"].includes(r.metricId) && u === "ratio"
        ? `${m} lowest at ${min.label}: ${formatValue(min.value, u)}`
        : `${m} peaked at ${formatValue(max.value, u)} on ${max.label}`;
    }
    case "categories": {
      const top = d.items[0];
      if (!top) return `No ${d.dimensionLabel.toLowerCase()} groups in ${d.period.label}`;
      if (d.direction) return `${top.label} has the ${d.direction === "asc" ? "lowest" : "highest"} ${lower(m)}`;
      return `${top.label} leads ${lower(m)} at ${formatValue(top.share ?? top.value, top.share !== null ? "ratio" : u)}`;
    }
    case "share_matrix": {
      const last = d.buckets.at(-1);
      const lead = d.categories[0];
      const cell = d.cells.find((c) => c.bucket === last?.key && c.category === lead);
      return last && lead && cell ? `${lead} leads in ${last.label} at ${formatValue(cell.share, "ratio")}` : `${m} by ${d.dimensionLabel.toLowerCase()}`;
    }
    case "contribution": {
      const change = d.deltaUnit === "pp" ? formatPp(d.change * 100) : formatDelta(d.change, u);
      return `${m} ${d.change >= 0 ? "rose" : "fell"} ${change.replace(/^[+-]/, "")} on ${d.comparison.label}`;
    }
    case "records":
      return d.rows.length === d.totalMatching
        ? `${d.recordLabel} matching the question: ${d.totalMatching}`
        : `${d.rows.length} of ${d.totalMatching} matching ${d.recordLabel.toLowerCase()}, newest first`;
  }
}
