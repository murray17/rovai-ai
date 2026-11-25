---
document_type: implementation-proposal
version: v1.72
authority: proposed-chat-backend
status: proposed
revision: 14
last_updated: 2026-11-25
---

# 聊天后端提案

**一段独立聊天就是一条 `conversation`，`chatId = conversation.id`。** 从左栏选人只打开草稿，首次发送成功才有聊天记录。用户明确要求「新建一个团队会话」时，队员才调用 `rovai thread create` 创建公开 Thread。

本稿基于 `b1c20641a` 的七节修订稿，代码基线为 v1.72 的 Core `a181754bc8`。独立聊天只新增 `chat_topic` 一张业务表。排队和插话（Steer）共用现有输入记录，跨 Thread 操作沿用工具请求、命令回执和公开投递状态。

## 1. 数据归属

| 数据 | 存储与约束 |
| --- | --- |
| 聊天身份 | `conversation.kind='chat'` 要求 `camp_id IS NULL`，`agent_id` 固定为所选队员。每个话题用自己的 `native_binding_id` 和绑定代次。同一用户与同一队员可以开多个话题。 |
| 左栏话题 | `chat_topic.conversation_id` 同时是主键和指向 `conversation.id` 的外键，只接收 `chat`。其余字段为 `owner_user_id`、`title`、`archived_at`、`last_activity_global_sequence`、`version`，永久删除受理时记录 `deletion_operation_id`。队员和头像经 Conversation 查 `agent_profile`。 |
| 用户消息和最终答复 | `conversation_message` 按 `(conversation_id, sequence)` 排序。用户消息可带引用和附件。Core 把队员最终答复的正文写回 Run 的目的 Conversation。`rovai send` 用于显式发布到公开 Thread。 |
| 执行过程 | `agent_run` 直接引用 `conversation_id` 和 `trigger_conversation_message_id`。聊天 Run 的 `camp_id`、`camp_turn_id` 均为空。`agent_run_execution_evidence` 保存工具调用、进度、输出和插话的位置，按 Run 与 `execution_epoch` 读取。 |
| 忙时输入 | `single_chat_pending_input` 保存 FIFO 输入和指向原 Run 的插话。只有 FIFO 可以开启下一轮。运行端的接收凭据保存在 `runtime_input_delivery`。 |
| 公开业务结果 | `event_log` 的 `command.result` 关联已有工具请求与结果。任务读 `task`，消息和逐收件人投递读 `camp_message`、`camp_message_delivery`。 |

私下问答的整个过程，包括首发、排队、插话和最终回复，对 `camp`、`camp_member`、`camp_turn` 均为零写入。工作目录按 `chatId` 管理，引用 Thread 只定位业务对象。置顶与已读沿用本机偏好，以聊天类型保存 ID。

Desktop 和已认证的 Web 共用 Core 的用户入口，由 Core 确定当前用户 `local_user`，首发时写入 `chat_topic.owner_user_id`。用户侧接口共用按此身份限定范围的话题查询。列表、搜索和归档列表在该范围内筛选，单项读写再按 `chatId` 定位，写操作在事务内取得目标。队员工具从有效 Run 确定来源话题，见 §4、§5。[当前用户身份](../../contracts/current-user-attention-v1.md#1-sole-current-user-identity)

## 2. 首发、排队与插话

**首发。** 选人只读队员资料。本机按用户与队员保存未发送草稿，同一份草稿跨窗口共用 `draftId`。首发校验队员、引用和附件，在事务内建立 `conversation`，沿用 `resolve_frozen_runtime` 核对运行端配置、授权和就绪状态。运行端未就绪就回滚并返回具体原因，草稿保留在本机。校验通过才一并提交 Conversation、`chat_topic`、首条 `conversation_message`、首个 `agent_run` 和成功回执。[现有发送准入](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/single_chat.rs#L715-L744)

标题取首句，最多 20 个用户可见字符。用户首条消息只有附件时取首个文件名，只有引用时取引用标题。此后由用户按话题版本手动改名。续聊沿用原 ID，另起话题用新草稿，成功首发时才分配新 ID。

**首发去重。** Host 按认证用户和请求中的 `draftId` 稳定派生首发 `commandId`。回执以 `commandId` 查找，保存发送内容摘要和结果，省去明文 `draftId` 副本。Core 用 `canonical_json_digest` 计算队员、正文、引用及有序附件标识的摘要。事务前快速查询和取得写锁后的再次查询共用身份、作用域及摘要校验。摘要相同返回原三个 ID，摘要不同返回冲突并保留后提交窗口的输入。已有成功回执优先于运行端就绪检查重放。可修正的拒绝回滚并直接返回，去重键留给该草稿下次首发。成功时客户端只清除已发送的草稿版本。[网关的两次查重](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/command.rs#L249-L305) · [现有重放比较](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/command.rs#L452-L482)

`chats.send` 首发传 `draftId, agentId`，续聊传 `chatId`。`mode=start` 在空闲且无更早排队项时开一轮，忙时对应「排队发送」。`mode=steer` 对应「插话」，须带用户当前看到的 `runId, executionEpoch`。Core 在写事务核对这是该话题的活动 Run，且代次一致。命令重放须匹配最初的模式、目标及内容摘要。受理前若目标已变化或不支持插话，返回具体原因，输入留在输入框，供用户选择排队。

| `chats.send` 返回 | 用户看到的结果 |
| --- | --- |
| `started {chatId, messageId, runId}` | 已开启新一轮。首发另带标题。 |
| `queued {chatId, inputId}` | 输入出现在输入框上方的排队列表，标「排队中」。轮到它时才发表为下一轮的首条用户消息，并创建 Run。 |
| `steer_submitted {chatId, inputId, runId, executionEpoch, evidenceSequence}` | 提交成功即在原轮的 `evidenceSequence` 位置显示一条普通用户消息。正常提交和签收都不带状态文字。仅 `delivery_unknown` 在消息下显示一行「未确认送达」。 |

排队列表按提交顺序排列。直接入队标「排队中」，由插话转入标「已转为排队」，两种都可编辑、可删除。`chats.pendingInputs.edit` 按 `chatId, inputId` 复用现有队列操作，在事务内核对版本和未派发状态。编辑将正文、附件和引用移回输入框，释放原队位，用户重新发送时按当时的队列顺序处理。删除只撤掉所选输入。若队首已发表，刷新到对应轮次。[现有排队编辑合同](../../contracts/single-chat-v5.md)

## 3. 没有 Camp 和 Turn 的运行链路

从投影 schema 182 迁移，复制旧记录并重建受影响的约束、索引和触发器。旧队列记录的 `requested_mode` 回填为 `start`，插话目标字段留空。会话内单聊继续使用活动 Camp、成员、Turn 和冻结的 `single_chat_v1` 策略。

| 环节 | 需要调整的现有依赖 |
| --- | --- |
| Conversation 与 Run | `conversation.camp_id` 仅在 `kind='chat'` 时为空。聊天 `agent_run` 固定 `invocation_kind='chat'`、`operation_policy='chat_v1'`、`response_delivery='conversation_message'`、`destination_conversation_id=conversation_id`。触发消息属于该话题，两个 Camp 引用均为空。每个聊天 Conversation 至多一个 `queued/running/waiting` Run。保留旧类型的唯一索引、原生绑定和路由不可变约束。 |
| 首发、直接发表与 FIFO | 从 `admit_single_chat_message` 拆出共同的消息序号和 Run 写入。`load_active_target`、`single_chat_has_active_run` 识别聊天，`build_effective_config` 从 `agent_profile` 取获准配置。`single_chat_pending_input_scope_insert` 校验队列项关联未归档话题。`chat` 接入现有 `source_attachments_json` 用户附件校验，携带附件的消息作者须为用户，附件引用写入后不可变。`published` 须有同话题的消息和 Run，旧单聊另须有匹配的 `published_camp_turn_id`，聊天要求为空。插入与更新均校验，未发表时三个发布引用全空。普通排队发布在同一事务建消息、新 Run 并结算队首。 |
| 扫描、领取与停止 | `ready_pending_inputs` 保留旧单聊的 `JOIN camp`，独立聊天改连 `chat_topic`。FIFO 只取 `requested_mode=start`，写锁内重查归档、活动 Run、最早序号及编辑版本，`needs_repair` 挡住本话题后项。`list_dispatchable_agent_runs_scoped`、`load_claimable_run`、`load_agent_run_execution` 和 `cancel_interrupted_single_chat_runs` 增加按 Conversation 取目标的分支。停止时核对话题、Run 和执行代次，取消执行并释放 lease。迟到输出只记入原代次的诊断。 |
| 最终答复 | 沿用现有运行端返回的 `final_output`。正文含非空白字符时，终态事务只将原文写入一条 `conversation_message` 并设置 `final_conversation_message_id`。正文为空或全为空白时只结算 Run。工具产生的文件操作留在执行记录。核对 Run、执行代次、目的地和取消状态，每轮至多发表一条最终答复。[现有终态写入](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/runtime.rs#L5273-L5288) |

**模型输入。** 首次建立原生会话时，Bootstrap 的 `SESSION_CHARTER` 介绍 Rovai AI，并请队员在当前私聊回复。随后是所选队员的系统身份提示 `MEMBER_IDENTITY` 和平台技能索引 `ROVAI_PLATFORM_SKILLS`。直发、FIFO 和插话统一使用 `CURRENT_INPUT`，随当次输入带上引用、附件或显式选择的技能。工作目录由 Host 设置。[完整 Bootstrap 示例及每轮输入](model-context-change-independent-chat.md#新建原生会话)

**插话提交与定位。** `single_chat_pending_input` 增加 `requested_mode` 和原目标 Run／代次。Core 在受理事务里写入私有输入，并在目标 `agent_run_execution_evidence` 中登记一项插话。该项以 `inputId` 稳定定位，沿用执行记录分配的固定 `sequence`，即接口的 `evidenceSequence`。相同请求重放返回原项和原序号。提交后即可显示，正文、附件及引用取自原输入。进入送达未知、签收或转队时，通过原项的 `change_sequence` 刷新视图，定位用的 `sequence` 不变。

`active_input_availability` 为 `chat` 复用冻结的适配器、协议、版本和绑定检查。`canSteer` 允许登记输入，`ready` 还须同一绑定及代次的初始输入已接收。启动中的绑定按既有预计代次等待，实际投递前再验原目标，每条插话按提交顺序单独投递。私有路径对 `camp_message` 和 `camp_message_delivery` 均为零写入。

公开插话的 `context_manifest.source_delivery_id` 引用公开 Delivery。同表增加互斥的私有 `source_chat_input_id`，外键指向上述输入。两种来源都为空才是初始 Manifest，每个私有来源只能建立一个插话 Manifest。同步修改部分唯一索引、来源不可变守卫、输入构造器和 `input_kind` 判定。投递复用 `runtime_input_delivery(input_kind='steer', input_sequence)` 的准备、发出及接收回执。受理后冻结输入，只有尚待 FIFO 发表的输入可以编辑。私有输入直接提供正文及附件，绕开 `agent_run_input` 对公开消息和 Delivery 的外键。模型输入与 Manifest 的版本调整按现有流程记录。[插话资格与结算](../../../crates/rovai-core/src/steer.rs) · [来源约束](../../../crates/rovai-core/src/db_steer.rs) · [模型上下文变更](../../development/model-context-change-governance.md)

**签收按 `inputId` 发表一次。** 正常签收与符合 `canReconcile` 的事后确证共用同一事务。Core 核对原话题、Run、代次及绑定，持写锁查询 `published_conversation_message_id`，已有结果就返回原 ID。首次确证时将 `runtime_input_delivery` 记为 `accepted`，写一条 `conversation_message` 用户消息并把原输入关联到该消息和原 Run。原轮结束后也可补记首次确证。界面沿用同一 `inputId` 和执行序号，只更新原位置的内容来源并清除可能存在的「未确认送达」。原轮的触发消息、轮次和话题排序均保持原值。[现有签收事务](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/context.rs#L2950-L2978)

`delivery_unknown` 只核对原投递，保留原位并显示「未确认送达」。已接收和结果未知的输入均不重发、不入队。只有确证未提交或 `not_accepted` 且既有规则允许回队时，才在同一事务把原输入一次性切为 `requested_mode=start`。保留 `inputId`、原 FIFO 序号及原目标 Run／代次，由此识别「已转为排队」。从此原轮不再显示该消息或用它分段，队列按原序接手，重启也只恢复这一份。[现有插话核对合同](../../contracts/message-delivery-v20.md) · [已接收输入恢复](../../contracts/accepted-input-recovery-v9.md)

**本轮怎样分段。** 在同一 Run／代次内，按插话项的固定 `sequence` 分段。比如命令甲先开始，用户插话，随后命令乙开始。甲继续运行，即使最后才结束，输出也归上段。乙和最终答复在下段。多条插话依次切分，最终答复接在最后一段。步骤按首次开始时的序号归段，完成、增量刷新和折叠均沿用这个位置。界面在分界处只显示用户消息，步骤列表跳过插话项，步骤数也不计它。[执行项的更新逻辑](../../../crates/rovai-core/src/execution_evidence.rs) · [排队表与类型触发器](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/db.rs#L26574-L26679) · [私有准入与队列恢复](../../../crates/rovai-core/src/single_chat.rs)

## 4. 历史、导航、归档与删除

**历史。** `rovai chat history` 只接受分页参数，从认证 Run、执行代次及原生绑定确定当前聊天。`rovai single-chat history` 沿用会话内单聊的 Camp、Turn 和 Run 归属校验。两入口各自确定可读的 `conversation_id` 和触发消息序号，再共用 `conversation_message` 分页及用户消息的附件、引用投影，只读触发序号之前的用户消息和最终答复。`rovai chat history` 和 `chats.open` 对队员最终答复都只返回正文。独立聊天的游标绑定话题和上界，传入 `chatId` 或跨话题游标均拒绝。运行端在原轮接收插话，后续轮次按各自的历史上界读取已签收发表的插话。用户界面的 `chats.open` 从提交时就能读到原位置和内容，见 §7。[消息查询与投影](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/single_chat.rs#L394-L469) · [旧单聊归属校验](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/single_chat.rs#L2693-L2727)

**答复里的本地文件和图片。** 独立聊天给 `MessageMarkdown` 接入 `onFileReference` 打开文件预览，`localImageContent` 读取内联图片。点击已显示的图片也走同一个预览入口。直接渲染最终消息、复用已显示的执行正文以及重开历史时，均绑定同一条最终消息。[单聊最终正文的两个渲染分支](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/apps/desktop/src/renderer/src/SingleChatPanel.tsx#L477-L485) · [现有图片读取](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/apps/desktop/src/renderer/src/SafeMarkdown.tsx#L374-L403)

现有文件预览接口增加聊天消息来源（`chatId, messageId, rawReference`）。Core 在 §1 的话题范围内核对该 `conversation_message` 是本聊天的最终答复，且原文的显式 Markdown 文件链接或图片确实指向该路径。Core 以话题自有受管目录为基准解析相对路径，按需核对当前展示的引用。路径和解析符号链接后的真实文件都在该目录内时，文件可点击预览，图片可内联显示。宿主在打开或读取时复核同一边界，对该来源关闭 `allowExternalFile`。目录外的目标（含经符号链接跳出目录的文件）只显示原路径文字，既不可点击也不读取图片内容。普通正文及代码块中的路径照原文显示。[现有公屏预览来源](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/file_preview_authority.rs#L424-L471) · [文件预览的职责划分](../../architecture/file-preview.md#组件与权威)

**导航。** `navigation.search` 在 §1 的话题范围内按 `chat_topic.archived_at IS NULL` 筛选，再连接 `conversation`、`agent_profile` 匹配标题和队员名。结果为 `kind:'chat', chatId`。`navigation.searchMessages` 继续只搜 `camp_message`。[导航搜索合同](../../contracts/navigation-search-v1.md)

`chats.list` 每行在 `chatId`、标题和队员头像等身份字段外返回以下三项。列表按活动序号降序、`chatId` 升序稳定分页，可按队员过滤。置顶沿用 §1 的本机偏好。

| 列表字段 | 来源和用途 |
| --- | --- |
| `lastActivityGlobalSequence` | 读取 `chat_topic.last_activity_global_sequence`。直接发送、FIFO 入队、插话提交、队员发表最终答复，在各自事务内写入该事件的 `event_log.global_sequence`。每次提交只推进一次，命令重放、插话签收或转队、FIFO 正式发表均不再推进。打开、展开步骤和改名不参与排序。 |
| `isProcessing` | 从本话题的 `agent_run` 判断是否有 `queued/running/waiting` 的活动轮，供侧栏显示转圈。只有尚未派发的 FIFO 时为 `false`。 |
| `lastReplySequence` | 取本话题最近一条已发表的队员最终答复的 `conversation_message.sequence`，没有答复时为 `0`。与同一 `chatId` 的本机已读消息序号比较，较大时显示未读蓝点。自己发送、排队、插话、工具进度和空正文结束均不推进这个值。 |

`chats.list` 的每次响应同时返回分页的 `items` 和完整的 `replyIndex: [{chatId, lastReplySequence}]`。两者取自同一读快照。索引只含本用户全部未归档聊天的这两个字段，包含答复序号为 0 的聊天，不受页码、游标、队员筛选或置顶分组影响。图标栏直接判断索引里是否有任意一项被本机手动标为未读，或其 `lastReplySequence` 大于该 `chatId` 的本机已读位置（初始为 0）。已归档、已删除或仅有本机草稿的聊天不在索引中。

打开应用时即读取一次列表，即使聊天面板收起也能显示总蓝点。收到 `chats.listChanged` 或重连后，用最新响应整体替换索引，丢弃迟到的旧响应。实际查看答复时，本机已读位置推进到已展示的答复序号，手动标为已读时取当前已知的最新答复序号。任一窗口修改已读偏好，立即用缓存索引重算，无需翻页或将已读位置发送给 Core。

新增 `chats.listChanged {chatId}`，只通知该聊天所属用户。提交使列表行的内容、排序、转圈或可见性改变时，Core 才发事件，包括新建、输入受理、Run 状态变化、最终答复、改名、归档、恢复或删除。客户端收到后重读受影响的行或排序窗口，重连后从 `chats.list` 补齐。回滚和命令重放不发事件，本机已读变更沿用现有偏好通知。[导航提交后刷新及本机已读规则](../../architecture/desktop-navigation-refresh.md)

**归档。** 同一事务设置 `archived_at`、取消活动 Run、关闭新输入和派发。设置页显示本用户的 `kind:'chat'` 归档项，已取消的原轮显示「已停止」。原轮里的插话仍按 §2–3 展示为普通用户消息，只有 `delivery_unknown` 在原消息下保留「未确认送达」。只有已明确转队和原本排队的未派发输入进入暂停的 FIFO。若有这些输入，提示「恢复后将继续发送排队中的消息」。手动恢复沿用原 ID、历史和草稿，只按原序唤醒该 FIFO。已取消的 Run 保持终态，已接收或送达未知的插话留在原轮。[现有归档行为](../../contracts/thread-archive-v1.md)

**永久删除按目录交接。** Core 记录删除操作 ID，封住聊天读写并隔离活动 Run。删除私有消息、Run、证据、输入、话题属性与 Conversation 的同一事务，将清理责任交给现有 `camp_attachment_view_operation`。为日志增加 `chat_delete_cleanup` 类型，归属使用 `chatId`，允许 `camp_id` 为空。每个聊天自有的受管根只登记相对路径和必要的目录身份，根内文件数量不影响登记量。话题删库后日志仍可独立恢复。[目录登记](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/camp_attachment_view.rs#L1700-L1733) · [删除交接合同](../../contracts/camp-permanent-deletion-v4.md)

重启时先接续尚未交接的删除标记，再按操作 ID 恢复未完成的目录清理。目录身份匹配就清理整棵目录，已不存在视为完成。身份不符时保留现场，按既有机制记录可恢复错误。目录内文件即使已发到其他 Thread，也随目录清理。用户指定的外部文件保留在原处。提交后按 `chatId` 清掉本机草稿。话题内的队员创建回执随话题清理，已创建的全局队员档案保留。首发回执仅留去重键与已删除状态。[按目录恢复](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/camp_attachment_view.rs#L1971-L2004) · [文件归属与生命周期](../../architecture/camp-published-attachment-view.md#归属与生命周期)

## 5. 31 项 Agent CLI 与授权

现有 30 项中开放 29 项，再加 `chat history` 和 `thread create`，共 **31 项**。`single-chat history` 专供会话内单聊。下表省略可执行文件前缀 `rovai`。[当前 CLI 目录](../../../crates/rovai-core/src/builtin_tool_transport.rs)

| 操作 | 聊天 Run 的规则 |
| --- | --- |
| `chat history` | 只读当前话题，见 §4。 |
| `thread list`、`history search` | 在用户可读的公开范围发现目标，返回稳定 ID。 |
| `thread search / read / runs` | 必传 `--thread-id`，核对读取权限、目标和子对象归属。 |
| `send` | 必传 `--thread-id`。实际发送队员须已是目标 Thread 的有效成员。这一条件同样适用于只发公屏（`--public-only`）、定向发送（`--to`）和发附件（`--file`）。定向发送还须核验收件人。`send --file` 将指定的源路径作为 `LocalAttachmentSourceRef` 写入目标消息的 `source_attachments_json`，不复制文件。[附件发布语义](../../architecture/camp-published-attachment-view.md#发布和身份) |
| `task list / get` | 必传 `--thread-id`，核对在目标 Thread 的读取权限及任务归属。 |
| `task create / update` | 必传 `--thread-id`，在写事务内复核实际队员是目标 Thread 的有效成员，再按操作核对任务、负责人、能力开关、配额和状态转换。建任务与通知负责人是两次独立操作。 |
| `member list` | 无 `--thread-id` 时只列该用户通过队员名册可见的未移除队员摘要，全局结果省略 `threadId` 和队长标记。指定公开 Thread 时须先有名册读取权，再列其有效成员及真实队长。 |
| `member get` | 无 Thread 时可读当前聊天队员，或经 `member_creation` 证明由该队员在本话题创建的档案。显式指定 Thread 时可读用户有权查看的目标成员。只投影身份字段，未知和无权目标返回相同的不可用结果。 |
| `member create` | 须有该话题内用户的直接请求和对最终队员卡的确认。用原 `creationKey` 重放，同键改内容报冲突。写全局 `agent_profile` 和现有 `member_creation` 私有来源回执，成员关系仅在另外获准的入组操作中建立。 |
| `member update` | 先按 `get` 的范围核对目标，再检查用户有权编辑且直接要求修改。只允许既有身份字段 PATCH，必传 `requestId` 与 `expectedVersion`。写事务重验目标、版本与头像来源，禁止借此修改 Runtime、权限或成员关系。 |
| `mission list / get` | 在获准范围全局发现或按使命 ID 读取。 |
| `mission update / status` | 必传 `--thread-id`，在写事务内复核实际队员是目标 Thread 的有效成员，并核对目标使命、操作权限和状态转换。 |
| `memory view / search / read / write` | 按实际执行队员授权。依赖 Thread 的记忆须传 `--thread-id`，验证成员关系及记忆可见性。 |
| `automation list / get / create / run / close / update / delete` | 沿用计划权限、版本、显式用户要求和运行配置。涉及已有 Thread 的参数须指明目标。 |
| `thread create` | 接到用户明确的新建团队会话请求后，专用授权入口核对用户创建资格，复用 `create_camp_in_tx` 创建公开 Thread 并返回新 ID。 |

`member.list` 现行实现必连来源 Camp，`get/update` 的目标检查依赖 Camp 成员或同 Camp 创建凭据，`has_direct_user_input` 只查公开消息。聊天分支改从绑定 Run 的私有触发消息或已接收的该轮插话取用户输入。`member_creation` 的来源扩为 `camp_id` 与 `conversation_id` 二选一，保留创建者和 `creationKey`。名册发现、档案读取、档案修改分别鉴权，重放也须重查范围。[队员工具](../../../crates/rovai-core/src/member_tool.rs) · [直接用户输入与创建回执](../../../crates/rovai-core/src/member_studio.rs) · [现有创建回执约束](../../../crates/rovai-core/src/db_member_creation.rs)

**跨 Thread 操作逐项鉴权。** Core 用有效 lease、epoch 和原生绑定确定来源 Run、话题及实际队员，从话题取发起用户。`--thread-id` 仅定位目标，还须校验用户对该操作的权限、业务开关、收件人和子对象归属。对已有 Thread 的 `send`、`task create`、`task update`、`mission update`、`mission status` 共用一个成员条件。每次写目标的事务内，按目标和实际队员复核 `camp_member` 的版本、`status='active'` 和 `leave_requested_at IS NULL`。尚未加入、已申请离队或已离队，均在写入前拒绝并返回原因，也不自动加人。普通 Thread A 的 Agent 继续按原来源和队长规则执行，显式传 B 不会得到跨 Thread 写权。[现有发信人成员校验](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/team_tool.rs#L1567-L1595) · [领域授权](../../../crates/rovai-core/src/collaboration.rs)

## 6. 公开署名与失败恢复

阿澈已加入发布组。用户对他说「告诉发布组，今天五点发版」，阿澈用 `send --thread-id` 指定发布组。用户另请他创建任务时，`task create` 也显式指定该组。发送、建改任务、修改使命及其状态都要在各自的写事务内复核 §5 的成员条件。公开消息以 `camp_message.author_type='agent'`、`author_id=阿澈的 ID` 署名，任务以 `task.created_by_type='agent'`、`created_by_id=阿澈的 ID` 记创建人。Core 将真实来源 Run 传给原配额查询，在建任务的事务内检查**该 Run 已建任务数上限 32**（跨所有目标合计）和**目标 Thread 非终态任务数上限 512**。按同一请求重放原任务只返回结果，不重复计数。[现有任务写入与配额](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/collaboration.rs#L1939-L2004)

目标只投影队员署名、公开正文、明确发布的附件引用、任务和该目标的投递。此类消息的 `camp_message.agent_run_id` 留空，回复锚点只取目标 Thread 的公开消息。小林的回复按发布组的投递规则处理。公开详情、`camp_message.sent` 事件、搜索、工具结果与深链均省略私有 `chatId`、来源 Run、问题、步骤和未发布的文件路径。Core 内部保留来源供鉴权、配额及回执对账。删除源聊天后，目标消息、投递和消息里的原附件引用均保留。打开附件时按目标消息验权，从原路径读取当前内容。源文件缺失或不可读时，只有该附件无法打开。对 `task.source_agent_run_id`、`closed_by_agent_run_id` 的外键及 Agent 非空约束增加私有来源删除条件。新写必须绑定真实 Run，只有删除事务核实来源后才能标记引用已清理并置空，创建人、关闭人和任务状态照常保留。[公开消息与投递](../../architecture/public-a2a-message-delivery.md) · [任务现有约束](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/db.rs#L14928-L14986)

**用户要求「给小林建一条发版检查任务，再通知他」。** 阿澈先调用 `task create`，再调用 `send`。两次请求各用自己的 `requestId`。进程内精确重放核对请求和参数摘要，重启后按原绑定、命令身份、来源和目标查询持久 `event_log.command.result`。任务用原 `taskId` 查回。定向消息和 `camp_message_delivery` 在目标事务内一起登记，之后按原 `messageId` 和各 `deliveryId` 区分公开写入与收件人处理进度。过期 lease 只能按既有规则核对已存结果，新写必须取得有效授权。[工具请求重放](../../../crates/rovai-core/src/builtin_tool_runtime.rs) · [持久命令回执](../../../crates/rovai-core/src/team_tool.rs)

| 通知的已知事实 | 后续行为 |
| --- | --- |
| 确认未发出，例如发送在写入前被拒 | 保留成功的任务和 `taskId`。需要补发时，在有效授权的 Run 中重新核对发送资格，用新的 `send` 请求只补这条通知。 |
| 已提交，响应丢失 | 按原请求查回同一条公开消息和各收件人的 Delivery。等待中的原 Delivery 由原投递器继续处理。 |
| 结果未知，缺少可靠回执或关联 ID | 停止重发。相似正文、接近的时间或一次空查询均不足以证明未发出。 |

这些结果在聊天里只出现在队员实际写出的答复及用户展开的对应工具步骤中。命令和投递回执供 Core 对账。聊天没有独立回执卡片、历史动作或重试按钮，轮次摘要不附业务回执。

## 7. 五个端到端用例与接口

| 用例 | 业务读写及可观察的结果 | 接口 |
| --- | --- | --- |
| ① 选人退出、同草稿双击首发 | 退出只读 `agent_profile`、存本机草稿，聊天记录为零条。双击经 `event_log` 去重，只建一组 `conversation`、`chat_topic`、首条 `conversation_message` 和首个 `agent_run`。相同内容得到同一组 ID，异内容保留输入并报冲突。列表只新增一行，显示活动轮，最后答复序号为 0。只加载列表第一页时，第二页聊天的新答复仍由 `replyIndex` 点亮图标栏。在本机将它标为已读，或归档这段聊天后刷新索引，若其余聊天均已读，总蓝点熄灭。 | `chats.list`、`chats.listChanged`、`chats.send`、`chats.rename` |
| ② 同一队员的 A、B 两段聊天历史隔离 | A、B 同属本机用户。A 的 Run 经 `conversation`、`chat_topic` 和触发消息定位历史，传 B 的 ID 或游标被拒。打开有 50 个折叠轮次的 A，只取本页消息、插话位置与摘要，展开一轮只读该轮的步骤，传 B 的 Run 或证据 ID 被拒。A 的答复含报告链接和本地图片时，`conversation_message` 只存一份原文。重开可预览 A 目录内的文件，指向 B 或外部目录的链接和图片只显示路径。若工具写了文件而最终正文为空，步骤保存在 `agent_run_execution_evidence`，本轮最终消息为零条。 | `chat history`、`chats.open`、聊天消息文件预览、`agentRunExecution.page / changes`、`agentRunEvidence.getContent` |
| ③ 先排队 Q、再插话 S，然后重启 | `single_chat_pending_input` 保存 Q、S，`agent_run_execution_evidence` 记录 S 的位置，私有 `context_manifest` 绑定原 Run／代次。Q 在输入框上方标「排队中」。签收前重启并打开原轮，仍在原位置看到一条 S，之前启动的命令结束后仍在上段，后续步骤和答复在下段。正常签收或对原 `runtime_input_delivery` 事后确证均只发表一条原轮的 `conversation_message`。若送达仍未知，S 在原位标「未确认送达」且不重发。若确证未接收且可回队，S 从原轮移除，排在 Q 之后标「已转为排队」，两项均可编辑、删除。保留 Q 时，它只开启一次下一轮。Q、S 提交各推进一次排序，自己的输入不点亮蓝点，只有新发表的队员答复推进答复序号。全程对 `camp`、`camp_member`、`camp_turn`、`camp_message`、`camp_message_delivery` 零写入。 | `chats.send`、`chats.open`、`chats.pendingInputs.edit`、`chats.list`、`chats.listChanged`，合资格时 `runtimeInputs.reconcile` |
| ④ 归档、重启、手动恢复 | 归档更新 `chat_topic`、取消 `agent_run`。重启扫描 `single_chat_pending_input` 和原 `runtime_input_delivery`，归档中不派发，普通列表与搜索找不到该聊天。已签收的插话作为普通用户消息留在原位，未知的保留「未确认送达」。手动恢复原 ID，只唤醒未派发的 FIFO。删除前，队员向已加入的 Thread 发送自有目录的报告和用户指定的外部清单。删库后重启，按 `camp_attachment_view_operation` 登记的目录身份清理。目录已删就结清该项。目标 `camp_message` 保留两个原引用，报告随目录删除，外部清单在原路径仍可读时可以打开。 | `chats.setArchived`、`chats.delete`、`threads.archive.list`、`navigation.search`、`agentRuns.cancel` |
| ⑤ 建任务后离队，只补未发出的通知 | 阿澈是发布组有效成员时，`task create` 在事务内复核 `camp_member`、检查配额并提交一条 `task`。随后他离队，下一笔 `send` 在自己的写事务内复核失败，成员、`camp_message` 和 `camp_message_delivery` 均无新增。若起初就不是成员，建任务、改任务和改使命也会被拒。重新具备资格且确认通知未发出时，只提交通知。已提交则按原请求的 `event_log`、消息与投递 ID 查回结果，未知即停。重启后任务仍只有一条、通知至多一条。聊天将结果留在实际答复与展开的步骤中。 | `task create / get`、`send` 及既有命令结果对账 |

**打开聊天与展开步骤。** Desktop 和认证 Web 共用 `chats.open`。首屏返回本页聊天消息、输入框上方的 FIFO、当前 Run 的插话能力与进度，以及本页各轮摘要。摘要从 `agent_run` 取 `runId`、状态、执行代次与 `execution_evidence_change_sequence`。

对本页轮次（含正展示的活动轮）按原 Run 和 `inputId` 取插话及其固定 `evidenceSequence`。运行端签收前就返回原输入的正文、附件、引用与这个位置。签收后关联正式消息，回队项只出现在 FIFO 或后来开启的新轮。Renderer 用 `inputId` 合并提交响应、打开结果和步骤增量，在原位置只显示一次。折叠历史只按键取这些插话项，无需遍历各轮工具记录。[旧单聊快照的读取路径](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/single_chat.rs#L1639-L1685)

只有正在展示的执行和用户展开的历史轮次才调用 `agentRunExecution.page` 取步骤。若首屏已附当前轮第一页，沿该页的 `nextBeforeSequence` 翻到更早步骤，从该页的 `throughChangeSequence` 调用 `agentRunExecution.changes` 接续变化。展开单项输出才用 `agentRunEvidence.getContent`。分页、增量和单项读取共用 §1 的话题查询，只取该话题下的 Run。读单项时再核对证据属于该 Run，然后复用既有窗口查询。[当前窗口归属校验](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/execution_window.rs#L63-L103) · [按需展开规则](../../contracts/run-process-detail-surface-v34.md#按窗口阅读与-dom)

§5 的四项 `member` 命令还需分别覆盖无 Camp 的名册读取、越权档案读取、确认创建，以及缺少直接用户要求或版本不符的修改。旧 Thread 调用沿用原接口。[现有共享接口](../../../packages/contracts/src/index.ts)
