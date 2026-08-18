---
document_type: version-overview
version: v0.40
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-05
---

# Rovai-ai v0.40 Camp 历史检索工具收敛

> 状态：工具合同与架构决策已冻结，生产实现与 Checkpoint 5 验收已完成
>
> 前置版本：[v0.39 Codex Runtime 隔离](../v0.39/README.md)
>
> 架构工作稿：[architecture.md](architecture.md)
>
> 工具合同：[tool-contract.md](tool-contract.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

> 后续版本：[v0.41 Runtime Activity 统一观测语义](../v0.41/README.md)

## 版本意图

把当前五个 `context.*` 模型工具收敛为四个职责明确的 Camp 发现、消息搜索与原文读取工具：

```text
camp.list
camp.search
history.search
camp.read
```

模型只需理解：找其他 Camp 用 `camp.list`，搜当前 Camp 用 `camp.search`，搜仍有成员资格的
其他 Camp 用 `history.search`，命中后统一用 `camp.read` 深读。相关性接口只负责 Top-K
发现，只有稳定 Camp 时间线上的原文读取支持分页。

## 并行跨版本身份修正

[ADR-0110](decisions.md#adr-0110) 是在 v0.40 期间
单独确认并授权实施的跨版本修正：AgentProfile 使用内部 UUID 主键，对模型和工具只投影
单调递增且不复用的短 Agent ID，并始终同时提供 Name、Team Role 与 Professional
Responsibilities 作为选择语义。该修正不改变下述 Camp 历史检索范围，也不代表其设计门禁
已经开放。

## 已确认的边界

- 四工具只搜索和读取原始公开 CampMessage；Segment/Epoch Summary 继续作为 Core 内部上下文
  组成材料，不进入模型工具结果。
- Cross-Camp History Search 只覆盖当前 AgentProfile 在 Manifest 创建时有资格访问、调用时
  仍是有效 CampMember 的其他存续 Camp；前成员、已删除 Camp、Conversation、Inbox/A2A 与
  Runtime 私有内容均不可达。
- ContextManifest 在一个权威快照中冻结 Cross-Camp History Fence：精确 Camp Discovery
  Snapshot 集合与全局公开消息边界。实时复核只能收窄；后加入的 Camp、后续消息和重命名
  不能扩大或改写同一 Run 的历史面。
- `camp.list` 按冻结 Camp Name 搜索；无 query 时按冻结 `lastVisibleActivityAt DESC,
  campId ASC` 返回 Top-K，不分页。
- `camp.search` 与 `history.search` 只返回 Top-K message 命中，不分页。前者输入为
  `query, limit?`；后者额外支持 `campIds?, dateFrom?, dateTo?`，日期过滤 CampMessage
  `createdAt`。
- `camp.read.item` 以 `bodyOffset/bodyLimit` 切片单条正文；`around` 返回锚点两侧指定数量的
  可见消息和有界原文前缀，不分页；`thread` 与 `timeline` 共用 Camp sequence 整数 cursor
  分页。
- Thread 接受回复树内任意可见 messageId，Core 自动解析根；首次无 cursor 页包含锚点，
  后续页使用严格 sequence 不等式。
- 历史附件只返回名称、类型、大小等元数据，不返回内部路径、投影路径、正文或二进制；搜索
  不索引附件内容。
- 当前产品没有消息删除/撤回能力。本期只延续既有 tombstone 实时过滤，不预测未来删除后的
  回复树或 unavailable 字段。
- App 尚未上线，采用 clean break：旧非终态 Run 显式失败重试，新 Run 只暴露四个新工具，
  不保留 `context.*` 别名、旧字段解析或双表面；旧 Native Binding 同时失效，避免 Resume
  仍记住旧工具 Charter 的 Runtime Session。

## 非目标

- 不把数据库遗留 `archived` 状态提升为 Camp 产品生命周期；
- 不让稳定 ID、sequence cursor 或模型提供的 Camp 范围成为授权证明；
- 不用跨 Camp 原文读取替代受用户治理的 Memory；
- 不在本期开放历史附件文件读取或附件全文检索；
- 不为未上线的旧工具合同支付兼容成本。
