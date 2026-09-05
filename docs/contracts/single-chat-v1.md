---
document_type: protocol-contract
contract: single-chat-v1
authority: single-chat-domain-context-operation-output-attachment-and-queue-routing
status: accepted
version: 1
source_version: v1.50
last_updated: 2026-09-05
---

# Single Chat v1

## 1. 承诺与边界

Single Chat 是当前 Desktop 本地 User Principal 与当前 active Camp 中一个 present Member 的私有产品会话。
唯一隐私承诺是：**单聊正文、Source Ref 和最终回答不会进入 Camp 公屏。** 该承诺不表示 Workspace 文件变化、Shell
或网络副作用、Runtime/Provider 内部调用和运行审计对其他系统表面不可见，也不提供副作用回滚。

v1 不接受外部 Channel Principal 创建或读取 Single Chat，不为 Runtime 原生 delegation、sub-agent、内部模型调用或
Provider 工具增加检测、Prompt 或 Adapter gate。

## 2. 领域复用与身份

Single Chat 不创建新的顶层执行聚合，继续使用：

```text
Conversation → CampTurn → AgentRun → ContextManifest → RuntimeInputDelivery
                                              ↘ NativeBinding / ExecutionEvidence
```

`conversation.kind` 是闭合集合 `camp_member | single_chat`。活动 Single Chat 的唯一性为：

```sql
UNIQUE (camp_id, agent_id)
WHERE kind = 'single_chat' AND ended_at IS NULL
```

Single Chat 生命周期只有 `active → ended`。同一 Camp 可以同时有多个不同目标的 active Single Chat；同一目标最多
一段 active Single Chat。结束后 successor 必须使用新的 Conversation ID、Native Binding、Native Session、私有
transcript 和 `lastAcceptedPublicBoundarySequence`，不得复用 predecessor 身份或水位。

已发布的用户输入创建：

```text
conversation_message.author_type = user
camp_turn.kind = single_chat
camp_turn.trigger_type = conversation_message
agent_run.invocation_kind = single_chat
```

普通 Camp Snapshot、公共 Timeline、CampMessage、A2A、Gather、Notification 与 Channel 投影必须在 Core 查询/路由边界
排除这些 Turn、Run、Message、附件和私有执行证据，不能只依赖 Renderer 隐藏。

## 3. Source Attachment 数据合同

Single Chat 与 Camp Composer 共用：

```rust
LocalAttachmentSourceRef {
    id,
    source_path,
    display_name,
    kind,
    media_type,
    observed_byte_size,
}
```

选择、拖拽、文件粘贴及粘贴内容生成的临时文件都进入公共 Source Ref 流程。`source_path` 只保存在 Core 私有数据中；
Renderer Snapshot/History、Context 文本、Domain Event、CampMessage 和外部 Channel 不得暴露它。选择时不复制内容，也不
承诺不可变快照：来源后来移动、删除、不可读或改变类型时可以变为不可用，内容改变时后续 Run 读取当时实际内容。

未发送附件存入每段 active Single Chat 一行的 Draft：

```sql
single_chat_composer_draft(
    conversation_id PRIMARY KEY,
    revision,
    source_attachments_json,
    updated_at
)
```

Draft revision 独立于 `conversation.version`。附件增删只以 `expectedDraftRevision` 做 CAS，不删除用户原文件。Snapshot
返回清洗后的 `LocalAttachmentSourceView[]`：`id/displayName/kind/mediaType/byteSize/fileCount/previewKind/availability`，
不得返回 `sourcePath`、Core 私有目录或 Runtime 临时路径。

已发布用户输入把完整有序 Source Ref JSON 固定到：

```text
conversation_message.source_attachments_json
```

Single Chat agent final 和其他无附件 ConversationMessage 保存 `[]`。本合同不创建或保留
`SingleChatAttachmentStore`、`single_chat_prepared_attachment`、`single_chat_message_attachment`、
`single-chat-attachments`、私有 copy receipt、专用 retention 或专用 Runtime projection。

## 4. Desktop/Core 接口与发送准入

| Core method | 主要输入 | 成功语义 |
| --- | --- | --- |
| `singleChat.list` | `{ campId }` | 返回当前 Camp 的 active Single Chat，不返回 ended |
| `singleChat.get` | `{ conversationId }` | 返回 Conversation、Messages、Draft、Pending、Runs 与已授权 Evidence；不存在返回 `null` |
| `singleChat.open` | command envelope + `{ campId, agentId }` | 已有 active 会话则幂等返回，否则创建新 Conversation |
| `singleChat.sourceAttachments.addFromPath` | `{ conversationId, expectedDraftRevision, sourcePath, displayName, mediaType? }` | 公共观察/校验后把一个 Source Ref 追加到 Draft，不复制内容 |
| `singleChat.composerDraft.removeAttachment` | `{ conversationId, expectedDraftRevision, attachmentRefId }` | 只从 Draft 删除指定 Source Ref |
| `singleChat.send` | command envelope + `{ campId, conversationId, body, expectedConversationVersion, draftRevision }` | 原子消费当前 Draft，直接准入或进入该 Conversation 的 Pending FIFO |
| `singleChat.pendingInputs.edit` | command envelope + `EditSingleChatPendingInputCommand` | begin/takeover/save/remove/reorder/cancel/delete 排队编辑 |
| `singleChat.pendingInputs.addSourceAttachmentFromPath` | `{ campId, conversationId, pendingInputId, expectedRevision, editToken, sourcePath, displayName, mediaType? }` | 向已验证 edit working copy 追加公共 Source Ref |
| `singleChat.end` | command envelope + `{ campId, conversationId, expectedConversationVersion }` | 结束 Conversation、取消当前 Run 和未发布 Pending |

`open/send/end/pendingInputs.edit` 使用既有 command idempotency。所有 mutation 只允许本地 User，并验证 envelope Camp、
payload Camp、active `single_chat` Conversation 与当前 Camp 一致；目标 Agent 必须是 active、未请求离开且 profile
`present` 的当前 Camp Member。附件路径必须为绝对路径且在观察时存在、可读并为公共规则支持的普通文件或目录；名称、
媒体类型、数量和 Source shape 上限沿用 Camp Composer。

`singleChat.send` 的 trim 后正文与 Draft refs 不得同时为空，正文最多 100,000 Unicode scalar。输入不携带
`attachmentIds`；附件权威是匹配 `draftRevision` 的有序 Draft refs。Core 在事务中重读并验证 Source 当前状态：

1. Conversation 无非终态 Run 且无 Pending 时，验证 Runtime readiness，写 user ConversationMessage、CampTurn、AgentRun，
   清空 Draft，推进 Draft revision 与 Conversation version；
2. Conversation 有非终态 Run或已有 Pending 时，写 `single_chat_pending_input`，清空 Draft并推进 Draft revision，但不写
   ConversationMessage/CampTurn/AgentRun，也不推进 Conversation version。

Source 丢失、不可读、类型变化、Draft/Conversation revision 冲突或其他发送校验失败时，不写 Message/Turn/Run/Pending，
不清空 Draft，不推进任一 revision/version。附件-only 输入允许。

## 5. Conversation-local Pending FIFO

每个 Pending 保存 `conversation_id/enqueue_sequence/revision/state/body/source_attachments_json/user_id`。公开 Snapshot 只返回
`queued | needs_repair`，并包含清洗后的 canonical attachments；已发布与取消项不进入可操作列表。

Scheduler 只在下列条件全部成立时尝试发布队首：

- Conversation 仍 active 且 kind 为 `single_chat`；
- 同一 Conversation 没有 `queued | running | waiting` AgentRun；
- 当前项为最小未决 `enqueue_sequence` 且 state 为 `queued`；
- 该项没有打开的 edit session。

发布时重新验证原 user、目标成员、Runtime readiness 和 Source Refs，然后在一个事务内创建私有
ConversationMessage/CampTurn/AgentRun 并把 Pending 标为 `published`。失败把精确 revision 的队首改为
`needs_repair` 并保存 `lastAttemptErrorCode`；后续项不得越过队首。

每段 Conversation 同时最多一个 edit session。`begin` 创建 working body/refs，`takeover` 接管重启后标记
`recoveryRequired` 的 session；持有匹配 `editToken + basePendingRevision` 的编辑者可保存正文、添加/移除/重排附件、取消
或删除。保存时验证 working refs 的 canonical shape、数量与正文/附件非空约束；文件系统可用性在实际发布前重检。成功保存
推进 Pending revision、恢复 `queued` 并关闭 session。结束会话
删除 Draft/edit session并把未发布 Pending 标为 cancelled，不删除 Source 指向的用户文件。

FIFO 只约束单个 Conversation。一个队首的 active、edit 或 repair 不阻塞 Camp 公屏 Pending、其他 Single Chat、其他队员
或同一队员的新 successor Conversation。

## 6. 公共附件读取、预览与 Runtime 解析

`LocalAttachmentOwnerLocator` 增加以下精确 owner：

```text
single_chat_composer
single_chat_pending
single_chat_pending_edit
single_chat_message
```

owner 除 attachment ref id 外分别携带所需的 `campId/conversationId/pendingInputId/editToken/conversationMessageId`。
`load_source_attachment` 每次校验 Conversation 属于 Camp 且 kind 为 `single_chat`，并校验 Message/Pending/edit session
属于该 Conversation；不得跨 Conversation 猜测 ref id。Renderer 对 Composer 使用 `presentation=composer`，对用户历史
消息使用 `presentation=user-timeline`，并复用公共 `AttachmentCard`、Preview、Open、Reveal 与 FilePreview。

`load_agent_run_source_attachments` 对 Single Chat 必须同时验证：

```text
agent_run.invocation_kind = single_chat
agent_run.trigger_conversation_message_id = conversation_message.id
agent_run.conversation_id = conversation_message.conversation_id
agent_run.destination_conversation_id = conversation_message.conversation_id
conversation.kind = single_chat
conversation_message.author_type = user
```

dispatch 使用公共 `resolve_source_attachments_for_run`：execution root 内来源直接提供原路径，root 外来源安全复制到
`ROVAI_RUN_TMP/source-attachments` 后提供本轮临时路径；特殊文件、symlink、目录递归、dispatch 重检、Pi 图片准备和通用
cleanup 均沿用 Camp 链路。解析失败使当前 Run 诚实失败，不回退为无附件执行。所有 Adapter 接收同一份 resolved paths，
由 `materialize_with_exposures_and_source_attachments` 写入 `CURRENT_INPUT.attachments`。

## 7. 冻结路由与 Built-in policy

每个 Single Chat AgentRun 在创建时冻结：

```text
invocationKind = single_chat
responseDelivery = conversation_message
operationPolicy = single_chat_v1
operationPolicyVersion = 1
destinationConversationId = current Single Chat Conversation ID
```

数据库约束拒绝其他组合，Runtime 输入、Prompt、CLI 参数或 terminal payload 不能覆盖冻结路由。

`single_chat_v1` 是 Core 内固定闭合 allowlist：

```text
camp.search          current Camp only
camp.read            current Camp only
single_chat.history  current active Single Chat only
```

所有其他 Rovai Built-in operation 返回 `single_chat.operation_denied`，包括 `rovai send`、Gather、Rovai A2A、Member
mutation/scheduling、Task、Memory、跨 Camp History 和未来未列出 operation。`camp.search/read` 的 Camp 参数必须等于冻结
Camp，否则返回 `single_chat.cross_camp_denied`。Prompt 不是授权边界。

## 8. Context、History 与公共水位

Single Chat Native Session Bootstrap 固定只包含：

```text
[SESSION_CHARTER]
[MEMBER_IDENTITY]
```

不调用 Memory Entrypoint builder；`observed_memory_revisions=[]`，不写 `memory_access_evidence`，空 evidence payload 不渲染
`[MEMORY_ENTRYPOINT]`。Dynamic Context 顺序为 optional Collaboration/Shared Conversation、required Run Facts、required
Single Chat Guidance、最后的 Current Input；不得投影 Self Active Tasks 或 A2A Guidance。

Skill exposure 在写 ContextManifest 和交给 Adapter 前，按 official bundled source identity 排除 `cli-operations` 与
`memory-stewardship`；不得按显示名、描述或数据库 ID 判断，Manifest 与 Runtime 必须使用同一过滤后 snapshot/digest。

`single_chat.history` 不接受 conversation/camp/agent id，由已认证当前 Run 的冻结 destination 反向解析，并把读取上界 clamp
到当前触发 user message 之前。分页只返回当前 Conversation 的 `sequence/role/body/attachments`；附件字段与 `camp.read`
一致，为 `attachmentId/name/kind/fileCount/mediaType/byteSize`，
不返回 source/runtime path、不复制文件、不自动注入当前 Run。若需要重新读取旧附件内容，用户必须重新附加。

每次直接准入或 Pending 发布都冻结 public boundary；Shared Conversation 只读取该 Conversation 自上次 accepted watermark
以来有权读取的公共增量。只有 Runtime Input Delivery accepted ACK 推进该水位；prepared、delivery unknown、取消或未
accepted 不消费水位，也不改变普通 `camp_member` Conversation 的水位。

## 9. 私有 final、停止、重启与结束

Runtime stream 与 terminal 回调先按可信进程/Binding 鉴权，再按 `agentRunId + executionEpoch + conversationId +
nativeBindingId + nativeBindingGeneration` 复核冻结 route。成功 terminal transaction 向 destination 追加恰好一条 agent
ConversationMessage，设置 `final_conversation_message_id` 并保持 `final_camp_message_id=null`；不得创建 CampMessage、执行
Missing-Send Recovery、发送 Channel 或推进公共投影。

用户停止当前回复沿用 `agentRuns.cancel`：Run 为 `cancelled`，Conversation 仍 active，Pending 等到其空闲后继续发布。
App、Core 或 Runtime Host 重启命中的非终态 Single Chat Run使用相同取消结算，不恢复旧 Native Turn、不重发输入，也不
增加重启原因产品状态。

`singleChat.end` 是线性化点：Conversation 变为 ended，拒绝新 send，当前 Run 取消，Draft/edit 清除，未发布 Pending
取消，私有 route 立即关闭。迟到 delta/final/tool result/ACK/provider completion 只能成为旧 Run 证据或 cleanup 回执，
不得写旧或 successor transcript。用户可立即创建同一队员的新 Single Chat；不增加跨 Conversation cleanup fence。

## 10. Renderer 最低呈现合同

`SingleChatSnapshot` 包含 typed `conversation/messages/draft/pendingInputs/agentRuns/executionEvidence`。Renderer 不能从
Camp 公屏或 Runtime 文案重建私有 transcript。用户正文和附件居右；队员回复居左、无头像和消息底色框。执行过程复用
执行台 narration/plan/command/tool 分组，terminal 后自动折叠，final 始终在独立分隔线下展开；成功为“工作了 {duration}”，
取消为“你在 {duration}后停止了运行”。

Composer 复用 Camp 输入面的附件入口、AttachmentCard、“↵ 发送 · ⇧↵ 换行”提示和发送按钮；`Enter` 发送、
`Shift+Enter` 换行，IME 合成期间不提交。active Run 时空 Composer 的主要动作是“停止”；一旦有正文或附件，主要动作
仍为“发送”并创建 Pending。队列展示顺序、`needs_repair` 原因及编辑/删除入口，编辑中可增删和重排公共附件卡片。
完整组件规范见 [Camp 内单聊](../ui/components/conversation-workspace.md#camp-内单聊)。

稳定拒绝码至少包括：

```text
single_chat.local_user_required
single_chat.camp_mismatch
single_chat.member_unavailable
single_chat.not_active
single_chat.version_conflict
single_chat.draft_changed
single_chat.empty_message
single_chat.runtime_not_ready
single_chat.pending_input_changed
single_chat.pending_input_not_found
single_chat.pending_input_not_ready
single_chat.pending_input_edit_open
single_chat.pending_input_edit_fenced
single_chat.operation_denied
single_chat.cross_camp_denied
single_chat.history_unavailable
```
