import { describe, expect, it } from "vitest";
import { runQuestions } from "../evals/lib";

/**
 * End to end on replay fixtures: the milestone questions answer with the right
 * numbers (from the generator's answer key) and in the right form.
 */
describe("pipeline on replay", () => {
  it("answers the milestone questions correctly and in the expected form", async () => {
    const { rows, answers } = await runQuestions(undefined, new Set(["L1", "R1", "C1"]));
    expect(rows.map((r) => r.id).sort()).toEqual(["C1", "L1", "R1"]);
    for (const r of rows) {
      expect(r.error, r.id).toBeNull();
      expect(r.numbersOk, `${r.id}: ${r.actualAnswer}`).toBe(true);
      expect(r.formOk, `${r.id}: ${r.chosenForm}`).toBe(true);
      expect(r.grounded, r.id).toBe(true);
    }
    const r1 = answers.get("R1")!;
    expect(r1.trace.some((t) => t.kind === "query" && t.sql?.length)).toBe(true);
    expect(r1.trace.filter((t) => t.kind === "gate").length).toBeGreaterThanOrEqual(3);
  });

  it("answers an out-of-scope question in code, with no query", async () => {
    const { answers } = await runQuestions(undefined, new Set(["O1"]));
    const a = answers.get("O1")!;
    expect(a.outOfScope).toBe(true);
    expect(a.results).toHaveLength(0);
  });
});
