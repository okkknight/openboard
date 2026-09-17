# OpenBoard 项目上下文

更新时间：2026-09-17
权威入口：本文件、`AGENTS.md`、当前源码与 `docs/handoff/`。设计以 `docs/superpowers/specs/2026-09-09-data-canvas-v1-design.md` 为准。

## 项目是什么

OpenBoard 是面向 Codex 和其他 agent 的 Data Canvas 运行时：本地或云端数据进入 DuckDB，agent 通过一小组 MCP 工具表达分析，浏览器在同一持久画布上显示结果。`Scene` 是唯一 durable product state；SVG/DOM 和 render artifact 都是可丢弃的派生产物。

## 项目不是什么

它不是 dashboard builder、模板市场、字段后台、认证/云同步系统、聊天 UI，也不以生成 HTML 作为分析结果。V1 不引入新的 BI 概念。

## 当前状态

- 当前实现分支：`codex/lc2-retained-construction`，最新提交 `c2b2082 feat: complete LC2 live construction runtime`；该提交尚未合入 `main`。
- M0/M1 已具备 CSV/Parquet discovery、DuckDB QuerySpec/受限 SQL、Scene/history/persistence、组合式 visual grammar、WebSocket canvas、clone/compose/annotate/history 与 render limit。
- LC2 已实现真实 DuckDB chunk 流、work-scoped immutable render artifact、有序 work event、浏览器仅更新受影响卡片、working draft 首帧和 keyed SVG reconciliation。
- 图表 create/patch/clone 必须使用显式 `work.apply(begin)` 和 `work_id`；不存在 implicit WorkSession 后门。
- 云端部署已运行同一份 runtime：公网 Canvas 和 HTTP MCP 共用 Scene、WorkSession、WebSocket 与 `.datacanvas` 持久状态。

## 当前最新任务

**LC2 实现、云端 MCP 部署与流式饼图修复**。执行状态：**已执行待验收**。

技术验证已完成：本地 `npm run verify:core` 为 134/134；2026-09-17 云端 `openboard.service`、本机 health 与公网 health 均返回 revision 2；Playwright 真实浏览器验证过已连接 WebSocket、LC2 work stages 和居中的四分扇饼图。仍需用户自行确认实际交互体验满足预期。

## 架构/状态流

```text
MCP stdio 或 HTTP
  -> DataCanvasRuntime
  -> WorkSession overlay（ephemeral，不写 durable Scene）
  -> DuckDB inspect/count/stream（真实 chunks）
  -> 每个 chunk 的 immutable render artifact + ordered WebSocket event
  -> 浏览器 event queue：先同步创建 working card，再只刷新该 visual
  -> work.apply(commit)：一次 Scene revision/history/persistence 写入
```

浏览器先收到 `work.visual.changed`，显示真实草稿卡；数据到达后按 `work.render.chunk` 的 artifact generation 更新。不会用 timer/replay/拆分 bars 来伪造进度。查询很快时阶段仍可能很短，这是正常的真实执行结果。

## 关键文件

- `AGENTS.md`：不可违背的架构、LC 与显式 WorkSession 规则。
- `src/runtime/data-canvas-runtime.ts`：work orchestration、artifact generations、真实 stream、commit/cancel。
- `src/core/scene-store.ts`、`src/runtime/work-session-store.ts`：durable Scene/history 与 ephemeral overlay 的边界。
- `src/data/duckdb-engine.ts`：DuckDB inspect/query/count/stream。
- `src/web/server.ts`：HTTP API、`/ws`、HTTP MCP、asset/query-string 路由。
- `web/index.html`：working card、work event queue、增量 visual render 与画布 UI。
- `web/render-reconciler.js`、`web/render-motion.js`：keyed SVG reconciliation、arc-safe 动画。
- `src/index.ts`：stdio/HTTP MCP transport 与共享 runtime 装配。
- `contracts/tool-surface.json`、`contracts/events.schema.json`：冻结的 MCP/event 合同。
- `deploy/openboard.service`、`deploy/*.caddy`、`docs/remote-mcp.md`：云端运行和接入方式。
- `.datacanvas/`：真实持久 Scene/history/snapshots；同步部署时必须排除。

## 已核验命令

在当前工作树：

```bash
npm run verify:core
```

2026-09-17 结果：contracts 通过，TypeScript build 通过，134 个 Node 测试通过、0 fail。

云端只做无副作用检查：

```bash
curl -fsS https://boringmax.com/openboard/healthz
ssh tencent-vps 'systemctl --user is-active openboard.service'
```

最近结果：服务为 `active`，health 返回 `{status:"ok", service:"openboard", canvas_id:"openboard", revision:2}`。公网 Canvas 是 `https://boringmax.com/openboard/`；HTTP MCP 是 `/openboard/mcp`，需要环境变量中的 bearer token，绝不能写入仓库、日志或交接文档。

## 运行与部署注意事项

- 本地默认 `OPENBOARD_MCP_TRANSPORT=stdio`；共享部署使用 `http`，由同一 Node 进程同时服务 Canvas、`/ws` 和 `/mcp`。
- 云端是 systemd user service，监听 `127.0.0.1:4324`；Caddy 以 `/openboard` 反代。不要直接暴露 Node 端口，也不要启动第二个 MCP/runtime。
- 部署用 rsync 时排除 `.datacanvas/`、`node_modules/`、`dist/` 和 secret env 文件；先在云端 build，再 restart service，再检查 health。`.datacanvas` 被覆盖会把本地路径带到云端。
- Caddy 对 OpenBoard 路径必须发 `Cache-Control: no-store, max-age=0`。模块 URL 稳定时，旧缓存会让浏览器继续执行旧 renderer；当前 `render-motion.js` 另带发布查询参数作为一次性迁移保护。
- 浏览器初次连接会 reload durable scene 和 active work snapshots。正常图表操作不应重启服务或刷新页面。

## 后续 agent 工作规则

- 先读本文件、`AGENTS.md`、设计 spec、contracts 和相关测试，再改代码；以当前源码和测试为准，不按历史 audit 推断行为。
- Scene 必须 renderer-independent；不得写入 DOM/SVG/HTML。修改已有图优先 `visual.patch`，仅比较/分支才 clone。
- 分析型视觉操作必须显式 begin → 真实 inspect/query/render → commit/cancel；活动事件必须来自真实操作，禁止 fake progress。
- 不得 silent sampling；超 limit 必须返回 `render_limit_exceeded` 并要求显式 aggregate/bin/sample。
- 行为修改先写回归测试，再执行 `npm run verify:core`；提交前检查 `git diff --check` 与 staged scope。
- 不暴露 MCP token、云端 env、`.datacanvas` 内容或用户数据。

## 未决决策、风险与跨功能影响

- **合并决策**：`c2b2082` 尚在 LC2 分支；是否合入 `main` 需要用户确认并在合并前检查 main 的最新状态。
- **用户验收**：真实流在小数据上可能极快，不能人为减速。需由用户确认 working card/LC2 trail 的可见性是否符合产品预期。
- **权限与 token 分发**：用户明确先不处理权限；当前 HTTP MCP 是 bearer token 模式，后续多-agent 正式接入仍需决定密钥轮换、客户端配置与审计边界。
- **发布可靠性**：当前部署为人工 rsync + build + restart，尚无 CI/CD、蓝绿或自动回滚；Caddy no-store 牺牲静态资源缓存以保证 renderer 版本一致。
- **跨功能影响**：LC2 涉及 MCP schemas、Scene/work boundary、DuckDB streaming、WebSocket、浏览器 reconciliation、polar arcs 与 Caddy cache。后续修改必须回归 bar/line/area/dot、table/KPI、polar arc、history/persistence、layout-only 更新和远程 HTTP MCP。
