---
document_type: implementation-proposal
version: v1.72
authority: proposed-chat-backend
status: proposed
revision: 2
last_updated: 2026-11-24
---

# 聊天后端提案

**一段独立聊天就是一条 `conversation`，`chatId = conversation.id`。** 从左栏选人只打开草稿，首次发送成功才有聊天记录。用户明确要求「新建一个团队会话」时，队员才调用 `rovai thread create` 创建公开 Thread。

本稿以 v1.72、Core `a181754bc8` 为基线。首版只新增 `chat_topic` 和 `chat_action` 两张业务表。前者负责左栏和归档，后者负责跨 Thread 写操作的回执与重试。

## 1. 数据归属

| 数据 | 存储与约束 |
| --- | --- |
| 聊天身份 | `conversation.kind='chat'` 要求 `camp_id IS NULL`，`agent_id` 固定为所选队员。每个话题用自己的 `native_binding_id` 和绑定代次。同一用户与同一队员可以开多个话题。 |
| 左栏话题 | `chat_topic.conversation_id` 同时是主键和指向 `conversation.id` 的外键，只接收 `chat`。其余字段为 `owner_user_id`、`title`、`archived_at`、`last_activity_sequence`、`version`。队员和头像经 Conversation 查 `agent_profile`。 |
| 用户消息和最终答复 | `conversation_message` 按 `(conversation_id, sequence)` 排序，保存正文、引用和附件引用。Core 把正常答复写回 Run 的目的 Conversation。`rovai send` 用于显式发布到公开 Thread。 |
| 执行过程 | `agent_run` 直接引用 `conversation_id` 和 `trigger_conversation_message_id`。聊天 Run 的 `camp_id`、`camp_turn_id` 均为空。`agent_run_execution_evidence` 按 Run 和 `execution_epoch` 保存可展示的工具调用、进度与输出。 |
| 排队输入 | 沿用 `single_chat_pending_input` 及其编辑记录。只有需要等待的发送才占队列位置，发布后关联正式消息和 Run。 |
| 委托回执 | `chat_action` 只登记需持久回执、可单项重试的委托写操作。普通问答、公开 Thread 读取和聊天历史查询均为零行。 |

对 `camp`、`camp_member`、`camp_turn`，首发均为零写入。用户侧的每次详情读取、改名、停止、归档和删除都核对 `chat_topic.owner_user_id` 与宿主认证用户。工作目录按 `chatId` 管理，引用 Thread 只定位业务对象。置顶与已读沿用本机偏好，以聊天类型保存 ID。

## 2. 首发、续聊与命令重放

选人时只读队员资料。本机按用户和队员保留未发送草稿，两个窗口打开同一草稿时共用 `draftId`。首发前冻结正文、结构化引用及有序附件引用。Core 验证用户、队员、Runtime 可用性及附件归属，在一个事务内分配 Conversation ID，写入 Conversation、话题、首条用户消息、首轮 Run 和命令回执。标题取首句，最多 20 个用户可见字符。纯附件取首个文件名，纯引用取引用标题。这两类输入都可单独发送。此后只允许用户按话题版本手动改名。

**首发去重复用 `event_log` 的 `command.result`。** Host 用认证用户和 `draftId` 派生唯一首发 `commandId`，两个窗口的请求号可以不同。Core 用 `canonical_json_digest` 对队员、正文、引用和有序附件标识计算摘要。在 `event_log` 的命令回执中保存草稿标识、摘要和原结果，判重范围跨同一用户的窗口。旧网关按命令类型、身份和作用域重放，载荷变化也会返回首次结果。首发须在快速重放和写事务内的二次查重两处，都先核对草稿标识和摘要。匹配就返回原 `chatId, messageId, runId`，不匹配就返回冲突并保留后提交窗口的输入。可修正的首发失败回滚，不占用首发键。客户端收到成功回执时只清除已发送的草稿版本。[现有重放逻辑](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/command.rs#L452-L495)

`chats.send` 的目标二选一，首发传 `draftId, agentId`，续聊传原 `chatId`。成功回执也只有两种形状。`started {chatId, messageId, runId}` 表示消息已发表，首发另带标题。`queued {chatId, inputId}` 表示已持久入队，尚无消息或 Run。空闲且无更早队列项时直接发表。续聊以该次发送的 `commandId` 重试。另起话题使用新草稿，首次成功时分配新 ID。

## 3. 没有 Camp 和 Turn 的运行链路

投影 schema 182 需要改以下写入、约束和查询。迁移从现有表复制数据并重建受影响的索引与触发器，保留旧记录的 kind、已发布关联、绑定和冻结策略。[Conversation 与 Run 的现有约束](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/db.rs#L7376-L7625)

| 环节 | 具体改动 |
| --- | --- |
| Conversation 与 Run | 重建 `conversation`，允许 `camp_id` 为空且仅 `kind='chat'` 时为空，保留既有成员和活动单聊的部分唯一索引。扩展 `agent_run` 的类型、投递、策略及路由不可变约束。`invocation_kind='chat'` 固定 `operation_policy='chat_v1'`、`response_delivery='conversation_message'`、`destination_conversation_id=conversation_id`，触发消息必须是该话题的用户消息。为聊天建立按 Conversation 唯一的活动 Run 索引，覆盖 `queued/running/waiting`。 |
| 入队与发布 | 现有入队触发器只认 `single_chat`，`published` 还强制有 Turn。扩展 `single_chat_pending_input_scope_insert`，独立聊天检查所有者与 `chat_topic.archived_at`。重建队列表，保留 FIFO 唯一键和状态约束。发布必须有同话题的消息和 Run。非发布态三项发布引用全空。插入和更新触发器按所属 Conversation 分支，旧单聊发布必须有匹配的 `published_camp_turn_id`，独立聊天始终要求该列为空。附件写入守卫放行两类私有用户消息。 |
| 消息准入与恢复 | 拆出 `admit_single_chat_message` 中共同的消息序号、消息和 Run 写入。`load_active_target` 和 `single_chat_has_active_run` 按来源类型取目标及检查忙闲。聊天从 `agent_profile` 冻结队员能力与版本，替换 `build_effective_config` 对 `camp_member` 的强制连接。发布把队首改为 `published` 与建消息、Run 同事务提交。`ready_pending_inputs` 保留旧 `JOIN camp` 分支，另按 `conversation JOIN chat_topic` 读未归档聊天。候选、发布命令和唤醒通知改为带来源类型。独立聊天只传 `conversationId`，只通知获准的用户端。取得写锁后重查归档、活动 Run、队首及编辑版本。`needs_repair` 阻塞该话题后项，修正或移除后继续。 |
| 派发、停止和重启 | 派发扫描 `list_dispatchable_agent_runs_scoped`、领取 `load_claimable_run`、执行读取 `load_agent_run_execution` 和启动清理 `cancel_interrupted_single_chat_runs` 都按 Camp／Turn 取目标。给这些入口增加按 Conversation 取聊天的分支，领取时重查归档。配置及上下文从话题绑定、队员和当前输入构造，公共上下文水位取零。停止按 `chatId, runId, executionEpoch` 定位，取消 Run 并释放其 lease。启动时分别对账活动 Run 和未发表输入，已取消或已接受但结果未知的 Run 不重新投递。 |
| 最终答复与证据 | `load_terminal_target` 与 `persist_single_chat_success` 目前会读取 Camp 并重算 Turn。聊天终态事务只核对 Conversation、目的地、绑定代次、Run 状态和 epoch。成功时将可见答复写入 `conversation_message` 并设置 `agent_run.final_conversation_message_id`，无最终文字则仅结算 Run。只允许活动代次在未取消且 `final_conversation_message_id IS NULL` 时结算，条件更新失败一并回滚。每轮至多一条最终回复。停止或归档后的迟到回调只记诊断。执行窗口、展开输出和附件读取均按所有者、话题、Run／消息校验归属。 |

旧会话内单聊继续要求活动 Camp、有效成员和配套 Turn，使用原 `single_chat_v1` 策略。迁移连同 schema 准入检查一起更新。执行记录的分块、增量读取和终态折叠可以继续复用。[排队表与类型触发器](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/db.rs#L26574-L26679) · [队列恢复](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/single_chat.rs#L1991-L2036) · [运行与终态](../../../crates/rovai-core/src/runtime.rs) · [上下文读取](../../../crates/rovai-core/src/context.rs) · [执行窗口](../../../crates/rovai-core/src/execution_window.rs)

## 4. 历史、导航和归档

**历史只随当前 Run。** `rovai chat history` 只接受分页参数。Core 从有效 Run 和认证绑定取得 Conversation，以触发用户消息的序号为排他上界，查询此前的用户消息、最终回复和附件摘要。游标绑定该话题和上界。传入 `chatId` 或另一话题的游标均拒绝。下一条排队输入在上一轮终态提交后才分配序号，因此能读到上一轮答复。

**导航只搜标题和队员名。** `navigation.search` 先在 `chat_topic` 限定认证用户和 `archived_at IS NULL`，再连接 `conversation`、`agent_profile` 匹配标题和 `display_name`，返回 `kind:'chat', chatId`。话题列表按活动序号降序、ID 稳定分页，支持按队员过滤。用户消息或最终回复发表时，在同一事务以 `event_log` 的全局序号更新话题排序。`navigation.searchMessages` 继续只读 `camp_message`。首版沿用现有搜索入口，无需正文索引或搜索表。[导航搜索合同](../../contracts/navigation-search-v1.md)

**归档沿用「设置 → 归档」。** 在同一事务设置 `chat_topic.archived_at`、取消活动 Run，提交后停止相应 Runtime。普通列表、搜索、发送、队列领取和派发都检查此字段。尚未发表的输入保留原队列状态。设置页按所有者读取归档话题，返回带 `kind:'chat'` 的摘要。手动恢复只清除归档时间并唤醒队列，沿用原 ID、历史和草稿。已取消 Run 保留终态。[现有归档行为](../../contracts/thread-archive-v1.md)

**永久删除按 `chatId` 清理。** 先隔离活动执行，按外键顺序清理私有输入、消息、Run、步骤、动作回执、话题与 Conversation，提交后幂等清理本机草稿、受管文件和释放的文件引用。首发回执擦除私有内容，仅留去重所需的标识及已删除状态，旧请求无法重建话题。公开目标已发布的消息、任务、经办署名及其文件保留。

## 5. 31 项 Agent CLI 与授权

现有 30 项中接入 29 项，加上 `chat history` 和 `thread create` 共 **31 项**。`single-chat history` 专供会话内单聊。下表省略可执行文件前缀 `rovai`。[当前 CLI 目录](../../../crates/rovai-core/src/builtin_tool_transport.rs)

| 操作 | 聊天 Run 的规则 |
| --- | --- |
| `chat history` | 只读当前话题，见 §4。 |
| `thread list`、`history search` | 在用户有权读取的公开范围发现目标，返回稳定 ID。 |
| `thread search / read / runs`、`send` | 必传 `--thread-id`。读消息或回复链核对所属 Thread。发布可显式选 `--public-only` 或 `--to`，收件人须在目标 Thread 有效。 |
| `task list / create / get / update` | 四项均必传 `--thread-id`，核对任务归属、负责人、能力开关和状态。建任务、通知负责人分两次写。 |
| `member list / get / create / update` | 全局档案按原权限操作。查某个 Thread 的成员须传 `--thread-id`。 |
| `mission list / get / update / status` | 列举与按使命 ID 读取沿用既有范围。修改和状态变更须传 `--thread-id`，同时提供的使命 ID 必须匹配。 |
| `memory view / search / read / write` | 按实际执行队员授权。依赖 Thread 成员关系时须传 `--thread-id` 并验证成员关系。 |
| `automation list / get / create / run / close / update / delete` | 按现有计划权限、版本及运行配置执行。涉及已有 Thread 的目标须显式给出。 |
| `thread create` | 用户明确要求新建团队会话时启用委托创建入口。Core 分配新公开 `threadId`，按用户指定配置创建 Thread 和成员。后续操作显式使用返回的 ID。 |

**来源与目标分别校验。** 现有工具认证会连接 `camp`、`camp_member`。Core 只为 `chat` Run 增加来源分支，由有效 lease、epoch、原生绑定和 `chat_topic.owner_user_id` 取得委托用户与经办队员。`--thread-id` 只定位已有目标。Core 再验证用户在目标的操作权限、对象归属和收件人。只有明确支持委托的 `send`、任务写入、使命修改和 `thread create` 能以用户权限办理，队员无须先加入目标。个人记忆等能力继续按实际队员校验。[现有工具身份校验](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/team_tool.rs#L1553-L1596)

委托写入入口只接受 Core 构造的委托身份。建任务复用任务领域校验，照旧检查负责人和来源 Run 配额。创建公开 Thread 时由该入口把认证所有者传给 `create_camp_in_tx`。普通 Agent 建任务仍受来源和队长检查，通用 Thread 创建仍要求 User。Core 的授权测试用同一目标 B 覆盖两条路径。获授权的独立聊天可以代发，普通 Thread A 的 Agent 即使显式传 B 也被拒绝，B 的消息与投递计数保持原值。[任务创建权限](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/collaboration.rs#L1888-L1918) · [公开 Thread 创建权限](https://github.com/murray17/rovai-ai/blob/a181754bc88c2d1e5773ce3db37a2647e03f1dfa/crates/rovai-core/src/collaboration.rs#L3465-L3479)

## 6. 跨 Thread 写入与单项重试

每个委托写操作先取得一个稳定 `actionId`。`chat_action` 以来源 `runId` 和逻辑调用键去重，保存操作、目标、冻结的最小重试参数、参数摘要、状态及业务结果 ID。`thread create` 可先为这项动作分配目标 ID，执行成功才写 `camp`。同一动作换目标或参数返回冲突。读取公开 Thread 只在执行步骤留下记录。

Core 在提交时重查权限和来源状态，将目标业务写入与动作成功回执放进同一事务。`camp_message` 的作者、`task` 的创建者记委托用户，两种目标记录各增可空的经办队员字段，公屏可显示「由阿澈代发」。私有聊天和 Run ID 只在来源侧关联。定向通知按现有规则原子写入公开消息及各收件人的 `camp_message_delivery`，用户可从聊天打开获准访问的目标。[公开消息与投递](../../architecture/public-a2a-message-delivery.md)

建任务和发通知各有一个 `actionId`。重启后，用户点哪条失败回执，Core 就按当前用户权限重试哪一项，沿用冻结参数，不重启原 Run。并发重试按动作状态条件更新。有任务、消息或投递 ID 时先对账，成功返回原对象，结果未明则等待确认，避免重复外发。

## 7. 五个端到端用例与最小接口

下表按数据流列出业务读写，最右列是由该用例需要的界面接口。Desktop 与认证 Web 共用这些接口。现有执行窗口、停止和导航接口增加带类型的聊天目标，旧 Thread 请求保持原合同。[现有共享接口](../../../packages/contracts/src/index.ts)

| 用例 | 实际读取 | 事务写入与结果 | 由此需要的接口 |
| --- | --- | --- | --- |
| ① 选人后退出 | `agent_profile`。从队员页续最近话题时才查 `chat_topic`、`conversation`。 | 仅写本机草稿。Core 的聊天、消息、Run、队列及 Thread 均新增 **0** 条。 | 复用队员名册。`chats.list(agentId?, cursor?)` 同时供左栏和最近话题使用。 |
| ② 同一草稿首发双击 | `event_log` 的首发回执、`agent_profile` 及 Runtime 配置。 | 首次各写 1 条 `conversation`、`chat_topic`、`conversation_message`、`agent_run`，`event_log` 同事务记回执。第二次同内容返回原三个 ID，异内容返回冲突。空闲发送不写队列。 | `chats.send` 的两种回执见 §2。`chats.rename(chatId, title, version)` 只处理手动改名。 |
| ③ 同一队员的话题 A、B 相互隔离 | A 的 `agent_run`、`conversation` 和绑定、`chat_topic`、A 的触发消息及之前的 `conversation_message`。 | `chat history` 查询本身零写入。传 B 的 ID 或游标被拒，只返回 A 的历史。运行过程可写 A 的 `agent_run_execution_evidence`，正常结束至多追加一条 A 的最终回复，`chat_action` 为零。 | `chats.open(chatId, beforeSequence?)` 兼顾首屏与旧消息。复用 `agentRunExecution.page / changes` 及 `agentRunEvidence.getContent`。 |
| ④ 归档期间重启 | `conversation`、`chat_topic`、`agent_run`、`single_chat_pending_input` 及其 `single_chat_pending_input_edit_session`。 | 忙时先写队列。归档更新 `chat_topic`、取消活动 `agent_run` 并记 `event_log`。重启不发表队首、不新建 Run。手动恢复后才写新 `conversation_message`、新 `agent_run` 并更新该队列项为 `published`，Turn 引用为空。 | `chats.setArchived(chatId, archived)`、`chats.delete`。复用 `threads.archive.list`、`navigation.search`、`agentRuns.cancel` 和队列编辑能力。 |
| ⑤ 建任务成功、通知失败后重启 | 由 `agent_run`、`conversation`、`chat_topic` 核实来源。读目标 `camp`、`camp_member`、`task` 和两条 `chat_action`，用已存 ID 对账 `camp_message`、`camp_message_delivery`。 | 第一次将 `task` 和建任务回执一起提交，通知失败只更新通知动作。点击重试只执行通知动作。通知尚未发布时，更新目标 `camp` 的序号，写 1 条 `camp_message` 和该收件人的 `camp_message_delivery`，需要时建立其目标成员 `conversation`。已有公开消息则沿用原消息和投递 ID。只更新通知回执与 `event_log`。原任务仍为 **1** 条。 | `chats.actions.retry(chatId, actionId)`。`chats.open` 随这轮答复返回两项回执。 |
