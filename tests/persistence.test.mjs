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

test("persists revision snapshots and lineage metadata", async () => {
  const root = await mkdtemp(join(tmpdir(), "openboard-state-snapshots-"));
  try {
    const persistence = new Persistence(root);
    const snapshot = { ...scene, revision: 4 };
    await persistence.saveSnapshot(snapshot);
    await persistence.saveMetadata({ checkpoints: { baseline: 4 }, forks: [{ branch_id: "test/fork/4", parent_revision: 4, created_at: "2026-09-10T00:00:00.000Z" }] });
    assert.deepEqual(await persistence.loadSnapshot(4), snapshot);
    assert.deepEqual(await persistence.listSnapshotRevisions(), [4]);
    assert.deepEqual(await persistence.loadMetadata(), { checkpoints: { baseline: 4 }, forks: [{ branch_id: "test/fork/4", parent_revision: 4, created_at: "2026-09-10T00:00:00.000Z" }] });
  } finally { await rm(root, { recursive: true, force: true }); }
});
