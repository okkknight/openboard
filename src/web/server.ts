import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { DataCanvasRuntime } from "../runtime/data-canvas-runtime.js";

export interface RunningWebServer { port: number; close(): Promise<void>; }

export async function createWebServer(runtime: DataCanvasRuntime, port: number): Promise<RunningWebServer> {
  const indexPath = join(dirname(fileURLToPath(import.meta.url)), "../../../web/index.html");
  const plotPath = join(dirname(fileURLToPath(import.meta.url)), "../../../node_modules/@observablehq/plot/dist/plot.umd.min.js");
  const server = createServer(async (request, response) => {
    if (request.url === "/api/scene") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(runtime.inspect()));
      return;
    }
    if (request.url?.startsWith("/api/visual/")) {
      const id = decodeURIComponent(request.url.slice("/api/visual/".length));
      try {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(await runtime.renderVisual(id)));
      } catch { response.writeHead(404).end(); }
      return;
    }
    if (request.url === "/assets/plot.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(plotPath));
      return;
    }
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile(indexPath));
      return;
    }
    response.writeHead(404).end();
  });
  const websocket = new WebSocketServer({ noServer: true });
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
    await new Promise<void>((resolve) => websocket.close(() => resolve()));
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  } };
}
