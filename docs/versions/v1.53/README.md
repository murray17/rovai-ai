---
document_type: version-overview
version: v1.53
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-06
---

# Rovai-ai v1.53：运行中网络中断安全自动恢复

前置：[v1.52](../v1.52/README.md)。本版本不改变 App/Core 重启后的恢复承诺，不新增持久重试队列，也不把
`retryable` 泛化为自动重发权；只在同一 App/Core generation 内为有强网络证据且明确未接收输入的执行增加安全续接。

## 范围与当前状态

- Core 增加职责单一的进程内网络恢复队列，固定使用 `1, 2, 3, 5, 10, 15, 30, 30...` 秒且无 jitter；每档从前一
  attempt 结束时起算，无登记项时不轮询。
- ACP Prompt 仅在 failed terminal、当前 Delivery 为 `not_accepted` 且严格网络 classifier 通过时，于普通失败结算前
  转为 `waiting/network_recovery`；旧 Prompt route 先解绑，新 attempt 继续经正式 Scheduler/Fleet。
- 每次 attempt 重验 Run/version/epoch、取消、预算、成员、授权、Input Delivery、Approval、Action 与 Runtime Delivery；
  accepted、unknown 或已开始 dispatch 的输入不重发。
- `online` 与系统 resume 只提前唤醒安全检查；重复信号合并，in-flight singleflight，不直接调用 Adapter，也不重置
  backoff。
- Runtime Input 在新 epoch 被正式接受后才清除网络恢复提示；连接或 Session 建立本身不算任务恢复。
- Renderer 与共享渠道 presentation 增加“连接中断，等待恢复”“正在恢复”“需要处理”，并保留 Run Stop、既有输出、
  草稿、附件、Approval 与 Evidence。
- 自动接管代码已接入十个 ACP Adapter 共用的 prompt terminal/not-accepted seam；在真实双链路 qualification 完成前，
  这些只算候选覆盖，不声明任一 Adapter/平台已获网络恢复资格。Claude Code 现有原生 API retry 仍由 Runtime 单独拥有；
  Codex、Pi、Antigravity、ACP Host 未分类退出、accepted/unknown 输入及无强网络证据阶段保持既有终态或人工处理边界。
- 自动化实现与定向回归已经完成；隔离数据目录下的真实 Runtime 两链路验收尚待执行，因此
  `implementation_status` 暂保持 `in_progress`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.52 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引和前后链接建立唯一 current v1.53 |
| Decisions | 已更新 | [V1.53-D01](decisions.md#v1-53-d01)记录 Core 进程内固定退避与 Input Delivery 安全门禁；CURRENT 已连接当前权威 |
| Contracts | 已更新 | [Network Interruption Recovery v1](../../contracts/network-interruption-recovery-v1.md)冻结分类、节奏、状态、命令、安全、生命周期和验收边界 |
| Architecture | 已更新 | [AgentRun Recovery](../../architecture/agent-run-recovery.md)与[恢复、取消和计划关闭不变量](../../architecture/foundational-invariants.md#runtime-recovery-shutdown)同步 live recovery owner/data flow |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)同步三种状态、清除条件与 Stop 保留规则 |
| Runtime Activity | 确认无需更新 | 网络恢复继续使用既有 Runtime diagnostic、AgentRun 领域事件和 Canonical Activity；未新增 activity kind、classifier 或 replay |
| Runtime compatibility | 确认无需更新 | 未改变 Runtime 支持版本或平台 qualification；真实恢复验收缺失不会自动晋升任何组合 |
| Documentation routing | 已更新 | 文档任务导航、Contracts/Architecture 索引与当前决定导航均加入 Network Interruption Recovery v1 |
| Root README | 确认无需更新 | 项目定位、安装方式和常青支持范围不因一个受限执行恢复 seam 改变 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Network Interruption Recovery v1](../../contracts/network-interruption-recovery-v1.md)
- [AgentRun Recovery](../../architecture/agent-run-recovery.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
