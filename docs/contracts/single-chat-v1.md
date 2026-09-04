---
document_type: protocol-contract
contract: single-chat-v1
authority: single-chat-domain-context-operation-and-output-routing
status: accepted
version: 1
source_version: v1.40
last_updated: 2026-09-04
---

# Single Chat v1

## 1. 承诺与边界

Single Chat 是当前 Desktop 本地 User Principal 与当前 active Camp 中一个 present Member 的私有产品会话。
唯一隐私承诺是：**单聊正文不会进入 Camp 公屏。** 该承诺不表示 Workspace 文件变化、Shell 或网络副作用、
Runtime/Provider 内部调用和运行审计对其他系统表面不可见，也不提供副作用回滚。

v1 不接受外部 Channel Principal 创建或读取 Single Chat，不为 Runtime 原生 delegation、sub-agent、内部模型调用或
Provider 工具增加检测、Prompt 或 Adapter gate。

## 2. 领域复用与身份

Single Chat 不创建新的顶层执行聚合，继续使用：

```text
Conversation → CampTurn → AgentRun → ContextManifest → RuntimeInputDelivery
                                              ↘ NativeBinding / ExecutionEvidence
```

`conversation.kind` 是闭合集合 `camp_member | single_chat`。普通成员会话的唯一性为：

```sql
UNIQUE (camp_id, agent_id) WHERE kind = 'camp_member'
```

活动 Single Chat 的唯一性为：

```sql
UNIQUE (camp_id, agent_id)
WHERE kind = 'single_chat' AND ended_at IS NULL
```

Single Chat 生命周期只有 `active → ended`。同一 Camp 可以同时有多个不同目标的 active Single Chat；同一目标最多
一段 active Single Chat。结束后 successor 必须使用新的 Conversation ID、Native Binding、Native Session、私有
transcript 和 `lastAcceptedPublicBoundarySequence`，不得复用 predecessor 身份或水位。

私有正文复用 `conversation_message`。一个用户消息触发：

```text
camp_turn.kind = single_chat
camp_turn.trigger_type = conversation_message
agent_run.invocation_kind = single_chat
```

普通 Camp Snapshot、公共 Timeline、公共 Message、A2A、Gather、Notification 与 Channel 投影必须排除这些 Turn、Run、
Message 和私有执行证据。

## 3. Desktop/Core 接口

| Core method | 输入 | 成功语义 |
| --- | --- | --- |
| `singleChat.list` | `{ campId }` | 返回当前 Camp 的 active Single Chat，不返回 ended |
| `singleChat.get` | `{ conversationId }` | 返回 Conversation、Messages、Runs 与已授权 Execution Evidence；不存在返回 `null` |
| `singleChat.open` | command envelope + `{ campId, agentId }` | 已有 active 会话则幂等返回；否则创建新 Conversation |
| `singleChat.send` | command envelope + `{ campId, conversationId, body, expectedConversationVersion }` | 原子接收一条用户消息并创建一个 Turn/Run |
| `singleChat.end` | command envelope + `{ campId, conversationId, expectedConversationVersion }` | 原子结束 Conversation，并取消其中的非终态 Run |

所有 mutation 使用既有 command idempotency。`open/send/end` 只接受 `ActorRef::User`，同时验证 envelope Camp、payload
Camp 与目标 Conversation Camp 一致。目标 Agent 必须是 active、未请求离开、profile `present` 的当前 Camp Member，且
Camp 必须 active。

`send` 的正文 trim 后必须非空且最多 100,000 Unicode scalar。它在同一事务内：

1. 验证 active Conversation、版本、目标成员和 Runtime readiness；
2. 拒绝同一 Conversation 中已有 `queued | running | waiting` 的 Single Chat Run；
3. 冻结当前 Camp 公共边界、Runtime 配置、私有响应目标和 operation policy；
4. 写一条 user `conversation_message`、一个 `CampTurn` 和一个 required `AgentRun`；
5. 增加 Conversation version，并提交既有幂等 receipt。

上述任一步失败都不得留下 Message、Turn、Run 或 version 增量。busy 只作用于同一 Conversation，错误为
`single_chat.reply_in_progress`；不存在 Camp 全局 Single Chat 回复槽或隐式等待队列。

稳定拒绝码包括：

```text
single_chat.local_user_required
single_chat.camp_mismatch
single_chat.member_unavailable
single_chat.not_active
single_chat.version_conflict
single_chat.runtime_not_ready
single_chat.reply_in_progress
single_chat.operation_denied
single_chat.cross_camp_denied
single_chat.history_unavailable
```

## 4. 冻结路由与 Built-in policy

每个 Single Chat AgentRun 在创建时冻结以下不可变字段：

```text
invocationKind = single_chat
responseDelivery = conversation_message
operationPolicy = single_chat_v1
operationPolicyVersion = 1
destinationConversationId = current Single Chat Conversation ID
```

数据库约束拒绝 Single Chat 的其他组合，更新 trigger 拒绝在 Run 生命周期中改变这些字段。Runtime 输入、Prompt、
CLI 参数或 terminal payload 都不能覆盖冻结路由。

`single_chat_v1` 是 Core 内固定闭合 allowlist。允许的 Rovai Built-in operation 为：

```text
camp.search       current Camp only
camp.read         current Camp only
single_chat.history current active Single Chat only
```

所有其他 Rovai Built-in operation 一律返回 `single_chat.operation_denied`，包括 `rovai send`、Gather、Rovai A2A、
Member mutation/scheduling、Task read/create/update、全部 Memory operation、跨 Camp History 和未列出的未来 operation。`camp.search/read`
的 Camp 参数必须等于冻结当前 Camp，否则返回 `single_chat.cross_camp_denied`。Router 在输入 schema 验证后、以及已认证
Native Binding 的通用 operation 执行边界都重新检查策略；Prompt 不是授权边界。

`single_chat.history` 对应 `rovai single-chat history`，输入只接受 optional exclusive `beforeSequence` 和 optional
`limit`；limit 默认 20、最大 50，不接受 `conversationId/campId/agentId`。Core 从已认证当前 Run 的
`destination_conversation_id` 推导目标，并要求该 Run 仍为当前有效 `single_chat_v1` 执行、destination 仍为 active
Single Chat。默认边界为当前触发 user message 的 sequence；显式更大值仍 clamp 到该 sequence。结果只包含当前输入前的
`sequence/role/body`，按 sequence 正序排列，并用 `hasMore/nextBeforeSequence` 向更早正文分页。该读取不返回 Run、Turn、
Binding 或 Evidence，不写 Conversation、不推进公共水位，也不创建 Message。非 Single Chat 或失效目标返回
`single_chat.history_unavailable`。

## 5. Context 与公共水位

Single Chat Native Session Bootstrap 固定为：

```text
[SESSION_CHARTER]    Single Chat Charter；不得拼接普通 CLI Charter
[MEMBER_IDENTITY]
```

Single Chat Bootstrap 不调用 Memory Entrypoint builder；`observed_memory_revisions=[]`，不写
`memory_access_evidence`。现有 evidence 字段仍保存空 payload 及其 digest，但 formatter 不渲染空
`[MEMORY_ENTRYPOINT]` section。普通 Camp Bootstrap 继续包含 Memory Entrypoint。

每轮 Dynamic Context 固定顺序为：

```text
[COLLABORATION_STATE]   optional
[SHARED_CONVERSATION]  optional
[RUN_FACTS]            required
[SINGLE_CHAT_GUIDANCE] required
[CURRENT_INPUT]        required and last
```

不得投影 `[SELF_ACTIVE_TASKS]` 或 `[A2A_GUIDANCE]`。现有 Member Skill exposure 与 MCP projection 继续沿用；仅在
Single Chat Skill exposure 写入 ContextManifest、交给 Runtime Adapter 之前，按 official bundled source identity 排除
`cli-operations` 和 `memory-stewardship`。不得按 exposure 显示名、描述或数据库生成 ID 判断；ContextManifest 与 Runtime
实际接收的 exposure 必须是同一份过滤后 snapshot/digest。其他 Member Skills 与 MCP 不作 Single Chat 特化。

Dynamic Context 不增加 `sessionContinuity`、continuity-lost、replacement Session、`privateHistoryAvailable`、Native
Binding 或 Native Session 恢复原因，也不自动重放 transcript。每个有效 Single Chat Run 都可使用
`single_chat.history`；只有当前问题依赖且当前上下文缺少此前单聊内容时，模型才按需读取。

每次 send 冻结 `previousBoundary = conversation.lastAcceptedPublicBoundarySequence` 与当时 Camp public boundary；
`SHARED_CONVERSATION` 只从 `(previousBoundary, currentBoundary]` 选择有权读取且未 tombstone 的公共消息，并继续遵守
现有数量、字符预算、截断和 omission evidence。选择必须包括本地 Principal、其他 Member、系统公开消息和目标 Member
自己的公屏消息；不得复用普通成员 Session 的 self-output 排除规则。

公共消息不会异步推送或唤醒 Single Chat。只有 Runtime Input Delivery 的 accepted ACK 才把该 Single Chat Conversation
水位推进到本轮冻结边界；prepared、delivery_unknown、取消或未 accepted 不消费水位，也不得推进同一 Agent 的普通
`camp_member` Conversation 水位。

## 6. 私有输出路由

Runtime stream 与 terminal 回调先按既有可信进程/Binding 鉴权，再至少按 `agentRunId + executionEpoch` 解析冻结
Conversation 和 route。Renderer 订阅或轮询 Evidence 同样只合并 `conversationId + agentRunId + executionEpoch`
匹配的记录，不能按 `campId + agentId` 串流。

Single Chat Run 成功时，terminal transaction 必须：

1. 再验证 Run/epoch、Single Chat invocation、`conversation_message` route、`single_chat_v1` policy、destination 和
   Conversation active；
2. 在 destination Conversation 追加恰好一条 agent `conversation_message`；
3. 设置 `final_conversation_message_id`，保持 `final_camp_message_id = null`；
4. 结算 AgentRun/CampTurn，并保留 Execution Evidence。

该路径不得创建 CampMessage、执行 Missing-Send Recovery、发送飞书/钉钉等外部 Channel，或把 assistant stream 投影
到公共会话。终态重放沿用既有 terminal 幂等，只能返回相同结果，不能再追加第二条私有 final。

## 7. 停止、重启与结束

用户停止当前回复沿用 `agentRuns.cancel`：Run 终态为 `cancelled`，Conversation 仍 active，下一条用户消息创建新的
CampTurn/AgentRun。App、Core 或 Runtime Host 重启发现非终态 Single Chat Run 时使用相同取消结算，Renderer 只显示
普通取消呈现，不展示重启等额外原因。不得创建或展示 `app_restart`、`recovery_blocked`、旧输入重发、私有历史
replay/summary、Native Turn reconcile 或 Single Chat 专用恢复状态。

用户 `singleChat.end` 提交是业务线性化点：Conversation 原子变为 ended，拒绝后续 send，当前非终态 Run 进入既有
cancellation/cleanup，私有输出路由立即关闭。ended 后到达的 delta、final、tool result、Input ACK 和 Provider completion
只能成为旧 Run 的证据或清理回执；不得追加旧/新 transcript、创建 CampMessage、投递 Channel、推进公共水位或改变
cancelled 终态。

结束后可以立即为同一 `(camp_id, agent_id)` 创建并发送 successor Single Chat，不等待 predecessor cleanup，不增加
跨 Conversation fence、专用队列或容量合同。既有 Conversation-local cleanup fence 只约束同一 Conversation；Provider
并发限制继续由通用 Scheduler readiness/failure 表达。

## 8. Renderer snapshot 与呈现最低合同

`SingleChatSnapshot` 必须包含 typed `conversation/messages/agentRuns/executionEvidence`。每个 Run 投影
`executionEpoch`、生命周期时间、终态、错误、final ConversationMessage ID 和 Evidence 数量。Renderer 不从公屏或
Runtime 文案重建私有 transcript。

终态执行过程默认折叠但可展开，final message 始终位于独立分隔线下且默认展开。取消显示
“你在 {duration}后停止了运行”，成功显示“工作了 {duration}”；用户消息居右、队员响应居左，transcript 不显示头像。
完整组件规范见 [Camp 内单聊](../ui/components/conversation-workspace.md#camp-内单聊)。
