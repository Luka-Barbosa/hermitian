/**
 * Fixed facts about the fictional merchant and its synthetic data. Shared by the
 * generator (scripts/generate.ts) and the catalog, so the options the agent can
 * choose from never drift from what the data contains. Every name is invented.
 */

export const MERCHANT = {
  id: "mer_kloofmere",
  name: "Kloofmere",
  description: "Fictional omnichannel fashion and homeware retailer (South Africa)",
  currency: "ZAR",
} as const;

/** Dataset window, inclusive. "Today" for period presets is DATA_END. */
export const DATA_START = "2026-04-01";
export const DATA_END = "2026-09-30";
export const AS_OF = DATA_END;

export const METHODS = [
  { id: "card", label: "Card" },
  { id: "apple_pay", label: "Apple Pay" },
  { id: "pay_by_bank", label: "Pay by Bank" },
  { id: "capitec_pay", label: "Capitec Pay" },
  { id: "payshap", label: "PayShap Request" },
] as const;
export type MethodId = (typeof METHODS)[number]["id"];

export const CHANNELS = [
  { id: "online", label: "Online" },
  { id: "app", label: "App" },
  { id: "in_store", label: "In-store" },
] as const;
export type ChannelId = (typeof CHANNELS)[number]["id"];

/** Fictional issuing banks. Base approval is per authorization attempt. */
export const ISSUERS = [
  { name: "Karoo Bank", share: 0.2, approval: 0.915 },
  { name: "Protea Bank", share: 0.18, approval: 0.935 },
  { name: "Highveld Bank", share: 0.16, approval: 0.925 },
  { name: "Fynbos Bank", share: 0.12, approval: 0.92 },
  { name: "Aloe Bank", share: 0.1, approval: 0.91 },
  { name: "Kestrel Bank", share: 0.09, approval: 0.905 },
  { name: "Marula Bank", share: 0.08, approval: 0.93 },
  { name: "Quagga Bank", share: 0.07, approval: 0.895 },
] as const;

/** Store locations are place names; the stores themselves are fictional. */
export const STORE_LOCATIONS = [
  ["Rosebank", "Gauteng"], ["Sandton", "Gauteng"], ["Melrose", "Gauteng"], ["Fourways", "Gauteng"],
  ["Menlyn", "Gauteng"], ["Brooklyn", "Gauteng"], ["Centurion", "Gauteng"], ["Midrand", "Gauteng"],
  ["Bedfordview", "Gauteng"], ["Randburg", "Gauteng"], ["Soweto", "Gauteng"], ["Benoni", "Gauteng"],
  ["Boksburg", "Gauteng"], ["Krugersdorp", "Gauteng"], ["Polokwane", "Limpopo"], ["Mbombela", "Mpumalanga"],
  ["Rustenburg", "North West"], ["Bloemfontein", "Free State"], ["Kimberley", "Northern Cape"], ["Gqeberha", "Eastern Cape"],
  ["East London", "Eastern Cape"], ["Mthatha", "Eastern Cape"], ["George", "Western Cape"], ["Knysna", "Western Cape"],
  ["Stellenbosch", "Western Cape"], ["Paarl", "Western Cape"], ["Somerset West", "Western Cape"], ["Claremont", "Western Cape"],
  ["Sea Point", "Western Cape"], ["Century City", "Western Cape"], ["Durbanville", "Western Cape"], ["Bellville", "Western Cape"],
  ["Umhlanga", "KwaZulu-Natal"], ["Ballito", "KwaZulu-Natal"], ["Durban North", "KwaZulu-Natal"], ["Westville", "KwaZulu-Natal"],
  ["Pinetown", "KwaZulu-Natal"], ["Pietermaritzburg", "KwaZulu-Natal"], ["Richards Bay", "KwaZulu-Natal"], ["Newcastle", "KwaZulu-Natal"],
] as const;

export const PROMOTIONS = [
  { id: "promo_winter", name: "Winter Warmers", code: "WARM15", start: "2026-06-12", end: "2026-06-14", discountPct: 15 },
  { id: "promo_spring", name: "Spring Sale", code: "SPRING20", start: "2026-09-11", end: "2026-09-17", discountPct: 20 },
] as const;

export const NO_PROMOTION = "No promotion";

/** A payment counts as from a new customer within this many days of account creation. */
export const NEW_CUSTOMER_DAYS = 30;
