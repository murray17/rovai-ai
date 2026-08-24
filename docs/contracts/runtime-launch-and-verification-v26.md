---
document_type: contract
name: Runtime Launch and Verification
version: v26
status: accepted
source_version: v1.27
last_updated: 2026-08-24
---

# Runtime Launch and Verification v26

v26 replaces [v25](runtime-launch-and-verification-v25.md). v25 的 Runtime Home、Probe、continuation、External MCP、
逐平台准入、权限默认与 Cursor 隐藏边界全部保持不变；本版修正 ACP Prompt error 的输入确认、跨 Runtime
公开 failure，以及 AgentRun 审计时间与 Execution Budget 时间混用。

## 1. ACP Prompt error 与输入确认

Host 仍把一个 prepared Runtime Input Delivery 绑定到当前 Session 的唯一 active Prompt。stdin write/flush 和
单独的 Session event 不产生早期 ACK；History Restore replay 与 idle metadata 继续留在既有隔离 route。

匹配 `session/prompt` JSON-RPC request ID 的 response 按以下顺序结算输入：

- success response 产生 `InputAccepted`；
- error response 到达前，若当前 active Prompt 已经收到至少一个经 Host/Run/epoch/Session/Prompt/Delivery fence
  准入的非 metadata Prompt activity，则产生 `InputAccepted`，随后把同一个 response 作为 AgentRun failure；
- error response 前没有任何当前 Prompt activity 时产生 `InputNotAccepted`；
- response 前 Host 丢失仍为 `delivery_unknown`，不得从 pipe flush 或未完成的 route 猜测结果。

Prompt activity 与 matching response 必须组合使用：activity 本身不提前推进水位，matching error 本身也不能在
已经产生 Tool、assistant 或 permission activity 后把输入降级为未接收。Input disposition 必须先于同一 response
的 terminal completion 持久化。accepted input 后的失败禁止原 Run 重放，`manualRetryAllowed=false`；只有 failed
且 durable delivery 为 `not_accepted` 时才允许普通手动重试。

## 2. ACP 公开 Runtime failure

所有 Product Runtime 都可以形成既有 `RuntimeFailureView`；ACP Prompt error 至少保留 matching JSON-RPC 的
安全数字 `error.code` 与有界、脱敏 `message`。原始 `error.data`、Prompt、用户正文、Tool input/output、stderr
和私有日志不得进入公开 failure。

ACP terminal failure 使用 `origin=runtime`、`phase=execution` 和稳定 code；auth、rate limit、quota、model 与
permission 可以继续经统一分类器收敛到高价值 code。公开 `retryable` 必须同时满足 Provider 分类和 Core 输入
重试安全，Provider 的可重试提示不能覆盖 accepted input 禁止重放。

本版不修改 `RuntimeFailureView` wire shape，也不增加 Migration。历史 `public_runtime_failure_json = null` 不回填。

## 3. AgentRun 时间域

CampMessage、CampTurn、AgentRun、Conversation、Domain Event 及其 `created_at / started_at / updated_at / ended_at`
使用调用时的 UTC wall clock。`AgentRun.created_at` 表示触发输入被 Core 接受并创建 Run 的时间；`started_at`
表示 Scheduler 真正 claim Run 的时间，排队时可以晚于输入，不能改写成最后输入时间。

Execution Budget 使用独立的进程内非倒退 observation：取当前 wall clock、进程启动 wall anchor 加 awake elapsed、
以及上次 observation 的最大值。系统休眠导致 wall clock 前进时必须计入预算；wall clock 回拨不能延长已经观察到
的预算。Budget comparison/lease 可以使用该 observation，持久化审计时间仍使用当时 wall clock。重启后继续由
持久 UTC deadline 拥有跨进程边界。

## 4. Acceptance

- macOS 休眠后创建的新 AgentRun，`created_at` 与触发输入同一 wall-clock 边界，`started_at` 为真实 claim 时间；
- suspend 前后 Execution Budget observation 前进且不倒退，审计字段不使用进程启动 wall anchor；
- ACP activity 后返回 `-32603 Internal error` 时 Delivery 为 accepted、Run 为 failed、普通重试关闭；
- ACP 在任何 Prompt activity 前返回 error 时 Delivery 为 not accepted，失败 Run 可以按既有门禁重试；
- ACP failure 投影 Runtime kind、稳定 code、安全 summary/detail 与安全 retryable，不泄露私有 payload；
- Host 在 response 前退出仍进入 `delivery_unknown`，accepted ACK 水位规则不变。

## References

- [Runtime Launch and Verification v25](runtime-launch-and-verification-v25.md)
- [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
