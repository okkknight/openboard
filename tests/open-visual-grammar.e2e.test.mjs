import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { createInWork } from "./work-helpers.mjs";

function runtime(canvas_id) {
  return new DataCanvasRuntime({ canvas_id, revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
}

test("patches one visual from bar to pie to donut to radial without changing its query", async () => {
  const app = runtime("grammar");
  try {
    const query = { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] };
    const begun = await app.workApply({ action: "begin" });
    await app.visualCreate({ id: "orders-by-channel", kind: "plot", source: "orders", query, marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }], layout: { x: 0, y: 0, w: 480, h: 320 } }, undefined, begun.result.work_id);
    const pie = await app.visualPatch("orders-by-channel", { set: { coordinate: { type: "polar" }, "marks.bars.renderer": "primitive", "marks.bars.type": "arc", "marks.bars.encoding": { angle: { field: "orders" }, color: { field: "channel" } } } }, undefined, begun.result.work_id);
    assert.equal(pie.result.visual.id, "orders-by-channel");
    assert.deepEqual(pie.result.visual.query, query);
    assert.equal(pie.result.visual.coordinate.type, "polar");
    assert.equal(pie.result.plot.primitives[0].type, "arc");
    const donut = await app.visualPatch("orders-by-channel", { set: { "marks.bars.encoding.innerRadius": { constant: 0.55 } } }, undefined, begun.result.work_id);
    assert.equal(donut.result.plot.primitives[0].values[0].innerRadius, 0.55);
    const radial = await app.visualPatch("orders-by-channel", { set: { "marks.bars.encoding.radius": { field: "orders" } } }, undefined, begun.result.work_id);
    assert.equal(radial.revision, 0);
    assert.equal(Math.max(...radial.result.plot.primitives[0].values.map((row) => row.outerRadius)), 1);
    await app.workApply({ action: "commit", work_id: begun.result.work_id });
  } finally { app.close(); }
});

test("renders mixed Plot and primitive layers plus a custom path visual", async () => {
  const app = runtime("mixed");
  try {
    const mixed = await createInWork(app, { id: "mixed", kind: "plot", source: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, coordinate: { type: "cartesian" }, marks: [
      { id: "bars", type: "barY", x: "channel", y: "orders" },
      { id: "rule", renderer: "primitive", type: "line", encoding: { x1: { constant: 0 }, y1: { constant: 10 }, x2: { constant: 100 }, y2: { constant: 10 }, stroke: { constant: "#f6c86e" } } },
      { id: "label", renderer: "primitive", type: "text", encoding: { x: { constant: 10 }, y: { constant: 20 }, text: { constant: "orders" } } }
    ], layout: { x: 0, y: 0, w: 480, h: 320 } });
    assert.equal(mixed.result.plot.marks[0].type, "barY");
    assert.deepEqual(mixed.result.plot.primitives.map((layer) => layer.type), ["line", "text"]);
    const custom = await createInWork(app, { id: "custom", kind: "plot", source: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, marks: [
      { id: "path", renderer: "primitive", type: "path", options: { d: "M0 0 L20 0 L10 20 Z", fill: "#6bd8c4" } },
      { id: "circle", renderer: "primitive", type: "circle", encoding: { x: { constant: 30 }, y: { constant: 30 }, radius: { constant: 4 } } },
      { id: "text", renderer: "primitive", type: "text", encoding: { x: { constant: 40 }, y: { constant: 40 }, text: { constant: "custom" } } }
    ], layout: { x: 0, y: 0, w: 480, h: 320 } });
    assert.deepEqual(custom.result.plot.primitives.map((layer) => layer.type), ["path", "circle", "text"]);
  } finally { app.close(); }
});

test("rejects unsafe primitive path data as a structured runtime error", async () => {
  const app = runtime("security");
  try {
    const unsafe = await app.workApply({ action: "begin" });
    await assert.rejects(() => app.visualCreate({ id: "unsafe", kind: "plot", source: "orders", query: {}, marks: [{ id: "p", renderer: "primitive", type: "path", options: { d: "M0 0 <script>" } }], layout: { x: 0, y: 0, w: 200, h: 200 } }, undefined, unsafe.result.work_id), /invalid_path|unsafe/);
    await app.workApply({ action: "cancel", work_id: unsafe.result.work_id });
  } finally { app.close(); }
});
