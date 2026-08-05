---
document_type: adr-index
authority: architecture-decisions
last_updated: 2026-08-05
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
| [ADR-0014](0014-stable-team-tool-gateway-v2.md) | Stable Team Tool Gateway v2 | `accepted` | [v0.06](../versions/v0.06/README.md) | ← ADR-0011；成员资格见 ADR-0058；Task Context/Memory tools 见 ADR-0067～0069；进程证明 attachment 见 ADR-0088 |
| [ADR-0015](0015-action-safety-v2.md) | Action and Safety v2 | `superseded` | [v0.06](../versions/v0.06/README.md) | ← ADR-0004；→ ADR-0059 |
| [ADR-0016](0016-multi-runtime-execution-v2.md) | Multi-Runtime Execution Boundary v2 | `superseded` | [v0.06](../versions/v0.06/README.md) | ← ADR-0003、ADR-0006；→ ADR-0065 |
| [ADR-0017](0017-managed-skill-library-runtime-projection.md) | Managed Skill Library and Runtime-Native Projection | `superseded` | [v0.08](../versions/v0.08/README.md) | → ADR-0105 |
| [ADR-0018](0018-file-backed-mcp-library-runtime-projection.md) | File-Backed MCP Library and Per-Run Runtime Projection | `accepted` | [v0.09](../versions/v0.09/README.md) | 成员资格见 ADR-0057；内部 Team Gateway attachment 例外见 ADR-0088 |
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
| [ADR-0056](0056-controlled-member-avatar-assets.md) | Controlled Member Avatar References and Application-Managed Local Assets | `accepted` | [v0.14](../versions/v0.14/README.md) | 内置外观版本与升级保护条款见 ADR-0086 |
| [ADR-0057](0057-member-presence-and-retained-removal.md) | Member Presence and Retained Permanent Removal | `accepted` | [v0.15](../versions/v0.15/README.md) | ← ADR-0041；Memory Capability 条款见 ADR-0069 |
| [ADR-0058](0058-collaboration-v4-presence-aware-admission.md) | Collaboration v4: Presence-Aware Routing and Execution Admission | `accepted` | [v0.15](../versions/v0.15/README.md) | ← ADR-0012；Dynamic Task Context 条款见 ADR-0067；Camp 创建与 Conversation 分配条款见 ADR-0071 |
| [ADR-0059](0059-runtime-owned-resource-permissions.md) | Runtime-Owned Resource Permissions and Path-Only Run Workspace | `accepted` | [v0.16](../versions/v0.16/README.md) | ← ADR-0015 |
| [ADR-0060](0060-opaque-member-routing-identity.md) | Opaque Member Routing Identity and Globally Unique Names | `accepted` | [v0.16](../versions/v0.16/README.md) | 成员身份命名与提及规则细化 ADR-0057、ADR-0058 |
| [ADR-0061](0061-durable-agent-inaccessible-execution-evidence.md) | Durable User-Visible and Agent-Inaccessible Execution Evidence | `accepted` | [v0.17](../versions/v0.17/README.md) | 执行内容与 Read Side 边界细化 ADR-0013、ADR-0049 |
| [ADR-0062](0062-interruptible-runs-and-unsettled-external-effects.md) | Interruptible Run Trees and Unsettled External Effects | `accepted` | [v0.17](../versions/v0.17/README.md) | 取消与恢复边界细化 ADR-0016、ADR-0059 |
| [ADR-0063](0063-minimal-a2a-turn-envelope-and-reply-correlation.md) | Minimal A2A Turn Envelope and Trusted Reply Correlation | `superseded` | [v0.17](../versions/v0.17/README.md) | 局部替代 ADR-0049；→ ADR-0067 |
| [ADR-0064](0064-default-on-bounded-automatic-partner-memory.md) | Default-On Bounded Automatic Partner Memory Formation | `superseded` | v0.18 | ← ADR-0055；→ ADR-0069 |
| [ADR-0065](0065-verified-runtime-catalog-and-documentation-only-compatibility.md) | Verified Runtime Catalog and Documentation-Only Compatibility Evaluation | `accepted` | [v0.19](../versions/v0.19/README.md) | ← ADR-0016；受证明的 preserved-ambient Team attachment 见 ADR-0088 |
| [ADR-0066](0066-managed-product-runtime-resolution.md) | Managed Product Runtime Discovery, Resolution, and Relocation | `accepted` | [v0.20](../versions/v0.20/README.md) | — |
| [ADR-0067](0067-native-session-bootstrap-and-agentrun-context-v3.md) | Native Session Bootstrap and AgentRun Context v3 | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0049、ADR-0063；局部替代 ADR-0014/ADR-0058 的 Task Context 条款；Bootstrap 身份与恢复条款见 ADR-0100 |
| [ADR-0068](0068-brokered-memory-retrieval-and-session-entrypoint.md) | Brokered Memory Retrieval and Session Entrypoint | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0035、ADR-0042 |
| [ADR-0069](0069-single-effective-memory-and-scope-bounded-agent-mutation.md) | Single Effective Memory and Scope-Bounded Agent Mutation | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0024、ADR-0025、ADR-0036～ADR-0040、ADR-0052、ADR-0064；局部替代 ADR-0057 的 Memory Capability 条款 |
| [ADR-0070](0070-normalized-sqlite-memory-store-v2.md) | Normalized SQLite Memory Store v2 | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0045 |
| [ADR-0071](0071-configured-camp-creation-and-lazy-conversations.md) | Configured Camp Creation and Lazy Conversations | `accepted` | [v0.22](../versions/v0.22/README.md) | 局部替代 ADR-0058 的 Camp 创建、空 Camp 与 Conversation 分配条款 |
| [ADR-0072](0072-directory-workspace-and-dynamic-git-capability.md) | Directory Workspace Identity and Dynamic Git Capability | `accepted` | [v0.23](../versions/v0.23/README.md) | 局部替代 ADR-0071 的 Repository/Project Binding 条款；Quick Chat 命名与 binding literal 见 ADR-0074 |
| [ADR-0073](0073-agent-authored-a2a-conversation-messages.md) | Agent-Authored A2A Conversation Messages | `accepted` | [v0.24](../versions/v0.24/README.md) | 细化 ADR-0014 的 A2A 用户可见呈现与 ADR-0013 的 Read Side 边界 |
| [ADR-0074](0074-quick-chat-ubiquitous-language-and-binding-identity.md) | Quick Chat Ubiquitous Language and Binding Identity | `accepted` | [v0.24](../versions/v0.24/README.md) | 局部替代 ADR-0071、ADR-0072 的 Lobby 命名与 binding literal |
| [ADR-0075](0075-runtime-integrity-at-change-and-execution-boundaries.md) | Runtime Integrity at Change and Execution Boundaries | `accepted` | [v0.24](../versions/v0.24/README.md) | 局部替代 ADR-0066 的发送准入与 fingerprint 时机 |
| [ADR-0076](0076-message-first-agent-run-dispatch-boundary.md) | Message-First AgentRun Dispatch Boundary | `accepted` | [v0.24](../versions/v0.24/README.md) | 局部替代 ADR-0058、ADR-0066、ADR-0075 的发送/执行检查时机 |
| [ADR-0077](0077-responsive-camp-turn-cancellation-boundary.md) | Responsive CampTurn Cancellation Boundary | `accepted` | [v0.24](../versions/v0.24/README.md) | 细化 ADR-0062 的取消请求、Renderer 对账与 ending Git observation 时机 |
| [ADR-0078](0078-navigation-projection-and-sidebar-wordmark-boundary.md) | Navigation Projection and Sidebar Wordmark Boundary | `accepted` | [v0.24](../versions/v0.24/README.md) | 细化 ADR-0048 的侧栏字标与 ADR-0074 的 Renderer 导航投影；不改变正式身份或领域合同 |
| [ADR-0079](0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md) | Two-Phase Cancellation Projection and Bounded Runtime Interrupt | `accepted` | [v0.24](../versions/v0.24/README.md) | 细化 ADR-0077 的 Run 级本地投影、Runtime deadline、并行 interrupt 与 fencing |
| [ADR-0080](0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md) | Durable Camp Composer Draft and Atomic Attachment Consumption | `accepted` | [v0.25](../versions/v0.25/README.md) | 细化 ADR-0001、ADR-0076 的 Draft 所有权与消息提交边界 |
| [ADR-0081](0081-camp-public-attachment-paths-and-frozen-discovery.md) | Camp-Public Attachment Paths and Frozen Discovery | `accepted` | [v0.25](../versions/v0.25/README.md) | 局部替代 ADR-0013 的附件 Blob 权威和 ADR-0067 的 Run Attachment Projection 条款 |
| [ADR-0082](0082-member-owned-runtime-parameters.md) | Member-Owned Runtime Parameters and Explicit Configuration | `accepted` | [v0.26](../versions/v0.26/README.md) | 局部替代 ADR-0066 的 AdapterKind-only 成员偏好与保守默认值条款 |
| [ADR-0083](0083-background-runtime-checks-and-actionable-status.md) | Background Runtime Checks and Actionable User Status | `accepted` | [v0.26](../versions/v0.26/README.md) | 局部替代 ADR-0066 的检查调度、成员保存和用户状态投影条款 |
| [ADR-0084](0084-conversation-surface-controls-and-stop-outcome-projection.md) | Conversation Surface Controls and Stop Outcome Projection | `accepted` | [v0.26](../versions/v0.26/README.md) | 细化 ADR-0062、ADR-0077、ADR-0079 的会话停止投影与 Inspector 呈现 |
| [ADR-0085](0085-run-frozen-six-field-member-identity-context.md) | Run-Frozen Six-Field Member Identity Context | `superseded` | [v0.27](../versions/v0.27/README.md) | → ADR-0100 |
| [ADR-0086](0086-single-current-built-in-member-appearance-set.md) | Single Current Built-In Member Appearance Set | `accepted` | [v0.27](../versions/v0.27/README.md) | 局部替代 ADR-0056 的内置外观版本与升级保护条款 |
| [ADR-0087](0087-core-owned-durable-in-app-notification-inbox.md) | Core-Owned Durable In-App Notification Inbox | `accepted` | [v0.28](../versions/v0.28/README.md) | 细化 ADR-0001、ADR-0013 的用户注意力投影与 Read Side 边界 |
| [ADR-0088](0088-attested-native-team-gateway-attachment.md) | Attested Native Team Gateway Attachment | `accepted` | [v0.30](../versions/v0.30/README.md) | 局部替代 ADR-0014 的 Connector credential/Antigravity 条款、ADR-0018 的内部 Team MCP 同路投影条款，并落实 ADR-0065 的 preserved-ambient 准入路径；完整内置工具对等见 ADR-0089 |
| [ADR-0089](0089-attested-built-in-mcp-tool-parity.md) | Attested Built-in MCP Tool Parity | `accepted` | [v0.31](../versions/v0.31/README.md) | 扩展 ADR-0088 的首阶段单工具 attachment；不改变 preserved ambient 与 external projection 边界 |
| [ADR-0090](0090-team-delivery-qualification-evidence-boundary.md) | Team Delivery Qualification Evidence Boundary | `accepted` | [v0.31](../versions/v0.31/README.md) | 首次冻结默认团队交付资格、外部验证、零人工和证据边界 |
| [ADR-0091](0091-durable-member-calls-and-single-slot-a2a-resume.md) | Durable Member Calls and Single-Slot A2A Resume Scheduling | `superseded` | [v0.32](../versions/v0.32/README.md) | → ADR-0099 |
| [ADR-0092](0092-recoverable-qualification-evaluation-integrity.md) | Recoverable Qualification Evaluation Integrity | `accepted` | [v0.34](../versions/v0.34/README.md) | 局部替代 ADR-0090 的投递后评测器故障与无效边界 |
| [ADR-0093](0093-core-owned-atomic-campturn-execution-budgets.md) | Core-Owned Atomic CampTurn Execution Budgets | `accepted` | [v0.34](../versions/v0.34/README.md) | 用通用 Core 准入合同原子实施 Trial 的时间、Run 与 A2A 预算 |
| [ADR-0094](0094-formal-qualification-isolation-and-effect-coverage.md) | Formal Qualification Isolation and External Effect Coverage | `accepted` | [v0.34](../versions/v0.34/README.md) | 以专用执行环境证明零人工与外部副作用收口；共享用户和 uncontrolled ambient MCP 仅诊断 |
| [ADR-0095](0095-layered-qualification-authority-and-semantic-review.md) | Layered Qualification Authority and Advisory Semantic Review | `accepted` | [v0.34](../versions/v0.34/README.md) | 冻结五层报告的单一 Hard Outcome 权威与 LLM Judge 顾问边界 |
| [ADR-0096](0096-core-owned-structured-mentions-and-derived-addressing.md) | Core-Owned Structured Mentions and Mention-Derived Camp Addressing | `accepted` | v0.33 | 局部替代 ADR-0058/0060 的文本 Mention 寻址与 ADR-0080 的 Draft 提交合同 |
| [ADR-0097](0097-authority-preserving-benchmark-evidence-ledgers.md) | Authority-Preserving Benchmark Evidence Ledgers | `accepted` | [v0.34](../versions/v0.34/README.md) | 统一 Evidence Reference 与 Ledger schema，同时保留 Core、Runner、Runtime、Verifier、derived、Judge 的权威差异 |
| [ADR-0098](0098-dual-replica-evidence-bound-semantic-judge.md) | Dual-Replica Evidence-Bound Semantic Judge Protocol | `accepted` | [v0.34](../versions/v0.34/README.md) | 以双 Replica、冻结 checklist、allowlist Evidence Pack 和 disagreement/unavailable 状态暴露 Judge 不稳定性 |
| [ADR-0099](0099-cost-gated-independent-member-calls.md) | Cost-Gated Independent Member Calls Without Return Semantics | `accepted` | [v0.34](../versions/v0.34/README.md) | ← ADR-0091；局部替代 ADR-0093 的回传槽位与 ADR-0097 的回复闭环条款 |
| [ADR-0100](0100-latest-member-identity-native-session-bootstrap.md) | Latest Member Identity in Native Session Bootstrap | `accepted` | [v0.35](../versions/v0.35/README.md) | ← ADR-0085；局部替代 ADR-0067 的 Bootstrap 结构、身份生命周期与完整字节恢复条款 |
| [ADR-0101](0101-outcome-only-collaboration-value-qualification-cases.md) | Outcome-Only Collaboration-Value Qualification Cases | `accepted` | [v0.36](../versions/v0.36/README.md) | 细化 ADR-0090/0095 的 Case admission、公开/withheld pairing 与无机械协作门禁 |
| [ADR-0102](0102-immutable-diagnostic-portfolio-authority.md) | Immutable Diagnostic Portfolio Authority and Two-Repeat Stability | `accepted` | [v0.36](../versions/v0.36/README.md) | 独立于 Formal Suite 冻结四 Case、两次重复、append-only 状态与无聚合评分 |
| [ADR-0103](0103-canonical-mcp-json-and-stable-assignment-identity.md) | Canonical MCP JSON and Stable Assignment Identity | `accepted` | [v0.37](../versions/v0.37/README.md) | 局部替代 ADR-0018 的 Schema、Assignment 关联键、默认定义和旧格式兼容条款 |
| [ADR-0104](0104-rovai-preferred-mcp-projection-and-external-degradation.md) | Rovai-Preferred MCP Projection and Non-Blocking External Degradation | `accepted` | [v0.37](../versions/v0.37/README.md) | 局部替代 ADR-0018/0065/0088 的同名冲突与外部 MCP Unsupported AgentRun 失败语义 |
| [ADR-0105](0105-runtime-group-assigned-skill-delivery.md) | Runtime-Group Assigned Rovai Skill Delivery | `accepted` | [v0.37](../versions/v0.37/README.md) | ← ADR-0017 |
| [ADR-0106](0106-agent-bounded-cross-camp-public-history-retrieval.md) | Agent-Bounded Cross-Camp Public History Retrieval | `accepted` | [v0.40](../versions/v0.40/README.md) | 局部替代 ADR-0051 的“网关无跨 Camp 查询”条款 |
| [ADR-0107](0107-camp-member-isolated-codex-home-and-agentrun-app-server.md) | Camp-Member Isolated Codex Home and AgentRun-Scoped App Server | `accepted` | [v0.39](../versions/v0.39/README.md) | 局部替代 ADR-0018 的 Codex 临时 projection 生命周期与 ADR-0104 的 Codex whole-table override 隔离方式 |
| [ADR-0108](0108-discovery-only-camp-message-search-and-sequence-paged-reads.md) | Discovery-Only Camp Message Search and Sequence-Paged Reads | `accepted` | [v0.40](../versions/v0.40/README.md) | 局部替代 ADR-0051 的五工具、Summary 读取、相关性分页与 window/thread 续读合同 |
