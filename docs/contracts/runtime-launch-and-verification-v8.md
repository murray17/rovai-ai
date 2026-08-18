---
document_type: contract
name: Runtime Launch and Verification
version: v8
status: accepted
source_version: v1.10
last_updated: 2026-08-18
---

# Runtime Launch and Verification v8

本合同完整继承 [v7](runtime-launch-and-verification-v7.md) 的 purpose-scoped launch、light discovery、
显式检查、execution-deferred verification、TRAE continuation/HistoryRestore、Ready commit 与 fencing，
并增加 Claude Code 和 Antigravity 的安全公开失败合同。v8 不改变 Codex、ACP、TRAE 或其他 Runtime。

## 1. 公开结构与适用范围

公开失败只允许用于 `claude-code-cli | antigravity-app`：

```ts
interface RuntimeFailureView {
  runtimeKind: 'claude-code-cli' | 'antigravity-app'
  origin: 'runtime' | 'compatibility' | 'environment' | 'rovai' | 'unknown'
  phase: 'spawn' | 'authentication' | 'model_catalog' | 'execution' | 'terminal'
  code: string
  summary: string
  detail: string | null
  retryable: boolean
}
```

`origin=runtime` 要求 Runtime 或 Provider 明确返回错误；`compatibility` 表示参数、输出格式或协议与当前
集成不兼容；`environment` 表示 executable、cwd、权限、附件根或本机条件不可用；`rovai` 只在有明确
Core 状态、持久化或配置生成证据时使用；证据不足必须为 `unknown`。任意无法 downcast 为 typed Runtime
failure 的 `anyhow` error 不得默认升级为 `runtime`。

## 2. 内部诊断与公开 failure 分离

完整 `anyhow` chain、内部 `error_detail`、原始 stderr、Antigravity 私有日志、exit status、byte count 与
digest 继续留在内部诊断边界。公开 `detail` 只由窄 sanitizer 生成：

- 移除 ANSI escape、不可见控制字符并合并多余空白；
- 最多 4 行、总计 2,048 Unicode scalar；summary 最多 240 scalar；
- 隐去 Home、项目目录、runtime-private、临时目录与 executable 绝对路径；
- 隐去 token、authorization、bearer、cookie、api_key、secret 与 credential；
- 不包含 Prompt、用户消息、Tool input 或完整 Tool output。

任何内部 digest 都不是用户可读原因。Antigravity 私有日志只能由 fixed-format extractor 读取已知错误行；
完整日志不得复制到公开字段。

## 3. Claude Code typed failure

`ClaudeCodeDeliveredFailure` 必须携带 Native Session、Native Turn、稳定 `error_code` 与
`RuntimeFailureView`。规则固定为：

- final result 的 `is_error=true` 或 subtype 非 success：以 `output.result` 形成清理后的 detail，默认
  `runtime + terminal + runtime_terminal_failure`；
- 非零退出：公开 detail 优先取 bounded stderr 的安全摘要；内部仍记录 status、bytes 与 digest；
- 未登录/认证失效、限流、配额、模型不可用或无权、权限拒绝分别使用
  `runtime_authentication_required / runtime_rate_limited / runtime_quota_exceeded /
  runtime_model_unavailable / runtime_permission_denied`；
- 其他明确 Runtime 失败使用 `runtime_process_failed | runtime_terminal_failure`；
- `--mcp-config` 被拒、unknown/unrecognized/unsupported option、stream-json 无法解析、必要 final 字段缺失、
  Session ID 缺失/不一致或多个 final result 使用 `compatibility`；
- executable 不存在/不可执行、execution directory 或 attachment root 不可访问、spawn permission denied
  使用 `environment`。

## 4. Antigravity typed failure

`AntigravityDeliveredFailure` 同样携带 Native Session、Native Turn、稳定 `error_code` 与公开 failure：

- structured final 非 success：依次使用结构化 `error / message / response` 的安全摘要，默认
  `runtime + terminal + runtime_terminal_failure`；
- 非零退出优先使用 bounded stderr；无信息时只允许 known private-log error line extractor 补充；
- `models` 失败必须从 bounded stdout/stderr 形成可读 failure：未登录为 `authentication`，unknown
  command/option 为 `compatibility`，Provider/模型/权限错误为 `runtime`；
- stream-json 解析、必要 structured final 字段、Conversation ID 缺失/不一致/中途变化、多个 final 或
  安装版本缺少必要格式为 `compatibility`；
- executable、cwd、附件目录或 spawn 权限问题为 `environment`。

## 5. AgentRun 持久化与 terminal

Migration 94 将 Data Contract 更新为 `v1.10`、projection schema 49，并增加：

```text
agent_run.public_runtime_failure_json nullable object
adapter_probe_attempt.public_runtime_failure_json nullable object
```

旧记录保持 `null`，不得从旧 `last_error_code`、`error_detail` 或 digest 推导公开失败。以下 terminal 路径
接收 nullable typed failure，并在各自原事务与 fence 内写入：

- `FailAgentRunCommand`；
- `RejectAgentRunDispatchCommand`；
- `PlannedShutdownAbortiveTerminal`。

Claude/Agy delivered failure 的 Native Turn、terminal observed、planned shutdown reliable terminal 优先、
execution epoch 与 route/correlation fence 保持不变。typed error 的稳定 `error_code` 继续拥有内部 terminal
分类；公开 failure 是独立用户投影，不替代 terminal source/reason 或 external-effect evidence。

Read Model additive shape 为：

```ts
interface AgentRunView {
  // existing fields unchanged
  failure: RuntimeFailureView | null
}
```

## 6. Availability Check

`AdapterProbeAttempt` 与 `ProductRuntimeAvailability` additive shape 均增加
`failure: RuntimeFailureView | null`。Claude/Agy 用户显式“检查可用性”的 version/help/auth/models failure
必须提供安全 summary/detail，并映射到既有 `authentication_required / incompatible / needs_attention /
path_missing` 状态；failure 不创建新的 Availability status。

Core 启动浅检测产生的瞬时 version failure 不得伪装成产品级 Runtime error，不写公开 failure，也不得覆盖
last-known-good。只有显式检查或真实执行形成的当前 typed evidence 可以进入公开字段；缓存 Ready 后刷新
失败继续使用既有 `refresh_failed_using_last_success`，不把瞬时诊断提升为用户可见 Runtime terminal。

## 7. 验收

- structured final 与 non-zero exit 向用户显示清理后的可读原因而非 digest；
- auth/rate/quota/model/permission 与 compatibility/environment 具有稳定 code/origin/phase；
- Prompt、用户正文、Tool payload、原始路径、凭据、完整 stderr/日志不出现在 serialized failure；
- AgentRun terminal、planned shutdown 与 dispatch rejection 重启后读回同一 failure；
- 显式 health check 返回 failure，启动浅检与 last-known-good 边界不变；
- Codex、ACP、TRAE 与其他 Runtime 的 execution path 不受影响。

## References

- [Runtime Launch and Verification v7（历史）](runtime-launch-and-verification-v7.md)
- [Run Process Detail Surface v9](run-process-detail-surface-v9.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [ADR-0059](../adr/0059-runtime-owned-resource-permissions.md)
- [ADR-0083](../adr/0083-background-runtime-checks-and-actionable-status.md)
- [ADR-0168](../adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md)
- [ADR-0192](../adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)
- [ADR-0204](../adr/0204-on-demand-runtime-deep-verification.md)
