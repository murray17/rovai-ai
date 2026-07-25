---
document_type: adr
id: ADR-0031
title: "Frozen Low-Priority Memory Context"
status: superseded
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: ADR-0032
---

# ADR-0031: Frozen Low-Priority Memory Context

## Context

长期记忆需要影响未来 AgentRun，但它表达的是历史上确认的协作指导，不是当前
用户输入、任务责任、权限或 repository 事实。若将 Memory 写入 Provider System
Prompt 或 Session Charter，它会获得过高且难以逐轮更新的权威；若恢复同一
AgentRun 时从最新 Library 重新选择，又会违反 ADR-0009 的不可变输入协议。

Memory 还可能在 Run 执行期间被 revise、retire 或 forget。热更新正在运行的模型
会让同一 AgentRun 在不同恢复尝试中接收不同规则。

## Decision

Context formatter 增加独立的 `[MEMORY_CONTEXT] ... [/MEMORY_CONTEXT]` 动态输入
区段。它位于 Shared Conversation Updates 之后、Work Brief、Task Context 和
Current Input 之前。

Memory Context 必须明确标注为用户确认的历史协作指导。它：

- 不进入 Provider System Prompt 或 Session Charter；
- 不授予 Capability、Adapter permission、Approval 或 Action authority；
- 不改变 AgentRun Workspace、Task 状态或完成语义；
- 不证明 repository、外部服务或当前协作状态的事实；
- 不能覆盖当前用户输入、Work Brief、Task Context、Core 权限、当前 repository
  状态、Control Signal 或更新的协作消息。

Lumen 动态输入冲突时使用以下优先关系：

```text
Current Input
→ Work Brief / Task Context / Core permissions / current repository state
→ current collaboration messages / Control Signals
→ Memory Context
```

每个 AgentRun 在首次 Dispatch 前从权威 SQLite 选择并冻结一个 Memory Context。
ContextManifest 至少保存：

```text
memoryId
revisionId
scope/kind applicability metadata
selectionReason
memoryFormatterVersion
rendered Memory Context or immutable payload inclusion
memoryContextDigest
```

同一个 AgentRun 的 retry、Core restart 或 Runtime recovery 复用原冻结内容与
digest，不能从当前 Memory Library 重新组装。Memory 的后续 add、revise、
retire、reactivate、supersede 或 forget 只影响尚未冻结的新 AgentRun。

ADR-0027 的 Forget 不重写已完成 AgentRun 的 ContextManifest；历史输入可以继续
证明该 Run 当时使用过某个 Revision，但不能成为新 Run 的 Memory 来源。

具体 eligibility、召回、排序和预算算法由 v0.10 版本协议另行定义。

## Consequences

- 长期记忆可以逐 Run 更新，同时保持同一 AgentRun 的输入可重现。
- Current Input 与真实系统状态明确高于历史指导，减少陈旧记忆支配当前工作的
  风险。
- ContextManifest 和 formatter 需要新增版本化字段、摘要和 Inspector 展示。
- Forget 后的历史 Run 仍可能显示旧 Memory Context；UI 必须解释这是不可变执行
  历史，不是有效记忆。
- Memory Context 消耗模型预算，需要确定性选择和严格上限。

## Rejected Alternatives

- 把全部 Memory 加入 System Prompt：权威过高，且无法逐 AgentRun 冻结更新。
- 把 Memory 加入 Session Charter：把动态用户内容误作稳定协作契约，并可能要求
  Native Session 重建。
- Runtime Resume 时查询最新 Memory：同一个 AgentRun 会获得不同输入。
- Run 执行中热更新 Memory：破坏重试、审计和行为解释。
- 让 Memory 覆盖当前输入或 repository 状态：历史指导不能成为当前事实真源。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)
- [ADR-0016: Multi-Runtime Execution Boundary v2](0016-multi-runtime-execution-v2.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0030: SQLite Memory Authority](0030-sqlite-memory-authority.md)
