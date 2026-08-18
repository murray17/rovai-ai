---
document_type: version-overview
version: v1.10
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: true
last_updated: 2026-08-18
---

# Rovai-ai v1.10：唯一 Camp ID 与安全公开 Runtime 失败

> 当前状态：唯一 Camp identity clean break 与 Claude Code/Antigravity 安全公开失败均已实现；最终组合门禁、
> arm64 macOS 打包与严格签名检查、隔离启动验收、main 推送和 `/Applications/Rovai AI.app` 提升均已完成。
>
> 前置版本：[v1.09 完整会话查找、Mode-aware CLI 与 Tool 结果交互](../v1.09/README.md)。
>
> 后续版本：[v1.11 Windows x64 产品实现与资格闭环](../v1.11/README.md)。

## 版本目标

本版包含两个独立增量。Camp 不再与 Runtime 原生 UUID 共享模糊命名空间：`rvcamp_...` 成为数据库、Core、
Renderer、Agent Context、Built-in Tool 与本机路径中的唯一 Camp 主键，Native Session/Thread 继续独立。
同时，当 Claude Code 或 Antigravity 明确返回错误、输出协议不兼容或本机执行环境不可用时，用户应看到
可靠归因和经过清理的原因；完整 `anyhow` chain、原始 stderr、私有日志与公开 failure 保持分离。

## 交付范围

### 唯一 Camp identity clean break

- 新增 `CampId`，唯一格式为 `rvcamp_<26 位小写 canonical Crockford Base32>`，payload 必须是 RFC-compatible
  UUIDv7；Rust/TypeScript 同时验证 lexical、version 和 variant；
- `CampId::new()` 直接生成 Camp 主键；数据库主键/外键、Core/Renderer `campId`、Agent Context、Built-in
  Tool、事件和 Camp 路径使用同一值，不增加 `CampRef`、UUID alias 或映射表；
- Desktop Core 参数、领域 command、Camp History target 与 Attachment path 在使用前严格解析；导航、
  onboarding、pin、restorable location 与 timeline storage 丢弃旧本机 ID；
- `SHARED_CONVERSATION.campId` 和 Agent-facing Camp/Task/History 输出改用 `rvcamp_...`，Native Session、Thread、
  Turn、Conversation 与 Binding ID 的格式和恢复语义不变；
- Formatter 20 / ContextManifest 18、Camp History v3、Built-in Tool Transport v16 与 fixture v20 原子换版；
- Migration 95 在 Runtime failure 的 migration 94 之后把 projection schema 49→50，失效旧 context/binding 和
  非终态执行；生产旧预发布 store 隔离到 `inactive-data-quarantine/` 后重建，不映射旧 UUID Camp。

### 安全公开失败合同

- 新增持久、可序列化的 `RuntimeFailureView`，字段为 `runtimeKind / origin / phase / code / summary /
  detail / retryable`；
- `origin` 关闭为 `runtime / compatibility / environment / rovai / unknown`，证据不足不得默认归为
  Runtime；`phase` 关闭为 `spawn / authentication / model_catalog / execution / terminal`；
- 公开 detail 统一去 ANSI、控制字符与多余空白，最多 4 行、2,048 字符，并隐藏 Home、项目、临时、
  runtime-private、executable 绝对路径及 token/authorization/bearer/cookie/api_key/secret/credential；
- Prompt、用户消息、Tool input、完整 Tool output、原始 stderr 和完整 error chain 不进入公开字段。

### Claude Code 与 Antigravity

- typed delivered failure 同时携带稳定 `error_code`、Native Session/Turn 与公开 failure；Scheduler、
  planned-shutdown terminal 和 dispatch rejection 继续保留原有 fencing 与 terminal observed 语义；
- structured terminal failure 保留清理后的 Runtime `result/error/message/response`，非零退出优先从有界
  stderr 提取可读原因，内部仍保留 exit status、byte count 与 digest；
- 认证、限流、配额、模型不可用和权限拒绝使用稳定 public code；Runtime 明确失败归为 `runtime`；
- option/MCP config/output-format/stream-json/final-field/Session 或 Conversation identity/multiple-final 问题
  归为 `compatibility`；executable、cwd、附件目录与 spawn 权限问题归为 `environment`；
- Antigravity 只允许从私有日志提取已知固定格式错误行，不公开完整日志。

### 持久化、检查与用户界面

- 独立的 Migration 94 将 Data Contract 升至 `v1.10`、projection schema 49，并为 `agent_run` 与
  `adapter_probe_attempt` 增加 nullable `public_runtime_failure_json`；旧 Run/attempt 保持 `null`；
- `FailAgentRunCommand`、`RejectAgentRunDispatchCommand`、`PlannedShutdownAbortiveTerminal`、
  `AgentRunView.failure` 与 `ProductRuntimeAvailability.failure` 传递同一安全对象；
- Claude Code 与 Antigravity 的显式可用性检查持久化安全 failure；启动浅检测的瞬时 version failure
  不升级为产品级失败，也不覆盖 last-known-good；
- failed Run 即使没有 Execution Evidence 也在执行台默认展开失败信息；Runtime 设置页在状态之外显示
  相同标题、summary 与可选 detail；
- 只有 `origin=rovai` 显示“Rovai 内部错误”；其他 origin 分别显示 Runtime 返回、不兼容、本机环境不可用
  或未能完成运行。

## 明确不做

- 不增加 `camp_ref`、旧 Camp UUID reader、别名查询、双写或永久映射；
- 不把 `rvcamp_...` 传给 Runtime resume/load，也不修改 Native Session/Thread/Turn 或其他实体 ID；
- 不为未发布的开发数据建立长期兼容迁移；quarantine 只提供可恢复证据，不是当前 reader；

- 不修改 Codex、ACP Runtime、TRAE 或其他 Runtime 的执行与错误分类；
- 不重构 Runtime manager、进程管理、后台扫描、检查调度或 Runtime Activity mapping；
- 不把原始 stderr、完整日志、Prompt、Tool payload 或 digest 当作用户可见原因；
- 不更改 AgentRun terminal、Native Turn、planned shutdown 或 last-known-good 的既有权威关系；
- 不宣称新的 Claude Code/Antigravity 上游版本已通过兼容性资格，因此 Runtime compatibility 清单不变。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.09 以 `complete` 冻结为 historical；本概览、计划与版本索引建立唯一 current v1.10。 |
| ADR | 已更新 | [ADR-0219](../../adr/0219-single-namespaced-camp-identity.md)固定唯一 namespaced Camp identity 与 Native Session 分离；Runtime failure 继续沿用 ADR-0059/0065/0083/0168/0192/0204。 |
| Contracts | 已更新 | [Camp Identity v1](../../contracts/camp-identity-v1.md)、[ContextManifest Evidence v18](../../contracts/context-manifest-evidence-v18.md)、[Camp History Retrieval v3](../../contracts/camp-history-v3.md)与[Built-in Tool Transport v16](../../contracts/builtin-tool-transport-v16.md)固定 Camp clean break；Runtime v8 与 Surface v9 独立固定公开 failure。 |
| Architecture | 已更新 | [Camp Identity](../../architecture/camp-identity.md)记录生成、持久化、上下文、路径与 Native identity seam；[Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)记录公开 failure 安全边界。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)和 Settings surface brief 固定按 origin 命名与安全 detail 展示。 |
| Runtime Activity | 确认无需更新 | 公开 failure 不改变 Canonical Runtime Activity、Evidence schema、operation identity 或 registry classifier。 |
| Runtime compatibility | 确认无需更新 | 未新增上游版本、capability 或资格证据；本版只改善既有 Claude Code/Antigravity 错误投影。 |
| Documentation routing | 已更新 | 文档导航、Version/Contract/Architecture 索引和 ADR CURRENT 路由至 Camp v1/v18/v3/v16、ADR-0219 及 Runtime v8/v9。 |
| Root README | 确认无需更新 | 安全错误可见性不改变项目定位、常青能力或正式 Runtime 支持集合。 |

## References

- [实施与验收计划](implementation-plan.md)
- [模型上下文 revision 1](model-context-change.md)
- [ADR-0219](../../adr/0219-single-namespaced-camp-identity.md)
- [Camp Identity v1](../../contracts/camp-identity-v1.md)
- [ContextManifest Evidence v18](../../contracts/context-manifest-evidence-v18.md)
- [Camp History Retrieval v3](../../contracts/camp-history-v3.md)
- [Built-in Tool Transport v16](../../contracts/builtin-tool-transport-v16.md)
- [Camp Identity Architecture](../../architecture/camp-identity.md)
- [Runtime Launch and Verification v8](../../contracts/runtime-launch-and-verification-v8.md)
- [Run Process Detail Surface v9](../../contracts/run-process-detail-surface-v9.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [ADR-0059](../../adr/0059-runtime-owned-resource-permissions.md)
- [ADR-0065](../../adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)
- [ADR-0083](../../adr/0083-background-runtime-checks-and-actionable-status.md)
- [ADR-0168](../../adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md)
- [ADR-0192](../../adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)
- [ADR-0204](../../adr/0204-on-demand-runtime-deep-verification.md)
