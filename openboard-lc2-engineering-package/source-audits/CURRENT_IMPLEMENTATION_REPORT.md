# Data Canvas Current Implementation Report

审计日期：2026-09-14。范围是当前 `main` 的实际代码、当前本机只读 HTTP 观察和只读 Git 历史。没有改动生产代码、没有创建图表、没有重启服务，也没有增加任何埋点。

## 1. Executive Summary

OpenBoard 现在是一个本地 Node 进程：同一进程同时承载 MCP stdio server、运行时、DuckDB 内存连接、HTTP/WebSocket 服务和静态浏览器页面。它已经具备“完整 VisualSpec -> 一次查询 -> 一次 Scene 提交 -> WebSocket 通知 -> 浏览器重画该图”的同步刷子闭环，并且 Scene、历史记录和快照可持久化。

它尚不是 Live Construction 运行时。最核心的代码事实是：`visual.create`、`visual.patch`、`visual.clone` 都在 Scene 提交前等待完整的 `#render()`；`#render()` 又等待数据 profile、完整 DuckDB 结果、观察统计和 PlotConfig 全部完成。因此，在查询期间既没有持久化 Visual，也没有事件，也没有浏览器可显示的中间状态。浏览器收到事件后也不是保留 SVG 节点逐层更新，而是为受影响 Visual 重新请求完整渲染结果，构造新 SVG，并以 `replaceChildren()` 替换旧 SVG；随后才播放入场动画。

当前实现非常适合“同步、原子地得到一个最终图”。它不具备“用户提交分析后立刻看到工作中的画布对象，并持续看到数据/mark/标注逐步出现”的状态模型、事件模型或渲染保留模型。

## 2. Audit Scope and Evidence

审计对象：`src/`、`web/index.html`、`contracts/`、`AGENTS.md`、`IMPLEMENTATION_PROMPT.md`、V1 spec/implementation plan、测试和 Git 历史。

运行时只读观察：在当前已有 `orders-by-product-bar` 的本机服务上，使用 curl 测得 `/api/scene` 为 **0.000820 s**，`/api/visual/orders-by-product-bar` 为 **0.010706 s**。这不是端到端体验时间：不含 Codex 理解/选工具/生成参数、MCP stdio、WebSocket 排队、浏览器 fetch、Observable Plot 布局和动画；也只代表当前小型 examples CSV 的一次本机测量。

没有为本次审计运行会改写 `.datacanvas` 的操作。Git 工作区在写报告前为干净状态。

## 3. Actual End-to-End Request Chain

以用户说“分析最近 30 天各渠道订单”为例，当前可验证的链条是：

```text
用户自然语言
  -> Codex 自行决定何时、以何参数调用 MCP（本项目没有接收用户请求的服务端入口）
  -> src/mcp/server.ts: McpServer.registerTool
  -> Zod 输入验证（src/mcp/schemas.ts）
  -> DataCanvasRuntime 方法（src/runtime/data-canvas-runtime.ts）
  -> DuckDbEngine.inspect + compileQuery + DuckDbEngine.query
  -> observe + compilePlot
  -> SceneStore 提交 / Persistence 写盘 / EventBus.emit
  -> src/web/server.ts 将 JSON SceneEvent 广播到 /ws
  -> web/index.html 的 WebSocket message handler
  -> fetch /api/visual/:id
  -> runtime.renderVisual（再跑一次完整 query/render）
  -> Plot.plot + primitive DOM 构造
  -> plot.replaceChildren(svg)
  -> Web Animations API/requestAnimationFrame 入场动画
  -> DOM/SVG
```

更精确地说，`visualCreate()` 的顺序是 `await #render(visual)`、`SceneStore.createVisual()`、`await #persist()`、`EventBus.emit(visual.created)`、返回 MCP 结果；`visualPatch()` 和 `visualClone()` 同样先 render preview 再提交。故 Scene/浏览器在“查数与编译图”期间无可观察的生命周期变化。

`data.inspect` 与 `data.query` 只返回 MCP 结果，不修改 Scene、不持久化、也不发 EventBus 事件，因此本身不会改变 Canvas。`canvas.inspect` 亦然。

## 4. First Visible Feedback: What Happens Today

下面是当前“最近 30 天按 channel 统计订单”可能采用 `data.inspect`、`data.query`、`visual.create` 的实际可见性，而非理想设计：

| 时间段 | 实际行为 | Canvas 是否有新可见反馈 |
| --- | --- | --- |
| 0–8 s，用户到 Codex | Codex 是否已决定调用工具、是否先 inspect/query，项目内无计时或 request state。 | UNKNOWN。验证方法：在 Codex/MCP 客户端加临时 trace（本次未做）。 |
| `data.inspect` | DuckDB 注册临时 view、DESCRIBE、COUNT、top values、sample；结果只回 MCP。 | 否。 |
| `data.query` | DuckDB 完整执行并返回 rows 与 observation；结果只回 MCP。 | 否。 |
| `visual.create` 开始至 query 完成 | runtime 先 profile、编译 QuerySpec、等待完整 rows、算 observation、编译 PlotConfig。 | 否；Visual 尚未进 Scene。 |
| `visual.create` 提交后 | Scene revision +1；Scene、快照、历史/metadata 持久化；发 `visual.created`。 | 是，但这是第一个且已是完整 VisualSpec 的事件。 |
| 浏览器收到事件 | 请求 `/api/visual/:id`；服务端再次执行完整 render；浏览器一次性建新 SVG 并替换。 | 最终图出现，之后才有入场动画。 |

当前没有 `draft`、`pending`、`loading`、`task`、`work`、`request`、`session`、`progress`、`phase`、`correlation_id` 或 progressive-patch 字段/事件。也没有“先空卡片、后填数据/mark”的工具输入。`visual.create` 的 schema 虽允许空 `marks: []`，但仍要求完整 `source` 与 `query`，并且仍会先运行 `#render()`；它不是 pending 生命周期。

## 5. Actual Scene Model

Scene 是唯一的耐久产品状态，结构为：

```text
Scene
├─ canvas_id: string
├─ revision: integer
├─ datasets: Record<id, DatasetSpec>
├─ visuals: Record<id, VisualSpec>
├─ annotations: Record<id, AnnotationSpec>
└─ canvas: { focus?, viewport?, groups? }
```

`DatasetSpec` 存 id、文件路径、CSV/Parquet 格式，以及可选 fingerprint、row_count、columns profile。`VisualSpec` 必有 id、kind（plot/table/kpi）、source、QuerySpec、marks、layout；可有 title、cartesian/polar coordinate、derived_from、facet。`QuerySpec` 包含 filters、dimensions（可带时间粒度）、measures、sort、limit、显式 reservoir sample 或只读原始 SQL。

Mark 是组合式 grammar：Plot marks 支持 bar/line/area/dot/rect/cell/rule/text/tick/box，primitive 支持 rect/circle/line/arc/path/text/area；channels 通过 encoding 或 legacy x/y/color/fill/stroke/size/text 表达。layout 是 `{x,y,w,h}`，annotation 是 Scene/Visual 目标、文本、可选 anchor 与 created_at。

不存在：Visual status、渲染缓存、结果数据、任务、请求、work item、父任务、事务、批次、阶段、进度、错误状态或动画状态。`derived_from` 只表示 clone 来源；`HistoryRecord.parent_revision` 是历史谱系，不是工作流父节点。

## 6. Mutation Model

核心 `SceneStore.#commit()` 会：检查 `expected_revision`，clone 当前 Scene，执行 mutator，分配下一 revision，追加 HistoryRecord 和 snapshot，再用 draft 替换内存 Scene。一次 `createVisual`、`patchVisual`、`cloneVisual`、`compose`、`annotate` 都只经此边界一次，因此成功 Scene mutation 的 revision 恰好加一。

`visual.patch` 是自定义 patch DSL，不是 JSON Patch：`set`、`unset`、`add_marks`、`remove_marks`。它允许根路径 title/kind/source/query/layout/facet/coordinate，且可深改某个 mark 的 `marks.<mark-id>.<path>`；Visual id、derived_from 和整体 marks 根路径不可直接 set/unset。`clone` 复制 Visual、替换 id、写 `derived_from`，可在创建时套 patch。`canvas.compose` 处理 move/resize/delete/focus/group/ungroup/arrange。

对于 create/patch/clone，真正顺序是“预览/完整渲染 -> 内存 Scene mutation -> persistence -> one event”；不是先写 Scene 后后台渲染。compose/annotate/history 则不进行 query/render，直接 commit、persist、发对应事件。

没有 batch API、multi-operation transaction、squash、debounce、合并 patch 或 server-side operation queue。多个 MCP 调用对应多个顺序 revision；并发调用只由可选 `expected_revision` 拒绝陈旧写入来保护，未传时没有自动 last-write conflict 防护。

## 7. History, Undo, and Persistence

每次 `#persist()` 会原子替换 `.datacanvas/scene.json`，原子保存 `.datacanvas/snapshots/<revision>.json`，保存 checkpoints/forks metadata，并把尚未落盘的 HistoryRecord 追加到 `history.jsonl`。持久的是 Scene、快照和操作，不是 SVG/DOM/Plot 渲染输出。

HistoryRecord 为 `{revision,parent_revision,operation,target?,input,timestamp}`；内存 `HistoryStore` 也保存每个 revision 的 Scene snapshot。`history.apply` 支持 undo、redo、checkpoint、goto、fork：undo 去父 revision，redo 选 child revisions 中排序最高的第一个，goto 直接恢复快照。checkpoint/fork 不创建新 Scene revision；fork 只登记 branch metadata，不创建独立运行时或新 Canvas。

没有 redo 分支选择 UI/API、事务回滚、batch、squash 或 checkpoint 压缩策略。历史恢复后会发 `history.changed`，浏览器执行整场 `reloadScene()`。

## 8. Realtime Transport and Event Semantics

transport 是进程内同步 `EventBus` 加 Node `ws` WebSocket；不是 SSE，也没有跨进程 broker。`src/web/server.ts` 仅将每个 EventBus event 的 JSON 原样广播给所有 OPEN `/ws` client。

类型联合声明了：`scene.loaded`、`visual.created`、`visual.changed`、`visual.removed`、`annotation.created`、`annotation.removed`、`focus.changed`、`layout.changed`、`history.changed`，通用字段是 `canvas_id`、`revision`，可选 `visual_id`、`annotation_id`、`affected_ids`、`payload`。当前 runtime 实际发出：created/changed/removed/annotation.created/focus.changed/layout.changed/history.changed；没有调用 `scene.loaded`、`annotation.removed`，也没有写 `payload`。

事件是通知，不携带完整 Scene、VisualSpec、数据 rows、PlotConfig、阶段或 diff。浏览器因此必须再 GET：visual event fetch 该 visual，history/annotation/focus/layout event 则 full reload Scene 并重新 render 全部 visuals。没有服务端/客户端 debounce、batch、事件序号队列或 revision-based stale event 丢弃。`render()` 只在返回 revision 不低于本地 scene revision 时更新 revision 文本，但仍会照常绘制；`updateScene()` 本身也不拒绝旧的 Scene response。多个异步 `message` handler 可以并行完成，故严格的乱序保护为 UNKNOWN/未实现；从代码看没有显式保护。

浏览器重连采用 250 ms 起、上限 5 s 的指数退避。WebSocket open 后调用 `reloadScene()`，可恢复在服务重启期间漏掉的事件；这解释了 reconnect 后显示能收敛，但不是 event replay。

## 9. Browser Rendering Pipeline

浏览器为单文件 vanilla JavaScript，没有 React/Vue/Svelte 状态框架。初始加载先 GET `/api/scene`，对每个 Visual GET `/api/visual/:id`；后者再次从 Scene 查询 DuckDB、编译 PlotConfig。

plot Visual 会将完整 `PlotConfig.data` 转日期，调用 `Observable Plot.plot()` 新建 SVG；primitive layers 再用原生 SVG DOM/D3 arc 创建 `<g>` 和 path/circle/text 等。最后 `plot.replaceChildren(svg)`。table/kpi 同样构造新 table/div 后 `replaceChildren()`。card `<article>` 在 id 已存在时保留，标题、layout、focus class 会更新；但内部 SVG、轴、tick、mark、primitive group 不保留。

所以当前为“卡片 retained、图内 DOM rebuild”。改一个 mark 的样式、标题以外的 query 或 layout event，都没有 node-level diff；特别是 `layout.changed` 会触发全场 reload，尽管只改变 layout。

## 10. Animation Audit

动画由 Git 提交 `59ec28f feat: animate all canvas mark primitives` 加入，全部位于 `web/index.html`。触发条件是 `shouldAnimateVisual()` 发现 kind/source/query/coordinate/marks 签名首次出现或改变，且系统未启用 reduced motion；title/layout 不触发。

| 对象 | 函数/技术 | 当前分类 |
| --- | --- | --- |
| Plot bar | `animatePlotMarks` + `Element.animate` scaleY | E：最终元素入场 |
| Plot line | stroke-dasharray/offset + Web Animations API | E：最终 path 描边入场 |
| Plot dot | Web Animations API scale | E：最终点入场 |
| primitive arc | `animateArc` + requestAnimationFrame 改最终 arc 的 endAngle | E：最终 arc 入场 |
| primitive rect/area/circle/line/path/text | `animatePrimitiveMark` + Web Animations API | E：最终元素入场 |
| arc label | `animateElement` opacity | E：最终文本入场 |

这里“E”指入口视觉效果，不表示无价值；它能柔化最终画面的出现。但它不是 A 数据到达、B mark 创建、C 坐标轴/几何计算、D 多阶段分析/注释逐步出现的 construction 状态，因为完整 rows、完整 SVG 和全部节点在动画开始前已经存在。无 CSS/D3 transition 生命周期、无逐批 rows、无逐 revision patch 驱动。

## 11. Design Versus Implementation

**DESIGN SAYS：** V1 realtime flow 是先验证、检查 revision、**mutate SceneStore once**、append history、**schedule** relevant query/render、再发带 revision 的 WebSocket event；浏览器更新受影响对象，M0/M1 对调用者仍同步（spec §11）。`IMPLEMENTATION_PROMPT.md` 也写出概念链：`Codex MCP call -> Scene mutation -> DuckDB query -> Observable Plot render -> browser live update`。

**IMPLEMENTATION ACTUALLY DOES：** `visualCreate/visualPatch/visualClone` 在 `SceneStore` mutation 前 `await #render`，其中含 profile、完整 query、完整 observation、完整 PlotConfig；只有之后才 persist 和 emit。故第一个 `visual.created/changed` 等于“最终数据和图配置已完成”，不是“已创建、后续渲染被排程”。这与 spec 的 mutation ordering 有直接差异。

**DESIGN SAYS：** 浏览器更新仅受影响 Scene objects。

**IMPLEMENTATION ACTUALLY DOES：** visual event 的确只请求该 visual，但在该 visual 内完整替换 SVG；layout/history/focus/annotation 事件会 full `reloadScene()` 并重新查询/渲染所有 visuals。故“对象粒度”部分成立，“mark/SVG 节点粒度”不成立。

**DESIGN SAYS：** Scene durable、render output disposable、patch before create、无 silent sampling、组合式 marks。

**IMPLEMENTATION ACTUALLY DOES：** 这些大体符合：Scene/历史/快照持久，renderer output 不持久；patch DSL 存在；超过 50,000 points 会抛 `render_limit_exceeded`（显式 sample 可例外）；marks 是 compositional grammar。

旧设计文档没有定义 draft/pending/progressive construction，因此不能说它“违反了一个已有 Live Construction 规范”；准确结论是：现有设计和实现共同把 M0/M1 定义为同步最终结果，而当前实现还将 Scene mutation 排在最终 render 之后。

## 12. Agent Instructions and Strategy Contribution

`AGENTS.md` 要求 Codex 以小 MCP surface 表达数据推理、Scene 为 durable state、patch before create、返回 observation，并写“visible result should update immediately”。M0 acceptance 是同一个 visual 被 patch 后无 page reload。`IMPLEMENTATION_PROMPT.md` 也要求 AI brush loop、最小只读 UI，并未要求先建 draft、流式行、阶段事件或任务视图。

所以“agent strategy”能影响两件事：Codex 是否先做 `data.inspect/data.query`，以及它多久才首次调用 `visual.create`。这段时间 Canvas 没有客户端可见反馈，因为这些工具不发 Scene event。它无法仅靠 prompt 绕过 runtime：一旦要创建/更新 persistent Visual，当前工具语义仍要求完整 spec，runtime 仍会先等完整 render。

归因是架构审计推断，而非测量值：对“最终图闪现”大约 **70% runtime/renderer 模型，30% agent 调用策略**。理由是 runtime 不存在 pending Visual/event/partial payload，即使 agent 很早调用 create 也得等待；但 agent 是否更早发 create、是否先做若干隐藏的数据工具调用，仍会改变用户首次看到结果前的时间。Codex 首次工具调用具体延迟为 UNKNOWN。

## 13. DuckDB and Progressive Data Facts

`DuckDbEngine.query()` 和 `queryRaw()` 都 await `connection.run()`，随后 await `result.getRowObjectsJS()`，把所有行转成 JSON array 后才返回 `{columns, rows}`。`inspect()` 也按顺序 await DESCRIBE、COUNT、每字段 top-k、sample。没有 Arrow RecordBatch 暴露、cursor、async iterator、chunk callback、流式 WebSocket message 或增量 renderer 输入。

因此当前 renderer 只能接受完整 `JsonObject[]`；`compilePlot(visual, rows)` 也是一次性接收完整 rows。若未来要“数据一到就画”，数据层与 renderer 都需要新的增量边界；仅给当前动画加更长 duration 不会创造流式数据可见性。

## 14. Performance and Timing

当前单次本机测量：Scene JSON 0.82 ms；已有 product bar render API 10.71 ms。`/api/visual/:id` 的 10.71 ms 已含 profile + DuckDB execute + JSON materialization + observation + compilePlot，但不含浏览器 SVG 构建/paint/animation；也不含 MCP 的 create 路径所需 Scene 持久化。

可从代码确定的额外成本：每一次 `/api/visual/:id` 都调用 `runtime.renderVisual()`，即重新走 `#render()`；因而 WebSocket `visual.created/changed` 后会重复 MCP mutation 时刚跑过的查询。initial reload/history/annotation/focus/layout 又会对 Scene 中每个 visual 并行重复这一路径。实际大数据、网络、浏览器负载和 Codex 推理时序为 UNKNOWN；验证方法是临时、可移除的 span tracing 或 browser performance trace（本次按要求未加）。

## 15. Reusable Building Blocks

- `SceneStore` 的 clone-before-commit、revision conflict、历史快照与 patch DSL，适合作为未来持续状态的基础。
- `VisualSpec` 的 source/query/marks/layout 与 renderer-independent Scene，已经把“表达什么”同“怎么画 DOM”分开。
- `EventBus` 和 `/ws` 已经提供本地广播通道；重连后的 full scene reconcile 也已存在。
- `DuckDbEngine`、`compileQuery`、`observe` 是数据查询和确定性观察的清晰边界。
- `compilePlot` / `compilePrimitive` 和 renderer registry 提供组合 mark grammar；browser card 已按 visual id 保留外层容器。
- `Persistence` 已可原子保存 Scene/快照并追加历史；`expected_revision` 可作为更细粒度更新的防冲突基础。

## 16. Likely Files and Should Not Need

若未来单独启动 Live Construction 设计，最可能涉及的边界（不是本次建议的修改清单）是：`src/core/types.ts`、`contracts/scene.schema.json`、`contracts/events.schema.json`、`contracts/tool-surface.json`、`src/runtime/data-canvas-runtime.ts`、`src/runtime/event-bus.ts`、`src/data/duckdb-engine.ts`、`src/render/*`、`src/web/server.ts`、`web/index.html` 及相应 tests。

从当前职责看，不应因为 construction 需求而需要改动：CSV/Parquet discovery 的基本语义、QuerySpec 的 identifier/filter 安全编译、raw SQL read-only guard、Scene 持久化文件的原子写入原则、MCP stdio transport、或把 UI 变成 dashboard/HTML-generation 系统。具体是否需扩展任一 contract，必须在下一阶段设计中由状态/事件需求证明。

## 17. Blockers, Friction, and Already Ready

**Blockers（对真正实时构建而言）：** 无 pending/draft/work state；create/patch/clone render-before-commit；无 partial query data；event 没有 phase/payload/diff/correlation；浏览器无 retained SVG mark update；无事件乱序保护。

**Friction：** visual event 后重复跑 render；Scene-level events 常触发全场 reload；`data.inspect` 的默认 profile 可对每列做 top-k 查询；客户端并发处理 async event；更新 title 也会走 preview render（因为 patch 一律先 `#render(preview)`）。这些都是可观察的性能/体验摩擦，不是本次要修的 bug。

**Already Ready：** nine-tool MCP surface、结构化 observation、revision/history/snapshot、local WebSocket broadcast/reconnect、Composable mark grammar、point limit、只读 SQL guard、以及持久 Scene 与可替换 renderer 的基本分层。

## 18. Key Source References

- 进程装配：`src/index.ts:10-25`。
- MCP 九工具、handler 到 runtime：`src/mcp/server.ts:7-10, 47-96`；输入 schema：`src/mcp/schemas.ts:53-62`；公开 contract：`contracts/tool-surface.json:1-163`。
- Scene/Visual/Query/History 类型：`src/core/types.ts:5-213`；JSON schema：`contracts/scene.schema.json:5-205`。
- 单次 commit/revision、patch、compose、history：`src/core/scene-store.ts:99-304`；snapshot lineage：`src/core/history-store.ts:20-105`；持久化：`src/runtime/persistence.ts:11-102`。
- runtime render-before-mutate 的证据：`src/runtime/data-canvas-runtime.ts:42-147`。
- DuckDB 完整结果物化：`src/data/duckdb-engine.ts:49-114`；QuerySpec 与 point limit：`src/core/query-compiler.ts:3-155`。
- Event union/同步 EventBus：`src/runtime/event-bus.ts:1-20`；HTTP/WebSocket bridge：`src/web/server.ts:10-65`。
- Plot/primitive compilation：`src/render/plot-compiler.ts:17-106`、`src/render/primitive-compiler.ts:66-117`、`src/render/renderer-registry.ts:3-25`。
- 浏览器状态、动画、replaceChildren、reconnect：`web/index.html:72-317`。
- 设计定义的 mutation order：`docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md:364-403`；实现提示链：`IMPLEMENTATION_PROMPT.md:1-22`；项目约束：`AGENTS.md:5-66`。
