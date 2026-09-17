import { appendFile, mkdir, open, readFile, readdir, rename, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { HistoryFork } from "../core/history-store.js";
import type { HistoryRecord, Scene } from "../core/types.js";

export interface PersistenceMetadata {
  checkpoints: Record<string, number>;
  forks: HistoryFork[];
}

export interface RuntimePersistenceState {
  scene: Scene;
  history: HistoryRecord[];
  snapshots: Scene[];
  metadata: PersistenceMetadata;
}

export class Persistence {
  #stateDirectory: string;
  constructor(root: string) { this.#stateDirectory = join(root, ".datacanvas"); }

  async saveRuntimeState(state: RuntimePersistenceState): Promise<void> {
    const commits = join(this.#stateDirectory, "commits");
    const id = `${state.scene.revision}-${randomUUID()}`;
    const temporary = join(commits, `.${id}.tmp`);
    const destination = join(commits, id);
    await mkdir(join(temporary, "snapshots"), { recursive: true });
    try {
      await this.#writeFile(join(temporary, "scene.json"), `${JSON.stringify(state.scene, null, 2)}\n`);
      await this.#writeFile(join(temporary, "history.jsonl"), state.history.map((record) => JSON.stringify(record)).join("\n") + (state.history.length ? "\n" : ""));
      await this.#writeFile(join(temporary, "metadata.json"), `${JSON.stringify(state.metadata, null, 2)}\n`);
      for (const snapshot of state.snapshots) {
        await this.#writeFile(join(temporary, "snapshots", `${snapshot.revision}.json`), `${JSON.stringify(snapshot)}\n`);
      }
      await rename(temporary, destination);
      await this.#writeAtomically(join(this.#stateDirectory, "current.json"), `${JSON.stringify({ id })}\n`);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      throw error;
    }
  }

  async saveScene(scene: Scene): Promise<void> {
    await mkdir(this.#stateDirectory, { recursive: true });
    const finalPath = join(this.#stateDirectory, "scene.json");
    const temporaryPath = `${finalPath}.tmp`;
    const file = await open(temporaryPath, "w");
    try {
      await file.writeFile(`${JSON.stringify(scene, null, 2)}\n`);
      await file.sync();
    } finally { await file.close(); }
    await rename(temporaryPath, finalPath);
  }

  async loadScene(): Promise<Scene | undefined> {
    try { return JSON.parse(await readFile(join(await this.#activeDirectory(), "scene.json"), "utf8")) as Scene; }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async appendHistory(record: HistoryRecord): Promise<void> {
    await mkdir(this.#stateDirectory, { recursive: true });
    await appendFile(join(this.#stateDirectory, "history.jsonl"), `${JSON.stringify(record)}\n`, "utf8");
  }

  async loadHistory(): Promise<HistoryRecord[]> {
    try {
      return (await readFile(join(await this.#activeDirectory(), "history.jsonl"), "utf8"))
        .split("\n").filter(Boolean).map((line) => JSON.parse(line) as HistoryRecord);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async saveSnapshot(scene: Scene): Promise<void> {
    const snapshots = join(this.#stateDirectory, "snapshots");
    await mkdir(snapshots, { recursive: true });
    const destination = join(snapshots, `${scene.revision}.json`);
    const temporary = `${destination}.tmp`;
    const file = await open(temporary, "w");
    try {
      await file.writeFile(`${JSON.stringify(scene)}\n`);
      await file.sync();
    } finally { await file.close(); }
    await rename(temporary, destination);
  }

  async loadSnapshot(revision: number): Promise<Scene | undefined> {
    try { return JSON.parse(await readFile(join(await this.#activeDirectory(), "snapshots", `${revision}.json`), "utf8")) as Scene; }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async listSnapshotRevisions(): Promise<number[]> {
    try {
      return (await readdir(join(await this.#activeDirectory(), "snapshots")))
        .map((name) => Number(name.replace(/\.json$/, "")))
        .filter(Number.isInteger).sort((left, right) => left - right);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async saveMetadata(metadata: PersistenceMetadata): Promise<void> {
    await mkdir(this.#stateDirectory, { recursive: true });
    const finalPath = join(this.#stateDirectory, "metadata.json");
    const temporaryPath = `${finalPath}.tmp`;
    const file = await open(temporaryPath, "w");
    try {
      await file.writeFile(`${JSON.stringify(metadata, null, 2)}\n`);
      await file.sync();
    } finally { await file.close(); }
    await rename(temporaryPath, finalPath);
  }

  async loadMetadata(): Promise<PersistenceMetadata> {
    try {
      const parsed = JSON.parse(await readFile(join(await this.#activeDirectory(), "metadata.json"), "utf8")) as Partial<PersistenceMetadata>;
      return { checkpoints: parsed.checkpoints ?? {}, forks: parsed.forks ?? [] };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { checkpoints: {}, forks: [] };
      throw error;
    }
  }

  async #activeDirectory(): Promise<string> {
    try {
      const pointer = JSON.parse(await readFile(join(this.#stateDirectory, "current.json"), "utf8")) as { id?: unknown };
      if (typeof pointer.id !== "string" || !/^[A-Za-z0-9-]+$/.test(pointer.id)) throw new Error("invalid_persistence_pointer");
      return join(this.#stateDirectory, "commits", pointer.id);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return this.#stateDirectory;
      throw error;
    }
  }

  async #writeAtomically(destination: string, contents: string): Promise<void> {
    const temporary = `${destination}.tmp`;
    await this.#writeFile(temporary, contents);
    await rename(temporary, destination);
  }

  async #writeFile(destination: string, contents: string): Promise<void> {
    const file = await open(destination, "w");
    try {
      await file.writeFile(contents);
      await file.sync();
    } finally { await file.close(); }
  }
}
