import type { Row } from "../adapter";
import { dimensionById, metricById, metricViews, recordTypeById, type Catalog, type MetricDef, type MetricTerm } from "../catalog";
import { addDays, bucketLabel, rangeLabel } from "../periods";
import type { Operation } from "../plan/operations";
import type { Filter } from "../plan/schema";
import type {
  CategoryData, ContributionData, DeltaData, RecordsData, ResultData, ScalarData, Series, SeriesData, SeriesPoint, ShareMatrixData,
} from "../results";
import type { Grain, Period, Unit } from "../types";

/**
 * Builds SQL for each operation from the catalog. Every derived number (ratio,
 * share, delta, percentage change, contribution) is computed in SQL, so the
 * values that reach charts and text all come out of DuckDB.
 */

export interface BuiltQuery {
  op: Operation["op"];
  metric: MetricDef | null;
  unit: Unit;
  views: string[];
  sql: string[];
  notes: string[];
  toData(rows: Row[][]): ResultData;
}

/** Internal filter: a dimension filter that can be negated for complement series. */
type BuilderFilter = Filter | { kind: "not_dimension"; dimension: string; values: string[] };

export function lit(s: string): string {
  return `'${s.replaceAll("'", "''")}'`;
}

const num = (v: Row[string] | undefined): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: Row[string] | undefined): string => (v === null || v === undefined ? "" : String(v));

function timeRange(col: string, p: Period): string {
  return `${col} >= TIMESTAMP '${p.start} 00:00:00' AND ${col} < TIMESTAMP '${addDays(p.end, 1)} 00:00:00'`;
}

function dimColumn(catalog: Catalog, dimensionId: string, view: string): string {
  const dim = dimensionById(catalog, dimensionId);
  if (!dim) throw new Error(`Unknown dimension ${dimensionId}`);
  const col = dim.columns[view];
  if (!col) throw new Error(`Dimension ${dimensionId} is not available in ${view}`);
  return col;
}

const AMOUNT_OPS = { gt: ">", gte: ">=", lt: "<", lte: "<=" } as const;

function filterConditions(catalog: Catalog, filters: BuilderFilter[], view: string): string[] {
  return filters.map((f) => {
    if (f.kind === "amount") {
      const col = catalog.amountColumns[view];
      if (!col) throw new Error(`Amount filters are not available in ${view}`);
      return `${col} ${AMOUNT_OPS[f.op]} ${Math.round(f.value * 100)}`;
    }
    const col = dimColumn(catalog, f.dimension, view);
    const list = f.values.map(lit).join(", ");
    return f.kind === "dimension" ? `${col} IN (${list})` : `${col} NOT IN (${list})`;
  });
}

function where(catalog: Catalog, term: MetricTerm, period: Period, filters: BuilderFilter[], extra: string[] = []): string {
  const conds = [timeRange(term.timeColumn, period), ...(term.where ? [`(${term.where})`] : []), ...filterConditions(catalog, filters, term.view), ...extra];
  return conds.join("\n    AND ");
}

/** Raw aggregate scaled to the metric's unit, e.g. cents -> rand. */
function scaled(raw: string, term: MetricTerm | undefined): string {
  return term?.divisor ? `(${raw}) / ${term.divisor}.0` : `(${raw})`;
}

const BUCKET_FORMAT: Record<Grain, string> = { hour: "%Y-%m-%d %H:00", day: "%Y-%m-%d", week: "%Y-%m-%d", month: "%Y-%m" };

function bucket(grain: Grain, col: string): string {
  return `strftime(date_trunc('${grain}', ${col}), '${BUCKET_FORMAT[grain]}')`;
}

function bucketsCte(grain: Grain, p: Period): string {
  const step = grain === "hour" ? "1 HOUR" : "1 DAY";
  return `SELECT DISTINCT ${bucket(grain, "ts")} AS t FROM range(TIMESTAMP '${p.start} 00:00:00', TIMESTAMP '${addDays(p.end, 1)} 00:00:00', INTERVAL ${step}) r(ts)`;
}

function isRatio(m: MetricDef): boolean {
  return m.kind === "ratio" && m.denominator !== undefined;
}

/** numerator / denominator in the metric's unit; raw division when both terms share a divisor. */
function ratioValue(m: MetricDef, rawN: string, rawD: string): string {
  const dn = m.numerator.divisor ?? 1;
  const dd = m.denominator?.divisor ?? 1;
  if (dn === dd) return `${rawN}::DOUBLE / NULLIF(${rawD}, 0)`;
  return `(${rawN}::DOUBLE / ${dn}) / NULLIF(${rawD}::DOUBLE / ${dd}, 0)`;
}

// ---------------------------------------------------------------------------

function aggregateCtes(catalog: Catalog, m: MetricDef, prefix: string, period: Period, filters: BuilderFilter[]): string[] {
  const n = m.numerator;
  const ctes = [`${prefix}_n AS (\n  SELECT ${n.expr} AS raw_n FROM ${n.view}\n  WHERE ${where(catalog, n, period, filters)}\n)`];
  if (isRatio(m)) {
    const d = m.denominator!;
    ctes.push(`${prefix}_d AS (\n  SELECT ${d.expr} AS raw_d FROM ${d.view}\n  WHERE ${where(catalog, d, period, filters)}\n)`);
    ctes.push(
      `${prefix} AS (\n  SELECT raw_n, raw_d, ${scaled("raw_n", n)} AS numerator, ${scaled("raw_d", d)} AS denominator, ` +
        `${ratioValue(m, "raw_n", "raw_d")} AS value\n  FROM ${prefix}_n, ${prefix}_d\n)`,
    );
  } else {
    ctes.push(`${prefix} AS (\n  SELECT raw_n, NULL AS raw_d, ${scaled("raw_n", n)} AS numerator, NULL AS denominator, ${scaled("raw_n", n)} AS value\n  FROM ${prefix}_n\n)`);
  }
  return ctes;
}

function buildAggregate(catalog: Catalog, m: MetricDef, period: Period, filters: Filter[]): BuiltQuery {
  const sql = `WITH ${aggregateCtes(catalog, m, "cur", period, filters).join(",\n")}\nSELECT value, numerator, denominator FROM cur`;
  return {
    op: "aggregate", metric: m, unit: m.unit, views: metricViews(m), sql: [sql], notes: [],
    toData: ([rows]): ScalarData => {
      const r = rows?.[0] ?? {};
      return { shape: "scalar", value: num(r.value), numerator: num(r.numerator), denominator: num(r.denominator), period };
    },
  };
}

function buildPeriodChange(catalog: Catalog, m: MetricDef, period: Period, comparison: Period, filters: Filter[]): BuiltQuery {
  const ctes = [...aggregateCtes(catalog, m, "cur", period, filters), ...aggregateCtes(catalog, m, "prev", comparison, filters)];
  const ratio = isRatio(m);
  const delta = ratio ? "cur.value - prev.value" : scaled("cur.raw_n - prev.raw_n", m.numerator);
  const deltaPp = ratio ? "(cur.value - prev.value) * 100" : "NULL";
  const pct = ratio ? "(cur.value - prev.value) / NULLIF(prev.value, 0)" : "(cur.raw_n - prev.raw_n)::DOUBLE / NULLIF(prev.raw_n, 0)";
  const sql =
    `WITH ${ctes.join(",\n")}\nSELECT cur.value AS current, prev.value AS previous, ${delta} AS delta, ${deltaPp} AS delta_pp, ${pct} AS pct_change,\n` +
    `  cur.numerator AS current_numerator, cur.denominator AS current_denominator, prev.numerator AS previous_numerator, prev.denominator AS previous_denominator\nFROM cur, prev`;
  return {
    op: "period_change", metric: m, unit: m.unit, views: metricViews(m), sql: [sql], notes: [],
    toData: ([rows]): DeltaData => {
      const r = rows?.[0] ?? {};
      return {
        shape: "delta", current: num(r.current), previous: num(r.previous), delta: num(r.delta), deltaPp: num(r.delta_pp),
        pctChange: num(r.pct_change), currentNumerator: num(r.current_numerator), currentDenominator: num(r.current_denominator),
        previousNumerator: num(r.previous_numerator), previousDenominator: num(r.previous_denominator), period, comparison,
      };
    },
  };
}

function groupSql(
  catalog: Catalog, m: MetricDef, period: Period, dimension: string, filters: Filter[],
  opts: { direction: "asc" | "desc"; limit: number; minSupport: number | null },
): string {
  const n = m.numerator;
  const order = `value ${opts.direction.toUpperCase()} NULLS LAST, k`;
  const nCte = `n AS (\n  SELECT ${dimColumn(catalog, dimension, n.view)} AS k, ${n.expr} AS raw_n FROM ${n.view}\n  WHERE ${where(catalog, n, period, filters)}\n  GROUP BY 1\n)`;
  if (isRatio(m)) {
    const d = m.denominator!;
    const dCte = `d AS (\n  SELECT ${dimColumn(catalog, dimension, d.view)} AS k, ${d.expr} AS raw_d FROM ${d.view}\n  WHERE ${where(catalog, d, period, filters)}\n  GROUP BY 1\n)`;
    const support = opts.minSupport ? `WHERE raw_d >= ${opts.minSupport}` : "";
    return (
      `WITH ${nCte},\n${dCte},\n` +
      `g AS (\n  SELECT COALESCE(n.k, d.k) AS k, COALESCE(n.raw_n, 0) AS raw_n, d.raw_d\n  FROM n FULL OUTER JOIN d ON n.k = d.k\n  WHERE COALESCE(n.k, d.k) IS NOT NULL\n),\n` +
      `f AS (SELECT * FROM g ${support})\n` +
      `SELECT k, ${scaled("raw_n", n)} AS numerator, ${scaled("raw_d", d)} AS denominator, ${ratioValue(m, "raw_n", "raw_d")} AS value, NULL AS share,\n` +
      `  (SELECT COUNT(*) FROM g) AS groups_total, (SELECT COUNT(*) FROM g) - (SELECT COUNT(*) FROM f) AS groups_below_support\n` +
      `FROM f\nORDER BY ${order}\nLIMIT ${opts.limit}`
    );
  }
  const share = m.kind === "distinct" ? "NULL" : "raw_n::DOUBLE / SUM(raw_n) OVER ()";
  const value = m.kind === "share" ? share : scaled("raw_n", n);
  return (
    `WITH ${nCte},\ng AS (SELECT k, raw_n FROM n WHERE k IS NOT NULL)\n` +
    `SELECT k, ${scaled("raw_n", n)} AS numerator, NULL AS denominator, ${value} AS value, ${share} AS share,\n` +
    `  COUNT(*) OVER () AS groups_total, 0 AS groups_below_support\nFROM g\nORDER BY ${order}\nLIMIT ${opts.limit}`
  );
}

function categoryData(catalog: Catalog, dimension: string, period: Period, rows: Row[], direction: "asc" | "desc" | null, minSupport: number | null): CategoryData {
  const dim = dimensionById(catalog, dimension)!;
  return {
    shape: "categories", dimension, dimensionLabel: dim.label, period, direction, minSupport,
    groupsTotal: num(rows[0]?.groups_total) ?? 0,
    groupsBelowSupport: num(rows[0]?.groups_below_support) ?? 0,
    items: rows.map((r, i) => ({
      key: str(r.k), label: str(r.k), value: num(r.value), share: num(r.share), numerator: num(r.numerator), denominator: num(r.denominator), rank: i + 1,
    })),
  };
}

function buildGroup(catalog: Catalog, op: Extract<Operation, { op: "group_share" | "group_rank" }>): BuiltQuery {
  const m = metricById(catalog, op.metric)!;
  const dim = dimensionById(catalog, op.dimension)!;
  const isRank = op.op === "group_rank";
  const direction = isRank ? op.direction : "desc";
  const limit = isRank ? op.limit : 50;
  const minSupport = isRank ? op.minSupport : null;
  const notes: string[] = [];
  if (minSupport) notes.push(`Groups with fewer than ${minSupport} ${m.denominatorLabel ?? "in the denominator"} are not ranked.`);
  if (dim.nullLabel) notes.push(`${dim.nullLabel} is excluded from this grouping.`);
  return {
    op: op.op, metric: m, unit: m.kind === "share" ? "ratio" : m.unit, views: metricViews(m), notes,
    sql: [groupSql(catalog, m, op.period, op.dimension, op.filters, { direction, limit, minSupport })],
    toData: ([rows]) => categoryData(catalog, op.dimension, op.period, rows ?? [], isRank ? direction : null, minSupport),
  };
}

function seriesSql(catalog: Catalog, m: MetricDef, period: Period, grain: Grain, filters: BuilderFilter[]): string {
  const n = m.numerator;
  const ctes = [
    `buckets AS (${bucketsCte(grain, period)})`,
    `n AS (\n  SELECT ${bucket(grain, n.timeColumn)} AS t, ${n.expr} AS raw_n FROM ${n.view}\n  WHERE ${where(catalog, n, period, filters)}\n  GROUP BY 1\n)`,
  ];
  if (isRatio(m)) {
    const d = m.denominator!;
    ctes.push(`d AS (\n  SELECT ${bucket(grain, d.timeColumn)} AS t, ${d.expr} AS raw_d FROM ${d.view}\n  WHERE ${where(catalog, d, period, filters)}\n  GROUP BY 1\n)`);
    return (
      `WITH ${ctes.join(",\n")}\nSELECT b.t, ${scaled("COALESCE(n.raw_n, 0)", n)} AS numerator, ${scaled("d.raw_d", m.denominator)} AS denominator, ` +
      `${ratioValue(m, "COALESCE(n.raw_n, 0)", "d.raw_d")} AS value\nFROM buckets b LEFT JOIN n ON n.t = b.t LEFT JOIN d ON d.t = b.t\nORDER BY b.t`
    );
  }
  const value = m.kind === "distinct" ? "n.raw_n" : "COALESCE(n.raw_n, 0)";
  return `WITH ${ctes.join(",\n")}\nSELECT b.t, ${scaled(value, n)} AS numerator, NULL AS denominator, ${scaled(value, n)} AS value\nFROM buckets b LEFT JOIN n ON n.t = b.t\nORDER BY b.t`;
}

function seriesByGroupSql(catalog: Catalog, m: MetricDef, period: Period, grain: Grain, dimension: string, filters: Filter[]): string {
  const n = m.numerator;
  const vol = isRatio(m) ? m.denominator! : n;
  const top = `top AS (\n  SELECT ${dimColumn(catalog, dimension, vol.view)} AS k FROM ${vol.view}\n  WHERE ${where(catalog, vol, period, filters)} AND ${dimColumn(catalog, dimension, vol.view)} IS NOT NULL\n  GROUP BY 1 ORDER BY ${vol.expr} DESC, 1 LIMIT 5\n)`;
  const ctes = [
    `buckets AS (${bucketsCte(grain, period)})`,
    top,
    `n AS (\n  SELECT ${bucket(grain, n.timeColumn)} AS t, ${dimColumn(catalog, dimension, n.view)} AS k, ${n.expr} AS raw_n FROM ${n.view}\n  WHERE ${where(catalog, n, period, filters)}\n  GROUP BY 1, 2\n)`,
  ];
  if (isRatio(m)) {
    const d = m.denominator!;
    ctes.push(`d AS (\n  SELECT ${bucket(grain, d.timeColumn)} AS t, ${dimColumn(catalog, dimension, d.view)} AS k, ${d.expr} AS raw_d FROM ${d.view}\n  WHERE ${where(catalog, d, period, filters)}\n  GROUP BY 1, 2\n)`);
    return (
      `WITH ${ctes.join(",\n")}\nSELECT top.k AS k, b.t, ${scaled("COALESCE(n.raw_n, 0)", n)} AS numerator, ${scaled("d.raw_d", d)} AS denominator, ` +
      `${ratioValue(m, "COALESCE(n.raw_n, 0)", "d.raw_d")} AS value\nFROM buckets b CROSS JOIN top\n` +
      `LEFT JOIN n ON n.t = b.t AND n.k = top.k LEFT JOIN d ON d.t = b.t AND d.k = top.k\nORDER BY top.k, b.t`
    );
  }
  return (
    `WITH ${ctes.join(",\n")}\nSELECT top.k AS k, b.t, ${scaled("COALESCE(n.raw_n, 0)", n)} AS numerator, NULL AS denominator, ${scaled("COALESCE(n.raw_n, 0)", n)} AS value\n` +
    `FROM buckets b CROSS JOIN top LEFT JOIN n ON n.t = b.t AND n.k = top.k\nORDER BY top.k, b.t`
  );
}

const toPoints = (rows: Row[], grain: Grain): SeriesPoint[] =>
  rows.map((r) => ({ key: str(r.t), label: bucketLabel(str(r.t), grain), value: num(r.value), numerator: num(r.numerator), denominator: num(r.denominator) }));

function buildSeries(catalog: Catalog, op: Extract<Operation, { op: "time_series" }>): BuiltQuery {
  const m = metricById(catalog, op.metric)!;
  const sql: string[] = [];
  const notes: string[] = [];
  if (op.breakdown) {
    sql.push(seriesByGroupSql(catalog, m, op.period, op.grain, op.breakdown, op.filters));
    notes.push("Up to five groups with the most volume are shown.");
  } else {
    sql.push(seriesSql(catalog, m, op.period, op.grain, op.filters));
    if (op.comparison?.kind === "previous") sql.push(seriesSql(catalog, m, op.comparison.period, op.grain, op.filters));
    if (op.comparison?.kind === "complement") {
      const cmp = op.comparison;
      const filters: BuilderFilter[] = op.filters.filter((f) => !(f.kind === "dimension" && f.dimension === cmp.dimension));
      filters.push({ kind: "not_dimension", dimension: cmp.dimension, values: cmp.values });
      sql.push(seriesSql(catalog, m, op.period, op.grain, filters));
    }
  }
  if (op.grain === "week") notes.push("Weeks start on Monday; the first and last weeks may be partial.");
  const primaryLabel = (() => {
    const f = op.filters.find((x) => x.kind === "dimension");
    return f && f.kind === "dimension" ? f.values.join(", ") : op.period.label;
  })();
  return {
    op: "time_series", metric: m, unit: m.unit, views: metricViews(m), sql, notes,
    toData: (results): SeriesData => {
      const series: Series[] = [];
      if (op.breakdown) {
        const rows = results[0] ?? [];
        const keys = [...new Set(rows.map((r) => str(r.k)))];
        for (const k of keys) series.push({ label: k, role: "group", points: toPoints(rows.filter((r) => str(r.k) === k), op.grain) });
      } else {
        series.push({ label: primaryLabel, role: "primary", points: toPoints(results[0] ?? [], op.grain) });
        if (op.comparison?.kind === "previous") {
          series.push({ label: op.comparison.period.label, role: "comparison", points: toPoints(results[1] ?? [], op.grain) });
        } else if (op.comparison?.kind === "complement") {
          const dim = dimensionById(catalog, op.comparison.dimension)!;
          series.push({ label: `Other ${dim.label.toLowerCase()}s`, role: "comparison", points: toPoints(results[1] ?? [], op.grain) });
        }
      }
      return { shape: "series", grain: op.grain, period: op.period, series };
    },
  };
}

function buildShareMatrix(catalog: Catalog, op: Extract<Operation, { op: "share_matrix" }>): BuiltQuery {
  const m = metricById(catalog, op.metric)!;
  const n = m.numerator;
  const dimCol = dimColumn(catalog, op.dimension, n.view);
  const sql =
    `WITH n AS (\n  SELECT ${bucket(op.grain, n.timeColumn)} AS t, ${dimCol} AS k, ${n.expr} AS raw_n FROM ${n.view}\n` +
    `  WHERE ${where(catalog, n, op.period, op.filters)} AND ${dimCol} IS NOT NULL\n  GROUP BY 1, 2\n)\n` +
    `SELECT t, k, ${scaled("raw_n", n)} AS value, raw_n::DOUBLE / SUM(raw_n) OVER (PARTITION BY t) AS share\nFROM n\nORDER BY t, k`;
  const dim = dimensionById(catalog, op.dimension)!;
  return {
    op: "share_matrix", metric: m, unit: "ratio", views: [n.view], sql: [sql], notes: [],
    toData: ([rows = []]): ShareMatrixData => {
      const bucketKeys = [...new Set(rows.map((r) => str(r.t)))];
      // Categories ordered by their share in the latest bucket, largest first.
      const last = bucketKeys.at(-1);
      const categories = [...new Set(rows.map((r) => str(r.k)))].sort((a, b) => {
        const sa = num(rows.find((r) => str(r.t) === last && str(r.k) === a)?.share) ?? 0;
        const sb = num(rows.find((r) => str(r.t) === last && str(r.k) === b)?.share) ?? 0;
        return sb - sa || a.localeCompare(b);
      });
      return {
        shape: "share_matrix", grain: op.grain, dimension: op.dimension, dimensionLabel: dim.label, period: op.period,
        buckets: bucketKeys.map((k) => ({ key: k, label: bucketLabel(k, op.grain) })), categories,
        cells: rows.map((r) => ({ bucket: str(r.t), category: str(r.k), value: num(r.value) ?? 0, share: num(r.share) ?? 0 })),
      };
    },
  };
}

const MAX_STEPS = 6;

function buildContribution(catalog: Catalog, op: Extract<Operation, { op: "contribution" }>): BuiltQuery {
  const m = metricById(catalog, op.metric)!;
  const n = m.numerator;
  const keyFor = (view: string) =>
    op.drivers
      .map((d) => {
        const dim = dimensionById(catalog, d)!;
        return `COALESCE(CAST(${dimColumn(catalog, d, view)} AS VARCHAR), ${lit(dim.nullLabel ?? "Not applicable")})`;
      })
      .join(" || ' · ' || ");
  const cur = timeRange(n.timeColumn, op.period);
  const prev = timeRange(n.timeColumn, op.comparison);
  const base = [...(n.where ? [`(${n.where})`] : []), ...filterConditions(catalog, op.filters, n.view)];
  const nWhere = [`((${cur}) OR (${prev}))`, ...base].join("\n    AND ");
  const tail = (deltaExpr: string, startExpr: string, endExpr: string, changeExpr: string, pctExpr: string, curCol: string, prevCol: string, additive = true) => {
    // Group values only add up for additive metrics; a merged "Other" row has no single rate.
    const merge = (col: string) => (additive ? `SUM(${col})` : `CASE WHEN COUNT(*) = 1 THEN MIN(${col}) END`);
    return (
      `ranked AS (\n  SELECT k, ${curCol} AS cur_v, ${prevCol} AS prev_v, ${deltaExpr} AS delta,\n    ROW_NUMBER() OVER (ORDER BY abs(${deltaExpr}) DESC, k) AS rn\n  FROM g\n),\n` +
      `steps AS (\n  SELECT CASE WHEN rn <= ${MAX_STEPS} THEN k ELSE 'Other' END AS label, ${merge("cur_v")} AS cur_v, ${merge("prev_v")} AS prev_v, SUM(delta) AS delta, MIN(rn) AS rn\n  FROM ranked GROUP BY 1\n)\n` +
      `SELECT label, cur_v AS current, prev_v AS previous, delta,\n  ${startExpr} AS start_total, ${endExpr} AS end_total, ${changeExpr} AS total_change, ${pctExpr} AS pct_change\nFROM steps\nORDER BY rn`
    );
  };
  let sql: string;
  if (isRatio(m)) {
    // Shift-share: each group's effect = average weight x rate change + weight change x
    // (group's average rate - overall average rate). The effects sum exactly to the change.
    const d = m.denominator!;
    const dCur = timeRange(d.timeColumn, op.period);
    const dPrev = timeRange(d.timeColumn, op.comparison);
    const dWhere = [`((${dCur}) OR (${dPrev}))`, ...(d.where ? [`(${d.where})`] : []), ...filterConditions(catalog, op.filters, d.view)].join("\n    AND ");
    const rate = (a: string, b: string) => ratioValue(m, a, b);
    sql =
      `WITH n AS (\n  SELECT ${keyFor(n.view)} AS k,\n    COALESCE(${n.expr} FILTER (WHERE ${cur}), 0) AS cur_n,\n    COALESCE(${n.expr} FILTER (WHERE ${prev}), 0) AS prev_n\n  FROM ${n.view}\n  WHERE ${nWhere}\n  GROUP BY 1\n),\n` +
      `dg AS (\n  SELECT ${keyFor(d.view)} AS k,\n    COALESCE(${d.expr} FILTER (WHERE ${dCur}), 0) AS cur_d,\n    COALESCE(${d.expr} FILTER (WHERE ${dPrev}), 0) AS prev_d\n  FROM ${d.view}\n  WHERE ${dWhere}\n  GROUP BY 1\n),\n` +
      `j AS (\n  SELECT COALESCE(n.k, dg.k) AS k, COALESCE(n.cur_n, 0) AS cur_n, COALESCE(n.prev_n, 0) AS prev_n, COALESCE(dg.cur_d, 0) AS cur_d, COALESCE(dg.prev_d, 0) AS prev_d\n  FROM n FULL OUTER JOIN dg ON n.k = dg.k\n),\n` +
      `tot AS (SELECT SUM(cur_n) AS cn, SUM(prev_n) AS pn, SUM(cur_d) AS cd, SUM(prev_d) AS pd FROM j),\n` +
      `r AS (\n  SELECT j.k,\n    j.cur_d::DOUBLE / NULLIF(tot.cd, 0) AS w1, j.prev_d::DOUBLE / NULLIF(tot.pd, 0) AS w0,\n` +
      `    COALESCE(${rate("j.cur_n", "j.cur_d")}, ${rate("j.prev_n", "j.prev_d")}) AS r1,\n` +
      `    COALESCE(${rate("j.prev_n", "j.prev_d")}, ${rate("j.cur_n", "j.cur_d")}) AS r0,\n` +
      `    (${rate("tot.cn", "tot.cd")} + ${rate("tot.pn", "tot.pd")}) / 2 AS rbar\n  FROM j, tot\n),\n` +
      `g AS (\n  SELECT k, r1 AS cur_c, r0 AS prev_c, ((w1 + w0) / 2) * (r1 - r0) + (w1 - w0) * ((r1 + r0) / 2 - rbar) AS effect FROM r\n),\n` +
      tail(
        "effect",
        `(SELECT ${rate("pn", "pd")} FROM tot)`,
        `(SELECT ${rate("cn", "cd")} FROM tot)`,
        `(SELECT ${rate("cn", "cd")} - ${rate("pn", "pd")} FROM tot)`,
        `(SELECT (${rate("cn", "cd")} - ${rate("pn", "pd")}) / NULLIF(${rate("pn", "pd")}, 0) FROM tot)`,
        "cur_c",
        "prev_c",
        false,
      );
  } else {
    sql =
      `WITH g AS (\n  SELECT ${keyFor(n.view)} AS k,\n    COALESCE(${n.expr} FILTER (WHERE ${cur}), 0) AS cur_raw,\n    COALESCE(${n.expr} FILTER (WHERE ${prev}), 0) AS prev_raw\n  FROM ${n.view}\n  WHERE ${nWhere}\n  GROUP BY 1\n),\n` +
      tail(
        scaled("cur_raw - prev_raw", n),
        scaled("(SELECT SUM(prev_raw) FROM g)", n),
        scaled("(SELECT SUM(cur_raw) FROM g)", n),
        scaled("(SELECT SUM(cur_raw) FROM g) - (SELECT SUM(prev_raw) FROM g)", n),
        "((SELECT SUM(cur_raw) FROM g) - (SELECT SUM(prev_raw) FROM g))::DOUBLE / NULLIF((SELECT SUM(prev_raw) FROM g), 0)",
        scaled("cur_raw", n),
        scaled("prev_raw", n),
      );
  }
  const driverLabel = op.drivers.map((d) => dimensionById(catalog, d)!.label.toLowerCase()).join(" and ");
  return {
    op: "contribution", metric: m, unit: m.unit, views: metricViews(m), sql: [sql],
    notes: [`Change split by ${driverLabel}; the largest ${MAX_STEPS} movements are shown, the rest grouped as Other.`],
    toData: ([rows = []]): ContributionData => {
      const first = rows[0] ?? {};
      return {
        shape: "contribution", drivers: op.drivers, driverLabel, period: op.period, comparison: op.comparison,
        start: num(first.start_total) ?? 0, end: num(first.end_total) ?? 0, change: num(first.total_change) ?? 0, pctChange: num(first.pct_change),
        steps: rows.map((r) => ({ key: str(r.label), label: str(r.label), previous: num(r.previous), current: num(r.current), delta: num(r.delta) ?? 0 })),
        deltaUnit: isRatio(m) ? "pp" : m.unit,
      };
    },
  };
}

function buildRecords(catalog: Catalog, op: Extract<Operation, { op: "filter_records" }>): BuiltQuery {
  const rt = recordTypeById(catalog, op.recordType);
  if (!rt) throw new Error(`Unknown record type ${op.recordType}`);
  const conds = [timeRange(rt.timeColumn, op.period), ...filterConditions(catalog, op.filters, rt.view)].join("\n  AND ");
  const cols = rt.columns.map((c) => `  ${c.expr} AS ${c.id}`).join(",\n");
  const listSql = `SELECT\n${cols}\nFROM ${rt.view}\nWHERE ${conds}\nORDER BY ${rt.timeColumn} DESC\nLIMIT ${op.limit}`;
  const countSql = `SELECT COUNT(*) AS total FROM ${rt.view}\nWHERE ${conds}`;
  return {
    op: "filter_records", metric: null, unit: "count", views: [rt.view], sql: [listSql, countSql], notes: [],
    toData: ([rows = [], count = []]): RecordsData => ({
      shape: "records", recordType: rt.id, recordLabel: rt.label, period: op.period,
      columns: rt.columns.map((c) => ({ id: c.id, label: c.label, type: c.type })),
      rows, totalMatching: num(count[0]?.total) ?? rows.length,
    }),
  };
}

export function buildQuery(catalog: Catalog, op: Operation): BuiltQuery {
  switch (op.op) {
    case "aggregate":
      return buildAggregate(catalog, metricById(catalog, op.metric)!, op.period, op.filters);
    case "period_change":
      return buildPeriodChange(catalog, metricById(catalog, op.metric)!, op.period, op.comparison, op.filters);
    case "group_share":
    case "group_rank":
      return buildGroup(catalog, op);
    case "time_series":
      return buildSeries(catalog, op);
    case "share_matrix":
      return buildShareMatrix(catalog, op);
    case "contribution":
      return buildContribution(catalog, op);
    case "filter_records":
      return buildRecords(catalog, op);
  }
}

/** Short description of a period for SQL comments and the trace. */
export function describePeriod(p: Period): string {
  return `${rangeLabel(p.start, p.end)} (${p.start} to ${p.end})`;
}
