---
document_type: adr
id: ADR-0194
title: Mandatory Typed Gather Completion Current Input
status: accepted
date: 2026-08-16
decision_scope: cross-version
source_version: v0.89
supersedes: []
superseded_by: null
---

# ADR-0194: Mandatory Typed Gather Completion Current Input

## Context

Gather completion 可能在成员结果公开很久以后才轮到原 Lead Conversation。普通 recent history 受 Profile、
边界与 payload budget 影响，不能保证每个成员、失败、无 send fallback 或多条公开 return 都恰好出现。让 Lead
从历史猜测“哪些人已完成”会把聚合正确性交给可选上下文；按当前 Gather 行临时重建又会让 Runtime recovery
收到与首次尝试不同的 bytes。

Context 的 Current Input 与 ContextManifest 已分别拥有 mandatory model projection 和 immutable evidence；
Gather 需要在这个既有边界中增加一个明确触发类型。

## Decision

Rovai 为 completion continuation 增加 `gather_completion` invocation 与 closed、mandatory
`gather_completed` Current Input：

1. Barrier 冻结 gatherId、commandId、requestMessageId，以及每个 Item 的 recipient、dispatch Delivery、
   target Run、terminal status/source、ordered captured message references、bounded fallback 和 safe error。
2. Current Input 是每次 completion Run 的 mandatory final section。普通 public history 可以先被省略，但 Item、
   reference 和必需字段不得因预算静默丢弃；captured body excerpt 与 fallback 使用明确上限和 digest/原长度。
3. serialized Gather input 有独立 48 KiB 上限，为 96 KiB Runtime payload及 first-payload Bootstrap 留出空间。
   mandatory metadata 超限是 invariant failure，不能把不完整 payload 标记 ready。
4. Context Formatter 与 ContextManifest 分别升级版本。Manifest 冻结 invocation、Gather/Delivery/message identity、
   completion input schema/digest/byte length、ordered refs 与 exact rendered Dynamic Context bytes。
5. Runtime Input Delivery recovery 复用首次冻结 bytes；不得根据当前 Default Lead、Native Session、public history
   或可变 Gather state 重建。Conversation 是 durable route，Session 仅在 materialization 时按正常 binding 解析。

本决定扩展 ADR-0067/0147 的 Current Input closed union，同时保留 Context Delivery Profile 对 optional public
history selection/order 的所有权；因此不因 mandatory trigger shape 改变而升级 Profile。

## Consequences

- Lead 总能收到完整、可审计的聚合责任清单，即使公开历史被截断或某成员没有 send；
- Barrier 必须在 final output 尚可用的成员终态事务中持久保存有界 fallback；
- Context formatter、Manifest schema、recovery validation 与 Delivery preflight 必须识别新 invocation kind；
- captured refs 仍指向公开 CampMessage，模型可按现有 exact `camp.read` 继续读取完整内容；
- completion input 会占用显式预算，但不会通过删掉失败 Item 或 references 来伪造可接受大小。

## Rejected Alternatives

- **依赖 recent public history**：optional selection 不能证明所有结果都存在，也无法表达无 send 或 pre-run failure。
- **在 dispatch 时读取最新 Gather 行重建**：retry/recovery bytes 会漂移，破坏 ContextManifest 与 accepted ACK。
- **把完整成员 final output 永久存入普通 AgentRun**：扩大通用数据保留边界；Gather 只需有界 fallback。
- **把 Native Session ID 冻结为路由权威**：Session 可替换或恢复，Conversation/Agent 才是 durable ownership。
- **超限时静默删 Item/ref**：会让 Lead基于不完整责任集给出错误综合。

## References

- [v0.89 版本目标](../versions/v0.89/README.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [ADR-0147: Lossless Model Context Projection](0147-lossless-model-context-projection-and-layered-delivery-evidence.md)
- [Gather v1](../contracts/gather-v1.md)
- [ContextManifest Evidence v13](../contracts/context-manifest-evidence-v13.md)
- [持久 Gather Barrier 架构](../architecture/durable-gather-barrier.md)
