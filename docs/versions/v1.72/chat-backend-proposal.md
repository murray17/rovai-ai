---
document_type: implementation-proposal
version: v1.72
authority: proposed-chat-backend
status: proposed
revision: 4
last_updated: 2026-11-24
---

# 聊天后端提案

**一段独立聊天就是一条 `conversation`，`chatId = conversation.id`。** 从左栏选人只打开草稿，首次发送成功才有聊天记录。用户明确要求「新建一个团队会话」时，队员才调用 `rovai thread create` 创建公开 Thread。

本稿基于 `b1c20641a` 的七节修订稿，代码基线为 v1.72 的 Core `a181754bc8`。独立聊天只新增 `chat_topic` 一张业务表。排队和 Steer 共用现有输入记录，跨 Thread 操作沿用工具请求、命令回执和公开投递状态。

## 1. 数据归属

| 数据 | 存储与约束 |
| --- | --- |
| 聊天身份 | `conversation.kind='chat'` 要求 `camp_id IS NULL`，`agent_id` 固定为所选队员。每个话题用自己的 `native_binding_id` 和绑定代次。同一用户与同一队员可以开多个话题。 |
| 左栏话题 | `chat_topic.conversation_id` 同时是主键和指向 `conversation.id` 的外键，只接收 `chat`。其余字段为 `owner_user_id`、`title`、`archived_at`、`last_activity_sequence`、`version`，永久删除受理时记录 `deletion_operation_id`。队员和头像经 Conversation 查 `agent_profile`。 |
| 用户消息和最终答复 | `conversation_message` 按 `(conversation_id, sequence)` 排序，保存正文、引用和附件引用。Core 把正常答复写回 Run 的目的 Conversation。`rovai send` 用于显式发布到公开 Thread。 |
| 执行过程 | `agent_run` 直接引用 `conversation_id` 和 `trigger_conversation_message_id`。聊天 Run 的 `camp_id`、`camp_turn_id` 均为空。`agent_run_execution_evidence` 按 Run 和 `execution_epoch` 保存可展示的工具调用、进度与输出。 |
| 忙时输入 | `single_chat_pending_input` 保存 FIFO 输入和指定活动 Run 的 Steer 输入。仅 FIFO 输入进入下一轮队列。运行端是否已接收以 `runtime_input_delivery` 为准。 |
| 公开业务结果 | `event_log` 的 `command.result` 关联已有工具请求与结果。任务读 `task`，消息和逐收件人投递读 `camp_message`、`camp_message_delivery`。 |

私下问答的整个过程，包括首发、排队、Steer 和最终回复，对 `camp`、`camp_member`、`camp_turn` 均为零写入。用户侧的每次详情读取、改名、停止、归档和删除都核对 `chat_topic.owner_user_id` 与宿主认证用户。工作目录按 `chatId` 管理，引用 Thread 只定位业务对象。置顶与已读沿用本机偏好，以聊天类型保存 ID。

## 2. 首发、排队与补充当前执行

**首发。** 选人只读队员资料。本机按用户与队员保存未发送草稿，同一份草稿跨窗口共用 `draftId`。首次发送时，Core 校验用户、队员、配置授权、引用及附件，在一个事务内写入 `conversation`、`chat_topic`、首条 `conversation_message`、首个 `agent_run` 和命令回执。标题取首句，最多 20 个用户可见字符。纯附件取首个文件名，纯引用取引用标题。此后由用户按话题版本手动改名。续聊沿用原 ID，另起话题用新草稿，成功首发时才分配新 ID。

**临时离线也受理。** 已选定且获准的 Runtime 暂时离线时，首发仍返回同一条消息和已建立的 Run，界面显示「等待运行端」。Run 保持 `queued`，`chats.open` 将暂不可派发的原因投影为 `waiting_runtime`。保存已获准的 Runtime 选择、权限和配置版本，此时尚未开始投递。恢复时重新核对归档、权限、安装身份及绑定，相符才领取这个 Run，补齐可执行快照并派发一次。未配置、已禁用或授权撤销时返回具体原因并保留草稿。等待期间撤权则停止派发。`resolve_frozen_runtime` 的配置校验与实时可达性判断需在聊天准入处分开。[队员运行配置](../../../crates/rovai-core/src/agent_profile.rs)

**首发去重。** Host 按认证用户和 `draftId` 派生首发 `commandId`，使用 `canonical_json_digest` 对队员、正文、引用及有序附件标识求摘要。`event_log` 的 `command.result` 保存草稿标识、摘要和结果。快速重放与写事务内查重都校验两者。相同快照返回原三个 ID，异内容返回冲突，后提交窗口保留输入。可修正的拒绝回滚，草稿仍可首发。成功时客户端只清除已发送的草稿版本。[现有重放逻辑](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/command.rs#L452-L495)

`chats.send` 首发传 `draftId, agentId`，续聊传 `chatId`。`mode=start` 在空闲且无更早排队项时开一轮，忙时对应「排队发送」。`mode=steer` 对应「补充当前执行」，须带用户当前看到的 `runId, executionEpoch`。Core 在写事务核对该 Run 正在此用户的这个话题中执行。同一命令号的重放须匹配最初提交的模式、目标及内容摘要。已变化的 Run 或不支持 Steer 的目标返回具体原因，保留输入供用户选择排队。

| 成功回执 | 界面显示及含义 |
| --- | --- |
| `started {chatId, messageId, runId, runStatus}` | 已开启新一轮。首发另带标题，等待运行端按 `runStatus` 单独显示。 |
| `queued {chatId, inputId}` | 已排队。输入按提交顺序显示在「待处理」，正式发表时移到下一轮开头，此时才建立消息和新 Run。 |
| `steer_submitted {chatId, inputId, runId, executionEpoch}` | 已向当前轮提交补充。本轮下的「补充当前执行」先显示「待发送」或「发送中」，收到运行端 `accepted` 回执后原位更新为「已收到」。 |

## 3. 没有 Camp 和 Turn 的运行链路

从投影 schema 182 迁移，复制旧记录并重建受影响的约束、索引和触发器。旧队列记录的 `requested_mode` 回填为 `start`，Steer 目标字段留空。会话内单聊继续使用活动 Camp、成员、Turn 和冻结的 `single_chat_v1` 策略。

| 环节 | 需要调整的现有依赖 |
| --- | --- |
| Conversation 与 Run | `conversation.camp_id` 仅在 `kind='chat'` 时为空。聊天 `agent_run` 固定 `invocation_kind='chat'`、`operation_policy='chat_v1'`、`response_delivery='conversation_message'`、`destination_conversation_id=conversation_id`。触发消息属于该话题，两个 Camp 引用均为空。每个聊天 Conversation 至多一个 `queued/running/waiting` Run。保留旧类型的唯一索引、原生绑定和路由不可变约束。 |
| 首发、直接发表与 FIFO | 从 `admit_single_chat_message` 拆出共同的消息序号和 Run 写入。`load_active_target`、`single_chat_has_active_run` 识别聊天，`build_effective_config` 从 `agent_profile` 取获准配置。`single_chat_pending_input_scope_insert` 校验用户和未归档话题。`published` 须有同话题的消息和 Run，旧单聊另须有匹配的 `published_camp_turn_id`，聊天要求为空。插入与更新均校验，未发表时三个发布引用全空。普通排队发布在同一事务建消息、新 Run 并结算队首。 |
| 扫描、领取与停止 | `ready_pending_inputs` 保留旧单聊的 `JOIN camp`，独立聊天改连 `chat_topic`。FIFO 只取 `requested_mode=start`，写锁内重查归档、活动 Run、最早序号及编辑版本，`needs_repair` 挡住本话题后项。`list_dispatchable_agent_runs_scoped`、`load_claimable_run`、`load_agent_run_execution` 和 `cancel_interrupted_single_chat_runs` 增加按 Conversation 取目标的分支。离线等待没有 lease，恢复后只领取原 Run。停止按所有者、话题、Run、epoch 取消执行并释放 lease，迟到输出只记入原代次的诊断。 |
| 最终答复和附件 | `persist_single_chat_success` 现按非空文字决定是否写消息。给 `SucceedAgentRunCommand` 增加可选的 `finalAttachments`。适配器上报本轮明确交付的文件，Host 将其登记为归属该 Run 的附件引用并校验可读性，输出目录中的其他文件不参与终态。文字非空或有有效附件时，在同一终态事务写 **一条** `conversation_message` 并设置 `final_conversation_message_id`。纯附件消息的正文可为空。未声明任何输出时只结算 Run，声明的附件校验失败则保留具体错误。`source_attachments_json` 的守卫允许当前话题的用户附件及本轮 Agent 最终附件，读取时重验归属。Run/epoch、目的地、取消及唯一终态检查防止重复回复。 |

**Steer 的私有输入来源。** 在 `single_chat_pending_input` 增加 `requested_mode` 和目标 Run／代次，`inputId` 也是补充输入的稳定标识。`active_input_availability` 目前限定 `batch`，为 `chat` 接入同一套冻结的适配器、协议、版本和绑定检查。`canSteer` 允许登记意图，`ready` 还须同一绑定、代次的初始输入已接收。启动中的绑定按既有预计代次等待。发送前再验原目标，每条按提交顺序单独投递。私有路径对 `camp_message` 和 `camp_message_delivery` 均为零写入。

公开 Steer 的 `context_manifest.source_delivery_id` 引用公开 Delivery。给同表增加互斥的私有 `source_chat_input_id`，外键指向上述输入。两种来源都为空才是初始 Manifest，每个私有来源只能建立一个补充 Manifest。同步修改部分唯一索引、来源不可变守卫、输入构造器和 `input_kind` 判定。复用 `runtime_input_delivery(input_kind='steer', input_sequence)` 的准备、发出及接收回执。登记 Steer 后冻结这份输入，只有尚待 FIFO 发表的输入沿用队列编辑入口。私有补充从原输入取正文及附件，绕开 `agent_run_input` 对公开消息和 Delivery 的外键。执行窗口通过私有来源读写现有 `agent_run_execution_evidence`，按 `inputId` 合并步骤。模型输入与 Manifest 的版本调整按现有流程记录。[Steer 资格与结算](../../../crates/rovai-core/src/steer.rs) · [来源约束](../../../crates/rovai-core/src/db_steer.rs) · [模型上下文变更](../../development/model-context-change-governance.md)

获得 `accepted` 时在同一事务将输入关联到**原 Run**，追加一条私有用户消息并标记已发表，原 Run 的触发消息保持原值。仅在现有规则确认未提交或 `not_accepted` 且允许回队时，才把同一输入一次性改为 `start` 并保留 FIFO 序号。`accepted`、`delivery_unknown` 及已经开始发送但没有确定结果的输入均不得再次入队或重发。符合 `canReconcile` 的未知项只核对原生回执，确证后只结算原 `inputId`，重复或迟到的 ACK 不再追加消息。切换聊天、归档、重启或后继 Run 均不改变输入归属。[现有 Steer 核对合同](../../contracts/message-delivery-v20.md) · [已接收输入恢复](../../contracts/accepted-input-recovery-v9.md)

共享执行证据继续按 `runId + executionEpoch` 保存和展开。普通答复、仅附件答复及忙时补充都只对话题所有者可见。[排队表与类型触发器](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/db.rs#L26574-L26679) · [私有准入与队列恢复](../../../crates/rovai-core/src/single_chat.rs) · [运行与终态](../../../crates/rovai-core/src/runtime.rs)

## 4. 历史、导航、归档与删除

**历史。** `rovai chat history` 只接受分页参数。Core 从有效 Run 和原生绑定反查目的 Conversation，以触发用户消息序号为排他上界，返回此前已发表的用户消息、最终答复和附件摘要。当前轮的补充从该轮 Steer 输入送达。下一轮能够读到此前已确认的补充和最终答复。游标绑定话题及上界，传入另一个 `chatId` 或跨话题游标均拒绝。详情页按 Run 展示消息与执行步骤。重开聊天时，按 `inputId` 及其关联的已发表消息还原待处理项和轮内消息，同一输入只显示一次。

**导航。** `navigation.search` 先按认证用户和 `chat_topic.archived_at IS NULL` 筛选，再连接 `conversation`、`agent_profile` 匹配标题和队员名。结果为 `kind:'chat', chatId`。左栏按活动序号降序、ID 稳定分页，可按队员过滤。直接发送、FIFO 入队或 Steer 提交成功时，以及队员发表最终回复时，各在同一事务将该事件的 `event_log.global_sequence` 写入 `chat_topic.last_activity_sequence`。同一输入只计一次，命令重放、FIFO 正式发表和 Steer 签收不重复计入。打开聊天、展开步骤和改名均不参与排序。`navigation.searchMessages` 继续只搜 `camp_message`。[导航搜索合同](../../contracts/navigation-search-v1.md)

**归档。** 在同一事务设置 `archived_at`、取消活动 Run、关闭新输入和派发。设置页按所有者显示 `kind:'chat'` 的归档项。已取消的原轮显示「已停止」。补充沿用原 Run／代次的回执，`accepted` 显示「已收到」，`delivery_unknown` 显示「送达未确认」。有尚未派发的 FIFO 时提示「恢复后将继续发送排队中的消息」。手动恢复沿用原 ID、历史与草稿，只按原顺序唤醒这些 FIFO，已取消的轮次保持终态。[现有归档行为](../../contracts/thread-archive-v1.md)

**删除与文件清理同事务交接。** Core 记录删除操作 ID，封住聊天读写并隔离活动 Run。业务删除事务先向现有 `camp_attachment_view_operation` 和 `camp_attachment_view_operation_entry` 登记待清理的受管根、文件相对路径和所有权标识，再清理私有消息、Run、证据、输入、话题属性和 Conversation，两者一起提交或回滚。为现有 journal 增加 `chat_delete_cleanup` 和独立的 `chatId` 归属，允许此类记录的 `camp_id` 为空。清单在话题删除后仍可读取。启动恢复先接续尚未交接的删除标记，再按操作 ID 扫描未完成清单，核对根身份后逐项清理，已删项视为完成。清单只含聊天独占文件，外部原文件和公开目标仍持有的文件保留。提交后按 `chatId` 清掉本机草稿。话题内的创建回执随话题清理，已创建的全局队员档案保留。首发回执仅保留去重标识与已删除状态。[现有删除交接合同](../../contracts/camp-permanent-deletion-v4.md) · [恢复扫描](../../../crates/rovai-core/src/camp_deletion.rs)

## 5. 31 项 Agent CLI 与授权

现有 30 项中开放 29 项，再加 `chat history` 和 `thread create`，共 **31 项**。`single-chat history` 专供会话内单聊。下表省略可执行文件前缀 `rovai`。[当前 CLI 目录](../../../crates/rovai-core/src/builtin_tool_transport.rs)

| 操作 | 聊天 Run 的规则 |
| --- | --- |
| `chat history` | 只读当前话题，见 §4。 |
| `thread list`、`history search` | 在用户可读的公开范围发现目标，返回稳定 ID。 |
| `thread search / read / runs`、`send` | 必传 `--thread-id`，核对目标和子对象归属。`--public-only` 只发布，`--to` 核验目标 Thread 的有效收件人。 |
| `task list / create / get / update` | 四项均必传 `--thread-id`。按目标核对任务、负责人、能力开关和状态转换。建任务与通知负责人是两次独立操作。 |
| `member list` | 无 `--thread-id` 时只列话题所有者通过队员名册可见的未移除队员摘要，全局结果省略 `threadId` 和队长标记。指定公开 Thread 时须先有名册读取权，再列其有效成员及真实队长。 |
| `member get` | 无 Thread 时可读当前聊天队员，或经 `member_creation` 证明由该队员在本话题创建的档案。显式指定 Thread 时可读用户有权查看的目标成员。只投影身份字段，未知和无权目标返回相同的不可用结果。 |
| `member create` | 仅允许该话题所有者直接请求并确认最终队员卡。用原 `creationKey` 重放，同键改内容报冲突。写全局 `agent_profile` 和现有 `member_creation` 私有来源回执，成员关系仅在另外获准的入组操作中建立。 |
| `member update` | 先按 `get` 的范围核对目标，再检查用户有权编辑且直接要求修改。只允许既有身份字段 PATCH，必传 `requestId` 与 `expectedVersion`。写事务重验目标、版本与头像来源，禁止借此修改 Runtime、权限或成员关系。 |
| `mission list / get / update / status` | 全局发现或按使命 ID 读取。修改及状态变更须传 `--thread-id`，同时给出的使命 ID 必须匹配。 |
| `memory view / search / read / write` | 按实际执行队员授权。依赖 Thread 的记忆须传 `--thread-id`，验证成员关系及记忆可见性。 |
| `automation list / get / create / run / close / update / delete` | 沿用计划权限、版本、显式用户要求和运行配置。涉及已有 Thread 的参数须指明目标。 |
| `thread create` | 接到用户明确的新建团队会话请求后，专用授权入口核对用户创建资格，复用 `create_camp_in_tx` 创建公开 Thread 并返回新 ID。 |

`member.list` 现行实现必连来源 Camp，`get/update` 的目标检查依赖 Camp 成员或同 Camp 创建凭据，`has_direct_user_input` 只查公开消息。聊天分支改从绑定 Run 的私有触发消息或已接收的该轮补充取用户输入。`member_creation` 的来源扩为 `camp_id` 与 `conversation_id` 二选一，保留创建者和 `creationKey`。名册发现、档案读取、档案修改分别鉴权，重放也须重查范围。[队员工具](../../../crates/rovai-core/src/member_tool.rs) · [直接用户输入与创建回执](../../../crates/rovai-core/src/member_studio.rs) · [现有创建回执约束](../../../crates/rovai-core/src/db_member_creation.rs)

**跨 Thread 的授权来自这次聊天。** Core 从有效 lease、epoch、原生绑定及 `chat_topic.owner_user_id` 确定来源、用户与实际队员。`--thread-id` 负责定位，再按操作核对用户在目标的权限、业务开关、收件人及子对象归属。聊天专用入口允许受托队员在获准的目标发言、办理任务或修改使命，执行队员可未加入目标，此项授权不创建成员关系。普通 Thread A 的 Agent 继续按原来源和队长规则执行，显式传 B 也不会得到跨 Thread 写权。[现有工具身份](../../../crates/rovai-core/src/team_tool.rs) · [领域授权](../../../crates/rovai-core/src/collaboration.rs)

## 6. 公开署名与失败恢复

用户对阿澈说「告诉发布组，今天五点发版」，目标 Thread 的 `camp_message.author_type='agent'`、`author_id=阿澈的 ID`。阿澈建任务时，`task.created_by_type='agent'`、`created_by_id=阿澈的 ID`。Core 将真实来源 Run 传给原任务配额查询，在同一写事务检查**该 Run 已建任务数上限 32**（跨所有目标合计）和**目标 Thread 非终态任务数上限 512**。按同一请求重放原任务只返回结果，不重复计数。[现有任务写入与配额](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/collaboration.rs#L1939-L2004)

目标只投影队员署名、公开正文、明确发布的文件、任务和该目标的投递。此类消息的 `camp_message.agent_run_id` 留空，回复锚点只取目标 Thread 的公开消息。小林的回复按发布组的投递规则处理。公开详情、`camp_message.sent` 事件、搜索、工具结果与深链均省略私有 `chatId`、来源 Run、问题、步骤和未发布的文件路径。Core 内部保留来源供鉴权、配额及回执对账。删除源聊天时，目标消息及投递仍按自身 ID 存活。对 `task.source_agent_run_id`、`closed_by_agent_run_id` 的外键及 Agent 非空约束增加私有来源删除条件。新写必须绑定真实 Run，只有删除事务核实来源后才能标记引用已清理并置空，创建人、关闭人和任务状态照常保留。[公开消息与投递](../../architecture/public-a2a-message-delivery.md) · [任务现有约束](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/db.rs#L14928-L14986)

**建任务，再通知小林。** 两个工具请求分别使用既有 `requestId`。进程内精确重放核对请求和参数摘要，进程重启后按原绑定、命令身份、来源和目标查询持久 `event_log.command.result`。任务读取已返回的 `taskId`。定向消息与 `camp_message_delivery` 在目标事务中一并登记，之后按 `messageId` 及各 `deliveryId` 查状态。过期 lease 只可按既有规则核对已存结果，新写必须来自有效授权。公开写入成功与收件人已处理分别展示。[工具请求重放](../../../crates/rovai-core/src/builtin_tool_runtime.rs) · [持久命令回执](../../../crates/rovai-core/src/team_tool.rs)

| 通知的已知事实 | 后续行为 |
| --- | --- |
| 确认未发出，例如已收到写入前的拒绝 | 保留成功的任务和 `taskId`。按现有工具规则，在有效授权的 Run 中只提交通知。 |
| 已提交，响应丢失 | 用原请求查回同一条公开消息及各收件人的 Delivery，显示已有状态。等待中的原 Delivery 继续由原投递器处理。 |
| 结果未知，缺少可靠回执或关联 ID | 停止重发并显示结果待确认。消息正文相似、时间接近或一次查询为空，都不足以证明未发出。 |

## 7. 五个端到端用例与接口

| 用例 | 业务读写及可观察的结果 | 接口 |
| --- | --- | --- |
| ① 选人退出、同草稿双击首发 | 只选人读 `agent_profile`、存本机草稿，Core 新增零条。双击时从 `event_log` 去重，只创建一组 `conversation`、`chat_topic`、首条 `conversation_message`、首个 `agent_run`。两次同快照得到相同 ID，异内容保留输入并报冲突。已配置获准的 Runtime 暂离时仍返回 `started` 并显示等待，恢复后只派发这一个 Run。 | `chats.list`、`chats.send`、`chats.rename` |
| ② 同一队员的 A、B 两段聊天历史隔离 | A 的 Run 经 `conversation`、`chat_topic`、触发消息定位历史，传 B 的 ID 或游标被拒。若 A 的最终答复只有一个附件，`conversation_message` 只新增一条含附件的 Agent 消息，关联 A 的 `final_conversation_message_id`，迟到或重复终态不再追加。 | `chat history`、`chats.open`、`agentRunExecution.page / changes`、`agentRunEvidence.getContent` |
| ③ 先排队、再补充，然后重启 | 同一轮先排队 Q，再补充 S，两次受理各推进一次话题排序。Q 在 `single_chat_pending_input` 等待，S 的私有 `context_manifest` 和 `runtime_input_delivery` 绑定原 Run／代次。S 已签收、Q 尚未发表时重启。重开后原轮只显示一条 S，Q 仍排在原来的位置。原轮结算后，Q 只开启一轮，该轮历史可读 S。S 签收和 Q 发表均不重复推进排序。若 S 送达未确认，重启也不重发或入队。只有 §3 允许回队时才用原 `inputId` 入队一次。全程对 `camp`、`camp_member`、`camp_turn`、`camp_message` 和公开 Delivery 零写入。 | `chats.send` 三种回执、`chats.open`，合资格时 `runtimeInputs.reconcile` |
| ④ 归档、重启、手动恢复 | 归档更新 `chat_topic`、取消 `agent_run`。重启扫描读取 `single_chat_pending_input` 及在途补充回执，归档中不派发，普通列表与搜索均找不到。手动恢复原 ID，只发布尚未派发的 FIFO 输入。删除另走同事务清单交接，在删库提交后、清文件前退出，重启仍可从 `camp_attachment_view_operation` 及明细完成清理。 | `chats.setArchived`、`chats.delete`、`threads.archive.list`、`navigation.search`、`agentRuns.cancel` |
| ⑤ 任务已建，补通知不重复建任务 | `task` 中只有一条阿澈创建的任务。查建任务和通知各自的 `event_log` 回执，再按 `camp_message`、`camp_message_delivery` 区分 §6 三种结果。确认未发出只补通知，已提交只取原消息，未知即停。即使重启，任务始终一条、公开通知至多一条，目标只能看到阿澈及公开结果。 | 既有 `task create / get`、`send` 及命令结果对账 |

上述入口共用于 Desktop 和认证 Web。`chats.open` 返回队列状态、当前 Run 的 Steer 能力与进度、最终附件和逐轮执行窗口。§5 的四项 `member` 命令还需分别覆盖无 Camp 的名册读取、越权档案读取、确认创建，以及缺少直接用户要求或版本不符的修改。旧 Thread 调用沿用原接口。[现有共享接口](../../../packages/contracts/src/index.ts)
