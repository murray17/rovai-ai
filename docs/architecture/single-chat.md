---
document_type: architecture
architecture: single-chat
authority: single-chat-component-boundaries-and-data-flow
last_updated: 2026-09-05
---

# Single Chat Architecture

Single Chat 是现有执行基础设施上的一种私有 Conversation 模式。字段级合同见
[Single Chat v1](../contracts/single-chat-v1.md)，当前选择理由见
[V1.50-D01](../versions/v1.50/decisions.md#v1-50-d01)至
[V1.50-D04](../versions/v1.50/decisions.md#v1-50-d04)。

## 组件职责

| 组件 | 拥有 | 不拥有 |
| --- | --- | --- |
| Desktop Renderer | active 会话选择、私有 transcript、Composer Draft 交互、Conversation-local 排队编辑、执行折叠、停止与结束意图 | 权限、原始附件路径、路由、恢复推断、公共水位 |
| Desktop Main / Preload | Single Chat Core method allowlist、公共附件选择/预览/打开/Reveal bridge 和事件转发 | 业务状态、附件内容仓库、目标选择、私有输出生成 |
| `SingleChatService` | Conversation 生命周期、原子 open/send/end、附件 Draft revision、Pending FIFO、Snapshot/History | Runtime process、Prompt 执行、公共投影 |
| Source Attachment 基础设施 | `LocalAttachmentSourceRef` 观察/清洗/重检、owner 精确读取、Run-local 解析与公共 AttachmentCard 能力 | Source 永久可用性、Single Chat transcript、队列顺序 |
| Context builder | 无 Memory 的专用 Bootstrap、专用 Charter/Guidance、过滤后 Skill exposure、私有水位上的公共增量和公共 resolved attachment paths | transcript 自动重放、连续性解释、异步唤醒、授权替代 |
| Built-in Router | `single_chat_v1` 固定三项 allowlist、当前 Camp scope 与当前单聊历史反向解析 | Runtime 原生 delegation、通用 Capability DSL |
| Runtime terminal service | 冻结 route 复核、恰好一条私有 final、迟到事件 fence | Renderer 展示、队列编辑 |
| Existing Scheduler/Fleet | 普通 capacity/readiness、dispatch、Binding、cleanup 和空闲 Conversation 的 Pending 发布 | Single Chat 专用回复槽、跨 Conversation cleanup fence |

## 直接发送与排队数据流

```text
用户选择、粘贴或拖入附件
  → observe_source_attachment
  → ordered LocalAttachmentSourceRef[]
  → single_chat_composer_draft(revision)

Renderer singleChat.send(body, draftRevision)
  → SingleChatService transaction
      ├── Conversation 无 active Run 且无 Pending
      │     → user conversation_message + Source Refs
      │     → CampTurn(kind=single_chat)
      │     → AgentRun(invocation=single_chat, private route, fixed policy)
      │     → 清空 Draft，并推进 Draft/Conversation revision
      └── Conversation 有 active Run 或 Pending
            → single_chat_pending_input + Source Refs
            → 清空 Draft，并仅推进 Draft revision

Scheduler 发现该 Conversation 空闲
  → 选择 FIFO 队首
  → 重检 Source Refs、成员和 Runtime readiness
      ├── 成功：原子创建私有 Message/Turn/Run，Pending → published
      └── 失败：队首 → needs_repair，阻塞同 Conversation 后项
  → 用户可独占编辑、takeover、增删/重排附件、保存或删除
```

队列以 `conversation_id + enqueue_sequence` 定序。Camp 公屏队列、其他 Single Chat、同一队员的 successor Conversation
和普通 Scheduler capacity 都不共享这个顺序域。Pending 尚未发布时不占用 ConversationMessage sequence，不创建
CampTurn/AgentRun，也不推进 Conversation version。

## Runtime 与附件数据流

```text
AgentRun.trigger_conversation_message_id
  → exact conversation/invocation/author/route fence
  → conversation_message.source_attachments_json
  → Vec<LocalAttachmentSourceRef>
  → resolve_source_attachments_for_run
      ├── executionRoot 内：使用原路径
      └── executionRoot 外：复制到 ROVAI_RUN_TMP/source-attachments
  → materialize_with_exposures_and_source_attachments
  → CURRENT_INPUT.attachments
  → 所有 Runtime Adapter 接收同一份 resolved paths
```

Single Chat 不拥有附件内容根、copy receipt、retention worker 或专用 Runtime projection。Source Ref 是 weakly durable：
选择、发送和 dispatch 分别按公共规则观察或重检；原文件移动、删除、失去权限或改变类型时诚实失败，内容后来变化则读取
执行时实际内容。只有 execution root 外的来源在本轮 dispatch 时复制到通用 Run Temp，并由通用 cleanup 回收。

`LocalAttachmentOwnerLocator` 用四类 Single Chat owner 精确恢复 Source Ref：Composer、Pending canonical、Pending edit
working copy 和已发送 Message。每次读取都校验 Camp、Conversation kind、Message/Pending 所属关系和 attachment ref id；
Renderer 通过公共 `AttachmentCard`、Preview、Open、Reveal 与 FilePreview 使用这些 owner，不接收 `source_path` 或 Runtime
临时路径。

## Context 分支

普通 `camp_member` Conversation 与 Single Chat 使用独立 Native Binding 和 accepted public watermark。Context builder
在同一 Manifest/Delivery 管线内根据 invocation 分支：Single Chat Bootstrap 只渲染 Charter 与 Member Identity，不调用
Memory Entrypoint；Dynamic Context 选择专用 Charter/Guidance，排除 Self Active Tasks 与 A2A Guidance，并允许目标 Agent
自己的公屏输出进入新增公共窗口。Member Skill exposure 仍沿用既有投影，但在 Manifest 与 Adapter 共用的 snapshot/digest
形成前按 official bundled source identity 排除 `cli-operations` 与 `memory-stewardship`；其余 Skills 和 MCP projection
保持既有路径。Manifest 仍记录 exact bytes、digest、selection 与 omission；accepted ACK 仍是唯一水位推进点。

模型不接收 Native Session 连续性或替换原因，也不接收自动私有 transcript replay。需要但缺少此前私聊正文时，Runtime
通过始终可用的 `single_chat.history` 请求 Core；Router 只从已认证当前 Run 解析 active destination，并把读取上界锁在
`CURRENT_INPUT` 之前。History 的附件只提供清洗后的名称、类型、大小和 ref id 等元数据，不把旧附件自动注入当前 Run。

## 输出与迟到事件

`responseDelivery` 是 Run 创建时冻结的 terminal route，不从模型正文、是否调用 `rovai send` 或当前 UI surface 推断。
所有 Runtime 回调先绑定具体 Run/epoch 和已认证 Native Binding，再解析 destination Conversation。Conversation ended、Run
cancelled、epoch 过期、Binding generation 不匹配或 route 不完整时，回调只能进入旧执行/清理证据，不得转投当前同 Agent
的另一个 Conversation。

Renderer 只读取 SingleChatSnapshot 中的私有 Messages、Pending 与精确 Run Evidence。运行时沿用执行台的 narration、plan、
tool 与 command 分组；终态自动折叠过程而不是删除 Evidence，final message 保持可读。用户历史附件和 Composer/Pending
附件都由清洗后的 View 加精确 owner locator 呈现。

## 取消、结束与并发

启动协调在普通 AgentRun recovery 分类前先把非终态 Single Chat Run 交给既有 abortive cancellation。该规则只结束当前
回复，不结束 Conversation，也不恢复旧 Native Turn。用户结束 Conversation 时使用同一取消结算，在事务提交点关闭
输出路由、删除 Composer Draft 与 Pending edit session，并把未发布 Pending 标为 cancelled；所有操作都只移除 Source Ref，
不删除用户原始文件。

predecessor ended 后 successor 使用全新 Conversation/Binding/Session，因此不会命中 predecessor 的 Conversation-local
队列或 cleanup fence。两个 Runtime cleanup/dispatch 可以短暂重叠；底层无法并发时由现有 Scheduler/Fleet 表达 readiness
或 failure，不在 Single Chat 领域中引入跨 Conversation 等待状态。
