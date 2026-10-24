import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

/**
 * The only place config is read. Next.js loads .env.local itself; scripts run
 * with tsx, so we load it here. Existing process env always wins, which is how
 * tests force the replay backends. Values are never printed.
 */
function loadEnvFiles(): void {
  if (process.env.NEXT_RUNTIME) return;
  for (const name of [".env.local", ".env"]) {
    const file = path.join(/*turbopackIgnore: true*/ process.cwd(), name);
    if (fs.existsSync(file)) process.loadEnvFile(file);
  }
}

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());

export const DECIDE_BACKENDS = ["replay", "record", "jev", "gemini"] as const;
export const SYSTEM2_BACKENDS = ["replay", "record", "live"] as const;

const schema = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  SYSTEM2_MODEL: z.preprocess(blankToUndefined, z.string().trim().default("gemini-3.5-flash")),
  SYSTEM2_MODEL_PARSE: optionalString,
  SYSTEM2_MODEL_NARRATIVE: optionalString,
  SYSTEM2_BACKEND: z.preprocess(blankToUndefined, z.enum(SYSTEM2_BACKENDS).default("replay")),
  /** Minimum spacing between live Gemini calls (free-tier rate limits). */
  GEMINI_MIN_INTERVAL_MS: z.preprocess(blankToUndefined, z.coerce.number().int().nonnegative().default(4000)),

  /** Direct TypeSafe route. When set it wins over the gateway settings below. */
  TYPESAFE_API_KEY: optionalString,
  AI_GATEWAY_API_KEY: optionalString,
  TYPESAFE_BASE_URL: z.preprocess(blankToUndefined, z.url().default("https://ai-gateway.vercel.sh/typesafe")),
  JEV_MODEL: z.preprocess(blankToUndefined, z.string().trim().default("typesafe-ai/jev")),

  DECIDE_BACKEND: z.preprocess(blankToUndefined, z.enum(DECIDE_BACKENDS).default("replay")),
  /** Which live backend `record` mode calls through. */
  RECORD_VIA: z.preprocess(blankToUndefined, z.enum(["jev", "gemini"]).default("jev")),
  DECIDE_SIM_MODEL: optionalString,
  MAX_LIVE_JEV_CALLS: z.preprocess(blankToUndefined, z.coerce.number().int().nonnegative().default(200)),

  DUCKDB_PATH: z.preprocess(blankToUndefined, z.string().default("./data/hermitian.duckdb")),
  DATA_SEED: z.preprocess(blankToUndefined, z.coerce.number().int().default(42)),

  HERMITIAN_NO_LIVE: optionalString,
  /** Logs each live model attempt (model, outcome, time) to stderr. */
  HERMITIAN_DEBUG: optionalString,
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

export function env(): Env {
  if (cached) return cached;
  loadEnvFiles();
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    // Report variable names and problems only, never values.
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Test hook: forget the cached config so a test can change process.env. */
export function resetEnvCache(): void {
  cached = undefined;
}

/** True when live model calls are forbidden (tests). */
export function liveCallsForbidden(): boolean {
  return Boolean(env().HERMITIAN_NO_LIVE) || Boolean(process.env.VITEST);
}

/** Models for a task, in order of preference. A value may list several, comma-separated. */
export function system2Models(task: "parse" | "narrative" | "decide-sim"): string[] {
  const e = env();
  const v = task === "parse" ? (e.SYSTEM2_MODEL_PARSE ?? e.SYSTEM2_MODEL) : task === "narrative" ? (e.SYSTEM2_MODEL_NARRATIVE ?? e.SYSTEM2_MODEL) : (e.DECIDE_SIM_MODEL ?? e.SYSTEM2_MODEL);
  return v.split(",").map((m) => m.trim()).filter(Boolean);
}

export function resolvedDuckdbPath(): string {
  return path.resolve(/*turbopackIgnore: true*/ process.cwd(), env().DUCKDB_PATH);
}
