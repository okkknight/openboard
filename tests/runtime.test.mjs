import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { Persistence } from "../dist/runtime/persistence.js";
import { createInWork, patchInWork } from "./work-helpers.mjs";

test("creates then patches the same visual and emits its new revision", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "test",
    revision: 0,
    datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } },
    visuals: {}, annotations: {}, canvas: {}
  });
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const created = await createInWork(runtime, {
    id: "v1", kind: "plot", source: "orders",
    query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] },
    marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }],
    layout: { x: 0, y: 0, w: 480, h: 320 }
  });
  const patched = await patchInWork(runtime, "v1", { set: { title: "Orders by channel" } });
  assert.equal(patched.result.visual.id, "v1");
  assert.equal(patched.revision, 2);
  assert.equal(created.revision, 1);
  assert.deepEqual(events.filter((event) => event.type.startsWith("work.")).map((event) => event.type).filter((type) => type === "work.completed"), ["work.completed", "work.completed"]);
  runtime.close();
});

test("persists a committed visual scene before returning", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "openboard-runtime-"));
  try {
    const runtime = new DataCanvasRuntime({ canvas_id: "persist", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} }, new Persistence(root));
    await createInWork(runtime, { id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
    assert.equal((await new Persistence(root).loadScene()).revision, 1);
    runtime.close();
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("inspects and queries registered data without creating a visual", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "data", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  const begun = await runtime.workApply({ action: "begin" });
  const profile = await runtime.dataInspect("orders", {}, begun.result.work_id);
  assert.equal(profile.row_count, 20);
  assert.equal(profile.top_values.channel[0].value, "B");
  assert.equal(profile.top_values.channel[0].count, 12);
  const result = await runtime.dataQuery("orders", { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, begun.result.work_id);
  assert.equal(result.observation.row_count, 4);
  await runtime.workApply({ action: "cancel", work_id: begun.result.work_id });
  runtime.close();
});

test("clones a visual and persists compose and annotation mutations", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "scene", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await createInWork(runtime, { id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
  const cloneWork = await runtime.workApply({ action: "begin" });
  const clone = await runtime.visualClone("v1", "v2", undefined, undefined, cloneWork.result.work_id);
  await runtime.workApply({ action: "commit", work_id: cloneWork.result.work_id });
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
    await createInWork(first, { id: "v1", kind: "plot", source: "orders", title: "Before", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
    await patchInWork(first, "v1", { set: { title: "After" } });
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
    await createInWork(first, { id: "v1", kind: "plot", source: "orders", title: "Baseline", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
    const checkpoint = await first.historyApply({ action: "checkpoint", label: "baseline" });
    await patchInWork(first, "v1", { set: { title: "Changed" } });
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
  const limitWork = await runtime.workApply({ action: "begin" });
  await assert.rejects(() => runtime.visualCreate({
    id: "too-many-points", kind: "plot", source: "orders",
    query: { dimensions: [{ field: "created_at" }] }, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 }
  }, undefined, limitWork.result.work_id), /render_limit_exceeded/);
  await runtime.workApply({ action: "cancel", work_id: limitWork.result.work_id });
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
  await createInWork(runtime, { id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
  await runtime.canvasCompose({ action: "focus", target: "v1" });
  await runtime.canvasCompose({ action: "move", target: "v1", layout: { x: 2, y: 3, w: 1, h: 1 } });
  await runtime.canvasAnnotate({ id: "a1", target: "v1", text: "note", created_at: "2026-09-10T00:00:00.000Z" });
  await runtime.historyApply({ action: "checkpoint", label: "m" });
  assert.deepEqual(events.filter((event) => !event.type.startsWith("work.")).map((event) => event.type), ["focus.changed", "layout.changed", "annotation.created", "history.changed"]);
  runtime.close();
});

test("broadcasts typed affected objects for one atomic layout commit", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "typed-layout", revision: 4, datasets: {},
    visuals: { v1: { id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 480, h: 320 } } },
    annotations: { a1: { id: "a1", text: "Explain", layout: { x: 500, y: 0, w: 240, h: 120 }, created_at: "2026-09-17T00:00:00.000Z" } },
    canvas: {}
  });
  const events = [];
  runtime.onEvent((event) => events.push(event));

  await runtime.canvasCompose({ action: "move", layout_updates: [
    { target: { kind: "visual", id: "v1" }, layout: { x: 40, y: 40, w: 480, h: 320 } },
    { target: { kind: "annotation", id: "a1" }, layout: { x: 540, y: 40, w: 240, h: 120 } }
  ] }, 4);

  assert.deepEqual(events.at(-1).affected_objects, [
    { kind: "visual", id: "v1" }, { kind: "annotation", id: "a1" }
  ]);
  assert.deepEqual(events.at(-1).affected_ids, ["v1"]);
  assert.equal(runtime.inspect().revision, 5);
  runtime.close();
});

test("creates and patches annotations through one explicit runtime mutation surface", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "annotation-mutation", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  await runtime.canvasAnnotate({ mode: "create", id: "a1", text: "Before", layout: { x: 0, y: 0, w: 240, h: 100 }, style: { variant: "body" } });
  await runtime.canvasAnnotate({ mode: "patch", id: "a1", patch: { text: "After", style: { variant: "insight", align: "center" } } }, 1);
  assert.equal(runtime.inspect().revision, 2);
  assert.equal(runtime.inspect().annotations.a1.text, "After");
  assert.deepEqual(runtime.inspect().annotations.a1.style, { variant: "insight", align: "center" });
  runtime.close();
});

test("undoes and redoes one atomic mixed-object layout history record", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "mixed-history", revision: 0, datasets: {},
    visuals: { v1: { id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 300, h: 200 } } },
    annotations: { a1: { id: "a1", text: "Note", layout: { x: 320, y: 0, w: 180, h: 80 }, created_at: "2026-09-17T00:00:00.000Z" } }, canvas: {}
  });
  await runtime.canvasCompose({ action: "move", layout_updates: [
    { target: { kind: "visual", id: "v1" }, layout: { x: 20, y: 30, w: 300, h: 200 } },
    { target: { kind: "annotation", id: "a1" }, layout: { x: 340, y: 30, w: 180, h: 80 } }
  ] });
  assert.equal(runtime.inspect().revision, 1);
  await runtime.historyApply({ action: "undo" });
  assert.equal(runtime.inspect().visuals.v1.layout.x, 0);
  assert.equal(runtime.inspect().annotations.a1.layout.x, 320);
  await runtime.historyApply({ action: "redo" });
  assert.equal(runtime.inspect().visuals.v1.layout.x, 20);
  assert.equal(runtime.inspect().annotations.a1.layout.x, 340);
  runtime.close();
});

test("routes visual and data raw SQL through the read-only guard", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "raw", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await assert.rejects(() => runtime.dataQuery("orders", { sql: "DELETE FROM orders" }), /query_rejected/);
  const unsafeWork = await runtime.workApply({ action: "begin" });
  await assert.rejects(() => runtime.visualCreate({ id: "unsafe", kind: "plot", source: "orders", query: { sql: "INSERT INTO orders VALUES (1)" }, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } }, undefined, unsafeWork.result.work_id), /query_rejected/);
  await runtime.workApply({ action: "cancel", work_id: unsafeWork.result.work_id });
  runtime.close();
});

test("patches a channel failure visual into a daily trend in place", async () => {
  const root = await mkdtemp(resolve(tmpdir(), "openboard-last-days-"));
  const today = new Date().toISOString().slice(0, 10);
  const recent = new Date(Date.now() - 20 * 86_400_000).toISOString().slice(0, 10);
  const path = resolve(root, "orders.csv");
  await writeFile(path, `created_at,channel,status\n${recent},A,FAILED\n${today},B,SUCCESS\n`);
  const runtime = new DataCanvasRuntime({ canvas_id: "m0", revision: 0, datasets: { orders: { id: "orders", path, format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  try {
    const created = await createInWork(runtime, { id: "v1", kind: "plot", title: "Failure by channel", source: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }, { expr: "avg(case when status='FAILED' then 1 else 0 end)", alias: "failure_rate" }] }, marks: [{ id: "failure", type: "barY", x: "channel", y: "failure_rate" }], layout: { x: 0, y: 0, w: 480, h: 320 } });
    const patched = await patchInWork(runtime, "v1", { set: { title: "Daily failure-rate trend", "query.filters": [{ field: "created_at", op: "last_days", value: 30 }], "query.dimensions": [{ field: "created_at", time_grain: "day", alias: "day" }] }, remove_marks: ["failure"], add_marks: [{ id: "trend", type: "lineY", x: "day", y: "failure_rate" }] });
    assert.equal(patched.result.visual.id, "v1");
    assert.equal(patched.revision, created.revision + 1);
    assert.equal(patched.result.visual.marks[0].id, "trend");
    assert.ok(patched.observation.row_count > 0);
  } finally {
    runtime.close();
    await rm(root, { recursive: true, force: true });
  }
});
