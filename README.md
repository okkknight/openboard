# OpenBoard

OpenBoard is a lightweight local visualization runtime designed for AI agents such as Codex. Its V1 product/runtime model is named **Data Canvas**.

**Product idea:** data is paint; Data Canvas is the canvas and brush. Codex should not generate HTML dashboards. It should inspect existing local datasets, create or patch a persistent visualization scene, observe the result, and continue reasoning.

## What this package contains

This is a **contract-first Codex engineering package** for V1. It includes:

- frozen product/architecture spec;
- Scene, Query and Visual contracts;
- the 9-tool MCP surface;
- a TDD-oriented M0/M1 implementation plan;
- a small tested core SceneStore scaffold;
- sample CSV data and expected interaction traces;
- Codex instructions and acceptance tests.

The scaffold intentionally does **not** pretend to be the finished renderer. The implementation plan wires the core to DuckDB, Observable Plot, MCP and the browser runtime.

## Frozen V1 stack

- Node.js 22+
- TypeScript
- DuckDB Node Neo (`@duckdb/node-api`)
- MCP TypeScript SDK v2 (`@modelcontextprotocol/server`)
- Zod v4
- Observable Plot (`@observablehq/plot`)
- browser WebSocket for live scene events
- JSON + JSONL persistence

## Quick orientation

Read these in order:

1. `AGENTS.md`
2. `docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md`
3. `contracts/tool-surface.json`
4. `docs/superpowers/plans/2026-09-09-data-canvas-m0-m1-implementation.md`
5. `IMPLEMENTATION_PROMPT.md`

## Core verification in this package

After unpacking, install the pinned dependencies and verify the starter core:

```bash
npm install
npm run verify:core
```

In an environment that already has TypeScript 5.8.3 available, `verify:core` can also run before dependency installation because the starter core itself does not import DuckDB/MCP/Plot.

This verifies the SceneStore/QuerySpec starter behavior and contract files. See `PROJECT_STATUS.md`: the full M0 application is intentionally still the first implementation milestone in the plan.

## Core rule

> Codex never generates interface code during analysis. Codex changes Scene state. The runtime turns Scene state into queries and visuals.
