import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import WebSocket from "ws";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { createMcpServer } from "../dist/mcp/server.js";
import { toolSchemas } from "../dist/mcp/schemas.js";
import { createWebServer } from "../dist/web/server.js";

function visualPatch() {
  return {
    set: {
      source: "orders",
      query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] },
      marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }],
      layout: { x: 0, y: 0, w: 480, h: 320 }
    }
  };
}

test("actual MCP, runtime, WebSocket, and HTTP flow commits one live work session", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "live-e2e", revision: 0,
    datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } },
    visuals: {}, annotations: {}, canvas: {}
  });
  const web = await createWebServer(runtime, 0);
  const mcp = createMcpServer(runtime);
  const events = [];
  const socket = new WebSocket(`ws://127.0.0.1:${web.port}/ws`);
  await new Promise((resolvePromise, reject) => {
    socket.once("open", resolvePromise);
    socket.once("error", reject);
  });
  socket.on("message", (raw) => events.push({ at: performance.now(), ...JSON.parse(raw.toString()) }));
  const call = async (name, input) => {
    const parsed = toolSchemas[name].parse(input);
    const response = await mcp._registeredTools[name].handler(parsed);
    return JSON.parse(response.content[0].text);
  };

  try {
    const started = await call("work.apply", { action: "begin" });
    const workId = started.result.work_id;
    await call("visual.create", { work_id: workId, id: "orders-by-channel", title: "Orders by channel" });
    await call("data.query", { work_id: workId, dataset: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] } });
    await call("visual.patch", { work_id: workId, id: "orders-by-channel", patch: visualPatch() });
    await call("canvas.annotate", { work_id: workId, id: "channel-note", target: "orders-by-channel", text: "B leads the observed order count" });
    const committed = await call("work.apply", { action: "commit", work_id: workId });

    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20));
    const scene = await fetch(`http://127.0.0.1:${web.port}/api/scene`).then((response) => response.json());
    const workEvents = events.filter((event) => event.work_id === workId);
    assert.equal(committed.revision, 1);
    assert.equal(scene.revision, 1);
    assert.equal(scene.visuals["orders-by-channel"].title, "Orders by channel");
    assert.equal(scene.annotations["channel-note"].target, "orders-by-channel");
    assert.ok(workEvents.some((event) => event.type === "work.started"));
    assert.ok(workEvents.some((event) => event.type === "work.visual.changed"));
    assert.ok(workEvents.some((event) => event.type === "work.activity" && event.activity?.kind === "query" && event.activity?.status === "completed"));
    assert.equal(workEvents.at(-1).type, "work.completed");
    for (let index = 1; index < workEvents.length; index += 1) assert.ok(workEvents[index].sequence > workEvents[index - 1].sequence);
  } finally {
    socket.close();
    await web.close();
    runtime.close();
  }
});
