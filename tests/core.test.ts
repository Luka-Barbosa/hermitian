import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { choiceAnswer, choiceConfidence, scoreAnswer } from "../src/core/decide/confidence";
import { decide } from "../src/core/decide";
import { FixtureMissError, requestHash } from "../src/core/fixtures";
import { allowedFrom, checkClaim, extract } from "../src/core/gates/grounding";
import { previousPeriod, rangeLabel, resolvePreset } from "../src/core/periods";
import type { QueryResult } from "../src/core/results";
import { defaultForm, validForms } from "../src/core/visuals/filter";
import { understandingQuestions } from "../src/core/understand";
import { stitchCatalog } from "../src/adapters/stitch/catalog";
import { NONE_OF_THESE } from "../src/core/types";

describe("period presets resolve against the dataset's as-of date", () => {
  const asOf = "2026-09-30";
  it("matches the generator's independently written windows", () => {
    const key = JSON.parse(fs.readFileSync(path.join("data", "scenarios.json"), "utf8"));
    for (const [preset, w] of Object.entries<{ start: string; end: string }>(key.presetWindows)) {
      const p = resolvePreset(preset as never, asOf);
      expect([preset, p.start, p.end]).toEqual([preset, w.start, w.end]);
    }
  });
  it("compares a complete month with the previous complete month", () => {
    const mtd = resolvePreset("month_to_date", asOf);
    expect(previousPeriod(mtd)).toMatchObject({ start: "2026-08-01", end: "2026-08-31" });
  });
  it("compares a partial month with the same days of the previous month", () => {
    const p = previousPeriod({ preset: "custom", start: "2026-09-01", end: "2026-09-15", label: "" });
    expect(p).toMatchObject({ start: "2026-08-01", end: "2026-08-15" });
  });
  it("compares rolling windows with the window before", () => {
    expect(previousPeriod(resolvePreset("last_7_days", asOf))).toMatchObject({ start: "2026-09-17", end: "2026-09-23" });
  });
  it("labels ranges readably", () => {
    expect(rangeLabel("2026-09-01", "2026-09-30")).toBe("September 2026");
    expect(rangeLabel("2026-09-24", "2026-09-30")).toBe("24–30 Sep 2026");
    expect(rangeLabel("2026-04-01", "2026-09-30")).toBe("Apr–Sep 2026");
    expect(rangeLabel("2026-09-26", "2026-09-26")).toBe("26 Sep 2026");
  });
});

describe("confidence follows Jev's formulas", () => {
  it("choice confidence is 0 for an even split and 1 for certainty", () => {
    expect(choiceConfidence({ a: 0.5, b: 0.5 })).toBe(0);
    expect(choiceConfidence({ a: 1, b: 0 })).toBe(1);
    expect(choiceConfidence({ a: 0.8, b: 0.15, c: 0.05 })).toBeCloseTo(0.7, 10);
  });
  it("picks the most probable option", () => {
    expect(choiceAnswer({ a: 0.2, b: 0.7, c: 0.1 }).choice).toBe("b");
  });
  it("score is the probability-weighted mean level", () => {
    const s = scoreAnswer({ "0": 0.1, "1": 0.1, "2": 0.8 }, { "0": "a", "1": "b", "2": "c" });
    expect(s.score).toBeCloseTo(1.7, 10);
  });
});

describe("decide()", () => {
  it("hashes requests deterministically regardless of key order", () => {
    expect(requestHash({ a: 1, b: { c: 2, d: 3 } })).toBe(requestHash({ b: { d: 3, c: 2 }, a: 1 }));
  });
  it("replay fails loudly with the request hash on a miss", async () => {
    const q = { x: { type: "choice" as const, instructions: "unrecorded", criteria: { a: null, [NONE_OF_THESE]: null } } };
    await expect(decide({ question: "never recorded" }, q, { tag: "test" })).rejects.toBeInstanceOf(FixtureMissError);
    await expect(decide({ question: "never recorded" }, q, { tag: "test" })).rejects.toThrow(/hash [0-9a-f]{24}/);
  });
  it("refuses a Choice without a none-of-these option", async () => {
    const q = { x: { type: "choice" as const, instructions: "bad", criteria: { a: null, b: null } } };
    await expect(decide({ question: "q" }, q, { tag: "test" })).rejects.toThrow(/none_of_these/);
  });
  it("never goes live in tests, even if asked", async () => {
    const q = { x: { type: "noul" as const, instructions: "anything" } };
    await expect(decide({ question: "q" }, q, { tag: "test", backend: "jev" })).rejects.toThrow(/disabled/);
    await expect(decide({ question: "q" }, q, { tag: "test", backend: "gemini" })).rejects.toThrow(/disabled/);
  });
  it("every System 1 Choice includes none_of_these, and the state holds no data rows", () => {
    const qs = understandingQuestions(stitchCatalog, "Which issuer has the lowest approval rate in Kloofmere Rosebank?");
    for (const q of Object.values(qs)) if (q.type === "choice") expect(Object.keys(q.criteria)).toContain(NONE_OF_THESE);
    expect(Object.keys(qs)).toContain("filter_store");
  });
});

const scalar = (value: number, unit: "zar" | "ratio" | "count"): QueryResult => ({
  id: "q1", terms: null, op: "aggregate", metricId: "m", metricLabel: "M", unit, views: ["v"], sql: [], rowCount: 1, latencyMs: 0, notes: [],
  data: { shape: "scalar", value, numerator: null, denominator: null, period: { preset: "custom", start: "2026-09-26", end: "2026-09-26", label: "26 Sep 2026" } },
});

describe("gate 3: narrative grounding", () => {
  it("extracts rand, percentages, points, plain numbers, dates and times", () => {
    const x = extract("Captured R42.4m (up 6.7%), approval fell 2.2 pp to 455 attempts on 26 September at 13:00.");
    expect(x.numbers.map((n) => n.kind)).toEqual(["zar", "pp", "pct", "plain"]);
    expect(x.dates).toEqual([{ month: 9, day: 26, raw: "26 September" }]);
    expect(x.times).toEqual(["13:00"]);
  });
  it("accepts numbers that round from a result", () => {
    const allowed = allowedFrom([scalar(42353655.56, "zar")]);
    expect(checkClaim("Captured value was R42.4m", allowed).ok).toBe(true);
    expect(checkClaim("Captured value was R42m", allowed).ok).toBe(true);
    expect(checkClaim("Captured value was R42,353,655.56", allowed).ok).toBe(true);
  });
  it("cuts numbers that do not match any result", () => {
    const allowed = allowedFrom([scalar(42353655.56, "zar")]);
    expect(checkClaim("Captured value was R40m", allowed).ok).toBe(false);
    expect(checkClaim("That is 3x the usual", allowed).ok).toBe(false);
    expect(checkClaim("Captured value was R42.4m on 27 September", allowed).ok).toBe(false);
  });
  it("does not read words ending in r as rand amounts, and accepts day ranges", () => {
    const allowed = allowedFrom([{ ...scalar(0.91, "ratio"), data: { shape: "scalar", value: 0.91, numerator: null, denominator: null, period: { preset: "custom", start: "2026-09-24", end: "2026-09-30", label: "" } } }]);
    expect(extract("approval for 24 hours").numbers.map((n) => n.kind)).toEqual(["plain"]);
    expect(checkClaim("Approval was 91% for 24–30 Sep 2026", allowed).ok).toBe(true);
    expect(checkClaim("Approval was 91% for 23–30 Sep 2026", allowed).ok).toBe(false);
  });
  it("matches ratios as percentages", () => {
    const allowed = allowedFrom([scalar(0.4560, "ratio")]);
    expect(checkClaim("Approval was 45.6%", allowed).ok).toBe(true);
    expect(checkClaim("Approval was 46%", allowed).ok).toBe(true);
    expect(checkClaim("Approval was 47%", allowed).ok).toBe(false);
  });
});

describe("gate 4: visual suitability", () => {
  it("offers only forms that fit the result's shape", () => {
    expect(validForms(scalar(1, "zar"))).toEqual(["text", "kpi"]);
    expect(validForms(null)).toEqual(["text"]);
  });
  it("falls back to the intent's preferred valid form", () => {
    expect(defaultForm("lookup", ["text", "kpi"])).toBe("text");
    expect(defaultForm("compare", ["kpi", "text"])).toBe("kpi");
  });
});

describe("boundaries", () => {
  const files = (dir: string): string[] =>
    fs.existsSync(dir)
      ? fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]))
      : [];

  it("src/core never imports from src/adapters", () => {
    for (const f of files(path.join("src", "core"))) {
      const src = fs.readFileSync(f, "utf8");
      expect(src, f).not.toMatch(/from\s+["'][^"']*adapters/);
    }
  });
  it("only the generator opens DuckDB for writing", () => {
    const all = [...files("src"), ...files("scripts"), ...files("evals")].filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    const creators = all.filter((f) => /DuckDBInstance\.create\(/.test(fs.readFileSync(f, "utf8")));
    for (const f of creators) {
      const src = fs.readFileSync(f, "utf8");
      if (f.endsWith(path.join("scripts", "generate.ts"))) continue;
      expect(src, f).toMatch(/access_mode:\s*"READ_ONLY"/);
    }
  });
  it("no file reads .env or .env.local directly", () => {
    const all = [...files("src"), ...files("scripts"), ...files("evals")].filter((f) => !f.endsWith(path.join("src", "env.ts")));
    for (const f of all) expect(fs.readFileSync(f, "utf8"), f).not.toMatch(/\.env\.local|loadEnvFile/);
  });
});

describe("Jev routes (no network)", () => {
  const keys = ["TYPESAFE_API_KEY", "AI_GATEWAY_API_KEY", "TYPESAFE_BASE_URL", "JEV_MODEL"] as const;
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));

  async function route(vars: Partial<Record<(typeof keys)[number], string>>) {
    const { resetEnvCache } = await import("../src/env");
    const { jevRoute } = await import("../src/core/decide/backends/jev");
    try {
      // Blank, not deleted: env.ts only loads .env.local for variables that are not already set.
      for (const k of keys) process.env[k] = "";
      Object.assign(process.env, vars);
      resetEnvCache();
      return jevRoute();
    } finally {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
      resetEnvCache();
    }
  }

  it("uses the direct API with the SDK defaults when TYPESAFE_API_KEY is set", async () => {
    const r = await route({ TYPESAFE_API_KEY: "test-direct", AI_GATEWAY_API_KEY: "test-gateway" });
    expect(r).toEqual({ route: { kind: "direct", apiKey: "test-direct", baseURL: "https://api.typesafe.ai", model: "jev-latest" } });
  });
  it("falls back to the gateway settings otherwise", async () => {
    const r = await route({ AI_GATEWAY_API_KEY: "test-gateway", TYPESAFE_BASE_URL: "https://gateway.example.test/typesafe", JEV_MODEL: "gw/jev" });
    expect(r).toEqual({ route: { kind: "gateway", apiKey: "test-gateway", baseURL: "https://gateway.example.test/typesafe", model: "gw/jev" } });
  });
  it("reports no route when neither key is set", async () => {
    expect("error" in (await route({}))).toBe(true);
  });
});
