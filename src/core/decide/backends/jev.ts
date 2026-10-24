import { TypeSafeClient } from "@typesafe-ai/sdk";
import { env, liveCallsForbidden } from "../../../env";
import type { DecideAnswer, DecideRequest, LiveDecision } from "../types";

/** Jev via the Vercel AI Gateway, through the TypeSafe SDK. Every call is counted against MAX_LIVE_JEV_CALLS. */

let client: TypeSafeClient | undefined;
let liveCalls = 0;

export function liveJevCallsMade(): number {
  return liveCalls;
}

export async function jevDecide(req: DecideRequest): Promise<LiveDecision> {
  if (liveCallsForbidden()) throw new Error("Live Jev calls are disabled here (tests run on replay only).");
  const e = env();
  if (!e.AI_GATEWAY_API_KEY) throw new Error("AI_GATEWAY_API_KEY is not set; Jev needs the Vercel AI Gateway key.");
  if (liveCalls >= e.MAX_LIVE_JEV_CALLS) throw new Error(`MAX_LIVE_JEV_CALLS (${e.MAX_LIVE_JEV_CALLS}) reached; refusing another live Jev call.`);
  liveCalls++;
  client ??= new TypeSafeClient({
    apiKey: e.AI_GATEWAY_API_KEY,
    baseURL: e.TYPESAFE_BASE_URL,
    defaultModel: e.JEV_MODEL,
    timeout: 30_000,
    logLevel: "off",
  });
  const res = await client.systemOne({
    state: req.state as never,
    questions: req.questions as never,
  });
  const answers: Record<string, DecideAnswer> = {};
  for (const [name, a] of Object.entries(res.answers as Record<string, DecideAnswer & { type: string }>)) {
    if (a.type === "choice") answers[name] = { type: "choice", choice: a.choice, confidence: a.confidence, probabilities: { ...a.probabilities } };
    else if (a.type === "score") answers[name] = { type: "score", score: a.score, confidence: a.confidence, probabilities: { ...a.probabilities }, legend: { ...a.legend } };
    else if (a.type === "noul") answers[name] = { type: "noul", noul: a.noul };
  }
  return { answers, model: res.model, source: "jev", inputTokens: res.usage?.input_tokens ?? null };
}
