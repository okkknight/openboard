import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { createWebServer } from "../dist/web/server.js";
import WebSocket from "ws";

test("serves the current durable scene snapshot", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "web", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/scene`);
    assert.deepEqual(await response.json(), runtime.inspect());
  } finally { await server.close(); runtime.close(); }
});

test("broadcasts a visual mutation revision over WebSocket", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "socket", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await runtime.visualCreate({ id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
  const server = await createWebServer(runtime, 0);
  try {
    const event = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      socket.once("open", async () => { await runtime.visualPatch("v1", { set: { title: "Patched" } }); });
      socket.once("message", (data) => { socket.close(); resolve(JSON.parse(data.toString())); });
      socket.once("error", reject);
    });
    assert.deepEqual(event, { type: "visual.changed", canvas_id: "socket", revision: 2, visual_id: "v1" });
  } finally { await server.close(); runtime.close(); }
});
