---
document_type: architecture
architecture: public-a2a-message-delivery
authority: public-message-and-delivery-boundaries
status: accepted
last_updated: 2026-08-09
---

# Public A2A Message 与 Message Delivery 架构

本文件定义 v0.45 以后 Agent-to-Agent 协作的长期组件边界。字段级输入、错误和状态合同
分别见 [Camp Message Send v2](../contracts/camp-message-send-v2.md) 与
[Message Delivery v1](../contracts/message-delivery-v1.md)；决策理由见
[ADR-0130](../adr/0130-public-a2a-message-and-unified-delivery.md) 和
[ADR-0131](../adr/0131-recipient-scoped-event-driven-delivery-recovery.md)。

## 1. 一条公共事实，多个收件人责任

```text
AgentRun / user-visible Agent
          │ camp.message.send
          ▼
Core Message Send Transaction
  ├─ Public A2A Message (one public Camp fact)
  └─ Message Delivery × effective recipient (zero or more)
                                  │ dispatch attempt
                                  ▼
                         target AgentRun (zero or one)
```

`CampMessage` 是公共时间线、公共搜索和 Shared Conversation 的事实来源。它由作者、正文、
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

1. 从 authenticated current AgentRun/Lease/Native Binding 推导唯一当前 Camp，验证 AgentRun/CampTurn、正文和 `replyToCampMessageId`；
2. 解析 `--to`、正文 Addressing Token 和 reply-to default target；
3. 对所有目标执行 Camp membership、self、presence/removal、fanout、lineage 和 budget
   检查；
4. 去重并按 canonical Agent ID UTF-8/ASCII 字节序升序冻结 Effective Recipients；
5. 计算 canonical input、recipient digest、presentation metadata 和 envelope preimage；
6. 原子写入一个 Public A2A Message，以及每个目标一个 Message Delivery；
7. 记录 idempotency receipt 和 audit facts。

任何一个目标不合格、fanout 超限、self/ancestor cycle 或相同 requestId 输入冲突，都使整笔
事务失败，不留下公共消息、Delivery 或半成品审计事实。Runtime readiness、busy 和容量不
属于身份解析失败；它们只在 Delivery 进入调度生命周期后成为 waitCondition。

## 3. Delivery 生命周期与唯一 Dispatch Pump

Message Delivery Dispatch Pump 是投递、排队和物化的唯一权威。它读取 Delivery 自己冻结的
recipient、message、Task、lineage 和 presentation snapshot，不重新解析正文或扩大目标。

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
[Context Delivery Profile v2](../contracts/context-delivery-profile-v2.md)完成选择与预算 gate，再由
当前 Context Formatter 形成 Model Context Projection，并由 ContextManifest 冻结 Evidence，最后决定
是否创建 AgentRun：

```text
Delivery attempt
  → read authoritative public boundary
  → resolve Profile v2 + reference closure
  → format Model Context Projection
  → freeze ContextManifest Evidence + exact payload/digest
  → if fit: materialize AgentRun and bind Delivery
  → if not fit: terminal Delivery failure, no AgentRun
```

完整 Current Input、直接父消息（当 `replyToCampMessageId` 有效时）和 mandatory structure
优先于可选 recent history。若清除可选内容后仍无法容纳，Delivery 以
`context_payload_too_large` 终态失败；Public Message、其他 recipient Deliveries 和
CampTurn 事实保持不变。该失败不是 waitCondition，也不会被自动重试；需要新的公共发送
请求或针对失败 Delivery 的用户明确决定。

Current Input 保留触发来源的权威差异。普通用户触发精确投影为
`{"source":{"type":"user"},"message":...}`；Public A2A target Run 精确投影为
`{"source":{"type":"member_call","senderAgentId":...,"senderName":...},"message":...}`。
Core 在 preflight 和 frozen Context materialization 时验证 CampMessage 作者、source AgentRun、
MessageDelivery、recipient 与 A2A lineage 一致；不把 CampMessage ID、MessageDelivery ID 或 source
AgentRun ID 暴露给模型。

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

自动 final 输出不能猜测收件人、不能创建 Delivery、不能把普通中间流写入公共区。精确重复
抑制只适用于同一 Run、recipient-free、canonical normalized body 完全相同的 final boundary；
不做语义相似度、时间窗或跨 Run 去重。

## 6. 读取侧与 UI 投影

| 事实/投影 | 唯一权威 | 允许的消费者 |
| --- | --- | --- |
| 公共正文、作者、reply-to、公共可见性 | `CampMessage` | Camp 时间线、搜索、Shared Conversation、审计引用 |
| 收件人、队列、尝试、waitCondition、目标 Run、终态 | `MessageDelivery` | Dispatch Pump、Delivery Read Side、Drawer、审计 |
| Runtime 过程和证据 | Canonical Runtime Activity / Execution Evidence | Execution Drawer、审计、诊断 |
| CampTurn 停止与 fence | CampTurn cancellation authority | Composer Stop、Run/Delivery projection |
| Approval pending | Approval Read Side | Composer 上方 Approval Dock、Inspector Approvals |

Execution Drawer 只能读取并选择 Run 详情；它不拥有取消命令。CampTurn 存在时 Composer
发送位置切换为 Stop，由同一 CampTurn 权威 fence 整棵 AgentRun/Delivery 执行树。

## 7. 并发、重放与清理

- `requestId` 幂等只覆盖同一执行身份与相同 canonical input；运输重试复用 requestId，修正
  寻址使用新 requestId；
- Delivery Retry Identity 是独立审计身份，但重试不得重解析、扩大 recipient、改写正文或
  生成第二条 Public Message；
- canonical recipient order 永远不推导 Scheduler order；Scheduler 可使用自己的公平性、
  容量和 recipient-scoped FIFO 规则；
- Core 重启只恢复持久状态和已存在的 pump 事件订阅，不触发历史 Camp 全局调度；
- clean-break Migration 只清除 Rovai-owned 数据表、索引、旧 projection 和旧 IPC 文案，
  不删除用户工作区、外部 Runtime session 或 Runtime-owned 文件。
