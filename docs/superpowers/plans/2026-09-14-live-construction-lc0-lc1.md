# Live Construction LC0 + LC1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add ephemeral WorkSession-based semantic construction so OpenBoard exposes real working state before final query/render, then commits one atomic durable Scene revision.

**Architecture:** Keep `SceneStore` durable-only. Add `WorkSessionStore` for in-memory overlays, sequences, activities and artifacts; runtime orchestrates real DuckDB execution and publishes ordered events. The browser merges durable Scene and work snapshots, retaining cards but allowing SVG rebuilds for each true semantic update.

**Tech Stack:** Node.js 22, TypeScript 5.8, Zod 4, DuckDB Node API, ws, Observable Plot, vanilla browser JavaScript, node:test.

**Spec:** `LIVE_CONSTRUCTION_SPEC_DELTA.md`

## Global Constraints

- Do not persist WorkSession, drafts, activity, artifacts, rows or animation state.
- Keep formal Scene and VisualSpec schema strict; partial Visuals exist only in WorkSession overlay.
- Add only `work.apply`; add optional `work_id` to existing relevant tools.
- A work commit must use one durable SceneStore commit/history record/revision.
- No timers, sleep, staged replay, fake progress or Chain-of-Thought text as construction.
- Keep no-work legacy tool behavior and existing visual grammar compatible.
- No DuckDB row streaming, new database, queue, front-end framework, or LC2 retained SVG rewrite.
- Every production behavior change begins with a failing real-code test.

---

### Task 1: Define ephemeral work types and overlay lifecycle

**Files:**
- Modify: `src/core/types.ts`
- Create: `src/runtime/work-session-store.ts`
- Test: `tests/work-session-store.test.mjs`

**Interfaces:**
- Consumes: durable `Scene`, `VisualSpec`, `VisualPatch`, `ComposeInput`, `AnnotationSpec`.
- Produces: `WorkSessionStore.begin(scene)`, `get(workId)`, `effectiveScene(workId, durableScene)`, `createDraft`, `patchVisual`, `cloneVisual`, `compose`, `annotate`, `complete`, `cancel`, `snapshot`, and `materializeForCommit`.

- [ ] **Step 1: Write failing lifecycle tests**

```js
test('begin records base revision without changing the durable scene', () => {
  const durable = seedScene(20);
  const works = new WorkSessionStore();
  const work = works.begin(durable);
  assert.equal(work.base_revision, 20);
  assert.equal(durable.revision, 20);
  assert.deepEqual(works.effectiveScene(work.id, durable), durable);
});

test('draft visual affects only the effective scene', () => {
  const durable = seedScene(20);
  const works = new WorkSessionStore();
  const work = works.begin(durable);
  works.createDraft(work.id, { id: 'draft', title: 'Channel failures' });
  assert.equal(durable.visuals.draft, undefined);
  assert.equal(works.effectiveScene(work.id, durable).visuals.draft.title, 'Channel failures');
});
```

- [ ] **Step 2: Run the new file and confirm RED**

Run: `npm run build:core && node --test tests/work-session-store.test.mjs`  
Expected: FAIL because `WorkSessionStore` and work types do not exist.

- [ ] **Step 3: Add minimal types and store implementation**

```ts
export interface WorkSession {
  id: string;
  base_revision: number;
  status: 'active' | 'committing' | 'completed' | 'cancelled' | 'failed';
  sequence: number;
  started_at: string;
  overlay: WorkingOverlay;
}

export class WorkSessionStore {
  begin(scene: Scene): WorkSession { /* work_1, sequence 1; no Scene mutation */ }
  effectiveScene(workId: string, durable: Scene): Scene { /* durable + overlay clone */ }
}
```

- [ ] **Step 4: Run the file and confirm GREEN**

Run: `npm run build:core && node --test tests/work-session-store.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Add incomplete-draft and materialization tests**

```js
test('rejects commit materialization while a draft lacks formal VisualSpec fields', () => {
  const work = seededWorkWithTitleOnlyDraft();
  assert.throws(() => works.materializeForCommit(work.id, seedScene(20)), /invalid_work_draft/);
});
```

- [ ] **Step 6: Implement partial draft validation and overlay operations**

Use the existing VisualPatch semantics for full and draft visual updates. Maintain delete/focus/group/layout/annotations in the overlay. Materialization must produce a strict full `Scene` clone or throw; it must never call `SceneStore`.

- [ ] **Step 7: Run focused tests**

Run: `npm run build:core && node --test tests/work-session-store.test.mjs`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/core/types.ts src/runtime/work-session-store.ts tests/work-session-store.test.mjs
git commit -m "feat: add ephemeral work session overlay"
```

### Task 2: Add one atomic durable work commit

**Files:**
- Modify: `src/core/scene-store.ts`
- Test: `tests/scene-store.test.mjs`

**Interfaces:**
- Consumes: a validated materialized `Scene`, current revision, concise work summary.
- Produces: `SceneStore.commitWork(scene, summary, expectedRevision)` with exactly one HistoryRecord operation `work.commit`.

- [ ] **Step 1: Write failing atomic commit tests**

```js
test('commits an effective work scene as one durable revision and one history record', () => {
  const store = seededStoreAtRevision(20);
  const effective = sceneWithPatchedAAndDraftC(store.inspect());
  store.commitWork(effective, { operations: 5 }, 20);
  assert.equal(store.inspect().revision, 21);
  assert.equal(store.historyRecords().at(-1).operation, 'work.commit');
  assert.equal(store.historyRecords().filter((r) => r.revision > 20).length, 1);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build:core && node --test tests/scene-store.test.mjs`  
Expected: FAIL because `commitWork` does not exist.

- [ ] **Step 3: Implement the single durable commit boundary**

```ts
commitWork(materialized: Scene, input: JsonValue, expectedRevision?: number): SceneMutationResult {
  const scene = this.#commit({ operation: 'work.commit', input }, (draft) => {
    draft.datasets = clone(materialized.datasets);
    draft.visuals = clone(materialized.visuals);
    draft.annotations = clone(materialized.annotations);
    draft.canvas = clone(materialized.canvas);
  }, expectedRevision);
  return { revision: scene.revision };
}
```

Validate canvas identity and normalized visual invariants before calling `#commit`.

- [ ] **Step 4: Verify GREEN and no core regressions**

Run: `npm run build:core && node --test tests/scene-store.test.mjs tests/history-store.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/scene-store.ts tests/scene-store.test.mjs
git commit -m "feat: commit work overlays atomically"
```

### Task 3: Orchestrate real work activity, working visuals, and cached artifacts

**Files:**
- Modify: `src/runtime/data-canvas-runtime.ts`
- Modify: `src/runtime/event-bus.ts`
- Test: `tests/live-construction-runtime.test.mjs`

**Interfaces:**
- Produces: `workApply({action, work_id?})`, work-aware visual/data/canvas methods, `inspectWorkSnapshots()`, `renderVisual(id, workId?)`, and ordered WorkEvent emissions.
- Uses: `WorkSessionStore`, `SceneStore.commitWork`, existing DuckDB engine/`compileQuery`/`observe`/`compilePlot`.

- [ ] **Step 1: Write failing pre-query visibility test using a real slow engine seam**

```js
test('emits a working draft before its delayed query resolves', async () => {
  const gate = deferred();
  const runtime = runtimeWithEngineThatWaitsFor(gate.promise);
  const events = [];
  runtime.onEvent((event) => events.push(event));
  const work = await runtime.workApply({ action: 'begin' });
  const pending = runtime.visualCreate({ id: 'draft', title: 'Failures', source: 'orders', query: {}, marks: [] }, undefined, work.result.work_id);
  await until(() => events.some((event) => event.type === 'work.visual.changed'));
  assert.equal(events.some((event) => event.type === 'work.activity' && event.activity?.status === 'completed'), false);
  gate.resolve();
  await pending;
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build:core && node --test tests/live-construction-runtime.test.mjs`  
Expected: FAIL because work-aware runtime APIs/events do not exist.

- [ ] **Step 3: Implement work lifecycle and real activity boundaries**

On `begin`, create a work with `sequence=1`, emit `work.started`, and return its id without persistence. For work-aware inspect/query/render, emit real `started` immediately before the actual engine call and `completed` only after it resolves; catch failures, store a recoverable work error, emit `failed`, and rethrow structured errors. For work-aware visual operations, mutate overlay and emit `work.visual.changed` before optional render. Only complete VisualSpecs render and populate artifacts.

- [ ] **Step 4: Add failing cache test**

```js
test('returns a work visual artifact without a second DuckDB query', async () => {
  const { runtime, queryCount } = runtimeWithCountingEngine();
  const work = await runtime.workApply({ action: 'begin' });
  await runtime.visualCreate(fullVisual('v1'), undefined, work.result.work_id);
  assert.equal(queryCount(), 1);
  await runtime.renderVisual('v1', work.result.work_id);
  assert.equal(queryCount(), 1);
});
```

- [ ] **Step 5: Implement RenderArtifact cache**

Cache complete render payloads by durable revision or `{work_id, sequence, visual_id}`. Invalidate/re-key when the effective visual changes. `renderVisual` must return a matching cached artifact; it may render only on a cache miss from direct legacy scene access.

- [ ] **Step 6: Add failing commit/cancel/conflict tests**

```js
test('commit persists one work.commit revision and cancel changes nothing durable', async () => { /* assert 20 -> 21 once; cancel leaves 21 unchanged */ });
test('rejects commit when durable revision diverges from base_revision', async () => { /* assert RevisionConflictError and preserves external scene */ });
test('does not persist incomplete work draft', async () => { /* assert invalid_work_draft and unchanged Persistence */ });
```

- [ ] **Step 7: Implement commit/cancel orchestration**

`commit` must mark committing, materialize, call `SceneStore.commitWork` once using `base_revision`, persist once, clear work/artifacts, then emit `work.completed`. `cancel` clears only ephemeral state and emits `work.cancelled`; it never calls persistence. Keep a failure work active when a draft can be patched into validity.

- [ ] **Step 8: Verify runtime suite**

Run: `npm run build:core && node --test tests/live-construction-runtime.test.mjs tests/runtime.test.mjs`  
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/runtime/data-canvas-runtime.ts src/runtime/event-bus.ts tests/live-construction-runtime.test.mjs
git commit -m "feat: orchestrate live construction work sessions"
```

### Task 4: Extend contracts and MCP without breaking legacy calls

**Files:**
- Modify: `src/mcp/schemas.ts`
- Modify: `src/mcp/server.ts`
- Modify: `contracts/tool-surface.json`
- Modify: `contracts/events.schema.json`
- Modify: `contracts/tool-output.schema.json`
- Test: `tests/mcp-contract.test.mjs`

**Interfaces:**
- Adds exactly `work.apply` to `TOOL_NAMES`.
- Adds optional `work_id` to the seven work-aware existing tools.
- Exposes work/event contract with id/base revision/sequence/activity metadata.

- [ ] **Step 1: Write failing MCP contract tests**

```js
test('adds only work.apply and accepts optional work_id on live-construction tools', () => {
  assert.deepEqual(TOOL_NAMES.at(-1), 'work.apply');
  assert.equal(toolSchemas['visual.create'].parse({ id: 'draft', title: 'Draft', work_id: 'work_1' }).work_id, 'work_1');
  assert.equal(toolSchemas['work.apply'].parse({ action: 'begin' }).action, 'begin');
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build:core && node --test tests/mcp-contract.test.mjs`  
Expected: FAIL because `work.apply` is absent and draft create cannot validate.

- [ ] **Step 3: Implement schema/handler/JSON contracts**

Use strict Zod schemas. Only `visual.create` with `work_id` permits partial VisualDraft input; without it keep formal source/query/marks requirements. Existing tool handlers pass `work_id` into runtime. `work.apply` maps only begin/commit/cancel, never an arbitrary progress command.

- [ ] **Step 4: Verify contracts and MCP tests**

Run: `npm run validate:contracts && npm run build:core && node --test tests/mcp-contract.test.mjs`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/mcp src/mcp/schemas.ts contracts tests/mcp-contract.test.mjs
git commit -m "feat: expose work lifecycle through MCP"
```

### Task 5: Deliver work snapshots and ordered browser effective state

**Files:**
- Modify: `src/web/server.ts`
- Modify: `web/index.html`
- Test: `tests/web-smoke.test.mjs`

**Interfaces:**
- Adds read-only `GET /api/works` and work-aware `GET /api/visual/:id?work_id=...`.
- Sends `work.snapshot` for active work on WebSocket connection.
- Browser owns separate `durableScene`, `activeWorks`, `lastSequence` and derives Effective Scene.

- [ ] **Step 1: Write failing transport/browser source tests**

```js
test('serves active work snapshots and work-aware artifacts', async () => {
  const work = await runtime.workApply({ action: 'begin' });
  assert.equal((await fetch(`${base}/api/works`).then(r => r.json())).works[0].id, work.result.work_id);
});

test('serves ordered effective-scene handling without construction replay timers', async () => {
  const html = await fetch(`${base}/`).then(r => r.text());
  assert.match(html, /lastSequence/);
  assert.match(html, /incoming\.sequence <= lastSequence/);
  assert.doesNotMatch(html, /playConstruction|replayConstruction|fakeProgress|stagedReveal/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: FAIL because `/api/works` and ordered work handling do not exist.

- [ ] **Step 3: Implement server snapshots and artifacts**

On WebSocket connection, send each active work snapshot emitted by runtime; add `/api/works` for reconnect reconciliation. Forward only runtime-produced events. Render endpoint selects a cached work artifact when `work_id` is supplied.

- [ ] **Step 4: Implement browser merge and low-motion working UI**

Render a partial draft as a quiet visual card title plus known data intent/activity, never a percentage spinner. Maintain durable and work state separately; on a valid work event merge/re-render only affected cards. Drop any work event with non-increasing sequence. On commit/cancel remove the overlay without reloading the page. For working updates, suppress existing long entrance animations or cap continuity to 200 ms.

- [ ] **Step 5: Add websocket ordering/reconnect tests**

```js
test('browser-side ordering predicate accepts sequence 6 and rejects stale sequence 4 after 5', () => { /* test exported/static helper or browser module seam */ });
test('new websocket client receives a work.snapshot for an active work', async () => { /* connect ws and assert work id/base revision/sequence */ });
```

- [ ] **Step 6: Verify web suite**

Run: `npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/web/server.ts web/index.html tests/web-smoke.test.mjs
git commit -m "feat: render ordered live work overlays"
```

### Task 6: Update agent policy and prove semantic E2E

**Files:**
- Modify: `AGENTS.md`
- Modify: `IMPLEMENTATION_PROMPT.md`
- Create: `LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md`
- Test: existing and new suites

**Interfaces:**
- Agent policy: multi-step/new-visual work begins with `work.apply(begin)`, uses one work id for related real operations, commits/cancels, avoids fake thought narration and mechanical patches; one-step quick changes can stay legacy.

- [ ] **Step 1: Write failing policy presence test**

```js
test('project instructions require work begin for multi-step canvas analysis', async () => {
  const agents = await readFile('AGENTS.md', 'utf8');
  assert.match(agents, /work\.apply/);
  assert.match(agents, /semantic patch/);
  assert.match(agents, /不要.*假/);
});
```

- [ ] **Step 2: Verify RED**

Run: `npm run build:core && node --test tests/live-construction-policy.test.mjs`  
Expected: FAIL because the policy text is absent.

- [ ] **Step 3: Update actual agent instructions and make policy test pass**

State the begin/early-draft/real-activity/semantic-patch/commit-cancel rules, preserve patch-before-create for normal existing visuals, and forbid chain-of-thought simulation.

- [ ] **Step 4: Run actual E2E scenario against the running app**

Use current CSV and real MCP/runtime operations: begin, create draft, query, complete visual, semantic patch, annotation, commit. Capture timestamps for work started, draft visible, query start/completed, marks visible, second semantic patch, annotation, commit and durable revision. Confirm at least two semantic changes occur before commit.

- [ ] **Step 5: Run full verification**

Run: `npm run verify:core`  
Expected: contract validation, typecheck/build and all tests PASS.

- [ ] **Step 6: Perform anti-playback and touched-area conformance review**

Run: `rg -n 'sleep\(|fakeProgress|playConstruction|replayConstruction|stagedReveal|simulateThinking' src web`  
Expected: no Live Construction implementation uses these constructs. Review touched files against `LIVE_CONSTRUCTION_SPEC_DELTA.md` and V1 Spec §10–12.

- [ ] **Step 7: Write the implementation report**

Document corrected/remaining V1 drift, actual WorkSession/event/tool schemas, history semantics, artifact cache, agent policy, test matrix, measured E2E timeline and known limitations. Explicitly list any remaining render-before-visible-state path.

- [ ] **Step 8: Commit**

```bash
git add AGENTS.md IMPLEMENTATION_PROMPT.md LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md tests/live-construction-policy.test.mjs
git commit -m "docs: define live construction agent policy"
```
