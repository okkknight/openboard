# Streaming Performance and Motion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Data Canvas show a meaningful draft quickly, execute each WorkSession query once, preserve real streaming construction, and animate visual changes with restrained, interruptible motion.

**Architecture:** Add fingerprinted dataset metadata and WorkSession query-artifact stores behind the existing runtime, then route query and render consumers through one guarded execution path. Keep Scene durable and renderer-independent; attach trace and motion metadata only to ephemeral events/artifacts. Extend the existing retained browser renderer with a focused motion controller rather than replacing Observable Plot.

**Tech Stack:** Node.js 22+, TypeScript 5.8, DuckDB Node Neo, native WebSocket events, Observable Plot 0.6, Web Animations API, Node test runner

**Spec:** `docs/superpowers/specs/2026-09-18-streaming-performance-motion-design.md`

## Global Constraints

- Scene remains durable product state; query results, traces, motion intent, and rendered output remain ephemeral.
- Preserve the existing ten-tool MCP surface and explicit WorkSession requirement for chart mutations.
- Do not emit fake progress, fixed delays, or mark-by-mark runtime events for animation.
- Do not silently sample or publish truncated results; excessive output returns `render_limit_exceeded`.
- Layout-only interactions execute zero data queries.
- Motion never blocks query completion, WorkSession commit, cancellation, or direct manipulation.
- Respect `prefers-reduced-motion`, background tabs, and large-mark degradation.
- Use test-driven development for every behavior change.

---

## File Map

### New files

- `src/data/dataset-metadata-cache.ts` — dataset fingerprints, schema/profile cache, and registration invalidation.
- `src/runtime/query-artifact-store.ts` — WorkSession-scoped in-flight and completed query deduplication.
- `src/runtime/performance-trace.ts` — clock-injected trace milestones and safe diagnostic summaries.
- `web/motion-policy.js` — timing classes, element caps, reduced/background degradation, and semantic motion selection.
- `web/performance-trace.js` — browser Performance API marks for draft, first paint, settle, and commit.
- `tests/dataset-metadata-cache.test.mjs` — metadata-cache unit behavior.
- `tests/query-artifact-store.test.mjs` — query-key canonicalization, in-flight sharing, failure eviction, and cleanup.
- `tests/performance-trace.test.mjs` — deterministic milestone and duration behavior.
- `tests/motion-policy.test.mjs` — motion timing and degradation rules.
- `scripts/benchmark-streaming-latency.mjs` — repeatable local/public latency benchmark with p50/p95 output.

### Modified files

- `src/data/duckdb-engine.ts` — lightweight schema path, fingerprint-aware registration, and guarded query streaming.
- `src/runtime/data-canvas-runtime.ts` — shared query artifacts, trace propagation, single guarded render execution, cleanup.
- `src/runtime/event-bus.ts` — ephemeral trace and motion metadata on work events.
- `src/core/types.ts` — internal diagnostic/event types only; no persistent Scene fields.
- `src/web/server.ts` — serve new browser modules and expose trace IDs without changing tool contracts.
- `web/render-motion.js` — consume motion policy, support interruption from current state, and cap element animation.
- `web/render-reconciler.js` — expose retained/entered/exited keys and layer replacement as semantic motion intent.
- `web/index.html` — draft-first paint marks, stable-domain gating, background-tab handling, and module wiring.
- `AGENTS.md` — agent orchestration guidance that skips redundant `data.query` for direct rendering.
- Existing runtime, DuckDB, motion, reconciler, smoke, and end-to-end tests — regression and acceptance coverage.

---

### Task 1: Add deterministic performance tracing

**Files:**
- Create: `src/runtime/performance-trace.ts`
- Create: `tests/performance-trace.test.mjs`
- Modify: `src/core/types.ts`
- Modify: `src/runtime/event-bus.ts`
- Modify: `src/runtime/data-canvas-runtime.ts`

**Interfaces:**
- Produces: `PerformanceTrace`, `TraceMilestone`, `TraceSnapshot`, and `createTrace(clock?)`.
- Produces: optional `trace_id` and `timing` fields on ephemeral `SceneEvent`; neither is added to `Scene` or `HistoryRecord`.
- Consumes: WorkSession begin/activity/render/commit lifecycle from `DataCanvasRuntime`.

- [ ] **Step 1: Write the failing trace unit tests**

```js
test("records each milestone once and derives durations from an injected clock", () => {
  const ticks = [100, 112, 145];
  const trace = createTrace(() => ticks.shift());
  trace.mark("work_started");
  trace.mark("query_started");
  trace.mark("query_completed", { output_rows: 4 });
  trace.mark("query_completed");
  assert.deepEqual(trace.snapshot().milestones.map((item) => item.name), [
    "work_started", "query_started", "query_completed"
  ]);
  assert.equal(trace.snapshot().durations.query_ms, 33);
  assert.equal(trace.snapshot().milestones[2].metrics.output_rows, 4);
});

test("never stores row values or annotation text in trace metrics", () => {
  const trace = createTrace(() => 1);
  assert.throws(() => trace.mark("query_completed", { rows: [{ secret: "x" }] }), /unsafe_trace_metric/);
  assert.throws(() => trace.mark("draft_visible", { text: "private" }), /unsafe_trace_metric/);
});
```

- [ ] **Step 2: Run the trace test and verify it fails**

Run: `npm run build:core && node --test tests/performance-trace.test.mjs`

Expected: FAIL because `performance-trace.js` does not exist.

- [ ] **Step 3: Implement the focused trace utility**

```ts
export type TraceMilestoneName =
  | "request_received" | "work_started" | "schema_ready"
  | "query_started" | "query_first_chunk" | "query_completed"
  | "visual_first_paint" | "visual_settled" | "work_committed";

export interface TraceMilestone {
  name: TraceMilestoneName;
  at_ms: number;
  metrics?: Record<string, number | boolean | string>;
}

export interface TraceSnapshot {
  trace_id: string;
  milestones: TraceMilestone[];
  durations: Record<string, number>;
}

export interface PerformanceTrace {
  readonly id: string;
  mark(name: TraceMilestoneName, metrics?: Record<string, unknown>): void;
  snapshot(): TraceSnapshot;
}
```

Generate trace IDs with `randomUUID()`. Allow only scalar metrics whose keys are drawn from `cache_hit`, `query_key`, `output_rows`, `chunk_index`, `limit`, and `elapsed_ms`. Ignore duplicate milestone names so retries do not corrupt the first-occurrence timeline.

- [ ] **Step 4: Attach traces to WorkSessions without changing durable state**

Add a private `Map<string, PerformanceTrace>` to `DataCanvasRuntime`. Create the trace on `work.begin`, mark runtime milestones around schema/query/render/commit, and delete it after completed/cancelled sessions. Add only the latest `trace_id` and safe `timing` snapshot to emitted work events.

- [ ] **Step 5: Run focused and regression tests**

Run: `npm run build:core && node --test tests/performance-trace.test.mjs tests/live-construction-runtime.test.mjs tests/work-session-store.test.mjs`

Expected: PASS, with Scene and history snapshots unchanged.

- [ ] **Step 6: Commit the trace foundation**

```bash
git add src/runtime/performance-trace.ts src/runtime/data-canvas-runtime.ts src/runtime/event-bus.ts src/core/types.ts tests/performance-trace.test.mjs
git commit -m "feat: trace live construction latency"
```

---

### Task 2: Introduce fingerprinted dataset metadata

**Files:**
- Create: `src/data/dataset-metadata-cache.ts`
- Create: `tests/dataset-metadata-cache.test.mjs`
- Modify: `src/data/duckdb-engine.ts`
- Modify: `tests/duckdb-engine.integration.test.mjs`

**Interfaces:**
- Produces: `DatasetFingerprint`, `DatasetMetadata`, and `DatasetMetadataCache`.
- Produces on `DuckDbEngine`: `describeSchema(dataset)`, `inspectProfile(dataset, options)`, and `fingerprint(dataset)`.
- Preserves: `inspect(dataset, options)` as a compatibility wrapper over the new operations.

- [ ] **Step 1: Write failing cache tests**

```js
test("reuses metadata while path size and mtime are unchanged", async () => {
  let reads = 0;
  const cache = new DatasetMetadataCache({ stat: async () => ({ size: 20, mtimeMs: 40 }) });
  const load = async () => { reads += 1; return [{ name: "channel", type: "VARCHAR", nullable: true }]; };
  const first = await cache.schema(orders, load);
  const second = await cache.schema(orders, load);
  assert.deepEqual(second, first);
  assert.equal(reads, 1);
});

test("invalidates schema and registration after the source fingerprint changes", async () => {
  let mtimeMs = 40;
  let reads = 0;
  const cache = new DatasetMetadataCache({ stat: async () => ({ size: 20, mtimeMs }) });
  await cache.schema(orders, async () => { reads += 1; return []; });
  mtimeMs = 41;
  await cache.schema(orders, async () => { reads += 1; return []; });
  assert.equal(reads, 2);
});
```

- [ ] **Step 2: Run the cache tests and verify failure**

Run: `npm run build:core && node --test tests/dataset-metadata-cache.test.mjs`

Expected: FAIL because the cache module does not exist.

- [ ] **Step 3: Implement metadata identity and cache boundaries**

```ts
export interface DatasetFingerprint {
  key: string;
  path: string;
  size: number;
  mtime_ms: number;
}

export interface DatasetMetadata {
  fingerprint: DatasetFingerprint;
  columns?: ColumnProfile[];
  row_count?: number;
  profiles: Map<string, DatasetInspection>;
  registered: boolean;
}
```

Resolve the path before `stat`. Build `key` from resolved path, size, and mtime. Keep profile entries keyed by canonical `{fields, top_k, sample_rows}`. Do not cache failed loaders.

- [ ] **Step 4: Refactor DuckDB registration and schema/profile methods**

Implement these signatures:

```ts
async fingerprint(dataset: DatasetSpec): Promise<DatasetFingerprint>;
async describeSchema(dataset: DatasetSpec): Promise<ColumnProfile[]>;
async inspectProfile(dataset: DatasetSpec, options?: InspectOptions): Promise<DatasetInspection>;
async inspect(dataset: DatasetSpec, options?: InspectOptions): Promise<DatasetInspection>;
```

`describeSchema` may run `DESCRIBE` but must not run row count, sample, or top-values queries. `#register` receives a fingerprint and skips `CREATE OR REPLACE TEMP VIEW` when the same fingerprint is already registered.

- [ ] **Step 5: Add DuckDB integration assertions**

Subclass or inject a small diagnostic hook to count `register`, `describe`, `count`, `sample`, and `top_values` operations. Assert that two `describeSchema` calls register and describe once, and that `inspectProfile` still returns the existing 20-row orders profile.

- [ ] **Step 6: Run data tests**

Run: `npm run build:core && node --test tests/dataset-metadata-cache.test.mjs tests/duckdb-engine.integration.test.mjs tests/dataset-registry.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit metadata caching**

```bash
git add src/data/dataset-metadata-cache.ts src/data/duckdb-engine.ts tests/dataset-metadata-cache.test.mjs tests/duckdb-engine.integration.test.mjs
git commit -m "perf: cache dataset metadata and views"
```

---

### Task 3: Add a WorkSession query artifact store

**Files:**
- Create: `src/runtime/query-artifact-store.ts`
- Create: `tests/query-artifact-store.test.mjs`

**Interfaces:**
- Produces: `canonicalQueryKey(query)`, `QueryArtifact`, and `QueryArtifactStore`.
- Produces: `getOrExecute(workId, fingerprint, query, execute)`, `peek(...)`, and `clearWork(workId)`.
- Consumes: dataset fingerprint keys and `QuerySpec`.

- [ ] **Step 1: Write failing canonicalization and deduplication tests**

```js
test("canonical query keys ignore object property insertion order but preserve array order", () => {
  const a = { dimensions: [{ field: "channel" }], limit: 10 };
  const b = { limit: 10, dimensions: [{ field: "channel" }] };
  assert.equal(canonicalQueryKey(a), canonicalQueryKey(b));
});

test("shares one pending execution inside a work session", async () => {
  const store = new QueryArtifactStore();
  let executions = 0;
  const execute = async () => {
    executions += 1;
    await Promise.resolve();
    return { columns: ["channel"], rows: [{ channel: "A" }], observation: observation(1) };
  };
  const [first, second] = await Promise.all([
    store.getOrExecute("work_1", "fp_1", query, execute),
    store.getOrExecute("work_1", "fp_1", query, execute)
  ]);
  assert.equal(executions, 1);
  assert.deepEqual(second, first);
});

test("evicts a failed pending execution and clears all work artifacts", async () => {
  const store = new QueryArtifactStore();
  await assert.rejects(() => store.getOrExecute("work_1", "fp_1", query, async () => { throw new Error("boom"); }));
  const recovered = await store.getOrExecute("work_1", "fp_1", query, async () => result);
  assert.deepEqual(recovered, result);
  store.clearWork("work_1");
  assert.equal(store.sizeForWork("work_1"), 0);
});
```

- [ ] **Step 2: Run the store test and verify failure**

Run: `npm run build:core && node --test tests/query-artifact-store.test.mjs`

Expected: FAIL because the store module does not exist.

- [ ] **Step 3: Implement canonical query identity and in-flight sharing**

```ts
export interface QueryArtifact {
  dataset_fingerprint: string;
  query_key: string;
  columns: string[];
  rows: JsonObject[];
  observation: Observation;
  state: "complete";
}

export class QueryArtifactStore {
  getOrExecute(
    workId: string,
    fingerprint: string,
    query: QuerySpec,
    execute: () => Promise<Omit<QueryArtifact, "dataset_fingerprint" | "query_key" | "state">>
  ): Promise<QueryArtifact>;
  peek(workId: string, fingerprint: string, query: QuerySpec): QueryArtifact | undefined;
  clearWork(workId: string): void;
  sizeForWork(workId: string): number;
}
```

Canonicalization recursively sorts object keys, preserves array order, rejects non-JSON values, and retains raw SQL exactly as accepted by the query compiler.

- [ ] **Step 4: Run focused tests**

Run: `npm run build:core && node --test tests/query-artifact-store.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit the artifact store**

```bash
git add src/runtime/query-artifact-store.ts tests/query-artifact-store.test.mjs
git commit -m "feat: deduplicate work session queries"
```

---

### Task 4: Replace count-plus-stream with one guarded execution

**Files:**
- Modify: `src/data/duckdb-engine.ts`
- Modify: `src/runtime/data-canvas-runtime.ts`
- Modify: `tests/duckdb-engine.integration.test.mjs`
- Modify: `tests/live-construction-runtime.test.mjs`
- Modify: `tests/runtime.test.mjs`

**Interfaces:**
- Produces on `DuckDbEngine`: `streamGuarded(dataset, compiled, maxRows)` and `streamRawGuarded(dataset, sql, maxRows)`.
- Produces: `GuardedQueryChunk` with `columns`, `rows`, and terminal `exceeded` status.
- Consumes: `DatasetMetadataCache.describeSchema` and `QueryArtifactStore` from Tasks 2–3.

- [ ] **Step 1: Write failing single-execution and limit tests**

```js
test("data.query followed by rendering the same query executes once", async () => {
  const engine = new CountingGuardedEngine();
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { engine });
  const work = await runtime.workApply({ action: "begin" });
  await runtime.dataQuery("orders", query, work.result.work_id);
  await runtime.visualCreate(fullVisual(), undefined, work.result.work_id);
  assert.equal(engine.executions, 1);
});

test("guarded output rejects limit plus one without publishing a partial chart", async () => {
  const runtime = new DataCanvasRuntime(scene(), undefined, undefined, { point_limit: 1 });
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const work = await runtime.workApply({ action: "begin" });
  await assert.rejects(() => runtime.visualCreate(fullVisual(), undefined, work.result.work_id), /render_limit_exceeded/);
  assert.equal(events.some((event) => event.type === "work.render.chunk"), false);
});
```

- [ ] **Step 2: Run focused runtime tests and verify failure**

Run: `npm run build:core && node --test tests/live-construction-runtime.test.mjs tests/runtime.test.mjs`

Expected: FAIL because `data.query` and render do not share an artifact and the render path still counts separately.

- [ ] **Step 3: Implement guarded streaming in DuckDB**

Wrap compiled structured queries as:

```sql
SELECT * FROM (<compiled SQL>) AS "_guarded" LIMIT <pointLimit + 1>
```

Preserve the compiled query parameters. Accumulate at most `pointLimit + 1` rows. If the extra row exists, return an exceeded terminal result and do not expose the collected rows as a renderable artifact. Apply the same read-only validation before wrapping raw SQL.

- [ ] **Step 4: Route query and render through one runtime executor**

Extract one private method with this responsibility:

```ts
async #queryArtifact(
  datasetId: string,
  query: QuerySpec,
  workId: string | undefined,
  options: { enforce_render_limit: boolean; onSafeChunk?: (rows: JsonObject[], columns: string[]) => Promise<void> }
): Promise<QueryArtifact>;
```

Use `describeSchema` for compilation. When a WorkSession exists, delegate to `QueryArtifactStore.getOrExecute`. Compute observation once from the final safe rows. Remove the render path's `count/countRaw` calls.

- [ ] **Step 5: Preserve safe streaming semantics**

Emit `work.render.chunk` only when a chunk cannot later become an invalid partial chart. For unknown total output under the limit guard, retain the draft and publish the complete safe artifact once EOF confirms the result. Keep the existing progressive-chunk path only for explicitly bounded queries (`query.limit <= pointLimit`, explicit sample size within limit, or an engine-proven stable aggregate bound).

- [ ] **Step 6: Clear query artifacts on cancel and after commit**

Call `queryArtifacts.clearWork(workId)` from both terminal paths. Ensure promoted render artifacts remain available at the committed Scene revision while rows and query promises are released.

- [ ] **Step 7: Run runtime, data, and limit regressions**

Run: `npm run build:core && node --test tests/duckdb-engine.integration.test.mjs tests/live-construction-runtime.test.mjs tests/runtime.test.mjs tests/render-identity.test.mjs`

Expected: PASS; execution counters equal one and no truncated artifact event is emitted.

- [ ] **Step 8: Commit shared guarded execution**

```bash
git add src/data/duckdb-engine.ts src/runtime/data-canvas-runtime.ts tests/duckdb-engine.integration.test.mjs tests/live-construction-runtime.test.mjs tests/runtime.test.mjs
git commit -m "perf: reuse guarded query artifacts"
```

---

### Task 5: Enforce draft-first orchestration and recovery

**Files:**
- Modify: `AGENTS.md`
- Modify: `src/runtime/data-canvas-runtime.ts`
- Modify: `src/runtime/event-bus.ts`
- Modify: `tests/live-construction-runtime.test.mjs`
- Modify: `tests/live-construction-e2e.test.mjs`
- Modify: `tests/mcp-contract.test.mjs`

**Interfaces:**
- Preserves: the ten existing tools and WorkSession contract.
- Produces: guaranteed draft event ordering before query completion for multi-step unknown-schema work.
- Produces: explicit failure/cancel events that let the browser restore durable state.

- [ ] **Step 1: Add failing event-order and cancellation tests**

```js
test("publishes a draft before schema work is released", async () => {
  const gate = deferred();
  const runtime = runtimeWithGatedDescribe(gate);
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const work = await runtime.workApply({ action: "begin" });
  await runtime.visualCreate({ id: "v1", kind: "plot", title: "Revenue trend" }, undefined, work.result.work_id);
  const pending = runtime.dataInspect("orders", { fields: [] }, work.result.work_id);
  assert.equal(events.filter((event) => event.type === "work.visual.changed").length, 1);
  assert.equal(events.some((event) => event.activity?.status === "completed"), false);
  gate.release();
  await pending;
});

test("cancel restores the durable visual and releases work artifacts", async () => {
  const runtime = runtimeWithDurableVisual();
  const work = await runtime.workApply({ action: "begin" });
  await runtime.visualPatch("v1", { set: { title: "Temporary" } }, undefined, work.result.work_id);
  await runtime.workApply({ action: "cancel", work_id: work.result.work_id });
  assert.equal(runtime.inspect().visuals.v1.title, "Durable");
  assert.equal(runtime.queryArtifactCount(work.result.work_id), 0);
});
```

- [ ] **Step 2: Run live-construction tests and verify failure where recovery visibility is missing**

Run: `npm run build:core && node --test tests/live-construction-runtime.test.mjs tests/live-construction-e2e.test.mjs`

- [ ] **Step 3: Update agent policy in `AGENTS.md`**

Add these concrete rules under Live Construction:

```markdown
- If the schema is known, create the complete visual immediately after `work.apply(begin)`.
- If the schema is unknown, create a title/intent draft before `data.inspect`.
- Do not call `data.query` merely to fetch rows that an immediately following visual render will query; rely on the render observation.
- Use `data.query` when analysis must precede the choice of visual expression; the WorkSession may reuse its artifact.
```

- [ ] **Step 4: Make failure and cancellation payloads sufficient for browser recovery**

Ensure terminal events contain `affected_ids`, durable revision, trace ID, and no stale effective overlay. Keep errors concise and structured; do not include dataset rows or raw SQL parameters.

- [ ] **Step 5: Validate contracts are unchanged**

Run: `npm run validate:contracts && npm run build:core && node --test tests/mcp-contract.test.mjs tests/live-construction-runtime.test.mjs tests/live-construction-e2e.test.mjs`

Expected: PASS and `contracts/tool-surface.json` remains unchanged.

- [ ] **Step 6: Commit orchestration and recovery**

```bash
git add AGENTS.md src/runtime/data-canvas-runtime.ts src/runtime/event-bus.ts tests/live-construction-runtime.test.mjs tests/live-construction-e2e.test.mjs tests/mcp-contract.test.mjs
git commit -m "feat: prioritize real draft-first rendering"
```

---

### Task 6: Define the browser motion policy

**Files:**
- Create: `web/motion-policy.js`
- Create: `tests/motion-policy.test.mjs`
- Modify: `web/render-motion.js`
- Modify: `tests/render-motion.test.mjs`
- Modify: `src/web/server.ts`
- Modify: `tests/web-smoke.test.mjs`

**Interfaces:**
- Produces: `createMotionPolicy({ reduced, hidden, maxAnimatedElements })`.
- Produces: `policy.forOperation({ phase, operation, family, index, elementCount })` returning `{ animate, duration, delay, easing, mode }`.
- Consumes: existing `motionStrategy` and reconciler operations.

- [ ] **Step 1: Write failing policy tests**

```js
test("uses restrained timing classes", () => {
  const policy = createMotionPolicy({ reduced: () => false, hidden: () => false });
  assert.deepEqual(policy.forOperation({ phase: "data-enter", operation: "enter", family: "bar", index: 2, elementCount: 4 }), {
    animate: true, duration: 280, delay: 48, easing: "cubic-bezier(.2,.8,.2,1)", mode: "baseline-enter"
  });
});

test("removes transform motion for reduced motion and skips queued motion in hidden tabs", () => {
  const reduced = createMotionPolicy({ reduced: () => true, hidden: () => false });
  assert.equal(reduced.forOperation(input).mode, "opacity-only");
  const hidden = createMotionPolicy({ reduced: () => false, hidden: () => true });
  assert.equal(hidden.forOperation(input).animate, false);
});

test("disables stagger above the element cap", () => {
  const policy = createMotionPolicy({ maxAnimatedElements: 120 });
  assert.equal(policy.forOperation({ ...input, index: 4, elementCount: 121 }).delay, 0);
});
```

- [ ] **Step 2: Run policy tests and verify failure**

Run: `node --test tests/motion-policy.test.mjs tests/render-motion.test.mjs`

Expected: FAIL because `motion-policy.js` does not exist.

- [ ] **Step 3: Implement policy constants and degradation**

Use these defaults:

```js
export const MOTION_TIMING = Object.freeze({
  draft: { duration: 160, easing: "cubic-bezier(.2,.8,.2,1)" },
  enter: { duration: 280, easing: "cubic-bezier(.2,.8,.2,1)" },
  update: { duration: 220, easing: "cubic-bezier(.2,.8,.2,1)" },
  settle: { duration: 180, easing: "cubic-bezier(.2,.8,.2,1)" }
});
```

Allow 24 ms stagger for at most six elements and only when total animated elements do not exceed 120. Reduced motion uses opacity-only transitions no longer than 100 ms. Hidden tabs return `animate: false`.

- [ ] **Step 4: Refactor `createRenderMotion` to consume policy**

Cancel previous Web Animations API handles when a new generation begins. Capture computed/current geometry before cancellation, then animate toward the accepted generation without resetting the element to its earlier start frame. Keep pointer interaction independent of animation promises.

- [ ] **Step 5: Serve and import the policy module**

Add `/assets/motion-policy.js` to `src/web/server.ts` and import it from `web/index.html` or `web/render-motion.js`. Add a smoke assertion that the asset returns JavaScript and the page wires the policy.

- [ ] **Step 6: Run motion and web tests**

Run: `npm run build:core && node --test tests/motion-policy.test.mjs tests/render-motion.test.mjs tests/cross-mark-transition.test.mjs tests/web-smoke.test.mjs`

Expected: PASS.

- [ ] **Step 7: Commit motion policy**

```bash
git add web/motion-policy.js web/render-motion.js src/web/server.ts tests/motion-policy.test.mjs tests/render-motion.test.mjs tests/web-smoke.test.mjs
git commit -m "feat: add restrained canvas motion policy"
```

---

### Task 7: Integrate semantic motion and stable streaming into the canvas

**Files:**
- Modify: `web/render-reconciler.js`
- Modify: `web/index.html`
- Modify: `web/canvas-motion.js`
- Modify: `tests/render-reconciler.test.mjs`
- Modify: `tests/canvas-commit.test.mjs`
- Modify: `tests/visual-render-cache.test.mjs`
- Modify: `tests/web-smoke.test.mjs`
- Modify: `tests/live-construction-e2e.test.mjs`

**Interfaces:**
- Produces: reconciler summaries `{ retainedKeys, enteredKeys, exitedKeys, replacedLayers, elementCount }`.
- Produces: draft/data-enter/semantic-update phase selection in the browser.
- Consumes: render artifact generation, `stream_state`, identity descriptors, and motion policy.

- [ ] **Step 1: Write failing retained-identity and stable-partial tests**

```js
test("reports semantic key sets while retaining matching nodes", () => {
  const result = reconcilePlotViewport(container, nextSvg, visual, nextArtifact, callbacks);
  assert.deepEqual(result.retainedKeys, ["bars:A"]);
  assert.deepEqual(result.enteredKeys, ["bars:C"]);
  assert.deepEqual(result.exitedKeys, ["bars:B"]);
  assert.equal(container.querySelector('[data-render-key="bars:A"]'), retainedNode);
});

test("does not exit absent keys while an artifact is partial", () => {
  const result = reconcilePlotViewport(container, partialSvg, visual, partialArtifact, callbacks);
  assert.deepEqual(result.exitedKeys, []);
});
```

- [ ] **Step 2: Run reconciler tests and verify the new summary assertions fail**

Run: `node --test tests/render-reconciler.test.mjs tests/visual-render-cache.test.mjs`

- [ ] **Step 3: Return semantic reconciliation summaries**

Keep the existing callbacks, but return a frozen summary that is derived from actual identity matching. Treat incompatible mark-family replacement as one `replacedLayers` entry; do not attempt rect-to-path morphing.

- [ ] **Step 4: Add draft and semantic phase selection in `web/index.html`**

Use these rules:

```js
const phase = payload.status === "working"
  ? "draft"
  : previousPayload?.status === "working"
    ? "data-enter"
    : "semantic-update";
```

Paint the draft synchronously from the effective WorkSession scene. Do not impose a minimum duration. Expose one callback after draft insertion, one after accepted Plot reconciliation, and one after motion settles; Task 8 connects those callbacks to browser timing marks.

- [ ] **Step 5: Preserve scale stability**

Do not render a partial artifact when its identity/plot metadata declares an unresolved domain. Continue showing the draft until the complete artifact arrives. For bounded partial artifacts with a stable domain, keep axes and grids retained and animate only new marks.

- [ ] **Step 6: Keep direct manipulation query-free**

Assert that pointer move uses transforms only, resize uses `visualRenderCache`, and release performs one cached `reflowCachedVisual` before persistence. Motion promises must not be awaited by pointer handlers or commit calls.

- [ ] **Step 7: Add reduced-motion, hidden-tab, interrupt, and large-data integration checks**

Use deterministic fake elements/animations in Node tests. In the live-construction E2E test, verify a draft DOM object exists before releasing a gated query, then verify the same object becomes rendered without page reload.

- [ ] **Step 8: Run browser and E2E regressions**

Run: `npm run build:core && node --test tests/render-reconciler.test.mjs tests/render-motion.test.mjs tests/canvas-commit.test.mjs tests/visual-render-cache.test.mjs tests/web-smoke.test.mjs tests/live-construction-e2e.test.mjs`

Expected: PASS with no network call during layout-only interactions.

- [ ] **Step 9: Commit semantic canvas motion**

```bash
git add web/render-reconciler.js web/index.html web/canvas-motion.js tests/render-reconciler.test.mjs tests/canvas-commit.test.mjs tests/visual-render-cache.test.mjs tests/web-smoke.test.mjs tests/live-construction-e2e.test.mjs
git commit -m "feat: animate semantic canvas updates"
```

---

### Task 8: Add browser timing marks and benchmark tooling

**Files:**
- Create: `web/performance-trace.js`
- Create: `tests/browser-performance-trace.test.mjs`
- Create: `scripts/benchmark-streaming-latency.mjs`
- Modify: `web/index.html`
- Modify: `src/web/server.ts`
- Modify: `package.json`
- Modify: `tests/web-smoke.test.mjs`

**Interfaces:**
- Produces: `createBrowserTrace({ performanceApi })` with `begin`, `mark`, `measure`, and `snapshot`.
- Produces: `npm run benchmark:streaming -- --base-url <url> --runs <n>`.
- Consumes: runtime `trace_id` from work events.

- [ ] **Step 1: Write failing browser-trace tests**

```js
test("marks draft, first paint, settle, and commit under one trace id", () => {
  const api = fakePerformance();
  const traces = createBrowserTrace({ performanceApi: api });
  traces.begin("trace-1");
  traces.mark("trace-1", "draft_visible");
  traces.mark("trace-1", "visual_first_paint");
  traces.mark("trace-1", "visual_settled");
  traces.mark("trace-1", "work_committed");
  assert.deepEqual(traces.snapshot("trace-1").map((item) => item.name), [
    "draft_visible", "visual_first_paint", "visual_settled", "work_committed"
  ]);
});
```

- [ ] **Step 2: Run the browser trace test and verify failure**

Run: `node --test tests/browser-performance-trace.test.mjs`

- [ ] **Step 3: Implement browser performance marks**

Prefix marks with `openboard:<traceId>:`. Keep a bounded in-memory index of the most recent 100 traces and clear Performance API entries after snapshot/export. Do not include titles, annotations, row values, or query text.

- [ ] **Step 4: Wire marks to real browser states**

Mark `draft_visible` after the draft object is in the DOM, `visual_first_paint` after the accepted Plot/annotation frame is reconciled, `visual_settled` after animations settle or are skipped, and `work_committed` when the matching completion event is applied.

- [ ] **Step 5: Implement the benchmark script**

The script accepts `--base-url`, `--runs`, and optional `--dataset`. It measures `/api/scene`, a valid `/api/data/query`, and an existing cached visual. Print JSON and a compact table containing count, min, p50, p95, max, HTTP status counts, and failure count. Use Node `fetch` with one keep-alive dispatcher so the benchmark distinguishes warm connection behavior from a separate `--fresh-connections` mode.

- [ ] **Step 6: Add the package command and smoke coverage**

```json
"benchmark:streaming": "npm run build:core && node scripts/benchmark-streaming-latency.mjs"
```

Serve `/assets/performance-trace.js` and assert the main page imports it.

- [ ] **Step 7: Run trace and web tests**

Run: `npm run build:core && node --test tests/browser-performance-trace.test.mjs tests/web-smoke.test.mjs tests/live-construction-e2e.test.mjs`

Expected: PASS.

- [ ] **Step 8: Run a local benchmark smoke**

Start the service on an unused local port, then run:

```bash
npm run benchmark:streaming -- --base-url http://127.0.0.1:4324 --runs 5
```

Expected: five successful samples per endpoint and p50/p95 output. Record results in the implementation handoff, not in Scene or history.

- [ ] **Step 9: Commit observability tooling**

```bash
git add web/performance-trace.js tests/browser-performance-trace.test.mjs scripts/benchmark-streaming-latency.mjs web/index.html src/web/server.ts package.json tests/web-smoke.test.mjs
git commit -m "feat: measure streaming canvas latency"
```

---

### Task 9: Complete full acceptance and release evidence

**Files:**
- Modify only if failures require in-scope corrections discovered by this plan.
- Do not update deployment state, push, or deploy unless the user separately authorizes those actions.

**Interfaces:**
- Consumes: all tasks above.
- Produces: verified test, performance, visual, and repository evidence.

- [ ] **Step 1: Run contract and complete automated verification**

Run:

```bash
npm run validate:contracts
npm test
```

Expected: contracts pass and the complete Node test suite passes.

- [ ] **Step 2: Verify persistent-state boundaries**

Create, patch, cancel, and commit WorkSessions against a temporary `.datacanvas` root. Inspect `scene.json`, `history.jsonl`, snapshots, and metadata. Confirm none contains query rows, trace snapshots, motion intent, or renderer DOM/SVG.

- [ ] **Step 3: Run local cold/warm benchmarks**

Restart once for cold measurements, then run at least 20 warm samples. Record:

- schema cold and warm durations;
- small aggregate p50/p95;
- cached visual p50/p95;
- execution counter for repeated same-work queries;
- layout-only query count.

The VPS-internal targets are aggregate-query p95 ≤ 100 ms and cached-visual p95 ≤ 10 ms.

- [ ] **Step 4: Perform rendered browser QA**

The flow under test is: load canvas → request a multi-step visual → observe draft before data → observe stable animated real marks → update the visual → drag and resize it → cancel a second edit → verify durable state and zero relevant console errors.

Check desktop and one mobile-sized viewport, normal and reduced motion, foreground and simulated hidden-tab behavior, slow query gating, render-limit failure, and reconnect.

- [ ] **Step 5: Verify public-path performance only when a deployed target is available**

Run the benchmark against the authorized deployment with warm connections and fresh connections reported separately. Do not treat a single HTTP 200 as release proof; compare runtime, TLS/connect, and browser milestones.

- [ ] **Step 6: Inspect repository scope**

Run:

```bash
git status --short
git diff --check
git log --oneline --decorate -12
```

Expected: only plan-related implementation files changed, no dataset rows or `.datacanvas` runtime state tracked, and every completed phase has its own commit.

- [ ] **Step 7: Prepare the completion handoff**

Report:

- behavior delivered;
- exact tests and benchmark commands;
- local p50/p95 and whether each target passed;
- browser QA evidence and untested environments;
- current branch, commits, remote divergence, and whether deployment was performed.

Do not claim deployment or public performance unless independently verified in that environment.
