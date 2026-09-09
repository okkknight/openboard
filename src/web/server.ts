import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { DataCanvasRuntime } from "../runtime/data-canvas-runtime.js";

export interface RunningWebServer { port: number; close(): Promise<void>; }

export async function createWebServer(runtime: DataCanvasRuntime, port: number): Promise<RunningWebServer> {
  const indexPath = join(dirname(fileURLToPath(import.meta.url)), "../../../web/index.html");
  const server = createServer(async (request, response) => {
    if (request.url === "/api/scene") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(runtime.inspect()));
      return;
    }
    if (request.url === "/" || request.url === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(await readFile(indexPath));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("web_server_address_missing");
  return { port: address.port, close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())) };
}
