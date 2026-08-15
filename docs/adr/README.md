---
document_type: adr-index
authority: architecture-decisions
last_updated: 2026-08-14
---

# Rovai-ai Architecture Decision Records

本目录保存已经提升为跨版本约束、直接影响实现且改变成本较高的 Architecture Decision Record（ADR）。有效 ADR 是“系统应当遵守什么架构边界”的规范真源；代码、Migration 和测试才是“已经实现了什么”的事实依据。

开始阅读前先查看 [文档导航](../README.md)。当前约束按主题从
[CURRENT.md](CURRENT.md) 进入，完整时间序历史由 [HISTORY.md](HISTORY.md) 生成；创建新 ADR
使用 [TEMPLATE.md](TEMPLATE.md)。本文件拥有准入、生命周期和替代关系规则，后面的时间序表
只作为旧链接兼容入口。

## 收录标准

候选决策必须具有跨版本影响、直接约束实现，并且以下三项全部成立，才允许创建 ADR：

1. **难以逆转**：未来改变该决定会产生明显迁移、兼容、安全、数据、协议或组织成本；
2. **脱离背景会令人困惑**：未来维护者仅查看代码或当前设计时，可能合理地质疑为什么采用该方案；
3. **存在真实取舍**：确实考虑过可行替代方案，并因明确约束选择了当前方案。

“影响很多代码”本身不等于“难以逆转”。领域边界、持久化真源、并发与恢复协议、安全边界、
跨 Runtime 接口和高成本迁移策略通常可能满足准入，但仍须逐项通过以上门禁。

即使满足以上条件，出现以下任一情况时仍不得创建新 ADR：

- 当前有效 ADR 已经拥有该决定；语义未改变时只补充 Architecture、Contract 或导航引用；
- 内容主要说明系统当前如何工作，而没有形成新的长期架构取舍；
- 决定只属于单个功能或版本，可记录在当前 Version 文档或实现规格中；
- 属于可逆的实现细节，不会跨越持久化、协议、安全或公共接口边界；
- 只是重述现有 ADR、Architecture 或 Contract 已拥有的约束；
- 只是澄清领域术语，应更新 `CONTEXT.md`；
- 尚未形成明确取舍，只是问题清单或探索记录。

未通过 ADR 准入时，按内容分流：

- 当前组件结构、职责和权威组合进入 `docs/architecture/`；
- 字段、wire shape、错误、幂等和可测试语义进入 `docs/contracts/`；
- 当前版本范围、迁移、实施、验收、测试记录和临时兼容措施进入 `docs/versions/`；
- Renderer 交互和视觉规则进入 `docs/ui/`；
- 领域术语进入 `CONTEXT.md`；
- 局部且可逆的实现选择留在代码、测试中，或无需长期文档。

创建 ADR 前必须先从 `CURRENT.md` 搜索相关有效决定，确认没有有效 ADR 已拥有相同决策语义。
可在单个版本内调整的产品范围或 UI 细节、实施步骤、检查点、任务列表和发布进度均不得提升为 ADR。

一份新 ADR 只解决一个关键决策。现有 ADR-0001～0005 作为早期实施包级基线保留，不拆分或重编号。

## 生命周期

| 状态 | 含义 |
|---|---|
| `proposed` | 正在讨论，可以修改或撤回 |
| `accepted` | 决策已确认，规范语义冻结 |
| `superseded` | 已被 `superseded_by` 指向的新 ADR 替代，仅作为历史依据 |
| `rejected` | 已明确否决，不构成规范约束 |

- `accepted` 只表示决策成立，不表示实现完成。
- 已接受 ADR 的 Decision、Consequences 与 Rejected Alternatives 语义冻结；除 References 链接外，
  任何非语义正文修订都需要一次性、精确 from/to hash amendment 和人工审批。
- 当前有效 ADR 必须同时满足 `decision_scope: cross-version`、`status: accepted` 与
  `superseded_by: null`。ADR-0118 是唯一历史 `version-scope` 例外，只进入 HISTORY。
- `supersedes` 只列当前 ADR **直接且完整替代** 的 predecessor；`superseded_by` 只指向唯一直接
  successor。最终有效替代者沿链推导，不把旧指针压缩到链尾，也不冗余列传递祖先。
- 局部覆盖、细化或组合使用不进入完整替代图，不改变旧 ADR 状态；它们在新 ADR 正文、CURRENT
  related navigation、Architecture 和 Contract 中解释。
- proposed ADR 可以用可选 `intended_supersedes` 记录候选完整替代目标，但 `supersedes` 保持为空。
  接受时必须在同一最终快照原子更新新旧 status、直接关系、CURRENT 和 HISTORY。
- 实施状态和遗留缺口只能记录在当前版本文档中。

## 必需结构

每份 ADR 使用稳定 YAML Front Matter，并按顺序包含 `Context`、`Decision`、`Consequences`、
`Rejected Alternatives` 和 `References`，其中 `References` 必须是最后一个二级章节。字段名与
状态值使用模板中的英文枚举，正文语言可以按主题选择中文或英文。新增 ADR 只能使用
`decision_scope: cross-version`；版本局部范围留在唯一 current Version 文档。

ADR 必须能独立解释最终决定。`References` 可以链接版本讨论、代码或测试，但不能把理解规范所需的关键语义外包给历史文档。

## 内容边界

ADR 应保留能够独立理解的最小规范内核：为什么需要决定、最终选择的长期边界、非显然的后果和
真正被拒绝的方案。

ADR 不设固定字数或行数限制，但不得复制状态机细节、完整字段表、SQL schema、Runtime 协议、UI 规格、
测试矩阵、实施步骤或发布进度；这些内容进入对应的 Architecture、Contract、UI 或 Version 文档，并由
ADR 引用。有效 ADR 继续拥有长期规范边界；分流文档不得静默替代或推翻该边界。

## 自动治理

所有规则按目录和 Front Matter 动态计算，不硬编码 ADR 数量、当前版本或任何具体 Skill：

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<PR base SHA> pnpm docs:check:ci
pnpm docs:adr:generate -- --check
```

- `docs:check:adr` 校验文件名、YAML schema、章节、直接替代图、CURRENT/HISTORY、Architecture
  索引以及全仓 Markdown 本地链接和 fragment；
- `docs:check:ci` 额外比较真实 PR base，阻止删除/移动/重编号、非法状态转换和 accepted ADR
  历史正文改写；缺少 base SHA 时直接失败；
- HISTORY 只能通过生成器更新；CURRENT 的主题归属必须人工选择，新增 ADR 未归类时检查失败；
- “难以逆转、脱离背景会令人困惑、存在真实取舍”是人工审阅的语义门禁；不得以字数、行数或
  关键词启发式替代；
- `legacy-exceptions.json` 只允许已审计的 ADR-0118 scope 例外，新版本、新 ADR 和新文档不得扩充
  legacy 基线；
- `amendments/` 只授权精确文件 hash 对，不提供通配符或可复用豁免。

## 决策索引

> 兼容入口：完整且无重复的机器历史见 [HISTORY.md](HISTORY.md)，当前主题导航见
> [CURRENT.md](CURRENT.md)。本表暂时保留旧的局部关系说明，不作为生成或生命周期真源。

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
| [ADR-0050](0050-camp-shared-progressive-summaries.md) | Camp-Shared Progressive Summaries | `superseded` | [v0.12](../versions/v0.12/README.md) | → ADR-0129 |
| [ADR-0051](0051-boundary-capped-context-retrieval.md) | Boundary-Capped Context Retrieval | `accepted` | [v0.12](../versions/v0.12/README.md) | Summary/Coverage 上下文条款由 ADR-0129 局部替代；原始消息检索边界继续有效 |
| [ADR-0052](0052-explicit-memory-revision-authority.md) | Explicit Memory Revision Authority | `superseded` | [v0.13](../versions/v0.13/README.md) | ← ADR-0021、ADR-0033；→ ADR-0069 |
| [ADR-0053](0053-user-preauthorized-provisional-companion-lessons.md) | User-Preauthorized Provisional Companion Lessons | `superseded` | [v0.13](../versions/v0.13/README.md) | ← ADR-0032、ADR-0044；→ ADR-0055 |
| [ADR-0054](0054-provisional-memory-safety-and-stewardship.md) | Provisional Memory Safety and Stewardship | `superseded` | [v0.13](../versions/v0.13/README.md) | ← ADR-0043、ADR-0046；→ ADR-0055 |
| [ADR-0055](0055-explicit-opt-in-provisional-companion-lessons.md) | Explicit Opt-In Provisional Companion Lessons | `superseded` | [v0.13](../versions/v0.13/README.md) | ← ADR-0053、ADR-0054；→ ADR-0064 |
| [ADR-0056](0056-controlled-member-avatar-assets.md) | Controlled Member Avatar References and Application-Managed Local Assets | `accepted` | [v0.14](../versions/v0.14/README.md) | 内置外观版本与升级保护条款见 ADR-0086；固定可读内置 Agent ID 条款见 ADR-0110 |
| [ADR-0057](0057-member-presence-and-retained-removal.md) | Member Presence and Retained Permanent Removal | `accepted` | [v0.15](../versions/v0.15/README.md) | ← ADR-0041；Memory Capability 条款见 ADR-0069 |
| [ADR-0058](0058-collaboration-v4-presence-aware-admission.md) | Collaboration v4: Presence-Aware Routing and Execution Admission | `accepted` | [v0.15](../versions/v0.15/README.md) | ← ADR-0012；Dynamic Task Context 条款见 ADR-0067；Conversation Summary/Camp Cursor 条款见 ADR-0129；Camp 创建与 Conversation 分配条款见 ADR-0071 |
| [ADR-0059](0059-runtime-owned-resource-permissions.md) | Runtime-Owned Resource Permissions and Path-Only Run Workspace | `accepted` | [v0.16](../versions/v0.16/README.md) | ← ADR-0015 |
| [ADR-0060](0060-opaque-member-routing-identity.md) | Opaque Member Routing Identity and Globally Unique Names | `accepted` | [v0.16](../versions/v0.16/README.md) | 成员身份命名与提及规则细化 ADR-0057、ADR-0058；Base58 Routing ID 见 ADR-0110；摘要模型配置入口由 ADR-0129 删除 |
| [ADR-0061](0061-durable-agent-inaccessible-execution-evidence.md) | Durable User-Visible and Agent-Inaccessible Execution Evidence | `accepted` | [v0.17](../versions/v0.17/README.md) | 执行内容与 Read Side 边界细化 ADR-0013、ADR-0049；Summary 输入目标由 ADR-0129 删除 |
| [ADR-0062](0062-interruptible-runs-and-unsettled-external-effects.md) | Interruptible Run Trees and Unsettled External Effects | `accepted` | [v0.17](../versions/v0.17/README.md) | 取消与恢复边界细化 ADR-0016、ADR-0059 |
| [ADR-0063](0063-minimal-a2a-turn-envelope-and-reply-correlation.md) | Minimal A2A Turn Envelope and Trusted Reply Correlation | `superseded` | [v0.17](../versions/v0.17/README.md) | 局部替代 ADR-0049；→ ADR-0067 |
| [ADR-0064](0064-default-on-bounded-automatic-partner-memory.md) | Default-On Bounded Automatic Partner Memory Formation | `superseded` | v0.18 | ← ADR-0055；→ ADR-0069 |
| [ADR-0065](0065-verified-runtime-catalog-and-documentation-only-compatibility.md) | Verified Runtime Catalog and Documentation-Only Compatibility Evaluation | `accepted` | [v0.19](../versions/v0.19/README.md) | ← ADR-0016；受证明的 preserved-ambient Team attachment 见 ADR-0088 |
| [ADR-0066](0066-managed-product-runtime-resolution.md) | Managed Product Runtime Discovery, Resolution, and Relocation | `accepted` | [v0.20](../versions/v0.20/README.md) | — |
| [ADR-0067](0067-native-session-bootstrap-and-agentrun-context-v3.md) | Native Session Bootstrap and AgentRun Context v3 | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0049、ADR-0063；局部替代 ADR-0014/ADR-0058 的 Task Context 条款；Bootstrap 身份与恢复条款见 ADR-0100；公共消息上下文与边界条款见 ADR-0129 |
| [ADR-0068](0068-brokered-memory-retrieval-and-session-entrypoint.md) | Brokered Memory Retrieval and Session Entrypoint | `accepted` | [v0.21](../versions/v0.21/README.md) | ← ADR-0035、ADR-0042 |
| [ADR-0069](0069-single-effective-memory-and-scope-bounded-agent-mutation.md) | Single Effective Memory and Scope-Bounded Agent Mutation | `superseded` | [v0.21](../versions/v0.21/README.md) | ← ADR-0024、ADR-0025、ADR-0036～ADR-0040、ADR-0052、ADR-0064；→ ADR-0178 |
| [ADR-0070](0070-normalized-sqlite-memory-store-v2.md) | Normalized SQLite Memory Store v2 | `superseded` | [v0.21](../versions/v0.21/README.md) | ← ADR-0045；→ ADR-0179 |
| [ADR-0071](0071-configured-camp-creation-and-lazy-conversations.md) | Configured Camp Creation and Lazy Conversations | `accepted` | [v0.22](../versions/v0.22/README.md) | 局部替代 ADR-0058 的 Camp 创建、空 Camp 与 Conversation 分配条款；一键入口的 Pending Draft 例外见 ADR-0145 |
| [ADR-0072](0072-directory-workspace-and-dynamic-git-capability.md) | Directory Workspace Identity and Dynamic Git Capability | `accepted` | [v0.23](../versions/v0.23/README.md) | 局部替代 ADR-0071 的 Repository/Project Binding 条款；Quick Chat 命名与 binding literal 见 ADR-0074 |
| [ADR-0073](0073-agent-authored-a2a-conversation-messages.md) | Agent-Authored A2A Conversation Messages | `superseded` | [v0.24](../versions/v0.24/README.md) | → ADR-0130；历史公共呈现背景 |
| [ADR-0074](0074-quick-chat-ubiquitous-language-and-binding-identity.md) | Quick Chat Ubiquitous Language and Binding Identity | `accepted` | [v0.24](../versions/v0.24/README.md) | 局部替代 ADR-0071、ADR-0072 的 Lobby 命名与 binding literal |
| [ADR-0075](0075-runtime-integrity-at-change-and-execution-boundaries.md) | Runtime Integrity at Change and Execution Boundaries | `accepted` | [v0.24](../versions/v0.24/README.md) | 局部替代 ADR-0066 的发送准入与 fingerprint 时机；Context Compaction 执行路径由 ADR-0129 删除 |
| [ADR-0076](0076-message-first-agent-run-dispatch-boundary.md) | Message-First AgentRun Dispatch Boundary | `accepted` | [v0.24](../versions/v0.24/README.md) | 局部替代 ADR-0058、ADR-0066、ADR-0075 的发送/执行检查时机 |
| [ADR-0077](0077-responsive-camp-turn-cancellation-boundary.md) | Responsive CampTurn Cancellation Boundary | `accepted` | [v0.24](../versions/v0.24/README.md) | 细化 ADR-0062 的取消请求、Renderer 对账与 ending Git observation 时机 |
| [ADR-0078](0078-navigation-projection-and-sidebar-wordmark-boundary.md) | Navigation Projection and Sidebar Wordmark Boundary | `accepted` | [v0.24](../versions/v0.24/README.md) | 细化 ADR-0048 的侧栏字标与 ADR-0074 的 Renderer 导航投影；不改变正式身份或领域合同 |
| [ADR-0079](0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md) | Two-Phase Cancellation Projection and Bounded Runtime Interrupt | `accepted` | [v0.24](../versions/v0.24/README.md) | 细化 ADR-0077 的 Run 级本地投影、Runtime deadline、并行 interrupt 与 fencing |
| [ADR-0080](0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md) | Durable Camp Composer Draft and Atomic Attachment Consumption | `accepted` | [v0.25](../versions/v0.25/README.md) | 细化 ADR-0001、ADR-0076 的 Draft 所有权与消息提交边界 |
| [ADR-0081](0081-camp-public-attachment-paths-and-frozen-discovery.md) | Camp-Public Attachment Paths and Frozen Discovery | `accepted` | [v0.25](../versions/v0.25/README.md) | 局部替代 ADR-0013 的附件 Blob 权威和 ADR-0067 的 Run Attachment Projection 条款 |
| [ADR-0082](0082-member-owned-runtime-parameters.md) | Member-Owned Runtime Parameters and Explicit Configuration | `superseded` | [v0.26](../versions/v0.26/README.md) | → ADR-0127 |
| [ADR-0083](0083-background-runtime-checks-and-actionable-status.md) | Background Runtime Checks and Actionable User Status | `accepted` | [v0.26](../versions/v0.26/README.md) | 局部替代 ADR-0066 的检查调度、成员保存和用户状态投影条款 |
| [ADR-0084](0084-conversation-surface-controls-and-stop-outcome-projection.md) | Conversation Surface Controls and Stop Outcome Projection | `accepted` | [v0.26](../versions/v0.26/README.md) | 细化 ADR-0062、ADR-0077、ADR-0079 的会话停止投影与 Inspector 呈现 |
| [ADR-0085](0085-run-frozen-six-field-member-identity-context.md) | Run-Frozen Six-Field Member Identity Context | `superseded` | [v0.27](../versions/v0.27/README.md) | → ADR-0100 |
| [ADR-0086](0086-single-current-built-in-member-appearance-set.md) | Single Current Built-In Member Appearance Set | `accepted` | [v0.27](../versions/v0.27/README.md) | 局部替代 ADR-0056 的内置外观版本与升级保护条款 |
| [ADR-0087](0087-core-owned-durable-in-app-notification-inbox.md) | Core-Owned Durable In-App Notification Inbox | `accepted` | [v0.28](../versions/v0.28/README.md) | 细化 ADR-0001、ADR-0013 的用户注意力投影与 Read Side 边界 |
| [ADR-0088](0088-attested-native-team-gateway-attachment.md) | Attested Native Team Gateway Attachment | `accepted` | [v0.30](../versions/v0.30/README.md) | 局部替代 ADR-0014 的 Connector credential/Antigravity 条款、ADR-0018 的内部 Team MCP 同路投影条款，并落实 ADR-0065 的 preserved-ambient 准入路径；完整内置工具对等见 ADR-0089 |
| [ADR-0089](0089-attested-built-in-mcp-tool-parity.md) | Attested Built-in MCP Tool Parity | `accepted` | [v0.31](../versions/v0.31/README.md) | 扩展 ADR-0088 的首阶段单工具 attachment；不改变 preserved ambient 与 external projection 边界 |
| [ADR-0090](0090-team-delivery-qualification-evidence-boundary.md) | Team Delivery Qualification Evidence Boundary | `accepted` | [v0.31](../versions/v0.31/README.md) | 首次冻结默认团队交付资格、外部验证、零人工和证据边界 |
| [ADR-0091](0091-durable-member-calls-and-single-slot-a2a-resume.md) | Durable Member Calls and Single-Slot A2A Resume Scheduling | `superseded` | [v0.32](../versions/v0.32/README.md) | → ADR-0099；历史 Member Call/Resume 调度模型 |
| [ADR-0092](0092-recoverable-qualification-evaluation-integrity.md) | Recoverable Qualification Evaluation Integrity | `accepted` | [v0.34](../versions/v0.34/README.md) | 局部替代 ADR-0090 的投递后评测器故障与无效边界 |
| [ADR-0093](0093-core-owned-atomic-campturn-execution-budgets.md) | Core-Owned Atomic CampTurn Execution Budgets | `accepted` | [v0.34](../versions/v0.34/README.md) | 用通用 Core 准入合同原子实施 Trial 的时间、Run 与 A2A 预算 |
| [ADR-0094](0094-formal-qualification-isolation-and-effect-coverage.md) | Formal Qualification Isolation and External Effect Coverage | `accepted` | [v0.34](../versions/v0.34/README.md) | 以专用执行环境证明零人工与外部副作用收口；共享用户和 uncontrolled ambient MCP 仅诊断 |
| [ADR-0095](0095-layered-qualification-authority-and-semantic-review.md) | Layered Qualification Authority and Advisory Semantic Review | `accepted` | [v0.34](../versions/v0.34/README.md) | 冻结五层报告的单一 Hard Outcome 权威与 LLM Judge 顾问边界 |
| [ADR-0096](0096-core-owned-structured-mentions-and-derived-addressing.md) | Core-Owned Structured Mentions and Mention-Derived Camp Addressing | `superseded` | v0.33 | → ADR-0128 |
| [ADR-0097](0097-authority-preserving-benchmark-evidence-ledgers.md) | Authority-Preserving Benchmark Evidence Ledgers | `accepted` | [v0.34](../versions/v0.34/README.md) | 统一 Evidence Reference 与 Ledger schema，同时保留 Core、Runner、Runtime、Verifier、derived、Judge 的权威差异 |
| [ADR-0098](0098-dual-replica-evidence-bound-semantic-judge.md) | Dual-Replica Evidence-Bound Semantic Judge Protocol | `accepted` | [v0.34](../versions/v0.34/README.md) | 以双 Replica、冻结 checklist、allowlist Evidence Pack 和 disagreement/unavailable 状态暴露 Judge 不稳定性 |
| [ADR-0099](0099-cost-gated-independent-member-calls.md) | Cost-Gated Independent Member Calls Without Return Semantics | `superseded` | [v0.34](../versions/v0.34/README.md) | → ADR-0130；历史独立 Member Call 语义 |
| [ADR-0100](0100-latest-member-identity-native-session-bootstrap.md) | Latest Member Identity in Native Session Bootstrap | `accepted` | [v0.35](../versions/v0.35/README.md) | ← ADR-0085；局部替代 ADR-0067 的 Bootstrap 结构、身份生命周期与完整字节恢复条款；Context Read Marker 由 ADR-0129 重定义；普通上下文 Runtime 的 redelivery boundary 由 ADR-0141 新增 |
| [ADR-0101](0101-outcome-only-collaboration-value-qualification-cases.md) | Outcome-Only Collaboration-Value Qualification Cases | `accepted` | [v0.36](../versions/v0.36/README.md) | 细化 ADR-0090/0095 的 Case admission、公开/withheld pairing 与无机械协作门禁 |
| [ADR-0102](0102-immutable-diagnostic-portfolio-authority.md) | Immutable Diagnostic Portfolio Authority and Two-Repeat Stability | `accepted` | [v0.36](../versions/v0.36/README.md) | 独立于 Formal Suite 冻结四 Case、两次重复、append-only 状态与无聚合评分 |
| [ADR-0103](0103-canonical-mcp-json-and-stable-assignment-identity.md) | Canonical MCP JSON and Stable Assignment Identity | `accepted` | [v0.37](../versions/v0.37/README.md) | 局部替代 ADR-0018 的 Schema、Assignment 关联键、默认定义和旧格式兼容条款 |
| [ADR-0104](0104-rovai-preferred-mcp-projection-and-external-degradation.md) | Rovai-Preferred MCP Projection and Non-Blocking External Degradation | `superseded` | [v0.37](../versions/v0.37/README.md) | → ADR-0125 |
| [ADR-0105](0105-runtime-group-assigned-skill-delivery.md) | Runtime-Group Assigned Rovai Skill Delivery | `accepted` | [v0.37](../versions/v0.37/README.md) | ← ADR-0017 |
| [ADR-0106](0106-agent-bounded-cross-camp-public-history-retrieval.md) | Agent-Bounded Cross-Camp Public History Retrieval | `accepted` | [v0.40](../versions/v0.40/README.md) | 局部替代 ADR-0051 的“网关无跨 Camp 查询”条款；Summary 上下文组成由 ADR-0129 删除 |
| [ADR-0107](0107-camp-member-isolated-codex-home-and-agentrun-app-server.md) | Camp-Member Isolated Codex Home and AgentRun-Scoped App Server | `superseded` | [v0.39](../versions/v0.39/README.md) | → ADR-0126 |
| [ADR-0108](0108-discovery-only-camp-message-search-and-sequence-paged-reads.md) | Discovery-Only Camp Message Search and Sequence-Paged Reads | `accepted` | [v0.40](../versions/v0.40/README.md) | 局部替代 ADR-0051 的五工具、Summary 读取、相关性分页与 window/thread 续读合同；Summary 生成与上下文组成由 ADR-0129 删除 |
| [ADR-0109](0109-project-visible-bundled-skill-sources.md) | Project-Visible Bundled Skill Sources | `superseded` | [v0.40](../versions/v0.40/README.md) | → ADR-0144 |
| [ADR-0110](0110-internal-agent-uuid-and-monotonic-short-agent-id.md) | Internal Agent UUID and Monotonic Short Agent ID | `accepted` | [v0.40](../versions/v0.40/README.md) | 局部替代 ADR-0056 的固定可读内置 ID 与 ADR-0060 的 Base58 Routing ID 条款 |
| [ADR-0111](0111-core-owned-canonical-runtime-activity.md) | Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection | `accepted` | [v0.41](../versions/v0.41/README.md) | 细化 ADR-0059/ADR-0061 的 Runtime 观测、Evidence 与 Renderer 展示边界 |
| [ADR-0112](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md) | Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection | `accepted` | [v0.41](../versions/v0.41/README.md) | 确认 Evidence 真源、持久可重建 Canonical Projection 与历史分类版本边界 |
| [ADR-0113](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md) | Core-Scoped Operation Identity and Evidence Deduplication Boundary | `accepted` | [v0.41](../versions/v0.41/README.md) | 分离 source_event_key 去重与 operationId 生命周期合并，禁止模糊关联 |
| [ADR-0114](0114-stable-activity-domain-and-evidence-bounded-semantic-kind.md) | Stable Activity Domain and Evidence-Bounded Semantic Kind | `accepted` | [v0.41](../versions/v0.41/README.md) | 稳定顶层观测域及 semanticKind/presentationHint 边界；字段名由 ADR-0122 局部替代为 activityDomain |
| [ADR-0115](0115-evidence-bounded-activity-phase-and-outcome-resolution.md) | Evidence-Bounded Activity Phase and Outcome Resolution | `accepted` | [v0.41](../versions/v0.41/README.md) | 分离生命周期位置与结果，明确取消、unsettled 和冲突终端的诚实投影 |
| [ADR-0116](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md) | Projection-Pinned Classifier Version and Explicit Historical Reprojection | `accepted` | [v0.41](../versions/v0.41/README.md) | 区分 operationId 与 Projection classifierVersion，禁止静默历史重分类 |
| [ADR-0117](0117-observation-capability-coverage-levels-across-runtime-adapters.md) | Observation-Capability Coverage Levels Across Runtime Adapters | `accepted` | [v0.41](../versions/v0.41/README.md) | 九个 Runtime 共用合同，coverage level 只描述可观测能力，不代表支持等级 |
| [ADR-0118](0118-v041-local-data-clean-break-and-managed-reset-boundary.md) | v0.41 Local Data Clean Break and Managed Reset Boundary | `accepted` | [v0.41](../versions/v0.41/README.md) | 不兼容老版本本地数据时只清理 Rovai-owned app data，不迁移/回填用户与 Runtime 外部状态 |
| [ADR-0119](0119-versioned-evidence-to-operation-identity-bindings.md) | Append-Only Versioned Evidence-to-Operation Identity Bindings | `superseded` | [v0.41](../versions/v0.41/README.md) | → ADR-0122；v0.41 不实现独立 binding/version 轴 |
| [ADR-0120](0120-run-epoch-pinned-identity-rules-and-frozen-binding-sets.md) | Run-Epoch-Pinned Identity Rules and Frozen Evidence Binding Sets | `superseded` | [v0.41](../versions/v0.41/README.md) | → ADR-0122；Binding Set/identity replay 推迟 |
| [ADR-0121](0121-append-only-binding-ledger-and-sealed-binding-set-heads.md) | Append-Only Binding Ledger and Immutable Sealed Binding-Set Heads | `superseded` | [v0.41](../versions/v0.41/README.md) | → ADR-0122；Ledger/sealed head 不进入 v0.41 |
| [ADR-0122](0122-current-canonical-activity-projection-and-deferred-identity-replay.md) | Current Canonical Activity Projection and Deferred Identity Replay | `accepted` | [v0.41](../versions/v0.41/README.md) | ← ADR-0119、ADR-0120、ADR-0121；当前 Projection + Mapping Registry，历史身份 replay 推迟 |
| [ADR-0123](0123-exclusive-agentrun-runtime-fleet.md) | Exclusive AgentRun Runtime Processes and Resident Fleet Reuse | `accepted` | [v0.41](../versions/v0.41/README.md) | 细化 ADR-0082 的进程复用身份；局部替代 ADR-0018 的 Resident projection 终态清理与 ADR-0107 的 Codex 每 Run 进程生命周期；Context Compaction Job 由 ADR-0129 删除 |
| [ADR-0124](0124-cli-only-transport-for-rovai-built-in-operations.md) | CLI-Only Transport for Rovai Built-in Operations | `accepted` | [v0.42](../versions/v0.42/README.md) | 以九 Runtime clean break 替代 ADR-0014/0018/0067/0069/0088/0089/0104 的内置 MCP 运输与成员级工具 Capability 条款；外部 MCP 不变；Agent-facing response/Bootstrap 条款由 ADR-0135 局部替代 |
| [ADR-0125](0125-runtime-native-additive-external-mcp-projection.md) | Runtime-Native Additive External MCP Projection | `accepted` | [v0.43](../versions/v0.43/README.md) | ← ADR-0104；局部替代 ADR-0018 的 exact/Project exclusion/Unsupported 准入条款 |
| [ADR-0126](0126-codex-native-home-and-external-session-ownership.md) | Codex Native Home and External Session Ownership | `accepted` | [v0.43](../versions/v0.43/README.md) | ← ADR-0107；局部替代 ADR-0123 的 Codex Home compatibility identity；摘要 Job 条款由 ADR-0129 删除 |
| [ADR-0127](0127-atomic-member-runtime-configuration.md) | Atomic Member Runtime Configuration and Internal Resolved Binding | `accepted` | [v0.43](../versions/v0.43/README.md) | ← ADR-0082；局部替代 ADR-0066 的 AdapterKind-only 普通队员配置 |
| [ADR-0128](0128-structured-draft-only-user-message-submission.md) | Structured Draft-Only User Camp Message Submission | `accepted` | [v0.43](../versions/v0.43/README.md) | ← ADR-0096；删除旧用户发送与 first-message Camp creation 边界 |
| [ADR-0129](0129-deterministic-bounded-raw-public-context-delivery.md) | Deterministic Bounded Raw Public Context Delivery | `accepted` | [v0.44](../versions/v0.44/README.md) | ← ADR-0050；局部替代 ADR-0051、ADR-0058、ADR-0060、ADR-0061、ADR-0067、ADR-0075、ADR-0100、ADR-0106、ADR-0108、ADR-0123、ADR-0126 的 Summary/Compaction/公共上下文条款 |
| [ADR-0130](0130-public-a2a-message-and-unified-delivery.md) | Public A2A Messages and Unified Message Delivery | `accepted` | [v0.45](../versions/v0.45/README.md) | ← ADR-0073、ADR-0099；统一公共 Message、Message Delivery、寻址、fanout 与 lineage |
| [ADR-0131](0131-recipient-scoped-event-driven-delivery-recovery.md) | Recipient-Scoped Event-Driven Delivery Dispatch and Interrupted Recovery | `accepted` | [v0.45](../versions/v0.45/README.md) | 细化 ADR-0130 的 recipient-scoped pump、waitCondition、interrupted 与显式恢复 |
| [ADR-0132](0132-public-reference-context-closure-profile-v2.md) | Bounded Public Reference Context Closure and Profile v2 | `accepted` | [v0.45](../versions/v0.45/README.md) | Profile v1 保持 immutable；局部替代 ADR-0129 的 reply/closure 选择条款 |
| [ADR-0133](0133-scheme-c-run-process-detail-surface.md) | Scheme C Run Process Detail Surface | `superseded` | [v0.45](../versions/v0.45/README.md) | → ADR-0154；历史逐 AgentRun Scheme C surface |
| [ADR-0134](0134-runtime-public-output-boundary.md) | Explicit Runtime Public Output Boundary | `accepted` | [v0.45](../versions/v0.45/README.md) | 新增 Adapter final boundary、两种 public output mode 与 exact suppression |
| [ADR-0135](0135-compact-agent-output-over-canonical-built-in-tool-envelope.md) | Compact Agent Output over Canonical Built-in Tool Envelope | `accepted` | [v0.46](../versions/v0.46/README.md) | 局部替代 ADR-0124 的 Agent-facing response/Bootstrap 与 discovery 条款；Core Envelope、receipt、IPC 和 replay 继续有效 |
| [ADR-0136](0136-durable-task-v2-responsibility-and-coordination-authority.md) | Durable Task v2 Responsibility and Coordination Authority | `accepted` | [v0.47](../versions/v0.47/README.md) | 局部替代 ADR-0057/0058 的 Task shape、Lead authority、membership/removal Task 收口与 removed Assignee 条款 |
| [ADR-0137](0137-one-time-task-linked-responsibility-admission.md) | One-Time Task-Linked Responsibility Admission | `accepted` | [v0.47](../versions/v0.47/README.md) | 局部替代 ADR-0058 与实现中的 dispatch/start 持续 Task fence，冻结 acceptance-boundary admission 与 grandfathering |
| [ADR-0138](0138-durable-bootstrap-redelivery-requirement.md) | Durable Bootstrap Redelivery Requirement and Accepted-Input Acknowledgement | `accepted` | [v0.48](../versions/v0.48/README.md) | 新增 Binding-generation-scoped 持久补发水位、Delivery Gate capture 与 accepted-ACK 消费边界 |
| [ADR-0139](0139-version-owned-bootstrap-redelivery-runtime-policy.md) | Version-Owned Bootstrap Redelivery Runtime Policy and Enablement Transition | `accepted` | [v0.48](../versions/v0.48/README.md) | 新增版本维护的内部 Runtime 环境策略、process-start snapshot 与存量 Binding 首次 enablement 补发 |
| [ADR-0140](0140-runtime-specific-compaction-signal-admission-point.md) | Runtime-Specific Compaction Signal Admission Point and Prepared-Input Cutoff | `accepted` | [v0.48](../versions/v0.48/README.md) | 冻结 Copilot 一次性 edge、五 Runtime completed surface、CodeBuddy coverage gap 与 prepared 截止点 |
| [ADR-0141](0141-atomic-bootstrap-redelivery-input-overlay.md) | Atomic Bootstrap Redelivery Input Overlay and Transient Identity Boundary | `accepted` | [v0.48](../versions/v0.48/README.md) | 新增原子 input preparation、完整补发 envelope、combined budget 与 ADR-0100 身份不持久化边界 |
| [ADR-0142](0142-native-session-scoped-compaction-observer-lease.md) | Native-Session-Scoped Compaction Observer Lease and Uncertain-Submission Boundary | `accepted` | [v0.48](../versions/v0.48/README.md) | 新增跨 AgentRun 的窄权限 Session Observer、Host/Binding/policy fencing 与 known-unknown interruption 规则 |
| [ADR-0143](0143-best-effort-non-blocking-compaction-detector-capability.md) | Best-Effort Non-Blocking Compaction Detector Capability | `accepted` | [v0.48](../versions/v0.48/README.md) | 局部替代 ADR-0139 的 enabled/Readiness 含义；六 Runtime best-effort 且不阻塞 AgentRun，Antigravity disabled |
| [ADR-0144](0144-self-contained-duo-grilling-bundled-skills.md) | Self-Contained Duo Grilling Bundled Skills | `superseded` | [v0.49](../versions/v0.49/README.md) | ← ADR-0109；→ ADR-0150；官方集合曾扩展为四个，并冻结双人追问 Skill 的自包含依赖与异步协作边界 |
| [ADR-0145](0145-core-owned-pending-camp-draft-activation.md) | Core-Owned Pending Camp Draft Activation | `accepted` | [v0.49](../versions/v0.49/README.md) | 局部细化 ADR-0071 的空 Camp 条款，并组合 ADR-0080/ADR-0128 的 Core Draft 与原子发送边界 |
| [ADR-0146](0146-sole-native-session-self-identity-and-peer-routing-projection.md) | Sole Native-Session Self Identity and Peer Routing Projection | `accepted` | [v0.50](../versions/v0.50/README.md) | 细化 ADR-0100 的唯一 Self Identity，并局部替代 ADR-0129 的 Stable Collaboration State self/member、Lead 与 digest 条款 |
| [ADR-0147](0147-lossless-model-context-projection-and-layered-delivery-evidence.md) | Lossless Model Context Projection and Layered Delivery Evidence | `accepted` | [v0.50](../versions/v0.50/README.md) | 局部替代 ADR-0067/ADR-0129 的模型投影与 Evidence 混层条款、ADR-0141 的 Redelivery marker/wording/version；Profile v2 选择/预算与 accepted-ACK 保持 |
| [ADR-0148](0148-read-only-diagnostics-and-data-minimized-export.md) | Read-Only Diagnostics and Data-Minimized Export | `accepted` | [v0.51](../versions/v0.51/README.md) | 严格分离自检与单项修复；局部替代 ADR-0048 的诊断导出格式标识，v5 集中脱敏且不输出绝对路径 |
| [ADR-0149](0149-bounded-whole-history-omission-evidence.md) | Bounded Whole-History Omission Evidence | `accepted` | [v0.52](../versions/v0.52/README.md) | 局部收窄 ADR-0147 的 exact omission IDs：whole-history 使用 bounded aggregate，有界淘汰/引用异常继续保留 exact IDs |
| [ADR-0150](0150-evidence-first-agent-codebase-analysis-bundled-skill.md) | Evidence-First Agent Codebase Analysis Bundled Skill | `superseded` | [v0.52](../versions/v0.52/README.md) | ← ADR-0144；→ ADR-0159；官方集合曾扩展为五个、移除名称的 `rovai-` 前缀，并冻结代码证据优先、默认只读的 Agent 仓库分析工作流 |
| [ADR-0151](0151-versioned-benchmark-protocol-and-axis-comparability.md) | Versioned Benchmark Protocol and Axis-Scoped Comparability | `accepted` | [v0.53](../versions/v0.53/README.md) | 冻结 Protocol v3、Profile/Adapter、历史不可变、逐轴比较资格和零执行 Review Camp 投影 |
| [ADR-0152](0152-lead-owned-task-responsibility-and-self-active-task-awareness.md) | Lead-Owned Task Responsibility and Self-Active Task Awareness | `accepted` | [v0.54](../versions/v0.54/README.md) | 冻结 Lead/User Task 责任定义、Assignee 执行态、Camp-wide read 与 self active awareness |
| [ADR-0153](0153-explicit-empty-self-active-task-snapshot.md) | Explicit Empty Self-Active Task Snapshot | `accepted` | [v0.54](../versions/v0.54/README.md) | 区分显式空 Task snapshot 与预算排除后的 whole-section omission，不改变 Task authority |
| [ADR-0154](0154-agent-level-execution-process-surface.md) | Agent-Level Continuous Execution Process Surface | `accepted` | [v0.55](../versions/v0.55/README.md) | ← ADR-0133；以 Agent 级连续过程替代逐 Run Scheme C surface，并收敛 Inspector 为三 Tab |
| [ADR-0155](0155-treatment-blind-outcome-and-process-judge-views.md) | Treatment-Blind Outcome and Process Judge Views | `accepted` | [v0.55](../versions/v0.55/README.md) | 分离 treatment-blind Outcome View 与受控 Process View，避免 Judge 从实现过程反推实验处理 |
| [ADR-0156](0156-logical-runtime-identity-and-bounded-installation-rebind.md) | Frozen Logical Runtime Identity and Bounded Installation Rebind | `accepted` | [v0.58](../versions/v0.58/README.md) | 冻结逻辑 Runtime identity、受限 installation rebind 与既有 Run/Session 不被当前安装漂移重写的边界 |
| [ADR-0157](0157-message-owned-agentrun-instruction-without-expected-output.md) | Message-Owned AgentRun Instruction Without Expected Output Metadata | `accepted` | [v0.58](../versions/v0.58/README.md) | 删除未生效的 expectedOutput，触发 CampMessage 成为 AgentRun 唯一自然语言工作指令 |
| [ADR-0158](0158-default-all-runtime-delivery-for-managed-skills.md) | Default-All Runtime Delivery for Managed Skills | `accepted` | [v0.58](../versions/v0.58/README.md) | 局部替代 ADR-0105/ADR-0150 的 Skill 默认不分组条款；内置与用户导入 Skill 均默认投递至全部生效组 |
| [ADR-0159](0159-pinned-third-party-tasteful-ui-bundled-skill.md) | Pinned Third-Party Tasteful UI Bundled Skill | `superseded` | [v0.58](../versions/v0.58/README.md) | ← ADR-0150；→ ADR-0167；官方集合曾扩展为六个，并以精确上游 Revision、完整来源、许可和不可变 Revision 内置 `tasteful-ui` |
| [ADR-0160](0160-focused-camp-inspector-and-single-approval-surface.md) | Focused Camp Inspector and Single Approval Surface | `accepted` | [v0.58](../versions/v0.58/README.md) | 局部替代 ADR-0154 的三 Tab Inspector 与重复 Approval surface，收敛为任务/队员 Inspector 和唯一 Approval Dock |
| [ADR-0161](0161-event-driven-root-scoped-skill-projection-reconciliation.md) | Event-Driven Root-Scoped Skill Projection Reconciliation | `accepted` | [v0.58](../versions/v0.58/README.md) | 局部替代 ADR-0105 的 active-Run Revision retention/stale-new-Run 条款，冻结事件驱动、root-scoped reconcile |
| [ADR-0162](0162-missing-send-recovery-publication.md) | Missing-Send Recovery Publication at Successful AgentRun Termination | `accepted` | [v0.59](../versions/v0.59/README.md) | 独立于 ordinary public output mode，按同 Run 任意 accepted send 抑制，并以四类 Adapter final boundary 原子恢复 zero-send 公共输出 |
| [ADR-0163](0163-explicit-caller-return-and-core-managed-reply-reference.md) | Explicit Caller Return and Core-Managed Reply Reference | `accepted` | [v0.62](../versions/v0.62/README.md) | 冻结显式 caller return、非直属 ancestor guard 与 Core-managed reply reference |
| [ADR-0164](0164-accepted-input-recovery-requires-proven-native-turn-reconciliation.md) | Accepted Input Recovery Requires Proven Native Turn Reconciliation | `accepted` | [v0.64](../versions/v0.64/README.md) | 冻结 Session/Turn 分离、accepted-input fail-closed 与 proven native-turn reconciliation 边界 |
| [ADR-0165](0165-core-owned-current-user-message-attention.md) | Core-Owned Current-User Message Attention | `accepted` | [v0.65](../versions/v0.65/README.md) | 冻结 `local_user`、Agent routing/User attention 正交轴、Structured Content 真源与原子 User Mention Notification |
| [ADR-0166](0166-progressive-built-in-cli-teaching.md) | Progressive Built-In CLI Teaching | `accepted` | [v0.65](../versions/v0.65/README.md) | 冻结三层 CLI 教学、窄触发 `cli-operations`、精确 help/no-locator recovery 与 Memory 无损拆分 |
| [ADR-0167](0167-seven-skill-official-inventory.md) | Seven-Skill Official Inventory | `superseded` | [v0.65](../versions/v0.65/README.md) | ← ADR-0159；→ ADR-0174；官方集合曾冻结为七项并继承 pinned `tasteful-ui` |
| [ADR-0174](0174-ten-skill-official-inventory-and-pinned-matt-pocock-imports.md) | Ten-Skill Official Inventory and Pinned Matt Pocock Imports | `superseded` | [v0.70](../versions/v0.70/README.md) | ← ADR-0167；→ ADR-0176；官方集合曾冻结为十项并纳入三项 pinned `mattpocock/skills` 导入 |
| [ADR-0176](0176-eleven-skill-official-inventory-and-system-required-operations.md) | Eleven-Skill Official Inventory and System-Required Operations | `superseded` | [v0.71](../versions/v0.71/README.md) | ← ADR-0174；→ ADR-0181；官方集合曾冻结为十一项，并引入 Rovai Campfire 与两项 system-required operational Skill |
| [ADR-0177](0177-controlled-shutdown-fences-product-execution.md) | Controlled Shutdown Fences Product Execution Without Claiming Runtime Outcome | `accepted` | [v0.71](../versions/v0.71/README.md) | 局部替代 ADR-0168 的非终态 blocker 规则；保留可靠 Runtime terminal 权威并增加 durable product fence |
| [ADR-0178](0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md) | Best-Effort Online Memory Capture and Actor-Bounded Agent Mutation | `accepted` | [v0.73](../versions/v0.73/README.md) | ← ADR-0069；冻结 best-effort online capture、Agent 自身 Companion/有向 Relationship 与 Hearth user review 权威 |
| [ADR-0179](0179-normalized-memory-store-v3-with-isolated-hearth-review.md) | Normalized Memory Store v3 with Isolated Hearth Review | `accepted` | [v0.73](../versions/v0.73/README.md) | ← ADR-0070；冻结独立 Review Item、terminal body clearing、publication reconciliation 与 Forget 闭包 |
| [ADR-0180](0180-single-agent-memory-write-command.md) | Single Agent Memory Write Command with Outcome-Discriminated Output | `accepted` | [v0.73](../versions/v0.73/README.md) | 局部替代 ADR-0124/ADR-0135 的 Memory command/output 条款；统一 write 不合并领域聚合 |
| [ADR-0181](0181-twelve-skill-official-inventory-and-runtime-aligned-collaboration.md) | Twelve-Skill Official Inventory and Runtime-Aligned Collaboration | `superseded` | [v0.74](../versions/v0.74/README.md) | ← ADR-0176；→ ADR-0191；官方集合曾冻结为十二项，并引入 Runtime 对齐协作消息与 Review Duo 输入边界 |
| [ADR-0182](0182-core-resolved-current-camp-display-name-inline-addressing-alias.md) | Core-Resolved Current-Camp Display-Name Inline Addressing Alias | `accepted` | [v0.75](../versions/v0.75/README.md) | 局部扩展 ADR-0163 的 inline source；显示名只在 Core 发送事务中解析并冻结为 canonical Agent ID |
| [ADR-0183](0183-scope-identified-agent-memory-revision-targets.md) | Scope-Identified Agent Memory Revision Targets | `superseded` | [v0.75](../versions/v0.75/README.md) | → ADR-0186；历史 flat Search/Read/revise Scope identity 合同 |
| [ADR-0184](0184-line-leading-display-name-inline-addressing-alias.md) | Line-Leading Display-Name Inline Addressing Alias | `accepted` | [v0.76](../versions/v0.76/README.md) | 局部收窄 ADR-0182 的 alias position；显示名 alias 只在 logical line 首个非空白 token 寻址 |
| [ADR-0185](0185-durable-composer-reply-intent-and-explicit-recipient-resolution.md) | Durable Composer Reply Intent and Explicit Recipient Resolution | `accepted` | [v0.77](../versions/v0.77/README.md) | 局部替代 ADR-0128 的 caller-supplied user reply target，并扩展 ADR-0080 的 Draft 持久范围与显式换人边界 |
| [ADR-0186](0186-complete-exact-scope-memory-view-and-copyable-target.md) | Complete Exact-Scope Memory View and Copyable Revision Target | `accepted` | [v0.78](../versions/v0.78/README.md) | ← ADR-0183；冻结 complete exact-Scope View、copyable target、active body quota、64 KiB fail-closed 与 Memory-domain clean break |
| [ADR-0187](0187-durable-composer-recipient-continuation.md) | Durable Composer Recipient Continuation | `accepted` | [v0.80](../versions/v0.80/README.md) | 扩展 ADR-0080/ADR-0128 的 Draft 与 exact send，并复用 ADR-0185 的显式修复和无 Default Lead fallback |
| [ADR-0188](0188-bundled-skill-bootstrap-fast-path-and-execution-integrity.md) | Bundled Skill Bootstrap Fast Path and Execution-Time Integrity | `accepted` | [v0.82](../versions/v0.82/README.md) | 冻结 bundled Skill 启动快速路径与 AgentRun 执行前完整内容校验门禁 |
| [ADR-0189](0189-settings-only-runtime-preview-outside-product-catalog.md) | Settings-Only Runtime Preview Outside the Product Catalog | `accepted` | [v0.83](../versions/v0.83/README.md) | 冻结 Renderer-only Runtime Preview 与可执行 Product Runtime Catalog 的权威边界 |
| [ADR-0190](0190-user-placeable-agent-execution-console.md) | User-Placeable Agent Execution Console | `accepted` | [v0.84](../versions/v0.84/README.md) | 冻结默认底部、可移入 Inspector 且不复制执行事实的唯一执行 console 边界 |
| [ADR-0191](0191-agent-mediated-member-creation-and-thirteen-skill-inventory.md) | Agent-Mediated Member Creation and Thirteen-Skill Official Inventory | `accepted` | [v0.85](../versions/v0.85/README.md) | ← ADR-0181；冻结十三项 official Skill、Agent 确认后的队员创建、受控头像导入与 imported→official 晋升 |
