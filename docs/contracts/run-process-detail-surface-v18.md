---
document_type: renderer-contract
contract: run-process-detail-surface-v18
authority: agent-process-live-runtime-diagnostic
status: accepted
source_version: v1.20
last_updated: 2026-08-21
---

# Run Process Detail Surface v18（运行中 Runtime 重试）

本合同完整继承 [Run Process Detail Surface v17](run-process-detail-surface-v17.md) 的 Inspector、执行台位置、
进入恢复、Tool chronology、命令详情、停止、阅读位置和焦点语义。v18 只增加当前非终态 AgentRun 的安全
Runtime 重试诊断展示。

## 1. 展示条件与位置

当前 Run 为 non-terminal，且其 Execution Evidence 含合法 `runtime.diagnostic` / `runtime_api_retrying` 时，
精确 Run disclosure 必须在过程内容中显示 attention notice。标题固定为“Claude Code API 暂时不可用”；正文
显示立即重试或等待秒数、最新 `attempt/maxAttempts`，并明确“本次执行尚未结束，可继续等待或停止执行”。

同一 `diagnosticId` 的多个事件只显示最新合法 attempt，不能堆叠相同警示。底部通用“正在处理”同步替换为
“等待 Claude Code 自动重试（N/M）”，使折叠过程附近也能辨认当前状态。

## 2. 状态诚实性

重试 notice 是 live Runtime status，不是终态失败、Tool、Narration、Approval、Camp Message、Toast 或通知中心
事件。AgentRun 仍显示“执行中”，停止入口继续使用既有权威命令；Renderer 不得因为 API 重试自行写入 failed、
结束时间或 failure 文案。

Run 成功、失败、取消或进入其他终态后，旧 retry notice 必须消失。真实终态失败继续使用既有安全
`RuntimeFailureNotice`，不得用最后一次重试状态遮盖或替代。

## 3. 数据最小化与恢复

Renderer 只消费合同允许的 `diagnosticId`、固定 code/status、attempt、maxAttempts 与 retryAfterSeconds；未知 code、
非整数或越界计数全部忽略。原始 stderr、API 响应体、凭证、用户名和绝对路径不得进入 DOM、辅助技术名称、
title、地图播报或调试展示。

Camp 重进和应用恢复从持久 Execution Evidence 得到相同结果；live event 与恢复投影必须使用同一字段校验和
分组规则，不能依赖动画、计时器或 Renderer 私有猜测。

## 4. 可访问性与视觉

notice 使用 polite live status 和 atomic announcement；标题、次数和“尚未结束”语义必须能被辅助技术完整读取。
Day/Night、底部/Inspector、200% zoom 与 Forced Colors 下保持可读，不产生页面级横向溢出，也不通过持续动画
制造紧迫感。

## 5. 验收

- Run 仍在运行时，attempt 1/10 后收到 2/10，只显示 2/10；
- `retryAfterSeconds = 0` 显示立即重试，正整数显示对应秒数；
- notice 与 spinner 文案都明确等待 Claude Code 自动重试，Run 状态仍为“执行中”；
- raw/private 字段即使混入输入 payload 也不出现在 DOM；
- terminal Run 不显示 stale retry notice，真实 failure 仍按既有终态边界显示；
- diagnostics 不产生 Tool 行，世界地图只作安全的重试状态播报；
- 双主题、键盘、读屏、底部与 Inspector placement 均可使用。

## References

- [Run Process Detail Surface v17](run-process-detail-surface-v17.md)
- [Runtime Launch and Verification v15](runtime-launch-and-verification-v15.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
