---
document_type: adr-index
authority: architecture-decisions
last_updated: 2026-07-29
---

# Rovai-ai Architecture Decision Records

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
| [ADR-0009](0009-reproducible-context-delivery.md) | Reproducible Context Materialization and Delivery | `superseded` | [v0.05](../versions/v0.05/README.md) | → ADR-0049 |
| [ADR-0010](0010-team-tool-a2a-execution.md) | Team Tool and Agent-to-Agent Execution | `superseded` | [v0.05](../versions/v0.05/README.md) | → ADR-0011 |
| [ADR-0011](0011-stable-team-tool-gateway.md) | Stable Team Tool Gateway and Native Binding Identity | `superseded` | [v0.05](../versions/v0.05/README.md) | ← ADR-0010；→ ADR-0014 |
| [ADR-0012](0012-collaboration-v3-lightweight-task.md) | Collaboration v3: Camp and Lightweight Task | `superseded` | [v0.06](../versions/v0.06/README.md) | ← ADR-0008；→ ADR-0058 |
| [ADR-0013](0013-managed-content-and-read-side-v2.md) | Managed Content and Read Side v2 | `accepted` | [v0.06](../versions/v0.06/README.md) | ← ADR-0005 |
| [ADR-0014](0014-stable-team-tool-gateway-v2.md) | Stable Team Tool Gateway v2 | `accepted` | [v0.06](../versions/v0.06/README.md) | ← ADR-0011；成员资格见 ADR-0058；Task Context/Memory tools 见 ADR-0067～0069 |
| [ADR-0015](0015-action-safety-v2.md) | Action and Safety v2 | `superseded` | [v0.06](../versions/v0.06/README.md) | ← ADR-0004；→ ADR-0059 |
| [ADR-0016](0016-multi-runtime-execution-v2.md) | Multi-Runtime Execution Boundary v2 | `superseded` | [v0.06](../versions/v0.06/README.md) | ← ADR-0003、ADR-0006；→ ADR-0065 |
| [ADR-0017](0017-managed-skill-library-runtime-projection.md) | Managed Skill Library and Runtime-Native Projection | `accepted` | [v0.08](../versions/v0.08/README.md) | — |
| [ADR-0018](0018-file-backed-mcp-library-runtime-projection.md) | File-Backed MCP Library and Per-Run Runtime Projection | `accepted` | [v0.09](../versions/v0.09/README.md) | 成员资格见 ADR-0057 |
| [ADR-0019](0019-application-global-memory-ownership.md) | Application-Global Memory Ownership | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0020](0020-user-authorized-memory-mutation.md) | User-Authorized Memory Mutation | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0032 |
| [ADR-0021](0021-atomic-memory-and-immutable-revisions.md) | Atomic Memory and Immutable Revisions | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0052 |
| [ADR-0022](0022-immutable-memory-scope.md) | Immutable Memory Scope | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0023](0023-transparent-relationship-direction.md) | Transparent Relationship Direction | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0035 |
| [ADR-0024](0024-closed-memory-kinds.md) | Closed Memory Kinds | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0069 |
| [ADR-0025](0025-proposal-scoped-memory-provenance.md) | Proposal-Scoped Memory Provenance | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0069 |
| [ADR-0026](0026-explicit-memory-supersession.md) | Explicit Memory Supersession | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0027](0027-memory-domain-forgetting.md) | Memory-Domain Forgetting | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0028](0028-advisory-memory-review.md) | Advisory Memory Review | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0033 |
| [ADR-0029](0029-bounded-memory-reactivation.md) | Bounded Memory Reactivation | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0030](0030-sqlite-memory-authority.md) | SQLite Memory Authority and Read-Only Projection | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0032 |
| [ADR-0031](0031-frozen-low-priority-memory-context.md) | Frozen Low-Priority Memory Context | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0032 |
| [ADR-0032](0032-user-authorized-live-memory-projection.md) | User-Authorized Live Memory Projection | `superseded` | [v0.10](../versions/v0.10/README.md) | ← ADR-0020、ADR-0030、ADR-0031；→ ADR-0053 |
| [ADR-0033](0033-advisory-memory-review-v2.md) | Advisory Memory Review v2 | `superseded` | [v0.10](../versions/v0.10/README.md) | ← ADR-0028；→ ADR-0052 |
| [ADR-0034](0034-agent-applicable-relationship-projection.md) | Agent-Applicable Relationship Projection | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0035 |
| [ADR-0035](0035-user-transparent-agent-applicable-relationship-memory.md) | User-Transparent, Agent-Applicable Relationship Memory | `superseded` | [v0.10](../versions/v0.10/README.md) | ← ADR-0023、ADR-0034；→ ADR-0068 |
| [ADR-0036](0036-agent-bounded-memory-proposal-scope.md) | Agent-Bounded Memory Proposal Scope | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0069 |
| [ADR-0037](0037-actor-bounded-relationship-proposal-direction.md) | Actor-Bounded Relationship Proposal Direction | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0069 |
| [ADR-0038](0038-memory-proposal-staleness.md) | Memory Proposal Staleness | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0069 |
| [ADR-0039](0039-memory-proposal-capability.md) | Memory Proposal Capability | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0069 |
| [ADR-0040](0040-terminal-memory-proposal-retention.md) | Terminal Memory Proposal Retention | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0069 |
| [ADR-0041](0041-agent-profile-status-memory-independence.md) | AgentProfile Status and Memory Independence | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0057 |
| [ADR-0042](0042-fail-closed-memory-projection.md) | Fail-Closed Memory Projection | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0068 |
| [ADR-0043](0043-memory-secret-filter.md) | Memory Secret Filter | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0054 |
| [ADR-0044](0044-per-proposal-user-confirmation.md) | Per-Proposal User Memory Confirmation | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0053 |
| [ADR-0045](0045-normalized-sqlite-memory-store.md) | Normalized SQLite Memory Store | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0070 |
| [ADR-0046](0046-memory-stewardship-bundled-skill.md) | Memory Stewardship Bundled Skill | `superseded` | [v0.10](../versions/v0.10/README.md) | → ADR-0054 |
| [ADR-0047](0047-user-initiated-memory-export-boundary.md) | User-Initiated Memory Export Boundary | `accepted` | [v0.10](../versions/v0.10/README.md) | — |
| [ADR-0048](0048-rovai-product-identity-and-legacy-namespace.md) | Rovai-ai Product Identity and Controlled Legacy Namespace Migration | `accepted` | [v0.11](../versions/v0.11/README.md) | — |
| [ADR-0049](0049-reproducible-context-delivery-v2.md) | Reproducible Context Delivery v2 | `superseded` | [v0.12](../versions/v0.12/README.md) | ← ADR-0009；→ ADR-0067 |
| [ADR-0050](0050-camp-shared-progressive-summaries.md) | Camp-Shared Progressive Summaries | `accepted` | [v0.12](../versions/v0.12/README.md) | — |
| [ADR-0051](0051-boundary-capped-context-retrieval.md) | Boundary-Capped Context Retrieval | `accepted` | [v0.12](../versions/v0.12/README.md) | — |
| [ADR-0052](0052-explicit-memory-revision-authority.md) | Explicit Memory Revision Authority | `superseded` | [v0.13](../versions/v0.13/README.md) | ← ADR-0021、ADR-0033；→ ADR-0069 |
| [ADR-0053](0053-user-preauthorized-provisional-companion-lessons.md) | User-Preauthorized Provisional Companion Lessons | `superseded` | [v0.13](../versions/v0.13/README.md) | ← ADR-0032、ADR-0044；→ ADR-0055 |
| [ADR-0054](0054-provisional-memory-safety-and-stewardship.md) | Provisional Memory Safety and Stewardship | `superseded` | [v0.13](../versions/v0.13/README.md) | ← ADR-0043、ADR-0046；→ ADR-0055 |
| [ADR-0055](0055-explicit-opt-in-provisional-companion-lessons.md) | Explicit Opt-In Provisional Companion Lessons | `superseded` | [v0.13](../versions/v0.13/README.md) | ← ADR-0053、ADR-0054；→ ADR-0064 |
| [ADR-0056](0056-controlled-member-avatar-assets.md) | Controlled Member Avatar References and Application-Managed Local Assets | `accepted` | [v0.14](../versions/v0.14/README.md) | — |
| [ADR-0057](0057-member-presence-and-retained-removal.md) | Member Presence and Retained Permanent Removal | `accepted` | [v0.15](../versions/v0.15/README.md) | ← ADR-0041；Memory Capability 条款见 ADR-0069 |
| [ADR-0058](0058-collaboration-v4-presence-aware-admission.md) | Collaboration v4: Presence-Aware Routing and Execution Admission | `accepted` | [v0.15](../versions/v0.15/README.md) | ← ADR-0012；Dynamic Task Context 条款见 ADR-0067 |
| [ADR-0059](0059-runtime-owned-resource-permissions.md) | Runtime-Owned Resource Permissions and Path-Only Run Workspace | `accepted` | [v0.16](../versions/v0.16/README.md) | ← ADR-0015 |
| [ADR-0060](0060-opaque-member-routing-identity.md) | Opaque Member Routing Identity and Globally Unique Names | `accepted` | [v0.16](../versions/v0.16/README.md) | 成员身份命名与提及规则细化 ADR-0057、ADR-0058 |
| [ADR-0061](0061-durable-agent-inaccessible-execution-evidence.md) | Durable User-Visible and Agent-Inaccessible Execution Evidence | `accepted` | [v0.17](../versions/v0.17/README.md) | 执行内容与 Read Side 边界细化 ADR-0013、ADR-0049 |
| [ADR-0062](0062-interruptible-runs-and-unsettled-external-effects.md) | Interruptible Run Trees and Unsettled External Effects | `accepted` | [v0.17](../versions/v0.17/README.md) | 取消与恢复边界细化 ADR-0016、ADR-0059 |
| [ADR-0063](0063-minimal-a2a-turn-envelope-and-reply-correlation.md) | Minimal A2A Turn Envelope and Trusted Reply Correlation | `superseded` | [v0.17](../versions/v0.17/README.md) | 局部替代 ADR-0049；→ ADR-0067 |
| [ADR-0064](0064-default-on-bounded-automatic-partner-memory.md) | Default-On Bounded Automatic Partner Memory Formation | `superseded` | v0.18 | ← ADR-0055；→ ADR-0069 |
| [ADR-0065](0065-verified-runtime-catalog-and-documentation-only-compatibility.md) | Verified Runtime Catalog and Documentation-Only Compatibility Evaluation | `accepted` | [v0.19](../versions/v0.19/README.md) | ← ADR-0016 |
| [ADR-0066](0066-managed-product-runtime-resolution.md) | Managed Product Runtime Discovery, Resolution, and Relocation | `accepted` | [v0.20](../versions/v0.20/README.md) | — |
| [ADR-0067](0067-native-session-bootstrap-and-agentrun-context-v3.md) | Native Session Bootstrap and AgentRun Context v3 | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0049、ADR-0063；局部替代 ADR-0014/ADR-0058 的 Task Context 条款 |
| [ADR-0068](0068-brokered-memory-retrieval-and-session-entrypoint.md) | Brokered Memory Retrieval and Session Entrypoint | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0035、ADR-0042 |
| [ADR-0069](0069-single-effective-memory-and-scope-bounded-agent-mutation.md) | Single Effective Memory and Scope-Bounded Agent Mutation | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0024、ADR-0025、ADR-0036～ADR-0040、ADR-0052、ADR-0064；局部替代 ADR-0057 的 Memory Capability 条款 |
| [ADR-0070](0070-normalized-sqlite-memory-store-v2.md) | Normalized SQLite Memory Store v2 | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0045 |
