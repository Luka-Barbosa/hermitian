"use client";

import type { Answer } from "@/core/answer";
import type { QueryResult } from "@/core/results";
import { FORM_LABELS, type Form } from "@/core/types";
import { HBarView } from "./charts/HBarView";
import { KpiView } from "./charts/KpiView";
import { LineView } from "./charts/LineView";
import { StackedView } from "./charts/StackedView";
import { TableView } from "./charts/TableView";
import { WaterfallView } from "./charts/WaterfallView";

export interface EvalStatus {
  id: string;
  pass: boolean;
  reasons: string[];
  ranAt: string;
}

function FormBody({ form, result }: { form: Form; result: QueryResult }) {
  switch (form) {
    case "kpi":
      return <KpiView result={result} />;
    case "line":
      return <LineView result={result} />;
    case "hbar":
      return <HBarView result={result} />;
    case "waterfall":
      return <WaterfallView result={result} />;
    case "stacked100":
      return <StackedView result={result} />;
    case "table":
      return <TableView result={result} />;
    case "text":
      return null;
  }
}

export function AnswerView(props: {
  answer: Answer;
  evalStatus: EvalStatus | null;
  form: Form;
  onForm: (f: Form) => void;
  onFollowUp: () => void;
  onTrace: () => void;
  traceSelected: boolean;
}) {
  const { answer: a, form } = props;
  // Charts and tables bind to the result by id, never to the narrative text.
  const result = a.results.find((r) => r.id === a.primaryResultId);
  const confidence = a.intentConfidence !== null ? ` · ${a.intentConfidence.toFixed(2)}` : "";
  return (
    <section className="rule pt-3 pb-2" aria-label={a.headline}>
      <div className="flex items-baseline justify-between gap-4">
        <div className="label">{a.topic}</div>
        {props.evalStatus && (
          <a href="/eval" className="label hover:underline" title={`Last eval run ${props.evalStatus.ranAt}`}>
            eval {props.evalStatus.id} · {props.evalStatus.pass ? "pass" : `miss${props.evalStatus.reasons.length ? ` (${props.evalStatus.reasons.join(", ")})` : ""}`}
          </a>
        )}
      </div>
      <h2 className="mt-2 mb-4" style={{ fontSize: 24, fontWeight: 200, lineHeight: 1.25 }}>
        {a.headline}
      </h2>
      {result && form !== "text" && (
        <div className="mb-4">
          <FormBody form={form} result={result} />
        </div>
      )}
      {a.sentences.length > 0 && (
        <div className="space-y-2 mb-4" style={{ fontSize: 15 }}>
          {a.sentences.map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>
      )}
      {a.error && <pre className="mono-sm whitespace-pre-wrap bg-fill p-3 rounded mb-4">{a.error.hash ? `hash ${a.error.hash}` : a.error.kind}</pre>}
      {a.cutClaims.length > 0 && (
        <button type="button" onClick={props.onTrace} className="mono-sm block mb-3 text-left hover:underline">
          {a.cutClaims.length} {a.cutClaims.length === 1 ? "claim" : "claims"} cut by the grounding gate before display — see trace
        </button>
      )}
      {a.validForms.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-3">
          <span className="label">View</span>
          {a.validForms.map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => props.onForm(f)}
              className={`mono-sm ${f === form ? "underline underline-offset-4" : "hover:underline underline-offset-4"}`}
              style={{ color: f === form ? "#0A0A0A" : "#6B6B6B" }}
              aria-pressed={f === form}
            >
              {FORM_LABELS[f]}
              {f === a.form ? " (chosen)" : ""}
            </button>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 mono-sm">
        <span>{a.source || (a.outOfScope ? "no query run" : "—")}</span>
        <span className="flex items-center gap-3">
          <span title="Route: System 1 acted on its own, or escalated to System 2">
            {a.route === "escalated" ? "escalated" : "system 1"}
            {confidence}
          </span>
          <span>turn {a.turn}</span>
        </span>
      </div>
      <div className="flex gap-4 mt-3">
        {!a.error && (
          <button type="button" onClick={props.onFollowUp} className="label hover:underline" style={{ color: "#0A0A0A" }}>
            Follow up
          </button>
        )}
        <button type="button" onClick={props.onTrace} className="label hover:underline" style={{ color: props.traceSelected ? "#0A0A0A" : undefined }}>
          Trace
        </button>
      </div>
    </section>
  );
}
