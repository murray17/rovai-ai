---
document_type: adr-index
authority: architecture-decisions
last_updated: 2026-07-23
---

# Lumen Architecture Decision Records

本目录保存已经提升为跨版本约束、直接影响实现且改变成本较高的 Architecture Decision Record（ADR）。有效 ADR 是“系统应当遵守什么架构边界”的规范真源；代码、Migration 和测试才是“已经实现了什么”的事实依据。

开始阅读前先查看 [文档导航](../README.md)。创建新 ADR 使用 [TEMPLATE.md](TEMPLATE.md)。

## 收录标准

只有同时具备长期影响和明显逆转成本的决定才进入 ADR，例如领域边界、持久化真源、并发与恢复协议、安全边界、跨 Runtime 接口和高成本迁移策略。

以下内容留在当前版本文档，不创建 ADR：

- 可在单个版本内调整的产品范围或 UI 细节；
- 实施步骤、检查点、任务列表和发布进度；
- 测试运行结果、环境探测记录和临时兼容措施；
- 尚未形成明确取舍的问题清单。

一份新 ADR 只解决一个关键决策。现有 ADR-0001～0005 作为早期实施包级基线保留，不拆分或重编号。

## 生命周期

| 状态 | 含义 |
|---|---|
| `proposed` | 正在讨论，可以修改或撤回 |
| `accepted` | 决策已确认，规范语义冻结 |
| `superseded` | 已被 `superseded_by` 指向的新 ADR 替代，仅作为历史依据 |
| `rejected` | 已明确否决，不构成规范约束 |

- `accepted` 只表示决策成立，不表示实现完成。
- 已接受 ADR 只允许修正错字、链接、元数据或不改变语义的表达。
- 改变边界、约束或后果时必须创建新 ADR，并在新旧文件中维护 `supersedes` / `superseded_by`。
- 当前有效 ADR 必须同时满足 `status: accepted` 且 `superseded_by: null`。
- 实施状态和遗留缺口只能记录在当前版本文档中。

## 必需结构

每份 ADR 使用稳定 YAML Front Matter，并包含 `Context`、`Decision`、`Consequences`、`Rejected Alternatives` 和 `References`。字段名与状态值使用模板中的英文枚举，正文语言可以按主题选择中文或英文。

ADR 必须能独立解释最终决定。`References` 可以链接版本讨论、代码或测试，但不能把理解规范所需的关键语义外包给历史文档。

## 决策索引

| ADR | 决策 | 状态 | 来源版本 | 替代关系 |
|---|---|---|---|---|
| [ADR-0001](0001-core-transaction.md) | Core Transaction | `accepted` | [v0.02](../versions/v0.02/README.md) | — |
| [ADR-0002](0002-collaboration.md) | Collaboration | `superseded` | [v0.02](../versions/v0.02/README.md) | → ADR-0008 |
| [ADR-0003](0003-execution-runtime.md) | Execution Runtime | `accepted` | [v0.02](../versions/v0.02/README.md) | — |
| [ADR-0004](0004-action-safety.md) | Action & Safety | `accepted` | [v0.02](../versions/v0.02/README.md) | — |
| [ADR-0005](0005-evidence-read-side.md) | Evidence & Read Side | `accepted` | [v0.02](../versions/v0.02/README.md) | — |
| [ADR-0006](0006-multi-runtime-adapter-boundary.md) | Multi-Runtime Adapter Boundary | `accepted` | [v0.03](../versions/v0.03/README.md) | — |
| [ADR-0007](0007-portable-conversation-handoff.md) | Portable Conversation Handoff | `accepted` | [v0.03](../versions/v0.03/README.md) | — |
| [ADR-0008](0008-collaboration-v2.md) | Collaboration v2: Camp-Centered Navigation and Lifecycle | `accepted` | [v0.04](../versions/v0.04/README.md) | ← ADR-0002 |
| [ADR-0009](0009-reproducible-context-delivery.md) | Reproducible Context Materialization and Delivery | `accepted` | [v0.05](../versions/v0.05/README.md) | — |
| [ADR-0010](0010-team-tool-a2a-execution.md) | Team Tool and Agent-to-Agent Execution | `superseded` | [v0.05](../versions/v0.05/README.md) | → ADR-0011 |
| [ADR-0011](0011-stable-team-tool-gateway.md) | Stable Team Tool Gateway and Native Binding Identity | `accepted` | [v0.05](../versions/v0.05/README.md) | ← ADR-0010 |
