# Codex Start Prompt — Full LC2

Implement **Full LC2: Retained & Spatial Construction Runtime** in the current OpenBoard repository.

Before changing code, read in this exact order:

1. repository `AGENTS.md`
2. original V1 design spec
3. repository `PROJECT_CONTEXT.md`
4. repository `LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md`
5. this package `AGENTS_LC2.md`
6. `source-audits/README.md`
7. `source-audits/RENDERER_IMPLEMENTATION_REPORT.md`
8. `source-audits/RENDERER_DOM_MAP.txt`
9. `docs/specs/2026-09-14-openboard-lc2-design.md`
10. `PHASE_GATES.md`
11. `docs/plans/2026-09-14-openboard-lc2-implementation-plan.md`

`source-audits/CURRENT_IMPLEMENTATION_REPORT.md` and `CURRENT_IMPLEMENTATION_MAP.txt` are pre-LC0/LC1 history. Consult them only after the current materials above and never use them as the source of current WorkSession behavior.

## Non-negotiable goal

The final product must visibly construct analysis rather than display final SVGs after waiting.

Do not interpret that as “add more animation.” The required chain is:

```text
real semantic operation
 -> RenderArtifact generation
 -> identity-aware reconciliation
 -> ENTER / UPDATE / EXIT
 -> short mark-specific motion
 -> retained final state
```

## Implementation sequence

Complete all phases in order:

- Phase 0 Baseline / conformance
- Phase 1 Identity Contract
- Phase 2 Retained Reconciliation
- Phase 3 Motion Grammar
- Phase 4 Spatial Construction
- Phase 5 Cross-Mark Transitions
- Phase 6 Choreography / hardening / E2E

Do not stop after Phase 2 and call LC2 complete.

At every phase:

1. write the required failing tests;
2. run them and confirm the intended failure;
3. implement the smallest architecture that satisfies the phase spec;
4. run phase tests + regression tests;
5. produce the phase evidence required by `PHASE_GATES.md`;
6. commit with a phase-specific message.

## Hard prohibitions

Do not:

- replace Observable Plot;
- introduce a generic virtual DOM;
- introduce Redux/new frontend framework/new database;
- introduce DuckDB row streaming;
- use `setTimeout`, sleeps, delayed reveal, or precomputed replay to fake construction;
- key marks by current array position;
- use ARIA family labels as datum identity;
- require arbitrary path morphing;
- create chart-type-specific LC2 code such as `animatePieChart` as the architecture.

## Required end-state proof

The final implementation report must demonstrate all of the following in the actual browser:

1. Bar A/B/C -> A/C/D keeps A and C DOM nodes (`oldNode === currentNode`).
2. B performs EXIT and is removed only after its exit motion finishes.
3. D performs ENTER from its construction origin.
4. Value change of A performs UPDATE on the retained node.
5. A line series keeps series-level identity across compatible data changes.
6. Primitive arc slices retain per-datum identity across radius/angle updates.
7. WorkSession previews use motion; they are no longer globally animation-disabled.
8. A stale render response is discarded and cannot paint over a newer generation.
9. Layout-only change moves/resizes retained cards without requerying/rerendering unrelated visuals.
10. A derived visual appears from its parent analysis context and then constructs its marks.
11. Bar -> pie uses a defined cross-mark strategy (exit+enter is acceptable); no hard cut.
12. `prefers-reduced-motion` produces the same semantic states without decorative motion.
13. Existing bar/line/area/dot/arc/path/mixed-layer visual grammar regression tests pass.
14. No normal compatible Plot update uses whole-SVG `replaceChildren(newSvg)` as its primary path.

Finish by creating `LC2_IMPLEMENTATION_REPORT.md` with phase-by-phase evidence, test commands/results, DOM identity evidence, race tests, performance notes, known limitations, and any remaining V1 drift in touched areas.
