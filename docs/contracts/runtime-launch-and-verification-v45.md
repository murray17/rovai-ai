---
document_type: contract
name: Runtime Launch and Verification
version: v45
status: accepted
source_version: v1.72
last_updated: 2026-09-30
---

# Runtime Launch and Verification v45

继承 [v44](runtime-launch-and-verification-v44.md) 的启动、检查、恢复、权限、证据和失败边界。
本版增加 Claude Code 打印模式的双向控制通道，复用现有 Action/Approval 和结果结算。

## Claude Code 双向通道

Adapter 保留 `--print --output-format stream-json --verbose --include-partial-messages`，增加
`--input-format stream-json --permission-prompt-tool stdio`。`--permission-mode` 使用本轮冻结配置；
旧 `core_enforced_v1` 只读 Run 继续使用既有 `dontAsk` 限制。不得先以 bypass 启动后切换模式。
原生 allow/ask/deny 和用户 Hook 由 Claude 继续处理。Fast 的私有 settings 文件仍由原有机制管理。

stdin 由单个写入任务串行发送完整 NDJSON 并 flush。Adapter 先发送 `initialize` 控制请求，等待匹配
`request_id` 的成功 `control_response`，再投递结构化 `user.message`。初始化超时上限 60 秒，失败
或不兼容时收回进程树并报告失败；不得投递任务或自动回退。

stdout 持续读取。`control_request`、`control_response`、`control_cancel_request` 进入控制通道；
文本、普通工具事件、用量和结果仍进入现有输出解析。创建 Approval 与等待用户决定不能阻塞读取。
未知控制请求返回明确 error；无法可靠绑定工具身份的权限请求返回 deny 并报告不兼容。

## Claude Code 权限请求

`can_use_tool` 的原生 `request_id` 用于回复，非空 `tool_use_id` 用于关联实际工具结果。
工具名、对象 `input` 与当前进程绑定的 Run/epoch/Native Session 共同形成现有 Intercepted Action
及 Approval。缺少 ID、输入无效、Session 不符或 Run 失效时拒绝；不伪造 ID，不按命令或完整输入
反查工具身份。进程内仅保留未完成控制请求，按响应、取消、断线清理，没有累计工具调用额度。
普通输出展示所需工具状态由原有解析器拥有。

选项仅「拒绝」与「允许一次」。允许时按原 `request_id` 返回 success control response，decision 为
`{behavior: allow, updatedInput: 原 input}`；不增加永久规则。拒绝返回明确 deny/message。
Runtime Delivery 在响应实际写入并 flush 后才 ACK。用户允许不证明执行成功；Action 由同一
`tool_use_id` 的实际 `tool_result` 结算。交付失败保持现有 unknown/reconciliation 边界。

取消控制请求立即撤销待处理 ID，并通过现有 Runtime request resolution 取消未决 Approval。
断线、进程退出和 Run/epoch 取消清理待处理请求。迟到的允许无法重新创建请求或继续写入。
Action/Approval 数据库与历史保留，审批 Dock 继续提交冻结的原生选项。

## 会话结束与验证

目标 CLI 通过 `CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS=1` 发出 `session_state_changed`。
只有已收到结果、主线程轮次结束、Session 为 idle、没有未完成控制请求及 local_agent/local_workflow
任务时才关闭 stdin。一个 result 仅结束一轮，最后一个有效 result 在 stdout EOF 时决定输出与用量。
主线程后续活动保留控制通道；不会在第一个 result 自动关闭，也不会永久等候打开 stdin 的进程退出。

结果之后缺少会话状态上限 10 秒；轮次之间等待结束上限 600 秒；正常关闭 stdin 后等待进程退出
上限 10 秒。主线程活动、待处理权限请求和已跟踪后台任务暂停轮次间计时，完成后重新计时；
`task_updated.patch.status` 终态及 `task_notification` 均可结束任务跟踪。超时明确失败并按现有有界
进程树清理收尾。读流、写入和取消独立执行；写入决定改变未决状态时唤醒 reader 重算结束边界。

本机验证版本为 Claude Code 2.1.280。其他版本必须通过初始化、ID 与结束信号验证，不能据版本号
猜测兼容。原生协议参考[官方 SDK 控制实现](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/query.py)。
真实验收须核对本次 Run 的 Core 发送 receipt 和 exact message，并完成 Desktop 审批点击；旧 command
Hook 的 Smoke 记录不构成双向协议证据。确定性输入矩阵与进程边界测试的 owner 见[测试指南](../development/testing.md)。
