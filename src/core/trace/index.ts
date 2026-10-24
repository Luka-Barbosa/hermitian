/** Trace events for the sidebar: every decision, confidence, escalation, query and gate. */

export type TraceKind = "system1" | "escalation" | "system2" | "plan" | "gate" | "query" | "visual" | "error";

export interface SlotTrace {
  slot: string;
  choice: string;
  confidence: number | null;
  route: "system1" | "escalated" | "pattern" | "default" | "inherited" | "ignored";
  final: string;
  top: { option: string; p: number }[];
}

export interface TraceEvent {
  id: number;
  kind: TraceKind;
  title: string;
  ok: boolean;
  latencyMs: number;
  /** Ordered key/value lines. */
  detail: [string, string][];
  slots?: SlotTrace[];
  sql?: string[];
}

export type PipelineEvent =
  | { type: "status"; text: string }
  | { type: "trace"; event: TraceEvent };

export class Trace {
  readonly events: TraceEvent[] = [];
  private next = 1;

  constructor(private readonly emit?: (e: PipelineEvent) => void) {}

  add(e: Omit<TraceEvent, "id">): TraceEvent {
    const event = { ...e, id: this.next++ };
    this.events.push(event);
    this.emit?.({ type: "trace", event });
    return event;
  }

  status(text: string): void {
    this.emit?.({ type: "status", text });
  }
}

export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const t = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - t) };
}
