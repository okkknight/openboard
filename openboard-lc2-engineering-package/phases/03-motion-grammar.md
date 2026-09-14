# Phase 3 — Mark Motion Grammar

## Goal

Turn real reconciliation operations into visible drawing motion.

## Required families

bar/rect, dot/circle, rule, text, primitive arc, line, area.

## Rules

- motion attaches to ENTER/UPDATE/EXIT;
- no render-signature entrance system as the primary path;
- WorkSession previews are eligible for construction motion;
- motion cancellation on newer generation;
- reduced-motion fallback;
- bounded stagger for ENTER only;
- line/area may use crossfade when path morph is unsafe.

## Required tests

Test strategy selection independently from visual snapshots. Verify operations map to motion strategies and no fake timer sequence creates semantic steps.
