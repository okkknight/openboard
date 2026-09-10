import type { JsonObject, JsonValue, MarkSpec, VisualSpec } from "../core/types.js";

export interface CompiledMark {
  id: string;
  type: MarkSpec["type"];
  options: JsonObject;
}

export interface PlotConfig {
  data: JsonObject[];
  marks: CompiledMark[];
}

export const SUPPORTED_MARKS: MarkSpec["type"][] = [
  "barX", "barY", "lineX", "lineY", "areaX", "areaY", "dot", "rect", "cell",
  "ruleX", "ruleY", "text", "tickX", "tickY", "boxX", "boxY"
];
const supportedMarks = new Set<MarkSpec["type"]>(SUPPORTED_MARKS);
const supportedOptions = new Set(["curve", "fillOpacity", "strokeWidth", "r", "inset", "title"]);
const channels = ["x", "y", "color", "fill", "stroke", "size", "text"] as const;

function asOptions(mark: MarkSpec): JsonObject {
  const options: JsonObject = {};
  for (const channel of channels) {
    if (mark[channel] !== undefined) options[channel] = mark[channel] as JsonValue;
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
  return {
    data: structuredClone(rows),
    marks: visual.marks.map((mark) => {
      if (!supportedMarks.has(mark.type)) throw new Error(`unsupported_visual_feature: mark ${mark.type}`);
      return { id: mark.id, type: mark.type, options: asOptions(mark) };
    })
  };
}
