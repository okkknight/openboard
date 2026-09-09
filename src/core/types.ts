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
  | "boxX" | "boxY";

export type ChannelValue = JsonValue;

export interface MarkSpec {
  id: string;
  type: MarkType;
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
  marks: MarkSpec[];
  layout: LayoutSpec;
  derived_from?: string;
  facet?: JsonObject;
}

export interface AnnotationSpec {
  id: string;
  target?: string;
  text: string;
  anchor?: { x: number; y: number };
  created_at: string;
}

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

export interface ComposeInput {
  action: ComposeAction;
  target?: string;
  targets?: string[];
  layout?: LayoutSpec;
  arrangement?: "row" | "column" | "grid" | "compact";
}

export interface CompiledQuery {
  sql: string;
  params: JsonPrimitive[];
  projectedFields: string[];
  requestedLimit?: number;
}
