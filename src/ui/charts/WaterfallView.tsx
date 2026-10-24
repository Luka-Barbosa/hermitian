"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDelta, formatPp, formatValue } from "@/core/format";
import type { ContributionData, QueryResult } from "@/core/results";
import { DOWN, INK, MONO, MUTED, UP, axisValue, tick } from "../theme";
import { TipBox } from "./Tooltip";

interface WRow {
  label: string;
  range: [number, number];
  kind: "total" | "up" | "down";
  text: string;
  tipTitle: string;
}

/**
 * Horizontal waterfall (a bridge): the comparison total, each contribution,
 * the current total, read top to bottom. Bar positions are layout; every
 * printed number is a query result.
 */
export function WaterfallView({ result }: { result: QueryResult }) {
  const d = result.data as ContributionData;
  const unit = result.unit;
  const pp = d.deltaUnit === "pp";
  const fmtStep = (x: number) => (pp ? formatPp(x * 100) : formatDelta(x, unit));
  let level = d.start;
  const levels = [d.start];
  const steps = d.steps.map((s) => {
    const from = level;
    level += s.delta;
    levels.push(level);
    return { s, from, to: level };
  });
  const lo = Math.min(...levels, d.end);
  const hi = Math.max(...levels, d.end);
  // Rates start just below the lowest level so percentage-point steps are visible; rand starts at zero.
  const floor = pp ? lo - ((hi - lo) * 0.6 || 0.01) : 0;
  const ceiling = hi + (hi - floor) * 0.04;
  const rows: WRow[] = [
    { label: d.comparison.label, range: [floor, d.start], kind: "total", text: formatValue(d.start, unit), tipTitle: `${result.metricLabel}, ${d.comparison.label}` },
    ...steps.map(({ s, from, to }) => ({
      label: s.label,
      range: [Math.min(from, to), Math.max(from, to)] as [number, number],
      kind: (s.delta >= 0 ? "up" : "down") as WRow["kind"],
      text: fmtStep(s.delta),
      tipTitle: s.previous !== null && s.current !== null ? `${s.label}: ${formatValue(s.previous, unit)} → ${formatValue(s.current, unit)}` : s.label,
    })),
    { label: d.period.label, range: [floor, d.end], kind: "total", text: formatValue(d.end, unit), tipTitle: `${result.metricLabel}, ${d.period.label}` },
  ];
  const fill = (k: WRow["kind"]) => (k === "total" ? INK : k === "up" ? UP : DOWN);
  const width = Math.min(220, Math.max(...rows.map((r) => r.label.length)) * 6.8 + 12);
  return (
    <ResponsiveContainer width="100%" height={rows.length * 36 + 36}>
      <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 84, bottom: 4, left: 0 }} barCategoryGap={10}>
        <XAxis type="number" domain={[floor, ceiling]} allowDataOverflow tick={tick} tickLine={false} axisLine={false} tickFormatter={(v: number) => axisValue(v, unit)} tickCount={4} />
        <YAxis type="category" dataKey="label" width={width} interval={0} tick={tick} tickLine={false} axisLine={{ stroke: INK, strokeWidth: 1 }} />
        <Tooltip
          cursor={{ fill: "rgba(10,10,10,0.04)" }}
          isAnimationActive={false}
          content={({ active, payload }) => {
            const r = active ? (payload?.[0]?.payload as WRow | undefined) : undefined;
            return r ? <TipBox title={r.tipTitle} rows={[{ label: r.kind === "total" ? "total" : "contribution", value: r.text }]} /> : null;
          }}
        />
        <Bar dataKey="range" isAnimationActive={false} radius={2} barSize={18}>
          {rows.map((r) => (
            <Cell key={r.label} fill={fill(r.kind)} />
          ))}
          <LabelList
            dataKey="text"
            content={(p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: unknown }) => (
              <text x={Number(p.x) + Number(p.width) + 6} y={Number(p.y) + Number(p.height) / 2 + 4} fill={MUTED} fontSize={11} fontFamily={MONO}>
                {String(p.value)}
              </text>
            )}
          />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
