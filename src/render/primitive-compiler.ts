import type { CoordinateSpec, EncodingRef, EncodingSpec, EncodingValue, JsonObject, JsonValue, MarkSpec, PrimitiveMarkType } from "../core/types.js";

export interface PrimitiveLayer {
  id: string;
  type: PrimitiveMarkType;
  coordinate: CoordinateSpec["type"];
  values: JsonObject[];
  options: JsonObject;
}

const DANGEROUS_KEY = /^(?:script|html|style|on[a-z]+|javascript)$/i;
const SAFE_PATH = /^[MmZzLlHhVvCcSsQqTtAa0-9eE+.,\-\s]+$/;

function isEncodingRef(value: EncodingValue): value is EncodingRef {
  return typeof value === "object" && value !== null && !Array.isArray(value) && ("field" in value || "constant" in value || "derived" in value);
}

function resolve(value: EncodingValue | undefined, row: JsonObject, label: string): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (!isEncodingRef(value)) return value;
  if (value.field) {
    if (!(value.field in row)) throw new Error(`invalid_encoding: unknown field ${value.field}`);
    return row[value.field] ?? null;
  }
  if ("constant" in value) return value.constant;
  if (value.derived) {
    if (!(value.derived in row)) throw new Error(`invalid_encoding: unknown derived result ${value.derived}`);
    return row[value.derived] ?? null;
  }
  throw new Error(`invalid_encoding: ${label}`);
}

function number(value: JsonValue | undefined, label: string, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`invalid_encoding: ${label} must be finite`);
  return value;
}

function encoding(mark: MarkSpec): EncodingSpec {
  const result = { ...(mark.encoding ?? {}) };
  for (const key of ["x", "y", "x1", "x2", "y1", "y2", "color", "fill", "stroke", "size", "opacity", "text"] as const) {
    const legacy = (mark as unknown as Record<string, unknown>)[key];
    if (result[key] === undefined && legacy !== undefined) result[key] = legacy as EncodingValue;
  }
  return result;
}

function safeOptions(options: JsonObject | undefined): JsonObject {
  const inspect = (value: JsonValue, label: string): void => {
    if (typeof value === "string" && /<|javascript:|\bon\w+\s*=/i.test(value)) throw new Error(`unsupported_visual_feature: unsafe primitive option ${label}`);
    if (Array.isArray(value)) value.forEach((item, index) => inspect(item, `${label}.${index}`));
    else if (value && typeof value === "object") for (const [key, nested] of Object.entries(value)) {
      if (DANGEROUS_KEY.test(key)) throw new Error(`unsupported_visual_feature: unsafe primitive option ${label}.${key}`);
      if (nested !== undefined) inspect(nested, `${label}.${key}`);
    }
  };
  const result: JsonObject = {};
  for (const [key, value] of Object.entries(options ?? {})) {
    if (DANGEROUS_KEY.test(key)) throw new Error(`unsupported_visual_feature: unsafe primitive option ${key}`);
    if (value !== undefined) inspect(value, key);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function compileArc(mark: MarkSpec, rows: JsonObject[], coordinate: CoordinateSpec["type"]): JsonObject[] {
  if (coordinate !== "polar") throw new Error("invalid_coordinate: arc requires polar coordinate");
  const enc = encoding(mark);
  const angleRef = enc.angle ?? enc.y;
  if (angleRef === undefined) throw new Error("invalid_encoding: arc requires angle");
  const angles = rows.map((row) => number(resolve(angleRef, row, "angle"), "angle"));
  if (angles.some((value) => value < 0)) throw new Error("invalid_encoding: arc angle must be non-negative");
  const total = angles.reduce((sum, value) => sum + value, 0);
  if (!(total > 0)) throw new Error("invalid_encoding: arc angle total must be positive");
  const inner = rows.map((row) => number(resolve(enc.innerRadius, row, "innerRadius"), "innerRadius", 0));
  const outerRef = enc.outerRadius ?? enc.radius;
  const rawOuter = rows.map((row) => outerRef === undefined ? 1 : number(resolve(outerRef, row, "outerRadius"), "outerRadius"));
  const maxOuter = Math.max(...rawOuter, 1);
  let cursor = -Math.PI / 2;
  return rows.map((row, index) => {
    const startAngle = cursor;
    const endAngle = cursor + (angles[index] / total) * Math.PI * 2;
    cursor = endAngle;
    const value: JsonObject = { ...row, startAngle, endAngle, innerRadius: inner[index], outerRadius: rawOuter[index] / maxOuter };
    const color = resolve(enc.color, row, "color");
    if (color !== undefined) value.color = color;
    const fill = resolve(enc.fill, row, "fill");
    if (fill !== undefined) value.fill = fill;
    const stroke = resolve(enc.stroke, row, "stroke");
    if (stroke !== undefined) value.stroke = stroke;
    return value;
  });
}

function compileRows(mark: MarkSpec, rows: JsonObject[]): JsonObject[] {
  const enc = encoding(mark);
  return rows.map((row) => {
    const value: JsonObject = { ...row };
    for (const key of ["x", "y", "x1", "x2", "y1", "y2", "radius", "innerRadius", "outerRadius", "color", "fill", "stroke", "size", "opacity", "text", "shape"] as const) {
      const resolved = resolve(enc[key], row, key);
      if (resolved !== undefined) value[`_${key}`] = resolved;
    }
    return value;
  });
}

export function compilePrimitive(mark: MarkSpec, rows: JsonObject[], coordinate: CoordinateSpec = { type: "cartesian" }): PrimitiveLayer {
  const options = safeOptions(mark.options);
  if (mark.type === "path") {
    const d = options.d;
    if (typeof d !== "string" || !SAFE_PATH.test(d)) throw new Error("invalid_path: path d must contain only SVG geometry commands");
  }
  const values = mark.type === "arc" ? compileArc(mark, rows, coordinate.type) : compileRows(mark, rows);
  return { id: mark.id, type: mark.type as PrimitiveMarkType, coordinate: coordinate.type, values, options };
}
