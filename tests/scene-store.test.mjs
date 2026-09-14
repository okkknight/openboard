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

test("patches coordinate and one mark encoding in place", () => {
  const store = new SceneStore(seed());
  const result = store.patchVisual("v1", {
    set: {
      coordinate: { type: "polar" },
      "marks.bars.renderer": "primitive",
      "marks.bars.type": "arc",
      "marks.bars.encoding": { angle: { field: "orders" }, color: { field: "channel" } }
    }
  });
  assert.equal(result.revision, 1);
  assert.equal(result.visual.id, "v1");
  assert.deepEqual(result.visual.coordinate, { type: "polar" });
  assert.equal(result.visual.marks[0].renderer, "primitive");
  assert.equal(result.visual.marks[0].type, "arc");
  assert.deepEqual(result.visual.marks[0].encoding, { angle: { field: "orders" }, color: { field: "channel" } });
});

test("unsets a nested mark encoding path", () => {
  const store = new SceneStore({ ...seed(), visuals: { v1: { ...seed().visuals.v1, marks: [{ id: "bars", type: "barY", encoding: { radius: { constant: 1 }, color: { field: "channel" } } }] } } });
  const result = store.patchVisual("v1", { unset: ["marks.bars.encoding.radius"] });
  assert.deepEqual(result.visual.marks[0].encoding, { color: { field: "channel" } });
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
    (error) => error.code === "revision_conflict" && error.expected_revision === 9 && error.actual_revision === 0
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

test("commits a materialized work overlay as one durable revision and history record", () => {
  const store = new SceneStore({ ...seed(), revision: 20 });
  const effective = store.inspect();
  effective.visuals.v1.title = "Work result";
  effective.visuals.v2 = { ...effective.visuals.v1, id: "v2", title: "Comparison", layout: { x: 500, y: 0, w: 480, h: 320 } };
  effective.annotations.note = { id: "note", target: "v2", text: "Real work result", created_at: "2026-09-14T00:00:00.000Z" };

  const committed = store.commitWork(effective, { operation_count: 4 }, 20);

  assert.equal(committed.revision, 21);
  assert.equal(store.inspect().visuals.v1.title, "Work result");
  assert.equal(store.inspect().visuals.v2.title, "Comparison");
  assert.equal(store.inspect().annotations.note.text, "Real work result");
  assert.deepEqual(store.historyRecords().map((record) => [record.revision, record.operation]), [[21, "work.commit"]]);
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

test("names a checkpoint and resolves it for goto", () => {
  const store = new SceneStore(seed());
  store.patchVisual("v1", { set: { title: "Checkpoint state" } });
  store.applyHistory({ action: "checkpoint", label: "before-breakdown" });
  store.patchVisual("v1", { set: { title: "Later" } });
  store.applyHistory({ action: "goto", label: "before-breakdown" });
  assert.equal(store.inspect().visuals.v1.title, "Checkpoint state");
});

test("arranges visuals in a deterministic grid and compact row", () => {
  const store = new SceneStore(seed());
  store.createVisual({ ...store.inspect().visuals.v1, id: "v2", layout: { x: 0, y: 0, w: 100, h: 80 } });
  store.createVisual({ ...store.inspect().visuals.v1, id: "v3", layout: { x: 0, y: 0, w: 100, h: 80 } });
  store.createVisual({ ...store.inspect().visuals.v1, id: "v4", layout: { x: 0, y: 0, w: 100, h: 80 } });
  store.compose({ action: "arrange", targets: ["v1", "v2", "v3", "v4"], arrangement: "grid" });
  const grid = store.inspect();
  assert.deepEqual(
    [grid.visuals.v1, grid.visuals.v2, grid.visuals.v3, grid.visuals.v4].map((visual) => [visual.layout.x, visual.layout.y]),
    [[0, 0], [480, 0], [0, 320], [480, 320]]
  );
  store.compose({ action: "arrange", targets: ["v1", "v2", "v3", "v4"], arrangement: "compact" });
  const compact = store.inspect();
  assert.deepEqual([compact.visuals.v1.layout.x, compact.visuals.v2.layout.x, compact.visuals.v3.layout.x, compact.visuals.v4.layout.x], [0, 480, 960, 1440]);
  assert.ok([compact.visuals.v1, compact.visuals.v2, compact.visuals.v3, compact.visuals.v4].every((visual) => visual.layout.y === 0));
});

test("keeps branch history navigable after editing an earlier revision", () => {
  const store = new SceneStore(seed());
  store.patchVisual("v1", { set: { title: "One" } });
  store.patchVisual("v1", { set: { title: "Two" } });
  store.applyHistory({ action: "goto", revision: 1 });
  const branched = store.patchVisual("v1", { set: { title: "Branch" } });
  assert.equal(branched.revision, 3);
  assert.equal(store.applyHistory({ action: "undo" }).revision, 1);
  assert.equal(store.inspect().visuals.v1.title, "One");
  assert.equal(store.applyHistory({ action: "redo" }).revision, 3);
  assert.equal(store.inspect().visuals.v1.title, "Branch");
});

test("supports the complete spatial compose operation set", () => {
  const store = new SceneStore(seed());
  store.createVisual({ ...store.inspect().visuals.v1, id: "v2", layout: { x: 0, y: 0, w: 100, h: 100 } });
  store.compose({ action: "move", target: "v2", layout: { x: 20, y: 30, w: 100, h: 100 } });
  store.compose({ action: "resize", target: "v2", layout: { x: 20, y: 30, w: 200, h: 160 } });
  store.compose({ action: "focus", target: "v2" });
  assert.deepEqual(store.inspect().visuals.v2.layout, { x: 20, y: 30, w: 200, h: 160 });
  assert.equal(store.inspect().canvas.focus, "v2");
  store.compose({ action: "delete", target: "v2" });
  assert.equal(store.inspect().visuals.v2, undefined);
});
