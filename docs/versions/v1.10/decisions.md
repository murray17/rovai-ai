---
document_type: version-decisions
version: v1.10
lifecycle: historical
last_updated: 2026-08-19
---

# v1.10 决策记录

本文件按来源版本聚合数字 ADR clean break 前的历史决定，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0219](#adr-0219) | Single Namespaced Camp Identity Separate from Native Sessions | `accepted` |

<!-- legacy-adr:begin id=ADR-0219 source-file-sha256=6d9a87b8ddcc84448dc0ec411f0cb725db2d00d0ea7d17a214f58ef0dda6c11b -->
<a id="adr-0219"></a>

## ADR-0219: Single Namespaced Camp Identity Separate from Native Sessions

迁移时原路径：`docs/adr/0219-single-namespaced-camp-identity.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
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
```

<!-- legacy-adr-body:begin id=ADR-0219 -->
<a id="adr-0219-context"></a>
### Context

Camp 主键此前是裸 UUID，而 Codex、ACP、Claude 等 Runtime 的 Native Session、Thread 或 Conversation ID
也常使用 UUID。Camp ID 进入模型上下文和 Built-in Tool 后，Agent 容易把 Rovai 协作空间误认为 Runtime
会话句柄，并尝试用 Camp ID 恢复或查找 Runtime 原生会话。产品尚未正式上线，没有需要长期兼容的已发布
Camp 数据；同时维护内部 UUID 与公开 `CampRef` 会制造双重身份、映射和授权歧义。

<a id="adr-0219-decision"></a>
### Decision

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

<a id="adr-0219-consequences"></a>
### Consequences

- Agent、用户和诊断能从命名空间直接区分 Rovai Camp 与 provider-native 会话。
- 一个 Camp 只需一条主键和外键链，无双写、映射漂移或 alias 授权面。
- Camp ID 仍保持 UUIDv7 的大致时间顺序，但不再暴露标准 UUID 拼写。
- 当前模型上下文、Built-in catalog、Camp History 与 Native Binding compatibility 必须换版；旧本地上下文、
  Session binding 和非终态执行需要失效。
- 其他领域实体和 Native ID 不因本决策改变格式。

<a id="adr-0219-rejected-alternatives"></a>
### Rejected Alternatives

- **保留内部 UUID，再增加 `CampRef`。** 两个可见身份需要永久映射、双向查询和授权规则。
- **使用 `rvcamp_<标准 UUID>`。** Agent 仍可提取内部 UUID 并把它误当 Runtime 会话。
- **长期迁移旧 UUID Camp。** 产品未上线，兼容代码会把仅有的开发数据成本固化为产品约束。
- **同时修改 Native Session ID。** Provider identity 由外部 Runtime 定义，改变它会破坏恢复协议。

<a id="adr-0219-references"></a>
### References

- [v1.10 版本概览](README.md)
- [v1.10 模型上下文 revision 1](model-context-change.md)
- [Camp Identity v1](../../contracts/camp-identity-v1.md)
- [Camp Identity Architecture](../../architecture/camp-identity.md)
- [ADR-0007: Portable Conversation Handoff](../v0.03/decisions.md#adr-0007)
- [ADR-0126: Codex Native Home and External Session Ownership](../v0.43/decisions.md#adr-0126)
<!-- legacy-adr-body:end id=ADR-0219 -->
<!-- legacy-adr:end id=ADR-0219 -->
