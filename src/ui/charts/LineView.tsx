"use client";

import { Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatValue } from "@/core/format";
import type { QueryResult, SeriesData } from "@/core/results";
import { ACCENT, INK, MONO, MUTED, PAPER, axisValue, colourFor, tick } from "../theme";
import { Legend, TipBox } from "./Tooltip";

type Row = Record<string, string | number | null>;

/** Line with a comparison series. Series are labelled directly at their ends. */
export function LineView({ result }: { result: QueryResult }) {
  const d = result.data as SeriesData;
  const unit = result.unit;
  const groups = d.series.every((s) => s.role === "group");
  const palette = colourFor(d.series.map((s) => s.label));
  const colour = (k: number) => {
    const s = d.series[k]!;
    if (groups) return palette.get(s.label)!;
    return s.role === "comparison" ? MUTED : ACCENT;
  };
  const n = Math.max(...d.series.map((s) => s.points.length));
  const rows: Row[] = Array.from({ length: n }, (_, i) => {
    const row: Row = { i, label: d.series[0]?.points[i]?.label ?? "" };
    d.series.forEach((s, k) => {
      row[`s${k}`] = s.points[i]?.value ?? null;
      row[`l${k}`] = s.points[i]?.label ?? "";
    });
    return row;
  });
  const lastIndex = (k: number) => {
    const pts = d.series[k]!.points;
    for (let i = pts.length - 1; i >= 0; i--) if (pts[i]!.value !== null) return i;
    return -1;
  };
  // End labels unless two series finish too close together; then a legend row instead.
  const values = d.series.flatMap((s) => s.points.map((p) => p.value)).filter((v): v is number => v !== null);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const ends = d.series.map((s, k) => d.series[k]!.points[lastIndex(k)]?.value ?? null).filter((v): v is number => v !== null);
  const collide = ends.some((a, i) => ends.some((b, j) => j > i && Math.abs(a - b) < (max - min) * 0.08));
  const useLegend = collide || (groups && d.series.length > 4);
  const labelWidth = useLegend ? 16 : Math.min(150, Math.max(...d.series.map((s) => s.label.length)) * 6.8 + 12);
  // Rates stay inside 0-100%.
  const domain: [number | string, number | string] = unit === "ratio" && values.length ? [Math.max(0, Math.floor(min * 20) / 20), Math.min(1, Math.ceil(max * 20) / 20)] : ["auto", "auto"];

  return (
    <div>
      {useLegend && d.series.length > 1 && <Legend items={d.series.map((s, k) => ({ label: s.label, colour: colour(k) }))} />}
      <ResponsiveContainer width="100%" height={280}>
        <LineChart data={rows} margin={{ top: 12, right: labelWidth, bottom: 4, left: 0 }}>
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: INK, strokeWidth: 1 }} interval={Math.max(0, Math.ceil(n / 7) - 1)} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={60} tickFormatter={(v: number) => axisValue(v, unit)} domain={domain} allowDataOverflow={false} />
          <Tooltip
            cursor={{ stroke: MUTED, strokeWidth: 1 }}
            isAnimationActive={false}
            content={({ active, label, payload }) =>
              active && payload?.length ? (
                <TipBox
                  title={String(label)}
                  rows={d.series.map((s, k) => {
                    const row = payload[0]!.payload as Row;
                    return { label: s.role === "comparison" && !groups ? `${s.label} (${row[`l${k}`]})` : s.label, value: formatValue(row[`s${k}`] as number | null, unit), colour: colour(k) };
                  })}
                />
              ) : null
            }
          />
          {d.series.map((s, k) => (
            <Line
              key={s.label}
              dataKey={`s${k}`}
              name={s.label}
              stroke={colour(k)}
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              dot={false}
              activeDot={{ r: 4, stroke: PAPER, strokeWidth: 2, fill: colour(k) }}
              isAnimationActive={false}
              label={(p: { x?: number | string; y?: number | string; index?: number }) =>
                !useLegend && p.index === lastIndex(k) ? (
                  <text key={`end-${k}`} x={Number(p.x) + 8} y={Number(p.y) + 4} fill={MUTED} fontSize={11} fontFamily={MONO}>
                    {s.label.length > 22 ? `${s.label.slice(0, 21)}…` : s.label}
                  </text>
                ) : (
                  <g key={`none-${k}-${p.index}`} />
                )
              }
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
