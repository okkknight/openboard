# Data Canvas Streaming Performance and Motion Design

**Date:** 2026-09-18

**Status:** Approved design, pending implementation plan

**Scope:** Faster time to first visible result, removal of redundant data work, retained live-construction feedback, and restrained canvas motion

## 1. Objective

Data Canvas must feel responsive without hiding or faking the agent's construction process. A request that creates a chart or analytical note should produce a meaningful draft quickly, progressively resolve into real data, and finish with restrained motion that clarifies what changed.

This design optimizes two related outcomes:

1. **Actual latency:** reduce agent-to-runtime round trips, repeated schema work, repeated queries, and repeated dataset scans.
2. **Perceived latency:** show real draft, data-ready, visual-resolve, and semantic-finish states as soon as those states exist.

The product principle is:

> Preserve the narrative of progressive construction while removing the waiting caused by duplicate computation.

## 2. Constraints

The implementation must preserve the Data Canvas V1 architecture and contracts:

- Scene remains the durable product state; query results and rendered output remain disposable.
- WorkSession remains the ephemeral boundary for live construction.
- The existing ten-tool MCP surface is not expanded.
- Every chart mutation uses an explicit WorkSession.
- Streaming events must represent real inspect, query, render, or semantic state changes.
- No fixed delay, fake progress event, or per-mark animation frame may be emitted to simulate work.
- No silent sampling is allowed. Excessive results return `render_limit_exceeded`.
- Motion is a browser concern and must not be persisted in Scene or history.
- Layout-only interaction must not issue data queries.
- Query artifacts must never become durable Scene state.

## 3. User-visible construction model

A visual request progresses through four meaningful stages:

1. **Draft:** title, explanatory text, or a minimal plot intent appears.
2. **Data Ready:** the runtime has a valid result or the first safe render artifact.
3. **Visual Resolve:** marks enter using a stable scale and retained identity.
4. **Semantic Finish:** conclusions, anomaly marks, reference lines, or annotations appear before commit.

There is no minimum display duration for any stage. If data is already available, stages may complete quickly. The browser must still paint an early draft when a multi-step operation requires inspect or query work, but it must not delay a completed result merely to make the draft visible longer.

Text that does not depend on data may appear immediately through `canvas.annotate`. Text derived from data appears only after the supporting query or observation exists.

## 4. Agent orchestration

The default agent workflow depends on whether dataset metadata is known.

### 4.1 Known schema

```text
work.begin
→ visual.create with complete VisualSpec
→ render
→ optional semantic annotation or mark patch
→ work.commit
```

The agent does not call `data.query` merely to obtain the rows that the visual render will query again.

### 4.2 Unknown schema

```text
work.begin
→ visual.create with title/intent draft
→ data.inspect for required metadata
→ visual.patch with source, QuerySpec, and marks
→ render
→ optional semantic annotation or mark patch
→ work.commit
```

After `work.begin` returns, draft creation and independent metadata work may run concurrently when the MCP client supports concurrent calls using the same `work_id`.

### 4.3 Legitimate `data.query` use

`data.query` remains appropriate when the agent needs to compare results, inspect values before choosing an expression, or perform analysis that does not directly correspond to one visual. When a subsequent visual uses exactly the same dataset fingerprint and QuerySpec in the same WorkSession, the runtime should reuse that query artifact.

## 5. Runtime architecture

The runtime gains three focused internal units without changing the public tool surface.

### 5.1 DatasetMetadataCache

`DatasetMetadataCache` owns lightweight metadata and dataset registration state. Its cache identity is:

```text
resolved path + file size + mtime
```

It stores:

- dataset fingerprint;
- column names and types;
- cached row count when explicitly computed;
- optional field profiles;
- DuckDB view registration state.

The data engine separates two operations:

- `describeSchema(dataset)`: register if necessary and return columns/types only;
- `inspectProfile(dataset, options)`: compute row count, selected top values, and requested samples.

Query compilation depends on `describeSchema`, not the full profile path. A changed file size or mtime invalidates metadata, registered-view state, and dependent query artifacts.

### 5.2 QueryArtifactStore

`QueryArtifactStore` owns in-flight and completed data work for a WorkSession. The logical artifact is:

```ts
interface QueryArtifact {
  datasetFingerprint: string;
  queryKey: string;
  columns: string[];
  rows: JsonObject[];
  observation: Observation;
  state: "pending" | "partial" | "complete" | "failed";
}
```

The query key is a deterministic canonical serialization of QuerySpec. Raw SQL keys include the exact accepted read-only SQL string.

For the same WorkSession, dataset fingerprint, and query key:

- compilation runs once;
- execution runs once;
- concurrent consumers share the same pending promise;
- observation and render compilation share the completed rows;
- failures evict the pending entry so a later intentional retry can execute;
- cancellation releases WorkSession artifacts;
- commit may promote only existing render artifacts; query rows are not persisted.

### 5.3 MotionIntent

`MotionIntent` is derived from real event and render differences. It describes semantic change, not presentation timing:

```ts
type MotionIntent =
  | { type: "create" }
  | { type: "update"; retainedKeys: string[]; enteredKeys: string[]; exitedKeys: string[] }
  | { type: "replace-layer"; fromMarkType: string; toMarkType: string }
  | { type: "remove" }
  | { type: "layout-settle" };
```

Motion duration, easing, stagger limits, and reduced-motion behavior remain browser-owned. `MotionIntent` is part of disposable render/event metadata, not Scene.

## 6. Query execution and render limits

The render path must avoid a full `COUNT(*) FROM (<query>)` followed by the same query again.

For bounded-result validation, the data engine executes a guarded result with a maximum of `pointLimit + 1` output rows:

- zero through `pointLimit` rows: the complete result is safe to render;
- `pointLimit + 1` rows: return `render_limit_exceeded` and do not publish the partial rows as a chart.

This guard applies to the output of aggregation, not the raw input scanned to produce it. Explicitly sampled queries continue to use their declared sampling behavior. Raw SQL remains read-only and receives the same output guard.

The runtime may emit a render chunk only when it is safe and semantically valid. If a query's scale domain cannot be determined until completion, the browser retains the draft until the complete safe result is available rather than drawing a misleading partial chart.

## 7. Connection and storage optimization

- DuckDB instance and connection stay warm for the daemon lifetime.
- A dataset view is registered once per fingerprint and rebuilt only after invalidation.
- Reverse-proxy and client behavior must be verified for HTTP/2, Keep-Alive, and compression.
- Frequently queried large CSV files may have an internal Parquet representation while retaining the public dataset ID.
- Query artifacts may be cached only with dataset-fingerprint invalidation.
- No external cache service or distributed database is introduced for this scope.

## 8. Motion system

The default style is restrained and smooth. Stronger process emphasis is reserved for initial creation and meaningful semantic additions.

### 8.1 Timing classes

| Class | Purpose | Duration |
|---|---|---:|
| Draft reveal | Title, annotation, or plot intent appears | 140–180 ms |
| Data enter | Real marks first appear | 220–360 ms |
| Semantic update | Filter, metric, or mark meaning changes | 180–300 ms |
| Layout settle | Snap or arrange completes | 140–220 ms |

Motion uses an ease-out curve. Persistent bounce is prohibited. A very small spring response is allowed only for explicit snapping or automatic arrangement.

### 8.2 Draft presentation

- Titles and annotations fade in with at most 4 px upward movement.
- A plot draft may show a low-contrast baseline or plotting intent.
- Working copy names the real activity, such as reading a dataset, rather than showing generic simulated progress.
- No rotating loader is required.
- Draft objects remain frameless and live directly on the canvas.

### 8.3 Mark entry

- Bars grow from their baseline as one coordinated layer. A 20–40 ms stagger is allowed only for small result sets.
- Lines reveal through a path clip; points and labels fade in after the path begins.
- Areas reveal with their path while fill opacity reaches its final value.
- Scatter marks fade and scale in as a layer; large sets disable stagger.
- Arc layers share one angular timeline rather than entering one slice at a time.
- KPI values use a short numeric interpolation only when both states are finite numbers; otherwise they crossfade.
- Tables reveal the visible row region as a whole.
- Text and conclusion annotations fade in with slight upward movement after their supporting visual is stable.

### 8.4 Retained updates

The renderer preserves identity by visual ID, mark ID, and deterministic datum key.

- Retained keys animate position, length, radius, or color to the new value.
- Exited keys fade and contract slightly.
- Entered keys originate from the baseline or a nearby retained position.
- Incompatible mark types use a controlled layer crossfade instead of forced geometric morphing.
- Filter updates overlap exit and retained movement enough to avoid a long two-phase animation.
- A newer accepted generation interrupts an older animation from its current visual state and proceeds to the new state without rewinding.

### 8.5 Scale stability

- Complete aggregate results determine the final domain before data entry begins.
- Partial chunks animate only when the domain is known in advance or guaranteed stable.
- Unknown domains retain the draft until a complete safe result exists.
- A WorkSession reuses a compatible previous domain when the encoded field and scale semantics are unchanged.
- A domain expands only when real values exceed the current range.
- Axes, grids, and marks share one transition clock.

### 8.6 Direct manipulation

Dragging and canvas pan/zoom remain immediate and un-eased while the pointer is active.

- Dragging changes transforms only and does not query or rebuild Plot.
- Optional snap settle runs for 140–180 ms after release.
- Resize uses cached content for its live preview.
- On resize release, Plot performs one cached-data reflow; labels may crossfade during the final reflow.
- Persistence success causes no flash. Persistence failure restores the original layout and shows a concise error.
- This scope does not add inertial canvas scrolling.

### 8.7 Motion degradation

- `prefers-reduced-motion: reduce` removes translation, scale, path reveal, and numeric interpolation; final states apply with at most a short opacity change.
- Background tabs apply final states without running queued animations.
- Large mark counts disable stagger and per-element decoration in favor of layer-level transitions.
- The browser enforces a cap on simultaneously animated elements.
- Motion never blocks querying, WorkSession commit, or pointer interaction.
- Automated tests may use a deterministic motion-disabled mode.

## 9. Realtime events and cancellation

WorkSession remains the transaction and streaming boundary:

```text
work.started
→ work.visual.changed for draft
→ real inspect/query activity
→ work.render.chunk when a safe artifact exists
→ optional semantic visual/annotation change
→ work.completed
```

The runtime never emits mark-by-mark events merely to drive animation. Browser motion is derived from successive real artifacts.

On cancellation:

- uncommitted new objects disappear;
- patched durable objects return to their durable Scene state;
- in-flight consumers stop receiving artifacts;
- completed WorkSession query artifacts are released.

## 10. Failure behavior

- Schema failure keeps the draft and shows a concise dataset error.
- Query failure keeps the last valid existing visual; a new visual retains its draft error state until cancellation.
- Render-limit failure publishes no truncated chart and suggests aggregation, binning, or explicit sampling.
- Unsupported visual grammar does not commit an invalid VisualSpec.
- Motion failure applies the final DOM state and does not affect data or commit.
- Network loss preserves the last valid view; reconnect reloads durable Scene and active WorkSessions by revision.
- Failed cached work must not poison future cache entries.

## 11. Observability

Every WorkSession carries a trace identifier across runtime events and browser performance marks. The implementation records these milestones when available:

```text
request_received
agent_first_tool
work_started
draft_visible
schema_ready
query_started
query_first_chunk
query_completed
visual_first_paint
visual_settled
work_committed
```

Runtime diagnostics include:

- schema-cache hit or miss;
- query-artifact hit or miss;
- compilation, first-row, and completion duration;
- scanned and output row counts when DuckDB exposes them cheaply;
- execution count for the same query key;
- render-limit outcome.

Performance telemetry is diagnostic and is not persisted in Scene or analytical history. Sensitive dataset rows and raw annotation text are excluded from timing logs.

## 12. Performance targets

Targets are measured separately inside the VPS and from the public browser path. Both cold and warm cases report p50 and p95.

| Metric | Target |
|---|---:|
| Known-schema request to first canvas change | ≤ 800 ms under normal public network conditions |
| Unknown-schema request to draft visible | ≤ 1 s under normal public network conditions |
| Small aggregate query inside VPS | p95 ≤ 100 ms |
| Cached visual response inside VPS | p95 ≤ 10 ms |
| Same query execution count within one WorkSession | exactly 1 |
| Data query count for layout-only interaction | exactly 0 |

Network and agent-thinking time are recorded separately from runtime execution so a missed end-to-end target can be assigned to the correct layer.

## 13. Test strategy

### 13.1 Runtime and data tests

- Identical WorkSession queries share one execution.
- Schema cache hits avoid repeated `DESCRIBE` and view registration.
- File size or mtime changes invalidate metadata and query artifacts.
- Failed query promises are evicted and can be retried intentionally.
- `pointLimit + 1` rejects the render without returning a partial chart.
- Layout-only mutations execute no data query.
- Draft events reach subscribers before a blocked query completes.
- Query artifacts never appear in Scene, history, snapshots, or metadata.
- Cancelling a WorkSession clears its ephemeral query artifacts.

### 13.2 Browser and motion tests

- Create, update, replace-layer, exit, and layout-settle select the correct motion behavior.
- Stable keys preserve DOM identity across updates.
- Incompatible mark types crossfade at layer level.
- Resize gestures issue no network query and perform one cached reflow after release.
- An interrupted transition continues from its current rendered state without rewind.
- Reduced-motion mode applies the correct final state.
- Large mark counts disable stagger.
- Pointer interaction remains responsive while animations run.

### 13.3 End-to-end acceptance

- Test desktop and a mobile-sized viewport.
- Test cold and warm dataset metadata.
- Test a small CSV and a larger Parquet dataset.
- Test normal and simulated high-latency networking.
- Verify no relevant browser console errors.
- Record VPS-internal and public-path p50/p95 separately.
- Verify cancel, reconnect, query failure, unsupported feature, and render-limit behavior.

## 14. Delivery phases

### Phase A: Measurement baseline

Add trace propagation, runtime timers, browser performance marks, and benchmark scenarios without changing construction semantics.

### Phase B: Actual latency reduction

Add lightweight schema metadata, fingerprinted view registration, WorkSession query artifacts, in-flight deduplication, and the single-pass render-limit guard. Update the agent guidance to skip redundant `data.query` calls.

### Phase C: Streaming experience

Guarantee draft-first behavior for multi-step work, publish only safe real render artifacts, and complete cancellation, failure, and reconnect recovery.

### Phase D: Motion system

Extract browser motion control from the page script, implement the timing classes and per-mark behavior, synchronize scale transitions, and add reduced-motion and large-data degradation.

Each phase is independently testable and deployable. Performance refactoring and motion changes must not be combined into one unrecoverable release.

## 15. Acceptance criteria

The optimization is complete when all of the following hold:

1. A multi-step visual request presents a real draft within one second under normal public network conditions.
2. The same dataset fingerprint and QuerySpec execute exactly once within a WorkSession.
3. Cached schema compilation does not trigger a full dataset profile.
4. Render-limit enforcement does not require a duplicate full-result scan and never publishes truncated data.
5. Layout-only interaction never queries data.
6. Every streamed canvas change corresponds to a real analysis, data, render, or semantic state.
7. Create and update animations do not flash, rewind, or repeatedly change an unknown scale domain.
8. Motion does not delay query completion, commit, cancellation, or direct manipulation.
9. Reduced-motion, background-tab, large-data, failure, cancellation, and reconnect paths reach the correct final state.
10. Scene, history, the ten-tool surface, explicit WorkSession rules, and the no-silent-sampling contract remain intact.
