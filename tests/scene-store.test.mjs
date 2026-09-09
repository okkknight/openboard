import test from "node:test";
import assert from "node:assert/strict";
import { SceneStore } from "../dist/core/scene-store.js";

function seed() {
  return {
    canvas_id: "test",
    revision: 0,
    datasets: {
      orders: { id: "orders", path: "examples/orders.csv", format: "csv" }
    },
    visuals: {
      v1: {
        id: "v1",
        kind: "plot",
        title: "By channel",
        source: "orders",
        query: { dimensions: [{ field: "channel" }] },
        marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }],
        layout: { x: 0, y: 0, w: 480, h: 320 }
      }
    },
    annotations: {},
    canvas: { focus: "v1" }
  };
}

test("patch mutates the same visual and increments revision once", () => {
  const store = new SceneStore(seed());
  const result = store.patchVisual("v1", {
    set: {
      title: "Daily trend",
      "query.dimensions": [{ field: "created_at", time_grain: "day", alias: "day" }]
    },
    remove_marks: ["bars"],
    add_marks: [{ id: "trend", type: "lineY", x: "day", y: "failure_rate" }]
  });
  assert.equal(result.revision, 1);
  assert.equal(result.visual.id, "v1");
  assert.equal(result.visual.title, "Daily trend");
  assert.deepEqual(result.visual.query.dimensions, [{ field: "created_at", time_grain: "day", alias: "day" }]);
  assert.deepEqual(result.visual.marks.map((m) => m.id), ["trend"]);
});

test("clone preserves original and records derived_from", () => {
  const store = new SceneStore(seed());
  const result = store.cloneVisual("v1", "v2", {
    set: { title: "Channel B by city", "query.filters": [{ field: "channel", op: "eq", value: "B" }] }
  });
  const scene = store.inspect();
  assert.equal(result.revision, 1);
  assert.equal(scene.visuals.v1.title, "By channel");
  assert.equal(scene.visuals.v2.derived_from, "v1");
  assert.equal(scene.visuals.v2.title, "Channel B by city");
});

test("stale expected revision throws a revision_conflict", () => {
  const store = new SceneStore(seed());
  assert.throws(
    () => store.patchVisual("v1", { set: { title: "Changed" } }, 9),
    /revision_conflict: expected 9, actual 0/
  );
});

test("patch cannot change immutable id", () => {
  const store = new SceneStore(seed());
  assert.throws(() => store.patchVisual("v1", { set: { id: "other" } }), /immutable_path/);
});

test("adding duplicate mark id is rejected", () => {
  const store = new SceneStore(seed());
  assert.throws(
    () => store.patchVisual("v1", { add_marks: [{ id: "bars", type: "dot", x: "channel", y: "orders" }] }),
    /duplicate_mark/
  );
});

test("create, compose, and annotate each commit one scene revision", () => {
  const store = new SceneStore(seed());
  const created = store.createVisual({
    id: "v2",
    kind: "plot",
    source: "orders",
    query: {},
    marks: [],
    layout: { x: 500, y: 0, w: 480, h: 320 }
  }, 0);
  assert.equal(created.revision, 1);

  const composed = store.compose({ action: "focus", target: "v2" }, 1);
  assert.equal(composed.revision, 2);
  assert.equal(store.inspect().canvas.focus, "v2");

  const annotated = store.annotate({ id: "a1", target: "v2", text: "Investigate this", created_at: "2026-09-09T00:00:00.000Z" }, 2);
  assert.equal(annotated.revision, 3);
  assert.equal(store.inspect().annotations.a1.text, "Investigate this");
});

test("history apply returns an earlier immutable scene snapshot", () => {
  const store = new SceneStore(seed());
  store.patchVisual("v1", { set: { title: "One" } });
  store.patchVisual("v1", { set: { title: "Two" } });
  const result = store.applyHistory({ action: "goto", revision: 1 });
  assert.equal(result.revision, 1);
  assert.equal(store.inspect().visuals.v1.title, "One");
});

test("groups and arranges selected visuals", () => {
  const store = new SceneStore(seed());
  store.createVisual({ ...store.inspect().visuals.v1, id: "v2", layout: { x: 0, y: 0, w: 100, h: 100 } });
  store.compose({ action: "group", target: "g1", targets: ["v1", "v2"] });
  store.compose({ action: "arrange", targets: ["v1", "v2"], arrangement: "row" });
  assert.deepEqual(store.inspect().canvas.groups, [{ id: "g1", visual_ids: ["v1", "v2"] }]);
  assert.ok(store.inspect().visuals.v2.layout.x > store.inspect().visuals.v1.layout.x);
});
