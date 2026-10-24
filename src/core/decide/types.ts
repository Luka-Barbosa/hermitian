import type { JsonValue } from "../types";

/**
 * decide(state, questions) mirrors Jev's systemOne API: a state and typed
 * questions in, typed answers with probabilities and confidence out.
 */

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option name -> description. Always includes `none_of_these`. */
  criteria: Record<string, string | null>;
}

export interface ScoreQuestion {
  type: "score";
  instructions: string;
  /** Ordered level descriptions, index 0 upwards. */
  criteria: string[];
}

export interface NoulQuestion {
  type: "noul";
  instructions: string;
  criteria?: { true?: string; false?: string };
}

export type DecideQuestion = ChoiceQuestion | ScoreQuestion | NoulQuestion;
export type DecideQuestions = Record<string, DecideQuestion>;

export interface ChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface ScoreAnswer {
  type: "score";
  score: number;
  confidence: number;
  probabilities: Record<string, number>;
  legend: Record<string, string>;
}

export interface NoulAnswer {
  type: "noul";
  noul: number;
}

export type DecideAnswer = ChoiceAnswer | ScoreAnswer | NoulAnswer;

export type AnswerFor<Q extends DecideQuestion> = Q extends ChoiceQuestion ? ChoiceAnswer : Q extends ScoreQuestion ? ScoreAnswer : NoulAnswer;
export type Answers<Q extends DecideQuestions> = { [K in keyof Q]: AnswerFor<Q[K]> };

export type DecideBackendName = "replay" | "record" | "jev" | "gemini";
/** Who actually produced the answers. */
export type DecideSource = "jev" | "gemini-sim";

export interface DecideMeta {
  backend: DecideBackendName;
  source: DecideSource;
  model: string;
  hash: string;
  tag: string;
  latencyMs: number;
  /** Latency of the original live call, for replayed answers. */
  recordedLatencyMs: number | null;
  inputTokens: number | null;
}

export interface DecideResult<Q extends DecideQuestions> {
  answers: Answers<Q>;
  meta: DecideMeta;
}

export interface DecideRequest {
  state: JsonValue;
  questions: DecideQuestions;
}

/** What a live backend returns before it is stored or replayed. */
export interface LiveDecision {
  answers: Record<string, DecideAnswer>;
  model: string;
  source: DecideSource;
  inputTokens: number | null;
}

export interface DecideFixture {
  hash: string;
  tag: string;
  source: DecideSource;
  model: string;
  recordedAt: string;
  latencyMs: number;
  inputTokens: number | null;
  request: DecideRequest;
  answers: Record<string, DecideAnswer>;
}
