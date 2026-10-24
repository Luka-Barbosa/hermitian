import { formatCount, formatDelta, formatPct, formatPp, formatSignedPct, formatValue, formatZar } from "../format";
import type { QueryResult } from "../results";
import type { Unit } from "../types";

/**
 * Facts handed to System 2 for the narrative: formatted statements of values
 * that came out of the queries. Selection only (largest, smallest, first,
 * last); no arithmetic happens here.
 */

const MAX_LISTED_POINTS = 31;

function v(x: number | null, unit: Unit): string {
  return formatValue(x, unit);
}

export function factsFor(result: QueryResult): string[] {
  const d = result.data;
  const label = result.metricLabel ?? "Value";
  const unit = result.unit;
  const out: string[] = [];
  switch (d.shape) {
    case "scalar": {
      out.push(`${label}, ${d.period.label}: ${v(d.value, unit)}`);
      if (d.denominator !== null && d.numerator !== null && unit === "ratio") out.push(`That is ${formatCount(d.numerator)} out of ${formatCount(d.denominator)}.`);
      if (d.denominator !== null && d.numerator !== null && unit === "zar") out.push(`Based on ${formatZar(d.numerator)} over ${formatCount(d.denominator)} payments.`);
      break;
    }
    case "delta": {
      out.push(`${label}, ${d.period.label}: ${v(d.current, unit)}`);
      out.push(`${label}, ${d.comparison.label}: ${v(d.previous, unit)}`);
      if (unit === "ratio") {
        if (d.deltaPp !== null) out.push(`Change: ${formatPp(d.deltaPp)}`);
      } else if (d.delta !== null) out.push(`Change: ${formatDelta(d.delta, unit)}`);
      if (d.pctChange !== null) out.push(`Relative change: ${formatSignedPct(d.pctChange)}`);
      break;
    }
    case "series": {
      for (const s of d.series) {
        const pts = s.points.filter((p) => p.value !== null);
        if (!pts.length) continue;
        const max = pts.reduce((a, b) => (b.value! > a.value! ? b : a));
        const min = pts.reduce((a, b) => (b.value! < a.value! ? b : a));
        const role = s.role === "comparison" ? "Comparison series" : "Series";
        out.push(`${role} "${s.label}" (${label}, by ${d.grain}): lowest ${v(min.value, unit)} at ${min.label}; highest ${v(max.value, unit)} at ${max.label}.`);
        if (pts.length <= MAX_LISTED_POINTS) {
          out.push(`"${s.label}" points: ${pts.map((p) => `${p.label} ${v(p.value, unit)}`).join("; ")}`);
        }
      }
      break;
    }
    case "categories": {
      if (d.direction) out.push(`Ranked by ${label.toLowerCase()}, ${d.direction === "asc" ? "lowest" : "highest"} first: ${d.items[0]?.label ?? "none"} has the ${d.direction === "asc" ? "lowest" : "highest"} ${label.toLowerCase()} of the ${d.dimensionLabel.toLowerCase()} groups ranked.`);
      for (const it of d.items.slice(0, 10)) {
        let line = `${it.rank}. ${it.label}: ${v(it.value, unit)}`;
        if (unit === "ratio" && it.numerator !== null && it.denominator !== null) line += ` (${formatCount(it.numerator)} of ${formatCount(it.denominator)})`;
        else if (it.share !== null && result.metricId !== "payment_method_share") line += ` (${formatPct(it.share)} of total)`;
        out.push(line);
      }
      out.push(`${d.dimensionLabel} groups: ${formatCount(d.groupsTotal)} in total${d.minSupport ? `, ${formatCount(d.groupsBelowSupport)} with fewer than ${d.minSupport} not ranked` : ""}. Period: ${d.period.label}.`);
      break;
    }
    case "share_matrix": {
      for (const b of d.buckets) {
        const cells = d.categories.map((c) => d.cells.find((x) => x.bucket === b.key && x.category === c)).filter(Boolean);
        out.push(`${b.label}: ${cells.map((c) => `${c!.category} ${formatPct(c!.share)}`).join(", ")}`);
      }
      break;
    }
    case "contribution": {
      const du = d.deltaUnit;
      out.push(`${label}, ${d.comparison.label}: ${v(d.start, unit)}`);
      out.push(`${label}, ${d.period.label}: ${v(d.end, unit)}`);
      out.push(`Change: ${du === "pp" ? formatPp(d.change * 100) : formatDelta(d.change, unit)}${d.pctChange !== null ? ` (${formatSignedPct(d.pctChange)})` : ""}`);
      for (const s of d.steps) {
        const effect = du === "pp" ? formatPp(s.delta * 100) : formatDelta(s.delta, unit);
        const values = s.previous !== null && s.current !== null ? ` (${v(s.previous, unit)} → ${v(s.current, unit)})` : "";
        out.push(`Contribution of ${s.label}: ${effect}${values}`);
      }
      break;
    }
    case "records": {
      out.push(`${formatCount(d.rows.length)} ${d.recordLabel.toLowerCase()} shown, of ${formatCount(d.totalMatching)} matching in ${d.period.label}.`);
      for (const [i, row] of d.rows.slice(0, 5).entries()) {
        const parts = d.columns.map((c) => {
          const val = row[c.id];
          if (val === null || val === undefined) return `${c.label} —`;
          return `${c.label} ${c.type === "zar" ? formatZar(Number(val), "exact") : String(val)}`;
        });
        out.push(`Row ${i + 1}: ${parts.join(", ")}`);
      }
      break;
    }
  }
  return out;
}
