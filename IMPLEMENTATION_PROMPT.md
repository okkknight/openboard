# Codex implementation prompt

Implement Data Canvas from this repository.

First read `AGENTS.md`, then the V1 design spec and M0/M1 implementation plan. Treat them as requirements, not inspiration.

Start with M0. Use TDD. Do not expand scope. The goal is not to produce a polished BI application; the goal is to prove the AI brush loop:

`Codex MCP call -> Scene mutation -> DuckDB query -> Observable Plot render -> browser live update -> structured result back to Codex`

Important constraints:

- local-first only;
- no HTML generation as an analysis mechanism;
- patch existing visuals in place;
- no silent sampling;
- QuerySpec before raw SQL;
- Scene remains renderer-independent;
- UI should remain visually minimal and primarily read-only;
- no user/auth/cloud/plugin/dashboard-builder work.

After each implementation task, run the exact verification commands in the plan. Stop and fix regressions before continuing.
