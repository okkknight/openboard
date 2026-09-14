# Phase 0 — Baseline and Conformance

## Goal

Freeze current behavior and verify the repository matches the supplied audits before LC2 changes.

## Required work

- Create/enter isolated worktree.
- Run current full test suite and build/typecheck/lint commands that exist in the repo.
- Confirm current paths named in the renderer audit still match.
- Add no production behavior.
- Create a short `LC2_BASELINE.md` in the repo with exact commands/results and any drift from the supplied audits.

## Gate

`PHASE_GATES.md` Phase 0 must pass before Phase 1.
