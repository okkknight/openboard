# Frameless Narrative Canvas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace persistent visual cards with direct canvas objects and add selection, dragging, resizing, multi-selection, snapping, annotation editing, and atomic durable layout commits.

**Architecture:** Extend the existing Scene contracts with optional annotation presentation and atomic typed layout updates, while keeping interaction previews entirely in browser memory. Split geometry, gesture state, object rendering, interaction chrome, layout motion, and annotation rendering into focused browser modules; use the existing runtime, history, WebSocket, render cache, and retained reconciler for durable commits and visual continuity.

**Tech Stack:** Node.js 22+, TypeScript 5.8+, Zod 4.5, native browser Pointer Events and Web Animations, Observable Plot 0.6.17, WebSocket, JSON/JSONL persistence, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-17-frameless-narrative-canvas-design.md`

## Global Constraints

- Do not add MCP tools; the frozen surface remains the current 10 tools, including `work.apply`.
- Every `visual.create`, `visual.patch`, and `visual.clone` still requires an explicit WorkSession and `work_id`.
- Scene stores durable visuals, annotations, canvas state, and layouts; it never stores DOM, selection chrome, pointer state, guides, or animation state.
- One completed pointer or keyboard gesture creates at most one Scene revision and one history record.
- Selection, hover, marquee, preview transforms, and cancelled gestures create no revision.
- Moving or resizing never executes a DuckDB query.
- Existing scenes and existing single-visual `canvas.compose` calls remain valid without migration.
- Existing `canvas.annotate` calls without `mode` keep create semantics and duplicate-ID rejection.
- No arbitrary HTML, CSS, SVG, JavaScript, or font names enter Scene state.
- Keep core contracts independent from DuckDB, MCP, Observable Plot, and browser DOM code.
- Use test-driven development for every behavior change and keep each task independently reviewable.
- Preserve `prefers-reduced-motion`, keyboard focus visibility, and accessible names for interactive controls.

---

## File Map

### Core and adapters

- Modify `src/core/types.ts` — typed annotation style, annotation patch, object references, and batch layout updates.
- Modify `src/core/scene-store.ts` — atomic visual/annotation layout commits and annotation patching.
- Modify `src/runtime/work-session-store.ts` — the same behavior inside ephemeral WorkSessions.
- Modify `src/runtime/data-canvas-runtime.ts` — orchestration, persistence, and affected-object events.
- Modify `src/runtime/event-bus.ts` — typed affected object references.
- Modify `src/mcp/schemas.ts` — Zod parity for new optional contract fields.
- Modify `src/mcp/server.ts` — translate create/patch annotation inputs into runtime calls.
- Modify `src/web/server.ts` — static module delivery plus direct compose/annotation HTTP endpoints.
- Modify `contracts/scene.schema.json` and `contracts/tool-surface.json` — authoritative JSON contracts.

### Browser

- Create `web/canvas-geometry.js` — pure coordinates, bounds, resize, group transform, minimum size, and snapping.
- Create `web/canvas-interaction.js` — DOM-independent selection and gesture state machine.
- Create `web/canvas-object-view.js` — frameless Visual and Annotation object DOM.
- Create `web/annotation-renderer.js` — semantic text variants, fallback layout, and connector geometry.
- Create `web/interaction-chrome.js` — selection bounds, eight handles, guides, chips, and live-region status.
- Create `web/canvas-motion.js` — FLIP, snap completion, rollback, birth, and exit animation.
- Create `web/canvas-commit.js` — optimistic layout/annotation commit and conflict recovery.
- Create `web/visual-render-cache.js` — cached render payloads and query-free final-size reflow.
- Modify `web/index.html` — application composition, styles, toolbar, inspector, and event binding.

### Tests and evidence

- Modify `tests/scene-store.test.mjs`, `tests/work-session-store.test.mjs`, `tests/runtime.test.mjs`, `tests/mcp-contract.test.mjs`, and `tests/web-smoke.test.mjs`.
- Create `tests/canvas-geometry.test.mjs`, `tests/canvas-interaction.test.mjs`, `tests/annotation-renderer.test.mjs`, `tests/canvas-commit.test.mjs`, and `tests/visual-render-cache.test.mjs`.
- Modify `docs/acceptance/2026-09-09-m0-m1.md` with final evidence.

---

### Task 1: Extend Scene and tool contracts

**Files:**
- Modify: `src/core/types.ts:149-267`
- Modify: `src/mcp/schemas.ts:1-65`
- Modify: `contracts/scene.schema.json`
- Modify: `contracts/tool-surface.json`
- Modify: `scripts/validate-contracts.mjs`
- Test: `tests/mcp-contract.test.mjs`

**Interfaces:**
- Produces: `AnnotationStyle`, `AnnotationPatch`, `CanvasObjectRef`, `LayoutUpdate`, `AnnotationMutation`, and `CanvasAnnotateInput` in `src/core/types.ts`.
- Produces: `ComposeInput.layout_updates?: LayoutUpdate[]`.
- Preserves: every existing tool name and existing create-annotation payload.

- [ ] **Step 1: Write failing contract tests for annotation presentation and batch layouts**

Add cases that require the JSON contract and Zod schema to accept the new forms and reject ambiguous or empty forms:

```js
test("accepts typed annotation patches and atomic layout updates", () => {
  assert.deepEqual(toolSchemas["canvas.annotate"].parse({
    mode: "patch",
    id: "insight",
    patch: { text: "Channel B drives 60%", style: { variant: "insight", align: "start" } }
  }).mode, "patch");

  const compose = toolSchemas["canvas.compose"].parse({
    action: "move",
    layout_updates: [
      { target: { kind: "visual", id: "orders" }, layout: { x: 20, y: 40, w: 480, h: 320 } },
      { target: { kind: "annotation", id: "insight" }, layout: { x: 520, y: 40, w: 280, h: 120 } }
    ]
  });
  assert.equal(compose.layout_updates.length, 2);
});

test("rejects an empty annotation patch and mixed compose forms", () => {
  assert.throws(() => toolSchemas["canvas.annotate"].parse({ mode: "patch", id: "a", patch: {} }));
  assert.throws(() => toolSchemas["canvas.compose"].parse({
    action: "move",
    target: "orders",
    layout: { x: 0, y: 0, w: 10, h: 10 },
    layout_updates: [{ target: { kind: "visual", id: "orders" }, layout: { x: 1, y: 1, w: 10, h: 10 } }]
  }));
});
```

- [ ] **Step 2: Run the focused test and verify the intended failure**

Run: `npm run build:core && node --test tests/mcp-contract.test.mjs`  
Expected: FAIL because `mode`, `patch`, annotation style, and `layout_updates` are not accepted.

- [ ] **Step 3: Add exact shared types**

Add these definitions and use them from `AnnotationSpec` and `ComposeInput`:

```ts
export interface AnnotationStyle {
  variant: "caption" | "body" | "insight" | "callout";
  align?: "start" | "center" | "end";
  color_role?: "default" | "muted" | "accent" | "warning";
}

export interface CanvasObjectRef { kind: "visual" | "annotation"; id: string; }
export interface LayoutUpdate { target: CanvasObjectRef; layout: LayoutSpec; }
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
```

Add `layout?: LayoutSpec` and `style?: AnnotationStyle` to `AnnotationSpec`; add `layout_updates?: LayoutUpdate[]` to `ComposeInput`.

- [ ] **Step 4: Update Zod and JSON schemas with parity rules**

Use a strict discriminated union for annotation input. Require at least one own property in `patch`. In compose validation, accept either legacy `target + layout` or non-empty `layout_updates`, never both. Validate positive layout dimensions and unique `{kind,id}` targets.

- [ ] **Step 5: Run contract validation and focused tests**

Run: `npm run validate:contracts && npm run build:core && node --test tests/mcp-contract.test.mjs`  
Expected: PASS with exactly 10 unique tools.

- [ ] **Step 6: Commit**

```bash
git add src/core/types.ts src/mcp/schemas.ts contracts/scene.schema.json contracts/tool-surface.json scripts/validate-contracts.mjs tests/mcp-contract.test.mjs
git commit -m "feat: extend canvas object contracts"
```

---

### Task 2: Implement atomic layout and annotation mutations

**Files:**
- Modify: `src/core/scene-store.ts:240-308`
- Modify: `src/runtime/work-session-store.ts:160-221`
- Test: `tests/scene-store.test.mjs`
- Test: `tests/work-session-store.test.mjs`

**Interfaces:**
- Consumes: `LayoutUpdate`, `AnnotationPatch`, and legacy `ComposeInput` from Task 1.
- Produces: `SceneStore.patchAnnotation(id, patch, expectedRevision?)`.
- Produces: `WorkSessionStore.patchAnnotation(workId, id, patch, durable)`.
- Guarantees: every non-empty batch is one atomic mutation; validation failure leaves durable and effective scenes unchanged.

- [ ] **Step 1: Write failing SceneStore tests**

```js
test("moves visual and annotation atomically in one revision", () => {
  const store = seededStore();
  store.annotate({ id: "note", text: "Explain B", layout: { x: 10, y: 10, w: 180, h: 80 }, created_at: "2026-09-17T00:00:00.000Z" });
  const before = store.inspect().revision;
  store.compose({ action: "move", layout_updates: [
    { target: { kind: "visual", id: "v1" }, layout: { x: 40, y: 50, w: 480, h: 320 } },
    { target: { kind: "annotation", id: "note" }, layout: { x: 540, y: 50, w: 180, h: 80 } }
  ] }, before);
  assert.equal(store.inspect().revision, before + 1);
  assert.equal(store.historyRecords().at(-1).operation, "canvas.compose");
});

test("patches one annotation exactly once", () => {
  const store = seededStore();
  store.annotate({ id: "note", text: "Before", created_at: "2026-09-17T00:00:00.000Z" });
  const before = store.inspect().revision;
  store.patchAnnotation("note", { text: "After", style: { variant: "insight" } }, before);
  assert.equal(store.inspect().revision, before + 1);
  assert.equal(store.inspect().annotations.note.text, "After");
});
```

- [ ] **Step 2: Write failing WorkSession tests**

Verify a batch updates both overlay object families, remains invisible in the durable scene before commit, and materializes as one revision at WorkSession commit.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `npm run build:core && node --test tests/scene-store.test.mjs tests/work-session-store.test.mjs`  
Expected: FAIL because annotations cannot be patched or addressed by compose.

- [ ] **Step 4: Implement shared object resolution and patch semantics**

Add private helpers in `scene-store.ts` that resolve a typed object reference and apply layouts only after validating the full batch:

```ts
function applyLayoutUpdate(scene: Scene, update: LayoutUpdate): void {
  if (update.target.kind === "visual") {
    const visual = scene.visuals[update.target.id];
    if (!visual) throw new Error(`not_found: visual ${update.target.id}`);
    visual.layout = clone(update.layout);
    return;
  }
  const annotation = scene.annotations[update.target.id];
  if (!annotation) throw new Error(`not_found: annotation ${update.target.id}`);
  annotation.layout = clone(update.layout);
}
```

Normalize legacy `target + layout` to one visual `LayoutUpdate`, reject duplicate refs, and reject empty/no-op batches before `#commit` so no revision is created.

- [ ] **Step 5: Mirror the same semantics in WorkSessionStore**

Update visual drafts in `overlay.visuals` and annotation drafts in `overlay.annotations`. Do not persist or emit durable history until the WorkSession commits. Preserve create-mode duplicate-ID rejection.

- [ ] **Step 6: Run focused and history tests**

Run: `npm run build:core && node --test tests/scene-store.test.mjs tests/work-session-store.test.mjs tests/history-store.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/core/scene-store.ts src/runtime/work-session-store.ts tests/scene-store.test.mjs tests/work-session-store.test.mjs
git commit -m "feat: commit canvas layouts atomically"
```

---

### Task 3: Expose runtime, event, MCP, and HTTP mutation paths

**Files:**
- Modify: `src/runtime/event-bus.ts`
- Modify: `src/runtime/data-canvas-runtime.ts:178-205`
- Modify: `src/mcp/server.ts:76-95`
- Modify: `src/web/server.ts:110-200`
- Test: `tests/runtime.test.mjs`
- Test: `tests/mcp-contract.test.mjs`
- Test: `tests/web-smoke.test.mjs`

**Interfaces:**
- Produces: `SceneEvent.affected_objects?: CanvasObjectRef[]` while retaining `affected_ids` for existing visual consumers.
- Produces: `DataCanvasRuntime.canvasAnnotate(input: AnnotationMutation, expectedRevision?: number, workId?: string)`.
- Produces: `POST /api/canvas/compose` accepting the `canvas.compose` schema.
- Produces: `POST /api/canvas/annotate` accepting both create and patch modes.
- Produces: structured `revision_conflict` HTTP responses with status 409.

- [ ] **Step 1: Add failing runtime event tests**

```js
test("broadcasts typed affected objects for one atomic layout commit", async () => {
  const runtime = seededRuntimeWithVisualAndAnnotation();
  const events = [];
  runtime.events.on((event) => events.push(event));
  const before = runtime.inspect().revision;
  await runtime.canvasCompose({ action: "move", layout_updates: [
    { target: { kind: "visual", id: "v1" }, layout: { x: 40, y: 40, w: 480, h: 320 } },
    { target: { kind: "annotation", id: "a1" }, layout: { x: 540, y: 40, w: 240, h: 120 } }
  ] }, before);
  assert.deepEqual(events.at(-1).affected_objects, [
    { kind: "visual", id: "v1" }, { kind: "annotation", id: "a1" }
  ]);
  assert.equal(runtime.inspect().revision, before + 1);
});
```

- [ ] **Step 2: Add failing HTTP tests**

Start an ephemeral server, POST a layout batch, assert revision increases once, then POST the same stale `expected_revision` and assert HTTP 409 with `error.code === "revision_conflict"`. Add a patch-annotation request and assert text/style persistence.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `npm run build:core && node --test tests/runtime.test.mjs tests/mcp-contract.test.mjs tests/web-smoke.test.mjs`  
Expected: FAIL because typed events and browser mutation endpoints are absent.

- [ ] **Step 4: Implement runtime and adapter translation**

In `canvasCompose`, derive affected refs from normalized layout updates and emit one `layout.changed`. In `canvasAnnotate`, route create mode to `annotate` and patch mode to `patchAnnotation`; use the same WorkSession overlay semantics when `work_id` is supplied.

- [ ] **Step 5: Add strict HTTP endpoints**

Parse request JSON through the existing Zod tool schemas. Return the runtime output unchanged on success; return `mutationError` output on validation, not-found, and conflict failures. Do not put mutation logic in `src/web/server.ts`.

- [ ] **Step 6: Run focused tests**

Run: `npm run build:core && node --test tests/runtime.test.mjs tests/mcp-contract.test.mjs tests/web-smoke.test.mjs`  
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/runtime/event-bus.ts src/runtime/data-canvas-runtime.ts src/mcp/server.ts src/web/server.ts tests/runtime.test.mjs tests/mcp-contract.test.mjs tests/web-smoke.test.mjs
git commit -m "feat: expose canvas object mutations"
```

---

### Task 4: Build pure canvas geometry

**Files:**
- Create: `web/canvas-geometry.js`
- Create: `tests/canvas-geometry.test.mjs`
- Modify: `src/web/server.ts`
- Modify: `tests/web-smoke.test.mjs`

**Interfaces:**
- Produces: `screenDeltaToCanvas(delta, zoom)`.
- Produces: `boundsForLayouts(entries)`.
- Produces: `moveLayouts(entries, delta)`.
- Produces: `resizeLayouts(entries, groupBounds, handle, delta, modifiers, minimumFor)`.
- Produces: `snapLayouts(preview, stationary, options) -> { layouts, guides }`.

- [ ] **Step 1: Write failing coordinate and bounds tests**

```js
test("converts screen movement through zoom and bounds multiple objects", () => {
  assert.deepEqual(screenDeltaToCanvas({ x: 24, y: -12 }, 1.5), { x: 16, y: -8 });
  assert.deepEqual(boundsForLayouts([
    ["visual:a", { x: 10, y: 20, w: 100, h: 60 }],
    ["annotation:b", { x: 140, y: 10, w: 80, h: 100 }]
  ]), { x: 10, y: 10, w: 210, h: 100 });
});
```

- [ ] **Step 2: Write failing resize and snapping tests**

Cover southeast resize, west-edge resize, Shift aspect lock, Alt center resize, proportional multi-object resize, minimum sizes, object-edge snap, equal-gap snap, grid fallback, Control disable, and six-screen-pixel threshold at zoom 0.8, 1, and 1.5.

- [ ] **Step 3: Run tests and verify module-not-found failure**

Run: `node --test tests/canvas-geometry.test.mjs`  
Expected: FAIL because `web/canvas-geometry.js` does not exist.

- [ ] **Step 4: Implement deterministic pure functions**

Represent layouts as `Map<string, LayoutSpec>` internally and return new maps without mutating inputs. Return guides as plain objects:

```js
{ axis: "x" | "y", value: number, kind: "edge" | "center" | "gap" | "grid", refs: string[] }
```

Apply candidate priority exactly as the spec requires. Round committed coordinates to two decimals; keep preview math unrounded.

- [ ] **Step 5: Serve the module and run tests**

Add `/assets/canvas-geometry.js` to `src/web/server.ts` and assert HTTP 200 in `tests/web-smoke.test.mjs`.

Run: `node --test tests/canvas-geometry.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/canvas-geometry.js src/web/server.ts tests/canvas-geometry.test.mjs tests/web-smoke.test.mjs
git commit -m "feat: add canvas geometry engine"
```

---

### Task 5: Build the interaction state machine

**Files:**
- Create: `web/canvas-interaction.js`
- Create: `tests/canvas-interaction.test.mjs`
- Modify: `src/web/server.ts`
- Modify: `tests/web-smoke.test.mjs`

**Interfaces:**
- Consumes: geometry functions from Task 4.
- Produces: `createInteractionController(options)` with `select`, `clearSelection`, `beginMove`, `beginResize`, `updatePointer`, `finishPointer`, `cancel`, `beginMarquee`, `finishMarquee`, `nudge`, `finishNudge`, `removeMissing`, and `getState`.
- Calls: `onPreview(layouts, guides)`, `onCommit(gesture)`, `onRollback(layouts, message)`, and `onSelectionChange(refs)`.

- [ ] **Step 1: Write failing selection tests**

```js
test("selection is ephemeral and shift toggles members", () => {
  const calls = recordingCallbacks();
  const controller = createInteractionController(calls.options);
  controller.select({ kind: "visual", id: "a" });
  controller.select({ kind: "annotation", id: "b" }, { additive: true });
  assert.deepEqual(controller.getState().selection, ["visual:a", "annotation:b"]);
  assert.equal(calls.commits.length, 0);
});
```

- [ ] **Step 2: Write failing gesture tests**

Verify pointer updates call `onPreview` but not `onCommit`; pointer finish emits exactly one gesture containing `action`, `baseRevision`, `originalLayouts`, and `layoutUpdates`; Escape calls rollback without commit; no-op movement produces no commit; repeated keyboard nudges commit once on keyup.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test tests/canvas-interaction.test.mjs`  
Expected: FAIL because the controller is absent.

- [ ] **Step 4: Implement the controller as a DOM-independent state machine**

Use one explicit phase enum:

```js
const PHASES = ["idle", "marquee", "moving", "resizing", "editing", "panning"];
```

Store selection as ordered object keys and gesture layouts as immutable snapshots. Refuse a second active pointer. Keep snapping disabled only for the current update while Control is pressed.

- [ ] **Step 5: Serve the module and run focused tests**

Run: `node --test tests/canvas-interaction.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/canvas-interaction.js src/web/server.ts tests/canvas-interaction.test.mjs tests/web-smoke.test.mjs
git commit -m "feat: add canvas interaction state machine"
```

---

### Task 6: Render frameless Visual and Annotation objects

**Files:**
- Create: `web/canvas-object-view.js`
- Create: `web/annotation-renderer.js`
- Create: `tests/annotation-renderer.test.mjs`
- Modify: `web/index.html:1-460`
- Modify: `src/web/server.ts`
- Modify: `tests/web-smoke.test.mjs`

**Interfaces:**
- Produces: `createCanvasObjectView({ board, renderVisual, renderAnnotation })` with `ensure`, `remove`, `elementFor`, `layoutFor`, `allRefs`, and `sync`.
- Produces: `fallbackAnnotationLayout(annotation, visuals, index)`.
- Produces: `connectorGeometry(annotationLayout, targetLayout)`.
- Preserves: one `.plot` retained render surface per visual.

- [ ] **Step 1: Write failing annotation geometry tests**

```js
test("derives a stable legacy annotation layout and nearest-edge connector", () => {
  const visual = { x: 100, y: 100, w: 400, h: 260 };
  assert.deepEqual(fallbackAnnotationLayout({ id: "a", text: "Note", target: "v" }, { v: visual }, 0),
    { x: 524, y: 100, w: 280, h: 120 });
  assert.deepEqual(connectorGeometry({ x: 524, y: 100, w: 280, h: 120 }, visual),
    { from: { x: 524, y: 160 }, to: { x: 500, y: 160 } });
});
```

- [ ] **Step 2: Add failing web structure tests**

Assert the served HTML imports the two new modules, uses `.canvas-object` instead of `.visual-card`, contains separate object content and working-status layers, renders annotations inside `#board`, and has no persistent object border/background/shadow CSS.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test tests/annotation-renderer.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: FAIL because the modules and frameless structure are absent.

- [ ] **Step 4: Implement semantic annotation rendering**

Map `caption`, `body`, `insight`, and `callout` to fixed classes. Use `textContent` exclusively. Render derived connectors in one board-level SVG layer with `pointer-events: none`; do not store path data in Scene.

- [ ] **Step 5: Replace card DOM with object DOM**

Use this stable structure:

```html
<article class="canvas-object" data-kind="visual" data-object-id="orders" tabindex="0">
  <div class="object-title"><span class="object-grab" aria-hidden="true"></span><span class="object-title-text"></span></div>
  <div class="object-content"><div class="plot"></div></div>
  <div class="object-status" aria-live="polite" hidden></div>
</article>
```

Default `.canvas-object` has transparent background, no border, no radius, and no shadow. Keep title and content spacing outside chart axes. Hide technical IDs outside diagnostics.

- [ ] **Step 6: Keep retained render and WorkSession status independent**

Port the current separate working-overlay behavior into `.object-status`: working state must not replace `.plot`; successful content clears status; failed rendering retains the last valid plot and shows a short local error.

- [ ] **Step 7: Run focused and retained-render tests**

Run: `node --test tests/annotation-renderer.test.mjs tests/render-reconciler.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/canvas-object-view.js web/annotation-renderer.js src/web/server.ts tests/annotation-renderer.test.mjs tests/web-smoke.test.mjs
git commit -m "feat: render frameless canvas objects"
```

---

### Task 7: Add interaction chrome and wire pointer and keyboard input

**Files:**
- Create: `web/interaction-chrome.js`
- Create: `web/canvas-motion.js`
- Modify: `web/index.html`
- Modify: `src/web/server.ts`
- Modify: `tests/web-smoke.test.mjs`
- Test: `tests/canvas-interaction.test.mjs`

**Interfaces:**
- Consumes: controller from Task 5 and object view from Task 6.
- Produces: `createInteractionChrome(root)` with `renderSelection`, `renderGuides`, `renderMarquee`, `announce`, and `clear`.
- Produces: `createCanvasMotion({ reducedMotion })` with `layout`, `snap`, `rollback`, `enter`, and `exit`.

- [ ] **Step 1: Add failing browser-source tests for chrome and input bindings**

Assert eight named handles exist only in the chrome layer, handles use `aria-label`, pointer events use capture, Space enters pan mode, Escape cancels an active gesture or clears an idle selection, Shift selection is passed to the controller, double-clicking an annotation enters editing, and editing suppresses movement.

- [ ] **Step 2: Add failing interaction tests for marquee and missing-object cleanup**

Verify marquee selection uses object bounds, additive marquee respects Shift, and `removeMissing` clears deleted refs without clearing unrelated selection.

- [ ] **Step 3: Run focused tests and verify failure**

Run: `node --test tests/canvas-interaction.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: FAIL on missing chrome and event bindings.

- [ ] **Step 4: Implement one board-level chrome layer**

Create one absolutely positioned layer above canvas objects. Render one shared selection rectangle for multi-selection, eight buttons for resize handles, guide lines, measurement chips, and a polite live region. Chrome positioning reads controller bounds; it never alters object DOM or Scene.

- [ ] **Step 5: Bind delegated events in `index.html`**

Use pointer delegation from `#board`, `setPointerCapture`, and current DOM data attributes to resolve object refs. A pointerdown on empty canvas begins marquee; Space-pointerdown begins viewport pan; a pointerdown on content selects and begins movement in the same gesture. A delegated `dblclick` on annotation text enters the controller's editing phase, focuses the text surface, and prevents move/resize until blur, explicit completion, or Escape returns to object selection.

- [ ] **Step 6: Implement motion without affecting pointer tracking**

Pointer previews have no easing. Use motion only for 120 ms snap completion, 180–240 ms durable FLIP layout, rollback, object entry, and object exit. Return resolved promises immediately under reduced motion.

- [ ] **Step 7: Run focused tests**

Run: `node --test tests/canvas-interaction.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add web/index.html web/interaction-chrome.js web/canvas-motion.js src/web/server.ts tests/canvas-interaction.test.mjs tests/web-smoke.test.mjs
git commit -m "feat: add direct canvas manipulation"
```

---

### Task 8: Commit gestures safely and recover revision conflicts

**Files:**
- Create: `web/canvas-commit.js`
- Create: `tests/canvas-commit.test.mjs`
- Modify: `web/index.html`
- Modify: `src/web/server.ts`
- Modify: `tests/web-smoke.test.mjs`

**Interfaces:**
- Produces: `createCanvasCommitter({ fetchScene, postCompose, postAnnotate, applyDurableScene, rollback, announce })`.
- Produces: `commitLayoutGesture({ action, baseRevision, originalLayouts, layoutUpdates })`.
- Produces: `patchAnnotation({ id, patch, baseRevision })`.
- Guarantees: one retry only when every target layout still equals its gesture-start layout.

- [ ] **Step 1: Write failing success, no-op, and conflict tests**

```js
test("retries once when revision changed but target layouts did not", async () => {
  const harness = conflictHarness({ targetChanged: false });
  const committer = createCanvasCommitter(harness.options);
  const result = await committer.commitLayoutGesture(harness.gesture);
  assert.equal(harness.composeCalls.length, 2);
  assert.equal(harness.composeCalls[1].expected_revision, harness.latestScene.revision);
  assert.equal(result.status, "ok");
});

test("rolls back when the same target changed concurrently", async () => {
  const harness = conflictHarness({ targetChanged: true });
  const committer = createCanvasCommitter(harness.options);
  await assert.rejects(() => committer.commitLayoutGesture(harness.gesture), /layout_conflict/);
  assert.equal(harness.rollbacks.length, 1);
  assert.equal(harness.composeCalls.length, 1);
});
```

- [ ] **Step 2: Run tests and verify module-not-found failure**

Run: `node --test tests/canvas-commit.test.mjs`  
Expected: FAIL because the commit client does not exist.

- [ ] **Step 3: Implement explicit optimistic commit flow**

POST one batch with `expected_revision`. On HTTP 409, fetch Scene, compare each original layout by object kind and ID, retry once if all match, otherwise call rollback and announce the conflict. Do not retry validation, not-found, or second-conflict errors.

- [ ] **Step 4: Wire controller finish and text edit commit**

Connect `onCommit` to `commitLayoutGesture`. Keep preview transforms until a durable scene response or matching WebSocket event arrives. Connect annotation blur or explicit completion to `patchAnnotation`; Escape restores the pre-edit text without a request.

- [ ] **Step 5: Run focused tests**

Run: `node --test tests/canvas-commit.test.mjs tests/canvas-interaction.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add web/canvas-commit.js web/index.html src/web/server.ts tests/canvas-commit.test.mjs tests/web-smoke.test.mjs
git commit -m "feat: persist canvas gestures safely"
```

---

### Task 9: Reflow from cached render payloads and add the floating inspector

**Files:**
- Create: `web/visual-render-cache.js`
- Create: `tests/visual-render-cache.test.mjs`
- Modify: `web/index.html`
- Modify: `tests/web-smoke.test.mjs`

**Interfaces:**
- Produces: `createVisualRenderCache()` with `remember(id, payload)`, `get(id)`, `remove(id)`, and `reflow(id, layout, renderer)`.
- Consumes: existing `reconcilePlotViewport` and retained artifact identity.
- Produces: inspector edits that use the Task 8 commit client rather than mutating DOM as durable state.

- [ ] **Step 1: Write failing render-cache tests**

```js
test("reflows from the last payload without fetching visual data", () => {
  const cache = createVisualRenderCache();
  cache.remember("orders", renderedPayload());
  const calls = [];
  cache.reflow("orders", { x: 0, y: 0, w: 640, h: 360 }, (payload, layout) => calls.push({ payload, layout }));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].layout.w, 640);
  assert.equal(cache.get("orders").result.rows, renderedPayload().result.rows);
});
```

- [ ] **Step 2: Add failing web tests for query-free layout handling and floating inspector**

Assert the layout event path calls cached reflow only for resized visuals, never calls `/api/visual/:id`, and the inspector is absolutely/fixed positioned over the viewport rather than changing the main grid columns. Assert technical IDs are confined to a collapsed diagnostics section.

- [ ] **Step 3: Run tests and verify failure**

Run: `node --test tests/visual-render-cache.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: FAIL because cached reflow and the overlay inspector are absent.

- [ ] **Step 4: Store successful render payloads and reflow after resize**

Remember only rendered payloads. During pointer resize, scale the current content as preview. After commit, regenerate Plot dimensions from cached rows/config and pass the resulting SVG through `reconcilePlotViewport`; do not call `render(id)` or fetch data. A move updates only layout.

- [ ] **Step 5: Implement type-specific final sizing**

- Plot: recalculate axes and reconcile marks.
- Annotation: remove preview scale and rewrap at final width.
- KPI: select a bounded semantic size class from final bounds.
- Table: preserve readable cells and enable internal overflow.

- [ ] **Step 6: Implement the floating inspector**

Show it only for explicit details or selection. Include X, Y, W, H inputs; annotation variant/alignment controls; multi-selection align/distribute actions; and a collapsed diagnostics section. Commit numeric changes on Enter or blur through the same atomic gesture path.

- [ ] **Step 7: Make fit view account for every visible object**

Compute fit bounds from Visual and Annotation layouts plus connector extents. Add a browser-source regression that the fit path consumes object-view bounds rather than only `scene.visuals`; keep Reset view at zoom 1 with no persisted selection.

- [ ] **Step 8: Run focused and retained-identity tests**

Run: `node --test tests/visual-render-cache.test.mjs tests/render-reconciler.test.mjs && npm run build:core && node --test tests/web-smoke.test.mjs`  
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add web/visual-render-cache.js web/index.html tests/visual-render-cache.test.mjs tests/web-smoke.test.mjs
git commit -m "feat: reflow canvas objects without queries"
```

---

### Task 10: Complete accessibility, persistence, and real-browser acceptance

**Files:**
- Modify: `web/index.html`
- Modify: `tests/web-smoke.test.mjs`
- Modify: `tests/runtime.test.mjs`
- Modify: `tests/persistence.test.mjs`
- Modify: `docs/acceptance/2026-09-09-m0-m1.md`

**Interfaces:**
- Verifies all interfaces produced by Tasks 1–9.
- Produces no new product contract.

- [ ] **Step 1: Add failing accessibility and persistence regressions**

Cover keyboard-focusable objects, named resize handles, live status region, reduced-motion branches, annotation layout/style restart round-trip, atomic mixed-object history input, and undo/redo of a layout batch.

- [ ] **Step 2: Run the new regressions and verify failure**

Run: `npm run build:core && node --test tests/web-smoke.test.mjs tests/runtime.test.mjs tests/persistence.test.mjs`  
Expected: FAIL only on unfinished accessibility or persistence behavior.

- [ ] **Step 3: Finish accessibility behavior**

Ensure every object exposes type and title, selection is not color-only, resize handles are reachable after object focus, the toolbar follows the selected object in reading order, and error/conflict messages use a polite live region. Under reduced motion, skip transform/scale animations and keep state opacity changes.

- [ ] **Step 4: Run the complete automated verification**

Run: `npm run verify:core && git diff --check`  
Expected: contract validation, TypeScript build, every Node test, and whitespace validation pass with zero failures.

- [ ] **Step 5: Run isolated real-browser acceptance**

Start the current branch against a temporary `OPENBOARD_ROOT` and unused port. In a real desktop browser:

1. confirm visuals and annotations are frameless by default;
2. select without revision change;
3. drag one visual and confirm exactly one revision;
4. resize it and confirm axes reflow with no `/api/visual/:id` request;
5. Shift-select a visual and annotation, move them, and confirm one revision/history record;
6. verify edge, center, equal-gap, and grid snapping at 80%, 100%, and 150% zoom;
7. cancel an active gesture with Escape;
8. patch annotation text and semantic style;
9. trigger both safe-retry and rollback conflict branches;
10. reload and restart the server, then confirm every durable layout and annotation returns;
11. confirm retained chart nodes survive move and supported resize reflow;
12. confirm console errors and warnings are zero.

- [ ] **Step 6: Record exact evidence**

Append the final test count, browser viewport, revision transitions, object IDs, request evidence, persistence restart result, and screenshot paths to `docs/acceptance/2026-09-09-m0-m1.md`. Do not mark an item passed without observed evidence.

- [ ] **Step 7: Run final verification after documentation changes**

Run: `npm run verify:core && git diff --check && git status --short --branch`  
Expected: all checks pass and only the intended acceptance documentation is uncommitted.

- [ ] **Step 8: Commit**

```bash
git add web/index.html tests/web-smoke.test.mjs tests/runtime.test.mjs tests/persistence.test.mjs docs/acceptance/2026-09-09-m0-m1.md
git commit -m "test: accept frameless narrative canvas"
```

---

## Completion Criteria

- `npm run verify:core` passes.
- The MCP tool count remains 10.
- Existing scenes load without migration.
- Default canvas objects have no persistent card surface.
- Selection and preview gestures do not mutate Scene.
- Each completed gesture creates exactly one revision and history record.
- Visual and annotation batches commit atomically.
- Drag and resize issue no DuckDB query.
- Final-size chart reflow uses cached payloads and retained reconciliation.
- Annotation create and patch semantics are explicit and tested.
- Conflict handling never silently overwrites concurrent layout changes.
- Reload and restart restore every durable layout and annotation style.
- Real-browser console output contains zero errors and zero warnings.
