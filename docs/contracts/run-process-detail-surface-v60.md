---
document_type: protocol-contract
contract: run-process-detail-surface-v60
authority: conversation-run-presence-surface
status: accepted
version: 60
source_version: v1.72
last_updated: 2026-11-22
---

# Run Process Detail Surface v60

继承 [v59](run-process-detail-surface-v59.md) 的执行行保留、取消与继续资格，以及其中继承的子代理展示规则。

- 公开会话的执行行、执行台队员状态、执行卡与回执详情共用状态词。终态为已完成、执行失败、已停止。停止提交中显示“正在停止…”。
  同一 Run 有待审批、同一轮有待回答的原生问题，或等待原因是 approval、user_input、network_recovery_blocked、delivery_unknown、旧版 recovery_blocked 时，显示“需要你处理”与具体原因。
  网络重连、运行恢复、投递恢复显示“正在恢复”。其余非终态显示“执行中”，执行行优先提供已有的进度文字。
- 回执汇总尚未开始的普通排队、插话投递，以及执行行和历史中断标记均未承接的失败或停止。插话投递状态与核对资格取自 [Message Delivery v20](message-delivery-v20.md)。
  每名收件人只计一项。单人接收显示“插话 · {队员}已收到”，多人分项计数。有执行行的普通目标从执行行查看过程。
- 当前已接受但结果无法确认的执行按普通失败显示。失败有明确原因时显示“执行失败 · 原因”，有可展开详情时允许“查看原因”。执行卡的失败／停止状态位保留原因，即使后续执行已收起原行。App 退出取消的原因为“应用已退出”。
- 排队卡统一显示“排队中”。同队员尚有在途执行时，提示“等待上一轮完成”。执行行的“重试”保留刷新图标，“继续执行”用播放图标，按钮保留各自的可访问名称。
- 执行卡插话行正常阶段统一显示“插话 · 正文摘要”，行尾提示与读屏名称区分待发送、发送中和已收到。
  未确认送达、未送达、已转为排队、来源已删除或不可用时，标题直接显示具体状态。

详细的错误码与原因对应表见[已接受的 R5 提案](../versions/v1.72/status-convergence-proposal.md)。单聊与渠道卡片沿用原展示。
