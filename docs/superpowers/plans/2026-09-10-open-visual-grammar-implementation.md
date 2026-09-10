# Open Visual Grammar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 Data Canvas 从封闭的 Plot mark 白名单升级为可混合高层统计 mark 与声明式 SVG primitive 的开放 Visual Grammar，并用同一个 Visual 完成 bar → pie → donut → radial 及自定义 path 视觉。

**Architecture:** 保留 Observable Plot 作为统计 renderer；新增小型内部 renderer registry，把 `plot.*` 与 `primitive.*` 能力编译为统一的声明式 render payload。Visual 增加独立 coordinate 与 encoding，旧 mark 语法继续按 cartesian/Plot 语义解析；primitive 只携带纯数据几何规格，由浏览器 SVG renderer 绘制，绝不接受 HTML、JavaScript 或事件处理器。

**Tech Stack:** TypeScript, Zod, DuckDB, Observable Plot 0.6.17, D3 shape/path, WebSocket, Node test runner。

**Spec:** `/Users/linpeiwen/.codex/attachments/29b7c547-18ff-4cae-91b5-d8f375c90a71/pasted-text.txt` and `docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md`

## Global Constraints

- Scene remains the durable product state; renderer output is disposable.
- Existing `visual.create`, `visual.patch`, `visual.clone` remain the only visual mutation tools.
- Existing bar, line, area, dot, rule, text, box, cell, and facet behavior remains compatible.
- New visual capabilities are primitive/renderer capabilities, never PieChart/DonutChart/RadarChart templates or chartType enums.
- Primitive specifications are pure JSON data; reject script, HTML, functions, and unsafe path data.
- A visual mutation increments revision exactly once and patches the existing visual in place.
- No new database, plugin marketplace, GUI chart picker, animation engine, or generated HTML/JS analysis output.

### Task 1: Extend the scene grammar and validation

**Files:**
- Modify: `src/core/types.ts`
- Modify: `src/mcp/schemas.ts`
- Modify: `contracts/scene.schema.json`
- Modify: `contracts/tool-surface.json`
- Test: `tests/mcp-contract.test.mjs`, `tests/scene-store.test.mjs`

- [ ] Write failing tests for `coordinate`, mark `renderer`, nested `encoding`, and primitive mark types (`rect`, `circle`, `line`, `arc`, `path`, `text`, `area`).
- [ ] Run the focused tests and confirm current schema rejects the new grammar.
- [ ] Add backward-compatible types: optional `coordinate` defaults to cartesian; old Plot marks retain their existing fields; primitive marks opt into `renderer: "primitive"` and may use encoding references.
- [ ] Add strict validation for path data and reject arbitrary HTML/JS/function-like values.
- [ ] Run focused contract and scene tests.

### Task 2: Add a renderer registry and mixed-layer compiler

**Files:**
- Create: `src/render/renderer-registry.ts`
- Modify: `src/render/plot-compiler.ts`
- Modify: `src/core/types.ts`
- Test: `tests/plot-compiler.test.mjs`

- [ ] Write failing tests showing Plot and primitive marks can coexist, `arc` compiles without a chart-type switch, and unknown renderer/primitive returns `unsupported_visual_feature`.
- [ ] Run the focused compiler tests and verify the expected failures.
- [ ] Implement registry entries for existing Plot marks and primitives; resolve renderer by explicit `renderer` or compatibility defaults.
- [ ] Return a unified render payload containing existing `plot.marks` plus declarative `primitives` while preserving old payload fields.
- [ ] Run compiler tests and the existing full plot test file.

### Task 3: Implement primitive geometry compilation and safety

**Files:**
- Create: `src/render/primitive-compiler.ts`
- Modify: `src/runtime/data-canvas-runtime.ts`
- Test: `tests/primitive-compiler.test.mjs`, `tests/runtime.test.mjs`

- [ ] Write failing tests for arc angle accumulation, donut `innerRadius`, radial radius encoding, path/circle/text custom geometry, and invalid path/encoding errors.
- [ ] Run the tests and confirm they fail before implementation.
- [ ] Compile field/constant/derived encoding values from query rows into deterministic SVG geometry; use polar coordinate only for geometry, not a chart type.
- [ ] Validate finite numeric radii/angles, safe path command data, bounded coordinates, and no executable fields.
- [ ] Ensure runtime errors remain structured through the existing MCP error adapter.
- [ ] Run primitive and runtime tests.

### Task 4: Render mixed Plot and primitive layers in the browser

**Files:**
- Modify: `web/index.html`
- Modify: `src/web/server.ts` if asset serving is required
- Test: `tests/web-smoke.test.mjs`

- [ ] Write failing browser smoke tests for SVG arc rendering, donut patching, radial encoding, mixed Plot + primitive layers, and path/circle/text rendering.
- [ ] Run the focused smoke tests and confirm failure on the current Plot-only renderer.
- [ ] Add a declarative SVG primitive renderer using D3 shape/path helpers already available locally; keep Plot rendering for Plot marks and layer both into one visual card.
- [ ] Handle primitive errors in-card without crashing the page; preserve WebSocket live updates and no page reload.
- [ ] Run web smoke tests and check browser console output.

### Task 5: Add compatibility normalization and update capabilities/docs

**Files:**
- Create: `src/core/scene-normalizer.ts`
- Modify: `src/core/scene-store.ts`
- Modify: `src/mcp/server.ts`
- Modify: `README.md`
- Modify: `docs/acceptance/2026-09-09-m0-m1.md`
- Modify: `docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md`
- Test: `tests/scene-store.test.mjs`, `tests/mcp-contract.test.mjs`

- [ ] Write failing migration tests for old scenes without coordinate/renderer/encoding and verify they normalize unchanged.
- [ ] Normalize legacy scenes to cartesian + Plot defaults at load/inspect boundaries without changing revision or query.
- [ ] Advertise renderer capabilities and primitive encodings through `canvas.inspect`; do not expose chart-template names.
- [ ] Document the grammar and the bar → arc → donut → radial examples.
- [ ] Run contract, persistence, and compatibility tests.

### Task 6: End-to-end acceptance and cleanup

**Files:**
- Modify: `tests/m1-workflow.test.mjs`
- Create: `tests/open-visual-grammar.e2e.test.mjs`
- Modify: `docs/ACCEPTANCE_EVIDENCE.md`

- [ ] Add one end-to-end test that keeps one `visual_id`, preserves the query, and applies bar → polar arc → donut → radial patches with one revision per patch.
- [ ] Add mixed-layer and custom path/circle/text acceptance cases.
- [ ] Run `npm run verify:core` and the browser smoke suite.
- [ ] Start the configured runtime on port 3000 and manually verify the live canvas shows the final radial/custom primitive views without reload or restart.
- [ ] Search the repository for `PieChart`, `DonutChart`, `RadarChart`, `chartType`, and per-chart renderer branches; remove any violations.
- [ ] Commit the completed architecture correction on `main`.

## Verification Commands

```bash
npm run verify:core
npm test -- tests/primitive-compiler.test.mjs tests/open-visual-grammar.e2e.test.mjs
```
