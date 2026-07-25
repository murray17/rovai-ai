---
document_type: adr
id: ADR-0020
title: "User-Authorized Memory Mutation"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0032
---

# ADR-0020: User-Authorized Memory Mutation

## Context

Agent 可以从长期对话和协作经历中发现可能值得保留的偏好、约定或经验，但这种
推断可能错误、过时、过度概括，或把临时任务状态和敏感信息误当成稳定认识。
如果模型置信度、重复观察或 Camp 角色能够自动写入长期记忆，Agent 就可以在用户
不知情时改变未来所有 AgentRun 的输入。

另一方面，用户是 Memory Library 的治理者。强迫用户主动新增或修改记忆时也先
创建 Proposal，会把非权威建议层错误地变成所有写入的必经草稿层。

## Decision

只有经过认证的用户命令可以新增或修订正式记忆，或改变正式记忆的生命周期。
所有权威变更都通过 ADR-0001 的强类型 DomainCommandGateway 在一个 SQLite
事务中提交，并记录用户 Actor。

Agent 只能通过一个当前、唯一解析且通过 Execution Epoch fencing 的 AgentRun
创建 `MemoryProposal`。Proposal 是持久但非权威的建议：

- 保存成功只表示建议已被记录；
- 它不改变当前有效记忆，也不进入长期记忆上下文；
- 用户接受或编辑后接受时，以用户最终确认的内容生成权威变更；
- 拒绝、暂不处理或重复提案不能形成正式记忆。

Default Lead 身份、Agent Capability、模型置信度、观察次数、多个 Agent 的一致
意见或时间经过都不能自动接受 Proposal。Capability 只决定 Agent 是否可以提交
建议，不授予正式记忆写入权。

用户从管理界面主动新增、修订或执行生命周期操作时，直接提交权威命令，不需要
先创建一个发给自己的 Proposal。Renderer、Agent 和任何投影都不得直接编辑
SQLite 或人类可读文件来绕过命令边界。

正式变更只影响尚未冻结上下文的后续 AgentRun。已有 ContextManifest 的 Run
继续使用原冻结输入，不能在执行中热更新。

## Consequences

- 用户可以在任何长期记忆影响未来行为前检查并修改它。
- Agent 的“学习”成为可审核的建议流程，而不是隐藏的模型副作用。
- Proposal 与正式记忆必须是不同权威级别的记录，Read Side 和 UI 不能把二者
  混成一个状态字段。
- 用户主动管理保持直接；Proposal 接受路径和用户直接写入路径最终必须复用同一
  正式变更校验。
- AgentRun 身份解析、Capability、幂等和速率限制仍然需要单独协议，但都不能
  提升 Agent 的最终确认权。

## Rejected Alternatives

- 高置信度或重复观察后自动写入：无法证明推断正确，也让未来上下文发生隐式变化。
- Default Lead 自动批准：Camp 协调角色不等于应用级用户治理权。
- 多 Agent 投票自动批准：模型间一致不等于用户授权，还可能放大同源错误。
- 所有用户编辑也先创建 Proposal：把非权威建议层误用为用户草稿层，增加无意义
  的状态和操作。
- 允许 Agent 直接编辑 Markdown 或数据库：绕过事务、审计、权限和冻结边界。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0019: Application-Global Memory Ownership](0019-application-global-memory-ownership.md)
