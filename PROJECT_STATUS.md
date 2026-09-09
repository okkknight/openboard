# Project status at handoff

## Already implemented in this package

- frozen V1 design and non-goals;
- JSON contracts for Scene, nine MCP tools, tool output envelope and live scene events;
- sample CSV and interaction trace;
- starter `SceneStore` with:
  - in-place visual patch;
  - visual clone + `derived_from`;
  - revision conflict checks;
  - immutable patch path guard;
  - mark add/remove with duplicate-id guard;
- starter QuerySpec compiler with:
  - identifier quoting;
  - filter value parameterization;
  - common filters;
  - time-grain dimensions;
  - aggregate/raw-expression measures;
  - sort and limit;
  - raw SQL/structured-query exclusivity;
- 9 passing core behavior tests in the packaged environment.

## Not implemented yet

This package is **not** the finished M0 application. Codex should implement the plan from Task 1 onward, preserving tested starter behavior.

Missing major pieces:

- history persistence/checkpoint/fork semantics;
- dataset discovery/profile cache;
- DuckDB Node Neo adapter;
- render-limit enforcement;
- deterministic observation engine;
- Observable Plot compiler;
- runtime orchestration/event bus/persistence;
- MCP v2 server registration;
- browser spatial viewport + WebSocket updates;
- M0/M1 end-to-end acceptance tests.

## First recommended Codex action

Run:

```bash
npm run verify:core
```

Then read the spec and implementation plan and start Task 1 under TDD.
