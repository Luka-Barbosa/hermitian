import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import type { z } from "zod";
import { env, liveCallsForbidden } from "../../env";

/**
 * The one place a live Gemini call happens (free tier, BYOK). Calls are spaced
 * out to stay under free-tier rate limits and retried on transient errors.
 * A task may name several models (comma-separated): when one model's daily
 * free quota runs out, the call moves to the next.
 */

let provider: ReturnType<typeof createGoogleGenerativeAI> | undefined;
let lastCallAt = 0;
let liveCalls = 0;
const exhausted = new Set<string>();

export function liveGeminiCallsMade(): number {
  return liveCalls;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const isDailyQuota = (text: string) => /per day|PerDay|requests_per_day|limit: \d+, model/i.test(text) && /quota/i.test(text);
const isTransient = (text: string) =>
  /429|quota|rate|overloaded|high demand|503|500|unavailable|timeout|ECONNRESET|No object generated|parse/i.test(text);

export async function geminiObject<T>(opts: { models: string[]; system: string; prompt: string; schema: z.ZodType<T> }): Promise<{ output: T; model: string }> {
  if (liveCallsForbidden()) throw new Error("Live Gemini calls are disabled here (tests run on replay only).");
  const e = env();
  if (!e.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set; System 2 needs a Gemini key.");
  provider ??= createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY });
  let lastError: unknown;
  for (const model of opts.models) {
    if (exhausted.has(model)) continue;
    let timeouts = 0;
    for (let attempt = 0; attempt < 4; attempt++) {
      const wait = lastCallAt + e.GEMINI_MIN_INTERVAL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastCallAt = Date.now();
      liveCalls++;
      const t0 = Date.now();
      const debug = (msg: string) => e.HERMITIAN_DEBUG && console.error(`  [gemini] ${model} #${attempt + 1} ${msg} (${Date.now() - t0} ms)`);
      try {
        const result = await generateText({
          model: provider(model),
          system: opts.system,
          prompt: opts.prompt,
          output: Output.object({ schema: opts.schema }),
          temperature: 0,
          maxRetries: 0,
          abortSignal: AbortSignal.timeout(90_000),
        });
        debug("ok");
        return { output: result.output as T, model };
      } catch (err) {
        lastError = err;
        const text = String((err as Error)?.message ?? err);
        debug(`failed: ${text.slice(0, 100).replace(/\s+/g, " ")}`);
        if (isDailyQuota(text)) {
          exhausted.add(model);
          break;
        }
        if (!isTransient(text)) throw err;
        // A model that keeps timing out is overloaded; try the next one.
        if (/timeout|aborted/i.test(text) && ++timeouts >= 2) break;
        await sleep(Math.min(60_000, 5_000 * 2 ** attempt));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError ?? "No Gemini model available"));
}
