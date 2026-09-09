import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Persistence } from "../dist/runtime/persistence.js";

const scene = { canvas_id: "test", revision: 3, datasets: {}, visuals: {}, annotations: {}, canvas: {} };

test("persists scene atomically and appends operation history as JSONL", async () => {
  const root = await mkdtemp(join(tmpdir(), "openboard-state-"));
  try {
    const persistence = new Persistence(root);
    await persistence.saveScene(scene);
    await persistence.appendHistory({ revision: 3, parent_revision: 2, operation: "visual.patch", input: {}, timestamp: "2026-09-09T00:00:00.000Z" });
    assert.deepEqual(await persistence.loadScene(), scene);
    assert.equal((await persistence.loadHistory())[0].operation, "visual.patch");
    assert.match(await readFile(join(root, ".datacanvas", "history.jsonl"), "utf8"), /visual.patch/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
