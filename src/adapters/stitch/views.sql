-- Semantic views: the only objects the agent queries. Each metric in
-- catalog.ts names the view (or, for a ratio, the view per term) it uses.
-- {{DATA_START}} and {{DATA_END_EXCLUSIVE}} are filled in by scripts/generate.ts.

-- Internal helper, not exposed to the agent.
CREATE VIEW payment_attributes AS
SELECT
  p.payment_id,
  p.customer_id,
  p.created_at AS requested_at,
  p.completed_at,
  p.status,
  p.amount_cents,
  p.discount_cents,
  p.promo_code,
  CASE p.method
    WHEN 'card' THEN 'Card'
    WHEN 'apple_pay' THEN 'Apple Pay'
    WHEN 'pay_by_bank' THEN 'Pay by Bank'
    WHEN 'capitec_pay' THEN 'Capitec Pay'
    WHEN 'payshap' THEN 'PayShap Request'
  END AS payment_method,
  CASE p.channel
    WHEN 'online' THEN 'Online'
    WHEN 'app' THEN 'App'
    WHEN 'in_store' THEN 'In-store'
  END AS channel,
  s.name AS store,
  i.issuer_bank,
  i.card_fingerprint,
  c.created_at AS customer_created_at,
  CASE WHEN p.created_at < c.created_at + INTERVAL 30 DAY THEN 'New' ELSE 'Returning' END AS customer_type,
  COALESCE(pr.name, 'No promotion') AS promotion
FROM payment_requests p
JOIN customers c ON c.customer_id = p.customer_id
JOIN instruments i ON i.instrument_id = p.instrument_id
LEFT JOIN stores s ON s.store_id = p.store_id
LEFT JOIN promotions pr ON pr.code = p.promo_code;

-- One row per successfully captured payment. Captured value is not revenue.
CREATE VIEW v_captured_payments AS
SELECT
  payment_id,
  completed_at AS captured_at,
  CAST(completed_at AS DATE) AS captured_date,
  amount_cents,
  amount_cents / 100.0 AS amount_zar,
  discount_cents,
  customer_id,
  customer_created_at,
  customer_type,
  payment_method,
  channel,
  store,
  issuer_bank,
  card_fingerprint,
  promotion,
  promo_code,
  hour(completed_at) AS hour_of_day,
  dayname(completed_at) AS day_of_week
FROM payment_attributes
WHERE status = 'PaymentComplete';

-- One row per authorization attempt (retries count as attempts).
CREATE VIEW v_auth_attempts AS
SELECT
  a.attempt_id,
  a.payment_id,
  a.attempt_number,
  a.attempted_at,
  CAST(a.attempted_at AS DATE) AS attempted_date,
  a.approved,
  a.response_code,
  a.decline_reason,
  a.three_ds_result,
  a.issuer_bank,
  pa.payment_method,
  pa.channel,
  pa.store,
  pa.card_fingerprint,
  pa.customer_id,
  pa.customer_type,
  pa.promotion,
  hour(a.attempted_at) AS hour_of_day,
  dayname(a.attempted_at) AS day_of_week
FROM authorization_attempts a
JOIN payment_attributes pa ON pa.payment_id = a.payment_id;

-- Every refund with its status; refunded value counts RefundCompleted only.
CREATE VIEW v_refunds AS
SELECT
  r.refund_id,
  r.payment_id,
  r.status,
  r.initial_status,
  r.reason,
  r.requested_at,
  r.completed_at AS refunded_at,
  CAST(r.completed_at AS DATE) AS refunded_date,
  r.amount_cents,
  r.amount_cents / 100.0 AS amount_zar,
  pa.payment_method,
  pa.channel,
  pa.store,
  pa.issuer_bank,
  pa.card_fingerprint,
  pa.customer_id,
  pa.customer_type,
  pa.promotion,
  hour(r.completed_at) AS hour_of_day,
  dayname(r.completed_at) AS day_of_week
FROM refunds r
JOIN payment_attributes pa ON pa.payment_id = r.payment_id;

-- One row per chargeback (dispute) received.
CREATE VIEW v_chargebacks AS
SELECT
  d.dispute_id,
  d.payment_id,
  d.received_at,
  CAST(d.received_at AS DATE) AS received_date,
  d.amount_cents,
  d.amount_cents / 100.0 AS amount_zar,
  d.reason_code,
  d.reason,
  d.outcome,
  pa.completed_at AS payment_captured_at,
  pa.payment_method,
  pa.channel,
  pa.store,
  pa.issuer_bank,
  pa.card_fingerprint,
  pa.customer_id,
  pa.customer_created_at,
  pa.customer_type,
  pa.promotion,
  hour(d.received_at) AS hour_of_day,
  dayname(d.received_at) AS day_of_week
FROM disputes d
JOIN payment_attributes pa ON pa.payment_id = d.payment_id;

-- Daily totals, one row per calendar day in the dataset window.
CREATE VIEW v_daily_metrics AS
WITH days AS (
  SELECT CAST(range AS DATE) AS date
  FROM range(DATE '{{DATA_START}}', DATE '{{DATA_END_EXCLUSIVE}}', INTERVAL 1 DAY)
),
cap AS (
  SELECT captured_date AS date, SUM(amount_cents) AS captured_cents, COUNT(*) AS payment_count,
         COUNT(DISTINCT customer_id) AS unique_customers
  FROM v_captured_payments GROUP BY 1
),
att AS (
  SELECT attempted_date AS date, COUNT(*) AS attempts, COUNT(*) FILTER (WHERE approved) AS approved
  FROM v_auth_attempts GROUP BY 1
),
ref AS (
  SELECT refunded_date AS date, SUM(amount_cents) AS refunded_cents
  FROM v_refunds WHERE status = 'RefundCompleted' GROUP BY 1
),
cb AS (
  SELECT received_date AS date, COUNT(*) AS chargebacks FROM v_chargebacks GROUP BY 1
)
SELECT
  days.date,
  COALESCE(cap.captured_cents, 0) / 100.0 AS captured_value,
  COALESCE(cap.payment_count, 0) AS payment_count,
  COALESCE(cap.unique_customers, 0) AS unique_customers,
  COALESCE(att.attempts, 0) AS attempts,
  COALESCE(att.approved, 0) AS approved,
  COALESCE(ref.refunded_cents, 0) / 100.0 AS refunded_value,
  COALESCE(cb.chargebacks, 0) AS chargebacks
FROM days
LEFT JOIN cap ON cap.date = days.date
LEFT JOIN att ON att.date = days.date
LEFT JOIN ref ON ref.date = days.date
LEFT JOIN cb ON cb.date = days.date
ORDER BY days.date;
