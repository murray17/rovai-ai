---
document_type: adr
id: ADR-0057
title: "Member Presence and Retained Permanent Removal"
status: accepted
date: 2026-07-27
decision_scope: cross-version
source_version: v0.15
supersedes: [ADR-0041]
superseded_by: null
---

# ADR-0057: Member Presence and Retained Permanent Removal

## Context

旧 `AgentProfile` 使用 `active | disabled | archived` 同时承载“成员是否在队”、
“是否允许执行”和“是否仍在名册中”等不同含义。Runtime 配置与 Runtime 当前健康度
又是独立事实：一个在队成员可以没有配置 Runtime；一个已经配置 Runtime 的成员也
可能因本机 CLI、认证或探测状态暂时不能执行。

成员管理还需要两个不同强度的生命周期操作：

- 暂时离队是可恢复的用户意图；
- 永久移除是不可恢复的名册操作，但不是数据擦除。

把永久移除实现为物理删除或批量清空身份、头像、Runtime、Memory 和历史引用，会
破坏 Camp、Task、AgentRun 与长期身份的可解释性，并跨越 SQLite、受管头像文件和
Memory 治理边界。相反，仅在 Renderer 中隐藏成员又不能跨重启、Core RPC、Team
Tool 和后台恢复可靠地阻止后续参与。

因此必须建立一个持久、与 Runtime 解耦的成员在队状态，并明确终态移除后的数据
保留与活动资格。

## Decision

### Stable presence state

`AgentProfile` 的权威成员状态为：

```ts
type MemberPresence = "present" | "away" | "removed";
```

- `present`：成员在队，可以成为 CampMember、Default Lead、Task Assignee 或消息
  目标；是否真的可以启动 AgentRun 仍由执行准入独立判断。
- `away`：成员暂时离队，不能成为新的执行目标，但身份、配置、关系和历史全部保留，
  且可以显式回到 `present`。
- `removed`：成员已被永久移出名册，不能恢复，也不能再成为任何新活动关系或执行
  目标。

新建 AgentProfile 默认是 `present`，即使用户选择“暂不配置执行引擎”。
`present` 不承诺存在 Runtime 配置，更不承诺 Runtime Ready。

Runtime 配置、清除 Runtime、Adapter 探测结果、认证变化、CLI 安装状态和
Runtime Readiness 都不得隐式改变 Member Presence。清除一个在队成员的 Runtime
不会使其离队；外部 Runtime 故障也不会触发离队、归队或永久移除。

允许的状态转换只有：

```text
present ⇄ away
present → removed
away    → removed
```

`removed` 是终态。Core 不提供 restore、rejoin、edit 或重新激活 removed Profile
的命令。

### Temporary leave

暂时离队只推进 AgentProfile Presence 和版本，不扫描或修改 Camp、CampMember、
Default Lead、Task、Runtime 配置、头像、Memory Lifecycle 或历史记录。

- 离队后不得启动新的 AgentRun。
- 已经存在的非终态 AgentRun 继续运行，除非用户通过原有取消边界主动终止。
- 未完成 Task 保留原 Assignee；不自动清空、取消或改派。
- CampMember 仍表示该身份与 Camp 的成员关系，不复制全局 away 状态。
- 身份、头像、handle、成员指令、Runtime 配置、MCP Assignment 和 Memory 数据
  保留。
- 归队只恢复活动资格，不创建 MemoryRevision，不改写 Camp 历史，也不自动抢回
  已经有效的 Default Lead。

### Retained permanent removal

永久移除是 User-only、不可逆命令。它在一个 SQLite 事务中只做保持终态所需的最小
权威变更：将 Presence 写为 `removed`、记录 `removedAt`、推进 Profile version，
并写入命令结果与审计事件。它不清空或物理删除：

- handle、display name、角色、persona、instructions 或其他身份字段；
- `avatarRef` 或受管头像文件；
- Runtime installation ID、模型选择或 Adapter permission 配置；
- MCP Assignment 原始记录；
- Companion、Relationship 或 Hearth Memory；
- CampMember、Conversation、CampMessage、Task、AgentRun、ContextManifest、
  Action、Approval 或审计记录。

非终态 AgentRun 是唯一的永久移除阻塞项。移除命令不自动取消运行，用户必须先等待
运行结束或通过既有取消流程使其终止。Default Lead 和未完成 Task 不是移除阻塞项；
它们由 Camp 的惰性修复和显式 Task 改派处理。

removed Profile 的 handle 永久保留，不得被新身份复用。Display name 仍可与其他
身份重复。

### Operational exclusion and historical identity

removed Profile 从成员名册、成员详情、创建目标、成员管理搜索、`@` 候选、Default
Lead 选择、Task 新指派、Runtime 启动、Team Tool、MCP 投影和其他活动读取模型中
排除。公开 `agents.list/get` 不把 removed Profile 当作可管理成员返回；Core
内部历史读取仍可按稳定 ID 解析其保留身份。Camp 消息、Task、Run 和审计的历史
搜索不因此隐藏或擦除结果。

历史 Camp、消息、Task 和 AgentRun 继续显示原姓名、角色和头像，但该身份位不可
点击进入成员详情，也不能重新成为执行目标。历史展示不得降级为通用“已删除成员”
而丢失已有身份。

removed Profile 的 Runtime 配置是惰性历史数据：

- 不参与启动要求、健康探测、配置完整性检查、投影或活动引用计数；
- 不阻止删除对应 AdapterInstallation；
- 对应 Installation 后来不存在时，原 installation ID、模型和权限值仍可作为历史
  数据保留，但不承诺可重新解析或执行。

removed Profile 的 Memory Lifecycle、Revision、Proposal 和 Supersession 不因
移除而改变。用户治理数据仍保留，但涉及 removed Profile 的 Companion 与
Relationship Memory 不进入未来 Agent 上下文、活动投影、检索或 Agent Proposal
目标。Hearth Memory 的全局作用不因某一个 Profile 被移除而改变。

away Profile 同样不产生新的 AgentRun 投影，也不是其他成员当前 Relationship
Projection 的可用 counterparty；回到 `present` 后，同一批仍然有效的 Memory
重新具备适用资格。removed Profile 永远不会重新获得该资格。

### Compatibility with earlier `active AgentProfile` rules

有效旧 ADR 中的 `active AgentProfile` 不再是可直接查询的当前生命周期术语。相关
规则按操作边界解释：

- ADR-0018 的 MCP Import 默认分配只选择 `present` Profile；既有 away/removed
  Assignment 原样保留，但不进入当前 Runtime 投影。
- ADR-0039 的 `memory.propose_change` 默认 Capability 仍写入新 Profile 的默认配置；
  Presence 转换不增删该存储配置，只有通过 Presence 与执行准入的新 AgentRun 才能
  使用它。
- Memory 自身的 `active | retired | forgotten` 仍是独立 Memory Lifecycle，不受
  本 ADR 的 AgentProfile 术语替换影响。

任何真正启动、路由或投影到 Runtime 的操作都不能只检查 `presence = present`；
还必须执行该操作已有的 Runtime、Capability、Camp 与安全准入。

## Consequences

- 成员在队意图不再被 Runtime 配置或本机健康状态暗中改写。
- 暂时离队是低副作用、可恢复操作；Camp 和 Task 保持真实历史。
- 永久移除能跨重启和所有 Core 入口可靠阻止后续参与，同时保留历史可解释性。
- 不需要跨 SQLite、Memory 和头像文件系统的伪原子擦除协议，也不会产生头像误删
  或关系记忆误删。
- 所有活动查询、投影、启动要求和引用计数都必须显式处理 `removed`，不能只依赖
  Renderer 过滤。
- 数据保留意味着“永久移除”不是隐私擦除或存储清理承诺；产品文案必须准确表达。
- removed Profile 会继续占用 SQLite 和受管头像磁盘空间；自动最终资产 GC 不在
  本决策范围内。

## Rejected Alternatives

- 继续使用 `active | disabled | archived`：同一枚举混合在队、执行和名册语义。
- 用 Runtime 配置或 Readiness 派生成员在队状态：外部环境变化会改写用户意图。
- 清除 Runtime 时自动离队：把配置操作变成隐藏的生命周期操作。
- 永久物理删除 AgentProfile：破坏历史外键、身份展示和审计连续性。
- 永久移除时批量 Forget Memory：违反独立 Memory 治理并可能删除仍属于另一成员
  的 Relationship Memory。
- 永久移除时删除头像文件：跨 SQLite 与文件系统无法形成可靠事务，且历史仍引用
  该身份。
- 在成员页保留“已移除”分组：与用户要求的名册移除语义不符。
- 释放 removed handle：使历史 `@handle` 与新身份产生歧义。

## References

- [v0.15 成员生命周期与 Camp 执行准入](../versions/v0.15/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0018: File-Backed MCP Library and Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
- [ADR-0035: User-Transparent Agent-Applicable Relationship Memory](0035-user-transparent-agent-applicable-relationship-memory.md)
- [ADR-0039: Memory Proposal Capability](0039-memory-proposal-capability.md)
- [ADR-0056: Controlled Member Avatar Assets](0056-controlled-member-avatar-assets.md)
- [Superseded ADR-0041: AgentProfile Status and Memory Independence](0041-agent-profile-status-memory-independence.md)
