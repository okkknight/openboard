import { stat as nodeStat } from "node:fs/promises";
import { resolve } from "node:path";
import type { ColumnProfile, DatasetSpec } from "../core/types.js";

export interface DatasetFingerprint {
  key: string;
  path: string;
  size: number;
  mtime_ms: number;
}

interface CacheEntry {
  fingerprint: DatasetFingerprint;
  schema?: Promise<ColumnProfile[]>;
}

interface MetadataDependencies {
  stat?: (path: string) => Promise<{ size: number; mtimeMs: number }>;
}

export class DatasetMetadataCache {
  #entries = new Map<string, CacheEntry>();
  #registered = new Set<string>();
  #stat: (path: string) => Promise<{ size: number; mtimeMs: number }>;

  constructor(dependencies: MetadataDependencies = {}) {
    this.#stat = dependencies.stat ?? nodeStat;
  }

  async fingerprint(dataset: DatasetSpec): Promise<DatasetFingerprint> {
    const path = resolve(dataset.path);
    const source = await this.#stat(path);
    return { key: `${path}:${source.size}:${source.mtimeMs}`, path, size: source.size, mtime_ms: source.mtimeMs };
  }

  async schema(dataset: DatasetSpec, load: () => Promise<ColumnProfile[]>): Promise<ColumnProfile[]> {
    const fingerprint = await this.fingerprint(dataset);
    let entry = this.#entries.get(dataset.id);
    if (!entry || entry.fingerprint.key !== fingerprint.key) {
      if (entry) this.#registered.delete(entry.fingerprint.key);
      entry = { fingerprint };
      this.#entries.set(dataset.id, entry);
    }
    if (!entry.schema) {
      entry.schema = load().catch((error) => {
        if (this.#entries.get(dataset.id) === entry) entry!.schema = undefined;
        throw error;
      });
    }
    return structuredClone(await entry.schema);
  }

  markRegistered(fingerprintKey: string): void { this.#registered.add(fingerprintKey); }

  async isRegistered(dataset: DatasetSpec): Promise<boolean> {
    return this.#registered.has((await this.fingerprint(dataset)).key);
  }
}
