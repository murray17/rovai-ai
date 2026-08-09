---
document_type: design-review
version: v0.50
authority: reviewed-context-projection-decisions
status: accepted
implementation_authorized: true
implementation_status: complete
last_updated: 2026-08-09
---

# v0.50 Bootstrap / Dynamic Context 第 4–13 项设计审查

## 文档边界

本文记录对“第 4–13 项分析”的逐项挑战结果及用户已确认的决定。它是形成
[ADR-0147](../../adr/0147-lossless-model-context-projection-and-layered-delivery-evidence.md)的版本内
评审证据，不单独充当字段级实施规格。用户在本评审完成后另行明确授权一次性实施；最终字段、
Migration 68 shape 和验收矩阵由同版本实施计划、当前合同 fixture 与代码共同冻结。

不得从本文的设计示例反推未被当前合同 fixture、Migration 与测试冻结的兼容分支或新增版本轴。

## 先决边界

任何实现都必须先区分四层：

| 层 | 权威 | 不证明 |
| --- | --- | --- |
| Context Source State | CampMessage、Attachment、CampMember、Task、Memory 等内部领域事实 | 模型收到什么 |
| Model Context Projection | 隐私过滤后的模型可见字段和值 | 领域真源、Runtime accepted |
| ContextManifest Evidence | source refs/digests、选择、顺序、截断、遗漏和 exact Dynamic Context bytes/digest | 完整领域快照、Runtime accepted、模型理解 |
| Runtime Input Delivery Evidence | Manifest + Run epoch + Binding generation + 投递版本和结果 | 模型 DTO 的选择或完整 source evidence |

只有 Runtime Input Delivery 的 accepted ACK 可以推进该输入冻结的水位。Message Delivery 创建、
AgentRun 物化、transport send、失败、`delivery_unknown` 和未 accepted 输入都不可以。

上表描述 AgentRun Dynamic Context。Bootstrap 的 stable Charter/Memory components 继续由 Bootstrap
Evidence 负责；完整 `MEMBER_IDENTITY`、完整 Bootstrap 和 combined overlay 仍是 transient，不进入
ContextManifest 或 Runtime Input Delivery。

## 逐项结论

| 项 | 结论 | 已确认边界 |
| --- | --- | --- |
| 4 | 有条件接受 | 只精简模型字段并分离 Evidence；保留 canonical 名称，不接受缩写 DTO、`more` 或第二套 locator 词汇 |
| 5 | 接受 | Dynamic Context 使用 compact JSON并省略无意义默认值；不得改变值、顺序、选择或 Evidence |
| 6 | 原分析有误，按修正版接受 | 单条截断提供 canonical `camp.read` continuation；整条省略只有非连续 sequence envelope 与 navigation hint，不伪造 range locator，不合并模型 aggregate 与 Manifest omissions |
| 7 | 按事实/规则分层接受 | Run Notice 只含冻结 Task 关联事实；稳定 Task/polling 规则与“额外 peer-coordination send”不变量进入 Charter，不限制 Runtime-specific 用户结果交付 |
| 8 | 否决 | 不引入 Collaboration Delta、generation、routingSummary 或 capabilityTags；保留完整 Collaboration State v2 与 accepted digest |
| 9 | 本次否决 | 不引入 estimated-token estimator、六类 token budget、优先级或选择变化；Profile v2 数值和算法不变 |
| 10 | 否决 | Memory Entrypoint 内容、数量、选择和排序不变；不引入 pinned/high-priority 或无 query 的伪 `memory.search` locator |
| 11.1 | 接受 | Charter 标题移除 `(v0.47)`；模型文本不展示 App/version；不新增重复的 Built-in catalog version/digest Evidence |
| 11.2 | 接受并修正版本 | 使用一条不可省略的 Core recovery authority 语句；Redelivery Envelope/Formatter 从已持久化的 v1 升为 v2 |
| 12 | 保留现状并补清 evidence | Current Input 完整、每 Run 最后投递且不进历史淘汰；closure 选择和 3 层上限不变；Manifest 保留 exact evidence |
| 13 | 否决 | 不能把错误字段、Delta、伪 locator、错误 Current Input shape、token estimator 和不足 Evidence 拼成实施规格 |

## 第 4–6 项：语义无损的 Shared Conversation 投影

允许建立独立的内部 model DTO，但模型合同继续使用现有语义名称：

```text
messageId
sequence
senderType
senderId
replyToMessageId
```

不改成 `id`、`seq`、`from`、`replyTo`，也不引入 `more`。模型不需要的
`sourceConversationId` 删除；历史附件保留授权后的 `name`、`mediaType`、`path`，模型不显示
`contentDigest`。无附件、无 reply/source 和其他空 optional 字段省略。未截断正文不输出
`bodyLength`、`bodyTruncated: false` 或 null continuation 状态；reference distance 即使为 1 也保留，
避免依赖隐式默认含义。

截断事实必须清晰，并提供可以直接作为正式操作输入的 continuation：

```json
{
  "operation": "camp.read",
  "input": {
    "campId": "camp-123",
    "mode": "item",
    "messageId": "message-123",
    "bodyOffset": 2000
  }
}
```

`bodyLimit` 可以按需出现，但不是必填。只有完整无损映射到当前 operation schema 的对象才称为
Executable Retrieval Locator。随后获批的实施规格将承载字段冻结为 `continuation`；它不使用
`more`、`retrieveWith.locator` 或扁平自定义参数。

整条历史省略没有 sequence-range `camp.read` 模式，因此模型只能看到：

- 实际省略数量；
- 被省略集合的最小/最大 sequence envelope；
- “未知内容不可猜测，只在当前任务确实依赖时检索”的短规则；
- `camp.read` / `camp.search` 等可用 canonical operation 的 navigation hint。

`sequenceStart` / `sequenceEnd` 不声称中间连续，也不是可提交给工具的参数。精确 omission message IDs、
选择原因和 omission reason 只进入 ContextManifest Evidence。模型 `omittedMessages` aggregate 与
Manifest `omissionEntries` 各自保留职责，不合并为第二套 `omissions` wire shape。

ContextManifest 必须继续冻结 exact source IDs、source content digests、历史附件 ID/path/digest、选择、
截断参数、closure distance、omission IDs/reasons 和 exact rendered Dynamic Context bytes/digest。compact
JSON 不能减少这些证据，也不能改变 Profile v2 的候选集合、顺序、Unicode-scalar 计量和预算结果。

## 第 7 项：Task 权威与模型提示

Task association 的权威是 accepted Message Delivery / AgentRun 上冻结的历史关联；后续 Task 状态、
assignee、标题、描述或 Acceptance Criteria 变化不能取消、停止或重定向该 Run。

模型可见 Run Notice 固定为一项简短事实：

```json
{
  "code": "a2a_task_context",
  "taskId": "task-123",
  "message": "This Task is historical context; later Task changes do not retarget this Run."
}
```

ContextManifest 冻结 typed Task reference、notice code、exact rendered bytes/digest，不复制 mutable Task
snapshot；Runtime Input Delivery 不再复制这些字段。

Charter 承载以下稳定规则：

- Task create/update 不通知或唤醒 assignee；需要立即行动时使用明确 send；
- Task get/list 是快照，不是等待或轮询原语；
- later Task changes 不 retarget 已 accepted Run；
- 完成 Task 或当前工作本身不要求额外的 peer-coordination send；
- 只有目标 Member 需要该消息才能继续行动或作出决策时，才做额外的 peer-coordination send；
- 这条规则不替代 Runtime-specific public-output delivery requirement，也不限制正常用户可见结果交付。

最终实施规格必须把下面的 Charter 文案作为强制不变量，而不是把所有 `rovai send` 都解释为成员协作：

```text
Completing a Task or the current work does not by itself require an additional
peer-coordination send. Use an additional `rovai send` for peer coordination
only when a target Member needs the message to continue acting or decide.
This rule does not replace Runtime-specific public-output delivery requirements.
```

因此必须保持：

```text
user-visible result delivery != additional peer-coordination send
```

## 第 8–10 项：明确不进入本次切换

Collaboration State 保持 ADR-0146 已完成的完整 schema-v2 peer projection。完整 canonical projection
digest 与 `collaborationStateIncluded` 独立冻结，accepted ACK 才推进。Delta generation 不能证明模型在
compaction 后仍持有上一代，因此没有 `COLLABORATION_DELTA`、upsert/remove fallback 协议或职责摘要。

Context Delivery Profile 保持 v2。以下 Profile 内容全部不变：候选消息、选择/去重/排序、3 层 reference
closure、Unicode-scalar 计量、15/24,000/2,000 等数值和预算优先级。独立的现有 96 KiB Runtime/
combined-payload gate 也不改变，但不属于 Profile v2。本次没有可信的
Runtime/model tokenizer identity、确定性 estimator 或 benchmark，不能引入 estimated-token Evidence 或
按估算 token 改写选择结果。

Memory Entrypoint 继续使用既有 Hearth 16、Companion 32、Relationship 24、总计 72、每 pair 12 和既有
round-robin/fairness 规则；内容、选择和排序不变。当前 `memory.search` 需要非空 query，不能把
`{"operation":"memory.search"}` 伪装成可执行恢复对象。

## 第 11 项：Charter 与 Redelivery

Charter 标题固定为：

```text
Rovai Built-in CLI Contract
```

不动态插入应用版本，Bootstrap Evidence 也不新增 Built-in Tool contract version 或 catalog digest。
Charter component bytes/digest 已证明模型可见的稳定 CLI 文本；invocation-time CLI context 与 Native
Binding compatibility digest 继续证明各自负责的合同和 catalog，不让 Bootstrap Evidence 冒充完整
catalog 投递或授权证据。Memory Entrypoint 不变。

Redelivery v2 的完整外壳是：

```text
[ROVAI_BOOTSTRAP_REDELIVERY reason="context_compaction"]
This is Core recovery context for the existing Native Session, not a new task or Session.

<complete Native Session Bootstrap>
[/ROVAI_BOOTSTRAP_REDELIVERY]
```

删除 v1 的三句 Runtime 生命周期说明，但保留这一句 recovery authority。ContextManifest 仍只保存 Dynamic
Context；Runtime Input Delivery 仍只保存 Requirement revision、Bootstrap Evidence 引用、presence 和
Envelope/Formatter version；不保存完整 overlay、Identity bytes 或 combined digest。accepted、失败及
`delivery_unknown` 语义不变。

## 第 12–13 项：保留的底线与否决理由

`CURRENT_INPUT` 每 Run 必有、最后组装、正文完整、不进入历史淘汰。用户输入继续是
`{"source":{"type":"user"},"message":...,"attachments":[path...]}`；Member Call 继续使用可信
`senderAgentId` / `senderName`。不引入 `public_user`、用户 sender ID 或附件 `{path,mediaType}` 这类错误
shape。Current Input 的 exact source/message/body/attachment evidence 进入 Manifest，空 attachments 可从
模型投影省略。

Public Reference Context Closure 继续最多 3 层、direct parent 优先且 unreadable 时 fail closed；本轮只
精简每条 closure message 的模型字段，不改变选择。第 13 项建议格式同时包含已否决的 Collaboration
Delta、字段别名、不可执行 range locator、错误 Current Input、opaque Task binding、estimated tokens、
不完整 Manifest 和缺失 Runtime Input Delivery Evidence，因此整体不能作为实施起点。

## 最终版本轴与实施状态

同一个尚未发布、未形成外部兼容边界的 v0.50 草案最终使用：

```text
Native Session Bootstrap v3
Bootstrap Formatter v3
AgentRun Context Formatter v11
ContextManifest v8
Context Delivery Profile v2
Data Contract v0.50 / projection schema 27 / Migration 68
Bootstrap Redelivery Envelope v2
Bootstrap Redelivery Formatter v2
```

v3/3/11/8 对应一个真实 release contract，不按讨论次数或中间提交再升为 v4/v12/v9。Redelivery v1
则已在 v0.48 正式存在并持久化到 Runtime Input Delivery，所以 marker/wording 改变必须形成 v2/2。

当前 Self/Peer Collaboration baseline 已实现并通过既有验收；本评审新增的投影、Charter、Task Notice
和 Redelivery v2 已获得明确实施授权并进入同一 v0.50 clean break。最终完成状态只由实施计划记录的
代码、Migration、fixture 与全量验证证明，不能由本评审的 accepted 状态推导。
