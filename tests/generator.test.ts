import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Rng } from "../scripts/lib/rng";

describe("seeded generator randomness", () => {
  it("is deterministic per seed and stream", () => {
    const a = new Rng(42, "payments");
    const b = new Rng(42, "payments");
    const xs = Array.from({ length: 5 }, () => a.next());
    const ys = Array.from({ length: 5 }, () => b.next());
    expect(xs).toEqual(ys);
  });

  it("gives different streams different sequences", () => {
    expect(new Rng(42, "a").next()).not.toEqual(new Rng(42, "b").next());
  });

  it("draws weighted indexes in proportion", () => {
    const r = new Rng(1, "w");
    const counts = [0, 0];
    for (let i = 0; i < 10_000; i++) counts[r.weighted([1, 3])]!++;
    expect(counts[1]! / 10_000).toBeGreaterThan(0.72);
    expect(counts[1]! / 10_000).toBeLessThan(0.78);
  });
});

describe("answer key", () => {
  const file = path.join(process.cwd(), "data", "scenarios.json");

  it("exists (run pnpm generate first)", () => {
    expect(fs.existsSync(file)).toBe(true);
  });

  it("records all six planted scenarios with their parameters", () => {
    const key = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(Object.keys(key.scenarios).sort()).toEqual(["chargeback_ring", "issuer_dip", "out_of_scope", "payday", "promo", "wallet_shift"]);
    for (const s of Object.values<{ planted: unknown; answer: unknown }>(key.scenarios)) {
      expect(s.planted).toBeTruthy();
      expect(s.answer).toBeTruthy();
    }
  });

  it("promo segments add up to the total change exactly", () => {
    const key = JSON.parse(fs.readFileSync(file, "utf8"));
    const a = key.scenarios.promo.answer;
    const sum = a.segments.reduce((acc: number, s: { deltaCents: number }) => acc + s.deltaCents, 0);
    expect(sum).toBe(a.changeCents);
  });
});
