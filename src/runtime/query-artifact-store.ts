import type { Observation } from "../core/observation.js";
import type { JsonObject, JsonValue, QuerySpec } from "../core/types.js";

export interface QueryArtifact {
  dataset_fingerprint: string;
  query_key: string;
  columns: string[];
  rows: JsonObject[];
  observation: Observation;
  state: "complete";
}

type QueryResult = Pick<QueryArtifact, "columns" | "rows" | "observation">;

function canonical(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical((value as JsonObject)[key] as JsonValue)])) as JsonObject;
  }
  return value;
}

export function canonicalQueryKey(query: QuerySpec): string {
  return JSON.stringify(canonical(query as unknown as JsonValue));
}

export class QueryArtifactStore {
  #artifacts = new Map<string, Promise<QueryArtifact>>();

  async getOrExecute(workId: string, fingerprint: string, query: QuerySpec, execute: () => Promise<QueryResult>): Promise<QueryArtifact> {
    const queryKey = canonicalQueryKey(query);
    const key = this.#key(workId, fingerprint, queryKey);
    const existing = this.#artifacts.get(key);
    if (existing) return existing;
    const pending = execute()
      .then((result) => ({ ...structuredClone(result), dataset_fingerprint: fingerprint, query_key: queryKey, state: "complete" as const }))
      .catch((error) => { this.#artifacts.delete(key); throw error; });
    this.#artifacts.set(key, pending);
    return pending;
  }

  peek(workId: string, fingerprint: string, query: QuerySpec): Promise<QueryArtifact> | undefined {
    return this.#artifacts.get(this.#key(workId, fingerprint, canonicalQueryKey(query)));
  }

  clearWork(workId: string): void {
    for (const key of this.#artifacts.keys()) if (key.startsWith(`${workId}\u0000`)) this.#artifacts.delete(key);
  }

  sizeForWork(workId: string): number {
    return [...this.#artifacts.keys()].filter((key) => key.startsWith(`${workId}\u0000`)).length;
  }

  #key(workId: string, fingerprint: string, queryKey: string): string { return `${workId}\u0000${fingerprint}\u0000${queryKey}`; }
}
