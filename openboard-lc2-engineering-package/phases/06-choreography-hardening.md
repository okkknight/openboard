# Phase 6 — Construction Choreography and Hardening

## Goal

Make LC0/LC1 semantic construction and LC2 visual/spatial construction operate as one coherent system.

## Required work

- WorkSession commit must converge retained working DOM to durable state without replaying entrance construction.
- WorkSession cancel must not corrupt durable scene.
- simultaneous spatial + visual motion must not flicker/race.
- implement motion cancellation/queue rules per visual generation.
- run E2E scenarios and performance probes.
- re-run all V1/open-grammar regressions.
- create `LC2_IMPLEMENTATION_REPORT.md`.

## Final experience rule

The user should be able to watch the canvas become the analysis. The system must never intentionally wait for a complete final state merely to replay it as animation.
