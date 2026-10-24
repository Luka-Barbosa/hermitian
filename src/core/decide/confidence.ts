import type { ChoiceAnswer, ScoreAnswer } from "./types";

/** Confidence formulas from Jev's docs, so simulated answers carry comparable fields. */

export function normalize(p: Record<string, number>): Record<string, number> {
  const entries = Object.entries(p).map(([k, v]) => [k, Number.isFinite(v) && v > 0 ? v : 0] as const);
  const total = entries.reduce((a, [, v]) => a + v, 0);
  if (total === 0) return Object.fromEntries(entries.map(([k]) => [k, 1 / entries.length]));
  return Object.fromEntries(entries.map(([k, v]) => [k, v / total]));
}

/** (p_max - 1/n) / (1 - 1/n): 1 when all mass is on one option, 0 for an even split. */
export function choiceConfidence(p: Record<string, number>): number {
  const values = Object.values(p);
  const n = values.length;
  if (n <= 1) return 1;
  const max = Math.max(...values);
  return Math.max(0, (max - 1 / n) / (1 - 1 / n));
}

export function choiceAnswer(probabilities: Record<string, number>): ChoiceAnswer {
  const p = normalize(probabilities);
  const [choice] = Object.entries(p).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]!;
  return { type: "choice", choice, confidence: choiceConfidence(p), probabilities: p };
}

/** max(0, 1 - sum p_i |i - m| / MAD_unif), m the most likely level. */
export function scoreAnswer(probabilities: Record<string, number>, legend: Record<string, string>): ScoreAnswer {
  const p = normalize(probabilities);
  const levels = Object.keys(p).map(Number).sort((a, b) => a - b);
  const n = levels.length;
  const score = levels.reduce((a, i) => a + i * p[String(i)]!, 0);
  const m = levels.reduce((best, i) => (p[String(i)]! > p[String(best)]! ? i : best), levels[0]!);
  const madUnif = levels.reduce((a, i) => a + Math.abs(i - (n - 1) / 2), 0) / n;
  const spread = levels.reduce((a, i) => a + p[String(i)]! * Math.abs(i - m), 0);
  const confidence = madUnif === 0 ? 1 : Math.max(0, 1 - spread / madUnif);
  return { type: "score", score, confidence, probabilities: p, legend };
}

/** Jev returns no confidence for Noul; the docs suggest |2p - 1|. */
export function noulConfidence(p: number): number {
  return Math.abs(2 * p - 1);
}
