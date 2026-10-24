-- Raw tables, shaped after Stitch's public API objects (payment requests with
-- status changes, consents/instruments, refunds, disputes). Synthetic data only.
-- Timestamps are South African wall-clock time (SAST, no zone).
-- Money is integer cents.

CREATE TABLE merchants (
  merchant_id  VARCHAR PRIMARY KEY,
  name         VARCHAR NOT NULL,
  description  VARCHAR,
  currency     VARCHAR NOT NULL,
  country      VARCHAR NOT NULL
);

CREATE TABLE stores (
  store_id     VARCHAR PRIMARY KEY,
  merchant_id  VARCHAR NOT NULL,
  name         VARCHAR NOT NULL,
  city         VARCHAR NOT NULL,
  province     VARCHAR NOT NULL
);

CREATE TABLE terminals (
  terminal_id  VARCHAR PRIMARY KEY,
  store_id     VARCHAR NOT NULL
);

CREATE TABLE customers (
  customer_id  VARCHAR PRIMARY KEY,   -- pseudonymised
  merchant_id  VARCHAR NOT NULL,
  created_at   TIMESTAMP NOT NULL
);

-- Tokenised payment instruments (card, Apple Pay token, bank-account token).
CREATE TABLE instruments (
  instrument_id     VARCHAR PRIMARY KEY,
  customer_id       VARCHAR NOT NULL,
  instrument_type   VARCHAR NOT NULL,  -- card | apple_pay_token | bank_account
  method            VARCHAR NOT NULL,
  card_fingerprint  VARCHAR,           -- same physical card => same fingerprint
  bin               VARCHAR,
  scheme            VARCHAR,
  issuer_bank       VARCHAR,
  account_token     VARCHAR,
  created_at        TIMESTAMP NOT NULL
);

CREATE TABLE promotions (
  promotion_id  VARCHAR PRIMARY KEY,
  name          VARCHAR NOT NULL,
  code          VARCHAR NOT NULL,
  starts_at     TIMESTAMP NOT NULL,
  ends_at       TIMESTAMP NOT NULL,
  discount_pct  INTEGER NOT NULL
);

CREATE TABLE payment_requests (
  payment_id      VARCHAR PRIMARY KEY,
  merchant_id     VARCHAR NOT NULL,
  customer_id     VARCHAR NOT NULL,
  instrument_id   VARCHAR NOT NULL,
  method          VARCHAR NOT NULL,   -- card | apple_pay | pay_by_bank | capitec_pay | payshap
  channel         VARCHAR NOT NULL,   -- online | app | in_store
  store_id        VARCHAR,
  terminal_id     VARCHAR,
  amount_cents    BIGINT NOT NULL,    -- amount charged, after any discount
  currency        VARCHAR NOT NULL,
  status          VARCHAR NOT NULL,   -- PaymentComplete | PaymentFailed | PaymentExpired
  promo_code      VARCHAR,
  discount_cents  BIGINT NOT NULL,
  created_at      TIMESTAMP NOT NULL,
  completed_at    TIMESTAMP           -- capture time when status = PaymentComplete
);

-- Every status change a payment request reports.
CREATE TABLE payment_status_events (
  payment_id   VARCHAR NOT NULL,
  status       VARCHAR NOT NULL,
  occurred_at  TIMESTAMP NOT NULL
);

CREATE TABLE authorization_attempts (
  attempt_id       VARCHAR PRIMARY KEY,
  payment_id       VARCHAR NOT NULL,
  attempt_number   INTEGER NOT NULL,
  issuer_bank      VARCHAR,           -- null for Capitec Pay
  three_ds_result  VARCHAR NOT NULL,
  response_code    VARCHAR NOT NULL,
  decline_reason   VARCHAR,
  approved         BOOLEAN NOT NULL,
  attempted_at     TIMESTAMP NOT NULL
);

CREATE TABLE refunds (
  refund_id       VARCHAR PRIMARY KEY,
  payment_id      VARCHAR NOT NULL,
  amount_cents    BIGINT NOT NULL,
  reason          VARCHAR NOT NULL,
  initial_status  VARCHAR NOT NULL,   -- RefundPending | TransactionPending
  status          VARCHAR NOT NULL,   -- RefundCompleted | RefundPending | RefundDeclined
  requested_at    TIMESTAMP NOT NULL,
  completed_at    TIMESTAMP
);

CREATE TABLE disputes (
  dispute_id    VARCHAR PRIMARY KEY,
  payment_id    VARCHAR NOT NULL,
  reason_code   VARCHAR NOT NULL,
  reason        VARCHAR NOT NULL,
  amount_cents  BIGINT NOT NULL,
  received_at   TIMESTAMP NOT NULL,
  outcome       VARCHAR NOT NULL      -- won | lost | pending
);

CREATE TABLE dataset_meta (
  key    VARCHAR PRIMARY KEY,
  value  VARCHAR NOT NULL
);
