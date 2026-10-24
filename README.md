# Hermitian

A read-only payments analytics agent. Ask a question in plain English; the answer comes back as text, a KPI card, a table or a chart, with every decision, query and check visible in a trace.

The model chooses; code computes. A System 1 model makes typed choices (intent, metric, period, breakdown, filters, visual). Deterministic code turns those choices into SQL over read-only semantic views, so every number comes from DuckDB. A System 2 LLM only fills gaps (custom dates, amount filters, unsure choices) and writes a short narrative, which is checked against the query results before it is shown.

Unaffiliated demo. Data model inspired by Stitch's public API docs. All data synthetic.

## Run it

Needs Node 22+ and pnpm.

```bash
pnpm install
```

Copy `.env.example` to `.env.local` and fill in the keys you have. With the defaults (`DECIDE_BACKEND=replay`, `SYSTEM2_BACKEND=replay`) no key is used: answers to the recorded questions replay from `fixtures/`.

```bash
pnpm generate
```

```bash
pnpm dev
```

Open http://localhost:3000 and try one of the planted scenarios on the start page. Stop `pnpm dev` before running `pnpm generate` again (DuckDB holds a file lock on Windows).

| Command | Does |
| --- | --- |
| `pnpm generate` | Seeded generator: writes `data/hermitian.duckdb` and the answer key `data/scenarios.json` |
| `pnpm check:scenarios` | Plain-SQL checks, against the raw tables, that every planted scenario is present |
| `pnpm typecheck` / `pnpm test` | TypeScript / Vitest (replay only, never live) |
| `pnpm eval` | Runs the eval questions on replay fixtures and writes `evals/results/latest.md` |
| `pnpm eval --live` | The same against live Jev through the Vercel AI Gateway (paid, capped by `MAX_LIVE_JEV_CALLS`) |
| `pnpm fixtures:record` | Records missing fixtures (`--via=gemini` for simulated Jev on free Gemini, `--prune` to drop unused ones) |
| `pnpm ask "question" --trace` | One question from the terminal |
| `pnpm doctor` | Checks config (presence only), the database, one Gemini call and one Jev call |

## How it works

```
question
  → System 1 (decide): one batch of typed Choice / Noul questions, each with "none of these"
      confident → act · unsure or "none" on a slot that matters → escalate to System 2
  → query plan (Zod) → gate 1: can this data answer it?
  → intent → operations (in code) → gate 2: windows, denominators
  → SQL built from the adapter's catalog → DuckDB, read-only → typed results with ids
  → gate 4: code lists the visuals that fit the result's shape → System 1 picks one
  → System 2 writes the narrative from formatted facts
  → gate 3: every number, date and time must match a result; System 1 checks each claim; failures are cut and logged
  → answer: charts and tables bind to result ids, never to text
```

- `src/core` is data-agnostic: catalog contract, `decide()` (replay, record, Jev, simulated Jev), System 2, plan, SQL builder, gates, visuals, trace, pipeline.
- `src/adapters/stitch` holds everything source-specific: raw schema, semantic views, metric catalog. A second data source is a second adapter.
- `src/app` and `src/ui` are the Next.js chat, the Trace sidebar and the Eval page.
- Every System 1 and System 2 call is keyed by a hash of its request. Replay reads `fixtures/<kind>/<hash>.json` and fails loudly on a miss; it never falls through to a live call.

## The data

Six months (April to September 2026) of synthetic payments for a fictional omnichannel fashion and homeware retailer, about 316,000 payment requests across card, Apple Pay, Pay by Bank, Capitec Pay and PayShap Request, online, in-app and at 40 stores. Issuing banks and the merchant are invented. The generator is seeded and plants six scenarios; it tallies the answer key from the rows it writes, so the eval never grades the agent with its own query code:

1. A mid-month promotion, with part of the lift from regulars buying early
2. One issuer's approval rate dipping on a Saturday afternoon
3. Chargebacks concentrated in a few cards reused across new accounts
4. Wallets overtaking card, Capitec Pay growing
5. A payday spike on the 25th
6. A question the data cannot answer ("Which customer will default?")

## Evaluation

`evals/questions.json` holds the eval questions, covering every intent and output form, with expected answers as paths into the answer key. `pnpm eval` writes the results table (expected and actual answer, expected and chosen form, route, latency, pass or miss) to `evals/results/latest.md`; the app shows the same table at `/eval`, misses first.

The committed fixtures were recorded with simulated Jev (System 1 questions answered by free Gemini with Jev's confidence formulas), so their confidence is not calibrated. `pnpm fixtures:record` with a gateway key re-records them with Jev.
