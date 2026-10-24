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
    const file = path.join(process.cwd(), name);
    if (fs.existsSync(file)) process.loadEnvFile(file);
  }
}

const blankToUndefined = (v: unknown) => (typeof v === "string" && v.trim() === "" ? undefined : v);
const optionalString = z.preprocess(blankToUndefined, z.string().trim().optional());

export const DECIDE_BACKENDS = ["replay", "record", "jev", "gemini"] as const;
export const SYSTEM2_BACKENDS = ["replay", "record", "live"] as const;

const schema = z.object({
  GOOGLE_GENERATIVE_AI_API_KEY: optionalString,
  SYSTEM2_MODEL: z.preprocess(blankToUndefined, z.string().trim().default("gemini-2.5-flash")),
  SYSTEM2_MODEL_PARSE: optionalString,
  SYSTEM2_MODEL_NARRATIVE: optionalString,
  SYSTEM2_BACKEND: z.preprocess(blankToUndefined, z.enum(SYSTEM2_BACKENDS).default("replay")),

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

export function system2Model(task: "parse" | "narrative" | "decide-sim"): string {
  const e = env();
  if (task === "parse") return e.SYSTEM2_MODEL_PARSE ?? e.SYSTEM2_MODEL;
  if (task === "narrative") return e.SYSTEM2_MODEL_NARRATIVE ?? e.SYSTEM2_MODEL;
  return e.DECIDE_SIM_MODEL ?? e.SYSTEM2_MODEL;
}

export function resolvedDuckdbPath(): string {
  return path.resolve(process.cwd(), env().DUCKDB_PATH);
}
