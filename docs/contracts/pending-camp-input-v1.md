---
document_type: interface-contract
contract: pending-camp-input
version: 1
status: accepted
authority: camp-next-turn-input-admission-and-editing
last_updated: 2026-08-31
---

# Pending Camp Input v1

Pending Camp Input 是用户已提交、尚未公开的下一轮输入。它不是 CampMessage、运行中的 Runtime input、
Task 或持久 working copy。本合同只扩展 Desktop Composer 的 `camp.messages.send`；Agent Send 和
User Automation 的既有显式命令保持原合同。

## 入队与发布

Core 在同一个 immediate SQLite 事务内决定：没有 queued/running/waiting 的 Camp 执行、
没有 pending/running Delivery，并且没有 queued/needs_repair 输入时，走现有直接发送；否则追加队尾。
Camp 已空闲但队首正在编辑或需要修复时，新输入仍只能追加。

入队读取 exact Draft revision，保存规范化 Structured Content、固定 Reply ID 和 execution request，
并消费普通 Draft。入队不创建公共 Message、Turn、Run、Delivery、History 或 Context 输入。
包含任何 Prepared Attachment 的 Draft 不得入队；拒绝保留 Draft revision、内容和附件。

有效 Continuation 在入队时物化成可见的 leading Member Mention；Reply 或显式 Mention 优先。
Pending 不保存 Continuation 或 `recipientSelectionTouched`。无 Mention 的输入在真正发布事务中读取
当时的 Default Lead。所有固定 Mention 和 Reply 在发布时重新校验，不得跳过失效成员或静默换接收者。
手动删除 Mention 后可走默认 Lead；Reply author 不会重新成为隐式接收者。

现有 Scheduler 每轮只尝试每个 Camp 的队首。头部存在编辑占用时阻塞该条及后续输入；编辑后面的输入
不阻止前面的输入。每次发布复用 CollaborationService 的用户消息内核，并在同一个事务中创建正式
CampMessage、CampTurn、AgentRun 与写入 Pending 发布结果。Pending 发布不消费普通 Composer Draft。

## 持久状态

`pending_camp_input` 保存 id、campId、单调 enqueueSequence、revision、state、Structured Content、
replyToCampMessageId、recipientSelectionRequired、execution request、原 User identity、
publishedCampMessageId/publishedCampTurnId/publishedAt、lastAttemptErrorCode 和创建/更新时间。
state 仅为 queued / needs_repair / published / cancelled。Reply ID 可在历史消息失效后保留用于修复提示。
同一 Camp 的序号唯一，删除和编辑不改变其他输入顺序；Camp 删除级联清理两个私有表。

`pending_input_edit_session` 以 Camp 为唯一键，只保存 pendingInputId、随机 editToken、
basePendingRevision 和 recoveryRequired。没有 working content、心跳、超时解锁或多窗口合并。

没有独立的队列暂停状态、暂停/继续命令、重试计时器或后台发布租约。队列只等待现有执行结算、
队首编辑结束或队首错误被处理。

## 编辑命令

`camp.pendingInputs.get({campId})` 返回 CampPendingInputsView：executionActive、
按 FIFO 排序的非终态 items 与 editSession。items 包含正文、结构化内容、Reply 投影、revision 和错误。
这些数据只通过 Desktop 用户读取入口暴露；Agent History/Context 不读取私有输入。

Core 在入队、编辑和发布尝试的事务完成后，通过既有 Desktop event 通道发送
`camp.pendingInputs.changed({campId, reason})`。reason 为 `enqueued / edited / published /
publication_failed`，只提示对应 Camp 重读私有队列，不携带正文、接收者、编辑 token，也不写入
公共 event_log。`published` 同时触发该 Camp 的公共会话投影刷新，使 Continuation 在正式发布时更新；
普通入队和编辑不读取完整会话或侧栏。执行启动、终态与取消继续使用既有 Camp-scoped
`navigation.invalidated` 提示重读 executionActive。

Renderer 在挂载、回到前台、Core ready/reconnect 和上述变更时读取队列，不按固定间隔轮询。
突发通知合并为一个在途请求；读取期间又有通知时补读一次最新权威，内容未变时不替换本地队列。
读取失败保留已知队列，下一次通知或前台恢复再读取；它不重放发送、编辑命令或释放编辑占用。
提交成功后先初始化下一份 Draft 的权威路由，再恢复输入，避免快速连续输入以空 source 冻结接收者。
普通发布刷新复用同一 Draft 已覆盖的消息序列，不因公共投影晚到而重复读取；晚到结果仍不得覆盖新草稿。

`camp.pendingInputs.edit` 使用已有 UserCommandParams Envelope，command 包含 campId、pendingInputId、
expectedRevision、nullable editToken 与 action：

| action.type | 语义 |
| --- | --- |
| begin | 无已有编辑占用时创建 token；返回 editToken |
| takeover | 用户显式重新编辑；必须匹配当前 token，替换为新 token |
| save | 必须匹配有效 token + base revision；提交完整 content、Reply ID 和 recipientSelectionRequired；revision + 1，保留位置并关闭占用 |
| cancel | 匹配 token 后关闭占用，canonical 内容不变；包含放弃未保存修改和无修改关闭 |
| delete | 取消该条；如果它正在编辑，必须匹配当前 token |

保存不能提交空内容，不能把原 Reply 偷换成另一个目标，只能保留或显式取消。结构化正文继续遵守
现有用户可编写的 segment 闭集。切换编辑项且本地 dirty 时提示保存 / 放弃修改 / 继续编辑。
Dirty 比较 content、Reply 和 recipientSelectionRequired，但不作为 Core 发布安全依据。

普通 Draft 不被 Pending 编辑覆盖；所有未保存修改只在 Renderer 内存，异常退出可以全部丢失。
Core 重启把已有编辑标成 recoveryRequired。Renderer 刷新或重新进入 Camp 不自动认领旧 token，也不
自动 cancel；必须显式重新编辑、放弃未保存修改或删除。旧 token 的迟到保存/取消一律拒绝。

## 自动续发、错误和幂等

上一轮进入终态且该 Camp 所有 Run、Turn 与 Delivery 均已离开非终态后，Scheduler 自动发布一条队首。
Composer Stop 复用既有取消命令；取消请求 accepted 不代表已经停止，必须等当前执行完全结束再推进。
不存在“暂停队列”或“继续发送”入口；其余输入待新一轮结束后按 FIFO 自动继续。审批、恢复等待、
可恢复失败形成的 waiting Turn 及编辑占用继续阻塞，现有恢复或停止操作结算后自动解除阻塞。
上轮终态为失败或取消时也按同一规则推进，已公开消息不会退回 Pending 或重复执行。

发布拒绝或事务错误保留该条输入并标为 needs_repair，后续输入不能越过它，不自动重试。
用户通过既有编辑入口修正并保存后，该条恢复 queued、保持原位置并自动接受下一次准入；
也可删除该条让下一条继续。仅打开或取消编辑不清除错误，普通新消息不代替修复队首。
Composer 主操作在执行中无正文时为“停止”，有正文时为“发送”，空闲时为“发送”，两者不并列显示。
发送动作不随入队或提交中状态更换文字；处理中继续禁用重复提交。

同一传输请求复用 commandId 和摘要，由 CommandGateway 重放。修改输入或重新尝试使用新 commandId；
先前 rejected 结果同样会重放。最多成功发布一次由 Pending 行的发布结果和同一事务保证，独立于
commandId；再次发布已成功输入返回原 Message/Turn ID。

迁移 117 从 v1.29/schema-70 升到 v1.33/schema-71，仅增加私有表并更新 marker；不改写旧消息或执行。
