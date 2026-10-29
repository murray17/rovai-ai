---
document_type: protocol-contract
contract: run-process-detail-surface-v56
authority: conversation-run-presence-surface
status: accepted
version: 56
source_version: v1.72
last_updated: 2026-10-28
---

# Run Process Detail Surface v56

继承 [v55](run-process-detail-surface-v55.md)，修正启动文案、停止反馈和右侧预览的自动导航；
状态图标仍在执行台时间线上。

- 已创建的 `queued` Run 与 `running/runtime_initializing` 统一显示“启动中…”，复用同一张 Run Card。
  空启动卡不展示空过程或耗时；当前 epoch 的真实正文、计划或工具活动到达后展示实际进展。
  现有等待／网络恢复优先，历史 epoch 活动不能伪造本轮已开始执行。
- 未形成 Run 的 waiting Delivery 默认显示“准备中…”。仅利用当前执行台已有的同队员公开执行、
  未 ACK 的清理请求或既有 `waitCondition` 展示“排队中”；不增加 Core 字段或调度判定。
  等待前序执行／清理的原因仅作为悬浮说明，不再独立显示“等待清理”或计时升级提示。
- 停止请求提交期间，Run Card 头部仅显示一处中性的“正在停止…”，隐藏该卡停止按钮，保留展开、
  已有摘要和步骤；步骤组不替换为停止提示。单聊及独立过程视图使用同样的紧凑文字，移除有色块与左竖线。
  状态文字统一使用现有界面字体、11px、400 字重。终态优先，已取消 Run 不因后台 cleanup 继续显示停止中。
- 不修改 AgentRun／Delivery 持久化状态、Scheduler、互斥、Runtime、恢复 ACK、取消事务或 cleanup。
  不通过等待时长推断阻塞，不引入新的全局阶段引擎。未知停止回执仍遵守既有确认流程。

验证沿用共享展示、Renderer 及 `pnpm test:run-presence-ui` 的现有 owner，覆盖启动一致性、停止按钮、
已完成步骤保留、终态优先及时间线图标位置。

## 右侧预览的自动导航

执行 placement 为 `right`，且共享 Pane 可见、当前 Tab 为 `file`、`file_change` 或
`mission_activity` 时，发送后自动聚焦 Run 与进入／返回 Thread 自动打开执行均不得覆盖该选择。
本次自动请求直接消费，不在文件关闭、Pane 收起、Run 或权威 snapshot 晚到后补跳。
这补充继承的“新建任务”保护，不改变已有执行记录、Core 状态或请求回执。

判断只使用当前 Pane 可见性及选中 Tab；加载中／失败文件同样受保护，后台文件标签不构成保护。
空 Pane、已选执行或未展开预览继续既有规则。显式执行入口、移动执行位置和精确 Run 通知定位仍可打开执行。
验证由 `pnpm test:file-preview-layout` 覆盖发送前后选择、Diff／活动、立即／延迟首屏、
Thread 切换、请求消费和显式通知导航。
