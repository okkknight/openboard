# Handoff changelog

本文件 append-only，只写能帮助后续 agent 恢复工作的长期事实，不重复完整状态报告。

## 2026-09-17

- `c2b2082` 完成 LC2 retained construction：显式 WorkSession 入口、真实 DuckDB chunk stream、per-chunk immutable artifact、ordered work event、仅受影响卡片更新、working draft 首帧和 keyed reconciliation。
- 修复 polar arc 在进入动画中被 CSS transform 覆盖的问题；streamed total 改变时原子替换 arc layer，浏览器实测饼图保持居中。
- 增加共享云端 runtime：同一进程服务 Canvas、WebSocket 和 bearer-protected HTTP MCP；新增 systemd/Caddy/agent 接入文档。部署同步必须排除 `.datacanvas/`。
- Caddy 对 OpenBoard 设置 no-store，server 以 `url.pathname` 路由页面与 modules，避免发布后旧 renderer 缓存和带查询参数资产 404。
- 最后本地核验 `npm run verify:core` 为 134/134；云端 `openboard.service` active，公网 health revision 2。用户最终体验验收仍待完成；该提交仍未合入 `main`。

## 2026-09-14

- LC0+LC1 已在 `main` 落地：WorkSession working overlay、真实 activity、ordered work events、一次性 durable commit，以及 `/api/works`/WebSocket snapshot。
- Renderer-specific audit 已完成并提交为 `35d71f1`：`RENDERER_IMPLEMENTATION_REPORT.md` 与 `RENDERER_DOM_MAP.txt`。结论是卡片保留、图内 SVG 重建；后续 LC2-A 推荐 B — RenderArtifact diff。
- 交接包创建完成：根目录 `PROJECT_CONTEXT.md`、本目录 `README.md` 与本文件。
- 最新核验：`npm run verify:core` 通过 86/86；本地服务 `127.0.0.1:3000` 的根页面和 `/api/scene` 返回 HTTP 200；当前 Scene revision 为 24。

## 2026-09-14 — LC2 package audit relocation

- 四份审计材料已归档到 `openboard-lc2-engineering-package/source-audits/`；根目录交接链接改为指向该位置。
- 其中 `CURRENT_IMPLEMENTATION_*` 明确标记为 LC0+LC1 前的历史快照；后续实现必须以当前源码、测试和 `LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md` 判断现状。
