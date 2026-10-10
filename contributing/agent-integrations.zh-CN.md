# 智能体接入

Rovai 通过原生协议连接编程智能体，让它们以队员的身份参与同一份工作。这里记录现有适配、代码入口和尚未补齐的能力。

[English](agent-integrations.md) · [智能体接入与注意事项](https://rovai.dev/zh/docs/agent-setup.html)

## 现有接入

| 智能体 | 接入方式 | 状态 | 参考实现 |
| --- | --- | --- | --- |
| Codex CLI | App Server | 按平台开放 | [代码](../crates/rovai-core/src/codex.rs) |
| Claude Code | Stream JSON | 按平台开放 | [代码](../crates/rovai-core/src/claude.rs) |
| Pi Coding Agent | JSONL RPC + extension | 按平台开放 | [代码](../crates/rovai-core/src/pi.rs) |
| OpenCode | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| GitHub Copilot CLI | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| Kiro CLI | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| Qoder CLI | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| CodeBuddy CLI | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| Qwen Code | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| TRAE CLI CN | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| Kimi Code | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| Grok Build | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| DeepSeek Harness | ACP | 按平台开放 | [代码](../crates/rovai-core/src/acp.rs) |
| ZCode | Native App Server | 按平台开放 | [代码](../crates/rovai-core/src/zcode.rs) |
| Antigravity | Native application CLI | 按平台开放 | [代码](../crates/rovai-core/src/antigravity.rs) |
| Cline | ACP | 暂缓公开 | [代码](../crates/rovai-core/src/acp.rs) |
| Command Code | ACP | 暂缓公开 | [代码](../crates/rovai-core/src/command_code_acp.rs) |
| Cursor Agent | ACP + vendor extensions | 待资格验证 | [代码](../crates/rovai-core/src/acp.rs) |

以上为 **2026-10-10** 的 main 实现。具体平台范围见[兼容性记录](../docs/runtime-compatibility.md)；Cline、Command Code 与 Cursor 的代码已存在，尚未开放普通用户入口。

## 接入方式

**原生结构化协议。** Codex CLI 使用 App Server，Claude Code 使用双向 Stream JSON，Pi 使用 JSONL RPC 与 Rovai 扩展。各自保留原生的认证、模型与会话能力，执行事件由 Rovai 转为统一的界面展示。

**ACP。** OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen、TRAE、Kimi、Grok 和 DSH 共享 [ACP Host](../crates/rovai-core/src/acp.rs)。产品之间的模型选项、权限、MCP 和恢复能力仍有差异；这些差异保留在各自的适配策略中。例如，DSH 通过 `dsh --profile acp` 运行，并有单独的[模型配置准备逻辑](../crates/rovai-core/src/dsh.rs)来衔接原生与标准 Web 配置。

**应用附带的入口。** ZCode 使用原生 App Server；Antigravity 使用应用附带的 CLI。程序发现、登录来源和执行方式跟随对应产品。

[Adapter Registry](../crates/rovai-core/src/agent_runtime_adapter.rs) 汇总适配身份与平台状态，各产品的实现说明见 [Runtime Catalog Boundaries](../docs/architecture/runtime-catalog-boundaries.md)。

## 尚未开放的接入

| 智能体 | 现状与缺口 | 记录 |
| --- | --- | --- |
| **Cline** | 官方 ACP 已有首次执行、续接和恢复记录。已测 3.0.70 尚未提供所需的 ACP 压缩配置，自动压缩及压缩后恢复仍未通过。 | [当前记录](../docs/research/cline-runtime/latest-acp-2026-10-08.md) |
| **Command Code** | 官方 ACP 的默认模型已有执行与恢复记录。已测 1.74.1 / 1.79.1 的自定义模型切换仍不完整；部分已测 Provider 的 MCP 工具可发现，但调用失败。此前 headless 方案已退役。 | [模型选择](../docs/research/command-code-runtime/model-selection-2026-10-09.md) · [MCP](../docs/research/command-code-runtime/mcp-delivery-ab-2026-10-06.md) |
| **Cursor Agent** | 已有 ACP 与厂商扩展接线，公开前的能力与平台验证尚未完成。 | [接入研究](../docs/research/cursor-agent-runtime-research.md) |

## 开发参考

[本地开发](../docs/development/README.md) · [接入 Checklist](../docs/development/runtime-integration-checklist.md) · [兼容性记录](../docs/runtime-compatibility.md)
