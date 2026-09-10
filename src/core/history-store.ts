import type { HistoryRecord, Scene } from "./types.js";

export interface HistoryStoreSeed {
  records?: HistoryRecord[];
  snapshots?: Scene[];
  checkpoints?: Record<string, number>;
  forks?: HistoryFork[];
}

export interface HistoryFork {
  branch_id: string;
  parent_revision: number;
  created_at: string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class HistoryStore {
  #records: HistoryRecord[] = [];
  #snapshots = new Map<number, Scene>();
  #checkpoints = new Map<string, number>();
  #forks: HistoryFork[] = [];

  constructor(initialScene: Scene, seed: HistoryStoreSeed = {}) {
    this.#snapshots.set(initialScene.revision, clone(initialScene));
    for (const snapshot of seed.snapshots ?? []) {
      if (snapshot.canvas_id !== initialScene.canvas_id) throw new Error("history_canvas_mismatch");
      this.#snapshots.set(snapshot.revision, clone(snapshot));
    }
    for (const record of seed.records ?? []) {
      const snapshot = this.#snapshots.get(record.revision);
      if (!snapshot) throw new Error(`history_snapshot_missing: ${record.revision}`);
      if (record.revision !== snapshot.revision) throw new Error("history_revision_mismatch");
      this.#records.push(clone(record));
    }
    for (const [label, revision] of Object.entries(seed.checkpoints ?? {})) {
      this.checkpoint(label, revision);
    }
    for (const fork of seed.forks ?? []) {
      if (!this.#snapshots.has(fork.parent_revision)) throw new Error(`history_not_found: ${fork.parent_revision}`);
      if (!fork.branch_id) throw new Error("invalid_fork");
      this.#forks.push(clone(fork));
    }
  }

  append(record: HistoryRecord, scene: Scene): void {
    if (record.revision !== scene.revision) throw new Error("history_revision_mismatch");
    if (this.#snapshots.has(record.revision)) throw new Error(`history_revision_exists: ${record.revision}`);
    this.#records.push(clone(record));
    this.#snapshots.set(scene.revision, clone(scene));
  }

  records(): HistoryRecord[] {
    return clone(this.#records);
  }

  snapshotAt(revision: number): Scene {
    const snapshot = this.#snapshots.get(revision);
    if (!snapshot) throw new Error(`history_not_found: ${revision}`);
    return clone(snapshot);
  }

  revisions(): number[] {
    return [...this.#snapshots.keys()].sort((left, right) => left - right);
  }

  nextRevision(): number {
    return Math.max(...this.#snapshots.keys()) + 1;
  }

  parentRevision(revision: number): number | undefined {
    return this.#records.find((record) => record.revision === revision)?.parent_revision ?? undefined;
  }

  childRevisions(revision: number): number[] {
    return this.#records.filter((record) => record.parent_revision === revision).map((record) => record.revision).sort((left, right) => right - left);
  }

  checkpoint(label: string, revision: number): void {
    if (!label) throw new Error("invalid_checkpoint");
    if (!this.#snapshots.has(revision)) throw new Error(`history_not_found: ${revision}`);
    this.#checkpoints.set(label, revision);
  }

  checkpointRevision(label: string): number | undefined { return this.#checkpoints.get(label); }

  checkpoints(): Record<string, number> {
    return Object.fromEntries(this.#checkpoints.entries());
  }

  fork(canvasId: string, parentRevision: number): HistoryFork {
    if (!this.#snapshots.has(parentRevision)) throw new Error(`history_not_found: ${parentRevision}`);
    const prefix = `${canvasId}/fork/${parentRevision}`;
    const count = this.#forks.filter((fork) => fork.branch_id === prefix || fork.branch_id.startsWith(`${prefix}/`)).length;
    const branch_id = count === 0 ? prefix : `${prefix}/${count + 1}`;
    const fork = { branch_id, parent_revision: parentRevision, created_at: new Date().toISOString() };
    this.#forks.push(fork);
    return clone(fork);
  }

  forks(): HistoryFork[] {
    return clone(this.#forks);
  }
}
