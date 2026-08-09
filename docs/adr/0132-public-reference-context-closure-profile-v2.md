---
document_type: adr
id: ADR-0132
title: Bounded Public Reference Context Closure and Profile v2
status: accepted
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes: []
superseded_by: null
---

# ADR-0132: Bounded Public Reference Context Closure and Profile v2

> [ADR-0147](0147-lossless-model-context-projection-and-layered-delivery-evidence.md) 明确 Profile v2
> 只拥有候选选择、排序、Unicode-scalar 截断和预算；模型字段/序列化归 Context Formatter，Evidence
> shape 归 ContextManifest。本文的三层 closure、优先级、Context gate 与 ACK 边界不变，也不因此
> 创建 Profile v3。

## Context

v0.44 的 Profile v1 有确定的 recent count、公共字符和单条正文上限，但明确不补回复祖先。
公共 A2A 进入 Camp 后，Agent 回复某条公共消息时需要看到直接父消息；如果沿整个 reply graph
或无界历史闭合，会让一个引用改变上下文大小、成本和 ACK 边界。用户已确认保留最多 3 条
reference chain，并要求 omission、Manifest/ACK 和直接父消息失败边界可审计。

## Decision

保留 Profile v1 的 immutable semantics，并新增 Profile v2：

```yaml
profileVersion: 2
maxPublicMessages: 15
maxPublicHistoryChars: 24000
maxMessageBodyChars: 2000
maxPublicReferenceChainMessages: 3
```

对带 `replyToCampMessageId` 的当前 trigger，只沿直接公共父边向根选择最多三条消息，优先
direct parent，再是更近祖先。Closure 不递归展开无关消息的 reply、Mention、附件或语义
关系，且不扩大原始 recipients。Closure 与 ordinary recent 共享字符/body budget；稳定 ID
去重，Manifest 冻结 selected/omitted refs 和 exact payload。

Budget priority 固定为完整 Current Input、mandatory structure、direct parent、远端 closure、
lineage-required origin、ordinary recent。移除所有可选内容后 direct parent 或必需结构仍
无法容纳时，Delivery 在 AgentRun materialization 前以 `context_payload_too_large` 终态失败，
不建立 Run、不进入 waitCondition、不推进 ACK；公共 Message 和 sibling Deliveries 保留。

ContextManifest ACK 仍只推进既有 Accepted Public Context Boundary；Closure 没有独立 read
cursor。Recovery 复用冻结 bytes，不按当前 Profile/消息重新闭合。

## Consequences

- 回复关系提供有限、可解释的动态上下文，同时最多 3 条链额度阻止历史无界增长；
- 直接父消息成为明确的容量失败边界，用户可区分“缺失/不可读”与“结构必需但超限”；
- Profile v1 的历史 Manifest 永远不被 v2 重写，Formatter/fixture 必须同时支持版本识别；
- ACK 仍是单一边界，closure 不产生第二套已读/补投机制；
- Delivery dispatch 必须在 AgentRun 物化前完成 Context gate，增加一次可审计的提交边界。

## Rejected Alternatives

- **删除 3 条上限，只受 24,000 字符约束**：会让单个 reply chain 无界挤出普通公共历史，
  且难以预测成本。
- **闭合整个 reply graph 或所有被引用消息**：把 unrelated context 变成隐式输入，破坏
  当前 Input/公共历史的确定性。
- **父消息超限时截断 Current Input 或静默创建空 Run**：丢失 Agent 真实请求或制造无法
  解释的执行，违反 fail-closed。
- **为 closure 增加独立 ACK/read cursor**：产生第二套边界和重复补投语义。

## References

- [Context Delivery Profile v2](../contracts/context-delivery-profile-v2.md)
- [Context Delivery Profile v1](../contracts/context-delivery-profile-v1.md)
- [ADR-0129：Profile v1 与 raw public context](0129-deterministic-bounded-raw-public-context-delivery.md)
