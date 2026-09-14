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

test("reloads durable scene after a visual removal event", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "remove-refresh", revision: 0, datasets: {}, visuals: {}, annotations: {}, canvas: {} });
  const server = await createWebServer(runtime, 0);
  try {
    const html = await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text());
    assert.match(html, /if \(event\.type === 'visual\.removed'[\s\S]*?await reloadScene\(\); return;/);
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
    assert.match(html, /reconcilePlotViewport\(plot, svg, visual, payload\.result\.artifact\)/);
    assert.match(html, /renderGenerations\.accepts/);
  } finally { await server.close(); runtime.close(); }
});

test("serves a local Plot bundle and a rendered visual payload", async () => {
  const runtime = new DataCanvasRuntime({ canvas_id: "render", revision: 0, datasets: { orders: { id: "orders", path: resolve("examples/orders.csv"), format: "csv" } }, visuals: {}, annotations: {}, canvas: {} });
  await runtime.visualCreate({ id: "v1", kind: "plot", source: "orders", query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, marks: [{ id: "bars", type: "barY", x: "channel", y: "orders" }], layout: { x: 0, y: 0, w: 300, h: 200 } });
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
  await runtime.visualCreate({ id: "pie", kind: "plot", source: "orders", coordinate: { type: "polar" }, query: { dimensions: [{ field: "channel" }], measures: [{ agg: "count", alias: "orders" }] }, marks: [{ id: "slices", renderer: "primitive", type: "arc", encoding: { angle: { field: "orders" }, color: { field: "channel" } } }], layout: { x: 0, y: 0, w: 300, h: 200 } });
  const server = await createWebServer(runtime, 0);
  try {
    const rendered = await fetch(`http://127.0.0.1:${server.port}/api/visual/pie`).then((response) => response.json());
    assert.equal(rendered.result.plot.primitives[0].type, "arc");
    assert.match(await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text()), /renderPrimitiveLayer/);
    assert.match(await fetch(`http://127.0.0.1:${server.port}/`).then((response) => response.text()), /#empty\[hidden\]/);
  } finally { await server.close(); runtime.close(); }
});
