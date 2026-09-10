import test from "node:test";
import assert from "node:assert/strict";
import { TOOL_NAMES } from "../dist/mcp/server.js";
import { toolSchemas } from "../dist/mcp/schemas.js";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { resolve } from "node:path";

test("exposes exactly the nine frozen MCP tool names", () => {
  assert.deepEqual(TOOL_NAMES, [
    "canvas.inspect", "data.inspect", "data.query", "visual.create", "visual.patch",
    "visual.clone", "canvas.compose", "canvas.annotate", "history.apply"
  ]);
});

test("validates frozen tool inputs without accepting unknown properties", () => {
  const query = toolSchemas["data.query"].parse({ dataset: "orders", query: { dimensions: [{ field: "channel" }] } });
  assert.equal(query.dataset, "orders");
  assert.throws(() => toolSchemas["data.query"].parse({ dataset: "orders", query: {}, extra: true }));
  const create = toolSchemas["visual.create"].parse({ source: "orders", query: {}, marks: [] });
  assert.equal(create.kind, "plot");
  assert.equal(create.placement, "auto");
});

test("returns a structured render-limit status from the MCP adapter", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "mcp-limit", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} }, undefined, undefined, { point_limit: 2 });
  const server = (await import("../dist/mcp/server.js")).createMcpServer(runtime);
  const response = await server._registeredTools["visual.create"].handler({ source: "orders", query: { dimensions: [{ field: "created_at" }] }, marks: [] });
  const payload = JSON.parse(response.content[0].text);
  assert.equal(payload.status, "render_limit_exceeded");
  assert.equal(payload.result.requested_rows, 16);
  assert.deepEqual(payload.result.suggestions, ["aggregate", "bin", "explicit_sample"]);
  runtime.close();
});

test("canvas.inspect exposes render capabilities", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "inspect", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = (await import("../dist/mcp/server.js")).createMcpServer(runtime);
  const response = await server._registeredTools["canvas.inspect"].handler({ include: ["capabilities"] });
  const payload = JSON.parse(response.content[0].text);
  assert.deepEqual(payload.result.capabilities, { point_limit: 50000, marks: ["barX", "barY", "lineX", "lineY", "areaX", "areaY", "dot", "rect", "cell", "ruleX", "ruleY", "text", "tickX", "tickY", "boxX", "boxY"] });
  runtime.close();
});
