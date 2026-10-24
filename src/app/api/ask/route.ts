import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { createStitchAdapter } from "@/adapters/stitch";
import { ask } from "@/core/pipeline";
import { QueryPlanSchema } from "@/core/plan/schema";
import { resolvedDuckdbPath } from "@/env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  question: z.string().trim().min(1).max(500),
  turn: z.number().int().positive().optional(),
  followUp: z
    .object({ question: z.string().max(500), answer: z.string().max(2000), plan: QueryPlanSchema.nullable() })
    .optional(),
});

let adapter: ReturnType<typeof createStitchAdapter> | undefined;

interface EvalRowLite {
  id: string;
  question: string;
  pass: boolean;
  intentOk: boolean;
  formOk: boolean;
  numbersOk: boolean;
  grounded: boolean;
}

/** Misses are shown in the app: attach this question's last eval result, if it is an eval question. */
function evalStatus(question: string) {
  const file = path.join(process.cwd(), "evals", "results", "latest.json");
  if (!fs.existsSync(file)) return null;
  try {
    const latest = JSON.parse(fs.readFileSync(file, "utf8")) as { ranAt: string; rows: EvalRowLite[] };
    const row = latest.rows.find((r) => r.question.trim().toLowerCase() === question.trim().toLowerCase());
    if (!row) return null;
    const reasons = [!row.intentOk && "intent", !row.formOk && "form", !row.numbersOk && "numbers", !row.grounded && "grounding"].filter(Boolean) as string[];
    return { id: row.id, pass: row.pass, reasons, ranAt: latest.ranAt };
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { question } (1-500 characters)." }, { status: 400 });
  adapter ??= createStitchAdapter(resolvedDuckdbPath());
  const input = parsed.data;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(o)}\n`));
      try {
        const answer = await ask(
          { question: input.question, turn: input.turn, ...(input.followUp ? { followUp: input.followUp } : {}) },
          { adapter: adapter!, onEvent: send },
        );
        send({ type: "answer", answer, evalStatus: evalStatus(answer.question) });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}
