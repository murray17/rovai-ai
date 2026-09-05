---
document_type: version-overview
version: v1.50
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-05
---

# Rovai-ai v1.50：本机定时 Automation

前置：[v1.49](../v1.49/README.md)。本版本在 Desktop/Core 运行且设备唤醒时触发用户持久化的
Automation。每次实际执行创建一个普通 Camp，把冻结的 Prompt 交给所选队员，并可把最终公共结果或失败状态发送到
该队员渠道 Bot 的 Owner 私聊。

## 范围与当前状态

- 新增 Automation 工作区，支持创建、选择、自动保存、启用/关闭、立即运行、删除以及日、工作日、周、一次、
  五段 Cron 和仅手动六种计划。
- Core 持久化 Automation 定义、不可变执行快照、独立通知投递；`(automationId, scheduledFor)` 是计划触发的唯一身份，
  一个 Automation 同时最多一个 `running | cancelling` 的运行。
- 领取触发、冻结快照、推进 `nextRunAt`，以及创建并关联 Camp、首条消息、CampTurn、root AgentRun 在同一 SQLite
  事务内完成；事务提交后 Runtime 才能领取 AgentRun。
- 重启不重新派发已领取运行。无关联 CampTurn 的运行直接失败；未终态 CampTurn 经 Automation 专用精确取消入口收口；
  已终态 CampTurn 按权威结果结算。
- 运行完成时冻结唯一 `resultMessageId`。只接受 root AgentRun 正式公开、未删除且无 Agent 收件人的 CampMessage；
  用户后续交流、A2A 和子 Agent 输出都不成为结果。
- 第一版在 App 退出或设备休眠期间不补跑。恢复后只记录最近一次错过为 `skipped(missed)`；并发冲突记录
  `skipped(overlap)`；一次性计划在正常、错过或冲突消费后关闭。
- 飞书、钉钉通知分别使用当前已发布的队员 Bot 和当前 Owner 身份。通知最多尝试三次，失败不重新执行任务，
  AutomationRun 成功状态不受通知失败影响。
- Agent CLI 增加 `automation list|get|create|run|close|update|delete`，Built-in Tool Transport、CLI command 和
  Runtime capability 同步升级为 v22；管理型 mutation 仍只在用户明确要求时调用。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.49 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引和前后链接建立唯一 current v1.50 |
| Decisions | 已更新 | [V1.50-D01](decisions.md#v1-50-d01)记录不可恢复的领取与原子派发；[V1.50-D02](decisions.md#v1-50-d02)记录运行和通知分离；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Scheduled Automation v1](../../contracts/scheduled-automation-v1.md)定义领域状态、事务、恢复和通知；[Built-in Tool Transport v22](../../contracts/builtin-tool-transport-v22.md)定义七项新增操作 |
| Architecture | 已更新 | [Scheduled Automation 架构](../../architecture/scheduled-automation.md)、Built-in Runtime、基础不变量与 Architecture 索引同步组件职责和控制流 |
| UI | 已更新 | [Automation 工作区](../../ui/components/automation-workspace.md)、App Shell 与组件索引记录一级入口、表单、状态和响应式行为 |
| Runtime Activity | 确认无需更新 | Automation 创建普通 CampTurn/AgentRun，并复用现有 Canonical Activity；没有新增 Runtime activity kind 或映射 |
| Runtime compatibility | 确认无需更新 | Runtime 启动、能力、模型、平台准入和 provider wire 均未变化；仅 Built-in catalog compatibility digest 升级 |
| Documentation routing | 已更新 | 文档任务导航、Contracts/Architecture/UI 索引、版本指针与当前决定导航均加入 Scheduled Automation 当前入口 |
| Root README | 确认无需更新 | README 讲解团队协作主路径而不枚举全部工作台功能；本功能由当前版本和用户指南后续发布说明承载 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Scheduled Automation v1](../../contracts/scheduled-automation-v1.md)
- [Scheduled Automation 架构](../../architecture/scheduled-automation.md)
- [Automation 工作区](../../ui/components/automation-workspace.md)
- [Built-in Tool Transport v22](../../contracts/builtin-tool-transport-v22.md)
