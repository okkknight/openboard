import type { JsonObject, JsonValue, MarkSpec, VisualSpec } from "../core/types.js";
import { compilePrimitive, type PrimitiveLayer } from "./primitive-compiler.js";
import { isPlotMark, resolveRenderer, SUPPORTED_MARKS, SUPPORTED_PRIMITIVES } from "./renderer-registry.js";

export { SUPPORTED_MARKS, SUPPORTED_PRIMITIVES };

export interface CompiledMark {
  id: string;
  type: MarkSpec["type"];
  options: JsonObject;
}

export type CompiledLayer =
  | { renderer: "plot"; mark: CompiledMark }
  | { renderer: "primitive"; primitive: PrimitiveLayer };

export interface PlotConfig {
  data: JsonObject[];
  marks: CompiledMark[];
  primitives?: PrimitiveLayer[];
  layers?: CompiledLayer[];
}

const supportedOptions = new Set(["curve", "fillOpacity", "strokeWidth", "r", "inset", "rx", "ry", "title"]);
const channels = ["x", "y", "color", "fill", "stroke", "size", "text"] as const;
const DEFAULT_ACCENT = "#6bd8c4";

function encodingValue(value: unknown): JsonValue {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const ref = value as Record<string, unknown>;
    if (typeof ref.field === "string") return ref.field;
    if ("constant" in ref) return ref.constant as JsonValue;
    if (typeof ref.derived === "string") throw new Error(`invalid_encoding: unsupported derived expression ${ref.derived}`);
  }
  return value as JsonValue;
}

function asOptions(mark: MarkSpec): JsonObject {
  const options: JsonObject = {};
  for (const channel of channels) {
    const value = mark[channel] ?? mark.encoding?.[channel];
    if (value !== undefined) options[channel] = encodingValue(value);
  }
  if (mark.opacity !== undefined) options.opacity = mark.opacity;
  for (const [key, value] of Object.entries(mark.options ?? {})) {
    if (!supportedOptions.has(key)) throw new Error(`unsupported_visual_feature: option ${key}`);
    options[key] = value;
  }
  applyVisualDefaults(mark, options);
  return options;
}

function categoricalAxis(mark: MarkSpec, options: JsonObject): JsonValue | undefined {
  const axis = mark.type === "barY" ? options.x : mark.type === "barX" ? options.y : undefined;
  return typeof axis === "string" ? axis : undefined;
}

function applyVisualDefaults(mark: MarkSpec, options: JsonObject): void {
  if (mark.type === "barX" || mark.type === "barY") {
    if (options.fill === undefined) options.fill = options.color ?? categoricalAxis(mark, options) ?? DEFAULT_ACCENT;
    if (options.inset === undefined) options.inset = 3;
    if (options.rx === undefined) options.rx = 6;
    if (options.ry === undefined) options.ry = 6;
    return;
  }
  if (mark.type === "lineX" || mark.type === "lineY") {
    if (options.stroke === undefined && options.color === undefined) options.stroke = DEFAULT_ACCENT;
    if (options.strokeWidth === undefined) options.strokeWidth = 3;
    return;
  }
  if (mark.type === "areaX" || mark.type === "areaY") {
    if (options.fill === undefined && options.color === undefined) options.fill = DEFAULT_ACCENT;
    if (options.fillOpacity === undefined) options.fillOpacity = 0.3;
    return;
  }
  if (mark.type === "dot") {
    if (options.fill === undefined && options.color === undefined) options.fill = DEFAULT_ACCENT;
    if (options.r === undefined) options.r = 5;
  }
}

export function compilePlot(visual: VisualSpec, rows: JsonObject[]): PlotConfig {
  if (visual.kind === "table" || visual.kind === "kpi") return { data: structuredClone(rows), marks: [] };
  if (visual.kind !== "plot") throw new Error(`unsupported_visual_feature: kind ${visual.kind}`);
  const result: PlotConfig = {
    data: structuredClone(rows),
    marks: [],
  };
  const primitives: PrimitiveLayer[] = [];
  const layers: CompiledLayer[] = [];
  for (const mark of visual.marks) {
    if (resolveRenderer(mark) === "plot") {
      if (!isPlotMark(mark.type)) throw new Error(`unsupported_visual_feature: plot mark ${mark.type}`);
      const compiled = { id: mark.id, type: mark.type, options: asOptions(mark) };
      result.marks.push(compiled);
      layers.push({ renderer: "plot", mark: compiled });
    } else {
      if (!SUPPORTED_PRIMITIVES.includes(mark.type as typeof SUPPORTED_PRIMITIVES[number])) throw new Error(`unsupported_visual_feature: primitive mark ${mark.type}`);
      const primitive = compilePrimitive(mark, rows, visual.coordinate ?? { type: "cartesian" });
      primitives.push(primitive);
      layers.push({ renderer: "primitive", primitive });
    }
  }
  if (primitives.length) result.primitives = primitives;
  if (primitives.length) result.layers = layers;
  return result;
}
