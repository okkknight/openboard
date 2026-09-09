import test from "node:test";
import assert from "node:assert/strict";
import { HistoryStore } from "../dist/core/history-store.js";

function scene(revision, title = "Original") {
  return {
    canvas_id: "test",
    revision,
    datasets: {},
    visuals: {
      v1: {
        id: "v1",
        kind: "plot",
        title,
        source: "orders",
        query: {},
        marks: [],
        layout: { x: 0, y: 0, w: 480, h: 320 }
      }
    },
    annotations: {},
    canvas: {}
  };
}

test("records immutable scene snapshots by revision", () => {
  const history = new HistoryStore(scene(0));
  history.append({
    revision: 1,
    parent_revision: 0,
    operation: "visual.patch",
    target: "v1",
    input: { set: { title: "Changed" } },
    timestamp: "2026-09-09T00:00:00.000Z"
  }, scene(1, "Changed"));

  assert.deepEqual(history.snapshotAt(0).visuals.v1.title, "Original");
  assert.deepEqual(history.snapshotAt(1).visuals.v1.title, "Changed");
  assert.equal(history.records()[0].operation, "visual.patch");
});
