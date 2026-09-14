# OpenBoard 项目上下文

更新时间：2026-09-14
权威入口：本文件 + `AGENTS.md` + 当前源码；专题审计和实现报告按下方索引阅读。

## 项目是什么

OpenBoard 是给 Codex 等本地 AI agent 使用的 Data Canvas 可视化运行时。数据文件是输入，Scene 是持久化画布状态，MCP 工具负责检查数据、查询、创建/修改视觉对象，浏览器通过 HTTP/WebSocket 显示当前画布。

## 项目不是什么

V1 不是 BI/dashboard builder、图表模板市场、字段管理后台、云同步、认证系统、聊天 UI 或 HTML 生成器。Renderer 输出的 SVG/DOM 是 disposable，不写入 Scene/history。

## 当前产品状态

- V1 M0/M1 已在 `main` 落地：CSV/Parquet 发现、DuckDB 查询、Scene/history/persistence、MCP surface、Observable Plot、primitive SVG marks、WebSocket 画布和 WorkSession Live Construction。
- Live Construction 当前是 LC0+LC1：先让 working overlay/event 可见，再执行真实 inspect/query/render，最后由 `work.commit` 一次性写入 durable Scene revision。
- 当前 renderer 仍是“卡片外壳保留、`.plot` 内部整棵 SVG 重建”；LC2 retained mark diff 尚未实现。
- 当前运行 Scene（通过 `GET /api/scene` 核验）：`canvas_id=openboard`、revision `24`、dataset `orders`、visuals `orders-donut-live` / `orders-by-channel-vivid-bar` / `orders-daily-live-line`、annotation `a1`。

## 当前最新任务

Renderer-specific audit（为后续 LC2-A 做依据，不修改生产代码、不实现 LC2）。

执行状态：**已执行待验收**。报告和 DOM map 已提交；推荐 LC2-A 从 **B — RenderArtifact diff** 切入，尚未开始实现。

## 架构/状态流（说人话）

```text
Codex -> MCP stdio -> DataCanvasRuntime
      -> WorkSession overlay（工作态，内存）
      -> DuckDB inspect/query -> observation + compilePlot/compilePrimitive
      -> WebSocket work events -> browser effective scene
      -> Plot.plot / primitive SVG -> replaceChildren（当前整棵图替换）
      -> work.commit -> SceneStore revision/history/persistence（唯一 durable state）
```

普通单步视觉操作会由 runtime 自动包一层 implicit WorkSession；所有视觉变化都应先有 working 状态，再进行真实渲染。Scene revision 每次 durable mutation 只增加一次。

## 已核验命令和结果

在仓库根目录执行：

```bash
npm run verify:core
```

结果：contracts 校验通过，TypeScript 构建通过，86 个测试全部通过（0 fail）。

```bash
curl -i http://127.0.0.1:3000/
curl -i http://127.0.0.1:3000/api/scene
lsof -nP -iTCP:3000 -sTCP:LISTEN
```

最近核验：根页面和 Scene 均 HTTP 200；Node 服务监听 `127.0.0.1:3000`。`npm start` 会先 `npm run build`，再启动 `dist/index.js`；MCP 通过同一进程的 stdio 提供。

## 关键文件（快速导航）

- `AGENTS.md`：本项目不可违背的架构规则。
- `IMPLEMENTATION_PROMPT.md`：工具调用与 LC0/LC1 工作规则。
- `src/runtime/data-canvas-runtime.ts`：Scene、WorkSession、artifact cache、render、事件和 commit 编排。
- `src/core/scene-store.ts`、`src/core/work-session-store.ts`：durable Scene 与 ephemeral overlay。
- `src/render/plot-compiler.ts`、`src/render/primitive-compiler.ts`、`src/render/renderer-registry.ts`：组合式 marks 与 renderer 选择。
- `web/index.html`：当前 vanilla browser renderer、WebSocket 重连、动画和 `replaceChildren` 边界。
- `src/web/server.ts`：HTTP `/api/scene`、`/api/visual/:id`、`/ws`。
- `contracts/`：scene/tool/event/output 合同。
- `.datacanvas/`：本地 scene、JSONL history、snapshots、checkpoint/fork metadata；不要把 DOM/HTML 写进去。
- `openboard-lc2-engineering-package/source-audits/RENDERER_IMPLEMENTATION_REPORT.md`、`openboard-lc2-engineering-package/source-audits/RENDERER_DOM_MAP.txt`：2026-09-14 Renderer-specific audit（当前最新专题资料）。
- `LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md`：LC0+LC1 实现和测试证据。
- `docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md`、`docs/superpowers/plans/2026-09-14-live-construction-lc0-lc1.md`：设计/计划依据。

## 历史文档的注意事项

`openboard-lc2-engineering-package/source-audits/CURRENT_IMPLEMENTATION_MAP.txt` 和 `openboard-lc2-engineering-package/source-audits/CURRENT_IMPLEMENTATION_REPORT.md` 是 LC0+LC1 之前生成的架构快照，仍可作为历史对照，但其中“visual mutation 先完整 render、没有 work”不代表当前源码。判断当前行为应以 `src/`、`web/`、测试和 `LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md` 为准。

## 运行时注意事项

- 这是本机单进程、loopback-first 服务；不要默认暴露公网。
- `.datacanvas` 是当前用户的真实运行状态，改动前先检查 `git status` 和 Scene revision。
- 浏览器目前会在每次完成视觉 fetch 后新建 Plot SVG，再 `plot.replaceChildren(svg)`；现有动画是最终结果的 entrance animation，不是 retained diff。
- WebSocket work event 有 sequence 接收顺序保护，但浏览器 `render(id)` 没有请求取消/响应 token；乱序响应覆盖风险仍待 LC2-A 处理。
- 当前没有 10/100/1000 点浏览器基准；不要仅凭 HTTP 200 或服务 active 宣称大数据性能。

## 后续 agent 工作规则

- 先读本文件、`AGENTS.md` 和相关专题报告，再看代码；不要按历史快照推断现状。
- 保持 Scene renderer-independent；不要生成 HTML 作为分析结果，不要把 SVG/DOM 写进 Scene/history。
- 修改当前 visual 时优先 patch；只有明确需要并行比较/分支时才 clone。
- 不得 silent sampling；超过 point limit 要求显式聚合/binning/sampling。
- LC2-A 尚未获实现授权：先围绕 RenderArtifact key/schema、缓存失效、浏览器 retained renderer、乱序响应测试写计划，确认后再改代码。
- 任何行为改动先 TDD，再跑 `npm run verify:core`；保留与任务无关的改动。

## 尚待人工确认的决策

- 是否正式启动 LC2-A，以及是否接受推荐的 B（RenderArtifact diff）而非 A（直接 SVG diff）或 C（先建 RenderTree）。
- datum key 采用哪些稳定字段、如何处理聚合行/重复 key、line/area series 与 point 的层级关系。
- layout-only 事件是否改为只更新受影响 card，避免全场重查重画。
- 是否为浏览器 render 请求加入 AbortController/sequence token，以及 LC2-A 的 10/100/1000 点验收阈值。

## 风险与跨功能影响

当前主要风险是图内节点无稳定业务 key、Plot/primitive 混合层没有 retained tree、异步浏览器响应可能乱序。LC2-A 会同时触及 `RenderArtifact`、plot/primitive compiler、browser renderer、animation 和 WebSocket 测试；可能影响 bar/line/area/dot、polar arc、annotations、layout reload 和 WorkSession 预览，必须做回归验证。当前交接动作本身只新增文档，不改变这些功能。
