# OpenBoard 当前状态

OpenBoard 的 V1 M0/M1 已落地在 `main`：本地数据发现与 DuckDB 查询、Scene/历史持久化、九个 MCP 工具、Observable Plot 分层渲染、WebSocket 实时画布，以及真实浏览器验收均已接通。

主要入口：

- `npm start`：启动本地 daemon，默认在 `http://127.0.0.1:3000` 提供画布。
- `npm run verify:core`：合同校验、TypeScript 构建和全部核心/集成测试。
- `examples/orders.csv`：默认示例数据。
- `.datacanvas/`：运行时保存 scene、JSONL 操作、revision snapshots、checkpoint/fork 元数据；不保存 HTML/DOM。

当前边界仍按 V1 设计冻结：本地单进程、只读数据查询、文本注释、Plot 分层 marks；不包含云同步、认证、BI 管理台、字段选择器或内嵌聊天。
