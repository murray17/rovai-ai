---
document_type: research-evidence
authority: runtime-verification-evidence
last_updated: 2026-11-16
---

# ACP 冷恢复真实模型验证（2026-11-16）

主修复已通过 [PR #1102](https://github.com/murray17/rovai-ai/pull/1102) 合入 main（`7729108a`）。本轮覆盖 macOS arm64 的全部 18 个共享 ACP 接入。Core 二进制构建自 `b89ad2ec1`；SHA-256 为 `e0da1e07da422145aca7790c9e1c5b05488bfc795ffe3405a3e5969b63328ea0`。

复用 `probe-native-session-resume.mjs --cold-only`，通过生产 Core 和实际安装的原生 CLI，使用已有账号及原生默认模型。每个通过的接入完成 seed、warm、Core 重启后的 cold 三次短回复，逐项核对准确回复、原 Session ID、冷恢复 wire 请求及每次业务输入仅一次；不删除历史来制造恢复失败。

结果：**14 通过、3 阻断、1 项在发送模型输入前失败**，共观测到 42 条符合 marker 的真实模型回复。

| 接入 | 本机版本 | 结果 | 冷恢复／阻断原因 |
| --- | --- | --- | --- |
| opencode-cli | opencode v2.2.7 | 通过 | session/resume |
| kilo-cli | 7.8.27 | 通过 | session/resume |
| goose-cli | 1.59.0 | 通过 | session/load |
| copilot-cli | GitHub Copilot CLI 1.0.105. | 通过 | session/load |
| kiro-cli | kiro-cli 2.37.1 | 通过 | session/load |
| qoder-cli | 1.1.81 | 通过 | session/resume |
| codebuddy-cli | 2.180.0 | 通过 | session/load |
| qwen-code | 0.26.9 | 通过 | session/resume |
| trae-cn-cli | traecli 0.209.1 | 通过 | session/resume |
| kimi-code-cli | 2.5.2 | 准备阶段失败 | ACP Session is not ready: fs/read_text_file without active prompt; seed timed out and was cancelled |
| minimax-code-cli | 0.6.12 | 通过 | session/resume |
| command-code-cli | 未安装 | 阻断 | command-code executable not installed/on PATH |
| cline-cli | 3.0.74 | 阻断 | macos-arm64 runtime_platform_not_qualified |
| hermes-cli | Hermes Agent v0.23.0 (2026.9.24) · stable · local 2bd378ed1b8d | 通过 | session/resume |
| cursor-agent | 2025.09.18-7ae6800 | 阻断 | macos-arm64 runtime_platform_not_qualified |
| grok-build | grok 1.0.77 (50ca579fa996) | 通过 | session/resume |
| deepseek-harness | 0.2.1-alpha.1 | 通过 | session/resume |
| zcode-app | 3.17.2 | 通过 | session/resume |


Kimi 2.5.2 在准备阶段出现 `fs/read_text_file`，Core 因无 active prompt 拒绝该 session-scoped request，随后 seed 超时取消；输入 outcome 保留 `delivery_unknown`，未重放原输入。本轮只记录该失败，不归因于累计限制修复，也不追加生产改造。

Cursor 与 Cline 在生产准入处被 `runtime_platform_not_qualified` 阻止；Command Code 未发现 `command-code` 安装入口。三项未发送模型请求，不计为真实 LLM 通过。

Hermes 使用隔离 Home、配置、Session 和 Gateway，共用已安装的原生依赖 generations；准备阶段的解释器／依赖环境失败保留，最终从已安装原生入口成功完成三轮。ZCode 第一轮三次回复及同 ID 恢复均成功，但 observer 未记录原生 `v4/command.type`，导致计数断言失败；修正 observer 后在新隔离 fixture 重跑通过。

所有 Core/data/Skills/MCP 与项目均隔离；认证副本及原始 wire/日志留在私有验收目录，不进入公开报告。本报告只公开版本、结果及必要错误码。

这些结果不代表其他宿主平台或所有功能轴的资格；真实模型流程使用短会话，大累计历史与单帧容量边界仍由既有协议／读取器测试拥有。
