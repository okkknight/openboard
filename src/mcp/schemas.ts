import { z } from "zod";

const filter = z.object({
  field: z.string().min(1),
  op: z.enum(["eq", "neq", "in", "not_in", "gt", "gte", "lt", "lte", "between", "contains", "is_null", "not_null", "last_days"]),
  value: z.unknown().optional()
}).strict();

const query = z.object({
  filters: z.array(filter).optional(),
  dimensions: z.array(z.object({ field: z.string().min(1), time_grain: z.enum(["minute", "hour", "day", "week", "month", "quarter", "year"]).optional(), alias: z.string().min(1).optional() }).strict()).optional(),
  measures: z.array(z.object({ field: z.string().min(1).optional(), agg: z.enum(["count", "count_distinct", "sum", "avg", "min", "max", "median", "quantile"]).optional(), expr: z.string().min(1).optional(), alias: z.string().min(1), quantile: z.number().min(0).max(1).optional() }).strict()).optional(),
  sort: z.array(z.object({ field: z.string().min(1), direction: z.enum(["asc", "desc"]) }).strict()).optional(),
  limit: z.number().int().positive().optional(),
  sample: z.object({ method: z.literal("reservoir"), size: z.number().int().positive() }).strict().optional(),
  sql: z.string().min(1).optional()
}).strict();

const encodingValue = z.union([
  z.object({ field: z.string().min(1).optional(), constant: z.unknown().optional(), derived: z.string().min(1).optional() }).strict()
    .refine((value) => Object.keys(value).length === 1, "encoding reference must contain exactly one source"),
  z.string(), z.number(), z.boolean(), z.null()
]);

const encoding = z.object({
  x: encodingValue.optional(), y: encodingValue.optional(), x1: encodingValue.optional(), x2: encodingValue.optional(),
  y1: encodingValue.optional(), y2: encodingValue.optional(), angle: encodingValue.optional(), angle1: encodingValue.optional(),
  angle2: encodingValue.optional(), radius: encodingValue.optional(), innerRadius: encodingValue.optional(), outerRadius: encodingValue.optional(),
  color: encodingValue.optional(), fill: encodingValue.optional(), stroke: encodingValue.optional(), size: encodingValue.optional(),
  opacity: encodingValue.optional(), text: encodingValue.optional(), shape: encodingValue.optional()
}).strict();

const mark = z.object({
  id: z.string().min(1),
  renderer: z.enum(["plot", "primitive"]).optional(),
  type: z.enum(["barX", "barY", "lineX", "lineY", "areaX", "areaY", "dot", "rect", "cell", "ruleX", "ruleY", "text", "tickX", "tickY", "boxX", "boxY", "circle", "line", "arc", "path", "area"]),
  x: z.unknown().optional(), y: z.unknown().optional(), color: z.unknown().optional(), fill: z.unknown().optional(), stroke: z.unknown().optional(), size: z.unknown().optional(), opacity: z.number().min(0).max(1).optional(), text: z.unknown().optional(), filter: z.array(filter).optional(), options: z.record(z.string(), z.unknown()).optional()
  , encoding: encoding.optional()
}).strict().superRefine((value, ctx) => {
  if (value.type === "path" && value.options && typeof value.options.d === "string" && /[<>]|javascript:|\bon\w+\s*=/i.test(value.options.d)) {
    ctx.addIssue({ code: "custom", message: "path data must not contain HTML or executable content", path: ["options", "d"] });
  }
});

const layout = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() }).strict();
const annotationStyle = z.object({
  variant: z.enum(["caption", "body", "insight", "callout"]),
  align: z.enum(["start", "center", "end"]).optional(),
  color_role: z.enum(["default", "muted", "accent", "warning"]).optional()
}).strict();
const anchor = z.object({ x: z.number(), y: z.number() }).strict();
const objectRef = z.object({ kind: z.enum(["visual", "annotation"]), id: z.string().min(1) }).strict();
const layoutUpdate = z.object({ target: objectRef, layout }).strict();
const annotationPatch = z.object({
  text: z.string().min(1).optional(),
  target: z.string().min(1).nullable().optional(),
  anchor: anchor.nullable().optional(),
  layout: layout.optional(),
  style: annotationStyle.optional()
}).strict().refine((value) => Object.keys(value).length > 0, "annotation patch must not be empty");
const annotationCreate = z.object({
  mode: z.literal("create").optional(), id: z.string().min(1).optional(), target: z.string().min(1).optional(),
  text: z.string().min(1), anchor: anchor.optional(), layout: layout.optional(), style: annotationStyle.optional(),
  expected_revision: z.number().int().min(0).optional(), work_id: z.string().min(1).optional()
}).strict();
const annotationUpdate = z.object({
  mode: z.literal("patch"), id: z.string().min(1), patch: annotationPatch,
  expected_revision: z.number().int().min(0).optional(), work_id: z.string().min(1).optional()
}).strict();
const visualPatch = z.object({
  set: z.record(z.string(), z.unknown()).optional(),
  unset: z.array(z.string()).optional(),
  add_marks: z.array(mark).optional(),
  remove_marks: z.array(z.string()).optional()
}).strict();

export const toolSchemas = {
  "canvas.inspect": z.object({ include: z.array(z.enum(["datasets", "visuals", "annotations", "canvas", "capabilities"])).optional() }).strict(),
  "data.inspect": z.object({ dataset: z.string().min(1), fields: z.array(z.string().min(1)).optional(), top_k: z.number().int().min(1).max(50).default(10), sample_rows: z.number().int().min(0).max(100).default(5), work_id: z.string().min(1).optional() }).strict(),
  "data.query": z.object({ dataset: z.string().min(1), query, observation: z.boolean().default(true), work_id: z.string().min(1).optional() }).strict(),
  "visual.create": z.object({ id: z.string().min(1), kind: z.enum(["plot", "table", "kpi"]).default("plot"), title: z.string().optional(), source: z.string().min(1).optional(), coordinate: z.object({ type: z.enum(["cartesian", "polar"]) }).strict().optional(), query: query.optional(), marks: z.array(mark).optional(), layout: layout.optional(), placement: z.enum(["auto", "right", "left", "below", "above"]).default("auto"), expected_revision: z.number().int().min(0).optional(), work_id: z.string().min(1) }).strict(),
  "visual.patch": z.object({ id: z.string().min(1), patch: visualPatch, expected_revision: z.number().int().min(0).optional(), work_id: z.string().min(1) }).strict(),
  "visual.clone": z.object({ id: z.string().min(1), new_id: z.string().min(1).optional(), patch: visualPatch.optional(), placement: z.enum(["auto", "right", "left", "below", "above"]).default("auto"), expected_revision: z.number().int().min(0).optional(), work_id: z.string().min(1) }).strict(),
  "canvas.compose": z.object({ action: z.enum(["move", "resize", "delete", "focus", "group", "ungroup", "arrange"]), target: z.string().min(1).optional(), targets: z.array(z.string().min(1)).optional(), layout: layout.optional(), layout_updates: z.array(layoutUpdate).min(1).optional(), arrangement: z.enum(["row", "column", "grid", "compact"]).optional(), expected_revision: z.number().int().min(0).optional(), work_id: z.string().min(1).optional() }).strict().superRefine((value, ctx) => {
    if (value.layout_updates && (value.target !== undefined || value.layout !== undefined)) ctx.addIssue({ code: "custom", message: "layout_updates cannot be mixed with legacy target or layout", path: ["layout_updates"] });
    if (value.layout_updates && value.action !== "move" && value.action !== "resize") ctx.addIssue({ code: "custom", message: "layout_updates require move or resize", path: ["action"] });
    const seen = new Set();
    for (const [index, update] of (value.layout_updates ?? []).entries()) {
      const key = `${update.target.kind}:${update.target.id}`;
      if (seen.has(key)) ctx.addIssue({ code: "custom", message: "layout update targets must be unique", path: ["layout_updates", index, "target"] });
      seen.add(key);
    }
  }),
  "canvas.annotate": z.union([annotationUpdate, annotationCreate]),
  "history.apply": z.object({ action: z.enum(["undo", "redo", "checkpoint", "goto", "fork"]), revision: z.number().int().min(0).optional(), label: z.string().min(1).optional(), expected_revision: z.number().int().min(0).optional() }).strict(),
  "work.apply": z.object({ action: z.enum(["begin", "commit", "cancel"]), work_id: z.string().min(1).optional() }).strict().superRefine((value, ctx) => { if (value.action !== "begin" && !value.work_id) ctx.addIssue({ code: "custom", message: "work_id required", path: ["work_id"] }); })
} as const;
