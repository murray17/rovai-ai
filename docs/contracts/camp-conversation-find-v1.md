---
document_type: contract
contract: camp-conversation-find
version: v1
status: accepted
last_updated: 2026-08-18
---

# Camp Conversation Find v1

本合同定义 Desktop Renderer 在当前 Camp 内进行完整会话正文查找的精确只读接口。它不替代
Agent-facing [Camp History Retrieval v1](camp-history-v1.md) 中的 discovery Top-K 接口。

## Method and closed input

`camp.messages.find` 只接受：

```ts
interface CampMessageFindParams {
  campId: string
  query: string
  selectedMatchIndex?: number | null
  anchorMessageId?: string | null
}
```

- `query` 去除空白后不得为空，最多 512 个 Unicode scalars；原查询值用于匹配与响应回显；
- `selectedMatchIndex` 缺省时由 `anchorMessageId` 选择第一条 sequence 不早于 anchor 的命中，找不到则从
  第一条开始；提供时按 exact total 取模，负数也向后循环；
- `anchorMessageId` 只有在同 Camp、未墓碑时有效；不可用 anchor 不泄露其他 Camp 是否存在；
- 未知字段、Camp 不存在、空查询或超长查询 fail closed。

## Searchable projection

候选集固定为同一 Camp 中 `authorType=user|agent` 且未墓碑的 CampMessage，按
`sequence ASC, id ASC` 排序。每条正文使用与 `CampMessageView.body` 相同的 Human Structured Content
投影，排除 system 消息、附件名称/内容、Task、Delivery、Run/Tool output、Approval、Inspector 与地图文案。

匹配为 Unicode lowercase 后的大小写不敏感、非重叠 occurrence。`startOffset/endOffset` 是原正文中的
Unicode scalar offset，`endOffset` exclusive；大小写折叠扩张字符映射回其原始 scalar owner。

## Bounded response

```ts
interface CampMessageFindSnapshot {
  schemaVersion: 1
  throughGlobalSequence: number
  campId: string
  query: string
  totalMatchCount: number
  selectedMatchIndex: number | null
  match: {
    messageId: string
    messageSequence: number
    occurrenceIndex: number
    startOffset: number
    endOffset: number
  } | null
}
```

响应始终只含 exact total 和一个选中 match。无结果时 total 为 `0`，index/match 均为 null。接口不得
返回完整匹配列表或消息正文；Renderer 若尚未拥有目标消息，使用 `camp.messages.around` 读取有界窗口。

## Concurrency and presentation

每次调用在一个 SQLite read transaction 内冻结 `throughGlobalSequence`。Renderer 只接受当前 Camp、当前
query 与最新 request generation 的响应；乱序响应必须丢弃。新增消息后的 exact total 允许由后续查询更新，
不要求 find session 锁定历史快照。

正文着色是 Renderer 的渐进增强：Core exact total/target 为权威，CSS Highlight 不得扩大可搜索范围。
关闭查找不写 Core 状态，也不改变 Camp viewed、notification、Draft 或消息领域对象。

## References

- [Camp Open Projection v1](camp-open-projection-v1.md)
- [Camp Open Read Path](../architecture/camp-open-read-path.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [ADR-0013](../versions/v0.06/decisions.md#adr-0013)
- [ADR-0108](../versions/v0.40/decisions.md#adr-0108)
