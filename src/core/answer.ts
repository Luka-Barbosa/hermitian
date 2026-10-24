import type { QueryPlan } from "./plan/schema";
import type { QueryResult } from "./results";
import type { TraceEvent } from "./trace";
import type { Form } from "./types";

/** The UI spec for one turn. Charts and tables bind to `results` by id, never to text. */
export interface Answer {
  turn: number;
  question: string;
  topic: string;
  headline: string;
  sentences: string[];
  cutClaims: { text: string; reasons: string[] }[];
  form: Form;
  validForms: Form[];
  primaryResultId: string | null;
  results: QueryResult[];
  source: string;
  route: "system1" | "escalated";
  intentConfidence: number | null;
  formConfidence: number | null;
  plan: QueryPlan | null;
  trace: TraceEvent[];
  followUp: FollowUpPayload;
  backends: { decide: string; system2: string };
  latencyMs: number;
  /** Model time: live latency, or the recorded latency of replayed calls. */
  modelLatencyMs: number;
  outOfScope: boolean;
  error: { kind: "fixture_miss" | "error"; message: string; hash?: string } | null;
  dataNote: string;
}

/** What the Follow-up button carries into the next turn: the last prompt and its output, no data rows. */
export interface FollowUpPayload {
  question: string;
  answer: string;
  plan: QueryPlan | null;
}
