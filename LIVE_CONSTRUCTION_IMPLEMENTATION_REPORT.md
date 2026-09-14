# Live Construction Implementation Report — LC0 + LC1

日期：2026-09-14  
范围：已确认的 LC0 + LC1；不包含 LC2 retained-mark renderer、row streaming 或推理过程展示。

## A. 已纠正的 V1 drift

- WorkSession 路径不再等完整 DuckDB 查询后才产生状态。`visual.create` / `visual.patch` / `visual.clone` 带 `work_id` 时，先写入内存 overlay 并发出 `work.visual.changed`，随后才开始真实 render。
- 浏览器读取 `/api/visual/:id?work_id=...` 会复用 RenderArtifact；并发读取还会复用同一个 in-flight promise，避免工作态事件与浏览器请求竞争造成重复 DuckDB query。
- work events 现在有 `work_id`、`base_revision` 和递增 `sequence`；浏览器拒绝旧 sequence。

## B. 仍保留的实现差异

- 不带 `work_id` 的旧 `visual.create`、`visual.patch`、`visual.clone` 保持原有同步兼容路径：先完成 render，后做 durable mutation/event。LC0/LC1 的“先可见状态、后 render”保证只适用于显式 WorkSession 路径。
- visual 内部仍是 rebuild-mode SVG；working 更新禁用了长 entrance replay，但 retained mark scenegraph 是 LC2 工作。
- DuckDB 仍是完整 query/materialization；没有 row streaming。

## C. 新架构与职责

`SceneStore` 仍是唯一 durable state/history owner。`WorkSessionStore` 只持有内存中的 work、overlay、activity 和有效场景计算。`DataCanvasRuntime` 编排真实 inspect/query/render、事件、artifact cache 和一次性 commit。浏览器以 `durableScene + active work overlays` 渲染 Effective Scene。

## D. WorkSession contract

`WorkSession` 包含 `id`、`base_revision`、`status`、`sequence`、`started_at`、`overlay` 与最近 `activity`。Working visual 可以只是 `id/title/kind` 草稿；commit 前必须 materialize 为完整 `VisualSpec`。`begin`、working patches 和 `cancel` 不触碰 Scene/history/persistence；`commit` 仅在 base revision 一致、草稿完整时调用一次 `SceneStore.commitWork`。

## E. 事件与浏览器协议

实现并验证了 `work.started`、`work.activity`、`work.visual.changed`、`work.completed`、`work.cancelled`、`work.failed` 与 reconnect `work.snapshot`。每个 work event 都带 `work_id/base_revision/sequence`。`src/web/work-event-order.ts` 的纯函数拒绝同一 work 的 `sequence <= lastSequence`。

## F. MCP 变更

唯一新增工具为 `work.apply`，动作限定为 `begin | commit | cancel`。既有 `data.inspect`、`data.query`、`visual.create`、`visual.patch`、`visual.clone`、`canvas.compose`、`canvas.annotate` 增加可选 `work_id`；旧工具名未删除或重命名。带 work id 的 `visual.create` 允许不完整草稿，其余 durable create 仍要求完整 source/query/marks。

## G. 持久化与历史

`work.commit` 将 materialized overlay 一次写入 SceneStore，产生一个 revision 与一条 `work.commit` history record。测试在真实 Persistence 临时目录中确认：begin 和多次工作内修改后 `scene.json/history.jsonl` 不变；commit 后 revision 只从 20 到 21，history 只有一条记录。cancel 不产生 durable mutation。

## H. RenderArtifact cache

artifact 以 durable revision 或 work scope + visual id 区分。相同有效 visual 的 endpoint 获取命中缓存；正在生成的 artifact 以共享 promise 去重。working patch 会使对应 work artifact generation 失效，避免旧结果作为最新缓存提交。

## I. Agent policy

`AGENTS.md` 与 `IMPLEMENTATION_PROMPT.md` 已加入：多步或需要逐步可见的工作先 begin；立即写入最小 draft；只发真实 query/render/activity；语义 patch 后 commit/cancel；不得伪造进度、CoT、sleep 或 replay。简单单步操作仍可使用旧路径。

## J. 自动化验证

- `tests/work-session-store.test.mjs`：overlay、不完整草稿、零持久化基础语义。
- `tests/scene-store.test.mjs`：原子 `work.commit` revision/history 行为。
- `tests/live-construction-runtime.test.mjs`：slow query 前 working event、一次 commit/cancel、真实 activity、Persistence 不变、缓存命中、in-flight 去重、invalid/conflict。
- `tests/work-event-order.test.mjs`：乱序/重复 work event 被拒绝。
- `tests/mcp-contract.test.mjs`：冻结工具表只增加 `work.apply` 与草稿 schema。
- `tests/web-smoke.test.mjs`：`/api/works`、WebSocket snapshot 和浏览器资源路由。
- `tests/live-construction-e2e.test.mjs`：真实 MCP handler → Runtime → WebSocket → HTTP Scene 的端到端链路。

## K. 真实端到端事件时间线

端到端测试在同一运行时启动真实 MCP handler、WebSocket server 和 HTTP server，依次执行：`work.apply(begin)` → title draft → `data.query` → semantic `visual.patch`（补齐 source/query/marks/layout）→ annotation → `work.apply(commit)`。WebSocket 实收事件按严格递增 sequence 包含：`work.started`、初始 `work.visual.changed`、真实 render activity、真实 query activity、补全后的 `work.visual.changed`、`work.completed`。最后 HTTP `/api/scene` 的 revision 为 1，且同时具有完成 visual 和 annotation；没有刷新或服务重启参与。

## L. 已知限制与未控制边界

- Codex 何时决定发出第一个 `work.apply(begin)` 属于 agent 决策时间，runtime 无法控制；一旦 begin 到达，working 状态立即进入 Runtime/WebSocket。
- 浏览器仍使用完整 SVG rebuild；LC1 避免工作态长动画重播，但不承诺逐 mark retained-diff。
- **当前系统仍存在 render-before-visible-state 路径：YES。** 为兼容旧模式，未带 `work_id` 的 `visual.create`、`visual.patch`、`visual.clone` 仍是先 render 后 durable event；所有显式 WorkSession 路径均已改为先工作态可见、后真实 render。
