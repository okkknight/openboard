# Data Canvas Renderer Implementation Report

审计日期：2026-09-14
审计范围：当前 `main` 分支、当前运行实例 `http://127.0.0.1:3000/`、本地 `@observablehq/plot@0.6.17`。
边界：本次只做 Renderer-specific audit；没有修改生产代码，没有实现 LC2，也没有添加依赖。

## 0. Ten required answers

| # | Question | Answer | Evidence / meaning |
|---|---|---|---|
| 1 | Is the visual card retained? | YES | `cardFor(id)` returns the existing `article.visual-card`; creation happens only when absent (`web/index.html:257-264`). |
| 2 | Is the SVG retained? | NO | Every completed Plot render creates `Plot.plot(...)` output and calls `plot.replaceChildren(svg)` (`web/index.html:285-290`). |
| 3 | Are axes retained? | NO | Axes are children of the newly created Plot SVG; no axis-level update or key exists. |
| 4 | Are bar `rect` nodes retained? | NO | They are inside the replaced SVG; Plot creates them during each `Plot.plot` call. |
| 5 | Is the line `path` retained? | NO | The line group/path is created by Plot on each call and discarded with the old SVG. |
| 6 | Is a primitive arc `path` retained? | NO | `renderPrimitiveLayer` creates a new path for each value and the parent SVG is replaced (`web/index.html:176-232`, `:289`). |
| 7 | Does `VisualSpec mark.id` map to a DOM node? | NO | The server keeps `CompiledMark.id`, but `markToPlot` passes only `type/options`; the id is dropped (`src/render/plot-compiler.ts:7-10,82-106`, `web/index.html:91-95,287`). Primitive layer id reaches a group-level `data-primitive`, not each mark/value. |
| 8 | Does a source datum map to a DOM node? | NO (browser contract) | Plot internally binds transient index arrays with d3 `.data(index)`, but the browser DOM exposes no source key; the current page probe found no usable `data-key`/business-key/ARIA datum mapping. |
| 9 | Is Observable Plot DOM sufficient for direct keyed diff? | NO | It supplies type-level ARIA groups and geometry, but current adapter supplies no stable mark id or datum key and reconstructs the whole SVG. |
| 10 | Is there a minimal retained-rendering insertion point? | PARTIAL | The narrowest browser hook is immediately before `plot.replaceChildren(svg)`, but a safe keyed diff requires a richer artifact/key contract upstream. Recommended LC2-A insertion layer: **B — RenderArtifact diff**. |

## 1. Executive Summary

The current renderer is a two-level renderer with a retained card shell and a rebuilt plot subtree. A WebSocket event causes the browser to fetch a complete `RuntimeResult`; Plot then constructs a fresh SVG, primitive layers are appended, and `replaceChildren` swaps the old subtree. Existing animations run after the final geometry exists, so they are entrance animations, not retained incremental construction.

Five highest-impact findings:

1. **Retention stops at `.plot`.** The `article`, header, title, id and plot container can survive; SVG, axes, marks, labels, and primitive nodes cannot.
2. **Visual identity is lost in the browser adapter.** Server-side `CompiledMark.id` is not forwarded to `Plot`; primitive `PrimitiveLayer.id` is only a group attribute, with no value-level key.
3. **Plot's DOM anatomy is descriptive, not keyed.** `aria-label="bar|line|dot|area|rule|text"` identifies a mark family, not a visual mark instance or source row.
4. **All semantic edits use the same full pipeline.** Title/style/query/filter/layout/mark-type changes all end at a fresh Plot SVG; layout events can reload every visual.
5. **The correct LC2-A seam is upstream of the browser DOM.** A RenderArtifact diff can carry mark/layer and datum keys while preserving Plot as a geometry producer; direct SVG diff would have to infer identity that is currently absent.

## 2. Exact browser render pipeline

Initial load is `reloadScene()` (`web/index.html:310-315`), followed by `renderEffectiveScene()` (`:304-309`). For each visual, `render(id, workId?)` performs:

1. `GET /api/visual/:id` (optionally `work_id`) (`:250-255`).
2. Server route awaits `runtime.renderVisual` before responding (`src/web/server.ts:30`).
3. Runtime chooses durable/effective scene, checks completeness, and obtains an artifact (`src/runtime/data-canvas-runtime.ts:106-115`).
4. On a cache miss, `#render` profiles the dataset, compiles QuerySpec, executes DuckDB/raw SQL, checks the render limit, compiles Plot/primitive configuration, and computes observations (`:263-272`).
5. Browser converts ISO date strings in plot rows (`web/index.html:96`), maps each Plot mark through `markToPlot` (`:91-95`), and calls `Plot.plot` (`:285-287`).
6. Primitive layers are appended to that SVG (`:288`, `:176-232`).
7. `plot.replaceChildren(svg)` replaces the previous content (`:289`).
8. If eligible, `animatePlotMarks(svg)` applies Web Animations/requestAnimationFrame after the complete tree exists (`:155-175`).

For a work event, the browser first merges overlays (`:235-245`), updates card/layout metadata, and renders effective visuals. The runtime emits ordered work events, but the browser still receives a complete render payload per visual.

## 3. Retention and replacement boundaries

| DOM boundary | Current behavior | Source |
|---|---|---|
| `#board` | retained | page lifetime |
| `article.visual-card[data-visual]` | retained when id already exists; created otherwise | `web/index.html:257-264` |
| `.visual-head`, `.visual-title`, `.visual-id` | retained; title text is reassigned | `:261-266` |
| `.plot` | retained container | `:267` |
| Plot SVG and descendants | rebuilt | `:285-290` |
| working frame | rebuilt with `replaceChildren(frame)` | `:270-277` |
| table and tbody rows | rebuilt with `replaceChildren(table)` | `:278-281` |
| KPI div | rebuilt with `replaceChildren(div)` | `:282-284` |
| error paragraph | rebuilt with `replaceChildren(p)` | `:292` |
| annotations | all annotation children rebuilt | `:297-301` |
| removed visual card | explicitly removed, then scene reload | `:304-308`, `:358` |

`updateScene` does retain card nodes while changing layout styles and focus class (`:297-302`), but any subsequent `render` still replaces the plot content.

## 4. Current live DOM anatomy

Read-only inspection of the running Chrome tab at revision 24 showed three cards: primitive donut, Plot bar, and Plot line+dot. Every card has exactly `.visual-head` and `.plot` children. Plot SVG attributes include `class="plot-d6a7b5"`, `fill="currentColor"`, system font attributes, `width`, `height`, and `viewBox`.

Observed bar groups:

```text
g aria-label="y-axis tick"        -> path × 4
g aria-label="y-axis tick label"  -> text × 4
g aria-label="y-axis label"       -> text × 1
g aria-label="x-axis tick"        -> path × 4
g aria-label="x-axis tick label"  -> text × 4
g aria-label="x-axis label"       -> text × 1
g aria-label="bar"                -> rect × 4
```

Observed line groups:

```text
same axis groups
g aria-label="line"               -> path × 1
g aria-label="dot"                -> circle × 16
```

Observed primitive donut:

```text
svg
  style
  g data-primitive="orders-donut-live" (no aria mark family)
    path × 4
    text × 4
```

The `data-primitive` group id is an implementation marker for the layer; it is not a per-slice identity.

## 5. Identity model: VisualSpec → PlotConfig → DOM

`VisualSpec.marks[]` contains an `id`, type, encodings and options. `compilePlot` emits `{id,type,options}` for Plot marks and `PrimitiveLayer {id,type,values,options}` for primitive marks (`src/render/plot-compiler.ts:7-21,82-106`; `src/render/primitive-compiler.ts:3-9,110-118`).

The browser adapter then executes `factory(data, mark.options || {})`; the `id` is not passed to Plot (`web/index.html:91-95`). Observable Plot receives a data array plus channel options and derives geometry. Consequently:

```text
VisualSpec mark.id --(server retained)--> CompiledMark.id --(browser adapter drops)--> no DOM id
PrimitiveLayer.id ---------------------------------------> g[data-primitive] only
source row -----------------------------------------------> transient Plot index/channel values
```

There is no browser-level `key`, `data-key`, `data-row-id`, or source-field attribute.

## 6. Observable Plot DOM implementation facts

The installed package is `@observablehq/plot@0.6.17` (`node_modules/@observablehq/plot/package.json`). `Plot.plot` creates one SVG, sets dimensions/viewBox/ARIA, then appends each mark's rendered group (`node_modules/@observablehq/plot/src/plot.js:251-295`).

Plot marks use d3 selections such as `.selectAll().data(index).enter()`; this is an internal render-time binding, not a retained update join. Bar uses `rect` unless rounded corners require a path (`src/marks/bar.js:21-56`); line groups index values into one path per series (`src/marks/line.js:52-78`); dot creates one circle/path per point (`src/marks/dot.js:73-137`); area creates one path per grouped series (`src/marks/area.js:46-70`).

Plot applies mark-family ARIA labels and optional class/styles (`src/style.js:323-389`). `ariaLabel` is a channel/type label, not a stable data key. Plot supports custom `className`, `ariaLabel`, `title`, channels, and an initializer/render hook in its public types (`src/mark.d.ts:135-143,250-293,470-473`), but the Data Canvas compiler allow-list does not expose those hooks: only `curve`, `fillOpacity`, `strokeWidth`, `r`, `inset`, `rx`, `ry`, and `title` are accepted (`src/render/plot-compiler.ts:24-25,38-50`).

## 7. Mark anatomy and identity table

| Visual mark | Current DOM | Geometry identity | Stable source/mark key? |
|---|---|---|---|
| `barX/barY` | `g[aria-label="bar"] > rect` (or path for complex radii) | one element per filtered index | NO in browser; transient index only |
| `lineX/lineY` | `g[aria-label="line"] > path` | one path per grouped series | NO; grouping is recomputed each Plot call |
| `dot` | `g[aria-label="dot"] > circle/path` | one element per point | NO |
| `areaX/areaY` | `g[aria-label="area"] > path` | one path per grouped area series | NO |
| `ruleX/ruleY` | `g[aria-label="rule"] > line` | one line per index | NO |
| `text` | `g[aria-label="text"] > text` | one text node per index; may contain tspans/title | NO |
| `rect/cell/box` Plot path | family-specific group and rect/path | per index | NO |
| primitive `arc` | `g[data-primitive] > path` plus optional text | one path/label per compiled value | layer id only; NO value key |
| primitive `rect/circle/line/path/text/area` | `g[data-primitive] > geometry` | one node per compiled value, except path/area often one node | layer id only; NO value key |

Source-level Plot groups can bind index arrays, but the current page-level contract does not expose the original row or a stable key. A line/area path is especially non-atomic: it represents a grouped series, so point-level diff cannot be inferred from its `d` string alone.

## 8. Primitive renderer anatomy

`renderPrimitiveLayer` creates a new SVG `g`, sets `data-primitive=layer.id`, then creates native SVG elements (`web/index.html:176-232`). Arc values are precomputed by `compileArc`: each row is spread into the value and receives `startAngle`, `endAngle`, radii, color/label and percent (`src/render/primitive-compiler.ts:66-95`). Other primitive values copy source fields and add underscored resolved encodings (`:98-107`).

The renderer never sets child keys, source-row ids, ARIA datum labels or `__data__`. Arc labels are separate text nodes and are positioned from the slice midpoint (`web/index.html:190-205`). A primitive path with `options.d` is a single static path (`:225-226`); a primitive area builds one `M … L … Z` path (`:229-230`).

## 9. Mixed Plot + primitive layers

`compilePlot` keeps an ordered `layers` list only when primitives exist (`src/render/plot-compiler.ts:89-105`). The browser currently renders all Plot marks in one `Plot.plot` call, then appends every primitive group to the same SVG (`web/index.html:287-289`, `:232`). There is no layer reconciliation: changing any mark reconstructs Plot groups and then reconstructs primitive groups. Z-order is append order, not a retained layer tree.

## 10. Axis, tick, title and legend behavior

Axes and ticks are generated inside Plot from current scales. Their group labels (`x-axis tick`, `x-axis tick label`, etc.) are stable selectors for a render, not stable node identities across renders. Scale domains, tick counts, date formatting and labels may all change when data/query/layout changes. Plot titles/legends would be siblings in a figure when enabled, but this app does not pass top-level `title`, `subtitle`, `caption` or legend options; card title is HTML outside the SVG.

## 11. Layout and card positioning

Layout is applied as inline `left/top/width/height` to the retained card (`web/index.html:89-90`). `canvas.compose` emits `layout.changed`; the browser calls `reloadScene`, which re-renders every scene visual (`:151-164`, `:310-315`). Thus a layout-only mutation does not mutate SVG geometry in place and may repeat data/query/Plot work for unaffected visuals.

## 12. Update scenario matrix

| Change | Runtime/query | Browser operation | SVG/node result |
|---|---|---|---|
| title-only patch | artifact invalidated; `#render` still profiles/queries/compiles | fetch + `Plot.plot` unless table/KPI; `replaceChildren` | full plot rebuild; signature excludes title, so no entrance animation |
| style-only mark patch | full render path | fetch + new Plot/primitive DOM | full rebuild; usually signature changes and entrance animation |
| data value/source change | new profile/query/observation | new payload + Plot | full rebuild |
| filter/query/dimension change | new DuckDB result and scales | new payload + Plot | full rebuild; axes and mark counts may change |
| layout-only change | scene revision and `reloadScene`; all visuals fetched | `applyLayout` plus full `renderEffectiveScene` | cards retained; all plot subtrees rebuilt |
| mark-type change | compile/validation + query | new factory or primitive branch | old geometry discarded; new family created |
| visual removal | no render for removed card | `card.remove()`, then reload | card and descendants removed |
| working/incomplete state | returns `status=working` with empty plot data | working frame replaces plot | SVG discarded until complete |

## 13. Animation selection and timing

`shouldAnimateVisual` hashes kind/source/query/coordinate/marks and stores it in `renderedVisualSignatures` (`web/index.html:104-110`). It does not compare DOM nodes or data keys. Animation is disabled for work previews (`animate = !workId`) and reduced-motion users. Bar, line, dot, area, rule and text are selected by `aria-label` (`:155-175`). Primitive elements use type-specific scale/dash/fade animations (`:134-153`); arc geometry is recomputed on every frame from start to end angle (`:118-133`).

This makes the current effect “new complete result enters,” not “old and new marks are reconciled.” If two visual events arrive with the same signature, no animation is selected even though nodes are still replaced.

## 14. Node identity experiments and observation limits

Read-only Chrome inspection confirmed the current node shapes and counts at revision 24. A direct mutating clone/replace experiment could not be executed through the CUA page-evaluation bridge: returned DOM objects are isolated read-only wrappers (`cloneNode` is not callable). Therefore no claim is made from object-equality instrumentation.

The replacement result is nevertheless deterministic from source: `Plot.plot` returns a new figure/SVG, and `plot.replaceChildren(svg)` removes all previous plot descendants. The retained-node boundary is the card and `.plot` container, not an SVG child. The browser probe also found no usable `data-key`, business datum attribute, or exposed source datum on current bar/line/donut nodes.

## 15. Plot postprocessing and extension points

After Plot returns, the app only appends primitive groups and applies entrance animations. It does not postprocess Plot nodes to add mark ids, datum ids, source-field attributes, or a retained registry. Plot itself offers mark `className`, `ariaLabel`, `title`, channels, initializer and render hooks, but the app's JSON compiler rejects arbitrary options and does not transport functions. This is a capability boundary, not a missing CSS rule.

## 16. Renderer registry

`rendererRegistry` is a frozen object containing two sets: Plot mark type names and primitive mark type names (`src/render/renderer-registry.ts:3-13`). `resolveRenderer` chooses an explicit `mark.renderer`, otherwise primitive-only types go primitive and all other supported marks go Plot (`:18-25`). The registry is type-based, not instance-based: it has no renderer object, retained node map, key function, scale cache, or diff lifecycle.

## 17. RenderArtifact and cache boundary

`RenderArtifact` is an internal runtime interface `{visual, revision, payload, generation}` (`src/runtime/data-canvas-runtime.ts:20-21`). `payload` contains rows, columns, PlotConfig and observation. `#artifactFor` caches by scene/work visual key and generation (`:216-237`); visual patches clear/increment the work artifact generation (`:289-293`), and completed work artifacts can be promoted to the durable revision (`:299-304`).

The artifact is not sent as a named object to the browser; `#response` flattens visual/rows/columns/plot/observation (`:279-280`). It also lacks explicit datum keys and normalized geometry. It is therefore the closest existing seam, but not yet a complete retained-rendering contract.

## 18. Browser knowledge of VisualSpec

The browser receives the full `result.visual`, uses it for title/layout/signature, and receives a separate `result.plot` for rendering. It understands `kind`, `layout`, `work_id` status, Plot mark `type/options`, and primitive layer fields. It does not maintain a VisualSpec-to-DOM index, know mark ids after `markToPlot`, or derive source datum keys. `visualSignature` is a change detector, not an identity map.

## 19. Direct SVG diff feasibility (option A)

Direct SVG diff is not safe as the first LC2-A seam. The DOM has type-level ARIA groups and predictable geometry counts, but:

- mark ids are absent;
- source datum keys are absent;
- line/area paths represent grouped series rather than individual points;
- axes and tick labels can be regenerated with different domains/counts;
- primitive values have no child keys;
- `replaceChildren` currently destroys the old reference before any diff can run.

An SVG diff could be made to work only after adding a key protocol and handling Plot/primitive/axis ownership separately. That would effectively recreate an intermediate render tree in the browser.

## 20. RenderTree feasibility (option C)

A future RenderTree would make mark/layer ownership, keys, scales, geometry and animation intent explicit. However, current `compilePlot` only has data, mark id/type/options and optional primitive values; it does not compute screen geometry or a normalized node tree. Introducing RenderTree now would be a larger cross-cutting change than the requested audit and would overlap LC2 scope. It is architecturally sound, but not the minimum LC2-A insertion point.

## 21. RenderArtifact diff recommendation (option B)

Recommended LC2-A insertion layer: **B — RenderArtifact diff**.

Reasoning:

1. It is already the runtime cache boundary and is produced before browser DOM construction.
2. It can carry `visual.id`, `mark.id`, primitive layer id, source rows and observations without teaching the browser to infer identity from SVG geometry.
3. A future artifact version can add deterministic datum keys and mark-level geometry metadata while leaving Plot as the disposable geometry backend.
4. The browser can retain the card/SVG and apply a keyed plan for unchanged/changed/entered/exited marks; a later LC2-B/C can introduce a full RenderTree if needed.

This recommendation does not implement the diff. The minimum future change surface is: artifact schema/key derivation, runtime cache invalidation semantics, browser retained renderer, and tests for ordering/races.

## 22. Observable Plot capabilities and cost

Plot is effective for one-shot SVG generation: scales, axes, channels, grouped line/area paths, titles, ARIA labels, styles, and standard mark geometry are already available. Its render API is not a retained scene graph API; each call initializes marks and appends nodes. The app currently performs a complete DuckDB result materialization and `Plot.plot` for each fetch.

No 10/100/1000-point browser benchmark was added during this audit. Existing repository evidence measured a small local `/api/visual/:id` render around 10.71 ms, excluding browser SVG build/paint/animation (`CURRENT_IMPLEMENTATION_REPORT.md:166`). Large-data browser cost, paint cost and concurrent-event latency remain UNKNOWN and should be measured with temporary tracing before LC2-A performance claims.

## 23. Mark-specific motion and cross-mark transitions

Current motion is type-specific entrance motion: bars/primitive rects scale from zero, dots/circles scale in, line/path/rule/path/area use stroke dash when available, text fades/slides, and arcs interpolate angle geometry. There is no old-to-new interpolation, no exit transition, and no cross-mark correspondence. A bar-to-line change therefore discards bars and creates a line; a filter that removes a point does not animate an exit.

## 24. Race and ordering risks

Work events have sequence acceptance (`acceptWorkEvent`), but `render(id)` has no per-visual request token or `AbortController`. Two accepted events can issue concurrent `/api/visual/:id` requests; whichever promise resolves last calls `replaceChildren` last. Runtime artifact generations protect cache publication, but they do not prevent an already-started browser request from painting a stale response. This is a concrete LC2-A blocker for deterministic live diff and should be covered by an out-of-order response test.

## 25. WorkSession → renderer flow

Work-aware `visualCreate`/`visualPatch` mutate an in-memory overlay, clear its artifact generation, emit `work.visual.changed`, then render a complete visual (`src/runtime/data-canvas-runtime.ts:117-135,189-199`). Activity events surround DuckDB/render work (`:239-253`). The browser merges effective scenes and renders each affected visual (`web/index.html:235-247,304-315,347-360`). Commit promotes artifacts and emits `work.completed` (`src/runtime/data-canvas-runtime.ts:75-85`).

The state stream is live and ordered, but geometry delivery remains whole-artifact/whole-SVG. That is why the UI can show work activity while still feeling like a static result swap.

## 26. Static experience, reusable blocks, blockers and readiness

Why it feels static: the visible browser update starts only after complete rows, observations and PlotConfig are ready; then the old SVG is replaced atomically and an entrance animation is played. There is no progressive row boundary or retained node reconciliation.

Reusable blocks already present:

- `SceneStore`/`WorkSessionStore` provide durable/effective scene boundaries;
- `compileQuery` and render-limit enforcement provide deterministic data input;
- `compilePlot`/`compilePrimitive` provide compositional mark grammar;
- `RenderArtifact` provides a cacheable pre-DOM payload;
- the card shell and WebSocket work-event protocol provide a stable outer UI.

Blockers/friction for LC2-A:

- no explicit datum-key contract;
- `CompiledMark.id` is dropped in the browser adapter;
- primitive child identity is absent;
- Plot/axis ownership is not represented in an intermediate tree;
- browser render requests can race;
- layout reload is broader than its affected ids;
- no benchmark for large point counts.

Readiness: **ready for a design/implementation spike at the RenderArtifact boundary; not ready to claim direct SVG diff safety.**

## 27. Key Source References

1. Browser renderer and replacement/animation boundaries: [`web/index.html`](/Users/linpeiwen/knightspace/openboard/web/index.html:82-365)
2. Runtime render/artifact/cache/work flow: [`src/runtime/data-canvas-runtime.ts`](/Users/linpeiwen/knightspace/openboard/src/runtime/data-canvas-runtime.ts:12-315)
3. Plot/primitive compilation and id retention: [`src/render/plot-compiler.ts`](/Users/linpeiwen/knightspace/openboard/src/render/plot-compiler.ts:7-106)
4. Primitive value compilation and arc geometry: [`src/render/primitive-compiler.ts`](/Users/linpeiwen/knightspace/openboard/src/render/primitive-compiler.ts:3-118)
5. Renderer type registry: [`src/render/renderer-registry.ts`](/Users/linpeiwen/knightspace/openboard/src/render/renderer-registry.ts:1-25)
6. HTTP visual route: [`src/web/server.ts`](/Users/linpeiwen/knightspace/openboard/src/web/server.ts:20-40)
7. Observable Plot SVG assembly: [`node_modules/@observablehq/plot/src/plot.js`](/Users/linpeiwen/knightspace/openboard/node_modules/@observablehq/plot/src/plot.js:244-360)
8. Observable Plot mark base/options: [`node_modules/@observablehq/plot/src/mark.js`](/Users/linpeiwen/knightspace/openboard/node_modules/@observablehq/plot/src/mark.js:10-133)
9. Plot style/ARIA application: [`node_modules/@observablehq/plot/src/style.js`](/Users/linpeiwen/knightspace/openboard/node_modules/@observablehq/plot/src/style.js:154-230)
10. Plot bar/line/area/dot implementations: [`bar.js`](/Users/linpeiwen/knightspace/openboard/node_modules/@observablehq/plot/src/marks/bar.js:21-56), [`line.js`](/Users/linpeiwen/knightspace/openboard/node_modules/@observablehq/plot/src/marks/line.js:52-78), [`area.js`](/Users/linpeiwen/knightspace/openboard/node_modules/@observablehq/plot/src/marks/area.js:46-70), [`dot.js`](/Users/linpeiwen/knightspace/openboard/node_modules/@observablehq/plot/src/marks/dot.js:73-137)
11. ASCII retention map: [`RENDERER_DOM_MAP.txt`](/Users/linpeiwen/knightspace/openboard/RENDERER_DOM_MAP.txt)

是否修改任何生产代码：**NO**。本审计仅新增本报告与 DOM map 两份文档。
