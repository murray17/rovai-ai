---
document_type: architecture
architecture: public-a2a-message-delivery
authority: public-message-and-delivery-boundaries
status: accepted
last_updated: 2026-08-18
---

# Public A2A Message 与 Message Delivery 架构

本文件定义 v0.45 以后 Agent-to-Agent 协作的长期组件边界。字段级输入、错误和状态合同
分别见 [Camp Message Send v10](../contracts/camp-message-send-v10.md)、
[Current User Attention v4](../contracts/current-user-attention-v4.md)、
[Message Delivery v4](../contracts/message-delivery-v4.md)、
[Missing-Send Recovery Publication v1](../contracts/missing-send-recovery-publication-v1.md)、
[Camp History Retrieval v2](../contracts/camp-history-v2.md)；决策理由见
[Message Delivery 不变量](foundational-invariants.md#collaboration-delivery)、
[Message Delivery 不变量](foundational-invariants.md#collaboration-delivery)、
[History 与寻址不变量](foundational-invariants.md#collaboration-history-addressing)、
[History 与寻址不变量](foundational-invariants.md#collaboration-history-addressing)与
[公共上下文不变量](foundational-invariants.md#context-public-history)，显式 caller return 与 Core 管理
reply reference 见
[Message Delivery 不变量](foundational-invariants.md#collaboration-delivery)，成功 Run 的 zero-send safety net 见
[Message Delivery 不变量](foundational-invariants.md#collaboration-delivery)。
当前 Camp 显示名 inline alias 的 Core 解析与 canonical freeze 见
[History 与寻址不变量](foundational-invariants.md#collaboration-history-addressing)，line-leading position
门禁见 [History 与寻址不变量](foundational-invariants.md#collaboration-history-addressing)。
Current User Attention 的身份、内容与原子通知决定见
[Message Delivery 不变量](foundational-invariants.md#collaboration-delivery)。
持久 Gather capture、Barrier 与 Completion Delivery 见
[Gather 不变量](foundational-invariants.md#collaboration-gather)及
[持久 Gather Barrier](durable-gather-barrier.md)。

## 1. 一条公共事实，多个收件人责任

```text
AgentRun / user-visible Agent
          ├─ camp.message.send ──► Core Message Send Transaction
          │                          ├─ Public A2A Message (one public Camp fact)
          │                          ├─ Message Delivery × effective Agent recipient (zero or more)
          │                          └─ User Mention Occurrence + Episode upsert (zero or one)
          └─ successful zero-send ─► Core Terminal Recovery Transaction
                                     └─ recipient-free Public A2A Message (zero Delivery)
                                  │ dispatch attempt
                                  ▼
                         target AgentRun (zero or one)
```

`CampMessage` 是公共时间线、公共搜索和 Shared Conversation 的事实来源。它由作者、Structured
Content、
直接回复关系、稳定消息 ID 和冻结的 recipient/presentation snapshot 组成。每个
`MessageDelivery` 只负责一个 canonical Agent ID，并持有自己的队列位置、调度尝试、等待
条件、目标 Runtime/Run 绑定、ContextManifest 引用和终态证据。Delivery 的状态不会反写或
分裂公共消息事实。

v0.45 的新 A2A 路径不创建私有 A2A 消息、`CampMessageRecipient`、`AgentMessageDelivery`
或独立 `ConversationInput`。用户消息、Agent-authored Public A2A Message 和其 Delivery 使用
各自明确的触发来源，但不存在第二套收件人投递实现。旧数据和旧私有路径在 clean-break
Migration 中删除，不作为当前约束或回退来源。

## 2. Core 事务与身份解析

Core 在一个提交事务中完成：

1. 从 authenticated current AgentRun/Lease/Native Binding 推导唯一当前 Camp，并从 Run trigger
   自动确定 Message Reply Reference；
2. 读取 closed `AgentAddressingMode` 和独立的 `mentionUser`；PublicOnly 先拒绝显式 `to/taskId`，并在
   alias/member lookup 前把完整正文保留为 literal Text；Automatic 才从 canonical `--to`、正文 canonical
   token 与当前 Camp 有效成员 exact display-name alias 解析 Agent recipients；
3. 对所有目标执行 Camp membership、self、presence/removal、fanout、lineage 和 budget
   检查；
4. 去重并按 canonical Agent ID UTF-8/ASCII 字节序升序冻结 Effective Recipients；
5. 从 Structured Content 计算 canonical input/content digest、recipient digest、projected body、
   presentation metadata 和 envelope preimage；
6. 将 exact Immediate Caller 目标分类为 `return`，其他目标分类为 `forward`，并为每个目标
   冻结 target parent/root/depth；
7. 原子写入一个 Public A2A Message、每个 Agent 目标一个 Message Delivery，并在
   `mentionUser=true` 时写入唯一 `user_mention NotificationOccurrence(local_user, messageId)`；
8. 记录 idempotency receipt、Send mode 和 audit facts；clean-break send event v2 以
   `agentAddressingMode` 表达 caller intent，以 `recipientFree` 表达派生结果。

任何一个目标不合格、fanout 超限、self/ancestor cycle 或相同 requestId 输入冲突，都使整笔
事务失败，不留下公共消息、Current User Mention、Notification、Delivery 或半成品审计事实。
Runtime readiness、busy 和容量不
属于身份解析失败；它们只在 Delivery 进入调度生命周期后成为 waitCondition。

PublicOnly 与 Automatic-empty 都可能得到空数组，但前者必须保持零 MemberMention、Delivery、A2A allocation
和 Agent wakeup，且不能从正文、结果数组或历史 event 反推模式。Principal attention 与 Agent routing 正交；
`--to-principal` 只创建当前消息的 CurrentUserMention/Inbox effect，不创建 Delivery，也不代表批准。

Display-name alias 只在上述发送事务内存在。Core 只在 logical line 的首个非空白 token 解析它；推荐的
trailing handoff 是专门的最后一个非空行，该行仍须以 alias 开头。普通 mid-line prose 即使位于最后一行
也不寻址。完整显示名后须为 Unicode 空白或正文结束；canonical `@agent_N` 位置语义不变并保持优先，
最长完整显示名获胜，同长歧义按普通文本 fail closed。代码区、URL、转义、标点近似、昵称和 `--to`
display name 不参与。命中后立即转换为 canonical Agent ID 与 Structured Member Mention；Dispatch Pump、
Read Side 和 Renderer 都不得重新解析投影正文。

## 3. Delivery 生命周期与唯一 Dispatch Pump

Message Delivery Dispatch Pump 是投递、排队和物化的唯一权威。它读取 Delivery 自己冻结的
recipient、message、Task、`forward | return` edge、target lineage 和 presentation snapshot，不重新
解析正文或扩大目标。

Message Delivery v4 以 `deliveryKind`、`dispatchDisposition` 和 `completionRole` 形成 closed union。普通
public A2A 继续拥有 message/edge/lineage；Gather 的精确 return 可以作为 `gather_captured` 直接 settled，
但其 CampMessage 始终公开；Barrier 创建的 `gather_completion` 没有公开 recipient/edge lineage，却继续进入
同一 recipient FIFO 与 Dispatch Pump。Delivery-level completionRole 让 pre-run terminal 也能被 CampTurn
正确解释为 optional member result 或 required completion。

retry generation 是 Delivery 当前物化责任的一部分。Delivery 只保存 current target pointer；历史 attempt 与
AgentRun 以 `(triggerMessageDeliveryId, triggerDeliveryGeneration)` 保留，retry 不改写旧 Run。

Forward Delivery 把 source Run 作为 target parent 并将 depth 加一。普通 dispatch Return Delivery 保留 source Run
作为因果作者，但把 target parent/root/depth 恢复为 Immediate Caller 原先的调用 lineage；它仍进入
同一个 recipient queue、消耗一个 A2A slot，并创建新的 caller continuation AgentRun。非直属祖先
继续被 lineage guard 拒绝。`gather_captured` return 不进入 queue、不物化 Run，也不消耗普通 A2A slot；
它受独立的 Item/current-generation 上限约束。

```text
accepted/pending (no attempt)
        │ direct event
        ▼
  dispatch attempt ──┬── target blocked → pending + waitCondition
                     ├── context gate fails → failed/context_payload_too_large
                     ├── target admitted → AgentRun materialized → running
                     └── explicit cancel → cancelled
```

一次实际 dispatch attempt 必须先留下可恢复的 attempt fence。若 Core 在该 fence 建立前崩溃，
Delivery 终态为 `interrupted_before_dispatch`，不能被启动、恢复、Camp 打开、新消息、Run
结束、Runtime 恢复或容量事件隐式重新排队。用户只能对这条 Delivery 显式 Retry 或 Cancel。

已经建立过 attempt、但因 `target_busy`、`runtime_unavailable` 或
`capacity_unavailable` 暂时阻塞的 Delivery 保持 pending，并记录 waitCondition。只有同一
recipient/Camp 的直接相关事件调用 `dispatchPending(agentId)`；没有周期扫描和 Camp 级
兜底事件。

## 4. Context gate 与 AgentRun 物化顺序

Delivery 被选中尝试后，Core 先按
[Context Delivery Profile v3](../contracts/context-delivery-profile-v3.md)完成选择与预算 gate，再由
当前 Context Formatter v19 形成 Model Context Projection，并由 ContextManifest v17 冻结 Evidence，最后决定
是否创建 AgentRun：

```text
Delivery attempt
  → read authoritative public boundary
  → resolve Profile v3 + reference closure
  → format Model Context Projection
  → freeze ContextManifest Evidence + exact payload/digest
  → if fit: materialize AgentRun and bind Delivery
  → if not fit: terminal Delivery failure, no AgentRun
```

完整 Current Input、Core 管理的直接父消息和 mandatory structure
优先于可选 recent history。若清除可选内容后仍无法容纳，Delivery 以
`context_payload_too_large` 终态失败；Public Message、其他 recipient Deliveries 和
CampTurn 事实保持不变。该失败不是 waitCondition，也不会被自动重试；需要新的公共发送
请求或针对失败 Delivery 的用户明确决定。

Current Input 保留触发来源的权威差异。普通用户触发精确投影为
`{"source":{"type":"user"},"message":...}`；Public A2A target Run 精确投影为
`{"source":{"type":"member_call","senderAgentId":...,"senderName":...},"message":...}`。
Core 在 preflight 和 frozen Context materialization 时验证 CampMessage 作者、Delivery causal source、
target parent/root/depth、recipient 与 A2A lineage 一致；不把 CampMessage ID、MessageDelivery ID 或 source
AgentRun ID 暴露给模型。ordinary A2A `public_a2a/dispatch/forward|return` 还在 `RUN_FACTS` 后、
`CURRENT_INPUT` 前获得 closed exact `[A2A_GUIDANCE]`；direct、Gather Completion 与 captured return 不注入。
Manifest 冻结 inclusion/variant/payload digest，恢复只复用并校验原始 bytes。

ContextManifest 只证明冻结的 Model Context Projection 及其 source/selection Evidence。随后独立的
Runtime Input Delivery 才把 Manifest 绑定到 AgentRun execution epoch 与 Native Binding generation；
只有该 Delivery 的 accepted ACK 可以把 Conversation/Native-Session 水位推进到 Manifest 冻结的值。
Message Delivery/AgentRun 创建、transport
send、send failure 或 `delivery_unknown` 都不是 accepted evidence。

## 5. Runtime 公共输出边界

每个 Runtime Adapter 在 catalog 中声明一种输出模式：

- `explicit_send_only`：只有 Agent 明确调用 `camp.message.send` 才产生公共 A2A Message；
- `assistant_final_visible`：Adapter 能可靠识别同一 Run 的 final boundary 时，可以将无收件人
  的最终正文提交为 Public A2A Message。

当前已交付的所有 Runtime Adapter 均冻结为 `explicit_send_only`。`assistant_final_visible` 只保留为
协议能力，当前没有 Adapter 选择该模式；普通 final 只保留在 Run/Evidence 边界，不隐式产生
CampMessage。该 ordinary output mode 与 Missing-Send Recovery Publication 是两个独立 catalog
capability；启用后者不把 Adapter 改为 `assistant_final_visible`。

自动 final 输出不能猜测收件人、不能创建 Delivery、不能把普通中间流写入公共区。精确重复
抑制只适用于同一 Run、recipient-free、canonical normalized body 完全相同的 final boundary；
不做语义相似度、时间窗或跨 Run 去重。

Missing-Send Recovery 则只在 successful Run 的终态事务执行。Core 先检查同一 Run 是否存在任何
non-null `sourceOperationId` 的 accepted Camp Message Send；只要存在，不论 public-only、addressed、
progress、final 或后来 tombstoned，都抑制 recovery。没有 accepted send 时，Core 才验证 Adapter
提供的 typed candidate 与冻结 Adapter 匹配、正文非空且不超过 32 KiB，并创建至多一条
recipient-free CampMessage。

四类 candidate source 是 Codex completed-turn item、Claude success result、Antigravity validated print
stdout 与 ACP `end_turn` 时 last-tool 后 assistant suffix。Core 不回退到通用 stream/stdout，不截断
超限正文，也不解析候选中的 Addressing Token。候选缺失或不合格不改变既有 AgentRun success；每个
独立 user/A2A Run 分别决策，因此多个静默 Run 可以各自产生一条消息。该机制不保证最终结论完整公开。

## 6. 读取侧与 UI 投影

| 事实/投影 | 唯一权威 | 允许的消费者 |
| --- | --- | --- |
| Structured Content、投影正文、作者、reply-to、公共可见性 | `CampMessage` | Camp 时间线、搜索、Shared Conversation、Context、Clipboard、审计引用 |
| Current User Mention 与 `mentionsCurrentUser` | CampMessage Structured Content | Renderer token、exact Camp read、Context 与 Notification eligibility |
| User Mention Occurrence、Episode identity 与 disposition | Notification module | Notification Center、未读徽标、Journal heads-up 与精确消息导航 |
| 收件人、`forward | return`、target lineage、队列、尝试、waitCondition、目标 Run、终态 | `MessageDelivery` | Dispatch Pump、Delivery Read Side、Drawer、审计 |
| Runtime 过程和证据 | Canonical Runtime Activity / Execution Evidence | Execution Drawer、审计、诊断 |
| CampTurn 停止与 fence | CampTurn cancellation authority | Composer Stop、Run/Delivery projection |
| Approval pending | Approval Read Side | Composer 上方唯一 Approval Dock；Header/通知摘要只负责定位与聚焦 |

Execution Drawer 只能读取并选择 Run 详情；它不拥有取消命令。CampTurn 存在时 Composer
发送位置切换为 Stop，由同一 CampTurn 权威 fence 整棵 AgentRun/Delivery 执行树。

Agent routing 与 User attention 不能相互推导。exact `camp.read item` 分别投影冻结的
`effectiveAgentRecipients` 与从 Structured Content 派生的 `mentionsCurrentUser`；notification clear、
retention 或 source unavailable 不改变后者。Renderer 展示名称只是当前 presentation，不能改写
`local_user` segment、消息 digest 或 Runtime 已冻结的 Context bytes。同一 Structured CurrentUserMention 在
Human body/FTS/UI 显示 `@你`，在 Agent Context、Camp History 与 Gather v3 输入显示 `@Principal`；Agent
snippet、Unicode-scalar offset 和 projected digest 均在 `agent_v1` 空间计算，禁止字符串替换 Human cache。

`camp.read item` 对当前 Run 自己已提交的 accepted send 具有一条 command-result-bound 的窄
receipt verification 例外；它不改变 ContextManifest 历史边界，也不扩展 collection read。Renderer
的 Message Mention 导航是独立的用户 read side：通过 `camp.messages.around` 读取同 Camp 有界锚点
窗口，不进入 Agent built-in operation catalog，也不授予 Agent post-boundary 历史访问。

历史读取侧不以单一 event name 重新定义公共消息。共享 Public Camp message publication seam 从
`camp_message.sent | camp_message.public_a2a_sent` 解析每条 `CampMessage` 的最早 global sequence，并只产生
一个 publication fact；body/FTS/reference search、item/around/thread/timeline、root/parent 追溯和 Manifest
历史 Camp activity 都在同一 global boundary 下消费它。重复 qualifying event 不重复消息，boundary 后消息
保持不可见，private Delivery、Runtime evidence 和非公共 A2A 不进入该 seam，也不进行 Event Log 回填。

## 7. 并发、重放与清理

- `requestId` 幂等只覆盖同一执行身份与相同 canonical input；运输重试复用 requestId，修正
  寻址使用新 requestId；
- 同一 send replay 复用原 `local_user`、Structured Content、User Mention Occurrence 和 Delivery IDs；
- successful terminal command 的 durable replay 不重复运行 recovery；send 先提交则抑制，succeed 先
  提交则 recovery 与 terminal fence 原子成立，迟到 send 被拒绝；
- Delivery Retry Identity 是独立审计身份，但重试不得重解析、扩大 recipient、改写正文或
  生成第二条 Public Message；
- canonical recipient order 永远不推导 Scheduler order；Scheduler 可使用自己的公平性、
  容量和 recipient-scoped FIFO 规则；
- Core 重启只恢复持久状态和已存在的 pump 事件订阅，不触发历史 Camp 全局调度；
- clean-break Migration 只清除 Rovai-owned 数据表、索引、旧 projection 和旧 IPC 文案，
  不删除用户工作区、外部 Runtime session 或 Runtime-owned 文件。
