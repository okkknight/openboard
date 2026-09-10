import type { JsonObject } from "./types.js";

export interface ObservationHints {
  numericFields?: string[];
  categoryFields?: string[];
  orderField?: string;
}

export interface Observation {
  row_count: number;
  numeric: Record<string, { min: number; max: number; mean: number; median: number; argmin: { value: number; index: number }; argmax: { value: number; index: number } }>;
  categories: Record<string, { top: Array<{ value: string; count: number }> }>;
  ordered: Record<string, { first: number; last: number; absolute_change: number; relative_change: number | null }>;
  missing: Record<string, number>;
  outliers: Array<{ field: string; value: number; index: number; lower: number; upper: number }>;
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const center = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[center] : (sorted[center - 1] + sorted[center]) / 2;
}

export function observe(rows: JsonObject[], hints: ObservationHints = {}): Observation {
  const numeric: Observation["numeric"] = {};
  const categories: Observation["categories"] = {};
  const ordered: Observation["ordered"] = {};
  const missing: Observation["missing"] = {};
  const outliers: Observation["outliers"] = [];
  for (const field of hints.numericFields ?? []) {
    const indexed = rows.map((row, index) => ({ value: row[field], index })).filter((item): item is { value: number; index: number } => typeof item.value === "number" && Number.isFinite(item.value));
    const values = indexed.map(({ value }) => value);
    missing[field] = rows.length - values.length;
    if (!values.length) continue;
    const min = Math.min(...values);
    const max = Math.max(...values);
    const minimum = indexed.find(({ value }) => value === min)!;
    const maximum = indexed.find(({ value }) => value === max)!;
    numeric[field] = { min, max, mean: values.reduce((sum, value) => sum + value, 0) / values.length, median: median(values), argmin: { value: min, index: minimum.index }, argmax: { value: max, index: maximum.index } };
    if (values.length >= 4) {
      const sorted = [...values].sort((left, right) => left - right);
      const middle = Math.floor(sorted.length / 2);
      const q1 = median(sorted.slice(0, middle));
      const q3 = median(sorted.slice(Math.ceil(sorted.length / 2)));
      const iqr = q3 - q1;
      const lower = q1 - 1.5 * iqr;
      const upper = q3 + 1.5 * iqr;
      for (const item of indexed) if (item.value < lower || item.value > upper) outliers.push({ field, value: item.value, index: item.index, lower, upper });
    }
  }
  for (const field of hints.categoryFields ?? []) {
    const counts = new Map<string, number>();
    let missingCount = 0;
    for (const row of rows) {
      const value = row[field];
      if (value === undefined || value === null) { missingCount += 1; continue; }
      const key = String(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    missing[field] = missingCount;
    categories[field] = { top: [...counts].map(([value, count]) => ({ value, count })).sort((left, right) => right.count - left.count || left.value.localeCompare(right.value)) };
  }
  if (hints.orderField) {
    const sorted = [...rows].sort((left, right) => String(left[hints.orderField!]).localeCompare(String(right[hints.orderField!])));
    for (const field of hints.numericFields ?? []) {
      const first = sorted[0]?.[field];
      const last = sorted.at(-1)?.[field];
      if (typeof first !== "number" || typeof last !== "number") continue;
      ordered[field] = { first, last, absolute_change: last - first, relative_change: first === 0 ? null : (last - first) / first };
    }
  }
  return { row_count: rows.length, numeric, categories, ordered, missing, outliers };
}
