# Live Construction Spec Delta — LC0 + LC1

日期：2026-09-14  
状态：已确认的 LC0 + LC1 增量设计；此文件不替代 V1 Spec。

## A. V1 Spec 原本要求什么

V1 将 Scene 定义为 durable product state，renderer 输出可丢弃；核心工具以 QuerySpec、组合 marks 和 revision/history 为中心。实时 mutation flow（V1 Spec §11）为：验证请求、检查 `expected_revision`、一次 SceneStore mutation、追加历史、安排相关 query/render、WebSocket 广播带新 revision 的事件、浏览器只更新受影响对象。M0/M1 对 MCP 调用者仍是同步的。

V1 还要求：不生成 HTML 作为分析行为；patch 优先于 create；超过 render limit 不静默采样；raw SQL 只读；每个 durable mutation 只增加一个 revision；持久 operations 而不是 rendered DOM。

## B. 当前实现实际是什么

当前普通 `visual.create`、`visual.patch`、`visual.clone` 会先 `await DataCanvasRuntime.#render()`，其中包括 dataset profile、完整 DuckDB rows materialization、observation 与 PlotConfig；随后才 mutation、persistence 和 WebSocket event。浏览器收到 visual event 后 GET `/api/visual/:id`，该 endpoint 又调用 `runtime.renderVisual()`，使同一状态再执行一次完整 query/render。

浏览器保留 visual card，但每次 render 都创建完整 SVG，再 `replaceChildren(svg)`。现有 animation 在最终 SVG 已存在后运行。Scene、history、snapshot 中不存在 task/work/draft/pending/progress。

## C. 哪些属于 implementation drift

1. **涉及本次范围且必须修正：** V1 §11 的“先 Scene mutation、后 schedule render”被实现为“先 final render、后 Scene mutation”。这使 query 完成前不存在可见 runtime state。
2. **涉及本次范围且必须修正：** 浏览器取得 visual artifact 时再次 query/render，违背“同一语义状态不应因浏览器读取而重算”的 LC1 要求。
3. **涉及本次范围且必须修正：** 连续工作事件没有 work identity、strict sequence 或 stale-event rejection，不能安全承载连续 semantic patches。
4. **记录但不在 LC0/LC1 重写：** visual 内 SVG 是 rebuild-mode，而不是 retained mark scenegraph。LC2 才解决；LC0/LC1 只要求 working states 可以被重画并避免长 entrance replay。

## D. 本 Prompt 对 V1 增加什么

新增一个非持久化的 `WorkSession`：`id`、`base_revision`、`status`、严格递增 `sequence`、`started_at`、working overlay、activity 和 render artifacts。它由独立 `WorkSessionStore` 持有，不进入 `SceneStore`、`.datacanvas/scene.json`、history 或 snapshots。

浏览器的 Effective Scene 是 `durableScene + activeWorks overlays`。工作内 Visual 可是 incomplete draft；该 draft 会立即形成 working visual event 和静态 shell，只有在 commit 时才必须 materialize 为正式 `VisualSpec`。commit 检查 base revision、完整性与 fatal errors，随后以一次 `SceneStore` durable commit 写入 overlay，产生一个 `work.commit` history record 和一个新 revision。cancel 仅删除 ephemeral work。

仅新增一个 MCP lifecycle tool：`work.apply`，动作是 `begin | commit | cancel`。现有 `data.inspect`、`data.query`、`visual.create`、`visual.patch`、`visual.clone`、`canvas.compose`、`canvas.annotate` 增加可选 `work_id`。带 work id 的真实 inspect/query/render 由 runtime 生成 `work.activity`，不接受 agent 自由文本思考描述。

新增 ordered work events：`work.started`、`work.activity`、`work.visual.changed`、`work.completed`、`work.cancelled`、`work.failed`、`work.snapshot`；每个 work event 必带 `work_id`、`base_revision`、从 1 开始严格递增的 `sequence`。浏览器以 `lastSequence[work_id]` 拒绝 `<=` 的事件。

新增轻量 RenderArtifact cache，以 `{scope, visual_id, version}` 标识同一有效 visual 状态。一次 semantic state 的 DuckDB query/render 产生 artifact；浏览器 endpoint 只取这个 artifact，不重复查询。

## E. 哪些 V1 contract 保持不变

- Durable Scene schema 继续只代表产品状态；正式 `VisualSpec` 仍要求完整 `source/query/marks/layout`。
- SceneStore 继续是 durable state/history 的唯一所有者；WorkSessionStore 不替代它。
- QuerySpec 安全编译、identifier/filter validation、read-only raw SQL guard、point limit 和无 silent sampling 保持不变。
- 仍然是本地、单进程、DuckDB、Observable Plot、WebSocket、JSON/JSONL；不引入数据库、队列、前端框架、row streaming 或 LC2 retained renderer。
- 普通、不带 `work_id` 的九个旧工具行为保持兼容；`work.apply` 是唯一新增 MCP tool。
- 仍然不生成 HTML/SVG source 作为数据分析输出；浏览器 renderer 是实现代码。

## Chosen Local Architecture

```text
Durable SceneStore                     Ephemeral WorkSessionStore
scene + history + snapshots            work + overlay + activity + artifacts
          |                                      |
          +----------- Effective Scene ---------+
                              |
                  ordered work event / HTTP snapshot
                              |
                 browser durableScene + activeWorks
```

`WorkSessionStore` owns overlay application and effective-scene materialization. `DataCanvasRuntime` orchestrates actual inspection/query/render and cache population. `SceneStore` receives exactly one materialized Scene replacement at `work.commit`; it must not contain WorkSession data.

## Acceptance Boundaries

LC0/LC1 passes only if a working visual event occurs before a deliberately slow query resolves, drafts never reach durable persistence, commit produces exactly one revision/history operation, cancel restores the base durable view, stale work events are ignored, and a browser artifact fetch does not increment query count for the same state. The implementation must not use timers, sleep, replay queues or fake progress to create construction states.
