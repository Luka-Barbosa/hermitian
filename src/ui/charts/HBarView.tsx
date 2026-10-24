"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPct, formatTerm, formatValue } from "@/core/format";
import type { CategoryData, QueryResult } from "@/core/results";
import { ACCENT, INK, MONO, MUTED, tick } from "../theme";
import { TipBox } from "./Tooltip";

/** Horizontal bars from a zero baseline; the first-ranked group carries the accent. */
export function HBarView({ result }: { result: QueryResult }) {
  const d = result.data as CategoryData;
  const unit = result.unit;
  const rows = d.items.map((it) => ({ ...it, v: it.value ?? 0 }));
  const width = Math.min(200, Math.max(...rows.map((r) => r.label.length)) * 6.8 + 12);
  const height = Math.max(120, rows.length * 30 + 16);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 72, bottom: 4, left: 0 }} barCategoryGap={6}>
        <XAxis type="number" hide domain={[0, "dataMax"]} />
        <YAxis type="category" dataKey="label" width={width} tick={tick} tickLine={false} axisLine={{ stroke: INK, strokeWidth: 1 }} interval={0} />
        <Tooltip
          cursor={{ fill: "rgba(10,10,10,0.04)" }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const it = active ? (payload?.[0]?.payload as (typeof rows)[number] | undefined) : undefined;
            if (!it) return null;
            const extra = [];
            const t = result.terms;
            if (t && it.numerator !== null && it.denominator !== null) {
              extra.push({ label: t.numerator.label, value: formatTerm(it.numerator, t.numerator.unit) }, { label: t.denominator.label, value: formatTerm(it.denominator, t.denominator.unit) });
            }
            if (it.share !== null && result.metricId !== "payment_method_share") extra.push({ label: "share", value: formatPct(it.share) });
            return <TipBox title={`#${it.rank} ${it.label}`} rows={[{ label: result.metricLabel ?? "value", value: formatValue(it.value, unit) }, ...extra]} />;
          }}
        />
        <Bar dataKey="v" barSize={16} radius={[0, 4, 4, 0]} minPointSize={1} isAnimationActive={false}>
          {rows.map((r, i) => (
            <Cell key={r.key} fill={i === 0 ? ACCENT : MUTED} />
          ))}
          <LabelList
            dataKey="v"
            content={(p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => (
              <text x={Number(p.x) + Number(p.width) + 6} y={Number(p.y) + Number(p.height) / 2 + 4} fill={MUTED} fontSize={11} fontFamily={MONO}>
                {formatValue(Number(p.value), unit)}
              </text>
            )}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
