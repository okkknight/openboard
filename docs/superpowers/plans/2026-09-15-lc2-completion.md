# LC2 Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the LC2 and V1 acceptance gaps found by an independent review without weakening durable Scene, QuerySpec, or retained-canvas guarantees.

**Architecture:** Validate every WorkSession mutation with the same immutable-field and identity rules as durable SceneStore mutations, then materialize only a strict Scene at commit. Keep SQL and restored datasets fail-closed. Use work-event affected IDs so the browser changes only cards whose durable or overlay state changed.

**Tech Stack:** Node.js 22+, TypeScript 5.8, DuckDB Node Neo, ws, Observable Plot, vanilla browser JavaScript, node:test.

**Spec:** `docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md`; `docs/superpowers/plans/2026-09-14-live-construction-lc0-lc1.md`.

## Global Constraints

- Scene remains the only durable product state; WorkSession overlays and artifacts remain ephemeral.
- Every successful WorkSession commit produces exactly one SceneStore revision and history record.
- Work-aware create, patch, clone, annotation, and compose operations enforce the same identity and immutable-field rules as durable operations.
- QuerySpec remains the default; raw SQL accepts only a verified read-only statement shape.
- Dataset files must resolve inside configured workspace data roots, including after restart.
- Browser work handling updates only affected cards; no page reload, synthetic progress, replay, or animation state in Scene.
- Every production behavior change begins with a real failing test.

---

### Task 1: Enforce WorkSession mutation parity

**Files:**
- Modify: `src/runtime/work-session-store.ts`
- Modify: `src/runtime/data-canvas-runtime.ts`
- Test: `tests/work-session-store.test.mjs`
- Test: `tests/live-construction-runtime.test.mjs`

**Interfaces:**
- `WorkSessionStore.createDraft(workId, draft, durable)` rejects an ID already present in the effective Scene.
- `WorkSessionStore.patchVisual(...)` applies durable `VisualPatch` path rules.
- `WorkSessionStore.annotate(...)` rejects duplicate IDs and unknown targets in the effective Scene.
- `materializeForCommit(...)` verifies map keys match `visual.id` and every annotation target exists.

- [ ] **Step 1: Write failing regressions**

```js
assert.throws(() => works.createDraft(work.id, fullVisual('v1'), durable), /already_exists/);
assert.throws(() => works.patchVisual(work.id, 'v1', { set: { id: 'other' } }, durable), /immutable_path/);
```

- [ ] **Step 2: Run the focused tests and confirm they fail because the overlay accepts both mutations.**

Run: `npm run build:core && node --test tests/work-session-store.test.mjs`

- [ ] **Step 3: Implement validation at the overlay boundary and again at materialization.**

- [ ] **Step 4: Add a runtime commit-failure lifecycle regression.**

```js
await assert.rejects(() => runtime.workApply({ action: 'commit', work_id }), /invalid_work_draft/);
assert.equal(runtime.inspectWorkSnapshots()[0].work.status, 'active');
```

- [ ] **Step 5: Run focused work tests and confirm GREEN.**

Run: `npm run build:core && node --test tests/work-session-store.test.mjs tests/live-construction-runtime.test.mjs`

### Task 2: Close local data trust boundaries

**Files:**
- Modify: `src/data/duckdb-engine.ts`
- Modify: `src/index.ts`
- Test: `tests/duckdb-engine.integration.test.mjs`
- Test: `tests/runtime.test.mjs`

**Interfaces:**
- `DuckDbEngine.queryRaw()` rejects data-modifying CTEs before DuckDB execution.
- Startup validates each restored dataset realpath against the selected data root before creating the runtime.

- [ ] **Step 1: Write failing SQL guard regression.**

```js
await assert.rejects(
  () => engine.queryRaw(orders, 'WITH x AS (SELECT 1) UPDATE "orders" SET channel = channel'),
  /query_rejected/
);
```

- [ ] **Step 2: Run the engine test and confirm it currently reaches DuckDB instead of rejecting.**

- [ ] **Step 3: Implement a comment-aware lexer that accepts exactly one top-level SELECT/WITH query and rejects top-level or nested write keywords.**

- [ ] **Step 4: Write a restored-dataset root regression using a scene whose dataset path resolves outside the chosen root.**

- [ ] **Step 5: Implement startup validation and run focused data/runtime tests.**

### Task 3: Deliver affected-card-only LC2 events

**Files:**
- Modify: `src/runtime/data-canvas-runtime.ts`
- Modify: `src/runtime/event-bus.ts`
- Modify: `web/index.html`
- Test: `tests/live-construction-runtime.test.mjs`
- Test: `tests/web-smoke.test.mjs`

**Interfaces:**
- Work events carry `affected_ids`; activity optionally carries `visual_id`.
- Work completion/cancel describes all overlay visual IDs and removals.
- Browser fetches the durable Scene at commit/cancel, updates metadata, then renders/removes only `affected_ids`.

- [ ] **Step 1: Write a runtime regression asserting `work.completed` contains the changed visual ID and a render activity contains its visual ID.**

- [ ] **Step 2: Run the focused test and confirm the existing events omit this identity.**

- [ ] **Step 3: Implement affected-ID calculation from the WorkSession overlay and propagate it through work events.**

- [ ] **Step 4: Write a browser regression that rejects a work-event handler calling `renderEffectiveScene()` and requires affected-ID rendering.**

- [ ] **Step 5: Change browser event handling to update only the event visual, or affected IDs at commit/cancel; inspect/query activity without a visual ID updates no plot.**

- [ ] **Step 6: Run focused runtime/web tests and confirm GREEN.**

### Task 4: Align history evidence and acceptance documentation

**Files:**
- Modify: `docs/acceptance/2026-09-09-m0-m1.md`
- Modify: `tests/scene-store.test.mjs`
- Test: `tests/m1-workflow.test.mjs`

**Interfaces:**
- `history.apply` navigation retains the documented snapshot revision semantics; checkpoint/fork remain metadata operations.
- Acceptance evidence records the current test count and LC2 retained-construction evidence, and explicitly documents the history-navigation exception to mutation revision increments.

- [ ] **Step 1: Write a regression that verifies undo/goto restore an immutable snapshot without appending a second durable operation.**

- [ ] **Step 2: Run it against the current history store to establish its existing intentional behavior.**

- [ ] **Step 3: Update the acceptance record to make the exception explicit rather than claiming every history navigation is a normal scene mutation.**

- [ ] **Step 4: Run full verification and perform an explicit checklist against V1 §2, §10–13, §16–17 and LC2 constraints.**

Run: `npm run verify:core && git diff --check`
