import type { CompiledQuery, DimensionSpec, FilterSpec, JsonPrimitive, MeasureSpec, QuerySpec } from "./types.js";

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function assertKnown(field: string, knownColumns: Set<string>): void {
  if (!knownColumns.has(field)) throw new Error(`unknown_column: ${field}`);
}

function asPrimitive(value: unknown, label: string): JsonPrimitive {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return value as JsonPrimitive;
  throw new Error(`invalid_filter_value: ${label}`);
}

function compileFilter(filter: FilterSpec, known: Set<string>, params: JsonPrimitive[]): string {
  assertKnown(filter.field, known);
  const field = quoteIdentifier(filter.field);
  switch (filter.op) {
    case "eq": params.push(asPrimitive(filter.value, filter.field)); return `${field} = ?`;
    case "neq": params.push(asPrimitive(filter.value, filter.field)); return `${field} <> ?`;
    case "gt": params.push(asPrimitive(filter.value, filter.field)); return `${field} > ?`;
    case "gte": params.push(asPrimitive(filter.value, filter.field)); return `${field} >= ?`;
    case "lt": params.push(asPrimitive(filter.value, filter.field)); return `${field} < ?`;
    case "lte": params.push(asPrimitive(filter.value, filter.field)); return `${field} <= ?`;
    case "contains": params.push(asPrimitive(filter.value, filter.field)); return `${field} LIKE ('%' || ? || '%')`;
    case "is_null": return `${field} IS NULL`;
    case "not_null": return `${field} IS NOT NULL`;
    case "last_days": {
      const days = asPrimitive(filter.value, filter.field);
      if (typeof days !== "number" || !Number.isFinite(days) || days <= 0) throw new Error(`invalid_filter_value: ${filter.field}`);
      params.push(days);
      return `${field} >= current_timestamp - (? * INTERVAL '1 day')`;
    }
    case "between": {
      if (!Array.isArray(filter.value) || filter.value.length !== 2) throw new Error(`invalid_filter_value: ${filter.field}`);
      params.push(asPrimitive(filter.value[0], filter.field), asPrimitive(filter.value[1], filter.field));
      return `${field} BETWEEN ? AND ?`;
    }
    case "in":
    case "not_in": {
      if (!Array.isArray(filter.value) || filter.value.length === 0) throw new Error(`invalid_filter_value: ${filter.field}`);
      const values = filter.value.map((value) => asPrimitive(value, filter.field));
      params.push(...values);
      return `${field} ${filter.op === "in" ? "IN" : "NOT IN"} (${values.map(() => "?").join(", ")})`;
    }
  }
}

function compileDimension(dimension: DimensionSpec, known: Set<string>): { sql: string; projected: string } {
  assertKnown(dimension.field, known);
  const field = quoteIdentifier(dimension.field);
  const alias = dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field);
  if (!dimension.time_grain && alias === dimension.field) return { sql: field, projected: alias };
  const expr = dimension.time_grain ? `date_trunc('${dimension.time_grain}', ${field})` : field;
  return { sql: `${expr} AS ${quoteIdentifier(alias)}`, projected: alias };
}

function compileMeasure(measure: MeasureSpec, known: Set<string>): { sql: string; projected: string } {
  if (!measure.alias) throw new Error("invalid_measure: alias required");
  if (measure.expr) return { sql: `${measure.expr} AS ${quoteIdentifier(measure.alias)}`, projected: measure.alias };
  const agg = measure.agg ?? "count";
  if (agg !== "count" && !measure.field) throw new Error(`invalid_measure: ${measure.alias} requires field`);
  if (measure.field) assertKnown(measure.field, known);
  const field = measure.field ? quoteIdentifier(measure.field) : "*";
  let expr: string;
  switch (agg) {
    case "count": expr = `COUNT(${field})`; break;
    case "count_distinct": expr = `COUNT(DISTINCT ${field})`; break;
    case "sum": expr = `SUM(${field})`; break;
    case "avg": expr = `AVG(${field})`; break;
    case "min": expr = `MIN(${field})`; break;
    case "max": expr = `MAX(${field})`; break;
    case "median": expr = `MEDIAN(${field})`; break;
    case "quantile": {
      const q = measure.quantile ?? 0.5;
      if (q < 0 || q > 1) throw new Error(`invalid_measure: quantile ${q}`);
      expr = `QUANTILE_CONT(${field}, ${q})`;
      break;
    }
  }
  return { sql: `${expr} AS ${quoteIdentifier(measure.alias)}`, projected: measure.alias };
}

export function compileQuery(datasetTable: string, knownColumns: string[], spec: QuerySpec): CompiledQuery {
  const hasStructured = Boolean(
    spec.filters?.length || spec.dimensions?.length || spec.measures?.length || spec.sort?.length
  );
  if (spec.sql) {
    if (hasStructured) throw new Error("mixed_raw_sql");
    if (spec.limit !== undefined && (!Number.isInteger(spec.limit) || spec.limit <= 0)) throw new Error("invalid_limit");
    return {
      sql: spec.limit ? `SELECT * FROM (${spec.sql}) AS ${quoteIdentifier("raw_query")} LIMIT ${spec.limit}` : spec.sql,
      params: [],
      projectedFields: [],
      requestedLimit: spec.limit
    };
  }

  const known = new Set(knownColumns);
  const params: JsonPrimitive[] = [];
  const dimensions = (spec.dimensions ?? []).map((d) => compileDimension(d, known));
  const measures = (spec.measures ?? []).map((m) => compileMeasure(m, known));
  const select = [...dimensions.map((d) => d.sql), ...measures.map((m) => m.sql)];
  const projectedFields = [...dimensions.map((d) => d.projected), ...measures.map((m) => m.projected)];
  const where = (spec.filters ?? []).map((filter) => compileFilter(filter, known, params));

  let sql = `SELECT ${select.length ? select.join(", ") : "*"} FROM ${quoteIdentifier(datasetTable)}`;
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;
  if (dimensions.length) sql += ` GROUP BY ${dimensions.map((_, i) => i + 1).join(", ")}`;

  if (spec.sort?.length) {
    const allowedSort = new Set([...knownColumns, ...projectedFields]);
    const items = spec.sort.map((sort) => {
      if (!allowedSort.has(sort.field)) throw new Error(`unknown_sort_field: ${sort.field}`);
      return `${quoteIdentifier(sort.field)} ${sort.direction.toUpperCase()}`;
    });
    sql += ` ORDER BY ${items.join(", ")}`;
  }

  if (spec.limit !== undefined) {
    if (!Number.isInteger(spec.limit) || spec.limit <= 0) throw new Error("invalid_limit");
    sql += ` LIMIT ${spec.limit}`;
  }

  return { sql, params, projectedFields, requestedLimit: spec.limit };
}
