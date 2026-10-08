---
document_type: architecture
architecture: single-chat
authority: single-chat-component-boundaries-and-data-flow
last_updated: 2026-10-08
---

# Single Chat Architecture

Single Chat 是现有执行基础设施上的一种私有 Conversation 模式。字段级合同见
[Single Chat v8](../contracts/single-chat-v8.md)，当前选择理由见
[V1.50-D01](../versions/v1.50/decisions.md#v1-50-d01)至
[V1.50-D04](../versions/v1.50/decisions.md#v1-50-d04)及
[V1.58-D06](../versions/v1.58/decisions.md#v1-58-d06)。

## 组件职责

| 组件 | 拥有 | 不拥有 |
| --- | --- | --- |
| Desktop Renderer | active 会话选择、私有 transcript、Composer Draft 交互、Conversation-local 排队编辑、执行折叠、停止与结束意图 | 权限、原始附件路径、路由、恢复推断、公共水位 |
| Desktop Main / Preload | Single Chat Core method allowlist、公共附件选择/预览/打开/Reveal bridge 和事件转发 | 业务状态、附件内容仓库、目标选择、私有输出生成 |
| `SingleChatService` | Conversation 生命周期、原子 open/send/end、附件 Draft revision、Pending FIFO、Snapshot/History | Runtime process、Prompt 执行、公共投影 |
| Source Attachment 基础设施 | `LocalAttachmentSourceRef` 观察/清洗/重检、owner 精确读取、原路径投影与公共 AttachmentCard 能力 | Source 永久可用性、Single Chat transcript、队列顺序 |
| Context builder | 无 Memory 的专用 Bootstrap、专用 Charter/Guidance、过滤后 Skill exposure、私有水位上的公共增量和公共 resolved attachment paths | transcript 自动重放、连续性解释、异步唤醒、授权替代 |
| Built-in Router | 冻结 `single_chat_v1` policy version；v2 的五项只读 allowlist、当前 Camp scope 与当前单聊历史反向解析 | Runtime 原生 delegation、通用 Capability DSL、Mission mutation |
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

提交后通知 / Runtime 条件解除 / 启动对账
  → 重读数据库，发现该 Conversation 空闲
  → 选择 FIFO 队首
  → 重检 Source Refs、成员和 Runtime readiness
      ├── 成功：原子创建私有 Message/Turn/Run，Pending → published
      └── 失败：队首 → needs_repair，阻塞同 Conversation 后项
  → 用户可移回普通输入框修复（释放队列位置）或删除
```

发送命令以固定 Conversation ID 为目标，不接收 expected Conversation version。`SingleChatService` 在同一事务内读取当前
Conversation 状态并决定直接准入或 Pending 入队；后台 ACK、final 等对 Conversation version 的推进不构成用户输入冲突，
只有独立的 Draft revision 继续保护附件 Draft 的精确消费。

队列以 `conversation_id + enqueue_sequence` 定序。Camp 公屏队列、其他 Single Chat、同一队员的 successor Conversation
和普通 Scheduler capacity 都不共享这个顺序域。Pending 尚未发布时不占用 ConversationMessage sequence，不创建
CampTurn/AgentRun，也不推进 Conversation version。

正常发送、Pending 编辑／移除／发布、前一 Run 终态提交、Runtime readiness 与 cleanup 变化主动通知
non-batch 推进者。通知各自保留一个合并许可，读取状态与进入等待之间的提交不会丢失；通知不代替准入。
准备期间收到的变化通知同时标记当时的 in-flight Run；本轮扫描跳过它们后，准备完成仍补一次重验。
重复通知合并；没有新通知且准备未推进时继续等待，准备结果读取失败仍走原退避。
事务提交后即通知，文本收尾等后续失败不能吞掉提示。`needs_repair` 等待用户，readiness 等待状态变化；
只有暂时读取／准备失败或既有 cleanup 等待期限安排一次性重试，不以周期扫描维持 FIFO。
启动对账仍区分旧 Run 恢复与未发布 Pending，不重发旧回复或已接受输入。

新 Single Chat 的直接发送和 Pending 发布通过公共预算入口冻结 `schemaVersion: 2`、`elapsedSeconds: null`、
`deadlineAt: null`，默认没有总时长上限，也不为这些执行安排预算闹钟。数量限制、手动停止、权限与恢复隔离
仍生效；旧执行继续按已冻结预算收尾，不批量迁移。有限预算及字段规则见
[Execution Evaluation v15](../contracts/execution-evaluation-v15.md#case-与-core-冻结证据)。

## Runtime 与附件数据流

```text
AgentRun.trigger_conversation_message_id
  → exact conversation/invocation/author/route fence
  → conversation_message.source_attachments_json
  → Vec<LocalAttachmentSourceRef>
  → resolve_source_attachments_for_run
      → spawn_blocking 中重检 exists / host-readable / kind
      → 返回完全相同的 stored source_path
  → materialize_with_exposures_and_source_attachments
  → CURRENT_INPUT.attachments
  → 所有 Runtime Adapter 接收同一份 source paths
```

Single Chat 不拥有附件内容根、copy receipt、retention worker 或专用 Runtime projection。Source Ref 是 weakly durable：
选择、发送和 dispatch 分别按公共规则观察或重检；原文件移动、删除、失去权限或改变类型时诚实失败，内容后来变化则读取
执行时实际内容。dispatch 不 canonicalize、不按 execution root 分流、不预扫目录子项，也不复制到通用 Run Temp。
宿主重检不保证 Runtime 可读；Agent 按现有权限访问，原生工具按实际访问结果报告错误，不增加 preflight 或 fallback。

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

新 Single Chat Run 冻结 operation policy version 2：除现有 `camp.search`、`camp.read` 与
`single_chat.history` 外，只增加全局只读 `mission.list/get`。Mission read 不切换当前 Camp/Mission，也不取得
写权限。历史 version 1 Run 保留原三项 allowlist；terminal/history 路径接受两种已知冻结版本，未知版本
fail closed。Charter revision 9 引入该入口；当前 revision 10 不改变 Single Chat Charter 正文，只轮换共享
Binding compatibility。完整 `cli-operations` Skill 仍从 Single Chat exposure 排除。

## 输出与迟到事件

`responseDelivery` 是 Run 创建时冻结的 terminal route，不从模型正文、是否调用 `rovai send` 或当前 UI surface 推断。
所有 Runtime 回调先绑定具体 Run/epoch 和已认证 Native Binding，再解析 destination Conversation。Conversation ended、Run
cancelled、epoch 过期、Binding generation 不匹配或 route 不完整时，回调只能进入旧执行/清理证据，不得转投当前同 Agent
的另一个 Conversation。

Renderer 只读取 SingleChatSnapshot 中的私有 Messages、Pending 与精确 Run Evidence。运行时沿用执行台的 narration、plan、
tool 与 command 分组；终态自动折叠过程而不是删除 Evidence，final message 保持可读。用户历史附件和 Composer/Pending
附件都由清洗后的 View 加精确 owner locator 呈现。
Snapshot 的 Run 同时携带 `executionEvidenceChangeSequence`；执行窗口按独立 change cursor 合并原位更新，不能把
`executionEvidenceCount` 当作 revision。私有 thought/reasoning 正文在 Renderer state 前丢弃，只保留 content-free phase。

Panel 打开或切换对象时由 Renderer 唯一决定 target、清空旧 Snapshot 并管理 loading；一个 target request
sequence 同时校验当前队员，阻止迟到结果跨目标写回。后台 `refreshList` 只更新 active Conversation 列表和
运行标记；`refreshCurrent` 只读当前完整 Snapshot，以一个 in-flight 标记串行化同一目标的读取，期间重复刷新合并为完成后
的一次补读。Mutation 返回的 Snapshot 可立即呈现，但仍通过同一补读入口确保修改前的在途读取不会成为最后结果。
这些后台读取不切换目标、不清空 Snapshot，也不修改 loading。空闲时无计时器；运行期约每 800ms 只读当前 Conversation，
Panel 收起、Camp 离开或组件卸载使旧 target request 失效并停止刷新。

## 取消、结束与并发

启动协调在普通 AgentRun recovery 分类前先把非终态 Single Chat Run 交给既有 abortive cancellation。该规则只结束当前
回复，不结束 Conversation，也不恢复旧 Native Turn。用户结束只指定 `campId + conversationId`，不提供 expected version 或 active
Run ID。`SingleChatService` 在 Command Gateway 的同一事务内读取 exact Conversation 当前状态：active 时使用同一取消结算，
在事务提交点关闭输出路由、删除 Composer Draft 与 Pending edit session，并把未发布 Pending 标为 cancelled；已 ended 时
返回成功 no-op，不再次取消资源、推进 version 或写 ended 领域事件。所有清理都只移除 Source Ref，不删除用户原始文件。

predecessor ended 后 successor 使用全新 Conversation/Binding/Session，因此不会命中 predecessor 的 Conversation-local
队列或 cleanup fence。两个 Runtime cleanup/dispatch 可以短暂重叠；底层无法并发时由现有 Scheduler/Fleet 表达 readiness
或 failure，不在 Single Chat 领域中引入跨 Conversation 等待状态。

## 待发送消息移回输入框

Desktop 使用 [Single Chat v5](../contracts/single-chat-v5.md) 的双 revision 事务，将 canonical Pending refs/quotes
覆盖到普通 Draft 并取消队列项；正文由成功回执进入该 Conversation 的窗口内草稿。编辑不再占 FIFO 位置，
重新发送进入当前队尾。旧 session API 只保留兼容边界，界面不创建独立编辑器。
