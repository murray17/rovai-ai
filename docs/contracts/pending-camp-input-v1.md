---
document_type: interface-contract
contract: pending-camp-input
version: 1
status: accepted
authority: camp-next-turn-input-admission-and-editing
last_updated: 2026-08-30
---

# Pending Camp Input v1

Pending Camp Input 是用户已提交、尚未公开的下一轮输入。它不是 CampMessage、运行中的 Runtime input、
Task 或持久 working copy。本合同只扩展 Desktop Composer 的 `camp.messages.send`；Agent Send 和
User Automation 的既有显式命令保持原合同。

## 入队与发布

Core 在同一个 immediate SQLite 事务内决定：队列为 auto、没有 queued/running/waiting 的 Camp 执行、
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
同一 Camp 的序号唯一，删除和编辑不改变其他输入顺序；Camp 删除级联清理三个私有表。

`pending_input_edit_session` 以 Camp 为唯一键，只保存 pendingInputId、随机 editToken、
basePendingRevision 和 recoveryRequired。没有 working content、心跳、超时解锁或多窗口合并。

`camp_queue_control` 保存 auto/paused 和暂停原因 manual / user_stop / execution_failure /
recovery_blocked / send_failure。没有重试计时器或后台发布租约。

## 编辑命令

`camp.pendingInputs.get({campId})` 返回 CampPendingInputsView：mode、pauseReason、executionActive、
按 FIFO 排序的非终态 items 与 editSession。items 包含正文、结构化内容、Reply 投影、revision 和错误。
这些数据只通过 Desktop 用户读取入口暴露；Agent History/Context 不读取私有输入。

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

## 暂停、错误和幂等

`camp.pendingInputs.setMode` 使用 UserCommandParams，command 为 `{campId, mode: auto | paused}`。
显式继续发送不绕过执行、编辑或 FIFO 阻塞；需要修复的队首会重新校验。
Composer Stop 在请求取消前短暂暂停准入；CampTurn 取消命令同时持久恢复 auto。取消请求 accepted
不代表已经停止：必须等该 Camp 所有 Run、Turn 与 Delivery 离开非终态后，Scheduler 才发布一条队首。
无需再次点击“继续发送”；其余输入仍排队，待新一轮结束后按 FIFO 继续。用户在停止期间显式暂停队列
仍然有效，编辑占用、审批与 recovery blocker 不被绕过。
上轮失败、中断、单独 AgentRun Stop 和 recovery blocker 暂停自动发送；审批和普通 waiting 保持非终态。

发布拒绝保留输入并暂停；需要修复的接收者/Reply/Lead 问题标为 needs_repair，事务错误保留 queued。
用户检查后显式继续，不自动重试。已创建正式消息的输入永远不因 Runtime 后续失败而重新入队。

同一传输请求复用 commandId 和摘要，由 CommandGateway 重放。修改输入或重新尝试使用新 commandId；
先前 rejected 结果同样会重放。最多成功发布一次由 Pending 行的发布结果和同一事务保证，独立于
commandId；再次发布已成功输入返回原 Message/Turn ID。

迁移 117 从 v1.29/schema-70 升到 v1.33/schema-71，仅增加私有表并更新 marker；不改写旧消息或执行。
