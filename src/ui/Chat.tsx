"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Answer, FollowUpPayload } from "@/core/answer";
import type { PipelineEvent, TraceEvent } from "@/core/trace";
import type { Form } from "@/core/types";
import { AnswerView, type EvalStatus } from "./AnswerView";
import { TraceSidebar } from "./TraceSidebar";

interface Turn {
  n: number;
  question: string;
  followUpOf: number | null;
  status: string[];
  trace: TraceEvent[];
  answer: Answer | null;
  evalStatus: EvalStatus | null;
  form: Form | null;
  failed: string | null;
}

/** The six planted scenarios, in demo order. */
const SUGGESTED = [
  "Why is captured value up this month?",
  "Which issuer had the lowest approval rate on Saturday 26 September?",
  "Which cards have the highest chargeback rate in the last 90 days?",
  "Show payment-method share by month.",
  "How did captured value move this month?",
  "Which customer will default?",
];

/** Status lines arrive in milliseconds on replay; show each long enough to read. */
const STATUS_PACE_MS = 220;

export function Chat({ backends, dataNote }: { backends: { decide: string; system2: string }; dataNote: string }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [followUp, setFollowUp] = useState<{ turn: number; payload: FollowUpPayload } | null>(null);
  const [traceOpen, setTraceOpen] = useState(true);
  const [traceTurn, setTraceTurn] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (window.matchMedia("(max-width: 1023px)").matches) setTraceOpen(false);
  }, []);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [turns]);

  const update = useCallback((n: number, f: (t: Turn) => Turn) => setTurns((ts) => ts.map((t) => (t.n === n ? f(t) : t))), []);

  const send = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q || busy) return;
      const n = turns.length + 1;
      const fu = followUp;
      setTurns((ts) => [...ts, { n, question: q, followUpOf: fu?.turn ?? null, status: [], trace: [], answer: null, evalStatus: null, form: null, failed: null }]);
      setInput("");
      setFollowUp(null);
      setBusy(true);
      setTraceTurn(n);

      const queue: string[] = [];
      let draining: Promise<void> = Promise.resolve();
      const showStatus = (text: string) => {
        queue.push(text);
        draining = draining.then(
          () =>
            new Promise<void>((resolve) => {
              update(n, (t) => ({ ...t, status: [...t.status, queue.shift()!] }));
              setTimeout(resolve, STATUS_PACE_MS);
            }),
        );
      };

      try {
        const res = await fetch("/api/ask", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ question: q, turn: n, ...(fu ? { followUp: fu.payload } : {}) }),
        });
        if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`);
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let final: { answer: Answer; evalStatus: EvalStatus | null } | null = null;
        let error: string | null = null;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let i: number;
          while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line) continue;
            const msg = JSON.parse(line) as PipelineEvent | { type: "answer"; answer: Answer; evalStatus: EvalStatus | null } | { type: "error"; message: string };
            if (msg.type === "status") showStatus(msg.text);
            else if (msg.type === "trace") update(n, (t) => ({ ...t, trace: [...t.trace, msg.event] }));
            else if (msg.type === "answer") final = { answer: msg.answer, evalStatus: msg.evalStatus };
            else if (msg.type === "error") error = msg.message;
          }
        }
        await draining;
        if (final) update(n, (t) => ({ ...t, answer: final!.answer, evalStatus: final!.evalStatus, form: final!.answer.form }));
        else update(n, (t) => ({ ...t, failed: error ?? "No answer came back." }));
      } catch (err) {
        await draining;
        update(n, (t) => ({ ...t, failed: err instanceof Error ? err.message : String(err) }));
      } finally {
        setBusy(false);
        inputRef.current?.focus();
      }
    },
    [busy, followUp, turns.length, update],
  );

  const selected = turns.find((t) => t.n === traceTurn) ?? turns.at(-1) ?? null;

  return (
    <div className="flex h-dvh overflow-hidden">
      <main className="flex-1 flex flex-col min-w-0">
        <header className="flex items-center justify-between gap-4 px-5 md:px-16 pt-5 pb-3">
          <span className="label" style={{ color: "#0A0A0A" }}>
            Hermitian
          </span>
          <nav className="flex items-center gap-4">
            <span className="mono-sm hidden md:inline">{dataNote}</span>
            <a href="/eval" className="label hover:underline">
              Eval
            </a>
            <button type="button" onClick={() => setTraceOpen((o) => !o)} className="label hover:underline" aria-expanded={traceOpen}>
              Trace
            </button>
          </nav>
        </header>

        <div ref={scroller} className="flex-1 overflow-y-auto">
          <div className="max-w-[720px] mx-auto px-5 md:px-16 py-8">
            {turns.length === 0 && (
              <div className="pt-[8vh]">
                <h1 style={{ fontSize: 44, fontWeight: 200, lineHeight: 1.1 }}>Ask about the payments.</h1>
                <p className="mt-4 max-w-[560px]" style={{ fontSize: 16 }}>
                  A typed System 1 model reads the question, deterministic code computes every number from a read-only database, and the narrative is checked
                  against the results before you see it.
                </p>
                <p className="mono-sm mt-2">{dataNote}. Unaffiliated demo; all data synthetic.</p>
                <div className="label mt-10 mb-2">Planted scenarios</div>
                <ul>
                  {SUGGESTED.map((s) => (
                    <li key={s} className="rule">
                      <button type="button" onClick={() => send(s)} className="w-full text-left py-2.5 hover:underline underline-offset-4" style={{ fontSize: 15 }}>
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {turns.map((t) => (
              <div key={t.n} className="mb-10">
                <div className="mb-6">
                  {t.followUpOf && <div className="label mb-1">Follow-up to turn {t.followUpOf}</div>}
                  <div className="bg-fill rounded px-4 py-3" style={{ fontSize: 15 }}>
                    {t.question}
                  </div>
                </div>
                {!t.answer && !t.failed && (
                  <ul className="space-y-1" aria-live="polite">
                    {t.status.map((s, i) => (
                      <li key={i} className="flex items-center gap-2 mono-sm">
                        {i === t.status.length - 1 ? <span className="think-dot" aria-hidden /> : <span className="w-2" aria-hidden />}
                        {s}
                      </li>
                    ))}
                    {t.status.length === 0 && (
                      <li className="flex items-center gap-2 mono-sm">
                        <span className="think-dot" aria-hidden />
                        Starting…
                      </li>
                    )}
                  </ul>
                )}
                {t.failed && (
                  <section className="rule pt-3">
                    <div className="label">Error</div>
                    <p className="mt-2">{t.failed}</p>
                  </section>
                )}
                {t.answer && (
                  <AnswerView
                    answer={t.answer}
                    evalStatus={t.evalStatus}
                    form={t.form ?? t.answer.form}
                    onForm={(f) => update(t.n, (x) => ({ ...x, form: f }))}
                    onFollowUp={() => {
                      setFollowUp({ turn: t.n, payload: t.answer!.followUp });
                      inputRef.current?.focus();
                    }}
                    onTrace={() => {
                      setTraceTurn(t.n);
                      setTraceOpen(true);
                    }}
                    traceSelected={traceOpen && selected?.n === t.n}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        <footer className="px-5 md:px-16 pb-5 pt-2">
          <div className="max-w-[720px] mx-auto">
            {followUp && (
              <div className="flex items-center justify-between gap-3 mb-2 mono-sm">
                <span className="truncate">
                  Following up on turn {followUp.turn}: {followUp.payload.question}
                </span>
                <button type="button" onClick={() => setFollowUp(null)} className="label hover:underline" aria-label="Clear follow-up">
                  Clear
                </button>
              </div>
            )}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(input);
              }}
              className="flex items-end gap-3 bg-fill rounded px-4 py-3"
            >
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void send(input);
                  }
                }}
                rows={1}
                placeholder={followUp ? "Ask a follow-up…" : "Ask a question about payments…"}
                aria-label="Question"
                className="flex-1 resize-none bg-transparent outline-none"
                style={{ fontSize: 15, maxHeight: 160 }}
              />
              <button type="submit" disabled={busy || !input.trim()} className="label disabled:opacity-40" style={{ color: "#0A0A0A" }}>
                {busy ? "Working" : "Ask"}
              </button>
            </form>
            <div className="mono-sm mt-2 flex justify-between gap-3">
              <span>Each question stands alone unless you press Follow up.</span>
              <span>
                System 1: {backends.decide} · System 2: {backends.system2}
              </span>
            </div>
          </div>
        </footer>
      </main>

      {traceOpen && (
        <div className="fixed inset-0 z-10 bg-paper lg:static lg:z-auto w-full lg:w-[360px] lg:flex-none" style={{ borderLeft: "1px solid #0A0A0A" }}>
          <TraceSidebar answer={selected?.answer ?? null} pendingTrace={selected && !selected.answer ? selected.trace : null} onClose={() => setTraceOpen(false)} />
        </div>
      )}
    </div>
  );
}
