---
document_type: version-decisions
version: v1.71
authority: decision-rationale
lifecycle: current
last_updated: 2026-09-27
---

# v1.71 版本决定

<a id="v1-71-d01"></a>
## V1.71-D01：本轮完成由通知投影归并消息关联，不恢复执行聚合

- 状态：accepted
- 日期：2026-09-27
- 当前权威：[通知架构](../../architecture/notification-episodes.md)、[Notification Episode v9](../../contracts/notification-episode-v9.md)

### 背景

一次用户消息可以唤醒多位队员，后续消息又可与新输入一起被领取。每个 Run 成功都弹完成会重复打断用户；
按 Camp 空闲判断会错误归并同一会话中的独立请求。使命和任务状态也不能由聊天文字推测。

### 选择

以全部 AgentRunInput、消息 source Run 与等待/领取中的 Delivery 形成通知专属关联图，全部成功结算才产生
一条完成事实。业务状态转换直接拥有自己的来源和偏好，问题正文只来自显式消息引用。沿用持久事实、精确确认
和前台 Camp 静默；按同一来源 ID 合并临时卡片。

### 后果

- 跨 Run 图判断增加通知投影查询成本，需要消息来源和输入反向索引；完成身份独立持久化以承受重放。
- 任一失败或取消都会阻止本轮成功；失败保留精确 Run 来源。
- Mission/Task 需要独立设置、状态过滤与导航，不能复用提及卡片伪造业务来源。

### 未选择方案

- 按 Run 成功提醒：把执行细节直接变成用户打断次数。
- 按 Camp 空闲归并：无法区分同 Camp 的独立因果链。
- 恢复 CampTurn 作为调度聚合或要求队员补充确认字段：扩大了本次通知改动的执行与模型输入边界。
