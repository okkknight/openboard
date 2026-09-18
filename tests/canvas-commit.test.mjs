import test from "node:test";
import assert from "node:assert/strict";
import { createCanvasCommitter } from "../web/canvas-commit.js";

const layout = { x: 0, y: 0, w: 100, h: 80 };
const gesture = () => ({
  action: "move", baseRevision: 3,
  originalLayouts: new Map([["visual:v1", layout], ["annotation:a1", { x: 120, y: 0, w: 80, h: 60 }]]),
  layoutUpdates: [
    { target: { kind: "visual", id: "v1" }, layout: { ...layout, x: 20 } },
    { target: { kind: "annotation", id: "a1" }, layout: { x: 140, y: 0, w: 80, h: 60 } }
  ]
});

function conflictHarness({ targetChanged }) {
  const composeCalls = [], rollbacks = [], announcements = [], applied = [];
  let attempt = 0;
  const latestScene = { revision: 4, visuals: { v1: { layout: targetChanged ? { ...layout, x: 5 } : layout } }, annotations: { a1: { layout: { x: 120, y: 0, w: 80, h: 60 } } } };
  return {
    composeCalls, rollbacks, announcements, applied, latestScene,
    committer: createCanvasCommitter({
      postCompose: async (body) => { composeCalls.push(body); attempt += 1; if (attempt === 1) throw Object.assign(new Error("revision_conflict"), { status: 409, code: "revision_conflict" }); return { status: "ok", revision: 5 }; },
      postAnnotate: async () => ({ status: "ok" }), fetchScene: async () => latestScene,
      applyDurableScene: (scene) => applied.push(scene), rollback: (layouts) => rollbacks.push(layouts), announce: (message) => announcements.push(message)
    })
  };
}

test("retries once when revision changed but target layouts did not", async () => {
  const harness = conflictHarness({ targetChanged: false });
  const result = await harness.committer.commitLayoutGesture(gesture());
  assert.equal(harness.composeCalls.length, 2);
  assert.equal(harness.composeCalls[1].expected_revision, harness.latestScene.revision);
  assert.equal(result.status, "ok");
});

test("rolls back when the same target changed concurrently", async () => {
  const harness = conflictHarness({ targetChanged: true });
  await assert.rejects(() => harness.committer.commitLayoutGesture(gesture()), /layout_conflict/);
  assert.equal(harness.rollbacks.length, 1);
  assert.equal(harness.rollbacks[0].get("visual:v1").x, 5);
  assert.equal(harness.applied[0], harness.latestScene);
  assert.equal(harness.composeCalls.length, 1);
  assert.match(harness.announcements[0], /changed elsewhere/i);
});

test("does not retry validation failures or a second conflict", async () => {
  let calls = 0;
  const committer = createCanvasCommitter({
    postCompose: async () => { calls += 1; throw Object.assign(new Error("invalid_spec"), { status: 400 }); },
    postAnnotate: async () => {}, fetchScene: async () => { throw new Error("must not fetch"); }, applyDurableScene: () => {}, rollback: () => {}, announce: () => {}
  });
  await assert.rejects(() => committer.commitLayoutGesture(gesture()), /invalid_spec/);
  assert.equal(calls, 1);
});

test("patches annotation content with an expected revision and applies the durable scene", async () => {
  const calls = [], applied = [];
  const scene = { revision: 9, visuals: {}, annotations: { a1: { id: "a1", text: "After" } } };
  const committer = createCanvasCommitter({
    postCompose: async () => {}, postAnnotate: async (body) => { calls.push(body); return { status: "ok", revision: 9 }; },
    fetchScene: async () => scene, applyDurableScene: (value) => applied.push(value), rollback: () => {}, announce: () => {}
  });
  await committer.patchAnnotation({ id: "a1", patch: { text: "After" }, baseRevision: 8 });
  assert.deepEqual(calls[0], { mode: "patch", id: "a1", patch: { text: "After" }, expected_revision: 8 });
  assert.equal(applied[0], scene);
});
