# Phase 2 — Retained Visual Reconciliation

## Goal

Replace whole-SVG swap as the normal compatible plot update path.

## Architecture

- retain stable SVG viewport root;
- generate next Plot geometry off-DOM/detached;
- extract keyed mark layers using Phase 1 identity;
- reconcile current and next by maps, not indexes;
- axes may be replaced as a subtree;
- use layer replacement for explicitly nonretainable marks;
- add per-visual generation guard and preferably abort older fetches.

## Required operations

ENTER, UPDATE, EXIT, replace-layer, replace-axes.

## Required tests

- old A === new A for A/B/C -> A/C/D;
- old C === new C;
- B removed only after exit completion hook;
- D new node;
- SVG root retained;
- axis replacement does not replace retained mark layer;
- primitive arc slice retained across compatible update;
- stale response rejected.
