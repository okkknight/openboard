# Codex implementation prompt

Implement Data Canvas from this repository.

First read `AGENTS.md`, then the V1 design spec and M0/M1 implementation plan. Treat them as requirements, not inspiration.

Start with M0. Use TDD. Do not expand scope. The goal is not to produce a polished BI application; the goal is to prove the AI brush loop:

For ordinary one-step edits:

`Codex MCP call -> Scene mutation -> DuckDB query -> Observable Plot render -> browser live update -> structured result back to Codex`

For multi-step/new-visual analysis, use Live Construction:

`work.begin -> early draft overlay -> real inspect/query/render activities -> semantic work patches -> work.commit (one durable Scene mutation) -> browser live update`

Important constraints:

- local-first only;
- no HTML generation as an analysis mechanism;
- patch existing visuals in place;
- no silent sampling;
- QuerySpec before raw SQL;
- Scene remains renderer-independent;
- UI should remain visually minimal and primarily read-only;
- no user/auth/cloud/plugin/dashboard-builder work.
- do not simulate progress or thought with timers, staged playback, fake text, or animation; visible work states must come from real runtime operations;
- keep WorkSession ephemeral and keep durable Scene/history clean until `work.commit`;
- use the same `work_id` for all related analysis operations and cancel incomplete work rather than persisting a draft.

After each implementation task, run the exact verification commands in the plan. Stop and fix regressions before continuing.
