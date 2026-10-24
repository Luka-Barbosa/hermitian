"use client";

import type { Answer } from "@/core/answer";
import type { SlotTrace, TraceEvent } from "@/core/trace";

const KIND_LABEL: Record<TraceEvent["kind"], string> = {
  system1: "system 1",
  escalation: "escalation",
  system2: "system 2",
  plan: "plan",
  gate: "gate",
  query: "query",
  visual: "visual",
  error: "error",
};

function Slots({ slots }: { slots: SlotTrace[] }) {
  const shown = slots.filter((s) => s.route !== "ignored");
  const hidden = slots.filter((s) => s.route === "ignored");
  const row = (s: SlotTrace) => (
    <tr key={s.slot} className="align-top">
      <td className="pr-2 py-0.5 text-muted break-words">{s.slot.replaceAll("_", " ")}</td>
      <td className="pr-2 py-0.5 break-words">
        {s.choice.replaceAll("_", " ")}
        {s.final !== s.choice && s.route !== "system1" ? ` → ${s.final.replaceAll("_", " ")}` : ""}
      </td>
      <td className="pr-2 py-0.5 text-right">{s.confidence !== null ? s.confidence.toFixed(2) : ""}</td>
      <td className="py-0.5 text-muted">{s.route === "system1" ? "acted" : s.route}</td>
    </tr>
  );
  return (
    <div className="mt-2">
      <table className="w-full table-fixed" style={{ fontSize: 11 }}>
        <colgroup>
          <col style={{ width: "42%" }} />
          <col style={{ width: "32%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
        <thead>
          <tr className="text-muted">
            <th className="text-left font-normal pr-2">slot</th>
            <th className="text-left font-normal pr-2">choice</th>
            <th className="text-right font-normal pr-2">conf</th>
            <th className="text-left font-normal">route</th>
          </tr>
        </thead>
        <tbody>{shown.map(row)}</tbody>
      </table>
      {hidden.length > 0 && (
        <details className="mt-1">
          <summary className="text-muted cursor-pointer">{hidden.length} slots not relevant to this intent</summary>
          <table className="w-full table-fixed" style={{ fontSize: 11 }}>
        <colgroup>
          <col style={{ width: "42%" }} />
          <col style={{ width: "32%" }} />
          <col style={{ width: "11%" }} />
          <col style={{ width: "15%" }} />
        </colgroup>
            <tbody>{hidden.map(row)}</tbody>
          </table>
        </details>
      )}
    </div>
  );
}

function Event({ e }: { e: TraceEvent }) {
  return (
    <li className="rule pt-2 pb-3">
      <div className="flex justify-between gap-2">
        <span className="label" style={{ color: "#0A0A0A" }}>
          {KIND_LABEL[e.kind]}
        </span>
        <span className="text-muted">
          {e.ok ? "" : e.kind === "gate" ? "fail · " : "· "}
          {e.latencyMs} ms
        </span>
      </div>
      <div className="mt-1" style={{ fontSize: 12 }}>
        {e.title}
      </div>
      {e.detail.length > 0 && (
        <dl className="mt-1 space-y-0.5">
          {e.detail.map(([k, v], i) => (
            <div key={i} className="grid grid-cols-[110px_1fr] gap-2">
              <dt className="text-muted">{k}</dt>
              <dd className="break-words">{v}</dd>
            </div>
          ))}
        </dl>
      )}
      {e.slots && <Slots slots={e.slots} />}
      {e.sql && (
        <details className="mt-2">
          <summary className="text-muted cursor-pointer">SQL ({e.sql.length})</summary>
          {e.sql.map((q, i) => (
            <pre key={i} className="mt-1 p-2 rounded overflow-x-auto" style={{ background: "#F4F4F4", fontSize: 10.5, lineHeight: 1.45 }}>
              {q}
            </pre>
          ))}
        </details>
      )}
    </li>
  );
}

export function TraceSidebar({ answer, pendingTrace, onClose }: { answer: Answer | null; pendingTrace: TraceEvent[] | null; onClose: () => void }) {
  const events = answer?.trace ?? pendingTrace ?? [];
  return (
    <aside className="h-full flex flex-col font-mono" style={{ fontSize: 11 }} aria-label="Trace">
      <div className="flex items-center justify-between px-5 py-4">
        <span className="label" style={{ color: "#0A0A0A" }}>
          Trace{answer ? ` · turn ${answer.turn}` : pendingTrace ? " · working" : ""}
        </span>
        <button type="button" onClick={onClose} className="label hover:underline" aria-label="Close trace">
          Close
        </button>
      </div>
      <div className="flex-1 overflow-y-auto px-5 pb-6">
        {!events.length && <p className="text-muted">Ask a question to see each decision, its confidence, the queries run and every gate.</p>}
        {answer && (
          <div className="mb-3 space-y-0.5 text-muted">
            <div>System 1: {answer.backends.decide} · System 2: {answer.backends.system2}</div>
            <div>
              Total {answer.latencyMs} ms · model time {answer.modelLatencyMs} ms{answer.backends.decide === "replay" ? " (recorded)" : ""}
            </div>
            <div>Route: {answer.route === "escalated" ? "escalated to System 2" : "System 1 only"}</div>
          </div>
        )}
        <ol>
          {events.map((e) => (
            <Event key={e.id} e={e} />
          ))}
        </ol>
      </div>
    </aside>
  );
}
