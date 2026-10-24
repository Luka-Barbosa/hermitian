import { describe, expect, it } from "vitest";
import { POST } from "../src/app/api/ask/route";

async function lines(res: Response): Promise<{ type: string; [k: string]: unknown }[]> {
  const text = await res.text();
  return text.trim().split("\n").map((l) => JSON.parse(l));
}

describe("POST /api/ask", () => {
  it("streams status lines and trace events, then the answer", async () => {
    const res = await POST(new Request("http://localhost/api/ask", { method: "POST", body: JSON.stringify({ question: "What was captured value yesterday?" }) }));
    expect(res.headers.get("content-type")).toContain("ndjson");
    const events = await lines(res);
    const kinds = new Set(events.map((e) => e.type));
    expect(kinds).toEqual(new Set(["status", "trace", "answer"]));
    expect(events.at(-1)!.type).toBe("answer");
    const answer = events.at(-1)!.answer as { error: unknown; results: unknown[]; trace: unknown[] };
    expect(answer.error).toBeNull();
    expect(answer.results).toHaveLength(1);
    expect(answer.trace.length).toBeGreaterThan(5);
  });

  it("rejects an empty question", async () => {
    const res = await POST(new Request("http://localhost/api/ask", { method: "POST", body: JSON.stringify({ question: "" }) }));
    expect(res.status).toBe(400);
  });

  it("reports a missing fixture loudly instead of going live", async () => {
    const res = await POST(new Request("http://localhost/api/ask", { method: "POST", body: JSON.stringify({ question: "A question nobody recorded, about zebras" }) }));
    const answer = (await lines(res)).at(-1)!.answer as { error: { kind: string; hash: string } };
    expect(answer.error.kind).toBe("fixture_miss");
    expect(answer.error.hash).toMatch(/^[0-9a-f]{24}$/);
  });
});
