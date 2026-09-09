import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import type { DataCanvasRuntime } from "../runtime/data-canvas-runtime.js";

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
    server.registerTool(name, { description: `OpenBoard ${name}`, inputSchema: z.object({}).passthrough() }, async () => {
      if (name === "canvas.inspect") {
        const scene = runtime.inspect();
        return textResult({ status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result: { scene } });
      }
      const scene = runtime.inspect();
      return textResult({ status: "error", canvas_id: scene.canvas_id, revision: scene.revision, error: { code: "not_implemented", message: `${name} is not wired yet` } });
    });
  }
  return server;
}
