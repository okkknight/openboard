# OpenBoard LC2 — Retained & Spatial Construction Runtime

## 1. Purpose

LC0/LC1 made work visible before durable commit, but the renderer still behaves as a final-result swapper. The audited implementation retains the card shell while rebuilding the complete SVG subtree. Plot mark identity and datum identity are not available in the browser contract. LC2 changes the rendering model so semantic state changes become visible drawing operations.

The product goal is not “smooth charts.” It is **visible construction of data thinking**.

## 2. Ground truth from the renderer audit

Current facts that LC2 must respect:

- `article.visual-card` and `.plot` container are retained.
- Plot SVG, axes, Plot mark groups, Plot geometry nodes, primitive groups, and primitive children are rebuilt.
- `CompiledMark.id` exists server-side but is dropped by the browser adapter.
- Plot DOM exposes mark-family ARIA labels, not stable visual mark or business datum identity.
- primitive layer id survives only at the group level; primitive children are unkeyed.
- `RenderArtifact` already exists as a cache boundary and contains visual + rows + plot payload + observation.
- Work events are sequenced, but browser render requests can still race.
- Work previews currently disable entrance animation.

Therefore direct arbitrary SVG diff is rejected as the primary architecture. The identity contract is introduced at the RenderArtifact/compiler boundary.

## 3. Architecture

```text
VisualSpec / Effective Scene
        |
        v
Query + compile
        |
        v
RenderArtifact V2
  - visual/generation
  - rows/plot payload
  - identity descriptors
  - primitive values with keys
        |
        v
Detached Next Geometry
  Observable Plot + primitive compiler
        |
        v
Identity annotation / layer extraction
        |
        v
Visual Reconciler
  current retained viewport
  + next keyed layer model
        |
        +--> axis replace plan
        +--> mark ENTER
        +--> mark UPDATE
        +--> mark EXIT
        |
        v
Motion Grammar
        |
        v
Persistent SVG / card DOM
```

A second path owns card space:

```text
Canvas layout patch
   -> retained card geometry
   -> spatial transition (FLIP-style)
   -> no unrelated data re-render
```

## 4. RenderArtifact V2

RenderArtifact remains runtime-owned and disposable. It is not Durable Scene state.

Required conceptual fields:

```ts
interface RenderArtifactV2 {
  artifact_version: 2;
  visual_id: string;
  generation: number;
  revision?: number;
  work_id?: string;
  visual: VisualSpec;
  columns: string[];
  rows: JsonObject[];
  plot: PlotConfig;
  observation: Observation;
  identity: RenderIdentityContract;
}
```

`RenderIdentityContract` must describe identity, not geometry:

```ts
interface RenderIdentityContract {
  visual_key: string;
  marks: MarkIdentityDescriptor[];
}

interface MarkIdentityDescriptor {
  mark_id: string;
  renderer: "plot" | "primitive";
  mark_type: string;
  identity_mode: "datum" | "series" | "singleton" | "nonretainable";
  key_fields: string[];
  series_fields?: string[];
  layer_key: string;
}
```

The exact repository type names may vary, but these semantics are mandatory.

## 5. Identity rules

### 5.1 Never infer identity from DOM order

Array index, SVG child position, and ARIA family labels are not stable identity.

### 5.2 Key selection

For datum marks (`bar`, `dot`, `rule`, `text`, primitive `arc/rect/circle/...`), choose fields that identify the semantic datum in the rendered result. Typical examples:

- channel distribution: `channel`;
- product × region: `product, region`;
- time points: `date` plus series field when multiple series exist.

For series marks (`line`, `area`), the retained DOM identity is series-level. Use grouping/series fields; if there is only one series, use singleton identity under that `mark_id`.

### 5.3 Canonical key format

Keys must preserve type and null distinctions. A recommended canonical representation is JSON tuples with explicit type tags, hashed or escaped into a DOM-safe string:

```text
mark=<mark-id>|key=[["string","A"],["date","2026-09-01"]]
```

Do not stringify values with plain delimiter joins that can collide.

### 5.4 Ambiguity

If configured identity fields do not produce unique keys for a datum-level mark, the compiler must either:

- select a correct additional semantic field from known grouping dimensions; or
- mark the layer `nonretainable` and use layer-level replace/exit+enter.

It must not silently append current row index and pretend the identity is stable.

## 6. Plot integration

Observable Plot remains the geometry producer for statistical marks. LC2 must use an internal trusted bridge to preserve identity without allowing arbitrary user code.

The installed Plot version exposes mark render/initializer extension points. Codex must inspect the exact 0.6.17 type signature and use only internal browser code to annotate generated groups/nodes. The Scene/Visual DSL must remain data-only.

Target browser geometry contract:

```text
svg[data-visual-id]
  g[data-zone="axes"]
  g[data-mark-id="orders-bars"][data-mark-type="barY"]
    rect[data-render-key="..."]
  g[data-mark-id="trend-line"][data-mark-type="lineY"]
    path[data-render-key="series:..."]
  g[data-mark-id="orders-arc"][data-renderer="primitive"]
    path[data-render-key="..."]
```

If Plot cannot safely expose datum node association for a specific mark shape, that mark may be reconciled at series/layer granularity. Correct identity is more important than maximum retention.

## 7. Retained viewport and reconciliation

Each plot Visual owns a stable viewport root after first mount.

Normal compatible update:

1. produce next detached geometry;
2. extract keyed next layers;
3. compare by `mark_id`;
4. compare keyed children for retainable layers;
5. produce `RenderOperation[]`;
6. apply operations to current nodes;
7. run motion strategy;
8. remove EXIT nodes after motion completion;
9. publish the current generation as painted.

Conceptual operations:

```ts
type RenderOperation =
  | { type: "enter"; markId: string; key: string; next: NodeDescriptor }
  | { type: "update"; markId: string; key: string; current: Element; next: NodeDescriptor }
  | { type: "exit"; markId: string; key: string; current: Element }
  | { type: "replace-layer"; markId: string; nextLayer: LayerDescriptor }
  | { type: "replace-axes"; nextAxes: AxesDescriptor };
```

A generic recursive virtual DOM is not required.

## 8. Axis policy

LC2 prioritizes mark continuity. Axes/grid may be treated as a replaceable subtree when scale/domain/layout changes.

- Stable viewport: retained.
- Axis zone: replaceable or short crossfade.
- Mark layer: retained/keyed when identity is valid.

This prevents axis complexity from blocking visible mark construction.

## 9. Motion Grammar

Motion is a presentation of real render operations.

Default duration band: ~160–320 ms. Motion is short enough that the semantic cadence comes from Agent operations, not animation delays.

### 9.1 Same-family strategies

- **bar/rect:** ENTER from baseline/zero size; UPDATE x/y/width/height; EXIT collapse to baseline.
- **dot/circle:** ENTER radius/scale 0; UPDATE cx/cy/r; EXIT radius/scale 0.
- **rule/line primitive:** ENTER draw from one end; UPDATE endpoints; EXIT retract/fade.
- **text:** ENTER subtle opacity/translate; UPDATE position/content without full disappearance; EXIT fade.
- **primitive arc:** ENTER sweep angle; UPDATE angle/radii; EXIT collapse angle.
- **line/area Plot path:** retain series identity. ENTER draw/fade. UPDATE uses safe path interpolation only when explicitly supported; otherwise short old/new path crossfade inside the retained series layer. EXIT erase/fade.

### 9.2 Stagger

A small stagger is allowed only to communicate the drawing of multiple real marks:

- apply only to ENTER operations;
- cap total stagger to a short window (~120 ms);
- disable/collapse stagger above a configured mark-count threshold (for example 30–50 nodes);
- never use stagger to delay a result for theatrical effect.

### 9.3 Reduced motion

With `prefers-reduced-motion`, all semantic states and reconciliation remain; decorative interpolation collapses to immediate or minimal-opacity updates.

## 10. Spatial Construction

Card nodes already have stable identity. LC2 uses that instead of recreating a layout engine.

### 10.1 Layout-only updates

A move/resize must update affected card geometry only. It must not trigger full Scene reload, DuckDB query, or unrelated Visual render.

### 10.2 FLIP-style motion

For retained cards:

1. measure old rect;
2. apply new layout;
3. measure new rect;
4. temporarily transform from old geometry to new;
5. animate transform to identity.

No physics engine is required.

### 10.3 Derived visual birth

When `derived_from` points to an existing visual, a new card may originate from a point/edge near the parent card and expand into its final layout. This is spatial context, not fake reasoning.

## 11. Cross-Mark Transition Planner

Cross-mark transitions are semantic and identity-aware.

Planner input:

```text
current mark family
next mark family
shared mark/datum identity
current geometry metadata
next geometry metadata
reduced-motion preference
```

Strategy classes:

- same family -> same-family UPDATE;
- compatible explicit pair -> defined cross-mark strategy;
- unsupported pair -> old EXIT + new ENTER.

Required initial pairs:

- bar <-> dot: collapse/expand around shared datum key;
- bar -> arc/pie: bar EXIT/collapse followed by arc sweep ENTER using shared datum keys;
- arc -> bar: arc collapse followed by bar ENTER;
- bar -> line: bars EXIT, line series draw ENTER;
- line -> bar: line EXIT/fade, bars ENTER.

Arbitrary topological morphing is not required.

## 12. Browser race safety

Work event sequence alone is insufficient because visual fetch/render requests are asynchronous.

Each visual render request must have a per-visual generation/token. Before applying reconciliation:

```text
if response.generation < latestRequestedGeneration[visualId]: discard
```

Using `AbortController` to cancel older fetches is recommended in addition to generation checks, but generation validation remains the correctness guard.

## 13. WorkSession integration

LC2 does not change durable WorkSession semantics.

- Working visual changes reconcile with motion.
- Work previews must no longer be globally excluded from motion.
- `work.cancel` removes working-only nodes with a short cancellation transition or immediately under reduced motion, then shows durable state.
- `work.commit` must not replay construction. The working retained DOM should converge to the durable revision without visually starting over.

## 14. Error and fallback policy

- invalid identity -> structured artifact/compiler error when correctness is knowable before render;
- non-unique identity -> nonretainable layer or explicit error according to mark semantics;
- unknown mark transition -> EXIT + ENTER;
- unsupported geometry reconciliation -> replace-layer, not whole visual;
- catastrophic renderer mismatch -> visual-level rebuild allowed as a logged fallback, not normal path.

## 15. Performance budgets

These are engineering targets, not correctness gates for all hardware:

- 10–100 mark reconcile: no noticeable blocking; target <= 16 ms JS reconcile work where practical;
- ~1000 marks: target <= 50 ms reconciliation planning; animation/stagger should degrade gracefully;
- no single LC2 reconciliation loop should intentionally create >50 ms main-thread long tasks without measurement and justification;
- layout-only update performs zero DuckDB queries;
- stale responses do zero DOM writes.

## 16. Non-goals

- no raw-row streaming;
- no generic VDOM;
- no arbitrary path morph guarantee;
- no renderer replacement;
- no chart-template expansion;
- no multi-user collaborative scene CRDT;
- no animation timeline editor.

## 17. Completion criteria

LC2 is complete only when identity, retention, mark motion, spatial construction, cross-mark transitions, race safety, reduced motion, regression compatibility, and an actual multi-step E2E timeline are all demonstrated.
