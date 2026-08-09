---
document_type: documentation-index
authority: documentation-routing
last_updated: 2026-08-08
---

# Rovai-ai 文档导航

本文件定义 `docs/` 的职责、权威边界和读取顺序。人和 AI 在处理架构、实现、规划或文档任务前，应先从这里判断需要读取哪些资料，而不是默认加载全部历史文档。

## 按任务读取

| 任务 | 必读资料 |
|---|---|
| 判断长期架构约束或修改领域、持久化、安全、Runtime 边界 | [ADR 索引](adr/README.md)及相关有效 ADR |
| 判断当前版本目标、范围、进度或验收口径 | 从[版本索引中的唯一 `current` 条目](versions/README.md)进入对应版本概览与实施计划 |
| 查询已接入与候选 Agent Runtime 的实测兼容性 | [Runtime 兼容性清单](runtime-compatibility.md) |
| 新增或修改 Runtime Activity 映射规则 | [Runtime Activity Mapping 维护指南](runtime-activity/README.md)及[Registry](runtime-activity/registry.md) |
| 修改内置 Agent CLI、IPC、Envelope、receipt、Projection 或幂等合同 | [Built-in Tool Transport v4 合同](contracts/builtin-tool-transport-v4.md)及[Camp Message Send v2](contracts/camp-message-send-v2.md) |
| 修改 Task 状态、字段、可见性、权限、列表、CampMember 关系结束与收口或 linked execution 准入 | [Durable Task v2 合同](contracts/durable-task-v2.md)、[ADR-0136](adr/0136-durable-task-v2-responsibility-and-coordination-authority.md)及[ADR-0137](adr/0137-one-time-task-linked-responsibility-admission.md) |
| 修改 AgentRun 公共消息、正文截断、引用链、遗漏提示或投递 Profile | [ADR-0132](adr/0132-public-reference-context-closure-profile-v2.md)、[Context Delivery Profile v2](contracts/context-delivery-profile-v2.md)及[Message Delivery v1](contracts/message-delivery-v1.md) |
| 理解内置 CLI、Core Router、Runtime Fleet、Bootstrap 与外部 MCP 的长期结构 | [Built-in Tool Runtime 架构](architecture/builtin-tool-runtime.md) |
| 修改 Native Session compaction detector、Observer Lease、Runtime 补发 policy、Bootstrap Delivery Gate 或 redelivery payload | [Native Session Bootstrap Redelivery 架构](architecture/native-session-bootstrap-redelivery.md)、[ADR-0138](adr/0138-durable-bootstrap-redelivery-requirement.md)至[ADR-0143](adr/0143-best-effort-non-blocking-compaction-detector-capability.md) |
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

`runtime-compatibility.md` 保存 Agent Runtime 实测兼容性证据；`docs/runtime-activity/` 长期维护
跨 Runtime 活动映射目录和变更门禁；`docs/ui/` 和
`docs/development/` 分别拥有 UI 规范与本地开发流程。它们都不是领域架构或版本状态
真源。`local-development.md` 只保留为历史链接的兼容入口。

`docs/contracts/` 保存字段级、可测试的长期接口合同；`docs/architecture/` 保存跨版本系统结构、
组件职责和权威边界。版本文档只引用它们，不复制完整协议或长期架构。

`docs/postmortems/` stores blameless incident analyses, evidence, and corrective-action tracking.
Postmortems explain how failures occurred and how recurrence risk is reduced; they do not replace
accepted ADRs, current-version contracts, or implementation evidence.

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
