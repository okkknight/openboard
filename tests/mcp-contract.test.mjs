import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_NAMES } from "../dist/mcp/server.js";
import { toolSchemas } from "../dist/mcp/schemas.js";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { resolve } from "node:path";

test("adds only work.apply to the frozen MCP tool set", () => {
  assert.deepEqual(TOOL_NAMES, [
    "canvas.inspect", "data.inspect", "data.query", "visual.create", "visual.patch",
    "visual.clone", "canvas.compose", "canvas.annotate", "history.apply", "work.apply"
  ]);
});

test("validates frozen tool inputs without accepting unknown properties", () => {
  const query = toolSchemas["data.query"].parse({ dataset: "orders", query: { dimensions: [{ field: "channel" }] } });
  assert.equal(query.dataset, "orders");
  assert.throws(() => toolSchemas["data.query"].parse({ dataset: "orders", query: {}, extra: true }));
  const create = toolSchemas["visual.create"].parse({ id: "orders-chart", source: "orders", query: {}, marks: [], work_id: "work_1" });
  assert.equal(create.kind, "plot");
  assert.equal(create.placement, "auto");
  const draft = toolSchemas["visual.create"].parse({ id: "draft", title: "Early intent", work_id: "work_1" });
  assert.equal(draft.work_id, "work_1");
  assert.equal(draft.title, "Early intent");
  assert.deepEqual(toolSchemas["work.apply"].parse({ action: "begin" }), { action: "begin" });
  assert.throws(() => toolSchemas["visual.create"].parse({ id: "not-a-draft" }), /work_id/);
  assert.throws(() => toolSchemas["visual.patch"].parse({ id: "chart", patch: {} }), /work_id/);
  assert.throws(() => toolSchemas["visual.clone"].parse({ id: "chart" }), /work_id/);
});

test("accepts open visual grammar fields without chart-template names", () => {
  const create = toolSchemas["visual.create"].parse({
    id: "pie",
    work_id: "work_1",
    source: "orders",
    coordinate: { type: "polar" },
    query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] },
    marks: [{
      id: "slices",
      renderer: "primitive",
      type: "arc",
      encoding: {
        angle: { field: "orders" },
        color: { field: "channel" },
        innerRadius: { constant: 0 }
      }
    }]
  });
  assert.deepEqual(create.coordinate, { type: "polar" });
  assert.equal(create.marks[0].renderer, "primitive");
  assert.equal(create.marks[0].type, "arc");
  assert.throws(() => toolSchemas["visual.create"].parse({
    id: "unsafe", work_id: "work_1", source: "orders", query: {}, marks: [{ id: "bad", renderer: "primitive", type: "path", options: { d: "M0 0; <script>" } }]
  }));
});

test("returns a structured render-limit status from the MCP adapter", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "mcp-limit", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} }, undefined, undefined, { point_limit: 2 });
  const server = (await import("../dist/mcp/server.js")).createMcpServer(runtime);
  const started = await server._registeredTools["work.apply"].handler({ action: "begin" });
  const workId = JSON.parse(started.content[0].text).result.work_id;
  const response = await server._registeredTools["visual.create"].handler({ id: "limited", work_id: workId, source: "orders", query: { dimensions: [{ field: "created_at" }] }, marks: [] });
  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.status, "render_limit_exceeded");
  assert.equal(payload.result.requested_rows, 16);
  assert.deepEqual(payload.result.suggestions, ["aggregate", "bin", "explicit_sample"]);
  await server._registeredTools["work.apply"].handler({ action: "cancel", work_id: workId });
  runtime.close();
});

test("canvas.inspect exposes render capabilities", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "inspect", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = (await import("../dist/mcp/server.js")).createMcpServer(runtime);
  const response = await server._registeredTools["canvas.inspect"].handler({ include: ["capabilities"] });
  const payload = JSON.parse(response.content[0].text);
  assert.deepEqual(payload.result.capabilities, { point_limit: 50000, marks: ["barX", "barY", "lineX", "lineY", "areaX", "areaY", "dot", "rect", "cell", "ruleX", "ruleY", "text", "tickX", "tickY", "boxX", "boxY"], primitives: ["rect", "circle", "line", "arc", "path", "text", "area"] });
  runtime.close();
});
