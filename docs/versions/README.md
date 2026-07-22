---
document_type: versions-index
authority: version-lifecycle
current_version: v0.03
last_updated: 2026-07-22
---

# Lumen AI 版本记录

`docs/versions/` 保存版本目标、版本内设计过程、实施计划、验收记录和发布范围。开始使用前先阅读 [文档导航](../README.md)；跨版本长期约束以 [有效 ADR](../adr/README.md) 为准。

## 生命周期

- `current`：唯一的当前版本，可以随范围、实施和验收事实更新。
- `historical`：已经冻结的历史快照，仅用于解释当时背景，不约束当前实现。
- 进入下一版本时，先冻结当前版本，再更新本文件 Front Matter 中唯一的 `current_version`。
- 历史文档只修复错字、失效链接或增加明确勘误，不根据新代码重写原始判断。
- 需要跨版本长期成立的决定必须提升为 ADR；版本文档只保留版本影响和 ADR 链接。

## 版本索引

| 版本 | 生命周期 | 内容 | 入口 |
|---|---|---|---|
| v0.01 | `historical` | 本地优先单 Agent 执行基线 | [v0.01/README.md](v0.01/README.md) |
| v0.02 | `historical` | 多 Agent 协作控制平面架构与验收快照 | [v0.02/README.md](v0.02/README.md) |
| v0.03 | `current` | 多 Runtime 成员管理；五个实施检查点已完成，保持预发布状态 | [v0.03/README.md](v0.03/README.md) |
