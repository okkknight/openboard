import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { Persistence } from "../dist/runtime/persistence.js";

test("creates then patches the same visual and emits its new revision", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "test",
    revision: 0,
    datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } },
    visuals: {}, annotations: {}, canvas: {}
  });
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const created = await runtime.visualCreate({
    id: "v1", kind: "plot", source: "orders",
    query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] },
    marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }],
    layout: { x: 0, y: 0, w: 480, h: 320 }
  });
  const patched = await runtime.visualPatch("v1", { set: { title: "Orders by channel" } }, created.revision);
  assert.equal(patched.result.visual.id, "v1");
  assert.equal(patched.revision, 2);
  assert.deepEqual(events.map((event) => event.type), ["visual.created", "visual.changed"]);
  runtime.close();
});

test("persists a committed visual scene before returning", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "openboard-runtime-"));
  try {
    const runtime = new DataCanvasRuntime({ canvas_id: "persist", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} }, new Persistence(root));
    await runtime.visualCreate({ id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
    assert.equal((await new Persistence(root).loadScene()).revision, 1);
    runtime.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("inspects and queries registered data without creating a visual", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "data", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  const profile = await runtime.dataInspect("orders");
  assert.equal(profile.row_count, 20);
  assert.equal(profile.top_values.channel[0].value, "B");
  assert.equal(profile.top_values.channel[0].count, 12);
  const result = await runtime.dataQuery("orders", { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] });
  assert.equal(result.observation.row_count, 4);
  runtime.close();
});

test("clones a visual and persists compose and annotation mutations", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "scene", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await runtime.visualCreate({ id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
  const clone = await runtime.visualClone("v1", "v2");
  assert.equal(clone.result.visual.derived_from, "v1");
  await runtime.canvasCompose({ action: "focus", target: "v2" });
  await runtime.canvasAnnotate({ id: "a1", target: "v2", text: "Compare", created_at: "2026-09-09T00:00:00.000Z" });
  assert.equal(runtime.inspect().revision, 4);
  runtime.close();
});

test("restores persisted snapshots so history can undo after a restart", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "openboard-restart-"));
  try {
    const scene = { canvas_id: "restart", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} };
    const persistence = new Persistence(root);
    const first = new DataCanvasRuntime(scene, persistence);
    await first.visualCreate({ id: "v1", kind: "plot", source: "orders", title: "Before", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
    await first.visualPatch("v1", { set: { title: "After" } });
    first.close();

    const restoredScene = await persistence.loadScene();
    const restoredHistory = await persistence.loadHistory();
    const snapshotRevisions = await persistence.listSnapshotRevisions();
    const snapshots = [];
    for (const revision of snapshotRevisions) snapshots.push(await persistence.loadSnapshot(revision));
    const restarted = new DataCanvasRuntime(restoredScene, persistence, { records: restoredHistory, snapshots });
    const undone = await restarted.historyApply({ action: "undo" });
    assert.equal(undone.revision, 1);
    assert.equal(restarted.inspect().visuals.v1.title, "Before");
    restarted.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("persists checkpoints and exposes fork lineage after restart", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "openboard-lineage-"));
  try {
    const scene = { canvas_id: "lineage", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} };
    const persistence = new Persistence(root);
    const first = new DataCanvasRuntime(scene, persistence);
    await first.visualCreate({ id: "v1", kind: "plot", source: "orders", title: "Baseline", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
    const checkpoint = await first.historyApply({ action: "checkpoint", label: "baseline" });
    await first.visualPatch("v1", { set: { title: "Changed" } });
    first.close();

    const restoredScene = await persistence.loadScene();
    const restoredHistory = await persistence.loadHistory();
    const snapshots = [];
    for (const revision of await persistence.listSnapshotRevisions()) snapshots.push(await persistence.loadSnapshot(revision));
    const metadata = await persistence.loadMetadata();
    const restarted = new DataCanvasRuntime(restoredScene, persistence, { records: restoredHistory, snapshots, checkpoints: metadata.checkpoints });
    const restored = await restarted.historyApply({ action: "goto", label: "baseline" });
    assert.equal(restored.revision, checkpoint.revision);
    assert.equal(restarted.inspect().visuals.v1.title, "Baseline");
    const fork = await restarted.historyApply({ action: "fork" });
    assert.equal(fork.result.parent_revision, checkpoint.revision);
    assert.match(fork.result.branch_id, /^lineage\/fork\//);
    restarted.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("blocks an unbounded visual render at the configured point limit", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "limit",
    revision: 0,
    datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } },
    visuals: {}, annotations: {}, canvas: {}
  }, undefined, undefined, { point_limit: 2 });
  await assert.rejects(() => runtime.visualCreate({
    id: "too-many-points", kind: "plot", source: "orders",
    query: { dimensions: [{ field: "created_at" }] }, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 }
  }), /render_limit_exceeded/);
  runtime.close();
});

test("broadcasts scene events for composition, annotations, and history", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "events",
    revision: 0,
    datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } },
    visuals: {}, annotations: {}, canvas: {}
  });
  const events = [];
  runtime.onEvent((event) => events.push(event));
  await runtime.visualCreate({ id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
  await runtime.canvasCompose({ action: "focus", target: "v1" });
  await runtime.canvasCompose({ action: "move", target: "v1", layout: { x: 2, y: 3, w: 1, h: 1 } });
  await runtime.canvasAnnotate({ id: "a1", target: "v1", text: "note", created_at: "2026-09-10T00:00:00.000Z" });
  await runtime.historyApply({ action: "checkpoint", label: "m" });
  assert.deepEqual(events.map((event) => event.type), ["visual.created", "focus.changed", "layout.changed", "annotation.created", "history.changed"]);
  runtime.close();
});

test("routes visual and data raw SQL through the read-only guard", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "raw", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await assert.rejects(() => runtime.dataQuery("orders", { sql: "DELETE FROM orders" }), /query_rejected/);
  await assert.rejects(() => runtime.visualCreate({ id: "unsafe", kind: "plot", source: "orders", query: { sql: "INSERT INTO orders VALUES (1)" }, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } }), /query_rejected/);
  runtime.close();
});

test("patches a channel failure visual into a daily trend in place", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "m0", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  const created = await runtime.visualCreate({ id: "v1", kind: "plot", title: "Failure by channel", source: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }, { expr: "avg(case when status='FAILED' then 1 else 0 end)", alias: "failure_rate" }] }, marks: [{ id: "failure", type: "barY", x: "channel", y: "failure_rate" }], layout: { x: 0, y: 0, w: 480, h: 320 } });
  const patched = await runtime.visualPatch("v1", { set: { title: "Daily failure-rate trend", "query.filters": [{ field: "created_at", op: "last_days", value: 30 }], "query.dimensions": [{ field: "created_at", time_grain: "day", alias: "day" }] }, remove_marks: ["failure"], add_marks: [{ id: "trend", type: "lineY", x: "day", y: "failure_rate" }] }, created.revision);
  assert.equal(patched.result.visual.id, "v1");
  assert.equal(patched.revision, created.revision + 1);
  assert.equal(patched.result.visual.marks[0].id, "trend");
  assert.ok(patched.observation.row_count > 0);
  runtime.close();
});
