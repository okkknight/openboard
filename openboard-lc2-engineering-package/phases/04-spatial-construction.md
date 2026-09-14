# Phase 4 — Spatial Construction

## Goal

Make the canvas itself grow with analysis while preserving retained plot DOM.

## Required changes

- layout.changed updates only affected cards;
- remove full-scene render/requery from layout-only path;
- retain card nodes across move/resize;
- implement FLIP-style geometry continuity;
- use `derived_from` as optional spatial origin for new analysis views;
- define card exit behavior;
- reduced-motion fallback.

## Required proof

Moving one card produces zero DuckDB query calls and leaves unrelated SVG roots untouched.
