# Phase 1 — Identity Contract

## Goal

Make visual/mark/datum/series identity explicit at the RenderArtifact boundary.

## Production changes

- Extend runtime/compiled mark artifact with identity descriptors.
- Preserve `CompiledMark.id` through browser transport.
- Derive deterministic keys from semantic dimensions/group fields.
- Add per-value key metadata for primitive layers.
- Add an internal trusted Plot bridge that can tag generated layer/node output without exposing executable code in VisualSpec.

## Required tests

- reordering rows preserves keys;
- filtering preserves surviving keys;
- duplicate semantic keys are detected;
- string/number/null/date canonicalization;
- Plot mark id reaches browser;
- primitive datum key reaches browser;
- line/area key at series level;
- no array-index fallback for retainable marks.

## Exit evidence

Browser devtools/test DOM can display `data-mark-id` and `data-render-key` (or equivalent internal registry) without reading element order or ARIA family labels.
