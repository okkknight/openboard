import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_NAMES } from "../dist/mcp/server.js";
import { toolSchemas } from "../dist/mcp/schemas.js";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { resolve } from "node:path";
import { readFile } from "node:fs/promises";

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

test("accepts typed annotation patches and atomic layout updates", () => {
  assert.equal(toolSchemas["canvas.annotate"].parse({
    mode: "patch",
    id: "insight",
    patch: { text: "Channel B drives 60%", style: { variant: "insight", align: "start" } }
  }).mode, "patch");

  const compose = toolSchemas["canvas.compose"].parse({
    action: "move",
    layout_updates: [
      { target: { kind: "visual", id: "orders" }, layout: { x: 20, y: 40, w: 480, h: 320 } },
      { target: { kind: "annotation", id: "insight" }, layout: { x: 520, y: 40, w: 280, h: 120 } }
    ]
  });
  assert.equal(compose.layout_updates.length, 2);
});

test("rejects empty annotation patches and ambiguous or duplicate layout batches", () => {
  assert.throws(() => toolSchemas["canvas.annotate"].parse({ mode: "patch", id: "a", patch: {} }));
  assert.throws(() => toolSchemas["canvas.compose"].parse({
    action: "move",
    target: "orders",
    layout: { x: 0, y: 0, w: 10, h: 10 },
    layout_updates: [{ target: { kind: "visual", id: "orders" }, layout: { x: 1, y: 1, w: 10, h: 10 } }]
  }));
  assert.throws(() => toolSchemas["canvas.compose"].parse({
    action: "move",
    layout_updates: [
      { target: { kind: "visual", id: "orders" }, layout: { x: 0, y: 0, w: 10, h: 10 } },
      { target: { kind: "visual", id: "orders" }, layout: { x: 20, y: 0, w: 10, h: 10 } }
    ]
  }));
});

test("publishes matching scene and tool JSON contracts for canvas objects", async () => {
  const scene = JSON.parse(await readFile(new URL("../contracts/scene.schema.json", import.meta.url), "utf8"));
  const surface = JSON.parse(await readFile(new URL("../contracts/tool-surface.json", import.meta.url), "utf8"));
  const annotate = surface.tools.find((tool) => tool.name === "canvas.annotate").input;
  const compose = surface.tools.find((tool) => tool.name === "canvas.compose").input;

  assert.deepEqual(scene.$defs.annotationStyle.properties.variant.enum, ["caption", "body", "insight", "callout"]);
  assert.equal(scene.$defs.annotation.properties.layout.$ref, "#/$defs/layout");
  assert.equal(annotate.oneOf.length, 2);
  assert.equal(compose.properties.layout_updates.minItems, 1);
  assert.equal(compose.properties.layout_updates.items.$ref, "scene.schema.json#/$defs/layoutUpdate");
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

test("routes annotation patch mode through the MCP adapter", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "mcp-annotation", revision: 0, datasets: {}, visuals: {},
    annotations: { a1: { id: "a1", text: "Before", created_at: "2026-09-17T00:00:00.000Z" } }, canvas: {}
  });
  const server = (await import("../dist/mcp/server.js")).createMcpServer(runtime);
  const response = await server._registeredTools["canvas.annotate"].handler({ mode: "patch", id: "a1", patch: { text: "After", style: { variant: "insight" } } });
  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.status, "ok");
  assert.equal(runtime.inspect().annotations.a1.text, "After");
  runtime.close();
});
