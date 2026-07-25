---
document_type: adr
id: ADR-0029
title: "Bounded Memory Reactivation"
status: accepted
date: 2026-07-25
decision_scope: cross-version
source_version: v0.10
supersedes: []
superseded_by: null
---

# ADR-0029: Bounded Memory Reactivation

## Context

Retire 用于停止未来沿用但保留正文。用户可能只是暂时停用一项仍然正确的认识；
若每次恢复都必须复制成新 Memory，会制造不必要的身份和 Revision。

但被 MemorySupersession 取代的 predecessor 已有明确历史事实：另一条 Memory
替代了它。直接重新启用 predecessor 会让“已被 successor 替代”和“两者同时
active”并存，删除替代边又会篡改审计历史。

## Decision

Memory Lifecycle 允许以下转换：

```text
active → retired
retired → active
active → forgotten
retired → forgotten
```

所有转换均由显式用户命令、Memory expected version 和 ADR-0001 事务边界控制。

只有没有 outgoing MemorySupersession 的 retired Memory 可以重新变为 active。
重新启用不创建新 MemoryRevision，因为正文与 Memory 身份属性没有变化；它只
更新 Memory lifecycle/version 并追加脱敏审计事件。

存在 outgoing Supersession 的 predecessor 不能直接重新启用，即使 successor
后来 retired 或 forgotten。需要恢复旧内容时，用户从可读历史 Revision 创建一个
新的 Memory，并保留原 Supersession 关系。Forgotten Memory 是终态，不能恢复。

Review due 是派生治理提醒，不影响重新启用资格；重新启用也不自动修改
`reviewAfter`。

## Consequences

- 临时停用可以无损恢复同一 Memory 身份，不制造重复内容。
- Supersession 历史不会因用户反悔而被删除或形成自相矛盾的 active 状态。
- UI 必须对普通 retired 与 superseded predecessor 提供不同可用操作。
- 恢复 superseded 内容需要创建新 Memory，身份链会更长，但历史保持真实。
- Lifecycle 命令与 Revision 命令保持分离，审计能区分内容变化和适用性变化。

## Rejected Alternatives

- 所有 retired 都不可恢复：对临时停用过于昂贵，会产生重复 Memory。
- 所有 retired 都可恢复：会让 superseded predecessor 与 successor 同时 active。
- 重新启用总是创建 Revision：内容没有变化时伪造了一次内容确认。
- 删除 Supersession 后恢复 predecessor：篡改已经发生的替代事实。
- Forgotten 可恢复：与 ADR-0027 的不可逆内容清除冲突。

## References

- [v0.10 长期记忆](../versions/v0.10/README.md)
- [ADR-0001: Core Transaction](0001-core-transaction.md)
- [ADR-0026: Explicit Memory Supersession](0026-explicit-memory-supersession.md)
- [ADR-0027: Memory-Domain Forgetting](0027-memory-domain-forgetting.md)
- [ADR-0028: Advisory Memory Review](0028-advisory-memory-review.md)
