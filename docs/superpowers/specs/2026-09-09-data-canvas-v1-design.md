# Data Canvas V1 Design

**Date:** 2026-09-09  
**Status:** Frozen for M0/M1 implementation

## 1. Product definition

Data Canvas is a lightweight local visualization runtime whose primary operator is an AI coding/analysis agent such as Codex.

The core metaphor is:

- **data = paint**;
- **Data Canvas = canvas + brushes**;
- **Codex = the painter/reasoner**.

The system is not a BI dashboard builder. The runtime exposes stable data and visual primitives. Codex uses those primitives to externalize a changing data-analysis thought process. A persistent scene accumulates, mutates, branches and can be revisited.

The user should not need to predefine drill paths, filters, dashboards, chart templates or analysis dimensions.

## 2. Success criteria

V1 succeeds when all of the following are true:

1. Local CSV data can be discovered without a data-import UI.
2. Codex can inspect schema/profile information before visualizing.
3. Codex can create a visual from a structured QuerySpec and mark-based VisualSpec.
4. Codex can patch an existing visual in place.
5. The browser sees the mutation immediately without page reload.
6. A visual may contain layered marks rather than being limited to one chart type.
7. Codex receives structured observations after queries/renders.
8. Analysis history is persisted and can support undo/redo/goto/fork.
9. No analysis operation causes dynamic generation of HTML/CSS/React source.
10. The codebase remains small enough that adding a mark, query operator or tool behavior is localized.

## 3. Explicit non-goals

V1 does not include:

- user accounts or authentication;
- cloud hosting or collaboration;
- permissions beyond local filesystem access;
- dashboard-builder UI;
- drag-and-drop data field editors;
- metric administration UI;
- template marketplace;
- report scheduling;
- cross-filter by direct mouse interaction between visuals;
- plugin marketplace;
- custom JavaScript execution from MCP inputs;
- arbitrary HTML/SVG injection;
- automatic background sampling;
- a proprietary chart renderer.

Mosaic is not a V1 dependency. It may be introduced later behind an adapter if direct user cross-filtering, large multi-view query coordination, or selection propagation becomes important.

## 4. Architecture

```text
Codex / MCP host
      |
      | 9 tools
      v
+---------------------------+
| Data Canvas Runtime       |
|                           |
| SceneStore   QueryEngine  |
| History      Observation  |
+------+-------------+------+
       |             |
       |             +--> DuckDB Node Neo --> CSV / Parquet
       |
       +--> Scene events --> WebSocket --> Browser Canvas
                                      |
                                      +--> Observable Plot
```

The runtime owns the durable state. DuckDB executes data work. Observable Plot is a disposable renderer. MCP is an adapter around the runtime, not where product logic lives.

## 5. Runtime state model

A Scene contains four object families:

1. `datasets`
2. `visuals`
3. `annotations`
4. `canvas`

History is stored separately as operations and revision snapshots/checkpoints.

### 5.1 Dataset

A Dataset is a registered local source plus cached metadata.

Required fields:

```ts
interface DatasetSpec {
  id: string;
  path: string;
  format: "csv" | "parquet";
  fingerprint?: string;
  row_count?: number;
  columns?: ColumnProfile[];
}
```

Dataset IDs are stable names. Internal conversion from CSV to Parquet, if added later, must not change the public dataset ID.

### 5.2 Visual

A Visual is the central scene object:

```ts
interface VisualSpec {
  id: string;
  kind: "plot" | "table" | "kpi";
  title?: string;
  source: string;
  query: QuerySpec;
  marks: MarkSpec[];
  layout: LayoutSpec;
  derived_from?: string;
}
```

`kind="plot"` is the M0 priority. `table` and `kpi` are M1-compatible but must use the same source/query contract.

A Visual is not persisted as rendered HTML, SVG or canvas pixels.

### 5.3 Annotation

Annotations are scene-level thinking artifacts:

```ts
interface AnnotationSpec {
  id: string;
  target?: string;
  text: string;
  anchor?: { x: number; y: number };
  created_at: string;
}
```

M1 supports text annotations only. No rich document editor.

### 5.4 Canvas

Canvas state is deliberately small:

```ts
interface CanvasState {
  focus?: string;
  viewport?: { x: number; y: number; zoom: number };
  groups?: Array<{ id: string; visual_ids: string[] }>;
}
```

Layout remains stored per visual so each visual can be moved/resized independently.

## 6. QuerySpec — how Codex mixes the paint

QuerySpec is the default data-language exposed to the agent.

```ts
interface QuerySpec {
  filters?: FilterSpec[];
  dimensions?: DimensionSpec[];
  measures?: MeasureSpec[];
  sort?: SortSpec[];
  limit?: number;
  sample?: SampleSpec;
  sql?: string;
}
```

`sql` is mutually exclusive with structured fields except `limit` and explicit `sample`.

### 6.1 Filters

Supported V1 operators:

`eq`, `neq`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `between`, `contains`, `is_null`, `not_null`, `last_days`.

Values are always parameterized by the QueryEngine. Field identifiers are quoted and resolved against known dataset columns. Raw SQL expression injection is forbidden in filters.

### 6.2 Dimensions

```ts
interface DimensionSpec {
  field: string;
  time_grain?: "minute" | "hour" | "day" | "week" | "month" | "quarter" | "year";
  alias?: string;
}
```

### 6.3 Measures

Two forms are allowed:

```ts
{ field: "amount", agg: "sum", alias: "revenue" }
```

or explicit escape hatch:

```ts
{ expr: "avg(case when status='FAILED' then 1 else 0 end)", alias: "failure_rate" }
```

Supported aggregate keywords: `count`, `count_distinct`, `sum`, `avg`, `min`, `max`, `median`, `quantile`.

Raw measure expressions are trusted-agent escape hatches and are never accepted from untrusted remote users in V1.

### 6.4 Sampling rule

Sampling never happens implicitly.

When the renderer/query would exceed configured point limits, return:

```json
{
  "status": "render_limit_exceeded",
  "requested_rows": 10237881,
  "limit": 50000,
  "suggestions": ["aggregate", "bin", "explicit_sample"]
}
```

Explicit sample example:

```json
{
  "sample": { "method": "reservoir", "size": 20000 }
}
```

## 7. Visual grammar — how Codex paints

A plot consists of layered marks. V1 does not define a hard chart-type hierarchy.

```ts
interface MarkSpec {
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
  options?: Record<string, JsonValue>;
}
```

Initial mark registry:

- `barX`, `barY`
- `lineX`, `lineY`
- `areaX`, `areaY`
- `dot`
- `rect`
- `cell`
- `ruleX`, `ruleY`
- `text`
- `tickX`, `tickY`
- `boxX`, `boxY`

Facet is a Visual-level encoding in M1, not a mark.

The renderer adapter compiles supported MarkSpecs to Observable Plot calls. Unsupported options fail explicitly with `unsupported_visual_feature`; they are never silently ignored.

## 8. The 9-tool surface

The MCP surface is intentionally small and orthogonal.

1. `canvas.inspect`
2. `data.inspect`
3. `data.query`
4. `visual.create`
5. `visual.patch`
6. `visual.clone`
7. `canvas.compose`
8. `canvas.annotate`
9. `history.apply`

Detailed JSON contracts live in `contracts/tool-surface.json`.

### Why there is no drill-down tool

“Drill down” is not primitive. Example “B channel -> city” is:

- patch/clone query filter `channel=B`;
- replace/add dimension `city`.

The agent reasons about analytical intent. The runtime exposes orthogonal brushes.

### Patch semantics

`visual.patch` is the most important operation.

Allowed patch operations:

- `set`: assign JSON values to whitelisted dotted paths;
- `unset`: remove optional whitelisted paths;
- `add_marks`: append mark objects by unique id;
- `remove_marks`: remove marks by id.

Immutable fields: `id`, `derived_from` after creation.

A successful mutation increments scene revision exactly once.

## 9. Observations — the agent must see what it painted

Tool responses do not end at `success`.

For query/render outputs the runtime produces deterministic observation primitives where meaningful:

- row count;
- numeric min/max/mean/median;
- argmin/argmax when an x/key field exists;
- top categories;
- missing counts;
- first/last and absolute/relative change for ordered series;
- simple outlier candidates using a documented deterministic method.

The LLM interprets these primitives. The runtime does not generate prose conclusions.

M1 may expose `visual.snapshot` as an advanced non-core capability for multimodal inspection, but it is not part of the frozen nine tools.

## 10. Persistence and history

Workspace layout:

```text
project/
  data/
  .datacanvas/
    scene.json
    history.jsonl
    metadata.json
    cache/
```

Every scene-changing operation appends an immutable history record:

```ts
interface HistoryRecord {
  revision: number;
  parent_revision: number | null;
  operation: string;
  target?: string;
  input: JsonValue;
  timestamp: string;
}
```

M1 may use compact checkpoints to avoid replaying the entire log. Rendered output is not persisted.

## 11. Realtime behavior

The daemon owns a single in-process EventBus in V1.

Mutation flow:

1. MCP handler validates request.
2. Runtime checks `expected_revision` if supplied.
3. Runtime mutates SceneStore once.
4. History record is appended.
5. Relevant query/render work is scheduled.
6. WebSocket emits one or more events containing the new revision.
7. Browser updates only affected scene objects.
8. MCP response returns when required query/render result is available, or returns accepted + correlation id only for operations explicitly defined as asynchronous later. M0/M1 operations are synchronous from the caller's perspective.

Event examples:

- `scene.loaded`
- `visual.created`
- `visual.changed`
- `visual.removed`
- `annotation.created`
- `focus.changed`
- `history.changed`

## 12. Concurrency

V1 is local and typically single-agent, but every mutation accepts optional `expected_revision`.

If current revision differs:

```json
{
  "status": "revision_conflict",
  "expected_revision": 12,
  "actual_revision": 14
}
```

The agent should `canvas.inspect` and retry intentionally. No automatic last-write-wins for agent mutations.

## 13. Security and correctness boundaries

- Dataset paths must resolve inside the configured workspace roots.
- QuerySpec identifiers must resolve to known columns or aliases.
- Filter values are parameterized.
- No JavaScript evaluation from scene specs.
- No HTML/SVG injection from annotations or labels.
- Raw SQL runs only in the local trusted-agent mode and defaults to read-only queries.
- DuckDB connection must reject mutating statements for `data.query` unless a future explicit write mode exists.
- Sampling must be explicit.
- Renderer must fail on unsupported visual grammar rather than drop unsupported properties.

## 14. UI

V1 browser UI is intentionally minimal.

Required:

- spatial canvas;
- visual cards/objects;
- title and render area;
- focus indication;
- fit/reset-view controls;
- revision/history indicator;
- connection status.

Not required:

- chart editing controls;
- field picker;
- filter builder;
- embedded AI chat;
- dashboard design panels.

Codex is the operator. The browser is primarily the live viewport.

## 15. Technical choices frozen for M0/M1

- Node.js 22+
- TypeScript 5.8+
- `@duckdb/node-api` 1.5.5-r.4 Node Neo client
- MCP SDK v2 split server package (`@modelcontextprotocol/server`)
- Zod v4
- Observable Plot 0.6.x
- native/simple WebSocket server library chosen during implementation; avoid a heavyweight web framework unless required
- JSON/JSONL state persistence

Upstream facts verified 2026-09-09:

- DuckDB Node Neo is the recommended primary Node client; this package pins the available 1.5.5-r.4 release: https://duckdb.org/docs/lts/clients/node_neo/overview
- MCP TypeScript SDK v2 is the stable release line for the 2026-07-28 protocol and uses `@modelcontextprotocol/server`: https://ts.sdk.modelcontextprotocol.io/v2/
- Observable Plot uses layered marks rather than chart types: https://observablehq.com/plot/

## 16. M0 acceptance tests

M0 is complete only when all pass:

1. Put `examples/orders.csv` in configured data root and start daemon.
2. `data.inspect` returns typed columns and top values.
3. `visual.create` creates a channel failure-rate visual and browser renders it.
4. `visual.patch` changes the **same visual id** to a daily last-30-days trend.
5. Browser changes without reload.
6. Scene revision increments exactly once per mutation.
7. MCP response contains result metadata and basic observation.
8. No generated HTML/CSS/React appears in scene/history.

## 17. M1 acceptance tests

M1 is complete only when all pass:

1. Two datasets can be discovered and inspected.
2. `data.query` supports structured query and local read-only SQL escape hatch.
3. `visual.clone` preserves original and creates derived visual.
4. `canvas.compose` can move/resize/focus/delete/arrange visuals.
5. `canvas.annotate` adds a persisted text conclusion.
6. `history.apply` supports undo, redo, checkpoint, goto and fork semantics documented in the tool contract.
7. At least the initial mark registry renders.
8. Explicit render limit blocks excessive raw points.
9. Restart restores scene and history.
10. Core + integration tests pass without dependence on a remote service.
