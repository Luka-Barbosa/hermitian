import type { Catalog } from "./catalog";

export type Row = Record<string, string | number | boolean | null>;

/**
 * Every data source implements this. Core builds SQL from the catalog and
 * hands it to `query`; the adapter only executes it, read-only, against its
 * semantic views. A second data source becomes a second implementation.
 */
export interface DataAdapter {
  id: string;
  catalog: Catalog;
  /** Runs one read-only SQL statement over the semantic views. */
  query(sql: string): Promise<Row[]>;
  /** Field names per semantic view, read from the database (gate 1). */
  viewFields(): Promise<Record<string, string[]>>;
  /** Whether an entity ID (customer, card, payment) exists (gate 1). */
  entityExists(dimensionId: string, value: string): Promise<boolean>;
}
