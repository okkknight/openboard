# Source audit currency

This folder intentionally contains two different kinds of evidence. They are not interchangeable.

## Current LC2 renderer baseline

- `RENDERER_IMPLEMENTATION_REPORT.md`
- `RENDERER_DOM_MAP.txt`

These record the 2026-09-14 renderer audit: cards are retained while the SVG, axes, Plot marks, and primitive children are rebuilt. They identify the RenderArtifact boundary as the LC2 seam. Phase 0 must re-check the cited current paths before implementation; current source and tests win if they diverge.

## Historical LC0/LC1 drift record

- `CURRENT_IMPLEMENTATION_REPORT.md`
- `CURRENT_IMPLEMENTATION_MAP.txt`

These documents are pre-LC0/LC1. Their descriptions of render-before-visible-state and the absence of WorkSession are historical: they explain the drift that LC0/LC1 corrected. They must not be used to describe the present runtime.

For current runtime behavior, use repository source and tests first, then `PROJECT_CONTEXT.md` and `LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md`. Preserve these historical reports unchanged so the original evidence remains auditable.
