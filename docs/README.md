---
document_type: documentation-index
authority: documentation-routing
current_version: v0.27
last_updated: 2026-07-31
---

# Rovai-ai 文档导航

本文件定义 `docs/` 的职责、权威边界和读取顺序。人和 AI 在处理架构、实现、规划或文档任务前，应先从这里判断需要读取哪些资料，而不是默认加载全部历史文档。

## 按任务读取

| 任务 | 必读资料 |
|---|---|
| 判断长期架构约束或修改领域、持久化、安全、Runtime 边界 | [ADR 索引](adr/README.md)及相关有效 ADR |
| 判断当前版本目标、范围、进度或验收口径 | [当前版本 v0.27](versions/v0.27/README.md)及[实施计划](versions/v0.27/implementation-plan.md) |
| 查询已接入与候选 Agent Runtime 的实测兼容性 | [Runtime 兼容性清单](runtime-compatibility.md) |
| 理解历史设计与演进原因 | [版本索引](versions/README.md)及对应历史版本；历史内容不能作为当前约束 |
| 修改 Renderer UI/UX | [UI 规范索引](ui/README.md)；修改当前 Arctic Dawn Renderer 时继续读取[Arctic Dawn V3 设计规范](ui/arctic-dawn.md) |
| 本地运行、测试、Smoke Test 或 macOS 构建 | [开发者指南](development/README.md) |

读取相关文档后，仍必须检查目标代码、Migration 和测试；文档不能替代实施事实。

## 目录职责

### `docs/adr/`

保存已经提升为跨版本约束的架构决策。ADR 回答“为什么必须这样设计、最终选择了什么、拒绝了什么、改变会产生什么后果”。

- 有效 ADR 是架构规范真源。
- `accepted` 表示决策已确认，不表示代码已经实现。
- 已接受决策发生语义变化时，以新 ADR 替代旧 ADR，不直接改写历史理由。
- 实施进度、任务清单、测试流水账和版本缺口不属于 ADR。

完整规则见 [ADR README](adr/README.md)。

### `docs/versions/`

保存各版本的目标、版本内设计过程、实施计划、验收记录和发布范围。

- `lifecycle: current` 的版本可以随实施事实更新。
- `lifecycle: historical` 的版本是历史快照，不约束当前实现。
- 需要跨版本长期成立的决定必须提升为 ADR；版本文档只保留版本影响摘要和 ADR 链接。

完整规则与当前版本指针见 [版本索引](versions/README.md)。

### 其他文档

`runtime-compatibility.md` 保存 Agent Runtime 实测兼容性证据；`docs/ui/` 和
`docs/development/` 分别拥有 UI 规范与本地开发流程。它们都不是领域架构或版本状态
真源。`local-development.md` 只保留为历史链接的兼容入口。

## 权威性与冲突处理

不存在一个覆盖所有问题的单一优先级，必须先判断问题类型：

- “系统应当遵守什么架构约束”：读取状态有效的 ADR。
- “当前版本要交付什么、进展如何”：读取当前版本文档。
- “仓库现在实际实现了什么”：检查代码、Migration、测试和可复现验收证据。

如果三者不一致，必须明确报告“文档—实现漂移”，指出冲突位置和缺失证据；禁止静默选择一种说法，也禁止用 `Accepted` 推断“已实现”。

## AI 使用规则

1. 先读取本文，再按任务选择最小必要文档集。
2. 只把有效 ADR 当作跨版本规范；先检查 `status` 与 `superseded_by`。
3. 只把版本索引标记的当前版本用于当前范围和状态判断。
4. 历史版本可用于解释背景，不得覆盖有效 ADR 或当前代码事实。
5. 引用决策时使用 ADR ID；引用实施状态时同时给出代码、Migration、测试或验收依据。
