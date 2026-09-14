import test from "node:test";
import assert from "node:assert/strict";
import { createRenderGenerationTracker, planRenderOperations } from "../web/render-reconciler.js";

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

test("rejects a stale visual response before it can write DOM", () => {
  const generations = createRenderGenerationTracker();
  const first = generations.request("orders");
  const second = generations.request("orders");
  assert.equal(generations.accepts("orders", first), false);
  assert.equal(generations.accepts("orders", second), true);
});
