import { APIError, TypeSafeClient } from "@typesafe-ai/sdk";
import { env, liveCallsForbidden } from "../../../env";
import type { DecideAnswer, DecideRequest, LiveDecision } from "../types";

/**
 * Jev through the TypeSafe SDK, by one of two routes. Every call is counted
 * against MAX_LIVE_JEV_CALLS, whichever route is used.
 *
 * - direct: TYPESAFE_API_KEY is set. The SDK's own defaults apply: base URL
 *   https://api.typesafe.ai and model jev-latest (see @typesafe-ai/sdk types).
 * - gateway: otherwise, the Vercel AI Gateway via AI_GATEWAY_API_KEY,
 *   TYPESAFE_BASE_URL and JEV_MODEL.
 */

/** From @typesafe-ai/sdk (TypeSafeClientConfig): the documented defaults for the direct API. */
export const DIRECT_BASE_URL = "https://api.typesafe.ai";
export const DIRECT_MODEL = "jev-latest";

export interface JevRoute {
  kind: "direct" | "gateway";
  apiKey: string;
  baseURL: string;
  model: string;
}

/** The configured route, or why none is usable. */
export function jevRoute(): { route: JevRoute } | { error: string } {
  const e = env();
  if (e.TYPESAFE_API_KEY) return { route: { kind: "direct", apiKey: e.TYPESAFE_API_KEY, baseURL: DIRECT_BASE_URL, model: DIRECT_MODEL } };
  if (e.AI_GATEWAY_API_KEY) return { route: { kind: "gateway", apiKey: e.AI_GATEWAY_API_KEY, baseURL: e.TYPESAFE_BASE_URL, model: e.JEV_MODEL } };
  return { error: "No Jev route configured: set TYPESAFE_API_KEY (direct) or AI_GATEWAY_API_KEY (Vercel AI Gateway)." };
}

export function describeRoute(r: JevRoute): string {
  return r.kind === "direct" ? `direct TypeSafe (${r.baseURL}, ${r.model})` : `Vercel AI Gateway (${r.baseURL}, ${r.model})`;
}

/** A 403 saying the account is on the free tier: Jev is not available to it yet. */
export function isFreeTierBlock(err: unknown): boolean {
  return err instanceof APIError && err.status === 403 && /free tier/i.test(err.message);
}

const clients = new Map<string, TypeSafeClient>();
let liveCalls = 0;

export function liveJevCallsMade(): number {
  return liveCalls;
}

export async function jevDecide(req: DecideRequest): Promise<LiveDecision> {
  if (liveCallsForbidden()) throw new Error("Live Jev calls are disabled here (tests run on replay only).");
  const e = env();
  const resolved = jevRoute();
  if ("error" in resolved) throw new Error(resolved.error);
  const { route } = resolved;
  if (liveCalls >= e.MAX_LIVE_JEV_CALLS) throw new Error(`MAX_LIVE_JEV_CALLS (${e.MAX_LIVE_JEV_CALLS}) reached; refusing another live Jev call.`);
  liveCalls++;
  const id = `${route.kind}|${route.baseURL}|${route.model}`;
  let client = clients.get(id);
  if (!client) {
    client = new TypeSafeClient({ apiKey: route.apiKey, baseURL: route.baseURL, defaultModel: route.model, timeout: 30_000, logLevel: "off" });
    clients.set(id, client);
  }
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
