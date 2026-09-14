# OpenBoard / Data Canvas — Full LC2 Engineering Package

This package is the implementation handoff for **LC2: Retained & Spatial Construction Runtime**.

It assumes LC0/LC1 already exist: WorkSession, Working Overlay, ordered work events, draft visuals, render artifact caching, and semantic construction. The renderer audits in `source-audits/` are evidence for the LC2 rendering boundary; their currency is classified in `source-audits/README.md` and must be checked against the current repository during Phase 0.

## Audit currency

- `RENDERER_IMPLEMENTATION_REPORT.md` and `RENDERER_DOM_MAP.txt` describe the retained-card/rebuilt-SVG boundary that LC2 addresses. Reconfirm their cited paths in Phase 0 before relying on them.
- `CURRENT_IMPLEMENTATION_REPORT.md` and `CURRENT_IMPLEMENTATION_MAP.txt` predate LC0/LC1. They are historical evidence of the drift LC0/LC1 corrected, not a description of the current WorkSession runtime.
- Current runtime behavior is determined by the repository source and tests, with `PROJECT_CONTEXT.md` and `LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md` as the current handoff documents.

## Product target

The canvas must stop behaving like a result viewer and start behaving like an active drawing surface:

```text
Codex operation
  -> semantic Scene change
  -> retained render reconciliation
  -> visible mark motion
  -> spatial canvas motion
  -> next semantic operation
```

**Construction is execution, not playback.** No fake progress, delayed reveal, or replay of a result that was already fully computed.

## LC2 scope

LC2 is delivered as six dependent phases:

1. **Identity Contract** — preserve `mark.id`, derive deterministic datum/series keys, reject ambiguous identity.
2. **Retained Reconciliation** — stable SVG root, keyed ENTER / UPDATE / EXIT, stale-render protection, axes replaceable as a subtree.
3. **Motion Grammar** — mark-specific construction motion tied to real render operations.
4. **Spatial Construction** — retained card layout motion, derived-view birth, no layout-triggered full-scene rerender.
5. **Cross-Mark Transition** — semantic transitions between mark families with safe fallbacks; no requirement for arbitrary path morphing.
6. **Construction Choreography & Hardening** — work-session integration, cancellation, reduced motion, performance budgets, end-to-end proof.

## What LC2 does not do

- no DuckDB row streaming;
- no arbitrary SVG virtual DOM;
- no replacement of Observable Plot;
- no new BI layer, dashboard builder, or chart-template system;
- no general physics engine;
- no arbitrary path-to-path morph requirement;
- no fake model-thought UI.

## Start here

1. Read `CODEX_START_PROMPT.md`.
2. Read `source-audits/README.md`, then the renderer audit and DOM map. Read `CURRENT_IMPLEMENTATION_*` only as explicitly historical context.
3. Read `docs/specs/2026-09-14-openboard-lc2-design.md`.
4. Execute `docs/plans/2026-09-14-openboard-lc2-implementation-plan.md` phase by phase.
5. Do not skip phase gates in `PHASE_GATES.md`.

## Critical ground truth

The current implementation retains the card shell, but **rebuilds the plot SVG, axes, statistical marks, and primitive nodes** on every completed render. `CompiledMark.id` is currently dropped in the browser adapter, and the browser has no stable source-datum identity. A safe direct SVG diff is therefore not the starting point. The selected seam is the existing **RenderArtifact boundary**.

## Completion definition

LC2 is complete only when all of these are true:

- same logical datum retains the same DOM node across compatible updates;
- ENTER / UPDATE / EXIT are observable and tested;
- ordinary plot updates no longer use whole-SVG replacement as the primary path;
- work previews use real construction motion;
- layout-only changes do not reload/render unrelated visuals;
- stale responses cannot overwrite newer visual generations;
- derived visuals appear spatially from their analysis context;
- cross-mark changes use a transition strategy or a defined exit+enter fallback;
- existing open Visual Grammar still works;
- a recorded end-to-end scenario demonstrates visible construction from first semantic state to durable commit.
