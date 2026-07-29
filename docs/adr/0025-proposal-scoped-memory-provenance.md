---
document_type: adr
id: ADR-0025
title: "Proposal-Scoped Memory Provenance"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0069
---

# ADR-0025: Proposal-Scoped Memory Provenance

## Context

用户需要知道一项 Agent 建议由哪位伙伴、在何时和哪次协作中提出。但为每个
MemoryRevision 分别建立 Origin、Evidence 和 Acceptance 对象会重复 Lumen
已有的命令审计，产生比首版用途更细碎的模型；本机 Lumen 当前也只有一个用户，
单独复制 accepter 身份没有额外区分价值。

来源元数据若进入 AgentRun 上下文，还会消耗 token 并干扰真正需要执行的记忆
正文。另一方面，只依赖对 AgentRun 的可级联外键会在来源 Camp 永久删除后抹掉
应用级记忆的基本提案历史。

## Decision

提案来源记录在 MemoryProposal 本身。每个 Agent 提交的 Proposal 至少持久化：

```text
proposedByAgentProfileId
proposedAt
sourceAgentRunId
sourceExecutionEpoch
sourceCampId
```

Gateway 根据 Native Binding、当前唯一活动 AgentRun、Execution Epoch 和所属
Camp 推导这些字段。Agent 工具 Schema 不允许模型提供或覆盖身份、时间和 Camp。

MemoryProposal 是应用级记录。`sourceCampId` 和 `sourceAgentRunId` 是不可由
调用方伪造的弱稳定审计引用，而不是 Camp ownership 外键；删除来源 Camp 或其
AgentRun 不得级联抹掉 Proposal 中已经记录的提案者、时间和来源标识。这些引用
不保留来源正文，也不扩大已删除或不可读对象的权限。

由 Proposal 接受而来的 MemoryRevision 只保存可选 `createdFromProposalId` 和
自身 `createdAt`。用户直接创建或修订 Memory 时不创建 Proposal。

v0.10 不建立独立 Origin、Evidence 或 Acceptance 领域对象。用户 Actor、命令
身份、命令时间和结果继续由 ADR-0001 的 `event_log` 记录。Proposal 的来源字段
只提供给记忆管理和审计 Read Side，不进入 Agent 可读 Memory Projection 或普通
Agent 搜索结果。

## Consequences

- 用户可以识别提案伙伴、时间和协作来源，而不为每个 Revision 复制一套来源包。
- 用户编辑后接受时，Proposal 保留原建议，Revision 保留最终正文，两者可以通过
  `createdFromProposalId` 对照。
- 来源 Camp 删除后仍能显示不透明 ID 和提案时间，但原 Camp 名称或正文若未另行
  保存就可能不可恢复；UI 需要明确显示来源已不可用。
- Proposal 的保留与遗忘策略会影响 Revision 链接可以解析多久，必须在版本协议
  中另行确定。
- 来源元数据不消耗 AgentRun token，也不能被 Agent 当作额外行为指令。

## Rejected Alternatives

- 每个 Revision 保存 Origin/Evidence/Acceptance 三层对象：重复审计并增加首版
  模型复杂度。
- 只记录 Proposal 正文而不记录提案者和来源 Run：无法解释建议来自哪次协作。
- 让模型传入 Agent、Run 或 Camp ID：身份可以被伪造并绕过 Gateway 解析。
- 将 Proposal 作为 Camp-owned record：Camp 删除会意外清除应用级记忆的提案
  历史。
- 把 Proposal provenance 写入 Agent 可读 Memory Projection：浪费上下文，并把
  审计元数据误作执行指导。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0020: User-Authorized Memory Mutation](0020-user-authorized-memory-mutation.md)
