import type { MarkSpec, PrimitiveMarkType, RendererKind } from "../core/types.js";

export const SUPPORTED_MARKS: MarkSpec["type"][] = [
  "barX", "barY", "lineX", "lineY", "areaX", "areaY", "dot", "rect", "cell",
  "ruleX", "ruleY", "text", "tickX", "tickY", "boxX", "boxY"
];

export const SUPPORTED_PRIMITIVES: PrimitiveMarkType[] = ["rect", "circle", "line", "arc", "path", "text", "area"];

export const rendererRegistry = Object.freeze({
  plot: new Set<string>(SUPPORTED_MARKS),
  primitive: new Set<string>(SUPPORTED_PRIMITIVES)
});

const plotMarks = rendererRegistry.plot;
const primitiveMarks = rendererRegistry.primitive;

export function resolveRenderer(mark: MarkSpec): RendererKind {
  if (mark.renderer) return mark.renderer;
  if (primitiveMarks.has(mark.type) && !plotMarks.has(mark.type)) return "primitive";
  return "plot";
}

export function isPlotMark(type: string): boolean { return plotMarks.has(type); }
export function isPrimitiveMark(type: string): boolean { return primitiveMarks.has(type); }
