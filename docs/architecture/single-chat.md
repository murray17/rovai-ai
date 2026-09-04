---
document_type: architecture
architecture: single-chat
authority: single-chat-component-boundaries-and-data-flow
last_updated: 2026-09-04
---

# Single Chat Architecture

Single Chat 是现有执行基础设施上的一种私有 Conversation 模式。字段级合同见
[Single Chat v1](../contracts/single-chat-v1.md)，选择理由见
[V1.40-D01](../versions/v1.40/decisions.md#v1-40-d01)与
[V1.40-D02](../versions/v1.40/decisions.md#v1-40-d02)。

## 组件职责

| 组件 | 拥有 | 不拥有 |
| --- | --- | --- |
| Desktop Renderer | active 会话选择、私有 transcript、私有附件暂存意图、执行折叠、停止与结束意图 | 权限、持久附件路径、路由、恢复推断、公共水位 |
| Desktop Main bridge | 五个会话 Core method、三个私有附件 method 的 allowlist、受限 bytes ingress 和事件转发 | 业务状态、目标选择、私有输出生成 |
| SingleChatService | Conversation 生命周期、原子 open/send/end、snapshot | Runtime process、Prompt 执行、公共投影 |
| SingleChatAttachmentStore | Conversation-scoped 私有快照、receipt、暂存清理与 per-Run 临时投影 | Camp 公共附件、Runtime 能力、消息/Run 调度 |
| Context builder | 专用 Charter/Guidance、私有水位上的公共增量 | transcript 恢复、异步唤醒、授权替代 |
| Built-in Router | `single_chat_v1` 固定 allowlist 与当前 Camp scope | Runtime 原生 delegation、通用 Capability DSL |
| Runtime terminal service | 冻结 route 复核、恰好一条私有 final、迟到事件 fence | Renderer 展示、跨 Conversation 排队 |
| Existing Scheduler/Fleet | 普通 capacity/readiness、dispatch、Binding 与 cleanup | Single Chat 专用回复槽、successor cleanup fence |

## 主数据流

```text
Renderer singleChat.attachments.prepareFromPath
  → private Conversation-scoped snapshot + receipt
  → SingleChatSnapshot.preparedAttachments
Renderer singleChat.send(body, attachmentIds)
  → SingleChatService transaction
      → user ConversationMessage + immutable private attachment refs
      → CampTurn(kind=single_chat)
      → AgentRun(invocation=single_chat, private route, fixed policy)
  → existing Scheduler / Runtime Fleet
      → verify + copy trigger-message attachments into this Run's ROVAI_RUN_TMP
      → Single Chat Bootstrap + Dynamic Context
          → CURRENT_INPUT.attachments = per-Run private projection paths
      → authenticated Built-in operations under single_chat_v1
      → Execution Evidence
      → Runtime final
  → route-aware terminal transaction
      → agent ConversationMessage
      → no CampMessage / no Channel / no Missing-Send Recovery
  → SingleChatSnapshot
      → private Renderer panel
```

单聊消息和 Run 仍然属于其 Camp，因而可以读取被冻结边界内的公共历史并复用 Camp workspace；它们并不因此成为
CampMessage 或公共协作责任。普通 Camp read model 在 SQL 边界按 kind/invocation 排除 Single Chat，避免依赖 Renderer
隐藏。

## Context 分支

普通 `camp_member` Conversation 与 Single Chat 使用独立 Native Binding 和 accepted public watermark。Context builder
在同一 Manifest/Delivery 管线内根据 invocation 分支：Single Chat 选择专用 Charter/Guidance、排除普通 CLI/A2A/Task
投影，并允许目标 Agent 自己的公屏输出进入新增公共窗口。Manifest 仍记录 exact bytes、digest、selection 与 omission；
accepted ACK 仍是唯一水位推进点。

## 输出与迟到事件

`responseDelivery` 是 Run 创建时冻结的 terminal route，不从模型正文、是否调用 `rovai send` 或当前 UI surface 推断。
所有 Runtime 回调先绑定具体 Run/epoch 和已认证 Native Binding，再解析 destination Conversation。Conversation ended、Run
cancelled、epoch 过期、Binding generation 不匹配或 route 不完整时，回调只能进入旧执行/清理证据，不得转投当前同 Agent
的另一个 Conversation。

Renderer 只读取 SingleChatSnapshot 中的私有 Messages 与精确 Run Evidence。运行时沿用执行台的 narration、plan、tool
与 command 分组；终态自动折叠过程而不是删除 Evidence，final message 保持可读。

私有附件持久根与 Camp 公共附件根分离。Renderer 只能通过专用 bridge 暂存、移除和预览；Runtime 只接触当前 Run 临时
投影，Context builder 不把持久来源路径直接写入 payload。附件发送与用户 ConversationMessage 在同一事务中绑定；
successor Conversation 不能读取 predecessor 的暂存、已发送附件或临时投影。

## 取消和并发

启动协调在普通 AgentRun recovery 分类前先把非终态 Single Chat Run 交给既有 abortive cancellation。该规则只结束当前
回复，不结束 Conversation，也不恢复旧 Native Turn。用户结束 Conversation 时使用同一取消结算，并在事务提交点关闭
输出路由。

predecessor ended 后 successor 使用全新 Conversation/Binding/Session，因此不会命中 predecessor 的 Conversation-local
cleanup fence。两个 Runtime cleanup/dispatch 可以短暂重叠；底层无法并发时由现有 Scheduler/Fleet 报告 readiness 或
failure，不在 Single Chat 领域中引入等待状态。
