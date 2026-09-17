import { McpServer } from "@modelcontextprotocol/server";
import type { DataCanvasRuntime } from "../runtime/data-canvas-runtime.js";
import type { AnnotationSpec, ComposeInput, HistoryApplyInput, QuerySpec, VisualPatch, VisualSpec, WorkingVisualDraft } from "../core/types.js";
import { toolSchemas } from "./schemas.js";
import { SUPPORTED_MARKS, SUPPORTED_PRIMITIVES } from "../render/plot-compiler.js";

export const TOOL_NAMES = [
  "canvas.inspect", "data.inspect", "data.query", "visual.create", "visual.patch",
  "visual.clone", "canvas.compose", "canvas.annotate", "history.apply", "work.apply"
] as const;

function textResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }], structuredContent: value as Record<string, unknown> };
}

function placementLayout(runtime: DataCanvasRuntime, placement: "auto" | "right" | "left" | "below" | "above", anchorId?: string) {
  const visuals = Object.values(runtime.inspect().visuals);
  const size = { w: 720, h: 440 };
  if (!visuals.length) return { x: 0, y: 0, ...size };
  const anchor = (anchorId ? runtime.inspect().visuals[anchorId]?.layout : undefined) ?? visuals.at(-1)!.layout;
  if (placement === "left") return { x: anchor.x - size.w - 24, y: anchor.y, ...size };
  if (placement === "below") return { x: anchor.x, y: anchor.y + anchor.h + 24, ...size };
  if (placement === "above") return { x: anchor.x, y: anchor.y - size.h - 24, ...size };
  return { x: anchor.x + anchor.w + 24, y: anchor.y, ...size };
}

function errorResult(runtime: DataCanvasRuntime, error: unknown) {
  const scene = runtime.inspect();
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error && "code" in error && typeof error.code === "string"
    ? error.code
    : message.split(":", 1)[0];
  const status = ["render_limit_exceeded", "revision_conflict", "not_found", "unsupported_visual_feature", "query_rejected"].includes(code)
    ? code
    : code === "history_not_found" ? "not_found"
    : code.startsWith("invalid_") || code === "mixed_raw_sql" || code.startsWith("unknown_") || code.startsWith("immutable_") || code.startsWith("duplicate_") ? "invalid_spec" : "error";
  const result: Record<string, unknown> = {};
  if (typeof error === "object" && error) {
    for (const key of ["requested_rows", "limit", "expected_revision", "actual_revision"]) {
      if (key in error) result[key] = (error as Record<string, unknown>)[key];
    }
  }
  if (status === "render_limit_exceeded") result.suggestions = ["aggregate", "bin", "explicit_sample"];
  return textResult({ status, canvas_id: scene.canvas_id, revision: scene.revision, result, error: { code, message } });
}

export function createMcpServer(runtime: DataCanvasRuntime): McpServer {
  const server = new McpServer({ name: "openboard", version: "0.1.0" });
  for (const name of TOOL_NAMES) {
    server.registerTool(name, { description: `OpenBoard ${name}`, inputSchema: toolSchemas[name] }, async (input: Record<string, unknown>) => {
      try {
        if (name === "canvas.inspect") {
          const scene = runtime.inspect();
          const requested = (input as { include?: string[] }).include;
          const result: Record<string, unknown> = { scene };
          if (!requested || requested.includes("capabilities")) result.capabilities = { point_limit: runtime.pointLimit(), marks: SUPPORTED_MARKS, primitives: SUPPORTED_PRIMITIVES };
          return textResult({ status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result });
        }
        const request = input as Record<string, unknown>;
        if (name === "data.inspect") {
          const dataset = await runtime.dataInspect(String(request.dataset), { fields: request.fields as string[] | undefined, top_k: request.top_k as number | undefined, sample_rows: request.sample_rows as number | undefined }, request.work_id as string | undefined);
          const scene = runtime.inspect();
          return textResult({ status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result: { dataset } });
        }
        if (name === "data.query") {
          const result = await runtime.dataQuery(String(request.dataset), request.query as QuerySpec, request.work_id as string | undefined);
          const scene = runtime.inspect();
          return textResult({ status: "ok", canvas_id: scene.canvas_id, revision: scene.revision, result });
        }
        if (name === "visual.create") {
          const workId = request.work_id as string;
          const id = String(request.id);
          const draft: WorkingVisualDraft = { id, kind: request.kind as VisualSpec["kind"], title: request.title as string | undefined, source: request.source as string | undefined, query: request.query as QuerySpec | undefined, coordinate: request.coordinate as VisualSpec["coordinate"], marks: request.marks as VisualSpec["marks"] | undefined, layout: request.layout as VisualSpec["layout"] ?? placementLayout(runtime, request.placement as "auto" | "right" | "left" | "below" | "above") };
          return textResult(await runtime.visualCreate(draft, request.expected_revision as number | undefined, workId));
        }
        if (name === "visual.patch") return textResult(await runtime.visualPatch(String(request.id), request.patch as VisualPatch, request.expected_revision as number | undefined, request.work_id as string));
        if (name === "visual.clone") {
          const source = runtime.inspect().visuals[String(request.id)];
          const newId = String(request.new_id ?? `${request.id}-copy`);
          const patch = request.patch as VisualPatch | undefined;
          const placement = request.placement as "auto" | "right" | "left" | "below" | "above";
          const placedPatch = source && placement !== "auto" && !(patch?.set && "layout" in patch.set)
            ? { ...patch, set: { ...(patch?.set ?? {}), layout: placementLayout(runtime, placement, String(request.id)) } }
            : patch;
          return textResult(await runtime.visualClone(String(request.id), newId, placedPatch, request.expected_revision as number | undefined, request.work_id as string));
        }
        if (name === "canvas.compose") return textResult(await runtime.canvasCompose(request as unknown as ComposeInput, request.expected_revision as number | undefined, request.work_id as string | undefined));
        if (name === "canvas.annotate") {
          const annotation: AnnotationSpec = { id: String(request.id ?? `a${Object.keys(runtime.inspect().annotations).length + 1}`), target: request.target as string | undefined, text: String(request.text), anchor: request.anchor as AnnotationSpec["anchor"], created_at: new Date().toISOString() };
          return textResult(await runtime.canvasAnnotate(annotation, request.expected_revision as number | undefined, request.work_id as string | undefined));
        }
        if (name === "history.apply") return textResult(await runtime.historyApply(request as unknown as HistoryApplyInput));
        if (name === "work.apply") return textResult(await runtime.workApply({ action: request.action as "begin" | "commit" | "cancel", work_id: request.work_id as string | undefined }));
        return errorResult(runtime, new Error(`not_implemented: ${name}`));
      } catch (error) { return errorResult(runtime, error); }
    });
  }
  return server;
}
