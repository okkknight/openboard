# Full LC2 Phase Gates

A phase is not complete because the UI “looks better.” It is complete only when the evidence below exists.

## Phase 0 — Baseline & Conformance

**Gate:**
- all existing tests pass before LC2 changes;
- current `replaceChildren` / animation / WorkSession paths are documented against the renderer audit and current source;
- the known pre-LC0/LC1 status of `CURRENT_IMPLEMENTATION_*` is recorded as expected historical drift, not treated as a source mismatch;
- a new branch/worktree is used;
- no production behavior change yet.

## Phase 1 — Identity Contract

**Gate:**
- `CompiledMark.id` reaches the browser artifact;
- Plot marks have explicit `identity_mode` and deterministic identity fields;
- primitive values have deterministic keys;
- identity collision/null/type tests pass;
- row position is never used as the durable key unless the spec explicitly declares an index-only visual and marks it non-retainable;
- browser can inspect mark/layer/datum/series keys without parsing geometry or ARIA labels.

## Phase 2 — Retained Reconciliation

**Gate:**
- stable SVG root survives compatible visual updates;
- stable mark-layer group survives compatible updates;
- same-key bar/dot/rule/text/primitive nodes survive (`===`);
- removed keys execute EXIT before removal;
- new keys execute ENTER;
- updated geometry is applied to old nodes;
- axes may be replaced as a subtree;
- stale generation response test passes;
- normal compatible updates no longer use whole SVG replacement.

## Phase 3 — Motion Grammar

**Gate:**
- motion is triggered from ENTER/UPDATE/EXIT operations, not from “render finished” signatures;
- bar, dot, rule, text, arc, line, and area have explicit strategies/fallbacks;
- WorkSession preview motion is enabled;
- reduced-motion test passes;
- no fake delay or staged playback exists;
- large mark counts cap/disable stagger.

## Phase 4 — Spatial Construction

**Gate:**
- layout-only change does not call full `reloadScene()` for unaffected visuals;
- retained cards move/resize continuously using lightweight geometry interpolation/FLIP;
- newly derived visual can originate spatially from parent visual context;
- card creation/removal has a defined motion and reduced-motion fallback;
- plot contents are not re-queried solely because a card moved.

## Phase 5 — Cross-Mark Transition

**Gate:**
- transition planner receives current mark family, next mark family, and shared identity;
- same-family strategy is preferred;
- supported cross-family strategy is deterministic;
- unsupported pairs use EXIT + ENTER, never a hard `replaceChildren` cut;
- bar -> pie/donut produces a visible transition with stable semantic keys;
- no arbitrary path morph promise is introduced.

## Phase 6 — Choreography & Hardening

**Gate:**
- a multi-step 5s+ analysis shows working visual -> first marks -> later semantic patch -> derived visual -> annotation -> commit;
- visual construction and spatial construction overlap safely without race/flicker;
- cancellation leaves durable scene unchanged;
- stale browser response cannot rewind the canvas;
- performance budgets in the spec are measured;
- all existing tests and all LC2 tests pass;
- `LC2_IMPLEMENTATION_REPORT.md` is complete.
