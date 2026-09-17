# OpenBoard handoff pack

这套交接包刻意保持很小，避免多份状态文档漂移。

阅读顺序：

1. [`PROJECT_CONTEXT.md`](../../PROJECT_CONTEXT.md)：当前产品、架构、运行边界、风险和下一步。
2. [`AGENTS.md`](../../AGENTS.md)：实现时必须遵守的规则。
3. [`CHANGELOG.md`](CHANGELOG.md)：只追加重要、长期有效的变化。
4. 需要动代码时，再读设计 spec、contracts 与对应测试。

当前实现位于 `codex/lc2-retained-construction`；最新 LC2 提交是 `c2b2082`，尚待用户决定是否合入 `main`。
