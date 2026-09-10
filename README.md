# OpenBoard

OpenBoard is a lightweight local visualization runtime designed for AI agents such as Codex. Its V1 product/runtime model is named **Data Canvas**.

**Product idea:** data is paint; Data Canvas is the canvas and brush. Codex should not generate HTML dashboards. It should inspect existing local datasets, create or patch a persistent visualization scene, observe the result, and continue reasoning.

## What this package contains

This is the **local V1 runtime** for Data Canvas. It includes:

- frozen product/architecture spec;
- Scene, Query and Visual contracts;
- the 9-tool MCP surface;
- a TDD-oriented M0/M1 implementation plan;
- a tested SceneStore, history/persistence layer, and deterministic observations;
- DuckDB-backed QuerySpec/raw read-only query execution;
- live spatial browser canvas with WebSocket updates;
- sample CSV data and expected interaction traces;
- Codex instructions and acceptance tests.

The runtime keeps the durable Scene independent from disposable Plot output and never stores generated DOM/HTML in scene history.

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

After unpacking, install the pinned dependencies and verify the runtime:

```bash
npm install
npm run verify:core
```

In an environment that already has TypeScript 5.8.3 available, `verify:core` can also run before dependency installation because the starter core itself does not import DuckDB/MCP/Plot.

This validates the contracts, TypeScript build, core behavior, DuckDB integration, MCP adapter, persistence, WebSocket server, and M0/M1 workflow.

## Core rule

> Codex never generates interface code during analysis. Codex changes Scene state. The runtime turns Scene state into queries and visuals.
