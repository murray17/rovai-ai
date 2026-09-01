---
document_type: protocol-contract
contract: feishu-channel-v11
authority: feishu-channel-inbound-normalization-and-topic-quote-selection
status: accepted
version: 11
source_version: v1.37
last_updated: 2026-09-01
---

# Feishu Channel v11 Contract

继承 [Feishu Channel v10](feishu-channel-v10.md) 的执行卡、LAN 只读执行台、Owner、Bot、会话、聚合、
绑定、roster、admission、Outbox、恢复与秘密边界。本版只修正当前入站正文的 authority、外部引用正文规范化
以及独立话题群 structural parent 的引用判定；Core command 与持久 Schema 不变。

## 1. 当前入站正文 authority

每个 Bot Host 必须把 Lark SDK 1.73.0 已生成的 `NormalizedMessage.content` 作为当前消息正文唯一来源。
`raw.message.content` 只保留给 SDK 规范化和 Host 的 identity/diagnostic 边界，Host 不得再递归遍历 raw JSON、
拼接所有字符串或合并多个 locale。

SDK 已删除当前接收 Bot 的 mention。Host 对 `NormalizedMessage.mentions` 中其余 occurrence 逐个处理：只有
`name` 属于本次已冻结 expected managed Bot names 的 occurrence 才从规范化正文删除对应的一次
`@<name>`；普通人类 mention 保留。完成后折叠水平空格并 trim。所有接收同一 multi-Bot 消息的 Host
必须由此生成相同 `channels.inbound.observe.body`，Core 继续只从 `canonicalAgentIds` 构造 Structured
`MemberMention`。

例如 SDK 对三个接收 Bot 分别产生已经删去当前 Bot 的正文后，Host 最终都冻结：

```text
你们报个数
```

而不是把 raw `post` 中的 `tag`、`user_id`、`user_name`、placeholder 或另一 locale 写入 Camp。

## 2. 外部引用正文规范化

真正需要读取外部父消息时，Host 对 `message.get` 返回项的 `text | post` 使用同一锁定 SDK normalizer，
输入为 `msg_type + body.content + mentions`，并固定 `stripBotMentions=false`。引用原文因此保留作者写出的
mention；`post` 只选择一个 locale，优先级为 `zh_cn -> en_us -> ja_jp -> first object`，元素只按 SDK
支持的 schema 渲染。

Host 不得把返回对象当作无类型树递归收集字符串。其他消息类型、附件摘要、不可读取占位继续沿用 v10
继承的行为。Core 仍把 quote body 截断到 8,000 Unicode scalar、附件摘要限制为 20 个，并计算既有
`ExternalQuote.contentDigest`。

## 3. Topic structural-parent quote gate

在 Host 已经确定 `conversationKind` 和 canonical `topicKey` 后，quote message ID 的选择精确为：

```text
structuralTopicParent =
  conversationKind == "topic"
  && topicKey != ""
  && replyToMessageId == topicKey

quoteMessageId = replyToMessageId != null && !structuralTopicParent
  ? replyToMessageId
  : null
```

场景闭集：

| 场景 | `channels.inbound.observe.quote` |
| --- | --- |
| p2p/group 有 `parent_id` | 读取一次父消息并创建 `ExternalQuote` |
| Topic 的 `parent_id == canonical root_id` | `null`，且不得调用 `message.get` |
| Topic 的 `parent_id != canonical root_id` | 读取一次该非 root 父消息并创建 `ExternalQuote` |
| 无 `parent_id` | `null` |

Topic structural parent 只证明消息属于该话题，不证明用户显式引用 root。普通 group thread 仍不受支持；
Topic identity、出站 reply root 与 `replyToCampMessageId = null` 均不改变。

## 4. 兼容、恢复与证据

`channel_inbound.observe` JSON shape、Structured Content、ExternalPrincipal source、ContextManifest 22、
AgentRun Formatter 22、Context Delivery Profile 4 与 Runtime Input Delivery Evidence shape 不变。无数据库
Migration、双写、历史回填、Bootstrap/Binding 轮换或 formatter version bump。

既有 CampMessage、PendingCampBinding、ChannelTurnRequest、ContextManifest 和 Runtime input 保留原始 bytes
与 digest。升级边界若同一个 collecting aggregate 收到新旧不同 canonical payload，既有 payload equality
必须 fail closed，不得合并；用户可重新发送该消息。新消息的 Context/Evidence digest 覆盖修正后的实际字节。

## References

- [Feishu Channel v10](feishu-channel-v10.md)
- [飞书渠道架构](../architecture/feishu-channel.md)
- [ContextManifest Evidence v22](context-manifest-evidence-v22.md)
- [v1.37 模型上下文变更 revision 1](../versions/v1.37/model-context-change-feishu-ingress-normalization.md)
- [V1.37-D06](../versions/v1.37/decisions.md#v1-37-d06)
