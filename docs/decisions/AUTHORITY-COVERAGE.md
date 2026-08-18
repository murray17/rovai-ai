---
document_type: decision-authority-coverage
authority: adr-clean-break-current-authority
baseline_commit: 737699668a3034c7381ff14d74769bc7af6f0149
last_updated: 2026-08-19
---

# 当前决策权威覆盖

本表按迁移基线中每份当前有效 ADR 的 Decision 章节及其三级章节拆分规范内核，并把它们映射到无需读取历史决定即可理解的当前权威章节。`migrated` 表示原内核仍有效且已直接进入当前权威；`replaced` 表示原内核已被后续决定改变，表中目标是归一后的当前语义；`retired` 表示一次性迁移规则已经完成、不再构成当前产品约束。后两类的本次裁决与理由记录在 [V1.09-D02](../versions/v1.09/decisions.md#v1-09-d02)。

`migrated` 必须对应“当前有效=是”，`replaced | retired` 必须对应“当前有效=否”。每个目标都必须是当前权威文档中实际存在的精确章节锚点；链接到历史决定本身不算覆盖。

覆盖表只证明规范归属，不证明代码已经实现。精确字段和状态机继续由目标章节链接的当前 Contract 拥有。

| 原 ADR | 主题 | 规范内核 | 当前有效 | 当前权威类型 | 当前权威章节 | 处理方式 |
| --- | --- | --- | --- | --- | --- | --- |
| ADR-0001 | `core-data` | Core Transaction | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-command-transaction) | `migrated` |
| ADR-0013 | `core-data` | No generic Task Evidence service | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-managed-content) | `migrated` |
| ADR-0013 | `core-data` | Managed Blob store | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-managed-content) | `replaced` |
| ADR-0013 | `core-data` | Read model and subscriptions | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-read-side) | `migrated` |
| ADR-0013 | `core-data` | API boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-read-side) | `migrated` |
| ADR-0013 | `core-data` | Migration | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-managed-content) | `retired` |
| ADR-0087 | `core-data` | Core SQLite 是唯一持久真源 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-notifications) | `migrated` |
| ADR-0087 | `core-data` | Core 提供通知命令与 Read Side | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-notifications) | `migrated` |
| ADR-0087 | `core-data` | Renderer 拥有呈现，Main 不保存副本 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-notifications) | `migrated` |
| ADR-0175 | `core-data` | Core-Owned Notification Occurrence, Episode and Change Journal | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-notifications) | `migrated` |
| ADR-0071 | `camp-workspace` | Camp creation is its own domain action | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-lifecycle) | `migrated` |
| ADR-0071 | `camp-workspace` | Camp name and origin are durable | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-lifecycle) | `migrated` |
| ADR-0071 | `camp-workspace` | Conversation is allocated only for admitted targets | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-lifecycle) | `replaced` |
| ADR-0071 | `camp-workspace` | Durable empty Camps | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-lifecycle) | `migrated` |
| ADR-0072 | `camp-workspace` | Camp persists a directory workspace | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-workspace) | `replaced` |
| ADR-0072 | `camp-workspace` | Git is a dynamic capability | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-workspace) | `migrated` |
| ADR-0072 | `camp-workspace` | Git observations are AgentRun audit facts | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-workspace) | `migrated` |
| ADR-0072 | `camp-workspace` | Project navigation groups by canonical directory | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-workspace) | `replaced` |
| ADR-0074 | `camp-workspace` | Quick Chat is the canonical term | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-workspace) | `migrated` |
| ADR-0074 | `camp-workspace` | Every active identifier uses the new language | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-workspace) | `migrated` |
| ADR-0074 | `camp-workspace` | The cutover has no compatibility layer | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-workspace) | `migrated` |
| ADR-0080 | `camp-workspace` | Durable Camp Composer Draft and Atomic Attachment Consumption | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-composer) | `replaced` |
| ADR-0081 | `camp-workspace` | Camp-Public Attachment Paths and Frozen Discovery | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-resources) | `replaced` |
| ADR-0128 | `camp-workspace` | Exact Draft revision is the only user write entry | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-composer) | `replaced` |
| ADR-0128 | `camp-workspace` | Every CampMessage has structured content | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-composer) | `migrated` |
| ADR-0128 | `camp-workspace` | Camp creation remains separate | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-composer) | `migrated` |
| ADR-0128 | `camp-workspace` | Current identities and format versions | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-composer) | `migrated` |
| ADR-0128 | `camp-workspace` | Clean break | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-composer) | `migrated` |
| ADR-0145 | `camp-workspace` | Core-Owned Pending Camp Draft Activation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-lifecycle) | `migrated` |
| ADR-0169 | `camp-workspace` | Core-Owned Directory Attachment Snapshots | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-resources) | `migrated` |
| ADR-0173 | `camp-workspace` | Leading Structured Mentions Excluded from Generated Camp Names | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-lifecycle) | `migrated` |
| ADR-0185 | `camp-workspace` | Durable Composer Reply Intent and Explicit Recipient Resolution | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-composer) | `migrated` |
| ADR-0187 | `camp-workspace` | Durable Composer Recipient Continuation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-composer) | `migrated` |
| ADR-0202 | `camp-workspace` | Desktop-Owned Pre-Core First-Run Admission and Checkpointed Product Provisioning | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-resources) | `migrated` |
| ADR-0206 | `camp-workspace` | User-Confirmed Force Camp Deletion | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-resources) | `migrated` |
| ADR-0056 | `member-identity` | One controlled reference on AgentProfile | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0056 | `member-identity` | Split reference, byte and presentation authority | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0056 | `member-identity` | Asset-first commit and orphan retention | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0056 | `member-identity` | Existing built-in companions and upgrade | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `replaced` |
| ADR-0056 | `member-identity` | Local-only image safety | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0056 | `member-identity` | Backup boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0057 | `member-identity` | Stable presence state | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-lifecycle) | `migrated` |
| ADR-0057 | `member-identity` | Temporary leave | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-lifecycle) | `migrated` |
| ADR-0057 | `member-identity` | Retained permanent removal | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-lifecycle) | `replaced` |
| ADR-0057 | `member-identity` | Operational exclusion and historical identity | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-lifecycle) | `migrated` |
| ADR-0057 | `member-identity` | Compatibility with earlier `active AgentProfile` rules | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-lifecycle) | `migrated` |
| ADR-0060 | `member-identity` | Opaque routing identity | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `replaced` |
| ADR-0060 | `member-identity` | Globally unique member names | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `migrated` |
| ADR-0060 | `member-identity` | Mention input and historical display | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `migrated` |
| ADR-0060 | `member-identity` | Summary model entry | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `replaced` |
| ADR-0086 | `member-identity` | Single Current Built-In Member Appearance Set | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0110 | `member-identity` | Three identity layers | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `migrated` |
| ADR-0110 | `member-identity` | Monotonic allocation and non-reuse | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `migrated` |
| ADR-0110 | `member-identity` | Model and tool projection | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `migrated` |
| ADR-0110 | `member-identity` | Upgrade and continuity | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-identity) | `migrated` |
| ADR-0146 | `member-identity` | `MEMBER_IDENTITY` is the sole self identity | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0146 | `member-identity` | `COLLABORATION_STATE` is peer routing identity | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0146 | `member-identity` | Digest and inclusion are separate evidence | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0146 | `member-identity` | Current-only contract break | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-projection) | `migrated` |
| ADR-0058 | `collaboration-task-message` | Collaboration aggregate | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Project projection and repository binding | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-workspace) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Camp membership and Member Presence | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#member-lifecycle) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Member Order | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0058 | `collaboration-task-message` | New Camp creation | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-lifecycle) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Default Lead validity and reconciliation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0058 | `collaboration-task-message` | Addressing and execution admission | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Messages and execution | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-delivery) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Lightweight Task | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Dynamic Task context | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Permanent Camp deletion | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#camp-resources) | `replaced` |
| ADR-0058 | `collaboration-task-message` | Required constraints and migration | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `retired` |
| ADR-0076 | `collaboration-task-message` | 1. Renderer 先乐观显示用户消息 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0076 | `collaboration-task-message` | 2. 发送请求只提交消息与待执行 Run | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0076 | `collaboration-task-message` | 3. 调度器拥有执行前检查 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0076 | `collaboration-task-message` | 4. ending Git observation 属于终态 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0076 | `collaboration-task-message` | 5. 旧 Pending Execution Intent 仅作迁移恢复 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0077 | `collaboration-task-message` | Responsive CampTurn Cancellation Boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0093 | `collaboration-task-message` | Core-Owned Atomic CampTurn Execution Budgets | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `migrated` |
| ADR-0106 | `collaboration-task-message` | Agent-Bounded Cross-Camp Public History Retrieval | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-history-addressing) | `migrated` |
| ADR-0108 | `collaboration-task-message` | Discovery-Only Camp Message Search and Sequence-Paged Reads | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-history-addressing) | `replaced` |
| ADR-0130 | `collaboration-task-message` | Public A2A Messages and Unified Message Delivery | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-delivery) | `replaced` |
| ADR-0131 | `collaboration-task-message` | Recipient-Scoped Event-Driven Delivery Dispatch and Interrupted Recovery | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-delivery) | `migrated` |
| ADR-0134 | `collaboration-task-message` | Explicit Runtime Public Output Boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-delivery) | `migrated` |
| ADR-0136 | `collaboration-task-message` | 1. Keep responsibility, notification, and execution separate | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0136 | `collaboration-task-message` | 2. Adopt the five-state Durable Task v2 lifecycle | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0136 | `collaboration-task-message` | 3. Make Task Coordination Authority explicit | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `replaced` |
| ADR-0136 | `collaboration-task-message` | 4. Separate current membership from execution eligibility | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0136 | `collaboration-task-message` | 5. Make permanent removal a managed atomic cascade | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0136 | `collaboration-task-message` | 6. Locally replace earlier Task clauses | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0137 | `collaboration-task-message` | 1. Admit Task linkage exactly once | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `replaced` |
| ADR-0137 | `collaboration-task-message` | 2. Grandfather every accepted responsibility against later Task changes | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0137 | `collaboration-task-message` | 3. Keep independent execution admission current | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0137 | `collaboration-task-message` | 4. Locally replace continuous Task execution checks | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0157 | `collaboration-task-message` | Message-Owned AgentRun Instruction Without Expected Output Metadata | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-task) | `migrated` |
| ADR-0162 | `collaboration-task-message` | Missing-Send Recovery Publication at Successful AgentRun Termination | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-delivery) | `migrated` |
| ADR-0163 | `collaboration-task-message` | Explicit Caller Return and Core-Managed Reply Reference | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-delivery) | `replaced` |
| ADR-0165 | `collaboration-task-message` | Core-Owned Current-User Message Attention | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#core-notifications) | `replaced` |
| ADR-0170 | `collaboration-task-message` | Current-Run Committed Self-Write Exact Read | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-history-addressing) | `migrated` |
| ADR-0182 | `collaboration-task-message` | Core-Resolved Current-Camp Display-Name Inline Addressing Alias | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-history-addressing) | `replaced` |
| ADR-0184 | `collaboration-task-message` | Line-Leading Display-Name Inline Addressing Alias | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-history-addressing) | `migrated` |
| ADR-0193 | `collaboration-task-message` | Durable Gather Barrier over Unified Message Delivery | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-gather) | `replaced` |
| ADR-0195 | `collaboration-task-message` | Generation-Scoped Last Gather Return with Independent Bound | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-gather) | `migrated` |
| ADR-0215 | `collaboration-task-message` | Unified Single-Camp History Target and Public Message Publication Boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-history-addressing) | `migrated` |
| ADR-0216 | `collaboration-task-message` | Explicit Agent Addressing Intent as the Delivery Gate | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-history-addressing) | `migrated` |
| ADR-0059 | `runtime-execution-security` | Resource authority belongs to the recipient Runtime | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0059 | `runtime-execution-security` | Permission semantics are versioned per Run | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0059 | `runtime-execution-security` | Run Workspace is a working-directory snapshot | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0059 | `runtime-execution-security` | A2A does not gain a Workspace argument | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0059 | `runtime-execution-security` | Native permission requests remain user-visible | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0059 | `runtime-execution-security` | Runtime action recording is observationally honest | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0059 | `runtime-execution-security` | Rovai-ai-owned file safety remains Core-enforced | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0062 | `runtime-execution-security` | Stop 作用于整个 CampTurn 执行树 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-recovery-shutdown) | `migrated` |
| ADR-0062 | `runtime-execution-security` | 执行终止与效果确定性分离 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-recovery-shutdown) | `migrated` |
| ADR-0062 | `runtime-execution-security` | Composer 解锁边界 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-recovery-shutdown) | `migrated` |
| ADR-0065 | `runtime-execution-security` | 产品目录只包含已接入 Runtime | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0065 | `runtime-execution-security` | 当前实现继续以精确 MCP 能力准入 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0065 | `runtime-execution-security` | 兼容性候选只保存在项目文档 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `replaced` |
| ADR-0066 | `runtime-execution-security` | 1. 产品目录与本机可用性分离 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0066 | `runtime-execution-security` | 2. 使用应用自有的 Runtime Search Environment | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0066 | `runtime-execution-security` | 3. 快速发现与深度探测拥有不同权威 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `replaced` |
| ADR-0066 | `runtime-execution-security` | 4. 普通成员持久选择产品，Installation 作为内部共享身份 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0066 | `runtime-execution-security` | 5. 刷新采用最近成功证据与失败分类 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `replaced` |
| ADR-0066 | `runtime-execution-security` | 6. 路径失效时自动执行经过验证的原位迁移 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0066 | `runtime-execution-security` | 7. Run 准入通过可持久恢复的 Resolution Job 衔接 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-admission) | `replaced` |
| ADR-0066 | `runtime-execution-security` | 8. Native Session 兼容性不由路径或版本单独决定 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0066 | `runtime-execution-security` | 9. 路径与诊断只属于高级界面 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `replaced` |
| ADR-0075 | `runtime-execution-security` | 1. 完整哈希退出消息发送热路径 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0075 | `runtime-execution-security` | 2. 成功完整校验同时保存轻量文件身份 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0075 | `runtime-execution-security` | 3. 实际执行边界先做轻量比较 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `replaced` |
| ADR-0075 | `runtime-execution-security` | 4. 低频完整校验触发 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0075 | `runtime-execution-security` | 5. 使用标准 SHA-256 实现 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0079 | `runtime-execution-security` | Two-Phase Cancellation Projection and Bounded Runtime Interrupt | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-recovery-shutdown) | `migrated` |
| ADR-0083 | `runtime-execution-security` | Core 统一拥有发现、检查和缓存 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0083 | `runtime-execution-security` | 完整检查只在后台调度 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0083 | `runtime-execution-security` | 页面读取缓存并按需触发刷新 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0083 | `runtime-execution-security` | 用户状态只表达结果和动作 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0123 | `runtime-execution-security` | 1. 正式 AgentRun 独占一个 Runtime 进程 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0123 | `runtime-execution-security` | 2. AgentRuntimeFleetManager 是唯一正式进程所有者 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0123 | `runtime-execution-security` | 3. 复用兼容性采用三项精确相等 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `replaced` |
| ADR-0123 | `runtime-execution-security` | 4. Resident 配额只约束跨 Run 保留的进程 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0123 | `runtime-execution-security` | 5. acquire 原子选择兼容进程、Resident 或 Burst | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0123 | `runtime-execution-security` | 6. Run 结束由 Adapter 给出可复用结论 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0123 | `runtime-execution-security` | 7. Idle Sweeper 强制随 Fleet 启动 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0123 | `runtime-execution-security` | 8. IdleWarm 明确保留进程级外部 MCP 状态 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0123 | `runtime-execution-security` | 9. Fleet 不跨 Core generation 复用 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0126 | `runtime-execution-security` | 所有 Codex 进程使用 Codex 自己解析的 Home | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0126 | `runtime-execution-security` | Rovai 只拥有 Native Binding | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0126 | `runtime-execution-security` | Codex MCP 使用 config discovery 与 thread-scoped addition | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0126 | `runtime-execution-security` | Fleet compatibility 不包含 Conversation Home 或 thread MCP | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-process-verification) | `migrated` |
| ADR-0127 | `runtime-execution-security` | Member configuration is complete or absent | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0127 | `runtime-execution-security` | Resolved binding is internal execution state | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0127 | `runtime-execution-security` | Clean break | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0148 | `runtime-execution-security` | Strict read boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0148 | `runtime-execution-security` | Explicit single-item repair boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0148 | `runtime-execution-security` | Diagnostics export v5 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0156 | `runtime-execution-security` | Frozen Logical Runtime Identity and Bounded Installation Rebind | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0164 | `runtime-execution-security` | Accepted Input Recovery Requires Proven Native Turn Reconciliation | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-recovery-shutdown) | `replaced` |
| ADR-0168 | `runtime-execution-security` | Planned Shutdown Preserves Runtime Terminal Authority | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-recovery-shutdown) | `replaced` |
| ADR-0177 | `runtime-execution-security` | Controlled Shutdown Fences Product Execution Without Claiming Runtime Outcome | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-recovery-shutdown) | `migrated` |
| ADR-0189 | `runtime-execution-security` | Settings-Only Runtime Preview Outside the Product Catalog | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `migrated` |
| ADR-0192 | `runtime-execution-security` | Purpose-Scoped Runtime Launch and Execution-Deferred Verification | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `replaced` |
| ADR-0204 | `runtime-execution-security` | On-Demand Runtime Deep Verification with Manager-Owned Attempts | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation) | `replaced` |
| ADR-0207 | `runtime-execution-security` | Explicit Maximum-Authority Member Runtime Defaults | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0208 | `runtime-execution-security` | User-Authorized TRAE Light and Availability Verification | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0209 | `runtime-execution-security` | Bounded TRAE Cold Session History Restore | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-recovery-shutdown) | `migrated` |
| ADR-0210 | `runtime-execution-security` | Platform-Qualified Product Runtime Admission | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0211 | `runtime-execution-security` | Atomic Windows Managed Process Launch | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0213 | `runtime-execution-security` | Windows Local Private Storage and Filesystem Admission | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `migrated` |
| ADR-0007 | `session-context-bootstrap` | Portable Conversation Handoff | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0051 | `session-context-bootstrap` | 工具组与网关 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-history-addressing) | `replaced` |
| ADR-0051 | `session-context-bootstrap` | 输出纪律 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0051 | `session-context-bootstrap` | 冻结边界封顶与 tombstone 例外 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0051 | `session-context-bootstrap` | 中文检索、短查询回退与转义 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0051 | `session-context-bootstrap` | 派生索引层 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0067 | `session-context-bootstrap` | Two context lifecycles | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0067 | `session-context-bootstrap` | Immutable Native Session Bootstrap evidence | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `replaced` |
| ADR-0067 | `session-context-bootstrap` | Session Charter and rotation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0067 | `session-context-bootstrap` | Dynamic sections | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `replaced` |
| ADR-0067 | `session-context-bootstrap` | Trusted A2A reply alias | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-delivery) | `replaced` |
| ADR-0067 | `session-context-bootstrap` | ContextManifest, coverage and recovery | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `replaced` |
| ADR-0067 | `session-context-bootstrap` | Task and attachment boundaries | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `replaced` |
| ADR-0100 | `session-context-bootstrap` | Six fields remain one identity aggregate | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0100 | `session-context-bootstrap` | Bootstrap has three sections in one fixed order | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0100 | `session-context-bootstrap` | Stable components and latest identity have different lifecycles | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0100 | `session-context-bootstrap` | Runtime delivery matrix | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0100 | `session-context-bootstrap` | The complete Bootstrap is intentionally not evidence | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0100 | `session-context-bootstrap` | Contract break | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0100 | `session-context-bootstrap` | Peer privacy remains unchanged | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Accepted Public Context Boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Current Input remains complete | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Originating Public User Message for Member Calls | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Bounded Raw Public Messages | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Unicode-scalar body prefix and history budget | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Explicit omission notice | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Stable collaboration state | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Versioned Context Delivery Profile | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | ContextManifest, recovery and clean break | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Summary system and advanced settings are removed | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0129 | `session-context-bootstrap` | Replacement scope | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0132 | `session-context-bootstrap` | Bounded Public Reference Context Closure and Profile v2 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0138 | `session-context-bootstrap` | Durable Bootstrap Redelivery Requirement and Accepted-Input Acknowledgement | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0139 | `session-context-bootstrap` | Version-Owned Bootstrap Redelivery Runtime Policy and Enablement Transition | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0140 | `session-context-bootstrap` | Runtime-Specific Compaction Signal Admission Point and Prepared-Input Cutoff | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0141 | `session-context-bootstrap` | One serialized Runtime input preparation boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0141 | `session-context-bootstrap` | Redelivery is a transient input overlay | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0141 | `session-context-bootstrap` | Evidence and privacy | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0141 | `session-context-bootstrap` | Combined budget and failure | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0142 | `session-context-bootstrap` | Independent narrow Observer authority | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0142 | `session-context-bootstrap` | One Session-scoped Core command | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0142 | `session-context-bootstrap` | Interruption is not compaction evidence | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0143 | `session-context-bootstrap` | Closed internal policy | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0143 | `session-context-bootstrap` | Detector state is not Runtime Readiness | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0143 | `session-context-bootstrap` | No retrospective inference on operational recovery | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0143 | `session-context-bootstrap` | Support claims remain evidence-bound | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap) | `migrated` |
| ADR-0147 | `session-context-bootstrap` | Four authorities stay separate | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0147 | `session-context-bootstrap` | Model projection may be compact, but not lossy or renamed | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `replaced` |
| ADR-0147 | `session-context-bootstrap` | Stable rules and per-Run facts are not duplicated | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0147 | `session-context-bootstrap` | Version axes follow their actual owners | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0149 | `session-context-bootstrap` | Bounded Whole-History Omission Evidence | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0152 | `session-context-bootstrap` | Lead-Owned Task Responsibility and Self-Active Task Awareness | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `replaced` |
| ADR-0153 | `session-context-bootstrap` | Explicit Empty Self-Active Task Snapshot | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0194 | `session-context-bootstrap` | Mandatory Typed Gather Completion Current Input | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#collaboration-gather) | `replaced` |
| ADR-0196 | `session-context-bootstrap` | Self-Contained Gather Request in Mandatory Completion Input | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0200 | `session-context-bootstrap` | Charter remains stable authority, not command documentation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0200 | `session-context-bootstrap` | Shared Conversation uses one Camp and compact message continuation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0200 | `session-context-bootstrap` | Run Facts replace Run Notices | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0200 | `session-context-bootstrap` | Version and clean-break boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0203 | `session-context-bootstrap` | Structured Current Input Skill Links | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-manifest-run-facts) | `migrated` |
| ADR-0218 | `session-context-bootstrap` | Audience-Specific Principal Message Projection | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#context-public-history) | `migrated` |
| ADR-0019 | `memory` | Application-Global Memory Ownership | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-lifecycle) | `migrated` |
| ADR-0022 | `memory` | Immutable Memory Scope | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-lifecycle) | `migrated` |
| ADR-0026 | `memory` | Explicit Memory Supersession | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-lifecycle) | `migrated` |
| ADR-0027 | `memory` | Memory-Domain Forgetting | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-lifecycle) | `migrated` |
| ADR-0029 | `memory` | Bounded Memory Reactivation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-lifecycle) | `migrated` |
| ADR-0047 | `memory` | User-Initiated Memory Export Boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0068 | `memory` | Core-brokered read boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0068 | `memory` | Relationship direction and applicable set | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0068 | `memory` | Revision retrieval keys | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0068 | `memory` | Session Memory Entrypoint | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0068 | `memory` | Search | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0068 | `memory` | Read and cache state | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0068 | `memory` | Evidence and failure | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0178 | `memory` | Online capture has a best-effort service level | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0178 | `memory` | Memory remains single-effective and provenance-aware | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0178 | `memory` | Agent mutation is bounded to the actor's own durable responsibility | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0178 | `memory` | Core keeps deterministic safety and resource admission | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0179 | `memory` | Memory and Hearth review are separate authoritative aggregates | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0179 | `memory` | Pending candidate content is isolated; terminal rows are body-free | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0179 | `memory` | Publication and Forget close targetless recreation paths | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0179 | `memory` | Review decisions have two independent compare-and-swap boundaries | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0179 | `memory` | Existing data is migrated without erasing formal Memory | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-write-store) | `migrated` |
| ADR-0186 | `memory` | Complete Exact-Scope Memory View and Copyable Revision Target | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#memory-read-projection) | `migrated` |
| ADR-0014 | `skills-mcp-builtins` | Stable gateway and replaceable connectors | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0014 | `skills-mcp-builtins` | Native Binding credential | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0014 | `skills-mcp-builtins` | Team MCP tool set | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0014 | `skills-mcp-builtins` | Authorization and scope | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0014 | `skills-mcp-builtins` | Idempotency and transactions | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0014 | `skills-mcp-builtins` | Charter and Tool Schema | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0014 | `skills-mcp-builtins` | Adapter surface | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0018 | `skills-mcp-builtins` | File-backed canonical configuration | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0018 | `skills-mcp-builtins` | Explicit Member scope | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0018 | `skills-mcp-builtins` | Per-AgentRun projection | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `replaced` |
| ADR-0018 | `skills-mcp-builtins` | Execution and permission boundary | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0088 | `skills-mcp-builtins` | 三个能力轴独立冻结 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0088 | `skills-mcp-builtins` | 只挂接一个无凭据的内部 Bridge | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0088 | `skills-mcp-builtins` | 原生配置采用保留 ambient 的受管合并 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0088 | `skills-mcp-builtins` | Core 以 OS 进程身份建立连接绑定 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0088 | `skills-mcp-builtins` | 原生权限必须窄授权且单独同意 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0088 | `skills-mcp-builtins` | Attachment 与工具合同按 Session/Run 冻结 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0088 | `skills-mcp-builtins` | 以真实证据准入，不按 Runtime 名称猜测 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0089 | `skills-mcp-builtins` | One canonical built-in catalog | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0089 | `skills-mcp-builtins` | Discovery proves attachment, not authority | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0089 | `skills-mcp-builtins` | Exact permission is a complete user-consented bundle | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0089 | `skills-mcp-builtins` | Tool contract participates in Session compatibility | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0089 | `skills-mcp-builtins` | Real evidence gates readiness | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0103 | `skills-mcp-builtins` | One canonical JSON envelope | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0103 | `skills-mcp-builtins` | Hidden management metadata | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0103 | `skills-mcp-builtins` | Identity and lifecycle | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0103 | `skills-mcp-builtins` | Reviewed built-in definitions | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `replaced` |
| ADR-0103 | `skills-mcp-builtins` | Sensitive values and compatibility | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0105 | `skills-mcp-builtins` | Library identity and revisions | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `replaced` |
| ADR-0105 | `skills-mcp-builtins` | Enablement and assignment | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `replaced` |
| ADR-0105 | `skills-mcp-builtins` | Safe projection and overlapping discovery | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `replaced` |
| ADR-0105 | `skills-mcp-builtins` | Run stability and presentation | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `replaced` |
| ADR-0124 | `skills-mcp-builtins` | CLI 是唯一内置工具运输 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0124 | `skills-mcp-builtins` | CLI 使用领域分组命令，canonical operation 不改名 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0124 | `skills-mcp-builtins` | Bootstrap 只承载稳定 CLI 合同 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0124 | `skills-mcp-builtins` | 同一命令支持直接参数、stdin、heredoc 和输入文件 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0124 | `skills-mcp-builtins` | 内置 MCP 是 clean break，不是兼容模式 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0124 | `skills-mcp-builtins` | 不可用时在输入投递前失败 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0124 | `skills-mcp-builtins` | 九个 Runtime 共同构成发布门禁 | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#runtime-platform-security) | `replaced` |
| ADR-0124 | `skills-mcp-builtins` | Core 拥有调用响应 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0124 | `skills-mcp-builtins` | 失败必须给出安全、明确的处理规则 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0124 | `skills-mcp-builtins` | 当前 Run 权限不能来自可复用进程身份 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0124 | `skills-mcp-builtins` | Shell 子进程共享当前 Run 的调用身份 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0124 | `skills-mcp-builtins` | 重试不重复效果 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0124 | `skills-mcp-builtins` | CLI shell 只作为可验证的运输证据 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0125 | `skills-mcp-builtins` | 只有 Additive 与 Unsupported 两种能力 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0125 | `skills-mcp-builtins` | Projection 分为 Core Request 与 Adapter Finalization | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0125 | `skills-mcp-builtins` | 同名策略是 Adapter 能力 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0125 | `skills-mcp-builtins` | 没有 Runtime-wide 降级或运输 fallback | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0125 | `skills-mcp-builtins` | 配置与诊断分离 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0135 | `skills-mcp-builtins` | 1. Keep one complete Core envelope | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0135 | `skills-mcp-builtins` | 2. Project only after validation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0135 | `skills-mcp-builtins` | 3. Define the Agent result contract by operation | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `replaced` |
| ADR-0135 | `skills-mcp-builtins` | 4. Keep discovery inside Core | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0135 | `skills-mcp-builtins` | 5. Make output mode host-owned | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0135 | `skills-mcp-builtins` | 6. Publish safe error channels | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0135 | `skills-mcp-builtins` | 7. Locally replace ADR-0124's Agent-facing clauses | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0158 | `skills-mcp-builtins` | Default-All Runtime Delivery for Managed Skills | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `migrated` |
| ADR-0161 | `skills-mcp-builtins` | Event-Driven Root-Scoped Skill Projection Reconciliation | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `replaced` |
| ADR-0166 | `skills-mcp-builtins` | Progressive Built-In CLI Teaching | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0180 | `skills-mcp-builtins` | Single Agent Memory Write Command with Outcome-Discriminated Output | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0188 | `skills-mcp-builtins` | Bundled Skill Bootstrap Fast Path and Execution-Time Integrity | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `migrated` |
| ADR-0191 | `skills-mcp-builtins` | Agent-Mediated Member Creation and Thirteen-Skill Official Inventory | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `migrated` |
| ADR-0197 | `skills-mcp-builtins` | Empty User-Owned MCP Library Without Product Presets | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-external-mcp) | `migrated` |
| ADR-0198 | `skills-mcp-builtins` | Bounded Open-Round Protocol for Self-Contained Grill Duo Skills | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `migrated` |
| ADR-0199 | `skills-mcp-builtins` | Session-Semantic Four-Message Review Duo | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `migrated` |
| ADR-0212 | `skills-mcp-builtins` | Cross-Platform Local IPC for Built-in Tool Transport v14 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0214 | `skills-mcp-builtins` | Crash-Recoverable Windows Skill Projection | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-library-projection) | `migrated` |
| ADR-0217 | `skills-mcp-builtins` | Built-in Tool Transport v15 Inherits the Cross-Platform v14 Wire | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport) | `migrated` |
| ADR-0061 | `evidence-activity` | Execution Evidence 是 AgentRun 的独立权威记录 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-usage) | `migrated` |
| ADR-0061 | `evidence-activity` | 用户可见不等于 Agent 可用 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-usage) | `migrated` |
| ADR-0061 | `evidence-activity` | 大内容使用 Managed Blob | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-usage) | `migrated` |
| ADR-0061 | `evidence-activity` | Read Side 与生命周期 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-usage) | `migrated` |
| ADR-0061 | `evidence-activity` | 展示与安全渲染 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-usage) | `migrated` |
| ADR-0111 | `evidence-activity` | Four explicit layers | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0111 | `evidence-activity` | Classification authority | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0111 | `evidence-activity` | Observation honesty | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0112 | `evidence-activity` | 1. Execution Evidence 是唯一不可变事实真源 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0112 | `evidence-activity` | 2. Canonical Runtime Activity 是持久且可重建的 Core Projection | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0112 | `evidence-activity` | 3. 分类升级不得静默改写历史 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0112 | `evidence-activity` | 4. Lifecycle Projection 依赖版本化 Canonical Activity | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0113 | `evidence-activity` | 1. 两种身份严格分离 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0113 | `evidence-activity` | 2. 身份必须限定在本次观测范围 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0113 | `evidence-activity` | 3. Core 只接受可证明的身份来源 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0113 | `evidence-activity` | 4. 重放必须稳定 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0114 | `evidence-activity` | 1. `capabilityKind` 的合同语义是 Activity Domain | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `replaced` |
| ADR-0114 | `evidence-activity` | 2. `semanticKind` 是可选且有证据边界的细分 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0114 | `evidence-activity` | 3. `presentationHint` 永远不是 Canonical 语义 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0114 | `evidence-activity` | 4. 词汇扩展必须注册和版本化 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0115 | `evidence-activity` | 1. Phase 与 Outcome 分离 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0115 | `evidence-activity` | 2. 结果解析边界 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0115 | `evidence-activity` | 3. 冲突、乱序与 Run 终态 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0115 | `evidence-activity` | 4. Live 与 Recovery 使用同一规则 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0116 | `evidence-activity` | 1. 版本固定在默认 Canonical Projection | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0116 | `evidence-activity` | 2. 分类升级生成显式平行 Projection | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0116 | `evidence-activity` | 3. Live operation 不中途换 classifier | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0116 | `evidence-activity` | 4. 显式迁移必须可追溯、可回滚 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0117 | `evidence-activity` | 1. 全部 Runtime 共用一份 Canonical 合同 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0117 | `evidence-activity` | 2. Coverage level 只描述观测能力 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0117 | `evidence-activity` | 3. v0.41 的初始分层 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0117 | `evidence-activity` | 4. 升级必须有证据 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0122 | `evidence-activity` | 1. v0.41 使用一张当前 Canonical Activity Projection | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0122 | `evidence-activity` | 2. v0.41 只实现当前 Mapping Registry | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0122 | `evidence-activity` | 3. 历史身份 replay 基础设施推迟 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity) | `migrated` |
| ADR-0205 | `evidence-activity` | Monitoring owns only Usage-derived persistence | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-usage) | `migrated` |
| ADR-0205 | `evidence-activity` | Read and retention boundaries stay bounded | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-usage) | `migrated` |
| ADR-0205 | `evidence-activity` | Cost authority remains grain-safe | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#evidence-usage) | `migrated` |
| ADR-0090 | `qualification` | Qualification is an externally verified delivery claim | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0090 | `qualification` | Human intervention has an exact boundary | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `replaced` |
| ADR-0090 | `qualification` | Formal Trials use fresh product state and real Runtimes | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `replaced` |
| ADR-0090 | `qualification` | Cases are sealed before scoring | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0090 | `qualification` | Repeats report reliability without retry-friendly inflation | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0090 | `qualification` | Collaboration evidence remains separate | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0090 | `qualification` | Evidence is private by default | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0092 | `qualification` | Recoverable Qualification Evaluation Integrity | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0094 | `qualification` | Formal Qualification Isolation and External Effect Coverage | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0095 | `qualification` | Layered Qualification Authority and Advisory Semantic Review | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0097 | `qualification` | Authority-Preserving Benchmark Evidence Ledgers | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0098 | `qualification` | Dual-Replica Evidence-Bound Semantic Judge Protocol | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-evidence) | `migrated` |
| ADR-0101 | `qualification` | Outcome-Only Collaboration-Value Qualification Cases | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-benchmark) | `migrated` |
| ADR-0102 | `qualification` | Immutable Diagnostic Portfolio Authority and Two-Repeat Stability | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-benchmark) | `migrated` |
| ADR-0151 | `qualification` | Versioned Benchmark Protocol and Axis-Scoped Comparability | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-benchmark) | `migrated` |
| ADR-0155 | `qualification` | Treatment-Blind Outcome and Process Judge Views | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-benchmark) | `migrated` |
| ADR-0171 | `qualification` | Opportunity-Based Tool Interaction Measurement and Independent Tool-Use Judge | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-benchmark) | `migrated` |
| ADR-0172 | `qualification` | Paired Collaboration Value and Outcome-Conditioned Efficiency | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#qualification-benchmark) | `migrated` |
| ADR-0048 | `product-renderer` | Rovai-ai Product Identity and Controlled Legacy Namespace Migration | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-navigation) | `migrated` |
| ADR-0078 | `product-renderer` | Quick Chat 只在导航中使用项目式投影 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-navigation) | `migrated` |
| ADR-0078 | `product-renderer` | 设置分类覆盖同一侧栏槽位 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-navigation) | `migrated` |
| ADR-0078 | `product-renderer` | Sidebar wordmark 与正式产品身份分离 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-navigation) | `migrated` |
| ADR-0078 | `product-renderer` | Core 健康只从诊断页访问 | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-navigation) | `migrated` |
| ADR-0084 | `product-renderer` | Inspector visibility is a local presentation preference | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-execution-surface) | `migrated` |
| ADR-0084 | `product-renderer` | Stop is one terminal CampTurn outcome in the conversation timeline | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-execution-surface) | `migrated` |
| ADR-0084 | `product-renderer` | Copy belongs to message content | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-execution-surface) | `migrated` |
| ADR-0084 | `product-renderer` | Shared top bar does not replace page content | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-execution-surface) | `migrated` |
| ADR-0154 | `product-renderer` | Agent-Level Continuous Execution Process Surface | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-execution-surface) | `replaced` |
| ADR-0160 | `product-renderer` | Focused Camp Inspector and Single Approval Surface | 否 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-execution-surface) | `replaced` |
| ADR-0190 | `product-renderer` | User-Placeable Agent Execution Console | 是 | Architecture | [当前基础不变量](../architecture/foundational-invariants.md#product-execution-surface) | `migrated` |
