import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { DataCanvasRuntime } from "../runtime/data-canvas-runtime.js";

export interface RunningWebServer { port: number; close(): Promise<void>; }

export async function createWebServer(runtime: DataCanvasRuntime, port: number): Promise<RunningWebServer> {
  const indexPath = join(dirname(fileURLToPath(import.meta.url)), "../../web/index.html");
  const workOrderPath = join(dirname(fileURLToPath(import.meta.url)), "work-event-order.js");
  const d3Path = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/d3/dist/d3.min.js");
  const plotPath = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/@observablehq/plot/dist/plot.umd.min.js");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.url === "/api/scene") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(runtime.inspect()));
      return;
    }
    if (url.pathname === "/api/works") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ works: runtime.inspectWorkSnapshots() }));
      return;
    }
    if (url.pathname.startsWith("/api/visual/")) {
      const id = decodeURIComponent(url.pathname.slice("/api/visual/".length));
      try {
        const payload = await runtime.renderVisual(id, url.searchParams.get("work_id") ?? undefined);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      } catch { if (!response.headersSent) response.writeHead(404).end(); else response.destroy(); }
      return;
    }
    if (request.url === "/assets/plot.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(plotPath));
      return;
    }
    if (request.url === "/assets/d3.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(d3Path));
      return;
    }
    if (request.url === "/assets/work-event-order.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(workOrderPath));
      return;
    }
    if (request.url === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile(indexPath));
      return;
    }
    response.writeHead(404).end();
  });
  const websocket = new WebSocketServer({ noServer: true });
  websocket.on("connection", (client) => {
    for (const snapshot of runtime.inspectWorkSnapshots()) {
      client.send(JSON.stringify({ type: "work.snapshot", canvas_id: snapshot.effective_scene.canvas_id, revision: snapshot.effective_scene.revision, work_id: snapshot.work.id, base_revision: snapshot.work.base_revision, sequence: snapshot.work.sequence, work: snapshot.work, effective_scene: snapshot.effective_scene }));
    }
  });
  server.keepAliveTimeout = 1;
  server.on("upgrade", (request, socket, head) => {
    if (request.url !== "/ws") { socket.destroy(); return; }
    websocket.handleUpgrade(request, socket, head, (client) => websocket.emit("connection", client, request));
  });
  const unsubscribe = runtime.onEvent((event) => {
    const payload = JSON.stringify(event);
    for (const client of websocket.clients) if (client.readyState === WebSocket.OPEN) client.send(payload);
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("web_server_address_missing");
  return { port: address.port, close: async () => {
    unsubscribe();
    for (const client of websocket.clients) client.terminate();
    websocket.close();
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}
