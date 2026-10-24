import type { DataAdapter } from "../../core/adapter";
import { stitchCatalog } from "./catalog";
import { openReadOnly, queryRows } from "./db";
import { entityExists, viewFields } from "./queries";

/** The Stitch-shaped merchant adapter over the synthetic DuckDB file. */
export function createStitchAdapter(dbPath: string): DataAdapter {
  let fields: Promise<Record<string, string[]>> | undefined;
  return {
    id: "stitch",
    catalog: stitchCatalog,
    async query(sql) {
      return queryRows(await openReadOnly(dbPath), sql);
    },
    async viewFields() {
      fields ??= openReadOnly(dbPath).then((c) => viewFields(c, Object.keys(stitchCatalog.views)));
      return fields;
    },
    async entityExists(dimensionId, value) {
      return entityExists(await openReadOnly(dbPath), dimensionId, value);
    },
  };
}
