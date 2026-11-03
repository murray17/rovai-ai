---
document_type: protocol-contract
contract: message-delivery
version: 18
status: accepted
authority: public-message-delivery-route-reconciliation
source_version: v1.72
last_updated: 2026-10-28
---

# Message Delivery v18

继承 [v17](message-delivery-v17.md)。以下替代 Pi、Kiro、ZCode 必须等待消费才能确认接收的要求；
版本门槛、既有通道、Run／epoch／Host 归属、停止和未知不重发规则保持。

## 接收不等待消费

`accepted` 统一表示“运行时已接收”。以下原生证据足以结算本条回执并允许顺序提交下一条：

| Runtime | 接收证据 | 不再作为接收前提的事件 |
| --- | --- | --- |
| Pi | 当前 Host 上精确 RPC ID 的成功 `steer` 响应，`disposition: queued` | user `message_start` |
| Kiro | 当前 Prompt／owner 下精确 RPC ID 的成功 `_session/steer` 响应，`queued: true` | 合并正文的 queued 通知及 `AgentExecutionSteeringInjected` |
| ZCode | 当前 Turn 下 inputId、正文、targetTurnId、pendingInputId 匹配的 `turn.steerQueued` | `turn.steerDrained` |

Kiro 连续插话时 queued 通知可能合并正文，不按通知正文重建逐条回执。
ACP 回执归属按 reader 实际观察顺序判断：有效 ACK 后原 Prompt 结束，不因等待方稍后恢复而改为未知；
原 Prompt 已结束后才收到的无归属接收响应，仍保留未知。原生明确拒绝沿用既有未接受处理。
仅写入成功、ZCode 不含目标 Turn 的通用 sendText 响应或模型文字“收到”不能替代上述证据。其他 Runtime 保持既有回执方式；
Qwen 仍需等原生 `craft/drainMidTurnQueue` 拉取才实际投递，未拉取不伪装为原生已接收。

工具执行、消费及业务结果与回执分开。插话不承诺中止正在运行的阻塞工具；收到“停止等待”这样的
消息也不自动变成取消 Run／重启任务。真正停止继续走原有停止动作。

## 停止与结束

Pi 仍关闭准入、协调已准入写入，再由停止路径先 `clear_queue` 后 `abort`，不等待消费或 Steer ACK。
晚到的精确入队 ACK 只说明此前接收，不代表停止失效或允许重发。
ZCode 已确认的 guide 继续在内存中跟踪是否 drained；原执行结束时仍有未消费 guide，先停止原生队列，
再完成原 Prompt。已接收不等于已消费，不因回执已结算而跳过清理。
使用过插话的 Pi／Kiro／ZCode Host 继续回收，不把残留队列交给另一项 Rovai Run。

不新增状态、数据库字段、正文副本、核对服务或提示词；普通消息与 Steer 仍共用 Builder、Formatter、
RUN_INPUT。原生过载错误只映射固定安全文案，不输出任意 Provider 错误或隐式重试。


## 执行窗口中的输入标记

成功路由 Steer 的事务在目标 Run／epoch 中写入一条 `agent_run.input` Evidence（kind `step`），
持久 payload 只有 `deliveryId`、`messageId`，不写入正文、附件或回执副本。每个 Delivery 只产生一个稳定标记，
位置采用同 Run 的单调 sequence；后续 command 完成、回执、回队列和收尾只推进 revision／changeSequence，不能移动标记。
分页、变化读取和连续工具分组都承认此边界；标记不作为 Runtime Tool，不计工具数。

读投影核对原 Run／epoch、同会话及未撤回的用户消息，从 Delivery／Manifest／RuntimeInputDelivery 派生
`pending | sending | accepted | delivery_unknown | not_accepted | queued`；来源无效时为 `unavailable`。
投影含 `messageId`、`deliveryId`、`status`、至多 240 个 Unicode scalar 的 `preview`、来源可用时的 `createdAt`
及 `sourceAvailable`。accepted 只表示原执行运行时接收；已转普通队列不能伪装为原执行已接收。
详情通过既有消息 around 窗口按需读取原正文，并由会话历史导航打开来源；不创建独立输入内容 API。
旧输入未保存标记时不补造历史 sequence，也不从消息时间推断其相对 command 的位置。

## Hermes 原生 Session 补充输入

Hermes 官方 ACP 的稳定 0.x 版本自 0.22.4 起使用 `session/prompt` 的 `/steer`，与普通输入共用物化和投递账本。
资格复用冻结程序身份、协议、版本和实际 Native Binding；该适配器不要求已取消使用的配置摘要。
匹配补充 RPC 的 `end_turn` 确认原生处理提交，不承诺同一原生轮次。原生可能在结束竞争中将其
作为同 Session 的下一项任务；Core 仍保留发出时的 Run／epoch，直到原请求和已发出的补充请求
全部返回才结束，期间输出、CLI 授权、回复锚点和回执均保持原归属。
明确未接受则回普通队列；`admitted_turn_failed` 记录接收及 Run 失败；其他不明结果不自动重发。
已知 Run 结束或取消则禁止新增投递。取消走原生 `session/cancel`，只清理自有 ACP，
不因接通 Steer 而把共享 Gateway 纳入回收。详见 [Hermes 合同](hermes-managed-runtime-v1.md#session-与输入)。

## 未知回执的单条边界

补充输入的 `delivery_unknown` 仅约束该条输入，不再禁用整轮插话或挡住后续新来源的顺序提交。
旧输入保持未知且不重发，新消息使用自己的输入 ID 沿既有提交／回执路径结算。
首条 start 未建立当前绑定的 accepted 证据时仍不提交补充输入；首条未知仍走既有不可用处理。
Run／epoch、当前 Session 和实际通道检查不变：明确未提交或拒绝可回普通队列，已提交结果不明不可回队列重发。
未知记录不证明通道健康，具体 Runtime 已关闭或目标失效时仍拒绝／排队；不增加探活或握手。
