import { z } from "zod";
import { system2Model } from "../../../env";
import { geminiObject } from "../../system2/gemini";
import { choiceAnswer, normalize, scoreAnswer } from "../confidence";
import type { DecideAnswer, DecideRequest, LiveDecision } from "../types";

/**
 * Simulated Jev on free Gemini: the same request shape, probabilities from an
 * LLM, confidence computed with Jev's formulas. Its confidence is not calibrated.
 */

const SYSTEM = [
  "You simulate a calibrated System 1 decision model. You read a state and answer typed questions independently.",
  "For a choice question, assign a probability to every option; probabilities sum to 1.",
  "Put nearly all the mass on one option only when the state clearly supports it; spread it when the state is ambiguous.",
  "Choose none_of_these when no option fits; never force a fit.",
  "For a noul (yes/no) question, give the probability that the statement is true of the state.",
  "For a score question, give a probability for each level.",
  "Judge only from the state. Do not explain.",
].join("\n");

const prob = z.number().min(0).max(1);

export async function geminiDecide(req: DecideRequest): Promise<LiveDecision> {
  const shape: Record<string, z.ZodType> = {};
  const described: Record<string, unknown> = {};
  for (const [name, q] of Object.entries(req.questions)) {
    if (q.type === "choice") {
      shape[name] = z.object({ probabilities: z.object(Object.fromEntries(Object.keys(q.criteria).map((k) => [k, prob]))) });
      described[name] = { type: "choice", instructions: q.instructions, options: q.criteria };
    } else if (q.type === "score") {
      shape[name] = z.object({ probabilities: z.object(Object.fromEntries(q.criteria.map((_, i) => [`level_${i}`, prob]))) });
      described[name] = { type: "score", instructions: q.instructions, levels: Object.fromEntries(q.criteria.map((c, i) => [`level_${i}`, c])) };
    } else {
      shape[name] = z.object({ probability_true: prob });
      described[name] = { type: "noul", instructions: q.instructions, ...(q.criteria ? { criteria: q.criteria } : {}) };
    }
  }
  const model = system2Model("decide-sim");
  const prompt = `State:\n${JSON.stringify(req.state, null, 2)}\n\nQuestions:\n${JSON.stringify(described, null, 2)}`;
  const raw = (await geminiObject({ model, system: SYSTEM, prompt, schema: z.object(shape) })) as Record<string, { probabilities?: Record<string, number>; probability_true?: number }>;
  const answers: Record<string, DecideAnswer> = {};
  for (const [name, q] of Object.entries(req.questions)) {
    const r = raw[name] ?? {};
    if (q.type === "choice") answers[name] = choiceAnswer(normalize(r.probabilities ?? {}));
    else if (q.type === "score") {
      const p = Object.fromEntries(q.criteria.map((_, i) => [String(i), r.probabilities?.[`level_${i}`] ?? 0]));
      answers[name] = scoreAnswer(p, Object.fromEntries(q.criteria.map((c, i) => [String(i), c])));
    } else answers[name] = { type: "noul", noul: Math.min(1, Math.max(0, r.probability_true ?? 0.5)) };
  }
  return { answers, model: `${model} (simulated Jev)`, source: "gemini-sim", inputTokens: null };
}
