"use client";

import { Bar, BarChart, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatPct, formatValue } from "@/core/format";
import type { QueryResult, ShareMatrixData } from "@/core/results";
import { INK, MONO, MUTED, PAPER, colourFor, tick } from "../theme";
import { Legend, TipBox } from "./Tooltip";

/** 100% stacked columns with a 2px paper gap between segments; the last column is labelled directly. */
export function StackedView({ result }: { result: QueryResult }) {
  const d = result.data as ShareMatrixData;
  const palette = colourFor(d.categories);
  const rows = d.buckets.map((b) => {
    const row: Record<string, string | number> = { label: b.label, key: b.key };
    for (const c of d.categories) {
      const cell = d.cells.find((x) => x.bucket === b.key && x.category === c);
      row[c] = cell?.share ?? 0;
      row[`${c}__value`] = cell?.value ?? 0;
    }
    return row;
  });
  const last = rows.length - 1;
  // Stack bottom-up in reverse so the largest category (first) sits on top.
  const stackOrder = [...d.categories].reverse();
  return (
    <div>
      <Legend items={d.categories.map((c) => ({ label: c, colour: palette.get(c)! }))} />
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={rows} margin={{ top: 4, right: 128, bottom: 4, left: 0 }} barCategoryGap="22%">
          <XAxis dataKey="label" tick={tick} tickLine={false} axisLine={{ stroke: INK, strokeWidth: 1 }} interval={0} />
          <YAxis tick={tick} tickLine={false} axisLine={false} width={44} domain={[0, 1]} ticks={[0, 0.25, 0.5, 0.75, 1]} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
          <Tooltip
            cursor={{ fill: "rgba(10,10,10,0.04)" }}
            isAnimationActive={false}
            content={({ active, payload, label }) =>
              active && payload?.length ? (
                <TipBox
                  title={String(label)}
                  rows={d.categories.map((c) => {
                    const row = payload[0]!.payload as Record<string, number>;
                    return { label: c, value: `${formatPct(row[c] ?? 0)} · ${formatValue(row[`${c}__value`] ?? 0, "zar")}`, colour: palette.get(c) };
                  })}
                />
              ) : null
            }
          />
          {stackOrder.map((c) => (
            <Bar key={c} dataKey={c} stackId="share" fill={palette.get(c)} stroke={PAPER} strokeWidth={2} maxBarSize={40} isAnimationActive={false}>
              <LabelList
                dataKey={c}
                content={(p: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; index?: number; value?: unknown }) =>
                  p.index === last && Number(p.height) >= 12 ? (
                    <text x={Number(p.x) + Number(p.width) + 8} y={Number(p.y) + Number(p.height) / 2 + 4} fill={MUTED} fontSize={11} fontFamily={MONO}>
                      {`${c} ${formatPct(Number(p.value), 0)}`}
                    </text>
                  ) : null
                }
              />
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
