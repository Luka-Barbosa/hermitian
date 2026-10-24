import type { DuckDBConnection } from "@duckdb/node-api";
import { lit } from "../../core/query/builder";
import { queryRows } from "./db";

/** Adapter-specific lookups. Metric SQL is built by core from catalog.ts. */

const ENTITY_LOOKUPS: Record<string, { view: string; column: string }> = {
  card: { view: "v_captured_payments", column: "card_fingerprint" },
  customer: { view: "v_captured_payments", column: "customer_id" },
  payment: { view: "v_captured_payments", column: "payment_id" },
};

export async function entityExists(conn: DuckDBConnection, dimensionId: string, value: string): Promise<boolean> {
  const lookup = ENTITY_LOOKUPS[dimensionId];
  if (!lookup) return false;
  const rows = await queryRows(conn, `SELECT 1 AS hit FROM ${lookup.view} WHERE ${lookup.column} = ${lit(value)} LIMIT 1`);
  return rows.length > 0;
}

export async function viewFields(conn: DuckDBConnection, views: string[]): Promise<Record<string, string[]>> {
  const rows = await queryRows(
    conn,
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_name IN (${views.map(lit).join(", ")}) ORDER BY table_name, ordinal_position`,
  );
  const out: Record<string, string[]> = Object.fromEntries(views.map((v) => [v, [] as string[]]));
  for (const r of rows) out[String(r.table_name)]!.push(String(r.column_name));
  return out;
}
