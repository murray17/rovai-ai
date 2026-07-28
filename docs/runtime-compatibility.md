---
document_type: runtime-compatibility-register
authority: runtime-validation-evidence
last_updated: 2026-07-29
---

# Agent Runtime 兼容性清单

本文件维护 Agent Runtime 的本机实测证据和复核条件。它不是产品 Runtime Registry、
Roadmap 或用户可见能力来源；正式目录以代码中的 `AdapterKind`、Migration、健康探测和
测试为准。跨版本边界见
[ADR-0065](adr/0065-verified-runtime-catalog-and-documentation-only-compatibility.md)。

评估中的“精确替换”“注入后保留原生配置”“不能注入”是说明性语言，不是需要持久化或
展示的产品类型。

## 当前正式接入

| Runtime | 验证版本 | 协议与 MCP 证据 | 认证 / 恢复证据 | 当前结论 |
|---|---:|---|---|---|
| Kiro CLI | 2.15.0 | ACP v1；私有 Custom Agent 设置 `includeMcpJson: false`；实测仓库 ambient MCP 未启动、ACP `mcpServers` 注入项成功初始化 | 2026-07-29 使用已登录账号完成真实模型 turn；跨进程 `session/load` 成功；`session/cancel` 返回 `cancelled`；`session/set_model` 成功；私有 `KIRO_HOME` 不丢失登录 | v0.19 接入；生产使用私有 Agent 启动目录，保留原生持久 Session |
| Qoder CLI | 1.1.7 | `--acp --strict-mcp-config`；私有 MCP 文件与 server allowlist 参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |
| CodeBuddy | 2.128.0 | `--acp --strict-mcp-config`；私有 MCP 文件参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |
| Qwen Code | 0.21.0 | `--acp`；私有 MCP 文件、server allowlist 与空集合 safe mode 参数已验证 | ACP initialize 已验证；Ready 仍由当前安装的 disposable Session 与登录状态门控 | v0.19 接入 |

## 已调研但未进入产品目录

这些名称不应出现在 `AdapterKind`、数据库 kind、Contracts、设置选项或运行时健康目录。

| Runtime | 调研版本 / 状态 | 观察结果 | 未接入原因 | 复核条件 |
|---|---:|---|---|---|
| Kimi CLI | 0.29.2 | ACP 可初始化；调用方 `mcpServers` 会与用户、项目、项目本地及插件 MCP 合并 | 当前版本只接入已验证精确 MCP 的新增 Runtime | 上游提供可验证的严格替换入口，或后续版本明确实现并披露“注入后保留原生配置”的准入 |
| Grok CLI | 0.2.112；本机未登录 | ACP 可初始化；初始化阶段可观察到个人 MCP，未发现严格替换入口 | 缺少登录后的完整 Session 证据，且不满足当前精确 MCP 门槛 | 完成登录、真实 turn、恢复/取消与 MCP 行为复核；或后续版本明确采用较弱准入 |
| Cursor Agent | 2025.09.18-7ae6800 | 支持 headless 与 resume；已验证入口会读取项目 `.cursor/mcp.json`，未发现每 Run 私有严格替换入口 | 不满足当前精确 MCP 门槛 | 上游提供私有 MCP 注入/替换合同，或后续版本明确采用较弱准入 |
| TRAE | CLI 未公开；App 可用 | 官方 Enterprise 页面仍将 CLI 标为 coming soon；App 诊断日志会记录继承的进程环境，不适合作为当前 AgentRun 隔离入口 | 没有公开稳定 CLI/协议；App 自动化与凭据/环境边界尚无可接受合同 | 官方发布可脚本化协议并完成环境、认证、Session、取消和 MCP 隔离复核 |

## 后续准入规则

- 当前代码只实现精确 MCP 的新增 Runtime 准入，仍以 `mcp.exact_per_run` 作为冻结门槛。
- 如果未来接入“能注入 Rovai MCP、但可能保留原生 MCP”的 Runtime，版本文档和审计必须
  明确 Rovai 保证与不保证的范围；运行中不得静默改用其他策略。
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
