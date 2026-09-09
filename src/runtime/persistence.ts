import { appendFile, mkdir, open, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { HistoryRecord, Scene } from "../core/types.js";

export class Persistence {
  #stateDirectory: string;
  constructor(root: string) { this.#stateDirectory = join(root, ".datacanvas"); }

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
    try { return JSON.parse(await readFile(join(this.#stateDirectory, "scene.json"), "utf8")) as Scene; }
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
      return (await readFile(join(this.#stateDirectory, "history.jsonl"), "utf8"))
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
    await writeFile(temporary, JSON.stringify(scene));
    await rename(temporary, destination);
  }

  async loadSnapshot(revision: number): Promise<Scene | undefined> {
    try { return JSON.parse(await readFile(join(this.#stateDirectory, "snapshots", `${revision}.json`), "utf8")) as Scene; }
    catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
}
