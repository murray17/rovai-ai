---
document_type: contract
name: Runtime Launch and Verification
version: v20
status: accepted
source_version: v1.27
last_updated: 2026-08-22
---

# Runtime Launch and Verification v20

v20 replaces [v19](runtime-launch-and-verification-v19.md). v19 的 launch purpose、identity fencing、Ready、
LKG、检查 attempt、Session continuation、公开 failure、自动恢复和 Cursor 边界保持不变；本版把 Kimi Code
加入 closed Product Runtime Catalog，并冻结 MiniMax provider 隔离与保守的平台准入结论。

## Kimi identity 与启动

稳定 wire identity 为 `kimi-code-cli`，canonical executable 为 `kimi`，环境变量覆盖键为
`ROVAI_KIMI_BIN`。有效 Host 以 `<resolved-executable> acp` 启动，使用 ACP v1 newline-delimited JSON-RPC，
依次完成 `initialize(protocolVersion = 1)` 和 `session/new`。Ready requirements 包含实际观察到的 prompt、
cancel、session update、permission request、additional roots 和 config option 能力，不包含 External MCP。

每个 Host 使用新的隔离 `KIMI_CODE_HOME`。terminal 可见前停止 Host，planned shutdown、Camp 删除和 App
shutdown 必须覆盖其进程树。当前 continuation strategy 为 `new_only`；snapshot 不声明
`session.resume`，不得尝试跨隔离 Host 恢复 native Session。原始 Runtime 在新进程复用同一 home 时可 exact
resume/load，而新的隔离 home 对旧 ID 返回 `Unknown sessionId`；该诊断证据不改变本合同的隔离策略。

## MiniMax provider 配置

默认配置文件为 `~/.config/rovai/kimi-code.env`，`ROVAI_KIMI_CONFIG` 可以覆盖绝对位置。Core 只接受：

```text
KIMI_MODEL_NAME
KIMI_MODEL_PROVIDER_TYPE
KIMI_MODEL_API_KEY
KIMI_MODEL_BASE_URL
KIMI_MODEL_MAX_CONTEXT_SIZE
KIMI_MODEL_CAPABILITIES
```

前四项必填；未知、重复、格式错误、空值或 Unix group/other 可访问都必须在启动前失败。
`KIMI_MODEL_CAPABILITIES=thinking` 只是 provider 能力声明，不是 thinking 开关。值只注入 Kimi
子进程，不进入数据库、Runtime Evidence、diagnostics、公开 command、日志、Crash report 或仓库。Core 不读取、
改写或复用用户 `~/.kimi/config.toml`。

本版实证配置使用 `MiniMax-M3`、`openai` provider 与 MiniMax 国内 OpenAI-compatible endpoint；合同不固定
用户的 token 值，也不允许在测试 fixture 中保存真实凭据。

## 权限、输出与能力收窄

Kimi 静态权限为 `default | plan | auto | yolo`；Core-enforced read-only workspace 强制 `plan`。Runtime Tool
仍必须经过现有 ACP permission request、唯一 Active Prompt 与 execution fencing。没有匹配 one-time
authorization 的 Client filesystem request fail closed，不能因 Runtime 自称 auto/yolo 绕过 Core。

Rovai 不强制关闭 Kimi 或 MiniMax thinking。MiniMax 或兼容层可能把推理作为 `<think>...</think>` 普通文本
返回，因此 Kimi streamed agent text 只保留为私有 observation；
terminal candidate 在公开前剥离所有完整推理块。未闭合推理块不发布任何候选，不能泄露到 Narration、Final
或 Missing-Send Recovery。

Kimi 支持基于 `end_turn` 的 `IfNoAcceptedSend` Missing-Send candidate，但仍需经过上述清洗和既有 accepted-send
门禁。Usage/Cost、Compaction、External MCP、History Restore、warm Host reuse 与 native resume 均 Disabled。
原始 ACP stdio MCP happy path 和相邻 Session 隔离已经实测，但尚未完成 Rovai projection 的 precedence、完整
定义与 Host compatibility 准入，不能据此开启 External MCP。Rovai managed Skill 投影到项目
`.kimi-code/skills`；当前加载能力为 Verified，不提升其他禁用能力。

## 平台准入

macOS arm64 的直接诊断 evidence 包含本机 `kimi 0.32.0`、MiniMax M3 prompt、allow/deny permission、六类
terminal command output、Missing-Send、cancel 和 process cleanup；但完整十五项 Built-in CLI matrix 一次超时、
两次得到 `0/15` operation evidence。因此该平台为
`not_qualified / runtime_platform.builtin_transport_unqualified`，不发布 qualified evidence revision。
macOS x64 与 Windows x64 为 `not_qualified / runtime_platform.qualification_evidence_missing`；Catalog 可见或
基础 ACP 诊断成功都不等于平台可执行。

后续任何平台晋升必须重新完成 identity、认证/provider、Session、真实 output、allow/deny 或无副作用预拒绝、
cancel、terminal、cleanup 和声明的 Built-in/continuation 边界，并更新不可变 evidence revision。

## Acceptance

- closed Adapter、Skill group、Migration、Activity registry 与 Renderer catalog 各恰有一个 Kimi identity；
- 配置 allowlist、必填键、格式、权限和秘密不落盘到仓库/数据库有确定性 gate；
- Kimi prompt、Shell allow/deny、六类 terminal output、Missing-Send、cancel 与 cleanup 在 macOS arm64 真实通过；
- 推理块清洗、未闭合 fail closed、Client fs 无授权拒绝与 External MCP/Usage/Compaction/resume 禁用有回归；
- Built-in CLI 未形成 15 项 evidence 时不声明 built-in transport capability，也不进入默认完整矩阵；
- 未准入平台不执行 discovery、Probe、成员配置或 AgentRun，UI 不把直接诊断结果外推。

## References

- [Runtime Launch and Verification v19](runtime-launch-and-verification-v19.md)
- [Runtime Platform Admission v1](runtime-platform-admission-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Kimi Code Runtime Research](../research/kimi-code-runtime-research.md)
- [V1.27-D01](../versions/v1.27/decisions.md#v1-27-d01)
