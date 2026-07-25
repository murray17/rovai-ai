---
document_type: adr
id: ADR-0024
title: "Closed Memory Kinds"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0024: Closed Memory Kinds

## Context

“长期记忆”很容易退化成任何旧信息的容器。若 v0.10 提供通用 Fact、人格标签、
能力评分或任务状态，Memory Library 会与 repository、Task、AgentRun、
Conversation Summary 和 AgentProfile 等现有真源竞争，并可能让过时推断覆盖当前
事实。

长期协作真正需要的是稳定偏好、明确约定和从实际经历中形成的可复用行动经验。
这些类别具有不同来源要求和适用语义，因此不能只作为自由标签。

## Decision

v0.10 的 Memory Kind 是封闭枚举：

```text
preference
agreement
lesson
```

定义如下：

- `preference`：用户确认的稳定选择，描述 Lumen 或某位 Companion 如何沟通、
  展示信息或与用户协作；
- `agreement`：由用户确认采用、面向未来的协作规则；
- `lesson`：从真实经历提炼的可复用行动方式，不评价任何成员的人格或能力。

Scope 与 Kind 的合法组合为：

```text
hearth        → preference | agreement | lesson
companion     → preference | agreement | lesson
relationship  → agreement | lesson
```

Kind 是 Memory 创建时固定的身份属性，不属于 MemoryRevision。重新分类必须创建
新 Memory，并遵守 ADR-0022 的派生和来源处理规则。

v0.10 明确不支持通用 `fact`、人格标签、能力评分、行为画像或观察档案。Task、
AgentRun、Approval、Action、当前计划、TODO、Conversation Summary 和 repository
事实继续由其自然领域对象拥有。秘密、Token、密钥和认证资料禁止进入 Memory。

## Consequences

- Memory Library 保持为长期协作认识，而不是第二个知识库、Task 系统或 Agent
  评分系统。
- Kind 可以驱动来源校验、UI 文案和召回规则，而不会被普通内容修订偷换。
- 某些用户希望保存的稳定事实在 v0.10 中没有对应类型；需要继续依赖原领域真源
  或未来单独设计的知识模型。
- Relationship Memory 无法用 Preference 包装对另一位伙伴的单边画像。
- 新增 Kind 是跨版本 Schema 和语义扩展，不能通过未知字符串静默兼容。

## Rejected Alternatives

- 通用 Fact Memory：会与当前 repository、Task 和协作状态竞争权威。
- 自由字符串 Kind：无法可靠执行来源、作用域和安全约束。
- Kind 放进 Revision：普通修订会改变一条 Memory 的语义类别和校验规则。
- Personality、Trait 或 Capability Memory：会把协作经验变成长期人物评分。
- 把所有内容统一称为 Note：无法区分稳定偏好、未来约定和有经验依据的 Lesson。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)
- [ADR-0013: Managed Content and Read Side v2](0013-managed-content-and-read-side-v2.md)
- [ADR-0021: Atomic Memory and Immutable Revisions](0021-atomic-memory-and-immutable-revisions.md)
- [ADR-0022: Immutable Memory Scope](0022-immutable-memory-scope.md)
