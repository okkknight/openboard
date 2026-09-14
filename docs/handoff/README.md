# OpenBoard handoff

这是一个刻意保持精简的交接包，目标是让下一位 agent 在几分钟内恢复项目上下文；专题报告不在这里重复全文。

## 阅读顺序

1. [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md)：当前唯一的项目上下文与工作规则。
2. [`AGENTS.md`](../../AGENTS.md)：实现边界和不可违背的架构规则。
3. [`RENDERER_IMPLEMENTATION_REPORT.md`](../../openboard-lc2-engineering-package/source-audits/RENDERER_IMPLEMENTATION_REPORT.md)：最新 Renderer-specific audit，包含 LC2-A 建议。
4. [`LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md`](../../LIVE_CONSTRUCTION_IMPLEMENTATION_REPORT.md)：LC0+LC1 实现、事件和测试证据。
5. [`CHANGELOG.md`](CHANGELOG.md)：只记录有长期价值的交接变更。

设计合同和计划继续以 `contracts/`、`docs/superpowers/specs/`、`docs/superpowers/plans/` 为准；不要把旧的 `CURRENT_IMPLEMENTATION_*` 快照当作当前实现。
