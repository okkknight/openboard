# LC2 Phase 3 — Render-operation motion

## Implementation

- Added a browser motion grammar that maps ENTER, UPDATE, and EXIT operations to bar, dot, rule, text, arc, line, area, or deterministic fade fallback strategies.
- Reconciliation invokes motion callbacks on the retained nodes. UPDATE captures old numeric geometry before the target attributes are copied; EXIT waits for the motion promise before removal.
- ENTER stagger is limited to the first six nodes and caps at 120 ms. Reduced-motion still reconciles semantic state but applies no decorative animation.
- Every render begins a new per-visual motion generation, cancelling prior Web Animations and ignoring stale animation frames. WorkSession previews use this same route.

## Evidence

`npm run verify:core` passed on 2026-09-14: contracts validated and 102 tests passed, 0 failed. Focused tests cover the operation-to-family strategy table and the deterministic fallback path.
