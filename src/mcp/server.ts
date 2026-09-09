import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { DataCanvasRuntime } from "../runtime/data-canvas-runtime.js";
import type { AnnotationSpec, ComposeInput, QuerySpec, VisualPatch, VisualSpec } from "../core/types.js";

export const TOOL_NAMES = [
  "canvas.inspect", "data.inspect", "data.query", "visual.create", "visual.patch",
  "visual.clone", "canvas.compose", "canvas.annotate", "history.apply"
] as const;

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

export function createMcpServer(runtime: DataCanvasRuntime): McpServer {
  const server = new McpServer({ name: "openboard", version: "0.1.0" });
  for (const name of TOOL_NAMES) {
    server.registerTool(name, { description: `OpenBoard ${name}`, inputSchema: z.object({}).passthrough() }, async (input) => {
      if (name === "canvas.inspect") {
        const scene = runtime.inspect();
        return textResult({ status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result: { scene } });
      }
      const request = input as Record<string, unknown>;
      if (name === "data.inspect") {
        const dataset = await runtime.dataInspect(String(request.dataset));
        const scene = runtime.inspect();
        return textResult({ status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result: { dataset } });
      }
      if (name === "data.query") {
        const result = await runtime.dataQuery(String(request.dataset), request.query as QuerySpec);
        const scene = runtime.inspect();
        return textResult({ status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result: result });
      }
      if (name === "visual.create") return textResult(await runtime.visualCreate(request as unknown as VisualSpec, request.expected_revision as number | undefined));
      if (name === "visual.patch") return textResult(await runtime.visualPatch(String(request.id), request.patch as VisualPatch, request.expected_revision as number | undefined));
      if (name === "visual.clone") return textResult(await runtime.visualClone(String(request.id), String(request.new_id), request.patch as VisualPatch | undefined, request.expected_revision as number | undefined));
      if (name === "canvas.compose") return textResult(await runtime.canvasCompose(request as unknown as ComposeInput, request.expected_revision as number | undefined));
      if (name === "canvas.annotate") return textResult(await runtime.canvasAnnotate(request as unknown as AnnotationSpec, request.expected_revision as number | undefined));
      const scene = runtime.inspect();
      return textResult({ status: "error", canvas_id: scene.canvas_id, revision: scene.revision, error: { code: "not_implemented", message: `${name} is not wired yet` } });
    });
  }
  return server;
}
