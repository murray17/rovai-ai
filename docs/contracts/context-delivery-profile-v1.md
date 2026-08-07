---
document_type: interface-contract
contract: context-delivery-profile
version: 1
authority: agentrun-public-context-delivery
status: accepted
last_updated: 2026-08-06
---

# Context Delivery Profile v1

> 历史 immutable profile：v0.45 新 AgentRun 使用
> [Profile v2](context-delivery-profile-v2.md)。已经冻结的 v1 ContextManifest 仍按本文恢复，
> 不会被 v2 重写。

本文冻结 AgentRun 公共消息上下文的第一版数值配置、字符计量、选择顺序、模型可见字段和
ContextManifest 证据。架构理由与替代关系见
[ADR-0129](../adr/0129-deterministic-bounded-raw-public-context-delivery.md)。

## 1. 所有权与版本

Context Delivery Profile 是应用拥有、随发布打包、不可由用户修改的合同配置。Renderer、
Preload、Electron Main 和公开 Core API 不提供读取或更新设置入口。

```yaml
profileVersion: 1
maxPublicMessages: 15
maxPublicHistoryChars: 24000
maxMessageBodyChars: 2000
```

Formatter 必须接收已验证的 Profile 对象，不能在选择或截断逻辑中重复这些数字字面量。
Profile v1 一经发布不可原地修改；数值变化新增 Profile version。字段、排序、预算或渲染算法
变化同时要求评估是否升级 AgentRun Context Formatter。

v1 校验不变量：

- `profileVersion = 1`；
- 三个数值均为正整数；
- `maxMessageBodyChars <= maxPublicHistoryChars`；
- 字符单位一律为 Unicode scalar，不是 UTF-8 byte、UTF-16 code unit 或模型 token。

## 2. 输入集合

Core 在一个权威读快照中取得：

```text
previousAcceptedPublicBoundarySequence
currentPublicBoundarySequence
visiblePublicMessages
currentInputSource
optional originatingPublicUserMessage
```

`visiblePublicMessages` 只包含当前 Camp 中未 tombstone 且满足：

```text
sequence > previousAcceptedPublicBoundarySequence
sequence <= currentPublicBoundarySequence
```

若当前输入来自用户 CampMessage，该 message ID 从 `visiblePublicMessages` 排除。Member Call
正文、InboxMessage 和 ConversationInput 从不加入此集合。

Member Call 的可选 `originatingPublicUserMessage` 必须由 Core lineage 解析为当前 Camp 中、
`sequence <= currentPublicBoundarySequence` 的公开用户 CampMessage；Agent 提交值、跨 Camp
结果、边界后消息或不一致 lineage 均不能成为该字段。合法 tombstone 使该可选项直接省略。

两个 boundary 是 ContextManifest/Core 证据，不进入模型可见对象。

## 3. 历史消息字段

`originatingPublicUserMessage` 与 `recentMessages` 使用同一正文截断字段：

```json
{
  "messageId": "msg_1249",
  "sequence": 1249,
  "senderType": "user",
  "senderId": "user_local",
  "replyToMessageId": null,
  "body": "原始正文的精确前缀",
  "bodyLength": 10421,
  "bodyTruncated": true,
  "nextBodyOffset": 2000,
  "attachments": []
}
```

现有公开附件投影继续保留名称、媒体类型、稳定授权路径和内容摘要。附件字段不参与正文预算，
也不触发额外消息补全。Renderer 不显示这些 Runtime 路径。

正文规则：

1. 计算原文 Unicode scalar 总数为 `bodyLength`；
2. 最多保留前 `maxMessageBodyChars` 个 scalar；
3. `body` 不附加省略号；
4. 有后缀时 `bodyTruncated = true`，`nextBodyOffset` 等于保留数；
5. 无后缀时 `bodyTruncated = false`，`nextBodyOffset = null`。

`nextBodyOffset` 与 `camp.read(mode="item")` 的 `bodyOffset` 使用同一 Unicode-scalar 语义。

## 4. 确定性选择算法

选择必须严格按以下顺序执行：

1. 按 message ID 确定可用的 `originatingPublicUserMessage`；若它已进入最近窗口，后续去重；
2. 从 `visiblePublicMessages` 选择 sequence 最大的 15 条；
3. 对 origin 和最近消息分别应用 2,000 scalar 正文前缀；
4. 最近消息按 sequence 升序排列；
5. 计算去重后 origin 与 recent 的 `body` scalar 总和；
6. 若总和超过 24,000，从最旧 recent message 开始整条删除，直到满足预算；
7. 格式化完整 AgentRun Dynamic Context；若超过目标 Runtime 总输入上限，继续从最旧
   recent message 开始整条删除并重算遗漏提示；
8. recent 为空后仍超限，则以 `context_payload_too_large` 在投递前失败。

Origin 独立存在时优先保留且不占 15 条上限，但参与 24,000 scalar 预算。Origin 与 recent
message ID 相同则只输出 recent item、只计算一次正文。

禁止以任何其他规则改变集合或顺序，包括回复祖先、邻域、Mention、附件关系、发送者、
关键词、重要性、相似度或 Summary。

## 5. `SHARED_CONVERSATION` 结构

模型可见结构为一个对象；无内容的可选字段直接省略：

```yaml
SHARED_CONVERSATION:
  originatingPublicUserMessage:
    messageId: msg_100
    sequence: 100
    body: "原始用户请求的精确前缀"
    bodyLength: 3200
    bodyTruncated: true
    nextBodyOffset: 2000

  recentMessages:
    - messageId: msg_1249
      sequence: 1249
      body: "原始正文"
      bodyLength: 800
      bodyTruncated: false
      nextBodyOffset: null

  omittedMessages:
    count: 48
    sequenceStart: 1201
    sequenceEnd: 1248
    retrievalHint: |
      本次有部分公开消息因上下文上限未展示。
      不要假设这些消息的内容，也不要仅因存在省略就主动读取。

      如果当前任务确实依赖缺失内容：
      - 已知消息 ID、sequence、邻域或回复链时，使用 camp.read；
      - 只知道主题、不知道消息位置时，先使用 camp.search 定位，
        再使用 camp.read 获取原始正文。
```

完整生产结构还保留第 3 节的发送者、直接回复和附件字段。不得添加
`previousAcceptedPublicBoundarySequence` 或 `currentPublicBoundarySequence` 到模型可见对象。

`SHARED_CONVERSATION` 在 origin、recent 和 omitted 三者都不存在时整体省略。

## 6. 整条遗漏

`omittedMessages` 的集合是 `visiblePublicMessages` 中最终既未作为 origin、也未作为 recent
输出的消息。仅正文截断不属于整条遗漏。

字段合同：

- `count`：实际省略的可见候选消息数；
- `sequenceStart`：省略集合的最小 sequence；
- `sequenceEnd`：省略集合的最大 sequence；
- `retrievalHint`：下列固定含义的 Core 文案。

```text
本次有部分公开消息因上下文上限未展示。
不要假设这些消息的内容，也不要仅因存在省略就主动读取。

如果当前任务确实依赖缺失内容：
- 已知消息 ID、sequence、邻域或回复链时，使用 camp.read；
- 只知道主题、不知道消息位置时，先使用 camp.search 定位，
  再使用 camp.read 获取原始正文。
```

sequence envelope 不宣称每个整数都存在；tombstone 可以形成间隙。没有整条遗漏时字段省略，
不得输出 `count: 0` 空壳。

## 7. `CURRENT_INPUT` 与总载荷失败

`CURRENT_INPUT.message` 必须是完整触发正文。Profile 不对其计数或截断。

```yaml
CURRENT_INPUT:
  type: member_call
  message: "完整当前输入"
```

用户触发时 `type` 使用对应的稳定用户消息枚举；两种触发都不得用前缀、摘要、Blob 引用或
分页描述替换 `message` 正文。

用户触发只在 `CURRENT_INPUT` 出现一次。Member Call 的完整私有正文也只在
`CURRENT_INPUT`；origin 是另一条 Core 派生的公开用户消息，二者不能互相替代。

当完整当前输入和不可删除的动态结构仍超过 Runtime 总输入上限时：

- 保留已持久化的用户消息或 Member Call；
- AgentRun 以 `context_payload_too_large` 在 Runtime 输入投递前失败；
- 不生成 accepted Runtime Input Delivery；
- 不推进 Accepted Public Context Boundary；
- 不进入 `waiting(context_compaction)`、`waiting(context_overloaded)` 或其他
  `waiting(context_*)`。

## 8. ContextManifest 证据

每个新 ContextManifest 至少冻结：

```text
contextDeliveryProfileVersion = 1
resolved profile snapshot or canonical profile digest
previousAcceptedPublicBoundarySequence
currentPublicBoundarySequence
origin message reference, when present
ordered recent message references
omitted count/start/end, when present
exact rendered dynamic payload Blob + digest
```

Profile snapshot/digest、边界和选择证据不直接暴露给模型。恢复必须复用 Manifest 已冻结的
payload，不从当前 Profile、消息或 Runtime 限制重新选择。

## 9. 验收向量

实现至少覆盖：

1. 15 条以内、无正文截断、无整条遗漏；
2. 单条超过 2,000 scalar，精确 offset 续读；
3. 15 条数量上限导致旧前缀省略；
4. 24,000 scalar 预算继续淘汰最旧消息；
5. 独立 origin 占预算但不占条数；
6. origin 与 recent 按 message ID 去重；
7. Runtime 总载荷继续淘汰 recent；
8. 完整 Current Input 仍无法容纳时明确失败；
9. 只有正文截断时不存在 `omittedMessages`；
10. ACK 跨过省略区间，后续同 Session 不自动补投；
11. 新 Native Session previous boundary 为 0；
12. `camp.search` / `camp.read` 可读取 Manifest 上限内已投递和未投递旧消息，但看不到边界后消息。
