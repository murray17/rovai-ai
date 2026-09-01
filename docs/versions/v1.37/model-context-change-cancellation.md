---
document_type: model-context-change
version: v1.37
revision: 2
confirmation_status: confirmed
confirmed_revision: 2
confirmed_by: murray.xue
confirmed_at: 2026-09-01
last_updated: 2026-09-01
---

# 取消事务与 Runtime Input 发送边界

## 变更前

Runtime Input Delivery 的状态保持 `prepared | accepted | delivery_unknown | not_accepted`。
`prepared` 同时包含尚未发送与已经发送但未收到回执；取消 ACK 在 Runtime 清理之后处理它，
并依赖 Run version 和永久 command receipt。取消、输入回调交错会令 ACK 过期且重试幂等冲突。

## 变更后

在原 Runtime Input Delivery 全部字段之外只增加 `dispatch_started_at TEXT NULL`。
此字段不进入模型 payload、ContextManifest 或 Runtime request digest；它记录当前 attempt
在数据库提交的发送准入。只有 `prepared`、尚无发送时间且 Run/Turn 仍允许执行时，
`begin_runtime_input_dispatch(delivery_id, agent_run_id, execution_epoch)` 才能写入该字段。
更新失败不得调用 Runtime send、prompt 或 append。

取消先提交则拒绝发送；发送准入先提交则取消保留未知结果。`prepared` 且时间为空可关闭为
`not_accepted`，非空则关闭为 `delivery_unknown`；accepted/unknown 的证据不能降为未发送。
已明确拒绝的同一 delivery 重新 prepare 时重置发送时间，接受与取消后的迟到观察只补证据。
取消事务命中的 Run 一律为 cancelled；是否存在 accepted/delivery_unknown Input 或可能派发的 Action 只决定底层
审计证据，不把取消改写为 failed/accepted_input_outcome_unknown，也不产生公共外部效果待确认提示。原输入仍禁止
自动重发；普通 Recovery Blocker 的显式结束继续使用 failed/accepted_input_outcome_unknown。
Run/Turn 的终态、相应 Delivery/Gather 结算在取消事务完成；Runtime 清理不再拥有业务终态。

## 明确不变

Session Charter、Bootstrap、Dynamic Context、History/Task/Gather 的输入选择与预算、模型字节、
冻结 Native Binding 与 request digest 算法不变。Formatter 22、ContextManifest 22、Bootstrap v3 / Formatter 3、
Charter revision 3、Context Delivery Profile 4 与 Built-in v21 不变。
成员离队复用现有定向 membership cutover 集合，不新增依赖图，也不扩大为整轮停止。

## 版本、迁移与恢复

新增迁移仅增加 nullable 发送时间与取消所需的窄索引/渠道重试抑制信息，不清洗全库历史事件。
旧 prepared 无法证明未发送，升级时只针对该非终态输入保留 unknown 证据；不重写历史 accepted input。
初版取消事务已写入的精确 `failed + accepted_input_outcome_unknown + cancel_requested_at` 历史形状只在 Read Side
兼容投影为 cancelled 且无公共待确认提示；SQLite、Input/Action evidence、事件和 cleanup ACK 不改写。
旧半取消工作仅在目标 Camp 打开或该 Camp 的新渠道入站时定向收敛，不扫描全部历史 Camp。
Runtime cleanup 复用 launch permit、active execution 与受管进程；超时保留未知，不允许同一
Conversation 旧新执行重叠，也不无限 queued。

## 二次确认

开发者提供了完整的取消重构方案，随后提供包含上述新增字段、发送前条件更新 SQL、取消分类、
active launch token 和有界清理的完整修订。在本会话对该修订复核后，开发者于 2026-09-01
回复“同意，这一处按现有成员离队语义补正”，并逐项明确原 cutover 集合、事务内终态及渠道边界。
revision 1 记录该已确认方案。真实主动停止随后暴露 #153 把取消原因与发送/效果证据混为失败终态；开发者于
2026-09-01 明确要求改掉该规则、取消后显示已取消且不干扰后续工作。revision 2 据此只修正终态与公共提示，
不授权修改模型可见内容、新增 Runtime Input 状态、删除审计证据或放宽 cleanup fence。

## 验证

扩展已有取消、输入投递、成员离队、渠道 FIFO 与 launch admission 的测试 owner：
发送准入/取消的两个确定顺序；accepted/unknown 保留；迟到回执不能复活 Run/Turn；
成员自己的 Run 与受影响 delivery 目标同事务结束，无关 Run 保留；重复取消幂等；
后台回收超时不能无限阻塞下一个 Run；#153 历史行公开归一为已取消且不影响普通 recovery failure。
所有数据库/进程 fixture 隔离，不操作日常 App。
