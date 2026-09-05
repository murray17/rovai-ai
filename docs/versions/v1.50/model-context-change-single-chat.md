---
document_type: model-context-change
version: v1.50
change_id: single-chat-private-context
revision: 2
confirmation_status: confirmed
confirmed_revision: 2
confirmed_by: murray.xue
confirmed_at: 2026-09-05
authority: confirmed-model-input-change-statement
implementation_baseline: 6f8c99e0842a3c385a33c06a58320abf9eb8fa3b
implementation_status: implemented
acceptance_status: verified
last_updated: 2026-09-05
---

# v1.50 核心模型上下文变更：Single Chat 私有输入

本说明冻结开发者确认的 revision 2：Single Chat 复用现有 ContextManifest、Runtime Input Delivery 与 Adapter transport，
但使用无 Memory 的专用 Bootstrap、专用 Dynamic Context、过滤后的 Skill exposure 和私有 ConversationMessage 输入；
附件路径由公共 Source Attachment resolver 在 dispatch 时解析。

## 变更前

`main@6f8c99e0842a3c385a33c06a58320abf9eb8fa3b` 不接受 `invocation_kind=single_chat`。普通 Camp Member Run 使用
`camp_member` Conversation、CampMessage trigger 和公开 terminal route；Native Session Bootstrap 包含：

```text
[SESSION_CHARTER]
[MEMBER_IDENTITY]
[MEMORY_ENTRYPOINT]
```

Dynamic Context 按普通 Camp invocation 选择 Collaboration、Shared Conversation、Self Active Tasks、A2A Guidance、
Run Facts 与 Current Input。用户 Source Attachment 只从 trigger CampMessage 读取，并由公共 resolver 写入
`CURRENT_INPUT.attachments`。

## 变更后

### Bootstrap

`AgentRun.invocation_kind=single_chat` 使用独立 Native Binding/Session。首次投递或 compaction redelivery 的 Bootstrap
只格式化：

```text
[SESSION_CHARTER]
<Single Chat Charter>
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
<same six-field Member Identity projection>
[/MEMBER_IDENTITY]
```

该分支不调用 `build_memory_entrypoint`，`observed_memory_revisions=[]`，不写 `memory_access_evidence`。现有 Bootstrap
Evidence 可以保存 canonical empty memory payload/digest，但 formatter 不渲染空 `[MEMORY_ENTRYPOINT]`。普通 Camp
Bootstrap 的三段结构不变。

### Dynamic Context

Single Chat 每轮按以下顺序选择并以 Current Input 结尾：

```text
[COLLABORATION_STATE]   optional
[SHARED_CONVERSATION]  optional
[RUN_FACTS]            required
[SINGLE_CHAT_GUIDANCE] required
[CURRENT_INPUT]        required and last
```

不投递 `[SELF_ACTIVE_TASKS]` 或 `[A2A_GUIDANCE]`。Shared Conversation 只包含该 Single Chat accepted public watermark
之后到本轮冻结边界内的授权 Camp 公共增量，并允许目标 Agent 自己的公共输出；私有 transcript 不自动 replay。

当前用户输入只来自 `agent_run.trigger_conversation_message_id` 对应的 user ConversationMessage。Single Chat 不存在
originating public user message；其 `trigger_message_delivery_id/a2a_parent_agent_run_id/a2a_root_agent_run_id` 必须为空且
`a2a_depth=0`，否则 materialization fail closed。

### Skills 与 Built-ins

Member Skill exposure 沿用当前投影，但在写 ContextManifest、计算 digest 和交给 Runtime Adapter 之前，按 official
bundled stable source identity 排除：

```text
rovai://bundled/cli-operations
rovai://bundled/memory-stewardship
```

其他 Skills 与 MCP projection 不变。模型能调用的 Rovai Built-ins 由 Core 的 `single_chat_v1` 固定 allowlist 再次约束，
只有当前 Camp 的 `camp.search/camp.read` 与当前冻结 destination 的 `single_chat.history`；Prompt 不构成授权边界。

### 当前输入附件

Single Chat dispatch 从 trigger user ConversationMessage 的 `source_attachments_json` 读取与 Camp 相同的
`LocalAttachmentSourceRef[]`，在 exact Run/Conversation/route fence 后调用公共 resolver：

```text
execution root 内 source path
  → direct resolved path

execution root 外 source path
  → ROVAI_RUN_TMP/source-attachments/<ref>/...
  → run-local resolved path
```

同一 ordered resolved paths 进入所有 Runtime Adapter，并由现有 formatter 写入：

```json
{
  "source": { "type": "user" },
  "message": "用户正文",
  "mentionsCurrentUser": false,
  "attachments": ["/resolved/path"]
}
```

历史 Single Chat 附件不自动注入当前 Run；`single_chat.history` 只返回清洗后的元数据。Source 不可用时 dispatch 在模型
调用前失败，不降级为无附件输入。

## 明确不变

- 当前 ContextManifest、Context Formatter、Context Delivery Profile、Run Facts 和 Bootstrap formatter 的版本号；
- 普通 Camp Member、A2A、Gather 与 Automation 的 Context section、Memory 和 Skill projection；
- ContextManifest 对 exact rendered bytes、selection、omission、digest 与 attachment refs 的证据；
- accepted Runtime Input ACK 作为 Conversation public watermark 的唯一推进点；
- ACP、Pi 与其他 Runtime Adapter 的既有 transport，Pi 图片仍由公共 Source Attachment 图片准备链提供；
- Runtime 原生 delegation、sub-agent、内部模型调用和 Provider 工具不属于 Single Chat capability 合同。

## 恢复与失效

App、Core 或 Runtime Host 重启时，非终态 Single Chat Run 使用既有 abortive cancellation，不恢复或重发旧 Native Turn。
Conversation 未显式结束则仍 active，下一条直接或 Pending 输入创建新 Run。用户结束后旧 route 立即关闭；迟到 delivery
ACK 或 final 不能推进旧/新 Conversation 水位或写入 successor transcript。

## 二次确认

开发者在 2026-09-05 明确确认 Single Chat 当前输入来源、无 Memory Bootstrap、两个 official bundled Skill 的排除、
Built-in allowlist、重启取消和结束后的迟到事件 fence，并进一步确认附件全量复用主线 Source Ref/Runtime resolver、排队
输入同样携带附件。本 revision 2 取代最初允许 Memory/Task 读取的草案，并且不包含随后误发且已要求忽略的
Automation 规则。

## 验证

验证由 Context/Single Chat Rust 回归覆盖 Bootstrap section、A2A lineage fail-closed、Skill exposure digest、公共水位、
Source Ref Run loader、resolved attachment paths、private final 与迟到 fence；TypeScript/Renderer fixture 验证 Snapshot、
AttachmentCard 和排队交互，完整门禁结果写回 [实施计划](implementation-plan.md)。
