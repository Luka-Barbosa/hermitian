import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

interface Row {
  id: string;
  question: string;
  scenario: string | null;
  expectedIntent: string;
  actualIntent: string;
  expectedForm: string;
  chosenForm: string;
  expectedAnswer: string;
  actualAnswer: string;
  route: string;
  latencyMs: number;
  modelLatencyMs: number;
  pass: boolean;
  intentOk: boolean;
  formOk: boolean;
  numbersOk: boolean;
  grounded: boolean;
  cutClaims: number;
}

interface Summary {
  ranAt: string;
  backend: string;
  questions: number;
  passed: number;
  meetsBar: boolean;
  bar: { item: string; ok: boolean; detail: string }[];
  rows: Row[];
}

function load(): Summary | null {
  const file = path.join(process.cwd(), "evals", "results", "latest.json");
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf8")) as Summary;
}

const why = (r: Row) => [!r.intentOk && `intent was ${r.actualIntent}`, !r.formOk && `form was ${r.chosenForm}`, !r.numbersOk && "numbers", !r.grounded && "ungrounded text"].filter(Boolean).join("; ");

/** The eval results table, misses first. Shown in the app, not hidden. */
export default function EvalPage() {
  const s = load();
  const rows = s ? [...s.rows].sort((a, b) => Number(a.pass) - Number(b.pass)) : [];
  return (
    <div className="max-w-[1100px] mx-auto px-5 md:px-16 py-8">
      <header className="flex items-center justify-between mb-10">
        <a href="/" className="label hover:underline" style={{ color: "#0A0A0A" }}>
          Hermitian
        </a>
        <a href="/" className="label hover:underline">
          Back to chat
        </a>
      </header>
      {!s && <p>No eval results yet. Run `pnpm eval`.</p>}
      {s && (
        <>
          <div className="label">Eval · {s.backend}</div>
          <h1 className="mt-2" style={{ fontSize: 44, fontWeight: 200, lineHeight: 1.1 }}>
            {s.passed} of {s.questions} questions pass
          </h1>
          <p className="mono-sm mt-2">
            Run {s.ranAt}. Expected answers come from the generator&apos;s answer key, never from the agent&apos;s query code.
          </p>
          <section className="rule mt-8 pt-3">
            <div className="label mb-2">Pass bar · {s.meetsBar ? "met" : "not met"}</div>
            <ul>
              {s.bar.map((b) => (
                <li key={b.item} className="grid grid-cols-[48px_1fr] gap-2 py-1">
                  <span className="mono-sm" style={{ color: "#0A0A0A" }}>
                    {b.ok ? "[x]" : "[ ]"}
                  </span>
                  <span>
                    {b.item} <span className="mono-sm">— {b.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
          <section className="rule mt-8 pt-3 overflow-x-auto">
            <div className="label mb-3">Every question, misses first</div>
            <table className="w-full border-collapse min-w-[980px]" style={{ fontSize: 13 }}>
              <thead>
                <tr style={{ background: "#F4F4F4" }}>
                  {["ID", "Question", "Expected", "Actual", "Form (expected → chosen)", "Route", "Latency", "Result"].map((h) => (
                    <th key={h} className="label text-left px-2 py-1.5" style={{ color: "#0A0A0A" }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="rule align-top">
                    <td className="px-2 py-2 font-mono" style={{ fontSize: 12 }}>
                      {r.id}
                    </td>
                    <td className="px-2 py-2 min-w-[220px]">{r.question}</td>
                    <td className="px-2 py-2 font-mono break-words max-w-[220px]" style={{ fontSize: 11 }}>
                      {r.expectedAnswer}
                    </td>
                    <td className="px-2 py-2 font-mono break-words max-w-[220px]" style={{ fontSize: 11 }}>
                      {r.actualAnswer}
                    </td>
                    <td className="px-2 py-2 font-mono" style={{ fontSize: 11 }}>
                      {r.expectedForm} → {r.chosenForm}
                    </td>
                    <td className="px-2 py-2 font-mono" style={{ fontSize: 11 }}>
                      {r.route}
                    </td>
                    <td className="px-2 py-2 font-mono text-right" style={{ fontSize: 11 }}>
                      {r.latencyMs} ms
                      <br />
                      <span className="text-muted">model {r.modelLatencyMs} ms</span>
                    </td>
                    <td className="px-2 py-2 font-mono" style={{ fontSize: 11, color: "#0A0A0A" }}>
                      {r.pass ? "pass" : `MISS: ${why(r)}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </>
      )}
    </div>
  );
}
