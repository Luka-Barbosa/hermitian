import fs from "node:fs";
import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";

export type Row = Record<string, string | number | boolean | null>;

const INTEGER_TYPES = new Set(["TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "UTINYINT", "USMALLINT", "UINTEGER", "UBIGINT", "UHUGEINT"]);

interface Handle {
  instance: DuckDBInstance;
  connection: DuckDBConnection;
}

// Survives Next.js dev reloads so we hold one read-only handle per file.
const globalHandles = globalThis as unknown as { __hermitianDuckdb?: Map<string, Promise<Handle>> };
const handles = (globalHandles.__hermitianDuckdb ??= new Map());

/**
 * Opens the database read-only. This is the only way the app touches DuckDB;
 * scripts/generate.ts is the only writer.
 */
export async function openReadOnly(dbPath: string): Promise<DuckDBConnection> {
  let handle = handles.get(dbPath);
  if (!handle) {
    if (!fs.existsSync(dbPath)) throw new Error(`Database not found at ${dbPath}. Run \`pnpm generate\` first.`);
    handle = (async () => {
      const instance = await DuckDBInstance.create(dbPath, { access_mode: "READ_ONLY" });
      return { instance, connection: await instance.connect() };
    })();
    handles.set(dbPath, handle);
    handle.catch(() => handles.delete(dbPath));
  }
  return (await handle).connection;
}

/** Runs SQL and returns plain rows: integers as numbers, timestamps as 'YYYY-MM-DD HH:MM:SS'. */
export async function queryRows(conn: DuckDBConnection, sql: string, params: Record<string, string | number | boolean> = {}): Promise<Row[]> {
  const reader = Object.keys(params).length ? await conn.runAndReadAll(sql, params) : await conn.runAndReadAll(sql);
  const names = reader.columnNames();
  const integer = reader.columnTypes().map((t) => INTEGER_TYPES.has(t.toString()));
  return reader.getRowObjectsJson().map((raw) => {
    const row: Row = {};
    names.forEach((name, i) => {
      const v = raw[name];
      if (v === null || v === undefined) row[name] = null;
      else if (integer[i]) row[name] = Number(v);
      else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") row[name] = v;
      else row[name] = JSON.stringify(v);
    });
    return row;
  });
}
