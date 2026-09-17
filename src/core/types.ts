export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject { [key: string]: JsonValue | undefined }

export type DatasetFormat = "csv" | "parquet";

export interface ColumnProfile {
  name: string;
  type: string;
  role?: "dimension" | "measure" | "time" | "unknown";
  nullable?: boolean;
  distinct_count?: number;
}

export interface DatasetSpec {
  id: string;
  path: string;
  format: DatasetFormat;
  fingerprint?: string;
  row_count?: number;
  columns?: ColumnProfile[];
}

export type FilterOp =
  | "eq" | "neq" | "in" | "not_in" | "gt" | "gte" | "lt" | "lte"
  | "between" | "contains" | "is_null" | "not_null" | "last_days";

export interface FilterSpec {
  field: string;
  op: FilterOp;
  value?: JsonValue;
}

export type TimeGrain = "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";

export interface DimensionSpec {
  field: string;
  time_grain?: TimeGrain;
  alias?: string;
}

export type Aggregate = "count" | "count_distinct" | "sum" | "avg" | "min" | "max" | "median" | "quantile";

export interface MeasureSpec {
  field?: string;
  agg?: Aggregate;
  expr?: string;
  alias: string;
  quantile?: number;
}

export interface SortSpec {
  field: string;
  direction: "asc" | "desc";
}

export interface SampleSpec {
  method: "reservoir";
  size: number;
}

export interface QuerySpec {
  filters?: FilterSpec[];
  dimensions?: DimensionSpec[];
  measures?: MeasureSpec[];
  sort?: SortSpec[];
  limit?: number;
  sample?: SampleSpec;
  sql?: string;
}

export type MarkType =
  | "barX" | "barY" | "lineX" | "lineY" | "areaX" | "areaY" | "dot"
  | "rect" | "cell" | "ruleX" | "ruleY" | "text" | "tickX" | "tickY"
  | "boxX" | "boxY" | PrimitiveMarkType;

export type ChannelValue = JsonValue;

export type CoordinateSpec = { type: "cartesian" | "polar" };

export type RendererKind = "plot" | "primitive";

export type RenderIdentityMode = "datum" | "series" | "singleton" | "nonretainable";

export interface MarkIdentityDescriptor {
  mark_id: string;
  renderer: RendererKind;
  mark_type: string;
  identity_mode: RenderIdentityMode;
  key_fields: string[];
  series_fields?: string[];
  layer_key: string;
}

export interface RenderIdentityContract {
  visual_key: string;
  marks: MarkIdentityDescriptor[];
}

export interface EncodingRef {
  field?: string;
  constant?: JsonValue;
  derived?: string;
}

export type EncodingValue = JsonValue | EncodingRef;

export interface EncodingSpec {
  x?: EncodingValue;
  y?: EncodingValue;
  x1?: EncodingValue;
  x2?: EncodingValue;
  y1?: EncodingValue;
  y2?: EncodingValue;
  angle?: EncodingValue;
  angle1?: EncodingValue;
  angle2?: EncodingValue;
  radius?: EncodingValue;
  innerRadius?: EncodingValue;
  outerRadius?: EncodingValue;
  color?: EncodingValue;
  fill?: EncodingValue;
  stroke?: EncodingValue;
  size?: EncodingValue;
  opacity?: EncodingValue;
  text?: EncodingValue;
  shape?: EncodingValue;
}

export type PrimitiveMarkType = "rect" | "circle" | "line" | "arc" | "path" | "text" | "area";

export interface MarkSpec {
  id: string;
  type: MarkType;
  renderer?: RendererKind;
  encoding?: EncodingSpec;
  x?: ChannelValue;
  y?: ChannelValue;
  color?: ChannelValue;
  fill?: ChannelValue;
  stroke?: ChannelValue;
  size?: ChannelValue;
  opacity?: number;
  text?: ChannelValue;
  filter?: FilterSpec[];
  options?: JsonObject;
}

export interface LayoutSpec {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisualSpec {
  id: string;
  kind: "plot" | "table" | "kpi";
  title?: string;
  source: string;
  query: QuerySpec;
  coordinate?: CoordinateSpec;
  marks: MarkSpec[];
  layout: LayoutSpec;
  derived_from?: string;
  facet?: JsonObject;
}

export interface AnnotationStyle {
  variant: "caption" | "body" | "insight" | "callout";
  align?: "start" | "center" | "end";
  color_role?: "default" | "muted" | "accent" | "warning";
}

export interface AnnotationSpec {
  id: string;
  target?: string;
  text: string;
  anchor?: { x: number; y: number };
  layout?: LayoutSpec;
  style?: AnnotationStyle;
  created_at: string;
}

export interface AnnotationPatch {
  text?: string;
  target?: string | null;
  anchor?: { x: number; y: number } | null;
  layout?: LayoutSpec;
  style?: AnnotationStyle;
}

export type AnnotationMutation =
  | ({ mode?: "create" } & Omit<AnnotationSpec, "id" | "created_at"> & { id?: string })
  | { mode: "patch"; id: string; patch: AnnotationPatch };

export type CanvasAnnotateInput = AnnotationMutation & {
  expected_revision?: number;
  work_id?: string;
};

export interface CanvasState {
  focus?: string;
  viewport?: { x: number; y: number; zoom: number };
  groups?: Array<{ id: string; visual_ids: string[] }>;
}

export interface Scene {
  canvas_id: string;
  revision: number;
  datasets: Record<string, DatasetSpec>;
  visuals: Record<string, VisualSpec>;
  annotations: Record<string, AnnotationSpec>;
  canvas: CanvasState;
}

export type WorkStatus = "active" | "committing" | "completed" | "cancelled" | "failed";

/** A partial visual exists only inside a non-persistent WorkSession. */
export interface WorkingVisualDraft {
  id: string;
  kind?: VisualSpec["kind"];
  title?: string;
  source?: string;
  query?: QuerySpec;
  coordinate?: CoordinateSpec;
  marks?: MarkSpec[];
  layout?: LayoutSpec;
  derived_from?: string;
  facet?: JsonObject;
  phase?: "draft" | "ready" | "error";
  error?: string;
}

export type WorkingVisual = VisualSpec | WorkingVisualDraft;

export interface WorkingOverlay {
  visuals: Record<string, WorkingVisualDraft>;
  removed_visual_ids: string[];
  annotations: Record<string, AnnotationSpec>;
  removed_annotation_ids: string[];
  canvas?: CanvasState;
  operations: number;
}

export interface WorkActivity {
  kind: "inspect" | "query" | "render";
  status: "started" | "completed" | "failed";
  label: string;
  visual_id?: string;
  error?: string;
}

export interface WorkSession {
  id: string;
  base_revision: number;
  status: WorkStatus;
  sequence: number;
  started_at: string;
  overlay: WorkingOverlay;
  activity?: WorkActivity;
}

export interface EffectiveScene extends Omit<Scene, "visuals"> {
  visuals: Record<string, WorkingVisual>;
}

export interface VisualPatch {
  set?: Record<string, JsonValue>;
  unset?: string[];
  add_marks?: MarkSpec[];
  remove_marks?: string[];
}

export interface HistoryRecord {
  revision: number;
  parent_revision: number | null;
  operation: string;
  target?: string;
  input: JsonValue;
  timestamp: string;
}

export type ComposeAction = "move" | "resize" | "delete" | "focus" | "group" | "ungroup" | "arrange";

export interface CanvasObjectRef {
  kind: "visual" | "annotation";
  id: string;
}

export interface LayoutUpdate {
  target: CanvasObjectRef;
  layout: LayoutSpec;
}

export interface ComposeInput {
  action: ComposeAction;
  target?: string;
  targets?: string[];
  layout?: LayoutSpec;
  layout_updates?: LayoutUpdate[];
  arrangement?: "row" | "column" | "grid" | "compact";
}

export interface HistoryApplyInput {
  action: "undo" | "redo" | "checkpoint" | "goto" | "fork";
  revision?: number;
  label?: string;
  expected_revision?: number;
}

export interface CompiledQuery {
  sql: string;
  params: JsonPrimitive[];
  projectedFields: string[];
  requestedLimit?: number;
}
