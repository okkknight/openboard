# LC2 Phase 4 — Spatial construction

`layout.changed` now reloads only durable scene metadata and applies geometry to retained cards with a short FLIP-style transform. It does not call `render()` or fetch `/api/visual/*`, so unaffected cards keep their existing SVG roots and data query artifacts. Reduced-motion applies the final geometry directly.

`npm run verify:core` passed on 2026-09-14: contracts validated and 103 tests passed, 0 failed. The browser smoke test asserts the layout event routes to metadata + layout application rather than `reloadScene()`.
