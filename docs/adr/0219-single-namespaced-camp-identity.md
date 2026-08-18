---
document_type: adr
id: ADR-0219
title: Single Namespaced Camp Identity Separate from Native Sessions
status: accepted
date: 2026-08-18
decision_scope: cross-version
source_version: v1.10
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0219: Single Namespaced Camp Identity Separate from Native Sessions

## Context

Camp 主键此前是裸 UUID，而 Codex、ACP、Claude 等 Runtime 的 Native Session、Thread 或 Conversation ID
也常使用 UUID。Camp ID 进入模型上下文和 Built-in Tool 后，Agent 容易把 Rovai 协作空间误认为 Runtime
会话句柄，并尝试用 Camp ID 恢复或查找 Runtime 原生会话。产品尚未正式上线，没有需要长期兼容的已发布
Camp 数据；同时维护内部 UUID 与公开 `CampRef` 会制造双重身份、映射和授权歧义。

## Decision

Camp 只有一个 Core-owned durable identity：

```text
rvcamp_<26 位小写 canonical Crockford Base32>
```

26 位 payload 必须解码为 RFC-compatible UUIDv7；拼写必须 canonical、lowercase，第一位不得溢出 128 bit。
该值就是 `camps.id` 及全部 `camp_id` 外键、Core/Renderer `campId`、Agent Context、Built-in Tool、事件、日志
和 Rovai-owned Camp 路径的唯一标识。不得增加 `camp_ref`、旧 UUID alias、内部 Camp UUID 或映射表，也不得
通过旧裸 UUID 查询 Camp。

Native Session、Thread、Turn、Conversation binding 和 provider 原生 ID 保持各自的 Runtime identity。Camp ID
不得传给 `thread/resume`、`session/resume`、`session/load` 或等价 provider API；只有 Conversation 保存的
Native Session binding 可以参与恢复。关系始终为 `CampId → Conversation → NativeSessionId`，身份不能互换。

这是预发布 clean break。旧本地产品数据可以隔离后重建，但不得被转换为可继续查询的 alias；任何新入口都
必须在授权或路径使用之前严格解析 Camp ID。

## Consequences

- Agent、用户和诊断能从命名空间直接区分 Rovai Camp 与 provider-native 会话。
- 一个 Camp 只需一条主键和外键链，无双写、映射漂移或 alias 授权面。
- Camp ID 仍保持 UUIDv7 的大致时间顺序，但不再暴露标准 UUID 拼写。
- 当前模型上下文、Built-in catalog、Camp History 与 Native Binding compatibility 必须换版；旧本地上下文、
  Session binding 和非终态执行需要失效。
- 其他领域实体和 Native ID 不因本决策改变格式。

## Rejected Alternatives

- **保留内部 UUID，再增加 `CampRef`。** 两个可见身份需要永久映射、双向查询和授权规则。
- **使用 `rvcamp_<标准 UUID>`。** Agent 仍可提取内部 UUID 并把它误当 Runtime 会话。
- **长期迁移旧 UUID Camp。** 产品未上线，兼容代码会把仅有的开发数据成本固化为产品约束。
- **同时修改 Native Session ID。** Provider identity 由外部 Runtime 定义，改变它会破坏恢复协议。

## References

- [v1.10 版本概览](../versions/v1.10/README.md)
- [v1.10 模型上下文 revision 1](../versions/v1.10/model-context-change.md)
- [Camp Identity v1](../contracts/camp-identity-v1.md)
- [Camp Identity Architecture](../architecture/camp-identity.md)
- [ADR-0007: Portable Conversation Handoff](0007-portable-conversation-handoff.md)
- [ADR-0126: Codex Native Home and External Session Ownership](0126-codex-native-home-and-external-session-ownership.md)
