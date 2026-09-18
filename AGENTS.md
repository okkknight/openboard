# AGENTS.md — Data Canvas implementation rules

You are implementing **Data Canvas**, a local AI-native visualization runtime.

## Mission

Given local data files, let Codex dynamically express data reasoning on a persistent visual canvas using a small MCP tool surface. A user should be able to say things such as:

- “show failure rate by channel”
- “only keep East China”
- “clone this and break it down by product”
- “overlay order volume and mark anomalous dates”
- “go back to the version before the product breakdown”

The visible result should update immediately without regenerating HTML or rebuilding a dashboard.

## Live Construction policy (LC0 + LC1)

For a request that creates a visual or needs more than one meaningful analysis operation, begin with `work.apply({ action: "begin" })` before invisible inspect/query work. Use the returned `work_id` for related `data.inspect`, `data.query`, `visual.create`, `visual.patch`, `visual.clone`, `canvas.compose`, and `canvas.annotate` calls.

- Once there is a real initial analysis intent, create an early draft visual. A draft may contain only title/intent; do not pretend it has a result.
- Emit a semantic patch only after a real new data, analysis, or expression state. Do not split axes, bars, labels, or animation frames merely to make motion.
- Runtime activity comes only from real inspect/query/render operations. Never send fake progress, “thinking”, or chain-of-thought narration to the canvas.
- Finish a successful multi-step operation with `work.apply({ action: "commit", work_id })`; if it cannot be completed, use `cancel`. Work patches are ephemeral until commit.
- Every chart mutation (`visual.create`, `visual.patch`, and `visual.clone`) requires the caller to begin an explicit WorkSession and pass its `work_id`; there is no implicit or single-step compatibility path. Multi-step analysis should use one explicit `work_id` from begin through commit/cancel.
- If the dataset schema is already known, create the complete visual immediately after `work.apply({ action: "begin" })`.
- If the dataset schema is unknown, create a title/intent draft before `data.inspect` so the canvas reflects real work immediately.
- Do not call `data.query` merely to fetch rows that an immediately following visual render will query; rely on the render observation instead.
- Use `data.query` when analysis must precede the choice of visual expression. A later visual in the same WorkSession may reuse that query artifact.

## Required reading before coding

1. `docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md`
2. `contracts/tool-surface.json`
3. `contracts/scene.schema.json`
4. `docs/superpowers/plans/2026-09-09-data-canvas-m0-m1-implementation.md`

The spec is authoritative. The plan may be adjusted only when implementation evidence shows the spec is internally impossible or an upstream API has changed.

## Non-negotiable architecture rules

1. **Never generate HTML as an analysis action.** UI code is implementation code, not a dynamic output format.
2. **Scene is the durable product state.** Renderer output is disposable.
3. **Patch before create.** If the user asks to change the current visual, mutate that visual in place.
4. **Clone only when the previous view should remain useful for comparison or branching.**
5. **No silent sampling.** If a visual would exceed the configured row/point limit, return `render_limit_exceeded` and require explicit aggregation/binning/sampling.
6. **Raw SQL is an escape hatch, not the default.** Prefer QuerySpec.
7. **Do not invent BI concepts.** No dashboard builder, metric-admin UI, filter panels, template marketplace, auth, cloud sync, or plugin system in V1.
8. **Keep visual grammar compositional.** A visual is layers of marks + encodings, not a hard-coded chart type hierarchy.
9. **The runtime must return structured observations after rendering/querying.** Do not ask the LLM to recompute deterministic statistics.
10. **Persist operations, not rendered DOM.**

## Development discipline

- Use test-driven development for behavior changes.
- Keep core contracts independent from DuckDB, MCP, Plot and browser code.
- Prefer small files with one responsibility.
- Every MCP tool handler should translate validated input into a core runtime call; business logic does not live in tool registration.
- `SceneStore` owns durable Scene/history only; `WorkSessionStore` owns ephemeral overlays, ordered work events, and render artifacts only.
- Every scene mutation increments revision exactly once.
- Tool outputs include `canvas_id`, `revision`, `status`, and structured result/observation when applicable.

## Current package status

This handoff already contains tested starter implementations of `SceneStore` and `compileQuery`. They define contract behavior, but they are not the finished M0 runtime. Extend them rather than replacing them casually.

## Target milestones

### M0 — brush loop

One CSV; one browser canvas; `canvas.inspect`, `data.inspect`, `visual.create`, `visual.patch`; DuckDB query; Observable Plot render; live WebSocket update.

Acceptance sentence:

> “Change the channel bar visual to a last-30-days trend” changes the same visual object in place, without HTML generation or page reload.

### M1 — usable canvas

Add multi-dataset discovery, `data.query`, `visual.clone`, `canvas.compose`, `canvas.annotate`, `history.apply`, persistence, 10–15 marks, safe render limits, and basic observations.

Do not implement M2/M3 features until M1 acceptance tests pass.
