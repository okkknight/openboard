import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";

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
