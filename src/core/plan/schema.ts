import { z } from "zod";
import { GRAINS, INTENTS, PERIOD_PRESETS } from "../types";

/** The typed query plan. System 1 answers fill it; code validates it and maps it to operations. */

export const PeriodSchema = z.object({
  preset: z.enum([...PERIOD_PRESETS, "custom", "all"]),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string(),
});

export const DimensionFilterSchema = z.object({
  kind: z.literal("dimension"),
  dimension: z.string(),
  values: z.array(z.string()).min(1),
  source: z.enum(["system1", "pattern", "system2", "follow_up"]),
});

export const AmountFilterSchema = z.object({
  kind: z.literal("amount"),
  op: z.enum(["gt", "gte", "lt", "lte"]),
  /** Rand. */
  value: z.number().positive(),
  source: z.enum(["system2", "follow_up"]),
});

export const FilterSchema = z.discriminatedUnion("kind", [DimensionFilterSchema, AmountFilterSchema]);

export const QueryPlanSchema = z.object({
  intent: z.enum(INTENTS),
  metric: z.string().nullable(),
  period: PeriodSchema,
  comparison: PeriodSchema.nullable(),
  breakdown: z.string().nullable(),
  grain: z.enum(GRAINS).nullable(),
  filters: z.array(FilterSchema),
  rank: z.object({ direction: z.enum(["asc", "desc"]), limit: z.number().int().min(1).max(50) }).nullable(),
  records: z.object({ type: z.string(), limit: z.number().int().min(1).max(100) }).nullable(),
  drivers: z.array(z.string()).nullable(),
});

export type QueryPlan = z.infer<typeof QueryPlanSchema>;
export type Filter = z.infer<typeof FilterSchema>;
export type DimensionFilter = z.infer<typeof DimensionFilterSchema>;
export type AmountFilter = z.infer<typeof AmountFilterSchema>;
