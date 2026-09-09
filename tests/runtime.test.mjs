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
