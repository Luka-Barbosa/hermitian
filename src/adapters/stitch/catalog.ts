import type { Catalog, DimensionDef, MetricDef, RecordTypeDef } from "../../core/catalog";
import { AS_OF, CHANNELS, DATA_END, DATA_START, ISSUERS, MERCHANT, METHODS, NO_PROMOTION, PROMOTIONS, STORE_LOCATIONS } from "./constants";

const CAPTURED = "v_captured_payments";
const ATTEMPTS = "v_auth_attempts";
const REFUNDS = "v_refunds";
const CHARGEBACKS = "v_chargebacks";
const ALL_VIEWS = [CAPTURED, ATTEMPTS, REFUNDS, CHARGEBACKS];

const same = (column: string, views = ALL_VIEWS) => Object.fromEntries(views.map((v) => [v, column]));
const ALL_DIMENSIONS = ["payment_method", "issuer_bank", "channel", "store", "customer_type", "promotion", "card", "customer", "payment", "hour_of_day", "day_of_week"];

const captured = { view: CAPTURED, timeColumn: "captured_at" } as const;

const metrics: MetricDef[] = [
  {
    id: "captured_value",
    label: "Captured payment value",
    topic: "CAPTURED VALUE",
    description: "Total rand value of successfully captured payments (sales, takings, volume in rand). Not revenue.",
    definition: "Sum of successfully captured amounts (not revenue).",
    unit: "zar",
    kind: "additive",
    numerator: { ...captured, expr: "SUM(amount_cents)", divisor: 100 },
    requiredFields: [`${CAPTURED}.amount_cents`, `${CAPTURED}.captured_at`],
    dimensions: ALL_DIMENSIONS,
    drivers: ["promotion", "customer_type"],
    higherIsBetter: true,
  },
  {
    id: "payment_count",
    label: "Payment count",
    topic: "PAYMENT COUNT",
    description: "Number of captured payments (transactions, orders paid, how many payments).",
    definition: "Number of captured payments.",
    unit: "count",
    kind: "additive",
    numerator: { ...captured, expr: "COUNT(*)" },
    requiredFields: [`${CAPTURED}.payment_id`, `${CAPTURED}.captured_at`],
    dimensions: ALL_DIMENSIONS,
    drivers: ["promotion", "customer_type"],
    higherIsBetter: true,
  },
  {
    id: "average_transaction_value",
    label: "Average transaction value",
    topic: "AVERAGE TRANSACTION VALUE",
    description: "Average rand value per captured payment (basket size, ATV, average order value).",
    definition: "Captured value ÷ payment count.",
    unit: "zar",
    kind: "ratio",
    numerator: { ...captured, expr: "SUM(amount_cents)", divisor: 100 },
    denominator: { ...captured, expr: "COUNT(*)" },
    requiredFields: [`${CAPTURED}.amount_cents`, `${CAPTURED}.captured_at`],
    dimensions: ALL_DIMENSIONS,
    drivers: ["channel"],
    higherIsBetter: true,
    minSupport: 10,
    numeratorLabel: "captured value",
    denominatorLabel: "captured payments",
  },
  {
    id: "approval_rate",
    label: "Approval rate",
    topic: "APPROVAL RATE",
    description: "Share of authorization attempts that were approved (acceptance, success rate, declines inverted).",
    definition: "Approved ÷ authorization attempts (retries count as attempts).",
    unit: "ratio",
    kind: "ratio",
    numerator: { view: ATTEMPTS, timeColumn: "attempted_at", expr: "COUNT(*)", where: "approved" },
    denominator: { view: ATTEMPTS, timeColumn: "attempted_at", expr: "COUNT(*)" },
    requiredFields: [`${ATTEMPTS}.approved`, `${ATTEMPTS}.attempted_at`],
    dimensions: ALL_DIMENSIONS,
    drivers: ["issuer_bank"],
    higherIsBetter: true,
    minSupport: 10,
    numeratorLabel: "approved attempts",
    denominatorLabel: "authorization attempts",
  },
  {
    id: "refund_rate",
    label: "Refund rate",
    topic: "REFUND RATE",
    description: "Refunded rand value as a share of captured value.",
    definition: "Refunded value (completed refunds) ÷ captured value.",
    unit: "ratio",
    kind: "ratio",
    numerator: { view: REFUNDS, timeColumn: "refunded_at", expr: "SUM(amount_cents)", where: "status = 'RefundCompleted'", divisor: 100 },
    denominator: { ...captured, expr: "SUM(amount_cents)", divisor: 100 },
    requiredFields: [`${REFUNDS}.amount_cents`, `${REFUNDS}.refunded_at`, `${REFUNDS}.status`, `${CAPTURED}.amount_cents`],
    dimensions: ALL_DIMENSIONS,
    drivers: ["payment_method"],
    higherIsBetter: false,
    numeratorLabel: "refunded value",
    denominatorLabel: "captured value",
  },
  {
    id: "chargeback_rate",
    label: "Chargeback rate",
    topic: "CHARGEBACK RATE",
    description: "Chargebacks (disputes) received as a share of captured payments, count-based. Use for any question about chargebacks or disputes.",
    definition: "Chargebacks received in period ÷ captured payments in period, count-based.",
    unit: "ratio",
    kind: "ratio",
    numerator: { view: CHARGEBACKS, timeColumn: "received_at", expr: "COUNT(*)" },
    denominator: { ...captured, expr: "COUNT(*)" },
    requiredFields: [`${CHARGEBACKS}.received_at`, `${CAPTURED}.captured_at`],
    dimensions: ALL_DIMENSIONS,
    drivers: ["card"],
    higherIsBetter: false,
    minSupport: 10,
    numeratorLabel: "chargebacks",
    denominatorLabel: "captured payments",
  },
  {
    id: "payment_method_share",
    label: "Payment-method share",
    topic: "PAYMENT-METHOD SHARE",
    description: "Each payment method's share of captured value (method mix, wallets vs card).",
    definition: "Each method's share of captured value.",
    unit: "ratio",
    kind: "share",
    numerator: { ...captured, expr: "SUM(amount_cents)", divisor: 100 },
    requiredFields: [`${CAPTURED}.amount_cents`, `${CAPTURED}.payment_method`],
    dimensions: ALL_DIMENSIONS,
    shareOf: "payment_method",
    higherIsBetter: true,
  },
  {
    id: "unique_customers",
    label: "Unique customers",
    topic: "UNIQUE CUSTOMERS",
    description: "Number of distinct (pseudonymised) customers or accounts with a captured payment.",
    definition: "Distinct pseudonymised customer IDs with a captured payment.",
    unit: "count",
    kind: "distinct",
    numerator: { ...captured, expr: "COUNT(DISTINCT customer_id)" },
    requiredFields: [`${CAPTURED}.customer_id`],
    dimensions: ALL_DIMENSIONS,
    higherIsBetter: true,
  },
];

const dimensions: DimensionDef[] = [
  {
    id: "payment_method", label: "Payment method", description: "Card, Apple Pay, Pay by Bank, Capitec Pay or PayShap Request",
    columns: same("payment_method"), kind: "categorical", values: METHODS.map((m) => m.label), filterQuestion: true,
  },
  {
    id: "issuer_bank", label: "Issuer bank", description: "The bank that issued the card or holds the paying account",
    columns: same("issuer_bank"), kind: "categorical", values: ISSUERS.map((i) => i.name), filterQuestion: true,
    nullLabel: "No issuer (Capitec Pay)",
  },
  {
    id: "channel", label: "Channel", description: "Online, app or in-store (POS)",
    columns: same("channel"), kind: "categorical", values: CHANNELS.map((c) => c.label), filterQuestion: true,
  },
  {
    id: "store", label: "Store", description: "One of about 40 physical stores (in-store payments only)",
    columns: same("store"), kind: "categorical", values: STORE_LOCATIONS.map(([city]) => `Kloofmere ${city}`), fuzzyFilter: true,
    nullLabel: "Online and app (no store)",
  },
  {
    id: "customer_type", label: "Customer type", description: "New (account under 30 days old) vs returning customers",
    columns: same("customer_type"), kind: "categorical", values: ["New", "Returning"], filterQuestion: true,
  },
  {
    id: "promotion", label: "Promotion", description: "Promotion code used (Winter Warmers, Spring Sale) or no promotion",
    columns: same("promotion"), kind: "categorical", values: [...PROMOTIONS.map((p) => p.name), NO_PROMOTION], filterQuestion: true,
  },
  {
    id: "card", label: "Card", description: "Individual card, by card fingerprint (fp_...)",
    columns: same("card_fingerprint"), kind: "entity", idPattern: "fp_[0-9a-f]{8}", nullLabel: "No card (bank payment)",
  },
  {
    id: "customer", label: "Customer", description: "Individual customer, by pseudonymised ID (cus_...)",
    columns: same("customer_id"), kind: "entity", idPattern: "cus_[a-z0-9]{8}",
  },
  {
    id: "payment", label: "Payment", description: "Individual payment, by ID (pay_...)",
    columns: same("payment_id"), kind: "entity", idPattern: "pay_[a-z0-9]{10}",
  },
  {
    id: "hour_of_day", label: "Hour of day", description: "Hour of the day as a category, for 'which hour' questions (not for hour-by-hour trends)",
    columns: same("lpad(CAST(hour_of_day AS VARCHAR), 2, '0') || ':00'"), kind: "categorical",
    order: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`),
  },
  {
    id: "day_of_week", label: "Day of week", description: "Weekday as a category, for 'which day of the week' questions",
    columns: same("day_of_week"), kind: "categorical",
    order: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
  },
];

const dt = (col: string) => `strftime(${col}, '%Y-%m-%d %H:%M')`;
const commonFilters = ALL_DIMENSIONS;

const recordTypes: RecordTypeDef[] = [
  {
    id: "payments", label: "Captured payments", description: "Individual captured payments",
    view: CAPTURED, timeColumn: "captured_at", dimensions: commonFilters, amountColumn: "amount_cents",
    columns: [
      { id: "payment_id", label: "Payment", expr: "payment_id", type: "id" },
      { id: "captured_at", label: "Captured", expr: dt("captured_at"), type: "datetime" },
      { id: "amount", label: "Amount", expr: "amount_cents / 100.0", type: "zar" },
      { id: "method", label: "Method", expr: "payment_method", type: "text" },
      { id: "channel", label: "Channel", expr: "channel", type: "text" },
      { id: "store", label: "Store", expr: "COALESCE(store, '—')", type: "text" },
      { id: "customer_id", label: "Customer", expr: "customer_id", type: "id" },
      { id: "promotion", label: "Promotion", expr: "promotion", type: "text" },
    ],
  },
  {
    id: "chargebacks", label: "Chargebacks", description: "Individual chargebacks (disputes) received",
    view: CHARGEBACKS, timeColumn: "received_at", dimensions: commonFilters, amountColumn: "amount_cents",
    columns: [
      { id: "dispute_id", label: "Dispute", expr: "dispute_id", type: "id" },
      { id: "received_at", label: "Received", expr: dt("received_at"), type: "datetime" },
      { id: "card", label: "Card", expr: "card_fingerprint", type: "id" },
      { id: "customer_id", label: "Customer", expr: "customer_id", type: "id" },
      { id: "account_created", label: "Account created", expr: dt("customer_created_at"), type: "datetime" },
      { id: "amount", label: "Amount", expr: "amount_cents / 100.0", type: "zar" },
      { id: "reason", label: "Reason", expr: "reason_code || ' ' || reason", type: "text" },
      { id: "outcome", label: "Outcome", expr: "outcome", type: "text" },
    ],
  },
  {
    id: "refunds", label: "Refunds", description: "Individual refunds with their status",
    view: REFUNDS, timeColumn: "requested_at", dimensions: commonFilters, amountColumn: "amount_cents",
    columns: [
      { id: "refund_id", label: "Refund", expr: "refund_id", type: "id" },
      { id: "requested_at", label: "Requested", expr: dt("requested_at"), type: "datetime" },
      { id: "status", label: "Status", expr: "status", type: "text" },
      { id: "payment_id", label: "Payment", expr: "payment_id", type: "id" },
      { id: "amount", label: "Amount", expr: "amount_cents / 100.0", type: "zar" },
      { id: "reason", label: "Reason", expr: "reason", type: "text" },
      { id: "method", label: "Method", expr: "payment_method", type: "text" },
    ],
  },
];

export const stitchCatalog: Catalog = {
  sourceName: `${MERCHANT.name} (synthetic)`,
  description: MERCHANT.description,
  currency: MERCHANT.currency,
  dataStart: DATA_START,
  dataEnd: DATA_END,
  asOf: AS_OF,
  views: {
    [CAPTURED]: { description: "One row per captured payment", fields: [] },
    [ATTEMPTS]: { description: "One row per authorization attempt", fields: [] },
    [REFUNDS]: { description: "One row per refund", fields: [] },
    [CHARGEBACKS]: { description: "One row per chargeback received", fields: [] },
    v_daily_metrics: { description: "Daily totals", fields: [] },
  },
  metrics,
  dimensions,
  recordTypes,
  amountColumns: { [CAPTURED]: "amount_cents", [ATTEMPTS]: "amount_cents", [REFUNDS]: "amount_cents", [CHARGEBACKS]: "amount_cents" },
  outOfScopeExamples: [
    "credit risk or who will default (no credit data)",
    "forecasts or predictions of future sales",
    "profit, margin or cost (no cost data; captured value is not revenue)",
    "stock, inventory or product-level sales (no line items)",
    "who a customer is (customers are pseudonymised)",
    "marketing attribution or ad spend",
  ],
};
