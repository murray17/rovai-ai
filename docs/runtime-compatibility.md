---
document_type: runtime-compatibility-register
authority: runtime-validation-evidence
last_updated: 2026-08-01
---

# Agent Runtime 兼容性清单

本文件维护 Agent Runtime 的本机实测证据和复核条件。它不是产品 Runtime Registry、
Roadmap 或用户可见能力来源；正式目录以代码中的 `AdapterKind`、Migration、健康探测和
测试为准。跨版本边界见
[ADR-0065](adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)。

兼容性清单中的自然语言结论本身不会自动创建产品类型。跨版本决策
[ADR-0088](adr/0088-attested-native-team-gateway-attachment.md) 已进一步要求 Adapter 和
AgentRun 分别表达外部 MCP 投影、内部 Team Gateway attachment 与 ambient isolation；v0.30
已经按该模型实现 Antigravity 的窄发送侧 Team Gateway。

## 当前正式接入

| Runtime | 验证版本 | 协议与 MCP 证据 | 认证 / 恢复证据 | 当前结论 |
|---|---:|---|---|---|
| Kiro CLI | 2.15.0 | ACP v1；私有 Custom Agent 设置 `includeMcpJson: false`；实测仓库 ambient MCP 未启动、ACP `mcpServers` 注入项成功初始化 | 2026-07-29 使用已登录账号完成真实模型 turn；跨进程 `session/load` 成功；`session/cancel` 返回 `cancelled`；`session/set_model` 成功；私有 `KIRO_HOME` 不丢失登录 | v0.19 接入；生产使用私有 Agent 启动目录，保留原生持久 Session |
| Qoder CLI | 1.1.7 | `--acp --strict-mcp-config`；私有 MCP 文件与 server allowlist 参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |
| CodeBuddy | 2.128.0 | `--acp --strict-mcp-config`；私有 MCP 文件参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |
| Qwen Code | 0.21.0 | `--acp`；私有 MCP 文件、server allowlist 与空集合 safe mode 参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |

## 现有 Antigravity Runtime 专项复核

Antigravity 已在产品目录中用于普通 AgentRun，也可以作为 A2A 接收目标；下表只复核发送侧
Team Gateway，不把它误列为“尚未接入的 Runtime”。

| 复核日期 / 版本 | 已观察证据 | 当前实现结论 | 仍需复核的边界 |
|---|---|---|---|
| 2026-08-01 / `agy 1.1.9` | 专属 Plugin 可启动无凭据 MCP；Bridge 是 `agy` 直接子进程；macOS kernel peer PID/start/parent/path 可读取；精确 `mcp(rovai_team/post_message)` 在真实 headless model call 生效；调用 `_meta` 有稳定 conversation/progress identity；Bridge 崩溃后 `agy` 不重启；真实 A→B→A 与普通终端负例通过 | 已实现 `ExternalMcpProjection::Unsupported + TeamGatewayAttachment::AttestedNativeBridge + AmbientMcpIsolation::PreservedUncontrolled`；配置与窄权限 Ready 时 Antigravity 可发送 `post_message`，普通 `agy` 为空工具且无领域写入 | 上游版本、Plugin/权限格式、MCP 父子启动链或调用 identity 变化时必须重新验证；不把 `1.1.9` 变成固定白名单 |

这些证据不证明最终 MCP 集合唯一；实现明确保留用户 ambient MCP，并在状态中披露
`PreservedUncontrolled`。Plugin、用户级或 workspace 的同名 `rovai_team` 由启动前冲突检测
失败关闭，不依赖未证明的来源优先级。完整验收见 [v0.30](versions/v0.30/README.md)。

## 已调研但未进入产品目录

这些名称不应出现在 `AdapterKind`、数据库 kind、Contracts、设置选项或运行时健康目录。

| Runtime | 调研版本 / 状态 | 观察结果 | 未接入原因 | 复核条件 |
|---|---:|---|---|---|
| Kimi CLI | 0.29.2 | ACP 可初始化；调用方 `mcpServers` 会与用户、项目、项目本地及插件 MCP 合并 | 当前版本只接入已验证精确 MCP 的新增 Runtime | 上游提供可验证的严格替换入口，或后续版本明确实现并披露“注入后保留原生配置”的准入 |
| Grok CLI | 0.2.112；本机未登录 | ACP 可初始化；初始化阶段可观察到个人 MCP，未发现严格替换入口 | 缺少登录后的完整 Session 证据，且不满足当前精确 MCP 门槛 | 完成登录、真实 turn、恢复/取消与 MCP 行为复核；或后续版本明确采用较弱准入 |
| Cursor Agent | 2025.09.18-7ae6800 | 支持 headless 与 resume；已验证入口会读取项目 `.cursor/mcp.json`，未发现每 Run 私有严格替换入口 | 不满足当前精确 MCP 门槛 | 上游提供私有 MCP 注入/替换合同，或后续版本明确采用较弱准入 |
| TRAE | CLI 未公开；App 可用 | 官方 Enterprise 页面仍将 CLI 标为 coming soon；App 诊断日志会记录继承的进程环境，不适合作为当前 AgentRun 隔离入口 | 没有公开稳定 CLI/协议；App 自动化与凭据/环境边界尚无可接受合同 | 官方发布可脚本化协议并完成环境、认证、Session、取消和 MCP 隔离复核 |

## 后续准入规则

- 新增 Runtime 的外部 MCP 准入仍以 `ExactPerRun` 为门槛；`AttestedNativeBridge` 只为满足
  ADR-0088 证据的 Runtime 挂接内部 Team Gateway，不提升外部 MCP 能力。
- v0.30 的 preserved-ambient 路径只允许挂接内部 Team Gateway。版本状态、Run 冻结和
  审计必须分别说明外部 MCP Unsupported、Team attachment 方式与 ambient isolation；运行中
  不得静默改用其他策略。
- 这一新路径不能用于投影外部 MCP Library Assignment；Runtime 有 Assignment 但不能精确
  投影时必须在发送准入失败关闭。
- 已准入 Runtime 可以担任 Lead；兼容性差异不进入角色系统。
- 不能注入 Rovai MCP 的 Runtime 暂不考虑接入。

## 官方入口

- [Kiro CLI ACP](https://kiro.dev/docs/cli/acp/)
- [Kiro CLI MCP](https://kiro.dev/docs/cli/mcp/)
- [Kiro Custom Agent configuration](https://kiro.dev/docs/cli/custom-agents/configuration-reference/)
- [Qoder CLI permissions and MCP allowlist](https://docs.qoder.com/en/cli/permissions)
- [CodeBuddy CLI reference](https://www.codebuddy.ai/docs/cli/cli-reference)
- [Qwen Code configuration](https://qwenlm.github.io/qwen-code-docs/en/users/configuration/settings/)
- [Kimi Code CLI ACP](https://moonshotai.github.io/kimi-code/en/guides/ides.html)
- [Grok Build CLI reference](https://docs.x.ai/build/cli/reference)
- [Cursor Agent CLI parameters](https://docs.cursor.com/en/cli/reference/parameters)
- [TRAE Enterprise](https://www.trae.ai/enterprise)
- [Antigravity MCP Servers](https://antigravity.google/docs/mcp)
- [Antigravity Plugins](https://antigravity.google/docs/plugins)
- [Antigravity CLI Permissions](https://antigravity.google/docs/cli/permissions)
