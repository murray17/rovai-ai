---
document_type: version-architecture
version: v0.40
authority: version-design-workbench
status: discovery
last_updated: 2026-08-05
---

# v0.40 架构工作稿

本文只记录设计访谈中的事实与候选方向。`status: discovery` 期间的内容不是实现规范。
本工作稿只属于 Camp 历史检索版本。v0.39 的 Codex Runtime 隔离合同不属于本版本范围，
也不得用于推导本版本实施状态。

已确认决定推导出的精确字段、上限、排序、错误和持久化形态集中在
[工具合同](tool-contract.md)，避免在工作稿与实施计划中维护多份 Schema。

## 当前基线

现有 `context.*` 读取服务以一个 `AuthenticatedTeamToolRun` 为入口。Core 从 Binding 派生
`agentProfileId`、当前 `campId`、`agentRunId` 与 `executionEpoch`，再从该 Run 的
ContextManifest 读取 `camp_message_boundary_sequence`。所有消息、摘要、邻域与回复链读取
都被限定在该 Camp 和该边界内，并实时过滤 tombstone。

这个结构提供两条安全属性：模型参数不是授权来源；长 Run 无法通过检索看到当前输入边界
之后的新 CampMessage。

## 候选工具表面

初始提案希望形成：

```text
camp.list       Camp 名称发现
camp.search     当前 Camp 的公开消息搜索
camp.read       消息、邻域、回复链与时间线续读
history.search  多 Camp 的公开消息搜索
```

`camp.search → camp.read` 可以保留现有 Run fence。`history.search → camp.read` 则不能只靠
改名完成：后者必须定义目标 Camp 的授权与读取快照边界。搜索结果使用稳定 Camp/消息
ID 定位后续读取；timeline sequence cursor 和任何模型提供的 ID 都不是授权证明。

## 决策 1：跨 Camp 可读集合

`history.search` 是当前运行中 Agent 可主动调用的只读模型工具。它只覆盖当前
`AgentProfile` 仍是有效 CampMember 的其他存续 Camp，只能检索原始公开 CampMessage。
离开成员关系后立即失去目标 Camp 的读取资格；永久
删除的 Camp 不留下可检索历史；ConversationMessage、Inbox/A2A 与其他私有执行内容永远
不进入该搜索面。

调用结果是临时来源读取，不创建、修改或自动激活任何 Memory。Memory Library 继续承担
受用户治理、可跨 Camp 延续的长期认识；历史搜索不能成为绕过 Memory Scope、Lifecycle、
Forget 或写入授权的隐式持久化通道。

这项决定记录于 proposed [ADR-0106](../../adr/0106-agent-bounded-cross-camp-public-history-retrieval.md)。

## 决策 2：冻结历史访问集合与全局消息边界

ContextManifest 在同一个权威读快照中冻结 **Cross-Camp History Fence**：

```text
exact eligible other Camp IDs
+ global public-message boundary
```

该 Camp 集合是本次 AgentRun 的最大历史访问集合。之后新加入的 Camp 即使实时状态已生效，
也不能在本 Run 的 `camp.list`、`history.search` 或跨 Camp `camp.read` 中出现。跨 Camp 原文
读取只能覆盖全局边界之前已经存在的公共消息；后续新消息等待下一 AgentRun。

每次搜索和读取仍实时复核当前 Binding、Run/Epoch、AgentProfile、Member Presence、目标
Camp 存续状态、目标 CampMember 资格与 tombstone。实时复核结果与冻结集合取交集，因此只
能撤销 Camp 或内容，不能授予 Manifest 创建后新增的历史访问。

同一 Run 内的发现、搜索与结果读取复用该 Run 的 Cross-Camp History Fence。稳定 ID 与
timeline sequence cursor 不携带 Camp 集合、消息边界或旧 Run 授权；每次调用完全按所在
AgentRun 的 ContextManifest 重新验证。

## 决策 3：冻结 Camp 发现元数据

Cross-Camp History Fence 已冻结 Camp 身份集合与消息上界，但 Camp Name 和“最近”排序字段
同样冻结为每个目标 Camp 的 **Camp Discovery Snapshot**：

```text
campId
campName
lastVisibleActivityAt
```

`camp.list(query)` 只匹配冻结名称；无查询时按 `lastVisibleActivityAt DESC, campId ASC`
稳定排序。最后可见活动取全局消息边界内最后一条公开消息的时间，Camp 尚无公开消息时回退
其创建时间。通用 `camp.updatedAt` 会混入重命名、成员、Task 等非历史正文变化，不进入模型
工具合同；数据库遗留的 `archived` 状态也不成为返回字段或产品概念。

边界后的 Camp 重命名或新消息不改变同一 AgentRun 的名称命中、展示或顺序。实时授权复核
仍可从结果中移除一个 Snapshot，但不会用最新元数据改写剩余 Snapshot。

## 决策 4：发现与相关性搜索只返回 Top-K

`camp.list`、`camp.search` 与 `history.search` 返回受硬上限约束的 Top-K 结果，不提供
`cursor` 或 `nextCursor`：

```text
camp.list       → Camp 发现 Top-K
camp.search     → 当前 Camp 相关命中 Top-K
history.search  → 跨可见 Camp 相关命中 Top-K
```

BM25、混合检索或未来其他相关性算法可以随文档集变化重排，offset 无法提供可靠的继续阅读
语义。需要更多候选时，调用者改写或缩小查询；需要完整连续阅读时，从稳定命中进入
`camp.read`。稳定 `campId` 与 `messageId` 只定位内容，不授予读取权限。

## 决策 5：`camp.read` 的四种读取与两种集合分页

`camp.read` 统一承载四种读取：

```text
item      单条消息正文与元数据
around    消息锚点前后的时间邻域
thread    消息及其回复链
timeline  Camp 原始消息序列的连续范围
```

`item` 使用 `bodyOffset` 与 `bodyLimit` 按 Unicode scalar 切片正文，单次正文最多 4,000 字符，
并返回 `bodyLength`、`bodyTruncated` 与 `nextBodyOffset`。这属于一个稳定消息内部的内容切片，
不是集合 cursor。

`around` 使用稳定 messageId，一次性返回受限的 `before` / `after` 时间邻域，不提供
`nextCursor`。需要继续读取 Camp 原始序列时，调用者使用返回项的 sequence 切换到
`timeline`。

`thread` 与 `timeline` 都使用 Camp 内稳定、单调的消息 `sequence` 作为整数 cursor。
`thread` 先限定为锚点所属回复树，`timeline` 不做回复关系过滤；两者除此之外共用同一分页
合同：

```json
{
  "campId": "camp_123",
  "mode": "timeline",
  "direction": "before",
  "cursor": 211,
  "limit": 20
}
```

`before` 严格读取 `sequence < cursor`，`after` 严格读取 `sequence > cursor`；结果按 sequence
正序返回，并以本页最靠近下一读取方向的已返回 sequence 作为 `nextCursor`。后续调用继续
使用严格不等式，因此不重复边界项。`hasMore` 只说明当前 Manifest fence、实时收窄范围和
当前视图过滤内是否还有可见消息。

Sequence cursor 不是相关性 cursor、内容 ID、快照或授权。稳定 messageId 负责从 Top-K 命中
进入 `item`、`around` 或 `thread`；连续阅读全部消息时使用 `timeline`。

四个模型接口都不搜索、返回或读取 Segment/Epoch Summary。摘要继续服务于 Core 内部的
Shared Conversation 组成与 Context Read Marker 覆盖；按需历史证据统一回到原始
CampMessage，因此工具 Schema 中不存在 `sources`、`summaryId` 或 Summary 结果类型。

## 决策 6：Thread 接受任意可见消息锚点

`thread.messageId` 可以是回复树中的任意可见 CampMessage，不要求调用者先找到根消息。Core
沿 `replyToMessageId` 向上解析所属回复树，并在每次响应中返回：

```json
{
  "anchorMessageId": "msg_211",
  "threadRootMessageId": "msg_120"
}
```

分页过滤作用于解析后的整棵回复树，而不是把锚点误当作新根。模型从搜索命中的深层回复即可
直接进入 thread，不需要逐级 `item` 回读祖先。

## 决策 7：首次 Thread 页从锚点开始

首次 thread 调用省略 sequence cursor 时，以 `anchorMessageId` 为起点并包含锚点：

```text
direction = before  → 锚点 + 回复树中 sequence 更小的消息
direction = after   → 锚点 + 回复树中 sequence 更大的消息
```

首次结果仍按 sequence 正序。只有后续显式传入 `cursor` 时才应用严格 `< cursor` 或
`> cursor`，从而不重复上一页边界项。响应返回 `threadRootMessageId`；需要从线程头部阅读时，
调用者用该根 ID 发起新的无 cursor thread 调用。

## 决策 8：本期不引入消息删除语义

当前产品、领域命令和 RPC 都没有 CampMessage 删除或撤回能力；`tombstoned_at` 是既有的
读取过滤与迁移安全机制，不代表一项用户可触发的消息生命周期。因此 v0.40 不提前设计
tombstone 后的回复树连通、隐藏根节点或 reply target 表示，也不新增
`replyTargetUnavailable`、`threadRootUnavailable` 等预测未来需求的字段。

四个历史检索接口继续在所有搜索、锚点解析和原文读取中排除已经 tombstone 的消息。将来若
引入消息删除能力，必须在该能力所属版本中同时冻结回复树、隐私、摘要失效与已投递原文不可
召回等完整语义，不能从 v0.40 的查询实现反推产品合同。

## 决策 9：Around 按可见消息条数取邻域

`around.before` / `around.after` 表示授权、Manifest fence 与 tombstone 过滤完成后，锚点
两侧最多选择的可见消息条数，而不是 Camp sequence 的数值距离。锚点始终包含且不计入两侧
数量；即使 sequence 存在空洞，也不会因此少取上下文。最终 items 统一按 sequence 正序返回。

Sequence 数值边界只服务 `thread` / `timeline` 的连续分页；`around` 不把查询实现中的序号
算术泄漏成模型语义。

## 决策 10：Around 返回有界原文前缀

无分页的 `around` 为锚点和两侧消息返回一致的有界原文前缀，而不尝试完整展开所有长正文。
每项显式返回 `bodyLength`、`bodyTruncated` 与 `nextBodyOffset`；需要深读时，模型以稳定
messageId 调用 `camp.read(mode="item")` 继续正文切片。

这使邻域形状不再被某一条长消息挤占。具体默认条数、最大条数、单项前缀长度和总响应预算
属于可由既有 4,000 字符单消息上限与 16,000 字符响应上限推导的实现合同，不再逐项升级为
产品决策。

## 决策 11：搜索表面只保留正文、Camp 范围与历史日期

新搜索工具不继承 `context.search` 的 `references`、`senderIds`、`sequenceFrom/Through` 或
`sources` 参数。第一版模型合同收敛为：

```text
camp.search(query, limit?)
history.search(query, campIds?, dateFrom?, dateTo?, limit?)
```

两个 query 都是必填的非空正文查询，`limit` 只是受 Core 硬上限约束的 Top-K 提示，不产生
分页。`history.search.campIds` 与当前 Run 冻结的其他 Camp 集合、实时授权和存续状态取交集；
未授权 ID 不会扩大范围。

`dateFrom` / `dateTo` 只过滤 CampMessage 不可变的 `createdAt`，不使用 Camp 更新时间、消息
更新时间或 relevance 索引时间。两者采用 RFC 3339 instant，`dateFrom` 包含下界，`dateTo`
排除上界；Core 在授权、Manifest fence 和 Camp 范围之后、相关性排序之前应用日期条件。
结果返回 `createdAt`，使模型能够解释日期命中。

查询中出现 `ADR-N`、`PR-N`、`issue-N` 或完整 Task UUID 时，Core 可以在内部识别并提升精确
引用命中，但不再暴露独立 references 查询语言。当前 Camp 的时间范围连续阅读交给
`camp.read.timeline`；第一版不支持发送者硬过滤。

## 决策 12：未上线产品采用工具与 Manifest Clean Break

ROVAI App 尚未上线，不承担已发布协议的兼容义务。旧 ContextManifest 没有 Cross-Camp
History Fence，Migration 不补写、猜测或改写该不可变输入；旧的 queued、running、waiting
AgentRun 以明确的 Manifest 代际错误进入失败，重新执行时创建新 AgentRun 与新 Manifest。
已终态 Run 的历史证据保持不变。

新 Run 只暴露 `camp.list`、`camp.search`、`history.search`、`camp.read`；五个旧 `context.*`
工具与旧参数解析原子移除，不保留别名、双表面或按 Run 代际分支。一次性的开发期 Run 中断
优于把未发布合同固化成长期兼容负债。

仅让旧 Run 失败仍不够：既有 Native Session 可能保留旧 Session Charter 与工具使用记忆。
Migration 同时使旧 Native Binding 失效；下一 Run 保留 Rovai Conversation 的权威数据，但
创建带新 Charter 和四工具目录的新 Native Session，不 Resume 旧 Runtime 会话。

## 决策 13：历史附件只暴露元数据

`camp.read` 可以返回历史消息的有界附件元数据，包括 attachmentId、名称、媒体类型和字节
大小，但不得返回内部 storage path、Runtime 投影路径、附件正文、二进制或可直接读取的文件
句柄。集合读取只需返回有界元数据或数量提示，完整的有界元数据由 `item` 承担。

`camp.search` 与 `history.search` 只索引 CampMessage 正文，不索引附件名称或内容。真正读取
历史附件需要独立设计带明确授权、受管投影与生命周期的能力；不能通过暴露本地路径把消息
检索隐式扩大成跨 Camp 文件访问。

## 决策前继续成立的不变量

- Binding、当前 Run、执行代际、Member Presence 与 Camp membership 必须实时复核；
- 授权范围必须先于过滤、全文匹配、排序、计数、snippet 和分页；
- 既有 tombstone 必须继续实时过滤，但本期不扩展为产品级消息删除合同；
- 单条正文与单次响应继续有硬上限，截断必须可见且可续读；
- Sequence cursor 只表示 thread/timeline 的 Camp sequence 边界，稳定 ID 只定位内容，二者
  都不能扩大权限；
- 已永久删除 Camp 的正文不可检索或恢复。
