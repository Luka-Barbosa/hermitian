/**
 * Seeded generator: writes data/hermitian.duckdb and data/scenarios.json.
 *
 * Rows are produced by code from planting parameters, never by an LLM. The
 * answer key in scenarios.json is tallied here in plain JS from the generated
 * rows, independently of the semantic views and the agent's query code, so the
 * eval does not grade itself.
 *
 * Stop `pnpm dev` first: on Windows the app's read-only handle locks the file.
 */
import fs from "node:fs";
import path from "node:path";
import { DuckDBDataChunkWriter, DuckDBInstance, JSToDuckDBValueConverter } from "@duckdb/node-api";
import { env, resolvedDuckdbPath } from "../src/env";
import {
  AS_OF, DATA_END, DATA_START, ISSUERS, MERCHANT, METHODS, NEW_CUSTOMER_DAYS, NO_PROMOTION, PROMOTIONS,
  STORE_LOCATIONS, type ChannelId, type MethodId,
} from "../src/adapters/stitch/constants";
import { Rng } from "./lib/rng";

// ---------------------------------------------------------------------------
// Planting parameters. scenarios.json records all of them.
// ---------------------------------------------------------------------------

const PARAMS = {
  baseRequestsPerDay: 1500,
  monthlyGrowth: 0.012,
  newCustomerShare: 0.13,
  preExistingCustomers: 70_000,
  weekday: [1.0, 0.9, 0.9, 0.95, 1.0, 1.15, 1.3] as const, // Sun..Sat
  payday: { day: 25, multipliers: { 25: 2.2, 26: 1.4, 27: 1.15 } as Record<number, number>, amountMultiplier: 1.08 },
  monthEndMultiplier: 1.1,
  /** Method mix (share of payment requests) anchored mid-month, Apr..Sep. */
  methodMix: {
    card: [50, 46, 43, 40, 36, 32],
    apple_pay: [16, 20, 24, 28, 33, 37],
    pay_by_bank: [18, 17, 16, 14, 13, 12],
    capitec_pay: [6, 7, 8, 10, 11, 13],
    payshap: [10, 10, 9, 8, 7, 6],
  } satisfies Record<MethodId, number[]>,
  channelByMethod: {
    card: { online: 0.3, app: 0.2, in_store: 0.5 },
    apple_pay: { online: 0.2, app: 0.3, in_store: 0.5 },
    pay_by_bank: { online: 0.7, app: 0.3, in_store: 0 },
    capitec_pay: { online: 0.5, app: 0.5, in_store: 0 },
    payshap: { online: 0.6, app: 0.4, in_store: 0 },
  } satisfies Record<MethodId, Record<ChannelId, number>>,
  amountMedianZar: { online: 780, app: 560, in_store: 420 } satisfies Record<ChannelId, number>,
  amountSigma: 0.75,
  promo: {
    spring: { newMultiplier: 2.5, returningMultiplier: 1.9, codeUsage: 0.85, pullForwardShare: 0.35, pullForwardDays: 13, pullForwardDecay: 0.85 },
    winter: { newMultiplier: 1.4, returningMultiplier: 1.25, codeUsage: 0.8 },
  },
  issuerDip: { issuer: "Protea Bank", date: "2026-09-26", startHour: 13, endHour: 17, approval: 0.45, responseCode: "91" },
  retry: { card: 0.45, cardDuringDip: 0.6, bank: 0.3, maxAttempts: 3 },
  methodApprovalOffset: { card: 0, apple_pay: 0.03, pay_by_bank: -0.06, capitec_pay: 0, payshap: -0.04 } satisfies Record<MethodId, number>,
  capitecApproval: 0.9,
  refund: { probability: { online: 0.05, app: 0.045, in_store: 0.025 } satisfies Record<ChannelId, number>, fullShare: 0.7 },
  dispute: { cardRemote: 0.0025, cardInStore: 0.0006, applePay: 0.0008 },
  chargebackRing: {
    cards: 6,
    accountsPerCard: [7, 12] as const,
    paymentsPerAccount: [2, 4] as const,
    firstBurst: "2026-07-06",
    burstSpacingDays: 9,
    burstLengthDays: 21,
    amountZar: [2500, 9000] as const,
    disputeProbability: 0.8,
    disputeDelayDays: [12, 30] as const,
  },
  rankingMinSupport: 10,
  /** Caps how much more often one customer buys than the median customer. */
  maxCustomerWeight: 6,
};

// ---------------------------------------------------------------------------
// Time helpers. Timestamps are SAST wall-clock, held as UTC-based millis.
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MIN_MS = 60_000;
const dayMs = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const isoMonth = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const START_MS = dayMs(DATA_START);
const END_DAY_MS = dayMs(DATA_END);
const END_MS = END_DAY_MS + DAY_MS - 1; // inclusive end of the last day

const HOUR_PROFILE: Record<"in_store_weekday" | "in_store_sat" | "in_store_sun" | "online" | "app", number[]> = {
  in_store_weekday: [0, 0, 0, 0, 0, 0, 0, 0, 0.3, 0.6, 0.8, 1.0, 1.2, 1.2, 1.0, 0.9, 1.0, 1.2, 1.1, 0.6, 0.2, 0, 0, 0],
  in_store_sat: [0, 0, 0, 0, 0, 0, 0, 0, 0.2, 0.6, 0.9, 1.1, 1.3, 1.5, 1.6, 1.5, 1.3, 0.8, 0.4, 0.1, 0, 0, 0, 0],
  in_store_sun: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0.5, 0.9, 1.1, 1.2, 1.2, 1.1, 0.9, 0.6, 0, 0, 0, 0, 0, 0, 0],
  online: [0.3, 0.2, 0.1, 0.1, 0.1, 0.2, 0.4, 0.6, 0.8, 0.9, 1.0, 1.0, 1.1, 1.0, 1.0, 1.0, 1.0, 1.1, 1.3, 1.5, 1.6, 1.4, 1.0, 0.6],
  app: [0.3, 0.2, 0.1, 0.1, 0.1, 0.2, 0.5, 0.7, 0.7, 0.7, 0.8, 0.9, 1.0, 0.9, 0.9, 0.9, 1.0, 1.2, 1.4, 1.7, 1.8, 1.6, 1.1, 0.6],
};

function hourProfile(channel: ChannelId, dow: number): number[] {
  if (channel === "in_store") return dow === 6 ? HOUR_PROFILE.in_store_sat : dow === 0 ? HOUR_PROFILE.in_store_sun : HOUR_PROFILE.in_store_weekday;
  return HOUR_PROFILE[channel];
}

// ---------------------------------------------------------------------------
// Row types
// ---------------------------------------------------------------------------

type CustomerType = "New" | "Returning";

interface Customer {
  id: string;
  createdAt: number;
  weight: number;
  bankIdx: number;
  cardIssuerIdx: number;
  fingerprint: string | undefined;
  instruments: Partial<Record<MethodId, Instrument>>;
}

interface Instrument {
  id: string;
  customerId: string;
  type: "card" | "apple_pay_token" | "bank_account";
  method: MethodId;
  fingerprint: string | null;
  bin: string | null;
  scheme: string | null;
  issuer: string | null;
  accountToken: string | null;
  createdAt: number;
}

interface Payment {
  id: string;
  customer: Customer;
  instrument: Instrument;
  method: MethodId;
  channel: ChannelId;
  storeId: string | null;
  terminalId: string | null;
  amountCents: number;
  discountCents: number;
  promoCode: string | null;
  promotion: string;
  status: "PaymentComplete" | "PaymentFailed" | "PaymentExpired";
  createdAt: number;
  completedAt: number | null;
  customerType: CustomerType;
  fraudRing: boolean;
}

interface Attempt {
  id: string;
  paymentId: string;
  number: number;
  issuer: string | null;
  threeDs: string;
  responseCode: string;
  declineReason: string | null;
  approved: boolean;
  at: number;
  day: string;
}

interface Refund {
  id: string;
  payment: Payment;
  amountCents: number;
  reason: string;
  initialStatus: string;
  status: "RefundCompleted" | "RefundPending" | "RefundDeclined";
  requestedAt: number;
  completedAt: number | null;
}

interface Dispute {
  id: string;
  payment: Payment;
  reasonCode: string;
  reason: string;
  amountCents: number;
  receivedAt: number;
  outcome: "won" | "lost" | "pending";
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const seed = env().DATA_SEED;
const rngCustomers = new Rng(seed, "customers");
const rngDemand = new Rng(seed, "demand");
const rngPayments = new Rng(seed, "payments");
const rngAuth = new Rng(seed, "auth");
const rngAfter = new Rng(seed, "refunds-disputes");
const rngRing = new Rng(seed, "chargeback-ring");
const rngIds = new Rng(seed, "ids");

const usedIds = new Set<string>();
function uniqueId(prefix: string, length: number): string {
  for (;;) {
    const id = rngIds.id(prefix, length);
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
}
function uniqueHex(prefix: string, length: number): string {
  for (;;) {
    const id = rngIds.hex(prefix, length);
    if (!usedIds.has(id)) {
      usedIds.add(id);
      return id;
    }
  }
}

const issuerShares = ISSUERS.map((i) => i.share);

// Stores and terminals
const stores = STORE_LOCATIONS.map(([city, province], i) => ({
  id: `st_${String(i + 1).padStart(2, "0")}`,
  name: `Kloofmere ${city}`,
  city,
  province,
  weight: rngCustomers.lognormal(1, 0.45),
  terminals: [] as string[],
}));
for (const s of stores) {
  const n = rngCustomers.int(3, 8);
  for (let t = 0; t < n; t++) s.terminals.push(`trm_${s.id.slice(3)}${String.fromCharCode(97 + t)}`);
}
const storeWeights = stores.map((s) => s.weight);

// Customers
const customers: Customer[] = [];
function newCustomer(createdAt: number, rng: Rng): Customer {
  const c: Customer = {
    id: uniqueId("cus_", 8),
    createdAt,
    weight: Math.min(PARAMS.maxCustomerWeight, rng.lognormal(1, 0.8)),
    bankIdx: rng.weighted(issuerShares),
    cardIssuerIdx: rng.weighted(issuerShares),
    fingerprint: undefined,
    instruments: {},
  };
  customers.push(c);
  return c;
}
const preStart = dayMs("2022-01-01");
for (let i = 0; i < PARAMS.preExistingCustomers; i++) {
  const createdAt = preStart + Math.floor(rngCustomers.next() * (START_MS - preStart));
  newCustomer(createdAt, rngCustomers);
}

const instruments: Instrument[] = [];
function cardFingerprintFor(c: Customer): string {
  if (!c.fingerprint) c.fingerprint = uniqueHex("fp_", 8);
  return c.fingerprint;
}
function binFor(scheme: string, rng: Rng): string {
  return `${scheme === "visa" ? "4" : "5"}99${rng.int(100, 999)}`;
}
function instrumentFor(c: Customer, method: MethodId, at: number, rng: Rng): Instrument {
  const existing = c.instruments[method];
  if (existing) return existing;
  const issuerName = ISSUERS[c.cardIssuerIdx]!.name;
  const bankName = ISSUERS[c.bankIdx]!.name;
  let ins: Instrument;
  if (method === "card" || method === "apple_pay") {
    const scheme = rng.chance(0.62) ? "visa" : "mastercard";
    ins = {
      id: uniqueId("ins_", 10), customerId: c.id, type: method === "card" ? "card" : "apple_pay_token", method,
      fingerprint: cardFingerprintFor(c), bin: binFor(scheme, rng), scheme, issuer: issuerName, accountToken: null, createdAt: at,
    };
  } else {
    ins = {
      id: uniqueId("ins_", 10), customerId: c.id, type: "bank_account", method, fingerprint: null, bin: null, scheme: null,
      issuer: method === "capitec_pay" ? null : bankName, accountToken: uniqueId("bat_", 10), createdAt: at,
    };
  }
  c.instruments[method] = ins;
  instruments.push(ins);
  return ins;
}

const payments: Payment[] = [];
const attempts: Attempt[] = [];
const statusEvents: { paymentId: string; status: string; at: number }[] = [];
const refunds: Refund[] = [];
const disputes: Dispute[] = [];

function promoOn(ms: number) {
  const d = isoDay(ms);
  return PROMOTIONS.find((p) => d >= p.start && d <= p.end);
}

function methodMixAt(ms: number): number[] {
  // Linear interpolation between mid-month anchors (Apr 15 .. Sep 15).
  const anchors = [0, 1, 2, 3, 4, 5].map((m) => Date.UTC(2026, 3 + m, 15));
  const ids = METHODS.map((m) => m.id);
  let i = anchors.findIndex((a) => a > ms);
  if (i === -1) return ids.map((id) => PARAMS.methodMix[id][5]!);
  if (i === 0) return ids.map((id) => PARAMS.methodMix[id][0]!);
  const a0 = anchors[i - 1]!;
  const a1 = anchors[i]!;
  const f = (ms - a0) / (a1 - a0);
  return ids.map((id) => PARAMS.methodMix[id][i - 1]! * (1 - f) + PARAMS.methodMix[id][i]! * f);
}

function approvalProbability(method: MethodId, issuer: string | null, at: number): { p: number; dip: boolean } {
  const dip = PARAMS.issuerDip;
  if (issuer === dip.issuer && isoDay(at) === dip.date) {
    const h = new Date(at).getUTCHours();
    if (h >= dip.startHour && h < dip.endHour) return { p: dip.approval, dip: true };
  }
  if (method === "capitec_pay" || issuer === null) return { p: PARAMS.capitecApproval, dip: false };
  const base = ISSUERS.find((i) => i.name === issuer)!.approval;
  return { p: Math.min(0.985, base + PARAMS.methodApprovalOffset[method]), dip: false };
}

const CARD_DECLINES = [
  { code: "05", reason: "Do not honour", w: 40 },
  { code: "51", reason: "Insufficient funds", w: 35 },
  { code: "54", reason: "Expired card", w: 10 },
  { code: "14", reason: "Invalid card number", w: 5 },
];
const BANK_DECLINES = [
  { code: "USER_CANCELLED", reason: "Payer cancelled in banking app", w: 50 },
  { code: "TIMEOUT", reason: "Payer did not respond in time", w: 30 },
  { code: "INSUFFICIENT_FUNDS", reason: "Insufficient funds", w: 20 },
];

/** Simulates authorization attempts; returns capture time or null. */
function authorize(p: Omit<Payment, "status" | "completedAt">): { completedAt: number | null; lastCode: string } {
  const isCard = p.method === "card" || p.method === "apple_pay";
  let at = p.createdAt + rngAuth.int(2, 15) * 1000;
  let lastCode = "";
  for (let n = 1; n <= PARAMS.retry.maxAttempts; n++) {
    const { p: prob, dip } = approvalProbability(p.method, p.instrument.issuer, at);
    const approved = rngAuth.chance(prob);
    let threeDs = "not_applicable";
    if (p.method === "card" && p.channel !== "in_store") threeDs = rngAuth.chance(0.75) ? "frictionless" : "challenge_passed";
    let responseCode = "00";
    let declineReason: string | null = null;
    if (!approved) {
      if (dip) {
        responseCode = PARAMS.issuerDip.responseCode;
        declineReason = "Issuer or switch inoperative";
      } else if (isCard) {
        if (threeDs === "challenge_passed" && rngAuth.chance(0.12)) {
          threeDs = "challenge_failed";
          responseCode = "65";
          declineReason = "Authentication failed";
        } else {
          const d = CARD_DECLINES[rngAuth.weighted(CARD_DECLINES.map((x) => x.w))]!;
          responseCode = d.code;
          declineReason = d.reason;
        }
      } else {
        const d = BANK_DECLINES[rngAuth.weighted(BANK_DECLINES.map((x) => x.w))]!;
        responseCode = d.code;
        declineReason = d.reason;
      }
    }
    attempts.push({
      id: uniqueId("att_", 10), paymentId: p.id, number: n, issuer: p.instrument.issuer, threeDs,
      responseCode, declineReason, approved, at, day: isoDay(at),
    });
    lastCode = responseCode;
    if (approved) return { completedAt: at + rngAuth.int(1, 8) * 1000, lastCode };
    const retryP = isCard ? (dip ? PARAMS.retry.cardDuringDip : PARAMS.retry.card) : PARAMS.retry.bank;
    if (!rngAuth.chance(retryP)) break;
    at += rngAuth.int(20, 90) * 1000;
  }
  return { completedAt: null, lastCode };
}

function customerTypeAt(c: Customer, at: number): CustomerType {
  return at < c.createdAt + NEW_CUSTOMER_DAYS * DAY_MS ? "New" : "Returning";
}

interface PaymentSpec {
  customer: Customer;
  method: MethodId;
  channel: ChannelId;
  createdAt: number;
  grossCents: number;
  promo: (typeof PROMOTIONS)[number] | undefined;
  usePromo: boolean;
  fraudRing: boolean;
}

function emitPayment(spec: PaymentSpec): Payment {
  const { customer, method, channel, createdAt } = spec;
  const instrument = instrumentFor(customer, method, createdAt, rngPayments);
  let storeId: string | null = null;
  let terminalId: string | null = null;
  if (channel === "in_store") {
    const s = stores[rngPayments.weighted(storeWeights)]!;
    storeId = s.id;
    terminalId = rngPayments.pick(s.terminals);
  }
  let discountCents = 0;
  let promoCode: string | null = null;
  let promotion = NO_PROMOTION;
  if (spec.promo && spec.usePromo) {
    promoCode = spec.promo.code;
    promotion = spec.promo.name;
    discountCents = Math.round((spec.grossCents * spec.promo.discountPct) / 100);
  }
  const base = {
    id: uniqueId("pay_", 10), customer, instrument, method, channel, storeId, terminalId,
    amountCents: spec.grossCents - discountCents, discountCents, promoCode, promotion, createdAt,
    customerType: customerTypeAt(customer, createdAt), fraudRing: spec.fraudRing,
  };
  const { completedAt, lastCode } = authorize(base);
  const status: Payment["status"] = completedAt !== null ? "PaymentComplete" : lastCode === "TIMEOUT" ? "PaymentExpired" : "PaymentFailed";
  const payment: Payment = { ...base, status, completedAt };
  payments.push(payment);
  statusEvents.push({ paymentId: payment.id, status: "PaymentPending", at: createdAt });
  const lastAttempt = attempts[attempts.length - 1]!;
  statusEvents.push({ paymentId: payment.id, status, at: completedAt ?? lastAttempt.at + 2000 });
  return payment;
}

function grossCentsFor(channel: ChannelId, payday: boolean, rng: Rng): number {
  let zar = rng.lognormal(PARAMS.amountMedianZar[channel], PARAMS.amountSigma) * (payday ? PARAMS.payday.amountMultiplier : 1);
  zar = Math.min(60_000, Math.max(50, zar));
  return Math.round(zar / 10) * 10 * 100 - 1; // R449.99-style prices
}

function timeOnDay(day: number, channel: ChannelId, dow: number, rng: Rng): number {
  const hour = rng.weighted(hourProfile(channel, dow));
  const minute = hour === 23 ? rng.int(0, 54) : rng.int(0, 59);
  return day + hour * HOUR_MS + minute * MIN_MS + rng.int(0, 59) * 1000;
}

// --- Daily demand loop -------------------------------------------------------

const spring = PROMOTIONS.find((p) => p.id === "promo_spring")!;
const winter = PROMOTIONS.find((p) => p.id === "promo_winter")!;
const springEndMs = dayMs(spring.end);
let plannedExtraReturning = 0; // expected extra returning purchases in the Spring Sale
let pullForwardTotal = 0;
const pullForwardByDay = new Map<string, number>();

let pool: Customer[] = customers.slice();
for (let day = START_MS; day <= END_DAY_MS; day += DAY_MS) {
  const date = new Date(day);
  const dow = date.getUTCDay();
  const dom = date.getUTCDate();
  const monthIdx = date.getUTCMonth() - 3;
  const daysInMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
  const isPayday = dom === PARAMS.payday.day;
  let lam = PARAMS.baseRequestsPerDay * (1 + PARAMS.monthlyGrowth * monthIdx) * PARAMS.weekday[dow]!;
  lam *= PARAMS.payday.multipliers[dom] ?? 1;
  if (dom === daysInMonth) lam *= PARAMS.monthEndMultiplier;
  let lamNew = lam * PARAMS.newCustomerShare;
  const lamRetBase = lam * (1 - PARAMS.newCustomerShare);
  let lamRet = lamRetBase;
  const promo = promoOn(day);
  if (promo?.id === spring.id) {
    lamNew *= PARAMS.promo.spring.newMultiplier;
    lamRet *= PARAMS.promo.spring.returningMultiplier;
    plannedExtraReturning += lamRet - lamRetBase;
  } else if (promo?.id === winter.id) {
    lamNew *= PARAMS.promo.winter.newMultiplier;
    lamRet *= PARAMS.promo.winter.returningMultiplier;
  }
  // Pull-forward: regulars who bought early in the Spring Sale don't buy in the following days.
  const k = Math.round((day - springEndMs) / DAY_MS) - 1;
  if (k >= 0 && k < PARAMS.promo.spring.pullForwardDays) {
    if (k === 0) pullForwardTotal = PARAMS.promo.spring.pullForwardShare * plannedExtraReturning;
    const weights = Array.from({ length: PARAMS.promo.spring.pullForwardDays }, (_, i) => PARAMS.promo.spring.pullForwardDecay ** i);
    const wsum = weights.reduce((a, b) => a + b, 0);
    const reduction = (pullForwardTotal * weights[k]!) / wsum;
    pullForwardByDay.set(isoDay(day), reduction);
    lamRet = Math.max(0, lamRet - reduction);
  }

  const nNew = rngDemand.poisson(lamNew);
  const nRet = rngDemand.poisson(lamRet);
  const cumulative: number[] = [];
  let acc = 0;
  for (const c of pool) {
    acc += c.weight;
    cumulative.push(acc);
  }
  const mix = methodMixAt(day + 12 * HOUR_MS);
  const createdToday: Customer[] = [];
  const codeUsage = promo?.id === spring.id ? PARAMS.promo.spring.codeUsage : PARAMS.promo.winter.codeUsage;
  for (let i = 0; i < nNew + nRet; i++) {
    const method = METHODS[rngPayments.weighted(mix)]!.id;
    const cw = PARAMS.channelByMethod[method];
    const channel = (["online", "app", "in_store"] as const)[rngPayments.weighted([cw.online, cw.app, cw.in_store])]!;
    const at = timeOnDay(day, channel, dow, rngPayments);
    let customer: Customer;
    if (i < nNew) {
      customer = newCustomer(at - rngCustomers.int(1, 20) * MIN_MS, rngCustomers);
      createdToday.push(customer);
    } else {
      const r = rngCustomers.next() * acc;
      let lo = 0;
      let hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (cumulative[mid]! < r) lo = mid + 1;
        else hi = mid;
      }
      customer = pool[lo]!;
    }
    emitPayment({
      customer, method, channel, createdAt: at, grossCents: grossCentsFor(channel, isPayday, rngPayments),
      promo, usePromo: promo !== undefined && rngPayments.chance(codeUsage), fraudRing: false,
    });
  }
  pool = pool.concat(createdToday);
}

// --- Chargeback ring: a few cards reused across newly created accounts -------

const ringParams = PARAMS.chargebackRing;
const ringCards: { fingerprint: string; issuer: string; scheme: string; bin: string; accounts: Customer[] }[] = [];
for (let j = 0; j < ringParams.cards; j++) {
  const issuerIdx = rngRing.weighted(issuerShares);
  const scheme = rngRing.chance(0.6) ? "visa" : "mastercard";
  ringCards.push({
    fingerprint: uniqueHex("fp_", 8),
    issuer: ISSUERS[issuerIdx]!.name,
    scheme,
    bin: binFor(scheme, rngRing),
    accounts: [],
  });
}
for (const [j, card] of ringCards.entries()) {
  const burstStart = dayMs(ringParams.firstBurst) + j * ringParams.burstSpacingDays * DAY_MS;
  const nAccounts = rngRing.int(ringParams.accountsPerCard[0], ringParams.accountsPerCard[1]);
  for (let a = 0; a < nAccounts; a++) {
    const createdAt = burstStart + rngRing.int(0, ringParams.burstLengthDays - 1) * DAY_MS + rngRing.int(8, 22) * HOUR_MS + rngRing.int(0, 59) * MIN_MS;
    const c = newCustomer(createdAt, rngRing);
    c.fingerprint = card.fingerprint;
    c.cardIssuerIdx = ISSUERS.findIndex((i) => i.name === card.issuer);
    card.accounts.push(c);
    const nPayments = rngRing.int(ringParams.paymentsPerAccount[0], ringParams.paymentsPerAccount[1]);
    for (let n = 0; n < nPayments; n++) {
      const at = createdAt + rngRing.int(0, 9) * DAY_MS + rngRing.int(5, 120) * MIN_MS;
      if (at > END_MS - 10 * MIN_MS) continue;
      const zar = rngRing.int(ringParams.amountZar[0], ringParams.amountZar[1]);
      emitPayment({
        customer: c, method: "card", channel: rngRing.chance(0.75) ? "online" : "app", createdAt: at,
        grossCents: (Math.round(zar / 100) * 100 - 1) * 100, promo: undefined, usePromo: false, fraudRing: true,
      });
    }
  }
}

// --- Refunds and disputes -----------------------------------------------------

const DISPUTE_REASONS = [
  { code: "10.4", reason: "Fraud: card-absent environment", w: 30 },
  { code: "13.1", reason: "Merchandise not received", w: 30 },
  { code: "13.3", reason: "Not as described", w: 25 },
  { code: "12.6", reason: "Duplicate processing", w: 15 },
];
const REFUND_REASONS = ["customer_return", "damaged_item", "wrong_size", "duplicate_order", "other"];
const disputeByPayment = new Map<string, Dispute>();

for (const p of payments) {
  if (p.completedAt === null) continue;
  const isCard = p.method === "card" || p.method === "apple_pay";
  // Disputes first, so a later refund request on a disputed payment is declined.
  let disputeP = 0;
  if (p.fraudRing) disputeP = ringParams.disputeProbability;
  else if (p.method === "card") disputeP = p.channel === "in_store" ? PARAMS.dispute.cardInStore : PARAMS.dispute.cardRemote;
  else if (p.method === "apple_pay") disputeP = PARAMS.dispute.applePay;
  if (isCard && rngAfter.chance(disputeP)) {
    const delayDays = p.fraudRing ? rngAfter.int(ringParams.disputeDelayDays[0], ringParams.disputeDelayDays[1]) : rngAfter.int(7, 60);
    const receivedAt = p.completedAt + delayDays * DAY_MS + rngAfter.int(0, 600) * MIN_MS;
    if (receivedAt <= END_MS) {
      const r = p.fraudRing ? DISPUTE_REASONS[0]! : DISPUTE_REASONS[rngAfter.weighted(DISPUTE_REASONS.map((x) => x.w))]!;
      const recent = receivedAt > END_MS - 20 * DAY_MS;
      const d: Dispute = {
        id: uniqueId("dsp_", 10), payment: p, reasonCode: r.code, reason: r.reason, amountCents: p.amountCents, receivedAt,
        outcome: recent ? "pending" : p.fraudRing ? "lost" : rngAfter.chance(0.45) ? "won" : "lost",
      };
      disputes.push(d);
      disputeByPayment.set(p.id, d);
    }
  }
  if (!p.fraudRing && rngAfter.chance(PARAMS.refund.probability[p.channel])) {
    const requestedAt = p.completedAt + rngAfter.int(2, 25) * DAY_MS + rngAfter.int(0, 600) * MIN_MS;
    if (requestedAt > END_MS) continue;
    const full = rngAfter.chance(PARAMS.refund.fullShare);
    const amountCents = full ? p.amountCents : Math.max(100, Math.round((p.amountCents * rngAfter.int(20, 80)) / 100));
    const dispute = disputeByPayment.get(p.id);
    let status: Refund["status"];
    let completedAt: number | null = requestedAt + rngAfter.int(1, 3) * DAY_MS + rngAfter.int(0, 300) * MIN_MS;
    if (dispute && dispute.receivedAt < requestedAt) {
      status = "RefundDeclined";
      completedAt = null;
    } else if (completedAt > END_MS) {
      status = "RefundPending";
      completedAt = null;
    } else status = "RefundCompleted";
    refunds.push({
      id: uniqueId("ref_", 10), payment: p, amountCents, reason: rngAfter.pick(REFUND_REASONS),
      initialStatus: isCard ? "TransactionPending" : "RefundPending", status, requestedAt, completedAt,
    });
  }
}

// ---------------------------------------------------------------------------
// Answer key: tallied from the generated rows in plain JS.
// ---------------------------------------------------------------------------

const cents = (c: number) => c / 100;
const captured = payments.filter((p) => p.completedAt !== null);
const attemptPayment = new Map(payments.map((p) => [p.id, p]));

interface Window { start: string; end: string }
const boundsCache = new WeakMap<Window, { s: number; e: number }>();
const inWindow = (ms: number | null, w: Window) => {
  if (ms === null) return false;
  let b = boundsCache.get(w);
  if (!b) {
    b = { s: dayMs(w.start), e: dayMs(w.end) + DAY_MS };
    boundsCache.set(w, b);
  }
  return ms >= b.s && ms < b.e;
};

function aggregate(w: Window) {
  let capturedCents = 0;
  let paymentCount = 0;
  const custs = new Set<string>();
  for (const p of captured) {
    if (!inWindow(p.completedAt, w)) continue;
    capturedCents += p.amountCents;
    paymentCount++;
    custs.add(p.customer.id);
  }
  let att = 0;
  let appr = 0;
  for (const a of attempts) {
    if (!inWindow(a.at, w)) continue;
    att++;
    if (a.approved) appr++;
  }
  let refundCents = 0;
  for (const r of refunds) if (r.status === "RefundCompleted" && inWindow(r.completedAt, w)) refundCents += r.amountCents;
  let chargebacks = 0;
  for (const d of disputes) if (inWindow(d.receivedAt, w)) chargebacks++;
  return {
    window: w,
    capturedValue: cents(capturedCents),
    capturedCents,
    paymentCount,
    averageTransactionValue: paymentCount ? cents(capturedCents) / paymentCount : null,
    uniqueCustomers: custs.size,
    attempts: att,
    approved: appr,
    approvalRate: att ? appr / att : null,
    refundedValue: cents(refundCents),
    refundRate: capturedCents ? refundCents / capturedCents : null,
    chargebacks,
    chargebackRate: paymentCount ? chargebacks / paymentCount : null,
  };
}

const shiftDays = (iso: string, n: number) => isoDay(dayMs(iso) + n * DAY_MS);
// Preset windows written out by plain date arithmetic, independent of src/core.
const presetWindows: Record<string, Window> = {
  today: { start: AS_OF, end: AS_OF },
  yesterday: { start: shiftDays(AS_OF, -1), end: shiftDays(AS_OF, -1) },
  last_7_days: { start: shiftDays(AS_OF, -6), end: AS_OF },
  month_to_date: { start: `${AS_OF.slice(0, 7)}-01`, end: AS_OF },
  last_month: { start: "2026-08-01", end: "2026-08-31" },
  last_90_days: { start: shiftDays(AS_OF, -89), end: AS_OF },
  last_6_months: { start: DATA_START, end: AS_OF },
};

const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const monthWindow = (m: string): Window => {
  const start = `${m}-01`;
  const end = isoDay(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0));
  return { start, end };
};

const daily: ReturnType<typeof aggregate>[] = [];
for (let day = START_MS; day <= END_DAY_MS; day += DAY_MS) daily.push(aggregate({ start: isoDay(day), end: isoDay(day) }));

// Method value share by month (scenario: wallets overtaking card).
const methodShareByMonth = months.map((m) => {
  const w = monthWindow(m);
  const byMethod: Record<string, number> = {};
  let total = 0;
  for (const p of captured) {
    if (!inWindow(p.completedAt, w)) continue;
    const label = METHODS.find((x) => x.id === p.method)!.label;
    byMethod[label] = (byMethod[label] ?? 0) + p.amountCents;
    total += p.amountCents;
  }
  const shares: Record<string, number> = {};
  const values: Record<string, number> = {};
  for (const [k, v] of Object.entries(byMethod)) {
    shares[k] = v / total;
    values[k] = cents(v);
  }
  return { month: m, shares, values, total: cents(total) };
});
const crossover = methodShareByMonth.find((m) => (m.shares["Apple Pay"] ?? 0) > (m.shares["Card"] ?? 0));

// Promo scenario: captured value by promotion x customer type, Aug vs Sep.
function segments(w: Window) {
  const seg = new Map<string, { promotion: string; customerType: CustomerType; cents: number; count: number }>();
  for (const p of captured) {
    if (!inWindow(p.completedAt, w)) continue;
    const key = `${p.promotion} · ${p.customerType}`;
    const s = seg.get(key) ?? { promotion: p.promotion, customerType: p.customerType, cents: 0, count: 0 };
    s.cents += p.amountCents;
    s.count++;
    seg.set(key, s);
  }
  return seg;
}
const augSeg = segments(monthWindow("2026-08"));
const sepSeg = segments(monthWindow("2026-09"));
const segKeys = [...new Set([...augSeg.keys(), ...sepSeg.keys()])].sort();
const promoSegments = segKeys.map((key) => {
  const a = augSeg.get(key);
  const s = sepSeg.get(key);
  const ref = (s ?? a)!;
  return {
    key, promotion: ref.promotion, customerType: ref.customerType,
    previousValue: cents(a?.cents ?? 0), currentValue: cents(s?.cents ?? 0),
    deltaCents: (s?.cents ?? 0) - (a?.cents ?? 0), delta: cents((s?.cents ?? 0) - (a?.cents ?? 0)),
    previousCount: a?.count ?? 0, currentCount: s?.count ?? 0,
  };
});
const augAgg = aggregate(monthWindow("2026-08"));
const sepAgg = aggregate(monthWindow("2026-09"));
// Returning, non-promo captured value in the 13 days after the sale vs the 13 days before it.
const postWindow = { start: shiftDays(spring.end, 1), end: shiftDays(spring.end, PARAMS.promo.spring.pullForwardDays) };
const sameDatesLastMonth = { start: shiftDays(postWindow.start, -31), end: shiftDays(postWindow.end, -31) };
const returningNonPromo = (w: Window) => {
  let c = 0;
  let n = 0;
  for (const p of captured) if (inWindow(p.completedAt, w) && p.customerType === "Returning" && p.promotion === NO_PROMOTION) {
    c += p.amountCents;
    n++;
  }
  return { value: cents(c), count: n };
};

// Issuer dip scenario.
const dip = PARAMS.issuerDip;
function issuerRates(filter: (a: Attempt) => boolean) {
  const m = new Map<string, { attempts: number; approved: number }>();
  for (const a of attempts) {
    if (a.issuer === null || !filter(a)) continue;
    const s = m.get(a.issuer) ?? { attempts: 0, approved: 0 };
    s.attempts++;
    if (a.approved) s.approved++;
    m.set(a.issuer, s);
  }
  return [...m.entries()]
    .map(([issuer, s]) => ({ issuer, ...s, rate: s.approved / s.attempts }))
    .sort((x, y) => x.rate - y.rate);
}
const hourOf = (ms: number) => new Date(ms).getUTCHours();
const dipDayRanking = issuerRates((a) => a.day === dip.date);
const dipDayAttempts = attempts.filter((a) => a.day === dip.date);
const dipHourly = Array.from({ length: 24 }, (_, h) => {
  const forIssuer = { attempts: 0, approved: 0 };
  const others = { attempts: 0, approved: 0 };
  const all = { attempts: 0, approved: 0 };
  for (const a of dipDayAttempts) {
    if (hourOf(a.at) !== h) continue;
    all.attempts++;
    if (a.approved) all.approved++;
    if (a.issuer === null) continue;
    const t = a.issuer === dip.issuer ? forIssuer : others;
    t.attempts++;
    if (a.approved) t.approved++;
  }
  const rate = (s: { attempts: number; approved: number }) => (s.attempts ? s.approved / s.attempts : null);
  return { hour: h, issuer: { ...forIssuer, rate: rate(forIssuer) }, otherIssuers: { ...others, rate: rate(others) }, all: { ...all, rate: rate(all) } };
});
const windowAttempts = (date: string) => {
  let att = 0;
  let appr = 0;
  for (const a of attempts) {
    if (a.issuer !== dip.issuer || a.day !== date) continue;
    const h = hourOf(a.at);
    if (h < dip.startHour || h >= dip.endHour) continue;
    att++;
    if (a.approved) appr++;
  }
  return { date, attempts: att, approved: appr, rate: att ? appr / att : null };
};
const previousSaturdays = [7, 14, 21].map((n) => windowAttempts(shiftDays(dip.date, -n)));
const last90 = presetWindows.last_90_days!;
const issuerRankingLast90 = issuerRates((a) => inWindow(a.at, last90));

// Chargeback ring scenario.
const cardStats = new Map<string, { captured: number; chargebacks: number; accounts: Set<string> }>();
for (const p of captured) {
  if (!p.instrument.fingerprint || !inWindow(p.completedAt, last90)) continue;
  const s = cardStats.get(p.instrument.fingerprint) ?? { captured: 0, chargebacks: 0, accounts: new Set<string>() };
  s.captured++;
  s.accounts.add(p.customer.id);
  cardStats.set(p.instrument.fingerprint, s);
}
for (const d of disputes) {
  const fp = d.payment.instrument.fingerprint;
  if (!fp || !inWindow(d.receivedAt, last90)) continue;
  const s = cardStats.get(fp) ?? { captured: 0, chargebacks: 0, accounts: new Set<string>() };
  s.chargebacks++;
  cardStats.set(fp, s);
}
const cardRankingLast90 = [...cardStats.entries()]
  .filter(([, s]) => s.captured >= PARAMS.rankingMinSupport)
  .map(([fingerprint, s]) => ({ fingerprint, captured: s.captured, chargebacks: s.chargebacks, rate: s.chargebacks / s.captured }))
  .sort((a, b) => b.rate - a.rate || b.chargebacks - a.chargebacks || a.fingerprint.localeCompare(b.fingerprint))
  .slice(0, 10);
const ringSummary = ringCards.map((card) => {
  const ps = captured.filter((p) => p.instrument.fingerprint === card.fingerprint);
  const ds = disputes.filter((d) => d.payment.instrument.fingerprint === card.fingerprint);
  return {
    fingerprint: card.fingerprint, issuer: card.issuer, scheme: card.scheme, accounts: card.accounts.length,
    accountIds: card.accounts.map((a) => a.id),
    capturedPayments: ps.length, chargebacks: ds.length,
    disputeIds: ds.sort((a, b) => b.receivedAt - a.receivedAt).map((d) => d.id),
  };
});
const ringChargebacksLast90 = disputes.filter((d) => d.payment.fraudRing && inWindow(d.receivedAt, last90)).length;
const allChargebacksLast90 = disputes.filter((d) => inWindow(d.receivedAt, last90)).length;
const topRingCard = [...ringSummary].sort((a, b) => b.chargebacks - a.chargebacks || a.fingerprint.localeCompare(b.fingerprint))[0]!;

// Record listing: last three captured payments of the most active customer.
const paymentsByCustomer = new Map<string, Payment[]>();
for (const p of captured) {
  const list = paymentsByCustomer.get(p.customer.id) ?? [];
  list.push(p);
  paymentsByCustomer.set(p.customer.id, list);
}
const [sampleCustomerId, samplePayments] = [...paymentsByCustomer.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))[0]!;
const lastThree = [...samplePayments].sort((a, b) => b.completedAt! - a.completedAt!).slice(0, 3);

// Payday scenario.
const dailyValue = (d: string) => daily.find((x) => x.window.start === d)!.capturedValue;
const paydayByMonth = months.map((m) => {
  const w = monthWindow(m);
  const days = daily.filter((d) => d.window.start >= w.start && d.window.end <= w.end);
  const sorted = [...days].sort((a, b) => b.capturedValue - a.capturedValue);
  return { month: m, paydayValue: dailyValue(`${m}-25`), peakDay: sorted[0]!.window.start, peakValue: sorted[0]!.capturedValue };
});

const scenarios = {
  meta: {
    seed,
    merchant: MERCHANT.name,
    dataStart: DATA_START,
    dataEnd: DATA_END,
    asOf: AS_OF,
    note: "Synthetic data. Answer key tallied by scripts/generate.ts from generated rows, independent of the semantic views.",
    counts: {
      customers: customers.length, instruments: instruments.length, paymentRequests: payments.length,
      capturedPayments: captured.length, authorizationAttempts: attempts.length, refunds: refunds.length, disputes: disputes.length,
    },
  },
  params: PARAMS,
  presetWindows,
  windows: Object.fromEntries(Object.entries(presetWindows).map(([k, w]) => [k, aggregate(w)])),
  months: months.map((m) => ({ month: m, ...aggregate(monthWindow(m)) })),
  daily,
  scenarios: {
    promo: {
      title: "Mid-month promo, part of the lift from regulars buying early",
      tests: ["explain_change", "waterfall"],
      planted: {
        promotion: spring.name, code: spring.code, start: spring.start, end: spring.end, discountPct: spring.discountPct,
        expectedExtraReturningPurchases: plannedExtraReturning, expectedPulledForwardPurchases: pullForwardTotal,
        pullForwardWindow: postWindow,
      },
      answer: {
        current: monthWindow("2026-09"),
        comparison: monthWindow("2026-08"),
        previousValue: augAgg.capturedValue,
        currentValue: sepAgg.capturedValue,
        change: cents(sepAgg.capturedCents - augAgg.capturedCents),
        changeCents: sepAgg.capturedCents - augAgg.capturedCents,
        segments: promoSegments,
        // Pull-forward evidence: returning, non-promo purchases in the 13 days after the sale
        // against the same dates of August (both windows include payday on the 25th).
        returningNonPromoAfterSale: { window: postWindow, ...returningNonPromo(postWindow) },
        returningNonPromoSameDatesAugust: { window: sameDatesLastMonth, ...returningNonPromo(sameDatesLastMonth) },
      },
    },
    issuer_dip: {
      title: "One issuer's approval rate dips on a Saturday afternoon",
      tests: ["trend", "ranking"],
      planted: dip,
      answer: {
        dayRanking: dipDayRanking,
        lowestIssuerOnDay: dipDayRanking[0]!.issuer,
        hourly: dipHourly,
        dipWindow: windowAttempts(dip.date),
        previousSaturdaysWindow: previousSaturdays,
        last90Ranking: issuerRankingLast90,
      },
    },
    chargeback_ring: {
      title: "Chargebacks concentrated in a few cards reused across new accounts",
      tests: ["ranking", "record_listing"],
      planted: { ...ringParams, fingerprints: ringCards.map((c) => c.fingerprint) },
      answer: {
        cards: ringSummary,
        topCard: topRingCard,
        rankingLast90: cardRankingLast90,
        ringChargebacksLast90,
        allChargebacksLast90,
      },
    },
    wallet_shift: {
      title: "Wallets overtaking card, Capitec Pay growing",
      tests: ["breakdown", "stacked_100"],
      planted: { methodMix: PARAMS.methodMix },
      answer: { monthly: methodShareByMonth, applePayOvertakesCardIn: crossover?.month ?? null },
    },
    payday: {
      title: "Payday spike on the 25th",
      tests: ["trend", "compare"],
      planted: PARAMS.payday,
      answer: {
        byMonth: paydayByMonth,
        september: daily.filter((d) => d.window.start.startsWith("2026-09")).map((d) => ({ date: d.window.start, value: d.capturedValue })),
        august: daily.filter((d) => d.window.start.startsWith("2026-08")).map((d) => ({ date: d.window.start, value: d.capturedValue })),
        sep25: dailyValue("2026-09-25"),
        sep24: dailyValue("2026-09-24"),
      },
    },
    out_of_scope: {
      title: "\"Which customer will default?\"",
      tests: ["out_of_scope", "text"],
      planted: { question: "Which customer will default?" },
      answer: { intent: "out_of_scope", form: "text", queries: 0 },
    },
  },
  records: {
    sampleCustomer: {
      customerId: sampleCustomerId,
      capturedPayments: samplePayments.length,
      lastThree: lastThree.map((p) => ({ paymentId: p.id, capturedAt: new Date(p.completedAt!).toISOString().slice(0, 19).replace("T", " "), amount: cents(p.amountCents), method: METHODS.find((m) => m.id === p.method)!.label })),
    },
  },
};

// ---------------------------------------------------------------------------
// Write DuckDB
// ---------------------------------------------------------------------------

const ts = (ms: number | null) => (ms === null ? null : new Date(ms));

async function main() {
  const dbPath = resolvedDuckdbPath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  for (const f of [dbPath, `${dbPath}.wal`]) {
    try {
      fs.rmSync(f, { force: true });
    } catch (e) {
      throw new Error(`Cannot replace ${f}. Is \`pnpm dev\` still running? (${(e as Error).message})`);
    }
  }
  const instance = await DuckDBInstance.create(dbPath);
  const conn = await instance.connect();
  const sqlDir = path.join(process.cwd(), "src", "adapters", "stitch");
  await conn.run(fs.readFileSync(path.join(sqlDir, "schema.sql"), "utf8"));

  async function append(table: string, rows: Iterable<unknown[]>) {
    const appender = await conn.createAppender(table);
    const writer = DuckDBDataChunkWriter.forAppender(appender, { converter: JSToDuckDBValueConverter });
    let n = 0;
    for (const row of rows) {
      writer.appendRow(row as never);
      n++;
    }
    writer.flush();
    appender.closeSync();
    console.log(`  ${table.padEnd(24)} ${n.toLocaleString("en-US")} rows`);
  }

  console.log(`Writing ${path.relative(process.cwd(), dbPath)}`);
  await append("merchants", [[MERCHANT.id, MERCHANT.name, MERCHANT.description, MERCHANT.currency, "ZA"]]);
  await append("stores", stores.map((s) => [s.id, MERCHANT.id, s.name, s.city, s.province]));
  await append("terminals", stores.flatMap((s) => s.terminals.map((t) => [t, s.id])));
  await append("customers", customers.map((c) => [c.id, MERCHANT.id, ts(c.createdAt)]));
  await append("instruments", instruments.map((i) => [i.id, i.customerId, i.type, i.method, i.fingerprint, i.bin, i.scheme, i.issuer, i.accountToken, ts(i.createdAt)]));
  await append("promotions", PROMOTIONS.map((p) => [p.id, p.name, p.code, ts(dayMs(p.start)), ts(dayMs(p.end) + DAY_MS - 1000), p.discountPct]));
  await append("payment_requests", payments.map((p) => [
    p.id, MERCHANT.id, p.customer.id, p.instrument.id, p.method, p.channel, p.storeId, p.terminalId, p.amountCents,
    MERCHANT.currency, p.status, p.promoCode, p.discountCents, ts(p.createdAt), ts(p.completedAt),
  ]));
  await append("payment_status_events", statusEvents.map((e) => [e.paymentId, e.status, ts(e.at)]));
  await append("authorization_attempts", attempts.map((a) => [a.id, a.paymentId, a.number, a.issuer, a.threeDs, a.responseCode, a.declineReason, a.approved, ts(a.at)]));
  await append("refunds", refunds.map((r) => [r.id, r.payment.id, r.amountCents, r.reason, r.initialStatus, r.status, ts(r.requestedAt), ts(r.completedAt)]));
  await append("disputes", disputes.map((d) => [d.id, d.payment.id, d.reasonCode, d.reason, d.amountCents, ts(d.receivedAt), d.outcome]));
  await append("dataset_meta", [
    ["merchant", MERCHANT.name], ["data_start", DATA_START], ["data_end", DATA_END], ["as_of", AS_OF], ["seed", String(seed)],
    ["synthetic", "true"],
  ]);

  const views = fs.readFileSync(path.join(sqlDir, "views.sql"), "utf8")
    .replaceAll("{{DATA_START}}", DATA_START)
    .replaceAll("{{DATA_END_EXCLUSIVE}}", isoDay(END_DAY_MS + DAY_MS));
  await conn.run(views);
  await conn.run("CHECKPOINT");
  conn.closeSync();
  instance.closeSync();

  const scenariosPath = path.join(path.dirname(dbPath), "scenarios.json");
  fs.writeFileSync(scenariosPath, `${JSON.stringify(scenarios, null, 2)}\n`);
  console.log(`Wrote ${path.relative(process.cwd(), scenariosPath)}`);
  console.log(
    `Planted: promo ${spring.name}, ${dip.issuer} dip on ${dip.date}, ${ringCards.length} ring cards, ` +
      `Apple Pay overtakes card in ${crossover?.month ?? "never"}, payday on the 25th.`,
  );
  void attemptPayment;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
