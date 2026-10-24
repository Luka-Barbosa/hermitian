import { env } from "../../env";
import { FixtureMissError, readFixture, requestHash, writeFixture } from "../fixtures";
import type { JsonValue } from "../types";
import { NONE_OF_THESE } from "../types";
import { geminiDecide } from "./backends/gemini";
import { jevDecide } from "./backends/jev";
import type { Answers, DecideBackendName, DecideFixture, DecideQuestions, DecideRequest, DecideResult, LiveDecision } from "./types";

export * from "./types";

/**
 * All System 1 calls go through here. The default backend is replay: answers
 * come from fixtures/decide/<hash>.json, and a miss throws with the hash. It
 * never falls through to a live call.
 */
export async function decide<Q extends DecideQuestions>(
  state: JsonValue,
  questions: Q,
  opts: { tag: string; backend?: DecideBackendName },
): Promise<DecideResult<Q>> {
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === "choice" && !(NONE_OF_THESE in q.criteria)) {
      throw new Error(`Choice question "${name}" has no ${NONE_OF_THESE} option`);
    }
  }
  const request: DecideRequest = { state, questions };
  const hash = requestHash(request);
  const backend = opts.backend ?? env().DECIDE_BACKEND;
  const started = performance.now();

  const fromFixture = (f: DecideFixture): DecideResult<Q> => ({
    answers: f.answers as Answers<Q>,
    meta: {
      backend, source: f.source, model: f.model, hash, tag: opts.tag,
      latencyMs: Math.round(performance.now() - started), recordedLatencyMs: f.latencyMs, inputTokens: f.inputTokens,
    },
  });

  const via = backend === "record" ? env().RECORD_VIA : backend;
  const liveSource = via === "jev" ? "jev" : "gemini-sim";
  if (backend === "replay" || backend === "record") {
    const fixture = readFixture<DecideFixture>("decide", hash);
    // With --refresh, a fixture from another source (e.g. simulated Jev) is re-recorded by the live model.
    const stale = backend === "record" && Boolean(env().RECORD_REFRESH) && fixture !== undefined && fixture.source !== liveSource;
    if (fixture && !stale) return fromFixture(fixture);
    if (backend === "replay") throw new FixtureMissError("decide", hash, opts.tag);
  }

  const live: LiveDecision = via === "jev" ? await jevDecide(request) : await geminiDecide(request);
  const latencyMs = Math.round(performance.now() - started);
  if (backend === "record") {
    const fixture: DecideFixture = {
      hash, tag: opts.tag, source: live.source, model: live.model, recordedAt: new Date().toISOString(),
      latencyMs, inputTokens: live.inputTokens, request, answers: live.answers,
    };
    writeFixture("decide", hash, fixture);
  }
  return {
    answers: live.answers as Answers<Q>,
    meta: { backend, source: live.source, model: live.model, hash, tag: opts.tag, latencyMs, recordedLatencyMs: null, inputTokens: live.inputTokens },
  };
}
