"use client";

import { FILL, INK, MONO, MUTED } from "../theme";

export interface TipRow {
  label: string;
  value: string;
  colour?: string;
}

/** Hover tooltip: pale fill, no border, mono numbers. */
export function TipBox({ title, rows }: { title: string; rows: TipRow[] }) {
  return (
    <div style={{ background: FILL, padding: "8px 10px", borderRadius: 4, fontFamily: MONO, fontSize: 11, color: INK, minWidth: 140 }}>
      <div style={{ color: MUTED, marginBottom: 4 }}>{title}</div>
      {rows.map((r) => (
        <div key={r.label} style={{ display: "flex", alignItems: "center", gap: 6, justifyContent: "space-between" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            {r.colour && <span style={{ width: 8, height: 2, background: r.colour, display: "inline-block" }} />}
            {r.label}
          </span>
          <span>{r.value}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; colour: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3" style={{ fontFamily: MONO, fontSize: 11, color: MUTED }}>
      {items.map((i) => (
        <span key={i.label} className="flex items-center gap-1.5">
          <span style={{ width: 10, height: 10, background: i.colour, borderRadius: 2, display: "inline-block" }} />
          {i.label}
        </span>
      ))}
    </div>
  );
}
