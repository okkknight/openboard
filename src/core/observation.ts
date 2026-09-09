import type { JsonObject } from "./types.js";

export interface ObservationHints {
  numericFields?: string[];
  categoryFields?: string[];
  orderField?: string;
}

export interface Observation {
  row_count: number;
  numeric: Record<string, { min: number; max: number; mean: number; median: number }>;
  categories: Record<string, { top: Array<{ value: string; count: number }> }>;
  ordered: Record<string, { first: number; last: number; absolute_change: number; relative_change: number | null }>;
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
  for (const field of hints.numericFields ?? []) {
    const values = rows.map((row) => row[field]).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
    if (!values.length) continue;
    numeric[field] = { min: Math.min(...values), max: Math.max(...values), mean: values.reduce((sum, value) => sum + value, 0) / values.length, median: median(values) };
  }
  for (const field of hints.categoryFields ?? []) {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const value = row[field];
      if (value === undefined || value === null) continue;
      const key = String(value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
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
  return { row_count: rows.length, numeric, categories, ordered };
}
