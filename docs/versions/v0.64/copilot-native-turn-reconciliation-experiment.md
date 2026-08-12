---
document_type: version-experiment
version: v0.64
experiment: copilot-native-turn-reconciliation
authority: p1-real-runtime-experiment-protocol
status: completed-capability-not-proven
last_updated: 2026-08-12
---

# Copilot Native Turn Reconciliation P1 实验

> 当前状态：真实 Copilot P1 矩阵已完成；被测版本不能证明旧 Native Turn 可跨 Host reconcile，
> 不声明 `native_turn.reconcile.v1`，P0 `recovery_blocked` 保持不变。

## 问题

验证 Copilot CLI Provider 是否允许 Host B 在不发送新 prompt 的前提下，仅通过 `session/load` 或其他
已公开协议重新取得 Host A 创建的同一个旧 Turn 的稳定身份、当前状态和 terminal result。实验不能用
“Session load 成功”替代 Turn 级证据。

## 当前实现审计

P1 从以下已确认的实现事实开始，不再重复把 Session 恢复当作 Turn 恢复：

- [`AcpSessionRoute.active_prompt`](../../../crates/rovai-core/src/acp.rs) 和 `PendingRpc::Prompt` 都只存在于
  当前 ACP Host 内存；Host 退出时原 JSON-RPC response route 消失；
- `acp_prompt_id(host_instance_id, request_id)` 是 Rovai 为本地 correlation 生成的 ID，不是 Provider
  返回的跨进程 Native Turn ID；
- `session/load` 当前只重建 Native Session 和运行配置，代码没有旧 Turn lookup、reattach 或 terminal
  result query；
- P0 已使 accepted-input 普通执行路径 fail closed；任何 P1 runner 都不能通过重新调用
  `session/prompt` 绕过该边界。

## 2026-08-12 无 prompt preflight

本机候选 Runtime 已完成只读预检，未启动 ACP Host、未创建 Session、未发送 prompt：

| 项目 | 观测 |
| --- | --- |
| executable | `/opt/homebrew/bin/copilot` |
| resolved symlink | `/opt/homebrew/Caskroom/copilot-cli/1.0.35/copilot` |
| reported version | `GitHub Copilot CLI 1.0.79` |
| executable SHA-256 | `637f85f8c6aa0c1b03ba0949ab2d7dbc705d2f0519802fa92c5493841d93925f` |
| relevant help surface | `--acp`、Session resume/connect flags；未列出旧 Turn lookup/status/result 命令 |

symlink 目录版本与 Runtime 自报版本并不一致，因此正式实验必须同时冻结 executable digest 与 reported
version，不能用包目录名代表 Provider 版本。该预检只确认实验候选和缺口，不是 Turn reconciliation
capability 证据。

## 2026-08-12 执行结论

正式实验使用 `/opt/homebrew/bin/copilot`、`GitHub Copilot CLI 1.0.79`、executable SHA-256
`637f85f8c6aa0c1b03ba0949ab2d7dbc705d2f0519802fa92c5493841d93925f` 和固定模型 `gpt-5.4`。
无 prompt preflight 先验证 ACP v1、进程组 SIGKILL、Host B allowlist、账本脱敏和计数器；随后三个
case 各完成两个有效重复。完整脱敏账本、逐 case artifact 与 digest manifest 位于
[P1 evidence manifest](evidence/copilot-native-turn-reconciliation-2026-08-12/manifest.json)。

| case | 有效重复 | Host A 终态窗口 | Host B 两次 load 的实际观察 | Provider Turn ID / 状态 / terminal result | 结论 |
| --- | ---: | --- | --- | --- | --- |
| Control | 2 | 正常收到 prompt response | 重放同一 completed Tool Call 与最终 Agent 文本 | `null` / `ambiguous` / `null` | capability 未证明 |
| In-flight kill | 2 | nonce 已写入、Tool Call 仍 pending 时 SIGKILL，未收到 prompt response | 两次均只重放同一 pending Tool Call | `null` / `ambiguous` / `null` | capability 未证明 |
| Terminal-before-persist kill | 2 | 收到 prompt response 后、产品终态持久化前 SIGKILL | 重放同一 completed Tool Call；最终 Agent 文本和原 prompt response 均未重放 | `null` / `ambiguous` / `null` | capability 未证明 |

六个有效样本全部满足：Host A `session/prompt = 1`、唯一 Tool Call = 1、workspace nonce = 1；每个
Host B 只发送 `initialize + session/load`，两次 load 合计 `session/prompt = 0`、执行 permission request = 0。
重复 load 没有产生第二次 Tool Call 或文件副作用。ACP v1 不暴露 Provider 模型请求 ID/计数，因此
`providerModelRequestCount` 保持 `null`，不能用 client prompt 数量冒充 Provider exactly-once 证据。

Host B 能获得的是 Session history replay，不是 Turn reconciliation：协议中没有 Provider 生成的稳定
Turn ID，没有 `running | completed | failed | not_found | ambiguous` 查询结果，也不能重新取得绑定到旧
Turn 的 prompt terminal response。Control 能回放最终 Agent 文本；但 terminal-before-persist 两轮即使 Host A
已经收到 prompt response，Host B 仍只看到 completed Tool Call，没有最终 Agent 文本。这进一步说明
Session history 不能作为旧 Turn terminal result。

正式矩阵还保留一个 excluded candidate：模型把固定 shell 字符串改写后，Host allowlist 选择
`reject_once`，因此虽然出现一个 Tool Call ID，但批准数和 workspace nonce 都为 0。runner 只对这种
已证明零副作用的无效样本创建新 Session；任何已批准或已写 nonce 的样本都不会自动重试。

最终决定：被测 Copilot 版本不具备已证明的 `native_turn.reconcile.v1`，不新增 capability catalog、
Native Turn Coordinator 或 Scheduler 路径；accepted input 继续进入明确、可操作的
`waiting/recovery_blocked`。

## 隔离与前置条件

- 使用临时 Rovai data directory、临时 Git workspace、专用 Camp/Member/Conversation；不得连接 daily
  Electron userData；
- 固定 Copilot CLI executable path、reported version、model、permission config 和 installation generation；
- prompt 只允许一个可计数的本地副作用，例如向临时 workspace 的唯一文件追加一个 nonce；禁止网络和
  仓库外写入；
- 记录 Provider stdout/stderr JSON-RPC、Rovai Runtime Input Delivery、Host instance/request ID、Session ID、
  所有 Tool Call、文件 hash 与进程退出时间；秘密和认证内容必须脱敏。

## 实验矩阵

每个 case 使用全新的 data/workspace/session，至少重复两次：

1. **In-flight kill**：Host A 获得 prompt accepted 证据、Turn 尚未 terminal 时 SIGKILL Host A；
2. **Terminal-before-persist kill**：Host A 已从 Provider 收到 terminal response，但 Core 尚未持久化 Run
   terminal 时 SIGKILL Host A；
3. **Control**：不 kill，证明 prompt、Tool Call、terminal result 和文件 nonce 正常各发生一次。

## Host B 约束

Host B 只能 initialize 并 load 同一 Session；不得调用 prompt/new-turn API，不得发送原文或任何 continuation，
不得用 Rovai 的 `acp-prompt-*` correlation 猜测 Provider Turn。观察窗口结束前记录 Provider 主动事件和可用
query 响应。

## 必须回答的观测问题

- Provider 是否返回跨进程稳定、由 Provider 生成的 Native Turn ID？
- Host B 能否区分 `running | completed | failed | not_found | ambiguous`？
- completed/failed 时能否重新读取同一 Turn 的 terminal result？
- lookup/reattach 是否明确不会创建新的模型调用或 Tool Call？
- 重复 reconcile 是否幂等？
- 文件 nonce、Tool Call 和模型请求是否始终恰好一次？

## Evidence artifact

每次重复必须输出一个脱敏、可机器校验的 JSON artifact，至少包含：

```json
{
  "case": "in_flight_kill | terminal_before_persist_kill | control",
  "repetition": 1,
  "providerVersion": "captured at runtime",
  "executableDigest": "sha256:...",
  "model": "captured at runtime",
  "hostA": {
    "instanceId": "...",
    "promptRequestCount": 1,
    "acceptedObserved": true,
    "killedAt": "..."
  },
  "hostB": {
    "instanceId": "...",
    "sessionLoadCount": 1,
    "promptRequestCount": 0,
    "lookupRequestCount": 0
  },
  "providerTurnId": null,
  "observedState": "not_found",
  "terminalResultDigest": null,
  "modelRequestCount": 1,
  "toolCallCount": 1,
  "workspaceNonceCount": 1,
  "verdict": "capability_not_proven"
}
```

`providerTurnId`、`observedState` 和 `terminalResultDigest` 必须来自 Provider 协议证据；无法取得时保持
`null/not_found/ambiguous`，不得用 Session ID、Rovai prompt ID 或推断值填充。raw ledger、文件 before/after
hash、进程时间线与 artifact digest 组成同一 evidence bundle。

## 通过条件

只有两个 kill case 的全部重复均满足以下条件，才能提出 `native_turn.reconcile.v1`：

- Host B 不发送 prompt，仍取得同一 Provider Turn ID；
- 得到稳定且可重复查询的状态；terminal case 可读取完整 terminal result；
- 模型请求、Tool Call 和文件副作用各一次；
- 重复 lookup/reattach 不改变状态、不新增执行；
- `not_found` 与 `ambiguous` 有不同、可机器判定的结果。

任何缺失都记为 capability 未证明，而不是“可能支持”。未通过时保留 P0 `recovery_blocked`，不修改
Scheduler fence。

## 实施与复核入口

[`experiment-copilot-native-turn-reconciliation.mjs`](../../../scripts/experiment-copilot-native-turn-reconciliation.mjs)
使用临时 Git workspace/data/log 路径和直接 ACP JSON-RPC Host，提供固定模型门槛、精确一次 permission
allowlist、进程组 kill hook、Host B outbound allowlist、raw Provider ledger 脱敏与 evidence manifest。
它不经普通 Scheduler，也不把杀 Core 后重新调度当作 Turn reattach。

- `pnpm experiment:p1:copilot-native-turn -- --preflight-only --output <empty-directory>`：只运行无 prompt preflight；
- `pnpm experiment:p1:copilot-native-turn -- --output <empty-directory>`：运行默认 2 × 3 矩阵；
- `pnpm test:p1:copilot-native-turn-evidence`：离线校验当前 evidence 的 digest、allowlist、kill window、计数和脱敏。

正式实验的 preflight 已通过。未来只有 Provider 暴露新的稳定 Turn identity/status/result 协议面时，才有理由
在新的 executable digest 上重跑并重新评估 capability。
