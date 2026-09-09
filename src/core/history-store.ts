import type { HistoryRecord, Scene } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class HistoryStore {
  #records: HistoryRecord[] = [];
  #snapshots = new Map<number, Scene>();

  constructor(initialScene: Scene) {
    this.#snapshots.set(initialScene.revision, clone(initialScene));
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
}
