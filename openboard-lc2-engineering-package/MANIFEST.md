# Package Manifest

## Root guidance

- `README.md` — scope and entry point.
- `STATUS.md` — frozen decisions and package status.
- `AGENTS_LC2.md` — implementation behavior constraints.
- `CODEX_START_PROMPT.md` — direct handoff prompt.
- `PHASE_GATES.md` — hard gates between phases.

## Source audit bundle and currency

- `source-audits/README.md` — required currency and authority guide.
- `source-audits/CURRENT_IMPLEMENTATION_REPORT.md` — historical pre-LC0/LC1 runtime snapshot.
- `source-audits/CURRENT_IMPLEMENTATION_MAP.txt` — historical pre-LC0/LC1 runtime map.
- `source-audits/RENDERER_IMPLEMENTATION_REPORT.md` — renderer-boundary audit; verify against current code in Phase 0.
- `source-audits/RENDERER_DOM_MAP.txt` — renderer DOM map paired with the renderer audit.

## Design and plan

- `docs/specs/2026-09-14-openboard-lc2-design.md`
- `docs/plans/2026-09-14-openboard-lc2-implementation-plan.md`

## Per-phase briefs

- `phases/00-baseline.md`
- `phases/01-identity-contract.md`
- `phases/02-retained-reconciliation.md`
- `phases/03-motion-grammar.md`
- `phases/04-spatial-construction.md`
- `phases/05-cross-mark-transitions.md`
- `phases/06-choreography-hardening.md`

## Contracts

- `contracts/identity-contract.md`
- `contracts/render-artifact-v2.schema.json`
- `contracts/render-operation.schema.json`
- `contracts/motion-grammar.md`
- `contracts/transition-matrix.md`

## Verification

- `tests/acceptance-matrix.md`
- `tests/e2e-scenarios.md`
- `tests/performance-and-race-tests.md`
- `scripts/validate_package.py`
