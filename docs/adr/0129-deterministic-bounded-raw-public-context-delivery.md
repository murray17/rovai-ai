---
document_type: adr
id: ADR-0129
title: Deterministic Bounded Raw Public Context Delivery
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.44
supersedes:
  - ADR-0050
superseded_by: null
---

# ADR-0129: Deterministic Bounded Raw Public Context Delivery

> [ADR-0145](0145-sole-native-session-self-identity-and-peer-routing-projection.md)局部替代本文
> “Stable collaboration state”中的 self/member、`defaultLead`、Presence 触发和内部 Member State
> digest 条款。当前合同是 peer-only Collaboration State v2、Lead ID/Boolean、完整最终 projection
> digest 与独立 inclusion；本文的公共消息、Context Profile 和 Accepted Public Context Boundary
> 继续有效。

## Context

Rovai 现有 AgentRun 公共消息上下文依赖 Camp 级 Segment/Epoch Summary、覆盖区间、
Coverage Baseline、摘要模型选择、异步生成与 `waiting(context_compaction)`。同一套机制还让
Context Read Marker 同时表示原文、摘要和基线覆盖，使一次 Runtime ACK 与模型实际收到的
原始消息集合之间需要额外覆盖证明。

该机制成本高、存在模型生成的不确定性，并把普通 AgentRun 的启动与另一条 LLM 摘要链路
耦合。v0.40 已经提供只读取原始 CampMessage 的 `camp.search`、`history.search` 和
`camp.read`；Agent 可以在当前 ContextManifest Fence 内按需定位并读取原文，不再需要第二种
可读或可注入的摘要内容权威。

新的上下文投递需要满足以下约束：当前输入必须完整；公共历史必须有确定性硬上限；整条省略
与单条正文截断必须可区分；Member Call 必须保留最初公开用户请求；恢复仍复用不可变
ContextManifest；Runtime ACK 仍是唯一推进 Native Session 公共投递边界的事实。

## Decision

### Accepted Public Context Boundary

每个当前 Native Binding generation（对应一个 Native Session）只维护一个单调标量：

```text
lastAcceptedPublicBoundarySequence
```

它表示上一次被 Runtime 接受、并由 Core 持久完成 ACK 的 AgentRun ContextManifest 所冻结的
当前 Camp 公开消息 sequence 边界。它是 **Accepted Public Context Boundary**，不是逐条
已读状态、模型理解证明或历史读取游标。

新 AgentRun 在一个权威读快照中冻结：

```text
previousAcceptedPublicBoundarySequence
currentPublicBoundarySequence
```

公共历史候选集合只包含当前 Camp 中满足以下条件的未 tombstone CampMessage：

```text
sequence > previousAcceptedPublicBoundarySequence
sequence <= currentPublicBoundarySequence
```

用户消息触发本 Run 时，当前触发 CampMessage 从候选集合排除，只进入 `CURRENT_INPUT`。
除 tombstone 与当前用户触发消息排除外，不按发送者、同一 Native Session 的既有输出、Mention、
回复关系、附件或内容评分再过滤候选集合。

Runtime 接受冻结输入且 Core 在同一受 fencing 事务中持久 ACK 后，边界直接推进到
`currentPublicBoundarySequence`。它不会因为 AgentRun 随后失败或取消而回退，也不会因为部分
候选消息只由遗漏提示表示而停在更早位置。ACK 未完成时不推进；重试只能投递同一冻结字节。

新建或替换 Native Session 时，该 generation 的 previous boundary 从 `0` 开始。旧 Session 的
边界不能冒充新 Session 已接受的上下文。

两个边界只进入 Core 状态、ContextManifest 与审计，不进入模型可见的
`SHARED_CONVERSATION`。`camp.search` 和当前 Camp 的 `camp.read` 仍可读取本 Run Manifest
边界内的任意可见原始消息，包括已经自动投递过的旧消息；Accepted Public Context Boundary
只决定自动注入候选集合，不构成工具读取下界。

### Current Input remains complete

`CURRENT_INPUT` 始终完整，不做截断、摘要、拆分或外置正文替代。

- 用户触发：完整用户正文只出现于 `CURRENT_INPUT`，不在公共历史重复；授权附件路径继续
  随当前输入投递。
- Member Call 触发：完整私有 Call 正文只出现于 `CURRENT_INPUT`；Core 继续提供可信发送者
  元数据。
- InboxMessage、ConversationInput 和其他 A2A 私有正文不进入公共消息区。

Context Delivery Profile 先限制公共历史。若完整格式化载荷仍超过目标 Runtime 的输入硬上限，
Core 继续从最旧的 `recentMessages` 开始整条移除并更新遗漏说明。独立的
`originatingPublicUserMessage`、完整 `CURRENT_INPUT`、其他已经成立的动态区段和固定结构不
截断。全部 recent message 移除后仍超限时，AgentRun 在 Runtime 投递前以
`context_payload_too_large` 明确失败：触发用户消息或 Member Call 事实继续保留，不产生输入
ACK，不推进 Accepted Public Context Boundary，也不进入任何 `waiting(context_*)` 状态。

### Originating Public User Message for Member Calls

Member Call 触发的 AgentRun 由 Core 沿持久 AgentRun/ConversationInput A2A parent/root lineage
追溯到本协作链最初的公开用户 CampMessage，形成：

```text
originatingPublicUserMessage
```

嵌套 Member Call 继承同一条原始用户消息。模型不能提交、覆盖或猜测该关系；lineage
必须解析到当前 Camp、未超过本次 `currentPublicBoundarySequence` 的公开用户消息，否则
Context materialization fail closed。合法 tombstone 会实时排除该消息正文，并且不以遗漏提示
泄漏已删除内容。

该消息作为 `SHARED_CONVERSATION` 的独立可选项：

- 不占 `maxPublicMessages`；
- 参与 `maxPublicHistoryChars`；
- 使用普通历史消息的正文前缀规则；
- 若同一 message ID 已在 `recentMessages`，只保留 recent item，不重复输出；
- 保留授权的公共附件信息；
- 不使用 `replyToMessageId` 表达来源关系。

`replyToMessageId` 继续只表示公开 CampMessage 之间的直接回复关系。

### Bounded Raw Public Messages

Core 从候选集合中选择 sequence 最大的 `maxPublicMessages` 条，最终按 sequence 升序输出为
`recentMessages`。选择过程不执行：

- 回复祖先或邻域补全；
- Mention、附件关系或参与成员补全；
- 关键词抽取、重要性评分或语义排序；
- Segment/Epoch Summary 替换；
- 同一 Native Session 输出去重。

每个 item 保留稳定 message ID、sequence、发送者、直接回复关系、授权公共附件信息和原始
正文前缀。附件不影响消息排序或数量选择；现有 Camp-Public Attachment Path 授权与冻结发现
边界继续遵守 ADR-0081。

### Unicode-scalar body prefix and history budget

单条历史正文按 Unicode scalar 计数。超过 `maxMessageBodyChars` 时：

```text
body = 原始正文前 maxMessageBodyChars 个 Unicode scalar
bodyLength = 原始正文 Unicode scalar 总数
bodyTruncated = true
nextBodyOffset = 实际保留的 Unicode scalar 数
```

`body` 必须是原文的精确前缀，不附加省略号或其他合成字符。未截断时
`bodyTruncated = false` 且 `nextBodyOffset = null`。`nextBodyOffset` 可直接作为
`camp.read(mode="item")` 的 `bodyOffset` 继续读取。

`maxPublicHistoryChars` 只累计去重后 `originatingPublicUserMessage` 与
`recentMessages` 实际注入的 `body` Unicode scalar 数。message ID、sequence、发送者、回复、
附件、截断字段、遗漏提示、区段包装和 `CURRENT_INPUT` 不计入该 Profile 预算；它们仍受条数
硬上限和 Runtime 总载荷上限约束。

独立 originating message 先占正文预算，剩余预算用于 recent message。最近窗口经单条前缀
截断后仍超出总正文预算时，从最旧 recent message 开始整条移除，直到满足预算。若 originating
message 与 recent item 去重，则只计一次。

### Explicit omission notice

只有候选集合中确有整条公开消息未通过 originating item 或 recent item 进入上下文时，
`SHARED_CONVERSATION` 才包含：

```yaml
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

`count` 是实际省略的可见候选消息数；`sequenceStart` / `sequenceEnd` 是该集合的最小和最大
sequence，即使 tombstone 造成整数间隙也不声称区间内每个整数都对应一条消息。当前触发用户
消息、A2A 私有消息和独立 origin 不属于“整条候选消息省略”。

某条已展示消息只有正文被截断时不产生 `omittedMessages`；Agent 只依据该 item 的
`bodyTruncated`、`bodyLength` 与 `nextBodyOffset` 判断是否需要续读。没有整条省略时整个
`omittedMessages` 字段省略。

遗漏提示不是自动读取指令。ACK 后，提示覆盖的消息同样越过当前 Native Session 的自动投递
边界，后续 AgentRun 不再次自动补投；需要时通过边界封顶的原始历史工具回读。

### Stable collaboration state

`COLLABORATION_STATE` 只描述当前 Camp 的稳定团队投影，不描述模型收到输入时成员正在做什么。
每名成员只提供 Core 已确认的团队身份字段：

```yaml
agentId: agent_xxx
name: A
teamRole: "..."
professionalResponsibilities: "..."
```

顶层可选的 `defaultLead` 只包含 Lead 的 `agentId` 和 `name`。该区段不再包含
`availability`、`busy`、`reason`、`changes` 或 `currentTurnNeedsCollaboration`；也不因为
当前 Turn 参与者数量或其他 AgentRun 的排队/运行状态而重新计算或注入提示。成员身份、Camp
成员关系、Presence 或 Lead 发生持久结构变化时，成员稳定投影 digest 才会使区段在后续 Run
重新提供。

成员是否能够执行一次具体协作请求由 `team.call_member` 在 Core 接受调用的同一权威状态上
当场判定，并受当前成员关系、Presence、Runtime、Capability、配额与执行 fence 约束。模型
不得把 `COLLABORATION_STATE` 当作可用性承诺，也不应因区段未重新出现而假设成员仍然可用。

Formatter v10 与保存过瞬时 availability 的既有 Native Session 不兼容。Migration v60 保留
Formatter v8/v9 的终态 Manifest 作为不可变审计证据，但 fail closed 旧合同下的非终态 Run，
并使现有 Native Binding/Session 失效；下一次执行必须建立不含旧瞬时状态的新 Session。

### Versioned Context Delivery Profile

所有投递数值由应用拥有的不可变 Context Delivery Profile 提供，不写死在 Formatter，不进入
成员设置、Renderer、IPC 可变配置或用户数据库设置。v1 由字段级合同冻结为：

```yaml
profileVersion: 1
maxPublicMessages: 15
maxPublicHistoryChars: 24000
maxMessageBodyChars: 2000
```

benchmark 调优只能新增 profile version，不能原地改变既有版本。Profile version 与 Formatter
version 是独立轴：只改变数值时升级 Profile；改变选择算法、字段结构或渲染语义时升级
Formatter。

每个 ContextManifest 冻结 `contextDeliveryProfileVersion`、解析后的 Profile snapshot 或其
canonical digest，以及本次实际选择证据。Profile 的完整字段、计量和算法由
[Context Delivery Profile v1](../contracts/context-delivery-profile-v1.md)约束。

### ContextManifest, recovery and clean break

新的 ContextManifest 不再保存 Summary ID、Summary 覆盖区间或 Coverage Baseline。它冻结：

```text
previous + current public boundary
originating public user message reference, when present
ordered recent raw-message references
omitted message count and sequence envelope, when present
Context Delivery Profile version + snapshot/digest
Current Input source and attachment references
other existing dynamic-context evidence
exact rendered dynamic-payload Blob + digest
```

恢复继续逐字节复用同一 Manifest payload；读取工具调用不修改 Manifest 或 Accepted Public
Context Boundary。新的 Formatter/Manifest 合同使旧非终态上下文和 Native Binding 不兼容；
clean-break migration 必须 fail closed 或明确终结旧非终态输入并使旧 Binding 失效，不能把旧
Summary payload 翻译为新窗口。终态 Manifest 的冻结 Blob 可以继续作为历史投递证据，但不再
成为新上下文或检索的 Summary 来源。

### Summary system and advanced settings are removed

Rovai 不再保留公共消息摘要能力。实施必须删除：

- Segment Summary、Epoch Summary、Coverage Baseline 与相关表、前沿、attempt、waiter、索引、
  repository/query 和 Read Side；
- 摘要调度器、后台 Job、专用 Runtime/模型调用、重试、水位、待处理计数与 Camp 删除 blocker；
- 等待摘要后再启动 AgentRun 的路径，以及 `context_compaction`、`context_overloaded` 等
  Summary/Context-overflow 等待状态；
- `ContextSummaryModelConfig`、get/update API、持久化、模型回退解析和 Renderer/Main/Preload/
  Core Client 全链路；
- 成员配置中的“高级设置”、对话压缩模型表单、展开按钮、文案、状态与无使用者样式。

以下能力明确保留：

- `camp.search`、`history.search`、`camp.read` 与 ContextManifest Fence；
- 原始 CampMessage、FTS、直接回复树、公共附件信息与 Camp Attachment Path；
- Member Runtime Configuration、模型、推理强度、Runtime 原生权限与 sandbox 参数；
- Runtime Input Delivery ACK、恢复、fencing 和 immutable rendered payload evidence。

### Replacement scope

本 ADR 完整替代 ADR-0050。它还局部替代：

- ADR-0051 中依赖 Summary/Coverage Baseline 的前提；原始消息检索、Unicode scalar offset、
  tombstone、字面查询与响应预算继续有效；
- ADR-0058 中 Conversation Summary/Camp Cursor 作为当前协作组成的条款；
- ADR-0060 的 Summary model entry；名称与路由身份条款不变；
- ADR-0061 的 Segment/Epoch Summary 与摘要模型输入目标；Execution Evidence 的其余
  Agent-inaccessible 边界不变；
- ADR-0067 的 Shared Conversation 摘要、Coverage Baseline、Context Read Marker、Manifest
  Summary references 与 context-compaction 等待条款；Bootstrap、Current Input、
  Collaboration State、Run Notices、恢复与附件职责继续有效；
- ADR-0075、ADR-0123 和 ADR-0126 中只为 Context Compaction/Summary Job 定义的 Runtime 启动、
  进程和 Home 条款；正式 AgentRun/Fleet/Native Home 语义不变；
- ADR-0100 对旧 Context Read Marker 名称与覆盖语义的引用；
- ADR-0106、ADR-0108 中“Summary 继续作为 Core 内部上下文组成材料”的条款；它们的
  Cross-Camp Fence 与四个原始历史工具合同不变。

## Consequences

- 同一 Camp 历史不再触发额外 LLM 摘要调用，AgentRun 启动不等待摘要生成或重试。
- 公共上下文由 Profile、sequence、Unicode scalar 和固定淘汰顺序完全确定，benchmark 可按
  Profile version 比较。
- ACK 边界可以跨过未注入正文的消息；省略是显式、一次性的，深读责任转为按需工具调用。
- Native Session 保留最近连续性，但新建 Session 不会重放完整历史，只会得到最近窗口和遗漏
  提示。
- 超长当前输入不会被损坏；无法满足 Runtime 总限制时会形成明确的 pre-dispatch Run failure。
- 删除摘要表、配置和 UI 减少领域与恢复状态，但 ContextManifest 需要新增原始窗口、Profile
  与遗漏证据。
- 原始 CampMessage 成为公共消息内容的唯一当前来源；旧终态 Manifest Blob 只保留历史证据
  身份。

## Rejected Alternatives

- 保留 Segment Summary 但默认关闭：仍保留双路径、配置、表、调度与恢复语义。
- 只删除模型配置、继续使用默认摘要模型：没有消除不确定生成和 AgentRun 阻塞。
- 对全部历史做动态关键词或重要性选择：结果依赖启发式，不能由 sequence 与 Profile 重放。
- 为回复祖先、Mention 或附件关系补消息：让固定窗口重新变成不稳定的图遍历预算。
- ACK 只推进到最后实际注入原文：需要维护多段待补投状态，重新引入逐条覆盖证明。
- 把 omitted range 作为自动检索命令：会因存在省略而无条件消费上下文和工具预算。
- 截断 `CURRENT_INPUT` 或改用摘要/Blob 引用：改变用户或 Member Call 的当前责任正文。
- 让用户编辑 Profile 数值：同一 profile version 可产生不同输入，破坏重放与 benchmark 对应。
- 把 Accepted Public Context Boundary 暴露给模型：工具授权不依赖它，暴露会鼓励把 ACK 误解
  为已读或业务进度。

## References

- [v0.44 AgentRun 确定性原始公共上下文](../versions/v0.44/README.md)
- [Context Delivery Profile v1](../contracts/context-delivery-profile-v1.md)
- [ADR-0050: Camp-Shared Progressive Summaries](0050-camp-shared-progressive-summaries.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
- [ADR-0061: Durable Agent-Inaccessible Execution Evidence](0061-durable-agent-inaccessible-execution-evidence.md)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](0067-native-session-bootstrap-and-agentrun-context-v3.md)
- [ADR-0081: Camp-Public Attachment Paths and Frozen Discovery](0081-camp-public-attachment-paths-and-frozen-discovery.md)
- [ADR-0099: Independent Member Calls](0099-cost-gated-independent-member-calls.md)
- [ADR-0106: Agent-Bounded Cross-Camp Public History Retrieval](0106-agent-bounded-cross-camp-public-history-retrieval.md)
- [ADR-0108: Discovery-Only Camp Message Search](0108-discovery-only-camp-message-search-and-sequence-paged-reads.md)
