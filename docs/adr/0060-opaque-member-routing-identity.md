---
document_type: adr
id: ADR-0060
title: "Opaque Member Routing Identity and Globally Unique Names"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.16
supersedes: []
superseded_by: null
---

# ADR-0060: Opaque Member Routing Identity and Globally Unique Names

> [ADR-0110](0110-internal-agent-uuid-and-monotonic-short-agent-id.md) replaces the Base58 Member
> Routing ID with a monotonic short Agent ID and confines the old handle to historical text
> compatibility. This ADR's globally unique Member Name and structured Mention rules remain valid.

## Context

早期版本把 `AgentProfile.handle` 同时作为稳定路由键、成员配置字段和 `@` 展示文本。
这让用户必须维护一个本应属于系统的标识，也迫使展示层在同名成员后追加 handle。
一旦 handle 进入历史消息，继续允许用户编辑或复用它又会破坏历史身份解析。

协作命令已经使用结构化 `agentProfileId` 作为权威地址。正文中的 `@` 文本主要承担
可读性和输入反馈，不需要继续暴露内部路由键。因此成员名称可以成为唯一的产品身份
标签，而 handle 收口为不透明的兼容标识。

摘要模型入口同时需要从独立“上下文”设置页移到成员 Runtime 附近，但这只是
Desktop 信息架构变化，不改变 ADR-0050 的摘要选择和持久化语义。

## Decision

### Opaque routing identity

`AgentProfile.id` 继续是领域外键和结构化寻址真源。`AgentProfile.handle` 保留为
稳定、不可编辑的内部兼容标识：

- 新建成员时，Core 生成 12 位 Base58 随机值并在事务内检查冲突；
- Desktop 和公开创建/编辑表单不接收或显示 handle；
- 编辑名称、头像、角色、指令或 Runtime 不修改 handle；
- 既有 Profile 的 handle 原样保留，不执行 SQLite Migration；
- removed Profile 的 handle 与身份记录继续保留。

为了兼容旧客户端，Core 的 Rust 命令反序列化可以接受旧 `handle` 字段，但创建时
忽略该值，更新时也不允许它改写已存 handle。

### Globally unique member names

`displayName` 是成员配置与普通产品界面的唯一身份标签。所有未移除和已移除
AgentProfile 共同占用同一名称空间。Core 在创建和更新命令的同一事务中执行去除
首尾空白并忽略大小写的冲突检查；Desktop 在提交前执行更严格的兼容归一化预检，
并在表单下方显示错误。Core 检查仍是并发和非 Desktop 调用的最终权威。

本决策不批量重写已有名称。旧数据库若已经存在同名 Profile，后续创建或编辑不得
继续制造冲突；用户需要通过成员编辑逐个收敛名称。

### Mention input and historical display

新 Composer 的候选和插入文本统一使用 `@成员名称`，路由仍提交结构化
`agentProfileId`。Core 保留对旧 handle mention 的兼容识别，并能校验当前名称形式
的 mention；正文文本不能替代结构化地址。

历史 Camp 标题、公共消息、Inbox 和其他可见正文中的旧 `@handle` 在 Renderer
展示层投影为 `@成员名称`，不改写 SQLite 历史正文。同名后追加 handle 的旧展示规则
被移除，因为新的权威写入已经禁止名称重复。

### Summary model entry

Desktop 删除独立“上下文”设置入口。现有摘要模型表单移动到成员详情的“高级设置”，
默认折叠且只在用户展开后读取配置。它继续调用：

- `context.summaryModel.get`
- `context.summaryModel.set`
- `ContextSummaryModelConfig`
- `ContextSummaryModelPreference`

自动回退、执行引擎默认模型和明确模型三种选择保持不变。Core 摘要选择逻辑、
Contracts 数据形状和 SQLite 数据不变。

## Consequences

- 用户只管理和看到名称，不需要理解或维护内部 handle。
- 名称可以安全用于所有 `@` 展示，不再需要括号中的 handle 消歧。
- 新建成员的内部标识不可预测、不会从名称派生，改名也不影响历史引用。
- 旧 handle、旧消息正文和旧数据库无需迁移，升级风险较低。
- 名称唯一性由命令事务保证，而不是只依赖 Renderer 校验。
- 摘要模型入口更接近成员 Runtime 配置，同时仍明确它是所有 Camp 共享配置。

## Rejected Alternatives

- 继续让用户填写 handle：把内部兼容键暴露为长期产品概念。
- 从名称生成 slug：改名、Unicode 和冲突处理会重新耦合显示名称与路由身份。
- 同名时展示 `名称（handle）`：持续暴露内部键并让名称不再是稳定的产品标签。
- 重写既有 handle 或历史消息：会产生无必要的数据迁移和历史身份风险。
- 为摘要模型创建新的 Core 配置：重复现有合同并扩大本次 UI 调整范围。

## References

- [v0.16 Runtime 权限归属与成员配置收口](../versions/v0.16/README.md)
- [ADR-0050: Camp-Shared Progressive Summaries](0050-camp-shared-progressive-summaries.md)
- [ADR-0057: Member Presence and Retained Permanent Removal](0057-member-presence-and-retained-removal.md)
- [ADR-0058: Collaboration v4](0058-collaboration-v4-presence-aware-admission.md)
