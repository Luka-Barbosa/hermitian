/**
 * Plain-SQL checks that every planted scenario is present in the database.
 * Queries the raw tables directly (not the semantic views), and compares with
 * the answer key the generator wrote to data/scenarios.json.
 */
import fs from "node:fs";
import path from "node:path";
import { resolvedDuckdbPath } from "../src/env";
import { openReadOnly, queryRows } from "../src/adapters/stitch/db";

const dbPath = resolvedDuckdbPath();
const scenariosPath = path.join(path.dirname(dbPath), "scenarios.json");
if (!fs.existsSync(scenariosPath)) {
  console.error(`Missing ${scenariosPath}. Run \`pnpm generate\` first.`);
  process.exit(1);
}
const key = JSON.parse(fs.readFileSync(scenariosPath, "utf8"));
const S = key.scenarios;

const CAPTURED = `
  SELECT p.*, CAST(p.completed_at AS DATE) AS d,
         CASE WHEN p.created_at < c.created_at + INTERVAL 30 DAY THEN 'New' ELSE 'Returning' END AS ctype,
         COALESCE(pr.name, 'No promotion') AS promo
  FROM payment_requests p
  JOIN customers c ON c.customer_id = p.customer_id
  LEFT JOIN promotions pr ON pr.code = p.promo_code
  WHERE p.status = 'PaymentComplete'`;

type Check = { scenario: string; check: string; pass: boolean; detail: string };
const results: Check[] = [];
const record = (scenario: string, check: string, pass: boolean, detail: string) => results.push({ scenario, check, pass, detail });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

async function main() {
  const conn = await openReadOnly(dbPath);
  const q = (sql: string) => queryRows(conn, sql);

  // 1. Promo: segment values for Aug and Sep match the answer key to the cent.
  {
    const rows = await q(`
      SELECT promo || ' · ' || ctype AS seg,
             SUM(amount_cents) FILTER (WHERE d BETWEEN DATE '2026-08-01' AND DATE '2026-08-31')::BIGINT AS aug,
             SUM(amount_cents) FILTER (WHERE d BETWEEN DATE '2026-09-01' AND DATE '2026-09-30')::BIGINT AS sep
      FROM (${CAPTURED}) GROUP BY 1`);
    const bySeg = new Map(rows.map((r) => [r.seg as string, r]));
    let ok = true;
    const parts: string[] = [];
    for (const s of S.promo.answer.segments) {
      const r = bySeg.get(s.key);
      const delta = Number(r?.sep ?? 0) - Number(r?.aug ?? 0);
      if (delta !== s.deltaCents) ok = false;
      parts.push(`${s.key} ${delta >= 0 ? "+" : ""}R${(delta / 100).toFixed(2)}`);
    }
    record("promo", "Sep vs Aug change by promotion x customer type matches answer key", ok, parts.join("; "));
    const total = rows.reduce((a, r) => a + Number(r.sep ?? 0) - Number(r.aug ?? 0), 0);
    record("promo", "Captured value up in September", total > 0 && total === S.promo.answer.changeCents, `+R${(total / 100).toFixed(2)} (${pct(total / Math.round(S.promo.answer.previousValue * 100))})`);
    const [pf] = await q(`
      SELECT SUM(amount_cents) FILTER (WHERE d BETWEEN DATE '2026-09-18' AND DATE '2026-09-30')::BIGINT AS after_sale,
             SUM(amount_cents) FILTER (WHERE d BETWEEN DATE '2026-08-18' AND DATE '2026-08-30')::BIGINT AS same_dates_aug
      FROM (${CAPTURED}) WHERE ctype = 'Returning' AND promo = 'No promotion'`);
    const change = Number(pf!.after_sale) / Number(pf!.same_dates_aug) - 1;
    record("promo", "Regulars bought early: returning non-promo value fell after the sale", change < -0.05, `${pct(change)} vs the same dates in August`);
  }

  // 2. Issuer dip: Protea Bank lowest on the dip day; afternoon window far below previous Saturdays.
  {
    const dip = S.issuer_dip.planted;
    const day = await q(`
      SELECT issuer_bank, COUNT(*) AS attempts, COUNT(*) FILTER (WHERE approved) AS approved
      FROM authorization_attempts
      WHERE issuer_bank IS NOT NULL AND CAST(attempted_at AS DATE) = DATE '${dip.date}'
      GROUP BY 1 ORDER BY COUNT(*) FILTER (WHERE approved)::DOUBLE / COUNT(*)`);
    const lowest = day[0]!;
    const expected = S.issuer_dip.answer.dayRanking[0];
    record("issuer_dip", `Lowest approval on ${dip.date} is ${dip.issuer}`,
      lowest.issuer_bank === dip.issuer && lowest.attempts === expected.attempts && lowest.approved === expected.approved,
      `${lowest.issuer_bank}: ${lowest.approved}/${lowest.attempts} = ${pct(Number(lowest.approved) / Number(lowest.attempts))}`);
    const win = await q(`
      SELECT CAST(attempted_at AS DATE)::VARCHAR AS d, COUNT(*) AS attempts, COUNT(*) FILTER (WHERE approved) AS approved
      FROM authorization_attempts
      WHERE issuer_bank = '${dip.issuer}' AND dayofweek(attempted_at) = 6
        AND hour(attempted_at) >= ${dip.startHour} AND hour(attempted_at) < ${dip.endHour}
        AND CAST(attempted_at AS DATE) BETWEEN DATE '${dip.date}' - INTERVAL 21 DAY AND DATE '${dip.date}'
      GROUP BY 1 ORDER BY 1`);
    const dipRow = win.find((r) => r.d === dip.date)!;
    const others = win.filter((r) => r.d !== dip.date);
    const dipRate = Number(dipRow.approved) / Number(dipRow.attempts);
    const otherRates = others.map((r) => Number(r.approved) / Number(r.attempts));
    record("issuer_dip", `${dip.startHour}:00-${dip.endHour}:00 window far below previous Saturdays`,
      dipRate < 0.6 && otherRates.every((r) => r > 0.85) && dipRow.attempts === S.issuer_dip.answer.dipWindow.attempts,
      `${pct(dipRate)} vs ${otherRates.map(pct).join(", ")}`);
  }

  // 3. Chargeback ring: the planted cards are reused across new accounts and dominate chargebacks.
  {
    const rows = await q(`
      WITH cb AS (
        SELECT i.card_fingerprint AS fp, COUNT(*) AS chargebacks
        FROM disputes d JOIN payment_requests p ON p.payment_id = d.payment_id
        JOIN instruments i ON i.instrument_id = p.instrument_id
        WHERE i.card_fingerprint IS NOT NULL GROUP BY 1
      ),
      accts AS (
        SELECT i.card_fingerprint AS fp, COUNT(DISTINCT i.customer_id) AS accounts,
               COUNT(DISTINCT i.customer_id) FILTER (WHERE c.created_at >= TIMESTAMP '2026-04-01') AS new_accounts
        FROM instruments i JOIN customers c ON c.customer_id = i.customer_id
        WHERE i.card_fingerprint IS NOT NULL GROUP BY 1
      )
      SELECT cb.fp, cb.chargebacks, accts.accounts, accts.new_accounts
      FROM cb JOIN accts USING (fp)
      WHERE accts.accounts >= 3 ORDER BY cb.chargebacks DESC`);
    const planted = new Set<string>(S.chargeback_ring.planted.fingerprints);
    const found = new Set(rows.map((r) => r.fp as string));
    const sameSet = planted.size === found.size && [...planted].every((f) => found.has(f));
    const allNew = rows.every((r) => r.accounts === r.new_accounts);
    const countsMatch = S.chargeback_ring.answer.cards.every((c: { fingerprint: string; chargebacks: number; accounts: number }) => {
      const r = rows.find((x) => x.fp === c.fingerprint);
      return r && r.chargebacks === c.chargebacks && r.accounts === c.accounts;
    });
    record("chargeback_ring", "Only the planted cards are shared across accounts, all newly created", sameSet && allNew && countsMatch,
      rows.map((r) => `${r.fp}: ${r.accounts} accounts, ${r.chargebacks} chargebacks`).join("; "));
    const [share] = await q(`
      SELECT COUNT(*) FILTER (WHERE i.card_fingerprint IN (${[...planted].map((f) => `'${f}'`).join(",")})) AS ring, COUNT(*) AS total
      FROM disputes d JOIN payment_requests p ON p.payment_id = d.payment_id JOIN instruments i ON i.instrument_id = p.instrument_id
      WHERE d.received_at >= TIMESTAMP '2026-07-03'`);
    record("chargeback_ring", "Ring cards hold a large share of last-90-day chargebacks",
      share!.ring === S.chargeback_ring.answer.ringChargebacksLast90 && Number(share!.ring) / Number(share!.total) > 0.3,
      `${share!.ring} of ${share!.total} (${pct(Number(share!.ring) / Number(share!.total))})`);
  }

  // 4. Wallet shift: Apple Pay overtakes card, Capitec Pay grows.
  {
    const rows = await q(`
      SELECT strftime(d, '%Y-%m') AS m, method, SUM(amount_cents)::BIGINT AS v
      FROM (${CAPTURED}) GROUP BY 1, 2 ORDER BY 1`);
    const months = [...new Set(rows.map((r) => r.m as string))].sort();
    const share = (m: string, method: string) => {
      const ms = rows.filter((r) => r.m === m);
      const total = ms.reduce((a, r) => a + Number(r.v), 0);
      return Number(ms.find((r) => r.method === method)?.v ?? 0) / total;
    };
    const firstOvertake = months.find((m) => share(m, "apple_pay") > share(m, "card"));
    record("wallet_shift", "Apple Pay overtakes card", firstOvertake === S.wallet_shift.answer.applePayOvertakesCardIn && firstOvertake === months.at(-1),
      months.map((m) => `${m} Apple Pay ${pct(share(m, "apple_pay"))} / Card ${pct(share(m, "card"))}`).join("; "));
    const capitec = months.map((m) => share(m, "capitec_pay"));
    const keyCapitec = S.wallet_shift.answer.monthly.map((m: { shares: Record<string, number> }) => m.shares["Capitec Pay"]);
    record("wallet_shift", "Capitec Pay share grows every month", capitec.every((v, i) => i === 0 || v > capitec[i - 1]!) && capitec.every((v, i) => Math.abs(v - keyCapitec[i]) < 1e-12),
      capitec.map(pct).join(" → "));
  }

  // 5. Payday: the 25th is the busiest day of every month.
  {
    const rows = await q(`
      SELECT strftime(d, '%Y-%m') AS m, d::VARCHAR AS day, SUM(amount_cents)::BIGINT AS v
      FROM (${CAPTURED}) GROUP BY 1, 2`);
    const months = [...new Set(rows.map((r) => r.m as string))].sort();
    const peaks = months.map((m) => rows.filter((r) => r.m === m).sort((a, b) => Number(b.v) - Number(a.v))[0]!);
    const sep25 = rows.find((r) => r.day === "2026-09-25")!;
    record("payday", "The 25th is the peak day of every month", peaks.every((p) => (p.day as string).endsWith("-25")) && Number(sep25.v) === Math.round(S.payday.answer.sep25 * 100),
      peaks.map((p) => `${p.day} R${(Number(p.v) / 100).toFixed(0)}`).join("; "));
  }

  // 6. Out of scope: nothing in the data could predict default.
  {
    const rows = await q(`
      SELECT table_name, column_name FROM information_schema.columns
      WHERE regexp_matches(lower(column_name), 'default|credit|score|loan|limit|income')`);
    record("out_of_scope", "No credit or default data exists to answer 'Which customer will default?'", rows.length === 0,
      rows.length ? rows.map((r) => `${r.table_name}.${r.column_name}`).join(", ") : "no credit, score, loan or income columns");
  }

  const width = Math.max(...results.map((r) => r.check.length));
  for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.scenario.padEnd(16)} ${r.check.padEnd(width)}  ${r.detail}`);
  const failed = results.filter((r) => !r.pass).length;
  console.log(`\n${results.length - failed}/${results.length} scenario checks passed.`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
