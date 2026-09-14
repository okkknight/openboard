# LC2 Agent Instructions

These instructions apply while implementing Full LC2.

## Authority order

1. This LC2 package for LC2-specific behavior.
2. Original V1 spec for unchanged system architecture.
3. Current repository source, tests, `PROJECT_CONTEXT.md`, and `LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md` for present behavior.
4. Source audits, using the currency classification in `source-audits/README.md`.

Do not preserve implementation drift merely because it already exists.

`CURRENT_IMPLEMENTATION_REPORT.md` and `CURRENT_IMPLEMENTATION_MAP.txt` are intentionally retained historical pre-LC0/LC1 evidence. They must not override the current WorkSession implementation or be quoted as current architecture.

## Behavioral rules

- Work phase-by-phase. Do not begin the next phase until its gate passes.
- TDD for behavior changes: failing test, verify failure, minimal implementation, full verification.
- Keep Observable Plot. Do not replace it with a home-grown plotting engine.
- Do not build a generic DOM diff framework.
- Do not turn LC2 into “better entrance animations.”
- Do not invent new chart templates.
- Do not use timeouts, sleeps, or staged replay to simulate construction.
- Preserve VisualSpec / open grammar compatibility.
- Preserve WorkSession atomic durable commit semantics.
- Any asynchronous render response must be generation-checked before paint.
- Any retained node must have an explicit identity; array position is not identity.
- If identity cannot be proven for a mark, use replace-at-layer or exit+enter, never guess.
- Prefer semantic keys from fields (`channel`, `product`, `date`, series dimensions) over row index.
- Motion must support `prefers-reduced-motion`.
- Never expose chain-of-thought. Show only real construction actions/state.

## Architecture discipline

Keep responsibilities separate:

- Runtime/Artifact compiler: identity metadata, generation, render payload.
- Browser reconciler: stable nodes, keyed diff, stale-response rejection.
- Motion engine: transforms render operations into short visible transitions.
- Spatial engine: card birth/move/resize/remove; does not own plot semantics.
- Transition planner: same-mark and cross-mark strategy selection.

Do not place all LC2 behavior into `web/index.html` without decomposition. The existing single-file browser can remain the entry page, but LC2 logic should be extracted into focused browser modules if the project build supports module imports; otherwise isolate it into clearly separated functions/files according to the repository's current static serving model.
