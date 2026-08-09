---
document_type: interface-contract
contract: context-delivery-profile
version: 2
authority: agentrun-public-context-selection-and-budget
status: accepted
last_updated: 2026-08-09
---

# Context Delivery Profile v2

Profile v2 是 v0.45 建立并由当前 v0.50 clean break 延续的公共消息选择与预算合同。Profile v1 只作为
历史合同文档保持不可变，不进入当前 ContextManifest 读取路径；当前 AgentRun 只使用 v2。模型字段/序列化、ContextManifest Evidence 和
Runtime Input Delivery accepted evidence 是独立的合同/权威边界，不由 Profile version 命名。模型
shape 由 Formatter version 所有，Evidence shape 由 Manifest version 所有；Runtime Input Delivery 是
投递/ACK authority，并继续携带既有投递 metadata，而不是新的内容版本轴。公共消息、Delivery 和 Context gate 的
长期边界见 [Public A2A Message 与 Message Delivery](../architecture/public-a2a-message-delivery.md)，
决策见 [ADR-0132](../adr/0132-public-reference-context-closure-profile-v2.md)；权责分层见
[ADR-0147](../adr/0147-lossless-model-context-projection-and-layered-delivery-evidence.md)。

## 1. 不可变配置

```yaml
profileVersion: 2
maxPublicMessages: 15
maxPublicHistoryChars: 24000
maxMessageBodyChars: 2000
maxPublicReferenceChainMessages: 3
```

前 3 个数值与 Profile v1 完全相同；新增字段是公共引用链的绝对上限，不是“尽量闭合”的
无限预算。Profile 由应用随版本内置，没有 Member UI、IPC 或用户设置入口。数值、字符计量、
候选选择、去重、排序、截断、淘汰或预算优先级改变必须创建新的 major profile version；不能让
同一个 Profile version 对相同 authoritative selection basis/input snapshot 产生不同选择结果。模型 DTO 字段、compact/pretty JSON 和提示文案归
Context Formatter，Evidence 字段归 ContextManifest schema/version；只改变这些投影层时不创建
Profile v3，也不能改写已经冻结的 Manifest。

字符单位是 Unicode scalar，不是 UTF-8 byte、UTF-16 code unit 或模型 token。Agent ID 的
canonical UTF-8/ASCII byte order 只用于 recipient identity，不用于上下文消息的 sequence
顺序。

## 2. 输入与普通公共历史

Core 在一个权威读快照中读取：

```text
previousAcceptedPublicBoundarySequence
currentPublicBoundarySequence
visiblePublicMessages
currentInput
optional originatingPublicUserMessage
optional replyToCampMessageId
```

`visiblePublicMessages` 只包含当前 Camp 中未 tombstone 且满足
`previous < sequence <= current` 的公共消息。当前触发消息不进入 recent base，只进入完整的
`CURRENT_INPUT`。Public A2A Message 与用户公共消息一样参与普通历史、搜索和 Shared
Conversation；它不会因为是 Agent 作者而进入私有区。

普通历史 base 的选择保持 v1：取 sequence 最大的 15 条，逐条保留最多 2,000 scalar，按
sequence 升序输出；超出 24,000 scalar 时从最旧 base message 开始整条移除。正文前缀截断
不计为整条 omission。模型如何表达截断事实与 continuation 由当前 Context Formatter 决定，
Profile 只冻结正文前缀和 Unicode-scalar offset 结果。

## 3. Public Reference Context Closure

当当前触发消息带有合法的 `replyToCampMessageId` 时，Core 只沿直接公共父边向 Camp 根方向
行走：

```text
current input
  └─ direct parent (distance 1)
       └─ parent of parent (distance 2)
            └─ parent of parent of parent (distance 3)
```

规则：

1. 只解析当前 trigger 的这条父链，不递归展开 recent 中其他消息的 reply、Mention、附件、
   关键词或相似关系；
2. 最多选择 3 条 ancestor message，按 distance 1 → 2 → 3 的顺序优先；每条按与 v1 相同的
   2,000 scalar 正文规则处理；
3. 以稳定 message ID 去重。已经在 recent base 或 originating public user message 中的项不
     重复输出，但仍算作已满足该层 closure；
4. 父消息跨 Camp、tombstone、当前 Agent 无权读取、关系成环或找不到时停止继续向根行走，
   不猜测内容，也不尝试从其他消息补链；
5. Closure 与 base recent 共享 `maxPublicHistoryChars` 字符预算。Closure 成员不创建
   Message、Delivery、Run 或新的 ACK boundary。

### 预算优先级与直接父边界

Core 按以下优先级冻结最终 payload：

1. 完整 `CURRENT_INPUT`；
2. mandatory structure、可信作者/回复元数据和 Runtime 必需结构；
3. 已解析的 direct parent（distance 1）；
4. 更远 closure ancestors，按 distance 2、3；
5. originating public user message（如该 Delivery lineage 要求）；
6. ordinary recent base messages，按最旧优先淘汰。

第 1～3 项不能被 recent 历史挤掉。若移除所有可选 recent、可选远端 closure 和其他可选
origin 内容后，完整 Current Input、mandatory structure 或已解析的 direct parent 仍无法容纳
目标 Runtime 的硬输入上限，Delivery 在 AgentRun materialization 前终态失败：

```text
failureCode = context_payload_too_large
targetAgentRunId = null
waitCondition = null
```

这是明确失败，不是 context wait，也不是可由 Runtime 恢复、容量变化或 Core 重启触发的自动
重试。Public Message 与其他 sibling Deliveries 保留；用户必须针对具体失败重新作出决定。

第 2/3 层父链本身无法读取时不以正文替代：Manifest 记录稳定 omission reason，模型只看到
安全的 omission notice。只有“父消息可读但必需结构仍超限”触发上述 terminal failure。

## 4. Omission 合同

本节同时展示 Profile selection 事实、当前 Formatter 模型 projection 和 ContextManifest Evidence
如何集成；示例中的模型字段或 Evidence 字段不构成 Profile v2 的版本身份，也不改变 omission
集合、count 或 sequence envelope 算法。

模型可见的 `SHARED_CONVERSATION` 可以包含：

```yaml
referenceClosure:
  - distance: 1
    messageId: msg_…
    sequence: 101
    senderType: user
    senderId: user-…
    body: "未截断的精确正文"

recentMessages:
  - messageId: msg_…
    sequence: 102
    senderType: agent
    senderId: agent_…
    body: "被截断的精确前缀"
    bodyLength: 2400
    bodyTruncated: true
    continuation:
      operation: camp.read
      input:
        campId: camp_…
        mode: item
        messageId: msg_…
        bodyOffset: 2000

omittedMessages:
  count: 4
  sequenceStart: 97
  sequenceEnd: 100
  navigationHint: "The sequence envelope may contain gaps and is not an executable range; use camp.search/camp.read only when required."
```

Manifest 还记录 machine-readable omission entries：

```yaml
omissionEntries:
  - kind: public_history
    messageIds: [msg_…]
    reason: max_public_messages | history_budget | runtime_payload_budget
  - kind: reference_closure
    messageIds: [msg_…]
    reason: max_reference_chain | history_budget | parent_unavailable | cycle | tombstone
```

`omittedMessages` 只统计最终未以 origin、closure 或 recent 输出的可见公共消息；单条正文截断
不增加 count。父消息不存在或无权读取时 fail closed，精确 ID/reason 只留在 Manifest，不把
machine omission entry 投影给模型，也不能泄漏 Camp 外部 roster 或被 tombstone 内容。没有
omission 时不输出 `count: 0` 空壳。模型历史消息不包含 source Conversation ID 或附件 digest；这些
字段与 attachment ID/path/digest、正文 projection digest、截断 offset 和 closure distance 一起进入
Manifest Evidence。

## 5. ContextManifest 与 ACK

每个使用 Profile v2 的 ContextManifest 至少冻结：

```text
contextDeliveryProfileVersion = 2
resolvedProfileSnapshotOrDigest
previousAcceptedPublicBoundarySequence
currentPublicBoundarySequence
currentInputSourceAndDigest
originReference, when present
orderedRecentReferences
orderedReferenceClosureReferences + distance, when present
omission entries, when present
ordered shared-message source/content/attachment/truncation evidence + digest
typed Run Notice references + exact compact notice JSON bytes/digest
exact rendered dynamic-context bytes + digest
target Runtime/Formatter versions
```

其中 Profile v2 只贡献 version、resolved snapshot/digest 和 selection evidence；Context Formatter
贡献模型字段与 exact rendered bytes，ContextManifest version 定义其 Evidence shape。

Manifest 是 Delivery dispatch attempt 的不可变输出。Recovery 只能复用冻结 bytes；不能使用
当前 Profile、后来新增的公共消息、Runtime 新上限或新的 reply chain 重算。Runtime 接受并
由独立 Runtime Input Delivery 记录 accepted ACK 后，Core 才在同一 generation fence 内把 Accepted Public Context Boundary 直接推进到
Manifest 的 current boundary，即使部分消息只通过 omission 呈现。Closure 不拥有单独的已读
游标，也不改变 `camp.search`/`camp.read` 的既有 Fence。

## 6. 验收向量

至少冻结以下 fixture：

- 0/1/3/4 条父链：只取前三条，第四条不进入 closure；
- direct parent 已在 recent、已 tombstone、跨 Camp、成环和无权读取；
- direct parent 在字符预算内、远端 closure 被预算淘汰；
- direct parent 与 mandatory structure 超硬上限，Delivery terminal failure 且无 AgentRun；
- 仅正文截断时 omission count 不变化；
- ACK 后 boundary 单调推进，restart/retry 使用同一 Manifest bytes；
- Public A2A reply 与普通用户 reply 都遵守同一最多 3 条 closure 上限，不扩大原 recipients。
