---
document_type: renderer-contract
contract: run-process-detail-surface-v5
authority: agent-process-detail-recovery-and-planned-shutdown-terminal-surface
status: accepted
last_updated: 2026-08-12
---

# Run Process Detail Surface v5（Planned Shutdown 终态来源）

本合同继承 [Run Process Detail Surface v4](run-process-detail-surface-v4.md) 的 Agent 级连续过程、Accepted
Input blocker 与唯一 Execution Drawer，并替代 v4 作为当前 Renderer 入口。v5 只增加稳定 terminal source /
reason 投影和 cancelled Run 的 unsettled-effect 修正。

## 1. Planned-shutdown cancellation

当 AgentRun 满足：

```text
status = cancelled
terminalResolutionSource = runtime_terminal
terminalReasonCode = planned_shutdown_cancelled
```

Run Pulse 使用“已停止”，Drawer 说明“因 Rovai 计划关闭，Runtime 已确认取消本次执行。”。它不使用普通
CampTurn Stop 的“已取消”文案，也不暗示 Core 根据进程退出推断了取消。

planned-shutdown `failed` 保持失败语义，并可显示“Rovai 关闭期间 Runtime 返回失败”；成功仍显示普通完成，
不增加新的主状态或视觉色族。

## 2. Unsettled external effects

`hasUnsettledExternalEffects=true` 时，无论 Run 主状态是 failed 或 cancelled，都必须显示“外部效果待确认”
警告。Renderer 不得再用 `status !== cancelled` 隐藏该事实。警告沿用 attention/danger 文本、图标和现有
Drawer 布局，不新增自动 retry、成功确认或单 Run Stop。

## 3. Data 与 accessibility

Renderer 只读取 CampSnapshot 的 `terminalResolutionSource` 与 `terminalReasonCode`，不解析 event、进程
状态或错误正文。文案必须在 Day/Night、`1040×700` 与 200% zoom 下换行可读，并以文字和现有语义图标
共同表达结果；不增加 spinner、倒计时或退出控制。
