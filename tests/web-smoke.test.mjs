import test from "node:test";
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { DataCanvasRuntime } from "../dist/runtime/data-canvas-runtime.js";
import { createWebServer } from "../dist/web/server.js";
import { createMcpHandler } from "@modelcontextprotocol/server";
import { createMcpServer } from "../dist/mcp/server.js";
import { createInWork } from "./work-helpers.mjs";
import WebSocket from "ws";

async function readMcpJson(response) {
  const body = await response.text();
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const data = body.split("\n").find((line) => line.startsWith("data: "));
    assert.ok(data, `MCP SSE response did not contain a data event: ${body}`);
    return JSON.parse(data.slice("data: ".length));
  }
  return JSON.parse(body);
}

test("serves the current durable scene snapshot", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "web", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/scene`);
    assert.deepEqual(await response.json(), runtime.inspect());
  } finally { await server.close(); runtime.close(); }
});

test("commits layout batches and annotation patches through strict HTTP endpoints", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "browser-mutations", revision: 3, datasets: {},
    visuals: { v1: { id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 300, h: 200 } } },
    annotations: { a1: { id: "a1", text: "Before", layout: { x: 320, y: 0, w: 180, h: 80 }, created_at: "2026-09-17T00:00:00.000Z" } },
    canvas: {}
  });
  const server = await createWebServer(runtime, 0);
  const post = (path, body) => fetch(`http://127.0.0.1:${server.port}${path}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  try {
    const composed = await post("/api/canvas/compose", { action: "move", expected_revision: 3, layout_updates: [
      { target: { kind: "visual", id: "v1" }, layout: { x: 20, y: 20, w: 300, h: 200 } },
      { target: { kind: "annotation", id: "a1" }, layout: { x: 340, y: 20, w: 180, h: 80 } }
    ] });
    assert.equal(composed.status, 200);
    assert.equal((await composed.json()).revision, 4);

    const stale = await post("/api/canvas/compose", { action: "move", target: "v1", layout: { x: 40, y: 40, w: 300, h: 200 }, expected_revision: 3 });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, "revision_conflict");

    const patched = await post("/api/canvas/annotate", { mode: "patch", id: "a1", patch: { text: "After", style: { variant: "callout" } }, expected_revision: 4 });
    assert.equal(patched.status, 200);
    assert.equal(runtime.inspect().annotations.a1.text, "After");
    assert.deepEqual(runtime.inspect().annotations.a1.style, { variant: "callout" });
  } finally { await server.close(); runtime.close(); }
});

test("serves a deployment health check with the current canvas revision", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "health", revision: 3, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/healthz`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "ok", service: "openboard", canvas_id: "health", revision: 3 });
  } finally { await server.close(); runtime.close(); }
});

test("serves canvas assets, API requests, and WebSocket under a configured public base path", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "base-path", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0, undefined, { basePath: "/openboard" });
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /src="\/openboard\/assets\/d3\.js"/);
    assert.match(html, /from '\/openboard\/assets\/work-event-order\.js'/);
    assert.match(html, /const appPath = \(path\) => `\$\{basePath\}\$\{path\}`/);
    assert.match(html, /\$\{basePath\}\/ws/);
  } finally { await server.close(); runtime.close(); }
});

test("serves the canvas shell and module assets when a release query string is present", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "release-query", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const page = await fetch(`http://127.0.0.1:${server.port}/?release=lc2`).then((response) => response.text());
    const module = await fetch(`http://127.0.0.1:${server.port}/assets/render-motion.js?v=lc2`).then((response) => response.text());
    assert.match(page, /OpenBoard/);
    assert.match(module, /createRenderMotion/);
  } finally { await server.close(); runtime.close(); }
});

test("serves the pure canvas geometry module", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "geometry-asset", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/assets/canvas-geometry.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /export function snapLayouts/);
  } finally { await server.close(); runtime.close(); }
});

test("serves the DOM-independent canvas interaction controller", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "interaction-asset", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/assets/canvas-interaction.js`);
    assert.equal(response.status, 200);
    assert.match(await response.text(), /export function createInteractionController/);
  } finally { await server.close(); runtime.close(); }
});

test("serves MCP HTTP requests through the same runtime as the web canvas", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "mcp-http", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const mcp = createMcpHandler(() => createMcpServer(runtime), { legacy: "stateless" });
  const server = await createWebServer(runtime, 0, mcp);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } })
    });
    assert.equal(response.status, 200);
    const body = await readMcpJson(response);
    assert.equal(body.result.serverInfo.name, "openboard");
  } finally { await server.close(); await mcp.close(); runtime.close(); }
});

test("protects MCP HTTP requests with a configured bearer token", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "mcp-auth", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const mcp = createMcpHandler(() => createMcpServer(runtime), { legacy: "stateless" });
  const server = await createWebServer(runtime, 0, mcp, { mcpToken: "test-token" });
  try {
    const unauthorized = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } })
    });
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get("www-authenticate"), "Bearer");

    const authorized = await fetch(`http://127.0.0.1:${server.port}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: "Bearer test-token" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } } })
    });
    assert.equal(authorized.status, 200);
    assert.equal((await readMcpJson(authorized)).result.serverInfo.name, "openboard");
  } finally { await server.close(); await mcp.close(); runtime.close(); }
});

test("serves the spatial canvas controls and connection indicator", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "ui", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /Data canvas viewport/);
    assert.match(html, /Fit view/);
    assert.match(html, /Reset view/);
    assert.match(html, /id="connection"/);
  } finally { await server.close(); runtime.close(); }
});

test("serves a reversible Canvas details toggle", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "details-toggle", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /id="toggle-details"/);
    assert.match(html, /aria-controls="canvas-details"/);
    assert.match(html, /details-hidden/);
  } finally { await server.close(); runtime.close(); }
});

test("keeps Canvas details hidden on first load", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "details-default", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /<main id="canvas-layout" class="details-hidden">/);
    assert.match(html, /<button id="show-details" type="button" aria-controls="canvas-details">Show details<\/button>/);
    assert.match(html, /<aside id="canvas-details" aria-label="Canvas details" hidden>/);
    assert.match(html, /aria-expanded="false">Show details|aria-expanded="false"/);
  } finally { await server.close(); runtime.close(); }
});

test("serves a vivid categorical palette for Plot marks", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "palette", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /const plotPalette = \['#6bd8c4', '#f6c86e', '#8aa6ff'/);
    assert.match(html, /color: \{ range: plotPalette \}/);
  } finally { await server.close(); runtime.close(); }
});

test("serves entrance animations without storing animation state in the scene", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "motion", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /prefers-reduced-motion/);
    assert.match(html, /animatePlotMarks/);
    assert.match(html, /animateArc/);
    assert.match(html, /animatePrimitiveMark/);
    assert.match(html, /type === 'text'/);
    assert.match(html, /renderedVisualSignatures/);
  } finally { await server.close(); runtime.close(); }
});

test("serves websocket reconnect logic that reloads the scene", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "reconnect", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /function connectSocket/);
    assert.match(html, /scheduleSocketReconnect/);
    assert.match(html, /setTimeout/);
    assert.match(html, /await reloadScene\(\)/);
  } finally { await server.close(); runtime.close(); }
});

test("keeps newly created visuals visible in the actual browser viewport", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "viewport-visibility", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /function revealNewVisual/);
    assert.match(html, /scrollIntoView\(\{ behavior: 'instant', block: 'nearest', inline: 'nearest' \}\)/);
    assert.match(html, /Math\.min\(viewport\.clientWidth, window\.innerWidth\)/);
    assert.doesNotMatch(html, /body \{ margin: 0; min-width: 960px;/);
  } finally { await server.close(); runtime.close(); }
});

test("refreshes durable metadata after a visual removal event", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "remove-refresh", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /if \(event\.type === 'visual\.removed'[\s\S]*?durableScene = await fetch\(appPath\('\/api\/scene'\)\)[\s\S]*?return;/);
  } finally { await server.close(); runtime.close(); }
});

test("handles layout changes without re-rendering visual data", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "layout-isolation", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /event\.type === 'layout\.changed'[\s\S]*?updateScene\(mergeEffectiveScene\(\), true\)/);
    assert.match(html, /applyLayout\(card, visualLayout\(visual\), animateLayout\)/);
    assert.doesNotMatch(html, /event\.type === 'layout\.changed'\) await reloadScene\(\)/);
  } finally { await server.close(); runtime.close(); }
});

test("handles live work events by rendering only affected cards", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "work-card-delta", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /async function applyWorkEvent\(event\)/);
    assert.match(html, /async function renderAffectedVisuals\(ids, workId, artifactGeneration\)/);
    assert.match(html, /function renderWorkingVisual\(id, workId\)/);
    assert.match(html, /event\.type === 'work\.visual\.changed'[\s\S]{0,400}renderWorkingVisual\(event\.visual_id, event\.work_id\)[\s\S]{0,400}await renderAffectedVisuals/);
    assert.match(html, /event\.affected_ids \?\? \[\]/);
    assert.doesNotMatch(html, /if \(event\.type\.startsWith\('work\.'\)\)[\s\S]{0,800}renderEffectiveScene\(\)/);
  } finally { await server.close(); runtime.close(); }
});

test("keeps working status in a separate overlay from the retained render surface", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "working-overlay", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /className: 'visual-body'/);
    assert.match(html, /className: 'working-overlay'/);
    assert.match(html, /function showWorkingState\(card, visual, workId\)/);
    assert.match(html, /function clearWorkingState\(card\)/);
    assert.doesNotMatch(html, /function renderWorkingVisual[\s\S]{0,500}querySelector\('\.plot'\)\.replaceChildren/);
  } finally { await server.close(); runtime.close(); }
});

test("uses retained card birth and exit paths instead of reloading every visual", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "spatial-life", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /function animateCardBirth/);
    assert.match(html, /function removeCard/);
    assert.match(html, /event\.type === 'visual\.removed'[\s\S]*?removeCard/);
    assert.match(html, /event\.type === 'visual\.removed'[\s\S]*?removeCard[\s\S]*?updateScene\(mergeEffectiveScene\(\)\)[\s\S]*?return;/);
  } finally { await server.close(); runtime.close(); }
});

test("broadcasts a visual mutation revision over WebSocket", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "socket", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await createInWork(runtime, { id: "v1", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 1, h: 1 } });
  const server = await createWebServer(runtime, 0);
  try {
    const event = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      socket.once("open", async () => {
        const begun = await runtime.workApply({ action: "begin" });
        await runtime.visualPatch("v1", { set: { title: "Patched" } }, undefined, begun.result.work_id);
        await runtime.workApply({ action: "commit", work_id: begun.result.work_id });
      });
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "work.completed" && message.revision === 2) { socket.close(); resolve(message); }
      });
      socket.once("error", reject);
    });
    assert.equal(event.type, "work.completed");
    assert.equal(event.revision, 2);
  } finally { await server.close(); runtime.close(); }
});

test("creates a visual through the live web control path without restarting the server", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "live-control", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const waitForVisualEvent = (expectedRevision) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for live visual event")), 3000);
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "work.completed" && message.revision === expectedRevision) { clearTimeout(timer); resolve(message); }
      });
      socket.once("error", reject);
    });
    const begun = await fetch(`http://127.0.0.1:${server.port}/api/work`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "begin" })
    }).then((result) => result.json());
    const workId = begun.result.work_id;
    const eventPromise = waitForVisualEvent(1);
    const response = await fetch(`http://127.0.0.1:${server.port}/api/visual`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "live-bar", kind: "plot", source: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }], layout: { x: 0, y: 0, w: 300, h: 200 }, work_id: workId })
    });
    assert.equal(response.status, 200);
    const committed = await fetch(`http://127.0.0.1:${server.port}/api/work/${workId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "commit", work_id: workId })
    });
    assert.equal(committed.status, 200);
    const event = await eventPromise;
    assert.equal(event.revision, 1);
    const patchBegun = await fetch(`http://127.0.0.1:${server.port}/api/work`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "begin" })
    }).then((result) => result.json());
    const patchWorkId = patchBegun.result.work_id;
    const patchEventPromise = waitForVisualEvent(2);
    const patchResponse = await fetch(`http://127.0.0.1:${server.port}/api/visual/live-bar`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ work_id: patchWorkId, patch: { set: { title: "Live bar" } } })
    });
    assert.equal(patchResponse.status, 200);
    const patchCommitted = await fetch(`http://127.0.0.1:${server.port}/api/work/${patchWorkId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "commit", work_id: patchWorkId })
    });
    assert.equal(patchCommitted.status, 200);
    await patchEventPromise;
    const scene = await fetch(`http://127.0.0.1:${server.port}/api/scene`).then((result) => result.json());
    assert.equal(scene.visuals["live-bar"].id, "live-bar");
    assert.equal(scene.visuals["live-bar"].title, "Live bar");
    socket.close();
  } finally { await server.close(); runtime.close(); }
});

test("deletes a visual through the live web control path", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "live-delete", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await createInWork(runtime, { id: "delete-me", kind: "plot", source: "orders", query: {}, marks: [], layout: { x: 0, y: 0, w: 300, h: 200 } });
  const server = await createWebServer(runtime, 0);
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const eventPromise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for visual removal event")), 3000);
      socket.on("message", (data) => {
        const message = JSON.parse(data.toString());
        if (message.type === "visual.removed" && message.visual_id === "delete-me") { clearTimeout(timer); resolve(message); }
      });
      socket.once("error", reject);
    });
    const response = await fetch(`http://127.0.0.1:${server.port}/api/visual/delete-me`, { method: "DELETE" });
    assert.equal(response.status, 200);
    await eventPromise;
    const scene = await fetch(`http://127.0.0.1:${server.port}/api/scene`).then((result) => result.json());
    assert.equal(scene.visuals["delete-me"], undefined);
    socket.close();
  } finally { await server.close(); runtime.close(); }
});

test("runs an explicit multi-stage work session through the live web control path", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "explicit-live", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
    const events = [];
    socket.on("message", (data) => events.push(JSON.parse(data.toString())));
    await new Promise((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject); });
    const call = async (path, body) => fetch(`http://127.0.0.1:${server.port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const begun = await call("/api/work", { action: "begin" }).then((response) => response.json());
    const workId = begun.result.work_id;
    const draft = await call("/api/visual", { id: "explicit-bar", kind: "plot", title: "Orders by channel", placement: "right", work_id: workId }).then((response) => response.json());
    const inspected = await call("/api/data/inspect", { dataset: "orders", work_id: workId }).then((response) => response.json());
    const queried = await call("/api/data/query", { dataset: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, work_id: workId }).then((response) => response.json());
    const created = await fetch(`http://127.0.0.1:${server.port}/api/visual/explicit-bar`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ work_id: workId, patch: { set: { source: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] } }, add_marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }] } }) }).then((response) => response.json());
    const committed = await call(`/api/work/${workId}`, { action: "commit" }).then((response) => response.json());
    assert.equal(draft.status, "working");
    assert.deepEqual(draft.result.visual.layout, { x: 0, y: 0, w: 720, h: 440 });
    assert.equal(inspected.status, "ok");
    assert.equal(queried.status, "ok");
    assert.equal(created.status, "rendered");
    assert.equal(committed.status, "ok");
    assert.ok(events.some((event) => event.type === "work.started" && event.work_id === workId));
    assert.ok(events.some((event) => event.type === "work.activity" && event.activity?.kind === "inspect"));
    assert.ok(events.some((event) => event.type === "work.activity" && event.activity?.kind === "query"));
    assert.ok(events.some((event) => event.type === "work.completed" && event.work_id === workId));
    const scene = await fetch(`http://127.0.0.1:${server.port}/api/scene`).then((response) => response.json());
    assert.equal(scene.visuals["explicit-bar"].id, "explicit-bar");
    assert.deepEqual(scene.visuals["explicit-bar"].layout, { x: 0, y: 0, w: 720, h: 440 });
    socket.close();
  } finally { await server.close(); runtime.close(); }
});

test("keeps a visible LC2 stage trail sourced from real work events", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "construction-trail", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /id="construction-status"/);
    assert.match(html, /function recordWorkStage\(event\)/);
    assert.match(html, /constructionStages/);
    assert.match(html, /work\.completed.*commit/s);
    assert.match(html, /work\.activity.*inspect|work\.activity.*query|work\.activity.*render/s);
  } finally { await server.close(); runtime.close(); }
});

test("serves active work snapshots over HTTP and the WebSocket connection", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "work-snapshot", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const begun = await runtime.workApply({ action: "begin" });
  const server = await createWebServer(runtime, 0);
  try {
    const snapshot = await fetch(`http://127.0.0.1:${server.port}/api/works`).then((response) => response.json());
    assert.equal(snapshot.works[0].work.id, begun.result.work_id);
    const event = await new Promise((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
      socket.once("message", (data) => { socket.close(); resolve(JSON.parse(data.toString())); });
      socket.once("error", reject);
    });
    assert.equal(event.type, "work.snapshot");
    assert.equal(event.work_id, begun.result.work_id);
    assert.equal(event.sequence, 1);
  } finally { await server.close(); runtime.close(); }
});

test("serves browser render identity metadata without DOM inference", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "identity-asset", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const registry = await fetch(`http://127.0.0.1:${server.port}/assets/render-identity-registry.js`).then((response) => response.text());
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(registry, /createRenderIdentityRegistry/);
    assert.match(html, /renderIdentity\.remember\(payload\.result\.artifact/);
  } finally { await server.close(); runtime.close(); }
});

test("serves the keyed SVG reconciliation module to the browser", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "reconcile-asset", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const reconciler = await fetch(`http://127.0.0.1:${server.port}/assets/render-reconciler.js`).then((response) => response.text());
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(reconciler, /reconcilePlotViewport/);
    assert.match(html, /reconcilePlotViewport\(plot, svg, visual, payload\.result\.artifact, \{/);
    assert.match(html, /renderGenerations\.accepts/);
    assert.match(html, /createRenderMotion/);
  } finally { await server.close(); runtime.close(); }
});

test("serves a local Plot bundle and a rendered visual payload", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "render", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await createInWork(runtime, { id: "v1", kind: "plot", source: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }], layout: { x: 0, y: 0, w: 300, h: 200 } });
  const server = await createWebServer(runtime, 0);
  try {
    const rendered = await fetch(`http://127.0.0.1:${server.port}/api/visual/v1`).then((response) => response.json());
    assert.equal(rendered.result.plot.marks[0].type, "barY");
    assert.match(await fetch(`http://127.0.0.1:${server.port}/assets/d3.js`).then((response) => response.text()), /d3/);
    assert.match(await fetch(`http://127.0.0.1:${server.port}/assets/plot.js`).then((response) => response.text()), /@observablehq\/plot/);
  } finally { await server.close(); runtime.close(); }
});

test("returns a clean error for a failed visual render without crashing the server", async () => {
  const runtime = new DataCanvasRuntime({
    canvas_id: "render-error", revision: 0,
    datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } },
    visuals: { bad: { id: "bad", kind: "plot", source: "orders", query: {}, marks: [{ id: "bars", type: "barY", options: { tip: true } }], layout: { x: 0, y: 0, w: 300, h: 200 } } },
    annotations: {}, canvas: {}
  });
  const server = await createWebServer(runtime, 0);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/api/visual/bad`);
    assert.equal(response.status, 404);
    const scene = await fetch(`http://127.0.0.1:${server.port}/api/scene`);
    assert.equal(scene.status, 200);
  } finally { await server.close(); runtime.close(); }
});

test("serves the primitive SVG renderer alongside Plot", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "primitive-web", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await createInWork(runtime, { id: "pie", kind: "plot", source: "orders", coordinate: { type: "polar" }, query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, marks: [{ id: "slices", renderer: "primitive", type: "arc", encoding: { angle: { field: "orders" }, color: { field: "channel" } } }], layout: { x: 0, y: 0, w: 300, h: 200 } });
  const server = await createWebServer(runtime, 0);
  try {
    const rendered = await fetch(`http://127.0.0.1:${server.port}/api/visual/pie`).then((response) => response.json());
    assert.equal(rendered.result.plot.primitives[0].type, "arc");
    assert.match(await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text()), /renderPrimitiveLayer/);
    assert.match(await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text()), /#empty\[hidden\]/);
  } finally { await server.close(); runtime.close(); }
});
