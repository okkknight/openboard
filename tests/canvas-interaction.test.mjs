import test from "node:test";
import assert from "node:assert/strict";
import { createInteractionController } from "../web/canvas-interaction.js";

const layouts = new Map([
  ["visual:a", { x: 0, y: 0, w: 100, h: 80 }],
  ["annotation:b", { x: 140, y: 0, w: 80, h: 60 }],
  ["visual:c", { x: 300, y: 200, w: 100, h: 80 }]
]);

function harness() {
  const previews = [], commits = [], rollbacks = [], selections = [], marquees = [];
  const controller = createInteractionController({
    getRevision: () => 7,
    getLayouts: (keys) => new Map(keys.map((key) => [key, layouts.get(key)]).filter(([, value]) => value)),
    getStationaryLayouts: (keys) => new Map([...layouts].filter(([key]) => !keys.includes(key))),
    minimumFor: () => ({ w: 40, h: 30 }),
    onPreview: (next, guides) => previews.push({ next, guides }),
    onCommit: (gesture) => commits.push(gesture),
    onRollback: (original, message) => rollbacks.push({ original, message }),
    onSelectionChange: (refs) => selections.push(refs),
    onMarquee: (rect) => marquees.push(rect)
  });
  return { controller, previews, commits, rollbacks, selections, marquees };
}

test("selection is ephemeral and shift toggles members", () => {
  const calls = harness();
  calls.controller.select({ kind: "visual", id: "a" });
  calls.controller.select({ kind: "annotation", id: "b" }, { additive: true });
  assert.deepEqual(calls.controller.getState().selection, ["visual:a", "annotation:b"]);
  calls.controller.select({ kind: "visual", id: "a" }, { additive: true });
  assert.deepEqual(calls.controller.getState().selection, ["annotation:b"]);
  assert.equal(calls.commits.length, 0);
});

test("pointer selection preserves a multi-selection when dragging one of its members", () => {
  const calls = harness();
  calls.controller.select({ kind: "visual", id: "a" });
  calls.controller.select({ kind: "annotation", id: "b" }, { additive: true });
  calls.controller.select({ kind: "visual", id: "a" }, { preserveIfSelected: true });
  assert.deepEqual(calls.controller.getState().selection, ["visual:a", "annotation:b"]);
  calls.controller.beginMove({ x: 0, y: 0 }, { pointerId: 8, zoom: 1 });
  calls.controller.updatePointer({ x: 20, y: 10 }, { pointerId: 8, controlKey: true });
  calls.controller.finishPointer({ pointerId: 8 });
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.commits[0].layoutUpdates.length, 2);
});

test("pointer movement previews locally and commits one move on finish", () => {
  const calls = harness();
  calls.controller.select({ kind: "visual", id: "a" });
  calls.controller.beginMove({ x: 10, y: 10 }, { pointerId: 1, zoom: 2 });
  calls.controller.updatePointer({ x: 30, y: 20 }, { pointerId: 1, controlKey: true });
  assert.equal(calls.previews.length, 1);
  assert.equal(calls.commits.length, 0);
  calls.controller.finishPointer({ pointerId: 1 });
  assert.equal(calls.commits.length, 1);
  assert.equal(calls.commits[0].action, "move");
  assert.equal(calls.commits[0].baseRevision, 7);
  assert.deepEqual(calls.commits[0].layoutUpdates[0].layout, { x: 10, y: 5, w: 100, h: 80 });
});

test("Escape rolls back and a no-op pointer finish does not commit", () => {
  const calls = harness();
  calls.controller.select({ kind: "visual", id: "a" });
  calls.controller.beginMove({ x: 0, y: 0 }, { pointerId: 2, zoom: 1 });
  calls.controller.cancel("Cancelled");
  assert.equal(calls.rollbacks.length, 1);
  assert.equal(calls.commits.length, 0);
  calls.controller.beginMove({ x: 0, y: 0 }, { pointerId: 3, zoom: 1 });
  calls.controller.finishPointer({ pointerId: 3 });
  assert.equal(calls.commits.length, 0);
});

test("sub-threshold pointer jitter stays a selection click and never snaps or commits", () => {
  const calls = harness();
  calls.controller.select({ kind: "annotation", id: "b" });
  calls.controller.beginMove({ x: 660, y: 140 }, { pointerId: 9, zoom: 1 });
  calls.controller.updatePointer({ x: 661, y: 141 }, { pointerId: 9 });
  assert.equal(calls.previews.length, 0);
  calls.controller.finishPointer({ pointerId: 9 });
  assert.equal(calls.commits.length, 0);
});

test("repeated keyboard nudges become one gesture on keyup", () => {
  const calls = harness();
  calls.controller.select({ kind: "visual", id: "a" });
  calls.controller.nudge({ x: 1, y: 0 });
  calls.controller.nudge({ x: 10, y: 0 });
  assert.equal(calls.commits.length, 0);
  calls.controller.finishNudge();
  assert.equal(calls.commits.length, 1);
  assert.deepEqual(calls.commits[0].layoutUpdates[0].layout, { x: 11, y: 0, w: 100, h: 80 });
});

test("marquee selects intersecting objects and supports additive selection", () => {
  const calls = harness();
  calls.controller.select({ kind: "visual", id: "c" });
  calls.controller.beginMarquee({ x: -10, y: -10 }, { additive: true });
  calls.controller.updatePointer({ x: 230, y: 100 });
  calls.controller.finishMarquee([...layouts]);
  assert.deepEqual(calls.controller.getState().selection, ["visual:c", "visual:a", "annotation:b"]);
  assert.ok(calls.marquees.length > 0);
  assert.equal(calls.commits.length, 0);
});

test("removeMissing clears only absent refs and editing blocks movement", () => {
  const calls = harness();
  calls.controller.select({ kind: "visual", id: "a" });
  calls.controller.select({ kind: "annotation", id: "b" }, { additive: true });
  calls.controller.removeMissing(["annotation:b"]);
  assert.deepEqual(calls.controller.getState().selection, ["annotation:b"]);
  calls.controller.enterEditing("annotation:b");
  assert.throws(() => calls.controller.beginMove({ x: 0, y: 0 }, { pointerId: 4 }), /interaction_busy/);
  calls.controller.leaveEditing();
  assert.equal(calls.controller.getState().phase, "idle");
});
