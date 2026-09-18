import test from "node:test";
import assert from "node:assert/strict";
import { createRenderGenerationTracker, planRenderOperations, summarizeRenderOperations } from "../web/render-reconciler.js";

const layer = (keys, identityMode = "datum", markType = "bar") => ({
  mark_id: "bars",
  mark_type: markType,
  identity_mode: identityMode,
  nodes: keys.map((key) => ({ key }))
});

test("plans keyed enter update exit operations without using array position", () => {
  const operations = planRenderOperations(
    { axes_version: 1, layers: [layer(["A", "B", "C"])] },
    { axes_version: 2, layers: [layer(["A", "C", "D"])] }
  );

  assert.deepEqual(operations, [
    { type: "replace-axes" },
    { type: "update", mark_id: "bars", key: "A" },
    { type: "update", mark_id: "bars", key: "C" },
    { type: "exit", mark_id: "bars", key: "B" },
    { type: "enter", mark_id: "bars", key: "D" }
  ]);
});

test("does not exit retained keys while a streamed artifact is still partial", () => {
  const operations = planRenderOperations(
    { axes_version: 1, layers: [layer(["A", "B", "C", "D"])] },
    { axes_version: 2, layers: [layer(["C"])] },
    { streamState: "partial" }
  );

  assert.deepEqual(operations, [
    { type: "replace-axes" },
    { type: "update", mark_id: "bars", key: "C" }
  ]);
});

test("uses explicit layer replacement when identity is nonretainable", () => {
  assert.deepEqual(planRenderOperations(
    { axes_version: 1, layers: [layer(["A"], "nonretainable")] },
    { axes_version: 1, layers: [layer(["A"], "nonretainable")] }
  ), [{ type: "replace-layer", mark_id: "bars" }]);
});

test("replaces a layer when a mark changes rendering type", () => {
  assert.deepEqual(planRenderOperations(
    { axes_version: 1, layers: [layer(["A"], "datum", "bar")] },
    { axes_version: 1, layers: [layer(["A"], "datum", "line")] }
  ), [{ type: "replace-layer", mark_id: "bars" }]);
});

test("replaces a retained arc layer when a streamed total changes", () => {
  assert.deepEqual(planRenderOperations(
    { axes_version: 1, layers: [layer(["A"], "datum", "arc")] },
    { axes_version: 1, layers: [layer(["A", "B"], "datum", "arc")] }
  ), [{ type: "replace-layer", mark_id: "bars" }]);
});

test("rejects a stale visual response before it can write DOM", () => {
  const generations = createRenderGenerationTracker();
  const first = generations.request("orders");
  const second = generations.request("orders");
  assert.equal(generations.accepts("orders", first), false);
  assert.equal(generations.accepts("orders", second), true);
});

test("summarizes retained, entered, exited, and replaced identities for motion", () => {
  const summary = summarizeRenderOperations([
    { type: "replace-axes" },
    { type: "update", mark_id: "bars", key: "A" },
    { type: "enter", mark_id: "bars", key: "C" },
    { type: "exit", mark_id: "bars", key: "B" },
    { type: "replace-layer", mark_id: "trend" }
  ]);
  assert.deepEqual(summary, {
    retainedKeys: ["bars:A"],
    enteredKeys: ["bars:C"],
    exitedKeys: ["bars:B"],
    replacedLayers: ["trend"],
    elementCount: 3
  });
});
