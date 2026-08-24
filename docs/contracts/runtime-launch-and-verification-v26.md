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
逐平台准入、权限默认与 Cursor 隐藏边界全部保持不变；本版增加 TRAE CLI CN 实际 ACP Bash input 的
Adapter-scoped 公开白名单，并修正 ACP Prompt error 的输入确认、跨 Runtime 公开 failure，以及 AgentRun
审计时间与 Execution Budget 时间混用。

## 1. TRAE Bash command allowlist

通用 ACP Adapter 继续只允许非空字符串 `rawInput.command` 进入公开 `input`。`trae-cn-cli` 额外允许
非空字符串 `rawInput.Command`；这是 `traecli 0.120.52` Bash `tool_call` 的实测字段，并且只在当前
Adapter identity 已明确为 `trae-cn-cli` 时生效。

`rawInput.Command` 的相邻 `Description` 及所有未知字段保持私有，只参与完整 `rawInputDigest`。其他
Adapter 收到相同大写字段时必须 fail closed，不公开 command，也不能据此补写 `execute`。TRAE 的公开
Command 在缺少原生 kind 时可补全 `execute`；同一 `toolCallId` 的 terminal update 省略 `rawInput` 时，
Core 从当前 Prompt 的进程内 started observation 携带相同 command、kind 与 digest，不从 title、output
或 digest 反推。结构化 permission request 的 Shell argv 归一化必须复用同一 Adapter-scoped allowlist。

## 2. ACP Prompt error 与输入确认

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

## 3. ACP 公开 Runtime failure

所有 Product Runtime 都可以形成既有 `RuntimeFailureView`；ACP Prompt error 至少保留 matching JSON-RPC 的
安全数字 `error.code` 与有界、脱敏 `message`。原始 `error.data`、Prompt、用户正文、Tool input/output、stderr
和私有日志不得进入公开 failure。

ACP terminal failure 使用 `origin=runtime`、`phase=execution` 和稳定 code；auth、rate limit、quota、model 与
permission 可以继续经统一分类器收敛到高价值 code。公开 `retryable` 必须同时满足 Provider 分类和 Core 输入
重试安全，Provider 的可重试提示不能覆盖 accepted input 禁止重放。

本版不修改 `RuntimeFailureView` wire shape，也不增加 Migration。历史 `public_runtime_failure_json = null` 不回填。

## 4. AgentRun 时间域

CampMessage、CampTurn、AgentRun、Conversation、Domain Event 及其 `created_at / started_at / updated_at / ended_at`
使用调用时的 UTC wall clock。`AgentRun.created_at` 表示触发输入被 Core 接受并创建 Run 的时间；`started_at`
表示 Scheduler 真正 claim Run 的时间，排队时可以晚于输入，不能改写成最后输入时间。

Execution Budget 使用独立的进程内非倒退 observation：取当前 wall clock、进程启动 wall anchor 加 awake elapsed、
以及上次 observation 的最大值。系统休眠导致 wall clock 前进时必须计入预算；wall clock 回拨不能延长已经观察到
的预算。Budget comparison/lease 可以使用该 observation，持久化审计时间仍使用当时 wall clock。重启后继续由
持久 UTC deadline 拥有跨进程边界。

## 5. Acceptance

- TRAE 实测 `tool_call` shape `rawInput = { Command, Description }` 只公开 `Command`，并生成
  `kind = execute` 与完整 raw-input digest；`Description` 不进入公开 Evidence、Action result 或 Renderer payload；
- 同一大写 `Command` 对非 TRAE ACP Adapter 不产生公开 input 或 execute kind，稀疏 terminal update 保留
  started phase 的 TRAE command、kind 与 digest；
- TRAE stdout、stderr、mixed、empty、nonzero 与 large command-output matrix 均显示原始受控命令，
  其他相邻 raw 字段不公开；v25 的 status 与非零 exit-code 规则保持独立；
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
- [Evidence 与 Canonical Activity](../architecture/foundational-invariants.md#evidence-canonical-activity)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
- [Run Process Detail Surface v19](run-process-detail-surface-v19.md)
