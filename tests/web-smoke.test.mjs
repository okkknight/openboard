import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { createWebServer } from "../dist/web/server.js";

test("serves the current durable scene snapshot", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "web", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/scene`);
    assert.deepEqual(await response.json(), runtime.inspect());
  } finally { await server.close(); runtime.close(); }
});
