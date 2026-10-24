# Eval results

Run 2026-10-24T07:03:25.626Z on **replay** (System 1: replay, System 2: replay). 34/34 questions pass. Pass bar met.

Expected answers come from `data/scenarios.json`, tallied by the generator from the rows it wrote, never from the agent's query code. Latency is this run's wall time; in brackets, the model time (recorded live latency for replayed calls).

## Pass bar

- [x] Every planted scenario returns exactly the right numbers from the database — 14/14 scenario questions
- [x] Questions expected to return text, a table or a chart come back in that form — 34/34 in the expected form
- [x] Each chart type appears correctly at least once — line 6, hbar 7, waterfall 2, stacked100 2
- [x] No ungrounded claim reaches an answer — 34/34 answers fully grounded; 2 claims cut before display
- [x] Misses are logged in a results table and shown in the demo, not hidden — evals/results/latest.md and the app's Eval page

## Misses

None.

## All questions

| ID | Question | Expected answer | Actual answer | Expected form | Chosen form | Route | Latency (model) | Result |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L1 | What was captured value yesterday? | 971577.1300 | 971577.1300 | text | kpi | kpi | System 1 | 82 ms (116814 ms) | pass |
| L2 | How many payments did we capture today? | 1505 | 1505 | text | kpi | kpi | System 1 | 20 ms (25792 ms) | pass |
| L3 | What was the average transaction value last month? | 791.1882864 | 791.1882864 | text | kpi | kpi | System 1 | 34 ms (183689 ms) | pass |
| L4 | What was our approval rate in the last 7 days? | 0.9100207326 | 0.9100207326 | text | kpi | kpi | System 1 | 57 ms (20570 ms) | pass |
| L5 | How many unique customers paid us last month? | 37135 | 37135 | text | kpi | kpi | System 1 | 31 ms (21909 ms) | pass |
| L6 | What was the refund rate last month? | 0.03500497188 | 0.03500497188 | text | kpi | kpi | System 1 | 45 ms (205244 ms) | pass |
| L7 | How many different customer accounts used card fp_afc6eb9e in the last 90 days? | 12 | 12 | text | kpi | kpi | System 1 | 30 ms (566205 ms) | pass |
| C1 | How does captured value this month compare with last month? | "42353655.56 vs 39701828.21" | "42353655.56 vs 39701828.21" | kpi | kpi | System 1 | 36 ms (16257 ms) | pass |
| C2 | How did captured value on 25 September compare with 24 September? | "3104322.930 vs 1003607.250" | "3104322.930 vs 1003607.250" | kpi | kpi | escalated | 24 ms (99537 ms) | pass |
| C3 | Compare our approval rate in the last 7 days with the week before. | "0.9100207326 vs 0.9136970554" | "0.9100207326 vs 0.9136970554" | kpi | kpi | System 1 | 85 ms (691849 ms) | pass |
| C4 | How did the number of payments in September compare with August? | "57268 vs 50180" | "57268 vs 50180" | kpi | kpi | escalated | 35 ms (20791 ms) | pass |
| T1 | How did captured value move this month? | "2026-09-25: 3104322.930"; "max at 2026-09-25" | "2026-09-25: 3104322.930"; "max at 2026-09-25" | line | line | System 1 | 63 ms (15551 ms) | pass |
| T2 | Show Protea Bank's approval rate by hour on Saturday 26 September. | "2026-09-26 14:00: 0.4418604651"; "2026-09-26 10:00: 0.8846153846"; "min in 2026-09-26 13:00, 2026-09-26 14:00, 2026-09-26 15:00, 2026-09-26 16:00" | "2026-09-26 14:00: 0.4418604651"; "2026-09-26 10:00: 0.8846153846"; "min at 2026-09-26 15:00" | line | line | escalated | 109 ms (20460 ms) | pass |
| T3 | How has approval rate moved over the last 7 days? | "2026-09-26: 0.8839566585" | "2026-09-26: 0.8839566585" | line | line | System 1 | 111 ms (14407 ms) | pass |
| T4 | How has approval rate moved this quarter? | "2026-07-01 to 2026-09-30" | "2026-07-01 to 2026-09-30" | line | line | escalated | 118 ms (19955 ms) | pass |
| T5 | Show daily captured value over the last 7 days. | "2026-09-24: 1003607.250"; "2026-09-30: 1181834.950" | "2026-09-24: 1003607.250"; "2026-09-30: 1181834.950" | line | line | System 1 | 47 ms (15962 ms) | pass |
| B1 | Show payment-method share by month. | "2026-09 Apple Pay: 0.3370811981"; "2026-09 Card: 0.3095409503"; "2026-04 Card: 0.4591684062"; "2026-04 Capitec Pay: 0.06622988717" | "0.3370811981"; "0.3095409503"; "0.4591684062"; "0.06622988717" | stacked100 | stacked100 | System 1 | 73 ms (13245 ms) | pass |
| B2 | How has our payment method mix changed over the last six months? | "2026-09 Capitec Pay: 0.1459513458"; "2026-08 Apple Pay: 0.3010262408" | "0.1459513458"; "0.3010262408" | stacked100 | stacked100 | System 1 | 67 ms (15985 ms) | pass |
| B3 | Break down captured value by channel last month. | "Online: 18770562.59"; "In-store: 9809885.480" | "Online: 18770562.59"; "In-store: 9809885.480" | hbar | hbar | System 1 | 34 ms (16072 ms) | pass |
| B4 | What share of captured value came from new customers this month? | "New share 0.2122854316" | "0.2122854316" | hbar | text | kpi | hbar | System 1 | 31 ms (16205 ms) | pass |
| R1 | Which issuer has the lowest approval rate? | "\"Quagga Bank\" 0.8920842825" | "\"Quagga Bank\" 0.8920842825" | hbar | hbar | System 1 | 67 ms (15549 ms) | pass |
| R2 | Which issuer had the lowest approval rate on Saturday 26 September? | "\"Protea Bank\" 0.7516483516" | "\"Protea Bank\" 0.7516483516" | hbar | hbar | escalated | 49 ms (19924 ms) | pass |
| F1 | Show its approval rate by hour that day. | "2026-09-26 15:00: 0.4375000000"; "min in 2026-09-26 13:00, 2026-09-26 14:00, 2026-09-26 15:00, 2026-09-26 16:00" | "2026-09-26 15:00: 0.4375000000"; "min at 2026-09-26 15:00" | line | line | escalated | 106 ms (20109 ms) | pass |
| R3 | Which cards have the highest chargeback rate in the last 90 days? | "fp_025a0ccc,fp_1abf5464,fp_2044ec4e,fp_242e539c,fp_afc6eb9e,fp_d549f9c4"; "\"fp_d549f9c4\" 0.8620689655" | "fp_025a0ccc,fp_1abf5464,fp_2044ec4e,fp_242e539c,fp_afc6eb9e,fp_d549f9c4"; "\"fp_d549f9c4\" 0.8620689655" | hbar | hbar | System 1 | 61 ms (15933 ms) | pass |
| R4 | Which stores took the most captured value last month? | "\"Kloofmere Paarl\" 479971.3100" | "\"Kloofmere Paarl\" 479971.3100" | hbar | hbar | System 1 | 25 ms (15924 ms) | pass |
| R5 | Which payment method has the highest refund rate in the last 90 days? | "\"Pay by Bank\" 0.04341806832" | "\"Pay by Bank\" 0.04341806832" | hbar | hbar | System 1 | 49 ms (16222 ms) | pass |
| E1 | Why is captured value up this month? | "39701828.21 → 42353655.56, 4 steps" | "39701828.21 → 42353655.56, Spring Sale · Returning 8837202.73; No promotion · Returning -7375523.50; Spring Sale · New 2466928.27; No promotion · New -1276780.15" | waterfall | waterfall | System 1 | 68 ms (12707 ms) | pass |
| E2 | Why did approval rate drop on 26 September compared with 19 September? | "0.9061433447 → 0.8839566585"; "largest step \"Protea Bank\"" | "0.9061433447 → 0.8839566585"; "\"Protea Bank\"" | waterfall | waterfall | escalated | 49 ms (20988 ms) | pass |
| RL1 | Show the chargebacks on card fp_afc6eb9e. | "10 ids, 27 total" | "10 ids (match), 27 total" | table | table | System 1 | 38 ms (12518 ms) | pass |
| RL2 | Show the last three payments for customer cus_sap5trau. | "3 ids, 25 total" | "3 ids (match), 25 total" | table | table | System 1 | 29 ms (14525 ms) | pass |
| RL3 | List refunds over R5,000 last month. | "1 matching" | "1 matching" | table | table | escalated | 39 ms (15812 ms) | pass |
| O1 | Which customer will default? | "no query, out of scope" | "0 queries, out of scope" | text | text | System 1 | 0 ms (6265 ms) | pass |
| O2 | What will captured value be next month? | "no query, out of scope" | "0 queries, out of scope" | text | text | System 1 | 0 ms (4476 ms) | pass |
| O3 | What was our profit margin last month? | "no query, out of scope" | "0 queries, out of scope" | text | text | System 1 | 0 ms (3839 ms) | pass |
