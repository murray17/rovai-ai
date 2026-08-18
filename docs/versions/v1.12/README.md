---
document_type: version-overview
version: v1.12
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-19
---

# Rovai-ai v1.12：AgentRun 局部停止

> 当前状态：正式合同、Core、Read Model、Desktop transport 与共享 ExecutionDrawer 已完成并通过版本门禁。
>
> 前置版本：[v1.11 Runtime 模型目录缓存与真实执行校验](../v1.11/README.md)。v1.11 已完成并冻结为
> historical。
>
> 后续版本：[v1.13 AgentRun 实际 Runtime 模型展示](../v1.13/README.md)。

## 版本目标

在不改变 Composer CampTurn Stop 的前提下，为共享执行详情提供真正的 AgentRun 局部停止。用户可以只停止
当前聚焦 Run，兄弟 Run 与已接受 Delivery 继续收敛；Core 不写 Turn cancellation、不创建公共时间线消息，
并在取消请求提交后立即禁止该 Run 发起新的领域写入。

## 交付范围

### 合同与 Core

- `agentRuns.cancel` 只允许本地 User 调用，使用 `campId / agentRunId / expectedVersion`；
- 首次接受只写目标 Run 的取消请求、原因与版本，追加 `agent_run.cancel_requested`，随后唤醒既有 coordinator；
- method 绕过普通 Core 主请求队列，不取消兄弟 Run、Turn 或 pending Turn deliveries；
- 已请求与已终态返回稳定结果，Run-local reason 为 `user_requested_agent_run_stop`；
- 取消请求提交后，所有 AgentRun 身份写入要求 `cancel_requested_at IS NULL`。

### Read Model 与 Desktop

- `AgentRunView` 投影 `cancelRequestedAt / cancelReasonCode / cancelAcknowledgedAt`；
- 完整 CampSnapshot 使用 Read Model schema 31，Camp Open 使用 schema 2；
- Core method、Electron allowlist、App callback 与 Run-local request/uncertainty state 完整接线；
- Snapshot 继续是停止中、已停止与最终 Turn outcome 的唯一权威。

### 共享 ExecutionDrawer

- AgentRun Stop 只位于 Drawer 顶栏并与“收起”并列，底部/Inspector 复用同一入口；
- `recovery_blocked` 保留唯一“结束此运行”，不显示普通 Stop；
- required/optional Run 的确认层分别说明对本轮完成的真实后果；
- 超时或断连显示“正在确认停止状态”，不提前宣称失败或重新开放停止。

## 明确不做

- 不重建 cancellation coordinator，不新增 CampTurn 状态；
- 不增加 Header、Task、时间线或第二个 Composer 入口；
- 不写 Turn cancellation，不取消兄弟 Run 或批量 Delivery；
- 不创建 CampMessage，不把取消原因复用为 Runtime `terminalReasonCode`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.11 冻结为 historical；本概览、实施计划与版本索引建立唯一 current v1.12。 |
| Decisions | 已更新 | [V1.12-D01](decisions.md#v1-12-d01)记录双层停止入口、Run-local 取消权威与立即写 fence。 |
| Contracts | 已更新 | [Run Process Detail Surface v10](../../contracts/run-process-detail-surface-v10.md)与[Camp Open Projection v2](../../contracts/camp-open-projection-v2.md)冻结命令、状态和 wire shape。 |
| Architecture | 已更新 | 基础不变量、AgentRun Recovery 与 Camp Open Read Path 区分 Turn/Run cancellation 并路由新 schema。 |
| UI | 已更新 | Camp 会话工作区只在共享 ExecutionDrawer 增加 AgentRun Stop，保留 Composer 与 Recovery Blocker 语义。 |
| Runtime Activity | 确认无需更新 | 本版复用既有 cancellation coordinator 与 activity cancelled/stopped 投影，不增加 canonical activity kind。 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime capability、已实测版本或兼容性资格。 |
| Documentation routing | 已更新 | 文档导航、Contract 索引、Decisions CURRENT 与 Architecture 路由切换到 v10/v2/v1.12。 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持 Runtime 集合不变，版本流水账不进入根 README。 |

## References

- [v1.12 实施计划](implementation-plan.md)
- [v1.12 决策记录](decisions.md)
- [Run Process Detail Surface v10](../../contracts/run-process-detail-surface-v10.md)
- [Camp Open Projection v2](../../contracts/camp-open-projection-v2.md)
- [AgentRun Recovery](../../architecture/agent-run-recovery.md)
