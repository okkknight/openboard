import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { WebSocketServer, WebSocket } from "ws";
import type { McpHttpHandler } from "@modelcontextprotocol/server";
import { toolSchemas } from "../mcp/schemas.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { DataCanvasRuntime } from "../runtime/data-canvas-runtime.js";
import type { AnnotationMutation, ComposeInput, QuerySpec, VisualPatch, WorkingVisualDraft } from "../core/types.js";

export interface RunningWebServer { port: number; close(): Promise<void>; }
export interface WebServerOptions { basePath?: string; mcpToken?: string; mcpPath?: string; }

const json = (response: ServerResponse, status: number, payload: unknown): void => {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
};

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > 1_000_000) throw new Error("request_too_large");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function placementLayout(runtime: DataCanvasRuntime, placement: "auto" | "right" | "left" | "below" | "above") {
  const visuals = Object.values(runtime.inspect().visuals);
  const size = { w: 720, h: 440 };
  if (!visuals.length) return { x: 0, y: 0, ...size };
  const anchor = visuals.at(-1)!.layout;
  if (placement === "left") return { x: anchor.x - size.w - 24, y: anchor.y, ...size };
  if (placement === "below") return { x: anchor.x, y: anchor.y + anchor.h + 24, ...size };
  if (placement === "above") return { x: anchor.x, y: anchor.y - size.h - 24, ...size };
  return { x: anchor.x + anchor.w + 24, y: anchor.y, ...size };
}

function mutationError(error: unknown): { status: number; body: Record<string, unknown> } {
  const message = error instanceof Error ? error.message : String(error);
  const code = message.split(":", 1)[0];
  const status = code === "not_found" ? 404 : code === "revision_conflict" ? 409 : 400;
  return { status, body: { status: "error", error: { code, message } } };
}

function normalizeBasePath(value: string | undefined): string {
  if (!value || value === "/") return "";
  if (!value.startsWith("/") || value.includes("?", 1) || value.includes("#", 1)) throw new Error("invalid_openboard_base_path");
  return value.replace(/\/+$/, "");
}

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return headers;
}

function toWebRequest(request: IncomingMessage): Request {
  const hasBody = request.method !== "GET" && request.method !== "HEAD";
  const init: RequestInit & { duplex?: "half" } = {
    method: request.method,
    headers: requestHeaders(request),
    ...(hasBody ? { body: Readable.toWeb(request) as unknown as BodyInit, duplex: "half" } : {})
  };
  return new Request(`http://127.0.0.1${request.url ?? "/"}`, init);
}

async function pipeMcpResponse(response: ServerResponse, upstream: Response): Promise<void> {
  response.writeHead(upstream.status, Object.fromEntries(upstream.headers.entries()));
  if (!upstream.body) { response.end(); return; }
  Readable.fromWeb(upstream.body as unknown as NodeReadableStream<any>).pipe(response);
}

export async function createWebServer(runtime: DataCanvasRuntime, port: number, mcpHandler?: McpHttpHandler, options: WebServerOptions = {}): Promise<RunningWebServer> {
  const basePath = normalizeBasePath(options.basePath);
  const mcpPath = options.mcpPath ?? "/mcp";
  const indexPath = join(dirname(fileURLToPath(import.meta.url)), "../../web/index.html");
  const workOrderPath = join(dirname(fileURLToPath(import.meta.url)), "work-event-order.js");
  const workQueuePath = join(dirname(fileURLToPath(import.meta.url)), "work-event-queue.js");
  const identityRegistryPath = join(dirname(fileURLToPath(import.meta.url)), "../../web/render-identity-registry.js");
  const renderReconcilerPath = join(dirname(fileURLToPath(import.meta.url)), "../../web/render-reconciler.js");
  const renderMotionPath = join(dirname(fileURLToPath(import.meta.url)), "../../web/render-motion.js");
  const crossMarkTransitionPath = join(dirname(fileURLToPath(import.meta.url)), "../../web/cross-mark-transition.js");
  const d3Path = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/d3/dist/d3.min.js");
  const plotPath = join(dirname(fileURLToPath(import.meta.url)), "../../node_modules/@observablehq/plot/dist/plot.umd.min.js");
  const server = createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/healthz") {
      const scene = runtime.inspect();
      json(response, 200, { status: "ok", service: "openboard", canvas_id: scene.canvas_id, revision: scene.revision });
      return;
    }
    if (url.pathname === mcpPath && mcpHandler) {
      if (options.mcpToken && request.headers.authorization !== `Bearer ${options.mcpToken}`) {
        response.writeHead(401, { "www-authenticate": "Bearer" });
        response.end();
        return;
      }
      try {
        await pipeMcpResponse(response, await mcpHandler.fetch(toWebRequest(request)));
      } catch (error) {
        if (!response.headersSent) json(response, 500, { status: "error", error: { code: "mcp_http_error", message: error instanceof Error ? error.message : String(error) } });
        else response.destroy();
      }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/work") {
      try {
        const parsed = toolSchemas["work.apply"].safeParse(await readJson(request));
        if (!parsed.success) { json(response, 400, { status: "invalid_spec", error: parsed.error.flatten() }); return; }
        json(response, 200, await runtime.workApply(parsed.data));
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (request.method === "POST" && url.pathname.startsWith("/api/work/")) {
      try {
        const workId = decodeURIComponent(url.pathname.slice("/api/work/".length));
        const parsed = toolSchemas["work.apply"].safeParse({ ...(await readJson(request) as Record<string, unknown>), work_id: workId });
        if (!parsed.success) { json(response, 400, { status: "invalid_spec", error: parsed.error.flatten() }); return; }
        json(response, 200, await runtime.workApply(parsed.data));
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/data/inspect") {
      try {
        const parsed = toolSchemas["data.inspect"].safeParse(await readJson(request));
        if (!parsed.success) { json(response, 400, { status: "invalid_spec", error: parsed.error.flatten() }); return; }
        const dataset = await runtime.dataInspect(parsed.data.dataset, { fields: parsed.data.fields, top_k: parsed.data.top_k, sample_rows: parsed.data.sample_rows }, parsed.data.work_id);
        const scene = runtime.inspect();
        json(response, 200, { status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result: { dataset } });
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/data/query") {
      try {
        const parsed = toolSchemas["data.query"].safeParse(await readJson(request));
        if (!parsed.success) { json(response, 400, { status: "invalid_spec", error: parsed.error.flatten() }); return; }
        const result = await runtime.dataQuery(parsed.data.dataset, parsed.data.query as unknown as QuerySpec, parsed.data.work_id);
        const scene = runtime.inspect();
        json(response, 200, { status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result });
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/visual") {
      try {
        const parsed = toolSchemas["visual.create"].safeParse(await readJson(request));
        if (!parsed.success) { json(response, 400, { status: "invalid_spec", error: parsed.error.flatten() }); return; }
        const input = parsed.data;
        const id = input.id;
        const visual: WorkingVisualDraft = { id, kind: input.kind, title: input.title, source: input.source, query: input.query as QuerySpec | undefined, coordinate: input.coordinate, marks: input.marks, layout: input.layout ?? placementLayout(runtime, input.placement) } as WorkingVisualDraft;
        json(response, 200, await runtime.visualCreate(visual, input.expected_revision, input.work_id));
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (request.method === "PATCH" && url.pathname.startsWith("/api/visual/")) {
      try {
        const id = decodeURIComponent(url.pathname.slice("/api/visual/".length));
        const body = await readJson(request);
        const parsed = toolSchemas["visual.patch"].safeParse({ ...(body as Record<string, unknown>), id });
        if (!parsed.success) { json(response, 400, { status: "invalid_spec", error: parsed.error.flatten() }); return; }
        json(response, 200, await runtime.visualPatch(parsed.data.id, parsed.data.patch as unknown as VisualPatch, parsed.data.expected_revision, parsed.data.work_id));
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/canvas/compose") {
      try {
        const parsed = toolSchemas["canvas.compose"].safeParse(await readJson(request));
        if (!parsed.success) { json(response, 400, { status: "invalid_spec", error: parsed.error.flatten() }); return; }
        const { expected_revision, work_id, ...input } = parsed.data;
        json(response, 200, await runtime.canvasCompose(input as ComposeInput, expected_revision, work_id));
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (request.method === "POST" && url.pathname === "/api/canvas/annotate") {
      try {
        const parsed = toolSchemas["canvas.annotate"].safeParse(await readJson(request));
        if (!parsed.success) { json(response, 400, { status: "invalid_spec", error: parsed.error.flatten() }); return; }
        const { expected_revision, work_id, ...input } = parsed.data;
        json(response, 200, await runtime.canvasAnnotate(input as AnnotationMutation, expected_revision, work_id));
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (request.method === "DELETE" && url.pathname.startsWith("/api/visual/")) {
      try {
        const id = decodeURIComponent(url.pathname.slice("/api/visual/".length));
        if (!id) { json(response, 400, { status: "invalid_spec", error: { code: "invalid_visual_id", message: "visual id is required" } }); return; }
        const expectedRevisionValue = url.searchParams.get("expected_revision");
        const expectedRevision = expectedRevisionValue === null ? undefined : Number(expectedRevisionValue);
        if (expectedRevisionValue !== null && (expectedRevision === undefined || !Number.isInteger(expectedRevision) || expectedRevision < 0)) {
          json(response, 400, { status: "invalid_spec", error: { code: "invalid_expected_revision", message: "expected_revision must be a non-negative integer" } });
          return;
        }
        json(response, 200, await runtime.canvasCompose({ action: "delete", target: id }, expectedRevision));
      } catch (error) { const result = mutationError(error); json(response, result.status, result.body); }
      return;
    }
    if (url.pathname === "/api/scene") {
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
        const rawGeneration = url.searchParams.get("artifact_generation");
        const artifactGeneration = rawGeneration === null ? undefined : Number(rawGeneration);
        if (artifactGeneration !== undefined && (!Number.isSafeInteger(artifactGeneration) || artifactGeneration < 1)) throw new Error("invalid_artifact_generation");
        const payload = await runtime.renderVisual(id, url.searchParams.get("work_id") ?? undefined, artifactGeneration);
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(payload));
      } catch { if (!response.headersSent) response.writeHead(404).end(); else response.destroy(); }
      return;
    }
    if (url.pathname === "/assets/plot.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(plotPath));
      return;
    }
    if (url.pathname === "/assets/d3.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(d3Path));
      return;
    }
    if (url.pathname === "/assets/work-event-order.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(workOrderPath));
      return;
    }
    if (url.pathname === "/assets/work-event-queue.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(workQueuePath));
      return;
    }
    if (url.pathname === "/assets/render-identity-registry.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(identityRegistryPath));
      return;
    }
    if (url.pathname === "/assets/render-reconciler.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(renderReconcilerPath));
      return;
    }
    if (url.pathname === "/assets/render-motion.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(renderMotionPath));
      return;
    }
    if (url.pathname === "/assets/cross-mark-transition.js") {
      response.writeHead(200, { "content-type": "application/javascript" });
      response.end(await readFile(crossMarkTransitionPath));
      return;
    }
    if (url.pathname === "/favicon.ico") { response.writeHead(204).end(); return; }
    if (url.pathname === "/" || url.pathname === "/index.html") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end((await readFile(indexPath, "utf8")).replaceAll("__OPENBOARD_BASE_PATH__", basePath));
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
