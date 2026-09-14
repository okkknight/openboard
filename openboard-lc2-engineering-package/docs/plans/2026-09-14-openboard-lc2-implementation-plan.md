# OpenBoard Full LC2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert OpenBoard's final-SVG replacement renderer into an identity-aware retained construction runtime with mark motion, spatial construction, and safe cross-mark transitions.

**Architecture:** Extend the existing RenderArtifact boundary with deterministic identity metadata, keep Observable Plot as detached geometry producer, reconcile keyed layers into a stable browser viewport, attach motion to ENTER/UPDATE/EXIT operations, then add retained card spatial transitions and cross-mark strategies. Preserve LC0/LC1 WorkSession and V1 open Visual Grammar.

**Tech Stack:** TypeScript/Node runtime, existing vanilla browser client, Observable Plot 0.6.17, existing primitive SVG/D3-shape path, Web Animations API/requestAnimationFrame where already appropriate, current test stack.

**Spec:** `docs/specs/2026-09-14-openboard-lc2-design.md`

## Global Constraints

- Observable Plot stays.
- No generic virtual DOM.
- No DuckDB row streaming.
- No arbitrary path morph requirement.
- No fake construction via sleep/setTimeout/staged replay.
- Array position and ARIA family label are not identity.
- Durable Scene and WorkSession semantics remain compatible.
- Existing Visual Grammar remains compatible.
- Every asynchronous visual response is generation-checked before DOM mutation.
- Each phase must pass `PHASE_GATES.md` before the next begins.

---

### Task 1: Baseline and touched-area conformance

**Files:**
- Read: `source-audits/README.md`, then the renderer audit/DOM map; consult `CURRENT_IMPLEMENTATION_*` only as pre-LC0/LC1 history
- Read: repository `AGENTS.md`, V1 spec, renderer/runtime/browser files
- Create in repo: `LC2_BASELINE.md`

**Interfaces:**
- Consumes: current repository tests/build scripts and audit facts.
- Produces: verified baseline and list of any audit drift before LC2 code changes.

- [ ] **Step 1: Create isolated worktree/branch and record current commit.**
- [ ] **Step 2: Run the repository's current full test command and capture exact output.**
- [ ] **Step 3: Run existing typecheck/build/lint commands that are defined by package scripts.**
- [ ] **Step 4: Verify the audited `replaceChildren`, mark-id drop, RenderArtifact cache, WorkSession event sequence, and render-race paths still exist or record exact drift.**
- [ ] **Step 5: Write `LC2_BASELINE.md` with commands, results, and drift.**
- [ ] **Step 6: Commit only the baseline document if the repository workflow expects docs committed before implementation.**

### Task 2: Deterministic identity model

**Files:**
- Modify: `src/core/types.ts` or the repository's current render artifact/type home
- Modify: `src/render/plot-compiler.ts`
- Modify: `src/render/primitive-compiler.ts`
- Modify: browser adapter in `web/index.html` or extracted browser module
- Test: existing render/compiler tests plus new identity tests

**Interfaces:**
- Consumes: `VisualSpec.marks[].id`, query result dimensions/group fields, primitive compiled values.
- Produces: `MarkIdentityDescriptor`, canonical `render_key`, preserved `mark_id` in browser payload.

- [ ] **Step 1: Write failing tests proving row reorder/filter must preserve semantic keys and duplicate keys must be detected.**
- [ ] **Step 2: Run those tests and verify failure is due to absent identity contract.**
- [ ] **Step 3: Add canonical typed key serialization and mark identity descriptors without changing Scene persistence.**
- [ ] **Step 4: Add series-level identity tests for line/area and singleton behavior for one-series paths.**
- [ ] **Step 5: Extend primitive compiled values with deterministic per-value key metadata.**
- [ ] **Step 6: Preserve `CompiledMark.id` through the browser render payload; do not infer it from ARIA labels.**
- [ ] **Step 7: Add browser-level test/probe asserting mark id and render keys are observable to the reconciliation layer.**
- [ ] **Step 8: Run Phase 1 tests + full regression suite.**
- [ ] **Step 9: Produce Phase 1 gate evidence and commit `feat(renderer): add deterministic render identity contract`.**

### Task 3: Retained viewport and keyed reconciler

**Files:**
- Create: focused browser reconciliation module if static module loading permits, otherwise a clearly isolated renderer section/file
- Modify: `web/index.html`
- Modify: artifact/browser response type as needed
- Test: browser renderer/reconciliation tests

**Interfaces:**
- Consumes: current retained card/container, detached next Plot SVG, identity descriptors/render keys.
- Produces: stable SVG viewport, `RenderOperation[]`, keyed retained layers/nodes.

- [ ] **Step 1: Write failing DOM identity test for A/B/C -> A/C/D asserting retained SVG root and retained A/C nodes.**
- [ ] **Step 2: Run and verify current implementation fails because whole SVG is replaced.**
- [ ] **Step 3: Create a stable plot SVG viewport after first mount and split it into axis and mark/primitive ownership zones.**
- [ ] **Step 4: Generate next Plot geometry detached from the live viewport and annotate/extract keyed mark layers using Task 2 identity.**
- [ ] **Step 5: Implement O(N) keyed reconciliation maps producing ENTER/UPDATE/EXIT and layer/axis replacement operations.**
- [ ] **Step 6: Apply UPDATE by copying target geometry/style from next nodes into retained current nodes; do not replace retained compatible nodes.**
- [ ] **Step 7: Keep axes replaceable as a subtree so scale/tick complexity does not block mark retention.**
- [ ] **Step 8: Add primitive keyed reconciliation and test arc slice retention across innerRadius/angle changes.**
- [ ] **Step 9: Add per-visual request generation guard; optionally abort older requests, but always discard stale response before DOM write.**
- [ ] **Step 10: Add out-of-order response test.**
- [ ] **Step 11: Confirm normal compatible plot updates no longer call whole-SVG `replaceChildren(newSvg)` as the primary path.**
- [ ] **Step 12: Run Phase 2 gate + full regressions; commit `feat(renderer): retain and reconcile keyed visual nodes`.**

### Task 4: Render-operation motion grammar

**Files:**
- Create/modify: browser motion strategy module/section
- Modify: existing animation helpers in `web/index.html`
- Test: motion strategy unit tests and DOM transition completion tests

**Interfaces:**
- Consumes: `RenderOperation[]`, mark family, current/next geometry, reduced-motion preference, generation token.
- Produces: cancellable ENTER/UPDATE/EXIT motion promises.

- [ ] **Step 1: Write failing tests mapping bar/dot/rule/text/arc/line/area operations to explicit motion strategies.**
- [ ] **Step 2: Remove the assumption that WorkSession previews are globally animation-disabled; preserve reduced-motion behavior.**
- [ ] **Step 3: Implement bar/rect, dot/circle, rule, text, and arc strategies using retained nodes.**
- [ ] **Step 4: Implement line/area series motion with safe draw/fade/crossfade fallback when path morph is not guaranteed.**
- [ ] **Step 5: Implement bounded ENTER stagger with mark-count cutoff and total-stagger cap.**
- [ ] **Step 6: Make all motion cancellable/ignorable when a newer generation supersedes it.**
- [ ] **Step 7: Ensure no `sleep`, staged semantic replay, or fixed fake progress is used.**
- [ ] **Step 8: Run reduced-motion tests and Phase 3 gate; commit `feat(renderer): animate real render operations`.**

### Task 5: Spatial construction and layout isolation

**Files:**
- Modify: browser scene/layout event handling in `web/index.html` or extracted spatial module
- Modify: server event payload only if affected visual ids/derived origin data are missing
- Test: layout query-count and card identity/motion tests

**Interfaces:**
- Consumes: retained `article.visual-card`, layout patch, `derived_from`, affected visual ids.
- Produces: card move/resize/birth/exit motion without unrelated render/query.

- [ ] **Step 1: Write failing test showing current layout-only change causes broader reload/render than required.**
- [ ] **Step 2: Change layout event handling to mutate only affected retained card geometry.**
- [ ] **Step 3: Add query-count assertion proving layout-only change performs zero DuckDB queries.**
- [ ] **Step 4: Implement FLIP-style move/resize continuity for retained cards.**
- [ ] **Step 5: Implement new-card spatial birth; if `derived_from` exists and parent is present, originate near parent card, otherwise use a neutral local enter.**
- [ ] **Step 6: Implement card removal motion with reduced-motion immediate fallback.**
- [ ] **Step 7: Assert plot SVG and retained mark nodes survive card move/resize.**
- [ ] **Step 8: Run Phase 4 gate and regressions; commit `feat(canvas): add retained spatial construction`.**

### Task 6: Cross-mark transition planner

**Files:**
- Create/modify: transition planner module/section
- Modify: reconciler handoff when mark family changes
- Test: strategy matrix tests and bar->pie browser test

**Interfaces:**
- Consumes: old/new mark family, shared datum identity, old/new geometry metadata, motion preference.
- Produces: same-family update strategy, supported cross-family plan, or EXIT+ENTER fallback.

- [ ] **Step 1: Write failing planner tests for bar<->dot, bar<->arc, bar<->line, and unsupported pair fallback.**
- [ ] **Step 2: Implement planner as mark-family logic, not chart-type templates.**
- [ ] **Step 3: Implement bar<->dot semantic collapse/expand using shared keys.**
- [ ] **Step 4: Implement bar->arc and arc->bar as coordinated EXIT/ENTER using shared datum keys; do not require topology morph.**
- [ ] **Step 5: Implement bar<->line as coordinated exit/draw transition at datum/series granularity.**
- [ ] **Step 6: Ensure unsupported pair has visible, deterministic EXIT+ENTER rather than hard subtree swap.**
- [ ] **Step 7: Run actual bar->pie/donut transition in browser and record evidence.**
- [ ] **Step 8: Run Phase 5 gate; commit `feat(renderer): add semantic cross-mark transitions`.**

### Task 7: WorkSession choreography and durable convergence

**Files:**
- Modify: browser WorkSession/effective scene rendering path
- Modify: runtime only if artifact promotion metadata is insufficient
- Test: work preview/commit/cancel convergence tests

**Interfaces:**
- Consumes: ordered WorkSession semantic patches, retained render state, durable commit/cancel events.
- Produces: continuous construction with no replay at commit.

- [ ] **Step 1: Write failing test proving a working retained visual does not restart from entrance animation when the same artifact is promoted at commit.**
- [ ] **Step 2: Make work visual changes flow through the same retained reconciler and motion grammar as durable changes.**
- [ ] **Step 3: On commit, reconcile working state to durable state without clearing viewport or replaying construction.**
- [ ] **Step 4: On cancel, reconcile/remove working-only nodes and restore durable effective scene without history mutation.**
- [ ] **Step 5: Add generation/motion cancellation tests for rapid successive semantic patches.**
- [ ] **Step 6: Verify activity UI remains secondary and does not cover the plot as a large loading panel.**
- [ ] **Step 7: Run Phase 6 functional gate before performance/E2E hardening.**

### Task 8: End-to-end verification, performance, and conformance report

**Files:**
- Create in repo: `LC2_IMPLEMENTATION_REPORT.md`
- Test: all existing + LC2 suites

**Interfaces:**
- Consumes: completed phases and required E2E scenarios.
- Produces: fresh evidence that Full LC2 is complete or an explicit list of gaps.

- [ ] **Step 1: Run all repository unit/integration tests and capture counts/results.**
- [ ] **Step 2: Run typecheck/build/lint scripts defined by the repository.**
- [ ] **Step 3: Run E2E Scenario A and record `oldNode === newNode` evidence.**
- [ ] **Step 4: Run multi-step WorkSession Scenario B and record timestamps from first working state through commit.**
- [ ] **Step 5: Run bar->pie Scenario C and race Scenario D.**
- [ ] **Step 6: Run layout-only Scenario E and record DuckDB query count = 0.**
- [ ] **Step 7: Measure 10/100/1000 mark reconciliation and record observations without inventing universal performance claims.**
- [ ] **Step 8: Search code for forbidden fake-construction patterns (`sleep`, fake progress, staged replay) and document results.**
- [ ] **Step 9: Re-audit touched areas against V1 spec and list corrected/remnant drift.**
- [ ] **Step 10: Write `LC2_IMPLEMENTATION_REPORT.md` with architecture, test evidence, DOM identity proof, race evidence, performance notes, known limitations, and remaining drift.**
- [ ] **Step 11: Only if every phase gate passes, mark Full LC2 complete and commit `docs: record full LC2 verification`.**
