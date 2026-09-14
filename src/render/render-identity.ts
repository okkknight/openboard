import type { EncodingValue, JsonObject, MarkIdentityDescriptor, MarkSpec, RendererKind, RenderIdentityContract, VisualSpec } from "../core/types.js";

type TaggedValue = [string, string | number | boolean | null];

function tagged(value: unknown): TaggedValue {
  if (value === null) return ["null", null];
  if (value === undefined) return ["undefined", null];
  if (value instanceof Date) return ["date", value.toISOString()];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid_render_identity: non-finite number");
    return ["number", value];
  }
  if (typeof value === "boolean") return ["boolean", value];
  throw new Error(`invalid_render_identity: unsupported ${typeof value}`);
}

export function canonicalRenderKey(markId: string, fields: string[], row: JsonObject): string {
  return `mark=${markId}|key=${JSON.stringify(fields.map((field) => tagged(row[field])))}`;
}

function dimensionFields(visual: VisualSpec, rows: JsonObject[]): string[] {
  return (visual.query.dimensions ?? [])
    .map((dimension) => dimension.alias ?? (dimension.time_grain ? `${dimension.field}_${dimension.time_grain}` : dimension.field))
    .filter((field) => rows.some((row) => field in row));
}

function field(value: EncodingValue | undefined, rows: JsonObject[]): string | undefined {
  if (value && typeof value === "object" && !Array.isArray(value) && "field" in value && typeof value.field === "string") return value.field;
  if (typeof value === "string" && rows.some((row) => value in row)) return value;
  return undefined;
}

function channelFields(mark: MarkSpec, rows: JsonObject[]): string[] {
  const channels = ["x", "y", "color", "fill", "stroke", "text"] as const;
  const fields = channels
    .map((channel) => field(mark[channel] ?? mark.encoding?.[channel], rows))
    .filter((candidate): candidate is string => Boolean(candidate));
  return [...new Set(fields)];
}

function isSeriesMark(mark: MarkSpec): boolean {
  return mark.type === "lineX" || mark.type === "lineY" || mark.type === "areaX" || mark.type === "areaY" || mark.type === "line" || mark.type === "area";
}

function isSingletonMark(mark: MarkSpec): boolean {
  return mark.type === "path";
}

export function describeMarkIdentity(visual: VisualSpec, mark: MarkSpec, renderer: RendererKind, rows: JsonObject[]): MarkIdentityDescriptor {
  const dimensions = dimensionFields(visual, rows);
  const measures = new Set((visual.query.measures ?? []).map((measure) => measure.alias));
  const channels = channelFields(mark, rows).filter((candidate) => !measures.has(candidate));
  const layer_key = `${renderer}:${mark.id}`;

  if (isSingletonMark(mark)) return { mark_id: mark.id, renderer, mark_type: mark.type, identity_mode: "singleton", key_fields: [], layer_key };

  if (isSeriesMark(mark)) {
    const series_fields = channels.filter((candidate) => candidate !== field(mark.x ?? mark.encoding?.x, rows) && candidate !== field(mark.y ?? mark.encoding?.y, rows));
    if (series_fields.length) return { mark_id: mark.id, renderer, mark_type: mark.type, identity_mode: "series", key_fields: series_fields, series_fields, layer_key };
    const nonAxisDimensions = dimensions.filter((candidate) => candidate !== field(mark.x ?? mark.encoding?.x, rows) && candidate !== field(mark.y ?? mark.encoding?.y, rows));
    if (nonAxisDimensions.length) return { mark_id: mark.id, renderer, mark_type: mark.type, identity_mode: "series", key_fields: nonAxisDimensions, series_fields: nonAxisDimensions, layer_key };
    return { mark_id: mark.id, renderer, mark_type: mark.type, identity_mode: "singleton", key_fields: [], layer_key };
  }

  const key_fields = dimensions.length ? dimensions : channels;
  if (!key_fields.length) return { mark_id: mark.id, renderer, mark_type: mark.type, identity_mode: "nonretainable", key_fields: [], layer_key };
  return { mark_id: mark.id, renderer, mark_type: mark.type, identity_mode: "datum", key_fields, layer_key };
}

export function renderKeys(descriptor: MarkIdentityDescriptor, rows: JsonObject[]): string[] {
  if (descriptor.identity_mode === "nonretainable") return [];
  if (descriptor.identity_mode === "singleton") return rows.length ? [`mark=${descriptor.mark_id}|key=[["singleton",null]]`] : [];
  const keys = rows.map((row) => canonicalRenderKey(descriptor.mark_id, descriptor.key_fields, row));
  if (descriptor.identity_mode === "datum") {
    const seen = new Set<string>();
    for (const key of keys) {
      if (seen.has(key)) throw new Error(`duplicate_render_key: ${descriptor.mark_id}`);
      seen.add(key);
    }
  }
  return keys;
}

export function renderIdentity(visual: VisualSpec, descriptors: MarkIdentityDescriptor[]): RenderIdentityContract {
  return { visual_key: `visual:${visual.id}`, marks: descriptors };
}
