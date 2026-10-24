import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStitchAdapter } from "../src/adapters/stitch";
import { makePeriod, previousPeriod, resolvePreset } from "../src/core/periods";
import type { Operation } from "../src/core/plan/operations";
import { buildQuery } from "../src/core/query/builder";
import type { ResultData } from "../src/core/results";
import { PERIOD_PRESETS } from "../src/core/types";

/**
 * Gate 2 (calculation): definitions, denominators and windows, checked against
 * the generator's answer key. No model is involved; this is the SQL alone.
 */

const key = JSON.parse(fs.readFileSync(path.join("data", "scenarios.json"), "utf8"));
const adapter = createStitchAdapter(path.join("data", "hermitian.duckdb"));
const asOf = adapter.catalog.asOf;

async function run<T extends ResultData>(op: Operation): Promise<T> {
  const b = buildQuery(adapter.catalog, op);
  const rows = [];
  for (const sql of b.sql) rows.push(await adapter.query(sql));
  return b.toData(rows) as T;
}

const zar = (a: number | null, b: number) => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(0.005);
const ratio = (a: number | null, b: number) => expect(Math.abs((a ?? NaN) - b)).toBeLessThan(1e-9);

describe("metric definitions match the answer key for every preset window", () => {
  for (const preset of PERIOD_PRESETS) {
    it(preset, async () => {
      const w = key.windows[preset];
      const period = resolvePreset(preset, asOf);
      const agg = async (metric: string) => (await run<Extract<ResultData, { shape: "scalar" }>>({ op: "aggregate", metric, period, filters: [] })).value;
      zar(await agg("captured_value"), w.capturedValue);
      expect(await agg("payment_count")).toBe(w.paymentCount);
      expect(await agg("unique_customers")).toBe(w.uniqueCustomers);
      ratio(await agg("approval_rate"), w.approvalRate);
      ratio(await agg("refund_rate"), w.refundRate);
      ratio(await agg("chargeback_rate"), w.chargebackRate);
      expect(Math.abs((await agg("average_transaction_value"))! - w.averageTransactionValue)).toBeLessThan(1e-6);
    });
  }
});

describe("planted scenarios", () => {
  it("promo: contributions reconcile exactly with the September change", async () => {
    const mtd = resolvePreset("month_to_date", asOf);
    const c = await run<Extract<ResultData, { shape: "contribution" }>>({ op: "contribution", metric: "captured_value", period: mtd, comparison: previousPeriod(mtd), drivers: ["promotion", "customer_type"], filters: [] });
    const a = key.scenarios.promo.answer;
    zar(c.start, a.previousValue);
    zar(c.end, a.currentValue);
    zar(c.change, a.change);
    for (const s of a.segments) zar(c.steps.find((x) => x.label === s.key)!.delta, s.delta);
  });

  it("issuer dip: Protea Bank is lowest on the day and dips in the afternoon", async () => {
    const day = makePeriod("custom", "2026-09-26", "2026-09-26");
    const r = await run<Extract<ResultData, { shape: "categories" }>>({ op: "group_rank", metric: "approval_rate", period: day, dimension: "issuer_bank", direction: "asc", limit: 10, minSupport: 10, filters: [] });
    const expected = key.scenarios.issuer_dip.answer.dayRanking;
    expect(r.items.map((i) => i.label)).toEqual(expected.map((x: { issuer: string }) => x.issuer));
    ratio(r.items[0]!.value, expected[0].rate);
    const s = await run<Extract<ResultData, { shape: "series" }>>({
      op: "time_series", metric: "approval_rate", period: day, grain: "hour", breakdown: null,
      filters: [{ kind: "dimension", dimension: "issuer_bank", values: ["Protea Bank"], source: "system1" }],
      comparison: { kind: "complement", dimension: "issuer_bank", values: ["Protea Bank"] },
    });
    for (const h of key.scenarios.issuer_dip.answer.hourly) {
      const p = s.series[0]!.points[h.hour]!;
      if (h.issuer.rate === null) expect(p.value).toBeNull();
      else ratio(p.value, h.issuer.rate);
      const o = s.series[1]!.points[h.hour]!;
      if (h.otherIssuers.rate !== null) ratio(o.value, h.otherIssuers.rate);
    }
  });

  it("chargeback ring: the six planted cards top the 90-day ranking", async () => {
    const r = await run<Extract<ResultData, { shape: "categories" }>>({ op: "group_rank", metric: "chargeback_rate", period: resolvePreset("last_90_days", asOf), dimension: "card", direction: "desc", limit: 10, minSupport: 10, filters: [] });
    const expected = key.scenarios.chargeback_ring.answer.rankingLast90;
    expect(r.items.slice(0, 6).map((i) => i.label).sort()).toEqual([...key.scenarios.chargeback_ring.planted.fingerprints].sort());
    expected.slice(0, 6).forEach((e: { fingerprint: string; rate: number; chargebacks: number; captured: number }, i: number) => {
      expect(r.items[i]!.label).toBe(e.fingerprint);
      ratio(r.items[i]!.value, e.rate);
      expect(r.items[i]!.numerator).toBe(e.chargebacks);
      expect(r.items[i]!.denominator).toBe(e.captured);
    });
  });

  it("wallet shift: monthly method shares match and sum to 100%", async () => {
    const m = await run<Extract<ResultData, { shape: "share_matrix" }>>({ op: "share_matrix", metric: "payment_method_share", period: resolvePreset("last_6_months", asOf), dimension: "payment_method", grain: "month", filters: [] });
    for (const month of key.scenarios.wallet_shift.answer.monthly) {
      for (const [method, share] of Object.entries<number>(month.shares)) {
        ratio(m.cells.find((c) => c.bucket === month.month && c.category === method)!.share, share);
      }
    }
  });

  it("payday: the 25th against the 24th", async () => {
    const d = await run<Extract<ResultData, { shape: "delta" }>>({ op: "period_change", metric: "captured_value", period: makePeriod("custom", "2026-09-25", "2026-09-25"), comparison: makePeriod("custom", "2026-09-24", "2026-09-24"), filters: [] });
    zar(d.current, key.scenarios.payday.answer.sep25);
    zar(d.previous, key.scenarios.payday.answer.sep24);
  });

  it("records: the last three payments of the sample customer", async () => {
    const r = await run<Extract<ResultData, { shape: "records" }>>({
      op: "filter_records", recordType: "payments", period: makePeriod("all", "2026-04-01", "2026-09-30"), limit: 3,
      filters: [{ kind: "dimension", dimension: "customer", values: [key.records.sampleCustomer.customerId], source: "pattern" }],
    });
    expect(r.rows.map((x) => x.payment_id)).toEqual(key.records.sampleCustomer.lastThree.map((x: { paymentId: string }) => x.paymentId));
    expect(r.totalMatching).toBe(key.records.sampleCustomer.capturedPayments);
  });
});
