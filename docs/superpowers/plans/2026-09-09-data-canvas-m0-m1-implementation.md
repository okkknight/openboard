# Data Canvas M0/M1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first locally usable Data Canvas where Codex can inspect CSV data and create/patch persistent layered visuals that update live in a browser.

**Architecture:** Keep a dependency-light core SceneStore and contract layer independent from adapters. DuckDB compiles QuerySpec to safe read-only SQL; Observable Plot renders mark-based VisualSpecs; an MCP adapter exposes exactly nine tools; a WebSocket event stream keeps the browser synchronized with scene revisions.

**Tech Stack:** Node.js 22+, TypeScript 5.8+, `@duckdb/node-api` 1.5.x, `@modelcontextprotocol/server` 2.x, Zod 4.x, `@observablehq/plot` 0.6.x, browser WebSocket, JSON/JSONL.

**Spec:** `docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md`

## Global Constraints

- No dynamic HTML/CSS/React generation as an analysis operation.
- Scene is renderer-independent durable state.
- Patch before create; clone only when preserving a branch/comparison is useful.
- No silent sampling.
- QuerySpec is default; raw SQL is local read-only escape hatch.
- M0/M1 only; do not add auth/cloud/dashboard-builder/plugin features.
- Every successful mutation increments revision exactly once.
- Core logic stays independent from MCP, DuckDB and Observable Plot adapters.

---

## File map

Target structure after M1:

```text
src/
  core/
    types.ts                 shared scene/query/visual types
    scene-store.ts           mutations + revision control
    query-compiler.ts        QuerySpec -> parameterized SQL AST/result
    observation.ts           deterministic result summaries
    history-store.ts         JSONL operation history and checkpoints
  data/
    dataset-registry.ts      workspace source discovery/profile cache
    duckdb-engine.ts         Node Neo connection and read-only execution
  render/
    plot-compiler.ts         MarkSpec -> Observable Plot configuration
    render-service.ts        query result + visual spec -> render payload
  runtime/
    data-canvas-runtime.ts   orchestrates core/data/render/history/events
    event-bus.ts             typed scene events
    persistence.ts           scene/metadata load-save
  mcp/
    schemas.ts               Zod inputs matching contract JSON
    server.ts                exactly nine registered tools
  web/
    server.ts                static app + scene/event endpoints
web/
  index.html
  app.ts
  canvas.ts
  visual.ts
contracts/
  scene.schema.json
  tool-surface.json
```

The current repository already includes starter `SceneStore` and `compileQuery` implementations with contract tests. Treat them as executable design anchors: harden/extend them under TDD rather than rewriting the public behavior without evidence.

---

### Task 1: Finish core scene mutation contracts

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/core/scene-store.ts`
- Create: `src/core/history-store.ts`
- Test: `tests/scene-store.test.mjs`
- Test: `tests/history-store.test.mjs`

**Interfaces:**
- Consumes: `Scene`, `VisualSpec`, `VisualPatch`, `AnnotationSpec` from `src/core/types.ts`.
- Produces: `SceneStore` with `inspect()`, `createVisual()`, `patchVisual()`, `cloneVisual()`, `compose()`, `annotate()`, `applyHistory()` and optimistic `expectedRevision` checks.

- [ ] **Step 1: Add failing tests for mutation revision invariants**

```js
it("increments revision exactly once when patching a visual", () => {
  const store = seededStore();
  const before = store.inspect().revision;
  store.patchVisual("v1", { set: { title: "Changed" } }, before);
  assert.equal(store.inspect().revision, before + 1);
});

it("rejects a stale expected revision", () => {
  const store = seededStore();
  assert.throws(
    () => store.patchVisual("v1", { set: { title: "Changed" } }, 999),
    /revision_conflict/
  );
});
```

- [ ] **Step 2: Run the tests and verify the new cases fail for the intended reason**

Run: `npm run test:core`  
Expected: new tests fail because optimistic revision/history behavior is incomplete.

- [ ] **Step 3: Implement minimum revision and mutation behavior**

Implement one internal mutation boundary:

```ts
private commit(operation: SceneOperation, mutator: (draft: Scene) => void, expectedRevision?: number): Scene {
  this.assertRevision(expectedRevision);
  const next = structuredClone(this.scene);
  mutator(next);
  next.revision = this.scene.revision + 1;
  this.history.append({
    revision: next.revision,
    parent_revision: this.scene.revision,
    operation: operation.type,
    target: operation.target,
    input: operation.input,
    timestamp: new Date().toISOString()
  });
  this.scene = next;
  return structuredClone(this.scene);
}
```

All mutation methods call this once and only once.

- [ ] **Step 4: Run core tests**

Run: `npm run test:core`  
Expected: PASS, zero failures.

- [ ] **Step 5: Commit**

```bash
git add src/core tests
 git commit -m "feat: complete scene mutation core"
```

---

### Task 2: Implement QuerySpec compiler and render-limit contract

**Files:**
- Modify: `src/core/query-compiler.ts`
- Modify: `src/core/types.ts`
- Create: `tests/query-compiler.test.mjs`

**Interfaces:**
- Produces: `compileQuery(datasetTable: string, knownColumns: string[], spec: QuerySpec): CompiledQuery`.
- `CompiledQuery = { sql: string; params: JsonPrimitive[]; projectedFields: string[]; requestedLimit?: number }`.

- [ ] **Step 1: Write failing tests for identifiers and filter parameters**

```js
it("quotes identifiers and parameterizes filter values", () => {
  const q = compileQuery("orders", ["channel", "amount"], {
    filters: [{ field: "channel", op: "eq", value: "A" }],
    dimensions: [{ field: "channel" }],
    measures: [{ field: "amount", agg: "sum", alias: "revenue" }]
  });
  assert.match(q.sql, /"channel"/);
  assert.match(q.sql, /SUM\("amount"\)/);
  assert.deepEqual(q.params, ["A"]);
  assert.ok(!q.sql.includes("'A'"));
});

it("rejects an unknown filter column", () => {
  assert.throws(() => compileQuery("orders", ["channel"], {
    filters: [{ field: "secret", op: "eq", value: "x" }]
  }), /unknown_column/);
});
```

- [ ] **Step 2: Verify tests fail**

Run: `npm run test:core`  
Expected: FAIL because the new V1 cases are not yet supported by the starter compiler.

- [ ] **Step 3: Implement structured compiler**

Requirements:

- quote every table/column/alias identifier;
- parameterize all filter values;
- support all V1 filter operators from the spec;
- support dimensions + time grain;
- support aggregate measures;
- allow raw measure `expr` only when explicitly provided;
- reject mixed raw `sql` and structured query fields;
- enforce positive integer `limit`;
- do not add sampling unless `sample` is explicitly present.

- [ ] **Step 4: Add render-limit decision helper tests and implementation**

```ts
export function assertRenderable(rowCount: number, pointLimit: number, explicitSample?: SampleSpec): void
```

If `rowCount > pointLimit` and no explicit sample/aggregation makes output bounded, throw a typed `render_limit_exceeded` error carrying requested count and limit.

- [ ] **Step 5: Run core tests**

Run: `npm run test:core`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core tests/query-compiler.test.mjs
git commit -m "feat: compile safe query specs"
```

---

### Task 3: Add dataset registry and DuckDB Node Neo adapter

**Files:**
- Create: `src/data/dataset-registry.ts`
- Create: `src/data/duckdb-engine.ts`
- Create: `tests/dataset-registry.test.mjs`
- Create: `tests/duckdb-engine.integration.test.mjs`

**Interfaces:**
- Produces: `DatasetRegistry.discover(root): Promise<DatasetSpec[]>`.
- Produces: `DuckDbEngine.inspect(dataset): Promise<DatasetProfile>`.
- Produces: `DuckDbEngine.query(dataset, compiled): Promise<QueryResult>`.

- [ ] **Step 1: Add failing dataset discovery test**

Use a temporary directory containing `orders.csv`, `notes.txt`, and `sub/users.parquet`. Assert only allowed data formats are registered, IDs are deterministic, and paths cannot escape root.

- [ ] **Step 2: Verify failure**

Run: `npm test -- dataset-registry`  
Expected: FAIL because registry is missing.

- [ ] **Step 3: Implement discovery without import UI**

Rules:

- discover `.csv` and `.parquet` under configured roots;
- dataset ID derives from relative path and is stable;
- resolve real path and reject traversal outside roots;
- do not convert CSV yet.

- [ ] **Step 4: Add failing DuckDB integration test against `examples/orders.csv`**

The test should inspect columns and execute a parameterized structured query for channel counts/failure rate.

- [ ] **Step 5: Implement DuckDB Node Neo engine**

Use `@duckdb/node-api`. Keep one local instance/connection pool appropriate for a single-process application. Register file-backed sources as views/tables with properly escaped paths. Convert DuckDB values to JSON-safe values at the adapter boundary.

Reject non-read-only raw SQL. A conservative M1 implementation may allow only statements beginning with `SELECT`, `WITH`, `DESCRIBE`, `SUMMARIZE`, or `EXPLAIN` after stripping comments; add integration tests for rejected `CREATE`, `INSERT`, `UPDATE`, `DELETE`, `COPY`, `ATTACH`, `INSTALL`, and `LOAD`.

- [ ] **Step 6: Run dataset + DuckDB integration tests**

Run: `npm test -- dataset-registry duckdb-engine`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/data tests
git commit -m "feat: query local datasets with duckdb"
```

---

### Task 4: Build Observable Plot compiler and deterministic observation

**Files:**
- Create: `src/render/plot-compiler.ts`
- Create: `src/core/observation.ts`
- Create: `tests/plot-compiler.test.mjs`
- Create: `tests/observation.test.mjs`

**Interfaces:**
- Produces: `compilePlot(visual: VisualSpec, rows: JsonObject[]): PlotOptions`.
- Produces: `observe(rows: JsonObject[], hints: ObservationHints): Observation`.

- [ ] **Step 1: Write failing compiler tests**

Verify `lineY`, `areaY`, `ruleY` and `dot` layers compile in input order and unknown mark types throw `unsupported_visual_feature`.

- [ ] **Step 2: Verify failure**

Run: `npm test -- plot-compiler`  
Expected: FAIL.

- [ ] **Step 3: Implement explicit mark registry**

Use a map from Data Canvas mark type to Observable Plot constructor. Do not call arbitrary property names from input. Sanitize text/labels as plain strings. Reject unsupported options instead of forwarding blindly.

- [ ] **Step 4: Write failing observation tests**

Cover numeric min/max/mean/median, argmax key, top categories and first-to-last relative change.

- [ ] **Step 5: Implement deterministic observation**

Do not generate prose. Return structured primitives only.

- [ ] **Step 6: Run tests**

Run: `npm test -- plot-compiler observation`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render src/core/observation.ts tests
git commit -m "feat: compile visual marks and observations"
```

---

### Task 5: Assemble runtime, persistence and live event bus

**Files:**
- Create: `src/runtime/event-bus.ts`
- Create: `src/runtime/persistence.ts`
- Create: `src/runtime/data-canvas-runtime.ts`
- Create: `tests/runtime.test.mjs`
- Create: `tests/persistence.test.mjs`

**Interfaces:**
- Produces: `DataCanvasRuntime` methods matching the nine logical tools.
- Emits typed scene events containing `canvas_id`, `revision`, event type and affected IDs.

- [ ] **Step 1: Write failing M0 orchestration test using fake data/render adapters**

Test:

1. create visual;
2. verify revision increments;
3. patch same visual id;
4. verify a `visual.changed` event;
5. verify query/render adapter invoked with patched spec;
6. verify returned observation is attached to tool result.

- [ ] **Step 2: Verify failure**

Run: `npm test -- runtime`  
Expected: FAIL.

- [ ] **Step 3: Implement runtime orchestration**

Runtime owns ordering. Adapter failures must not partially commit inconsistent state; either validate/compile before commit or record a failed render state without losing the previous valid visual configuration. Pick one policy and lock it with tests; recommended M0 policy: validate/compile first, commit second.

- [ ] **Step 4: Add persistence tests**

Round-trip `scene.json`, append `history.jsonl`, restart runtime, compare revision/object identity.

- [ ] **Step 5: Implement atomic persistence**

Write `scene.json.tmp`, fsync/close, rename to `scene.json`; history append is line-delimited JSON. Recover cleanly if temp file remains after crash.

- [ ] **Step 6: Run tests**

Run: `npm test -- runtime persistence`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/runtime tests
git commit -m "feat: add data canvas runtime and persistence"
```

---

### Task 6: Expose exactly nine MCP tools

**Files:**
- Create: `src/mcp/schemas.ts`
- Create: `src/mcp/server.ts`
- Create: `tests/mcp-contract.test.mjs`

**Interfaces:**
- Consumes: `DataCanvasRuntime`.
- Produces: stdio MCP server using `@modelcontextprotocol/server` v2 and Zod v4.

- [ ] **Step 1: Write failing tool-registration test**

Assert tool names exactly equal the nine frozen names in `contracts/tool-surface.json`; no convenience aliases.

- [ ] **Step 2: Verify failure**

Run: `npm test -- mcp-contract`  
Expected: FAIL.

- [ ] **Step 3: Implement Zod schemas matching JSON contracts**

Keep one source of truth by adding a contract parity test that compares required top-level fields and enum values between Zod registration and `contracts/tool-surface.json`.

- [ ] **Step 4: Register tools using v2 API**

Shape follows the official v2 pattern:

```ts
const server = new McpServer({ name: "data-canvas", version: "0.1.0" });
server.registerTool("canvas.inspect", {
  description: "Inspect current canvas scene and datasets",
  inputSchema: CanvasInspectInput
}, async (input) => toMcpResult(await runtime.canvasInspect(input)));
```

Serve over stdio for M0/M1. HTTP MCP transport can be added later without changing runtime interfaces.

- [ ] **Step 5: Run MCP contract tests**

Run: `npm test -- mcp-contract`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/mcp tests/mcp-contract.test.mjs
git commit -m "feat: expose data canvas mcp tools"
```

---

### Task 7: Build minimal browser viewport and live updates

**Files:**
- Create: `src/web/server.ts`
- Create: `web/index.html`
- Create: `web/app.ts`
- Create: `web/canvas.ts`
- Create: `web/visual.ts`
- Create: `tests/web-smoke.test.mjs`

**Interfaces:**
- Browser loads current scene snapshot.
- Browser subscribes to WebSocket scene events.
- Browser re-renders only affected visual objects.

- [ ] **Step 1: Write failing smoke test**

Start local web server on ephemeral port, fetch `/api/scene`, assert valid scene, connect WebSocket, perform runtime patch, assert event includes same visual id and new revision.

- [ ] **Step 2: Verify failure**

Run: `npm test -- web-smoke`  
Expected: FAIL.

- [ ] **Step 3: Implement intentionally small viewport**

Required visible controls only:

- fit/reset view;
- connection indicator;
- current revision/history indicator;
- visual focus state.

No field picker, chart editor, filter builder or embedded chat.

- [ ] **Step 4: Render Observable Plot from runtime render payload**

Do not expose arbitrary code execution. Renderer receives normalized mark config + JSON rows and creates DOM nodes through Observable Plot.

- [ ] **Step 5: Run smoke test and manual M0 browser scenario**

Run: `npm test -- web-smoke`  
Then run daemon and execute the interaction trace in `examples/m0-interaction.md`.

Expected: same visual id changes in place without browser reload.

- [ ] **Step 6: Commit**

```bash
git add src/web web tests/web-smoke.test.mjs
git commit -m "feat: add live data canvas viewport"
```

---

### Task 8: Complete M1 clone/compose/annotation/history behavior

**Files:**
- Modify: `src/core/scene-store.ts`
- Modify: `src/core/history-store.ts`
- Modify: `src/runtime/data-canvas-runtime.ts`
- Modify: `src/mcp/schemas.ts`
- Create: `tests/m1-workflow.test.mjs`

**Interfaces:**
- All nine tools meet `contracts/tool-surface.json`.

- [ ] **Step 1: Write one end-to-end local M1 workflow test**

Using sample data:

1. create failure-by-channel visual;
2. clone and filter clone to channel B;
3. patch clone dimension to region;
4. arrange original + clone side by side;
5. annotate clone;
6. checkpoint;
7. patch clone again;
8. goto checkpoint and verify prior state restored;
9. fork from checkpoint and verify parent lineage.

- [ ] **Step 2: Verify failure**

Run: `npm test -- m1-workflow`  
Expected: FAIL until missing M1 behaviors are implemented.

- [ ] **Step 3: Implement missing behavior without adding new tools**

Do not introduce `drill_down`, `compare`, `trend`, `filter` or `chart.create` aliases. Express them through the frozen primitives.

- [ ] **Step 4: Run full test suite**

Run: `npm test`  
Expected: PASS.

- [ ] **Step 5: Run contract validation and build**

Run:

```bash
npm run validate:contracts
npm run build
```

Expected: both exit 0.

- [ ] **Step 6: Perform M0 and M1 acceptance checklist from spec**

Record evidence in `docs/acceptance/2026-09-09-m0-m1.md` with commands and observed revision/visual IDs. Do not mark an item complete without evidence.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat: complete data canvas m1"
```
