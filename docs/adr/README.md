---
document_type: adr-index
authority: architecture-decisions
last_updated: 2026-07-25
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
| [ADR-0003](0003-execution-runtime.md) | Execution Runtime | `superseded` | [v0.02](../versions/v0.02/README.md) | → ADR-0016 |
| [ADR-0004](0004-action-safety.md) | Action & Safety | `superseded` | [v0.02](../versions/v0.02/README.md) | → ADR-0015 |
| [ADR-0005](0005-evidence-read-side.md) | Evidence & Read Side | `superseded` | [v0.02](../versions/v0.02/README.md) | → ADR-0013 |
| [ADR-0006](0006-multi-runtime-adapter-boundary.md) | Multi-Runtime Adapter Boundary | `superseded` | [v0.03](../versions/v0.03/README.md) | → ADR-0016 |
| [ADR-0007](0007-portable-conversation-handoff.md) | Portable Conversation Handoff | `accepted` | [v0.03](../versions/v0.03/README.md) | — |
| [ADR-0008](0008-collaboration-v2.md) | Collaboration v2: Camp-Centered Navigation and Lifecycle | `superseded` | [v0.04](../versions/v0.04/README.md) | ← ADR-0002；→ ADR-0012 |
| [ADR-0009](0009-reproducible-context-delivery.md) | Reproducible Context Materialization and Delivery | `accepted` | [v0.05](../versions/v0.05/README.md) | — |
| [ADR-0010](0010-team-tool-a2a-execution.md) | Team Tool and Agent-to-Agent Execution | `superseded` | [v0.05](../versions/v0.05/README.md) | → ADR-0011 |
| [ADR-0011](0011-stable-team-tool-gateway.md) | Stable Team Tool Gateway and Native Binding Identity | `superseded` | [v0.05](../versions/v0.05/README.md) | ← ADR-0010；→ ADR-0014 |
| [ADR-0012](0012-collaboration-v3-lightweight-task.md) | Collaboration v3: Camp and Lightweight Task | `accepted` | [v0.06](../versions/v0.06/README.md) | ← ADR-0008 |
| [ADR-0013](0013-managed-content-and-read-side-v2.md) | Managed Content and Read Side v2 | `accepted` | [v0.06](../versions/v0.06/README.md) | ← ADR-0005 |
| [ADR-0014](0014-stable-team-tool-gateway-v2.md) | Stable Team Tool Gateway v2 | `accepted` | [v0.06](../versions/v0.06/README.md) | ← ADR-0011 |
| [ADR-0015](0015-action-safety-v2.md) | Action and Safety v2 | `accepted` | [v0.06](../versions/v0.06/README.md) | ← ADR-0004 |
| [ADR-0016](0016-multi-runtime-execution-v2.md) | Multi-Runtime Execution Boundary v2 | `accepted` | [v0.06](../versions/v0.06/README.md) | ← ADR-0003、ADR-0006 |
| [ADR-0017](0017-managed-skill-library-runtime-projection.md) | Managed Skill Library and Runtime-Native Projection | `accepted` | [v0.08](../versions/v0.08/README.md) | — |
| [ADR-0018](0018-file-backed-mcp-library-runtime-projection.md) | File-Backed MCP Library and Per-Run Runtime Projection | `accepted` | [v0.09](../versions/v0.09/README.md) | — |
| [ADR-0019](0019-application-global-memory-ownership.md) | Application-Global Memory Ownership | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0020](0020-user-authorized-memory-mutation.md) | User-Authorized Memory Mutation | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0032 |
| [ADR-0021](0021-atomic-memory-and-immutable-revisions.md) | Atomic Memory and Immutable Revisions | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0022](0022-immutable-memory-scope.md) | Immutable Memory Scope | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0023](0023-transparent-relationship-direction.md) | Transparent Relationship Direction | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0035 |
| [ADR-0024](0024-closed-memory-kinds.md) | Closed Memory Kinds | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0025](0025-proposal-scoped-memory-provenance.md) | Proposal-Scoped Memory Provenance | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0026](0026-explicit-memory-supersession.md) | Explicit Memory Supersession | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0027](0027-memory-domain-forgetting.md) | Memory-Domain Forgetting | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0028](0028-advisory-memory-review.md) | Advisory Memory Review | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0033 |
| [ADR-0029](0029-bounded-memory-reactivation.md) | Bounded Memory Reactivation | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0030](0030-sqlite-memory-authority.md) | SQLite Memory Authority and Read-Only Projection | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0032 |
| [ADR-0031](0031-frozen-low-priority-memory-context.md) | Frozen Low-Priority Memory Context | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0032 |
| [ADR-0032](0032-user-authorized-live-memory-projection.md) | User-Authorized Live Memory Projection | `accepted` | [v0.10](../versions/v0.10/README.md) | ← ADR-0020、ADR-0030、ADR-0031 |
| [ADR-0033](0033-advisory-memory-review-v2.md) | Advisory Memory Review v2 | `accepted` | [v0.10](../versions/v0.10/README.md) | ← ADR-0028 |
| [ADR-0034](0034-agent-applicable-relationship-projection.md) | Agent-Applicable Relationship Projection | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0035 |
| [ADR-0035](0035-user-transparent-agent-applicable-relationship-memory.md) | User-Transparent, Agent-Applicable Relationship Memory | `accepted` | [v0.10](../versions/v0.10/README.md) | ← ADR-0023、ADR-0034 |
| [ADR-0036](0036-agent-bounded-memory-proposal-scope.md) | Agent-Bounded Memory Proposal Scope | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0037](0037-actor-bounded-relationship-proposal-direction.md) | Actor-Bounded Relationship Proposal Direction | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0038](0038-memory-proposal-staleness.md) | Memory Proposal Staleness | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0039](0039-memory-proposal-capability.md) | Memory Proposal Capability | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0040](0040-terminal-memory-proposal-retention.md) | Terminal Memory Proposal Retention | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0041](0041-agent-profile-status-memory-independence.md) | AgentProfile Status and Memory Independence | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0042](0042-fail-closed-memory-projection.md) | Fail-Closed Memory Projection | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0043](0043-memory-secret-filter.md) | Memory Secret Filter | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0044](0044-per-proposal-user-confirmation.md) | Per-Proposal User Memory Confirmation | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0045](0045-normalized-sqlite-memory-store.md) | Normalized SQLite Memory Store | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0046](0046-memory-stewardship-bundled-skill.md) | Memory Stewardship Bundled Skill | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0047](0047-user-initiated-memory-export-boundary.md) | User-Initiated Memory Export Boundary | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
