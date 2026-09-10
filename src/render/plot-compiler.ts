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

const supportedOptions = new Set(["curve", "fillOpacity", "strokeWidth", "r", "inset", "title"]);
const channels = ["x", "y", "color", "fill", "stroke", "size", "text"] as const;

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
  return options;
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
