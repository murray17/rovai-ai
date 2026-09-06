---
document_type: version-decisions
version: v1.53
lifecycle: current
last_updated: 2026-09-06
---

# v1.53 决定

<a id="v1-53-d01"></a>
## V1.53-D01：Core 进程内固定退避，只有可证明未接收的输入才自动续接

### 背景

短暂断网可能让仍有效的用户任务在 Runtime terminal seam 直接失败，但“失败可重试”不等于原输入可安全重发。
Provider 可能已经接收输入或产生工具／消息效果；把所有 retryable error 自动 replay 会造成重复副作用。另一方面，把
网络 timer 放在 Renderer 会使最小化、页面切换或窗口未挂载时失去恢复能力；新建持久队列又会复制 AgentRun、Input
Delivery 和现有 Startup Recovery 的权威。

### 决定

Core 在同一 generation 内维护最小内存索引，使用无 jitter 的固定 `1, 2, 3, 5, 10, 15, 30, 30...` 秒退避。
网络／系统恢复信号只提前唤醒同一安全检查，不直接发送。每次 attempt 通过 system-only 领域命令把明确
`not_accepted` 的 ACP terminal Run 从 `network_recovery` 移交给既有 `runtime_recovery` Scheduler；Scheduler/Fleet
继续拥有 claim、epoch、lease 与并发。Runtime Input accepted 是清除故障周期所需的首个有效进展证据。

网络类别采用结构化 code 优先和封闭文本 allowlist，并显式排除 auth、permission、quota、model、config、cancel、
rate limit 与 server error。任何 accepted、delivery-unknown、dispatch-started 输入或未结算 Approval/Action/Runtime
Delivery 都 fail closed。Claude Code 明确仍在原生 API retry 时不登记 Rovai timer，保证任一时刻只有一个恢复 owner。

### 后果与被拒绝方案

- 页面切换和窗口最小化不影响 Core timer；无待恢复项时没有周期轮询。
- 退避不跨 Core restart 持久化；遗留 `network_recovery` marker 在启动时回交既有 Startup Recovery，而不是恢复旧
  deadline。退出、取消和预算不获得新例外。
- 当前只有 ACP terminal/not-accepted seam 取得 Rovai 接管；无法证明安全的 Adapter/phase 继续失败或人工处理，不能为
  扩大表面覆盖而盲发。
- 拒绝由 Renderer `online` 直接重发：它既不拥有业务状态，也不能证明目标 Provider 或 Input Delivery。
- 拒绝持久 Outbox／事件重放：它会复制 Run/Input 权威并无意扩大跨重启承诺。
- 拒绝“统一 ping 成功即重置”：公共网络可达不证明目标 Runtime 恢复，也会让重复 signal 绕过 backoff。
- 拒绝先把 Run 终结再复活：终态是不可逆历史；恢复资格必须在 terminal settlement 前接入。

当前规范见 [Network Interruption Recovery v1](../../contracts/network-interruption-recovery-v1.md)、
[AgentRun Recovery](../../architecture/agent-run-recovery.md)与
[Camp 会话工作区](../../ui/components/conversation-workspace.md)。

