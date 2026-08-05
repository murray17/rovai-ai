---
document_type: version-architecture
version: v0.40
authority: candidate-implementation-contract
status: draft
last_updated: 2026-08-05
---

# v0.40 Camp 历史检索工具合同

本文把 [架构工作稿](architecture.md)中已确认的决策收敛为可直接实现和测试的模型工具合同。
在用户整体确认前，`status: draft` 不授权修改生产代码。

## 1. 唯一心智模型

| 工具 | 唯一职责 | Camp 范围 | 分页 |
|---|---|---|---|
| `camp.list` | 按冻结名称发现其他 Camp，或列出最近其他 Camp | Manifest 冻结且实时仍可见的其他 Camp | 无；Top-K |
| `camp.search` | 搜索当前 Camp 的公开消息正文 | 当前 AgentRun 的 Camp | 无；Top-K |
| `history.search` | 搜索其他 Camp 的公开消息正文 | Manifest 冻结且实时仍可见的其他 Camp | 无；Top-K |
| `camp.read` | 用稳定 ID 读取消息、邻域、回复树或原始时间线 | 当前 Camp 或上述其他 Camp | 只有 `thread` / `timeline` 使用 sequence cursor |

规范调用流程：

```text
找其他 Camp： camp.list

搜当前 Camp： camp.search → camp.read

搜其他 Camp： history.search → camp.read

连续阅读：   camp.read(around|thread) → camp.read(timeline|thread)
```

Camp Name 只在 `camp.list` 中成为命中对象。`history.search` 的 Camp title 是冻结结果元数据，
不会在没有消息正文命中的情况下单独生成结果。

## 2. 共同来源与授权

四个工具只读取未 tombstone 的原始公开 CampMessage。Segment/Epoch Summary、
ConversationMessage、InboxMessage、A2A 私有内容、执行进度投影、Runtime 私有状态和附件内容
均不进入该表面。

每次调用按以下顺序执行，顺序本身是安全合同：

1. 用 Binding credential 认证当前 running AgentRun、execution epoch、AgentProfile 和当前
   Camp；
2. 读取该 Run 的不可变 ContextManifest；
3. 判定目标是当前 Camp，还是 Cross-Camp History Fence 中冻结的其他 Camp；
4. 对其他 Camp 实时复核 Camp 仍存续、AgentProfile Presence 仍为 present、CampMember 仍为
   active；
5. 应用当前 Camp sequence boundary 或跨 Camp global public-message boundary；
6. 实时排除 tombstone；
7. 最后才执行名称匹配、日期过滤、正文匹配、计数、排序、snippet 和读取。

模型提供的 `campId`、`campIds`、`messageId`、sequence cursor 和日期都只是定位或过滤条件，
不是授权证明。调用必须在一个一致的数据库读事务中完成，不能在授权检查后到正文读取前跨越
另一个可见性状态。

### 当前 Camp 与其他 Camp 的边界

- `camp.search` 和当前 Camp 的 `camp.read` 使用 Manifest 已有的
  `camp_message_boundary_sequence`。
- `camp.list`、`history.search` 和其他 Camp 的 `camp.read` 使用 Cross-Camp History Fence
  冻结的 Camp 集合与 global public-message boundary。
- `camp.list` 和 `history.search` 永远不包含当前 Camp；当前 Camp 已由 Run 身份确定。
- 稳定 ID 和 sequence 可以跨 AgentRun 重用，但每次调用都按新 Run 的 Manifest 与实时授权
  重新解释，因此新 Run 的可见上限可以不同。

## 3. 共同硬上限

| 项目 | 默认 | 硬上限 |
|---|---:|---:|
| `camp.list.limit` | 20 | 50 |
| `camp.search.limit` | 10 | 20 |
| `history.search.limit` | 15 | 30 |
| 正文查询 | — | 512 Unicode scalar |
| `camp.list.query` | — | 200 Unicode scalar |
| 搜索 snippet | — | 200 Unicode scalar |
| `history.search.campIds` | 全部冻结其他 Camp | 20 个唯一 ID |
| `item.bodyLimit` | 4,000 | 4,000 Unicode scalar |
| `around.before` | 5 | 10 条可见消息 |
| `around.after` | 10 | 10 条可见消息 |
| `thread` / `timeline` page | 20 | 20 条可见消息 |
| 集合项正文目标前缀 | 500 | 500 Unicode scalar |
| `item.attachments` | — | 10 项 |
| `camp.search` 正文候选评估 | 80 | `limit × 8`，最多 160 条已授权消息 |
| `history.search` 正文候选评估 | 120 | `limit × 8`，最多 240 条已授权消息 |
| 单次工具结果 | — | 16,000 Unicode scalar |

搜索和列表先确定逻辑 Top-K，再在总响应预算内从排名末尾裁剪；发生任何裁剪时
`truncated: true`，但仍不返回 cursor 或 omitted count。集合读取不得因长正文丢掉已经选中的
消息项：Core 保留本页逻辑 items，并在 500 字符目标内按确定性预算缩短各项正文前缀。
固定字段本身无法装入 16,000 字符时才返回 `camp.response_overloaded`。

字符位置全部按 Unicode scalar 计数，不按 UTF-8 byte 或 UTF-16 code unit 计数。

## 4. `camp.list`

### 输入

```json
{
  "query": "authentication",
  "limit": 20
}
```

- `query` 可省略；省略时列出最近的其他 Camp。
- 提供后先 trim；只含空白的值按未提供处理。
- `limit` 可省略，默认 20，范围 `1..50`。
- 不接受 cursor、Camp 状态或其他过滤器。

### 输出

```json
{
  "camps": [
    {
      "campId": "camp_123",
      "title": "Authentication redesign",
      "lastVisibleActivityAt": "2026-07-20T10:00:00Z"
    }
  ],
  "truncated": false
}
```

所有字段来自 Manifest 中的 Camp Discovery Snapshot，不读取调用时的最新 title 或
`camp.updatedAt`。无 query 时排序固定为：

```text
lastVisibleActivityAt DESC, campId ASC
```

有 query 时使用大小写不敏感的字面量名称匹配，并按“规范化全名相等 → 前缀 → 子串 →
lastVisibleActivityAt DESC → campId ASC”排序。不做消息正文匹配、模糊拼写或相关性分页。
实时已经失去资格的冻结 Camp 从结果与截断判断中移除。

## 5. `camp.search`

### 输入

```json
{
  "query": "token rotation",
  "limit": 10
}
```

`query` 是 trim 后非空的必填字面量正文查询。除 `limit` 外不接受 `campId`、Camp title、
sender、references、sources、sequence 范围或 cursor。`limit` 可省略，默认 10，范围
`1..20`。

### 输出

```json
{
  "results": [
    {
      "campId": "camp_current",
      "messageId": "msg_123",
      "sequence": 381,
      "authorType": "agent",
      "authorId": "agent_123",
      "replyToMessageId": null,
      "createdAt": "2026-07-20T10:00:00Z",
      "snippet": "...rotate the authentication token before..."
    }
  ],
  "truncated": false,
  "searchIncomplete": false
}
```

## 6. `history.search`

### 输入

```json
{
  "query": "token rotation",
  "campIds": ["camp_123", "camp_456"],
  "dateFrom": "2026-01-01T00:00:00Z",
  "dateTo": "2026-08-01T00:00:00Z",
  "limit": 15
}
```

- `query` 的合同同 `camp.search`；`limit` 可省略，默认 15，范围 `1..30`。
- `campIds` 可省略；省略表示全部冻结且实时仍可见的其他 Camp。提供时必须是 1～20 个唯一、
  结构合法的 Camp ID，并与授权范围取交集；合法但不可见的 ID 被静默忽略。
- `dateFrom` / `dateTo` 是可独立省略的 RFC 3339 instant，归一化到 UTC 后过滤 CampMessage
  不可变 `createdAt`。
- `dateFrom` 为包含下界，`dateTo` 为排除上界；同时提供时必须满足
  `dateFrom < dateTo`。
- 日期与 Camp 范围在正文相关性排序之前应用，且不能越过 Manifest global boundary。

### 输出

```json
{
  "results": [
    {
      "campId": "camp_123",
      "campTitle": "Authentication redesign",
      "messageId": "msg_456",
      "sequence": 211,
      "authorType": "agent",
      "authorId": "agent_123",
      "replyToMessageId": "msg_455",
      "createdAt": "2026-07-20T10:00:00Z",
      "snippet": "...we decided to rotate the token..."
    }
  ],
  "truncated": false,
  "searchIncomplete": false
}
```

`campTitle` 来自冻结 Snapshot。实时 rename 不改写同一 Run 的结果元数据。

### 两种搜索的共同匹配与排序

- FTS5 trigram 继续作为正文索引；CampMessage 是事实源，索引可重建。
- `camp_summary_fts` 在旧 Summary 搜索工具移除后没有读取方，随 clean break 一并删除；
  Camp Summary 本体、生成和按覆盖区间参与 Core 上下文组成的能力不变。
- query 始终作为字面量短语，不能注入 `MATCH` 的 `OR`、`NEAR`、`*` 等语法；LIKE fallback
  必须转义 `%`、`_` 与 `\`。
- 查询中出现 `ADR-N`、`PR-N`、`issue-N` 或消息所在 Camp 内完整 Task UUID 时，可复用派生
  reference index 给予精确引用命中优先级，但该能力不形成独立输入字段。
- 解析出的精确 reference 先在已授权范围内独立查询并并入候选，不得因正文候选预算截断而
  丢失；reference 查询自身同样只需读取 Top-K 加一条来判断 truncated。
- FTS 只产生已完成授权、Fence、Camp 与日期过滤后的正文候选，不直接采用 FTS5 全局
  `bm25()` 分数；该分数的 corpus statistics 会包含未授权 Camp，违反授权先于排序。
- 排序固定为“精确引用 → 仅在当前已授权候选/语料内计算的 bounded lexical relevance →
  消息新旧 → 稳定 ID”。当前 Camp 用 sequence DESC；跨 Camp 用未暴露的 message-sent
  global sequence DESC，再以 campId、messageId 打破平局。未来若使用 BM25 或 hybrid，也必须
  只从当前授权 Fence 内的语料派生统计。
- 第一版 bounded lexical relevance 使用不依赖 corpus 的稳定 tuple：规范化 query 的字面量
  出现次数 DESC（每条最多计 32 次）、首次出现的 Unicode scalar offset ASC、正文长度 ASC。
  这不是永久搜索算法；Top-K 无 cursor 允许后续在不改变读取合同的前提下升级排名。
- 归一化后少于 3 个 Unicode scalar 的查询使用有界字面量子串扫描。扫描只包含已经完成
  授权和 Fence 过滤的消息；当前 Camp 按 sequence DESC，跨 Camp 按 global sequence DESC。
- `camp.search` 与 `history.search` 没有独立的候选预算输入；每次最多评估 `limit × 8` 条已授权
  正文候选。`camp.search` 默认评估 80 条、最多 160 条；`history.search` 默认评估 120 条、
  最多 240 条。长查询由 FTS boolean match 产生候选，短查询由 literal substring scan 产生
  候选；两者都先在当前授权范围内按当前 Camp sequence DESC 或跨 Camp global sequence DESC
  取界，再做本地 relevance 排序。
- 候选界限触顶时返回 `searchIncomplete: true`。该字段表示未证明全范围 Top-K 或匹配数，
  与“已知已评估匹配数超过返回 limit”的 `truncated` 含义不同。

## 7. `camp.read`

四个 mode 共享必填 `campId`。`item`、`around`、`thread` 再要求稳定 `messageId`；
`timeline` 只需要 Camp 和可选 sequence cursor。错误 Camp 与正确 messageId 的组合按统一
不可见错误处理。

### 7.1 `item`

```json
{
  "campId": "camp_123",
  "mode": "item",
  "messageId": "msg_456",
  "bodyOffset": 0,
  "bodyLimit": 4000
}
```

- `bodyOffset` 默认 0，允许 `0..bodyLength`；超过全文长度是参数错误。
- `bodyLimit` 默认 4,000，范围 `1..4000`。
- 输出 `items` 恰好一项，不返回 collection cursor。
- 每次切片都返回有界附件元数据；不返回 path、content digest 或附件内容。

```json
{
  "campId": "camp_123",
  "mode": "item",
  "items": [
    {
      "messageId": "msg_456",
      "sequence": 211,
      "authorType": "agent",
      "authorId": "agent_123",
      "replyToMessageId": "msg_455",
      "createdAt": "2026-07-20T10:00:00Z",
      "body": "...",
      "bodyOffset": 0,
      "bodyLength": 8200,
      "bodyTruncated": true,
      "nextBodyOffset": 4000,
      "attachmentCount": 1,
      "attachments": [
        {
          "attachmentId": "attachment_123",
          "name": "design.pdf",
          "mediaType": "application/pdf",
          "byteSize": 102400
        }
      ],
      "attachmentsTruncated": false,
      "attachmentOmittedCount": 0
    }
  ]
}
```

`bodyTruncated` 表示本次 slice 不是完整正文；`nextBodyOffset` 只在仍有后缀可读时返回整数，
否则为 null。附件最多 10 项，超出时显式返回省略数。

### 7.2 `around`

```json
{
  "campId": "camp_123",
  "mode": "around",
  "messageId": "msg_456",
  "before": 5,
  "after": 10
}
```

- `before` / `after` 分别默认 5 / 10，范围 `0..10`。
- 两者表示所有授权和 Fence 过滤完成后的实际可见消息条数，不是 sequence 数值距离。
- 锚点始终包含且不计入两侧条数；items 最终按 sequence ASC。
- 无 collection cursor，不用 `around` 自身翻页。
- 每项返回从 offset 0 开始、目标最多 500 字符且受总预算约束的原文前缀，以及
  `attachmentCount`；附件数组只由 `item` 返回。

```json
{
  "campId": "camp_123",
  "mode": "around",
  "anchorMessageId": "msg_456",
  "items": [],
  "hasMoreBefore": true,
  "hasMoreAfter": false
}
```

需要继续向旧消息阅读时，用首项 sequence 调用
`timeline(direction="before")`；向新消息阅读时用末项 sequence 调用
`timeline(direction="after")`。

### 7.3 `thread`

```json
{
  "campId": "camp_123",
  "mode": "thread",
  "messageId": "msg_456",
  "direction": "before",
  "limit": 20
}
```

- `messageId` 可以是回复树内任意可见消息；Core 向上解析真实 root，再在整棵树内分页。
- `direction` 必填，取 `before` 或 `after`。
- `limit` 默认 20，范围 `1..20`，包含首次页锚点。
- 首次省略 cursor 时包含锚点：before 选择 `sequence <= anchor.sequence`，after 选择
  `sequence >= anchor.sequence`。
- 后续显式 cursor 严格使用 `< cursor` 或 `> cursor`，不重复边界项。
- items 始终按 sequence ASC，并使用与 `around` 相同的有界正文前缀。

```json
{
  "campId": "camp_123",
  "mode": "thread",
  "anchorMessageId": "msg_456",
  "threadRootMessageId": "msg_400",
  "direction": "before",
  "items": [],
  "nextCursor": 420,
  "hasMore": true
}
```

若 direction 为 before，`nextCursor` 是本页最小已返回 sequence；若为 after，则是本页最大
已返回 sequence。只有 `hasMore: true` 时 nextCursor 才为整数，否则为 null。要从回复树开头
重新阅读，使用返回的 root ID 发起新的无 cursor、`direction="after"` 调用。

### 7.4 `timeline`

```json
{
  "campId": "camp_123",
  "mode": "timeline",
  "direction": "before",
  "cursor": 211,
  "limit": 20
}
```

- `direction` 必填；`limit` 默认 20、最大 20。
- 显式 cursor 必须是正整数 Camp sequence，before 严格读取 `< cursor`，after 严格读取
  `> cursor`。
- 省略 cursor 时，before 从当前 Run 对该 Camp 的可见末尾读取最新一页，after 从 Camp
  可见开头读取最早一页。
- items 始终按 sequence ASC，并使用有界正文前缀。

```json
{
  "campId": "camp_123",
  "mode": "timeline",
  "direction": "before",
  "items": [],
  "nextCursor": 190,
  "hasMore": true
}
```

`nextCursor` 与 `thread` 使用同一页边缘规则。Cursor 只表示 Camp 原始 sequence 边界，不
携带查询、快照、Camp 身份、内容身份或权限。

## 8. 集合消息项

`around`、`thread`、`timeline` 的每项固定为：

```json
{
  "messageId": "msg_456",
  "sequence": 211,
  "authorType": "agent",
  "authorId": "agent_123",
  "replyToMessageId": "msg_455",
  "createdAt": "2026-07-20T10:00:00Z",
  "body": "bounded original prefix",
  "bodyOffset": 0,
  "bodyLength": 8200,
  "bodyTruncated": true,
  "nextBodyOffset": 500,
  "attachmentCount": 1
}
```

Collection body 是原文前缀，不是搜索 snippet 或摘要。需要正文后续或附件元数据时，调用
`item`。所有 nullable 字段都在 Schema 中显式声明，不通过缺字段表达授权或生命周期状态。

## 9. 错误与存在性保护

| 条件 | 行为 |
|---|---|
| Binding、Run、epoch 或 Manifest 不可用 | `camp.manifest_unavailable` |
| JSON Schema、limit、日期、body offset 或 cursor 非法 | `camp.invalid_argument` |
| `camp.read` 的 Camp/消息不在 Fence、ID 不匹配、成员资格已撤销、Camp 已删除或消息已 tombstone | 统一 `camp.read_unavailable` |
| 搜索中的合法 Camp ID 不在授权范围 | 静默从范围中移除 |
| 列表中的冻结 Camp 已实时失去资格 | 静默从结果中移除 |
| 固定响应元数据自身超过硬上限 | `camp.response_overloaded` |

`camp.read_unavailable` 的 message 不区分“不存在”“不属于该 Camp”“边界之后”“已撤权”或
“已 tombstone”。授权失败不能通过计数、snippet、排序、不同错误码或响应时间形成可靠的
存在性探针。

## 10. ContextManifest 持久合同

新 Manifest 在同一权威读快照中冻结：

```text
current Camp camp_message_boundary_sequence
+ history fence version
+ global public-message boundary (event_log.global_sequence)
+ zero or more Camp Discovery Snapshot rows
```

建议使用由 ContextManifest 拥有的规范化子表，而不是让每次调用解析授权 JSON：

```text
context_manifest_history_camp
  context_manifest_id
  camp_id
  camp_title
  last_visible_activity_at
  PRIMARY KEY (context_manifest_id, camp_id)
```

子表只外键到 ContextManifest，不外键到 live Camp；Camp 删除通过实时 join 使工具访问收窄，
但不改写已经完成的 Manifest 证据。global boundary 使用 `camp_message.sent` 对应
`event_log.global_sequence` 判断消息是否在 Fence 内。Camp snapshot 的最后可见活动取边界内
最后一条未 tombstone 公开消息 `createdAt`，空 Camp 回退 `camp.createdAt`。

旧终态 Manifest 作为历史证据保留但 history fence version 为 legacy；旧非终态 Run 在 clean
break Migration 中以明确错误失败。Migration 后新 Run 必须拥有完整 v1 Fence，缺失时 fail
closed，不从调用时 live membership 猜测。

Migration 还必须使已有 Native Binding 失效。下一 Run 保留 Rovai Conversation、公共消息与
私有连续性数据，但创建带新 Session Charter 和四工具目录的新 Native Session；不得 Resume
可能仍记住旧 `context.*` 工具合同的 Runtime Session。

## 11. 工具目录与 Clean Break

同一变更原子完成：

```text
删除：context.search
      context.get_message
      context.get_message_window
      context.get_message_thread
      context.get_summary

新增：camp.list
      camp.search
      history.search
      camp.read
```

Core 删除旧输入类型、handler、canonical definition、Runtime alias 和测试，不保留兼容解析。
Attested Team protocol、built-in catalog digest 与 Antigravity alias map 同步换代；新 alias 使用
`camp_list`、`camp_search`、`history_search`、`camp_read`。所有 Runtime 的工具说明统一强调
“发现 Top-K → 稳定 ID 读取 → sequence 连续阅读”，并明确四工具不读取 Summary 或附件内容。
