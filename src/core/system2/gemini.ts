import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { generateText, Output } from "ai";
import type { z } from "zod";
import { env, liveCallsForbidden } from "../../env";

/**
 * The one place a live Gemini call happens (free tier, BYOK). Calls are spaced
 * out to stay under free-tier rate limits and retried on transient errors.
 */

let provider: ReturnType<typeof createGoogleGenerativeAI> | undefined;
let lastCallAt = 0;
let liveCalls = 0;

export function liveGeminiCallsMade(): number {
  return liveCalls;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function geminiObject<T>(opts: { model: string; system: string; prompt: string; schema: z.ZodType<T> }): Promise<T> {
  if (liveCallsForbidden()) throw new Error("Live Gemini calls are disabled here (tests run on replay only).");
  const e = env();
  if (!e.GOOGLE_GENERATIVE_AI_API_KEY) throw new Error("GOOGLE_GENERATIVE_AI_API_KEY is not set; System 2 needs a Gemini key.");
  provider ??= createGoogleGenerativeAI({ apiKey: e.GOOGLE_GENERATIVE_AI_API_KEY });
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastCallAt + e.GEMINI_MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt = Date.now();
    liveCalls++;
    try {
      const result = await generateText({
        model: provider(opts.model),
        system: opts.system,
        prompt: opts.prompt,
        output: Output.object({ schema: opts.schema }),
        temperature: 0,
        maxRetries: 0,
      });
      return result.output as T;
    } catch (err) {
      lastError = err;
      const text = String((err as Error)?.message ?? err);
      const transient = /429|quota|rate|overloaded|503|500|unavailable|timeout|ECONNRESET|No object generated|parse/i.test(text);
      if (!transient) break;
      await sleep(Math.min(60_000, 5_000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
