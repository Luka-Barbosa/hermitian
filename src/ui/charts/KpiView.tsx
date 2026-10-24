"use client";

import { formatDelta, formatPp, formatSignedPct, formatTerm, formatValue } from "@/core/format";
import type { QueryResult } from "@/core/results";

/** Large, light number with a grey mono label above and a delta line below. */
export function KpiView({ result }: { result: QueryResult }) {
  const d = result.data;
  const unit = result.unit;
  let label = result.metricLabel ?? "Value";
  let value: number | null = null;
  let below = "";
  if (d.shape === "scalar") {
    label += ` · ${d.period.label}`;
    value = d.value;
    const t = result.terms;
    if (t && d.numerator !== null && d.denominator !== null) below = `${formatTerm(d.numerator, t.numerator.unit)} ${t.numerator.label} · ${formatTerm(d.denominator, t.denominator.unit)} ${t.denominator.label}`;
  } else if (d.shape === "delta") {
    label += ` · ${d.period.label}`;
    value = d.current;
    const change = unit === "ratio" ? (d.deltaPp !== null ? formatPp(d.deltaPp) : "") : d.delta !== null ? formatDelta(d.delta, unit) : "";
    const rel = d.pctChange !== null ? ` (${formatSignedPct(d.pctChange)})` : "";
    below = `${change}${rel} vs ${d.comparison.label}: ${formatValue(d.previous, unit)}`;
  } else if (d.shape === "categories" && d.items[0]) {
    label += ` · ${d.items[0].label}`;
    value = d.items[0].value;
  }
  return (
    <div className="py-2">
      <div className="label">{label}</div>
      <div style={{ fontSize: 72, fontWeight: 200, lineHeight: 1.05, letterSpacing: "-0.02em" }} className="my-2">
        {formatValue(value, unit)}
      </div>
      {below && <div className="mono-sm">{below}</div>}
    </div>
  );
}
