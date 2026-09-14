# Phase 5 — Cross-Mark Transitions

## Goal

Give representation changes continuity without requiring arbitrary geometry morphing.

## Required transition planner

Input: current family, next family, shared identity, geometry metadata, motion preference.

Required initial pairs:

- bar <-> dot;
- bar <-> arc;
- bar <-> line;
- same-family strategies delegated to Phase 3;
- unsupported pair -> EXIT + ENTER.

## Important constraint

Do not implement pair-specific chart templates. Strategies operate on mark families and shared identities.

## Acceptance

Bar -> pie/donut on same `channel` data must visibly transition rather than hard-swap the visual subtree.
