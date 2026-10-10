---
document_type: contract
name: Runtime Launch and Verification
version: v56
status: accepted
source_version: v1.72
last_updated: 2026-10-10
---

# Runtime Launch and Verification v56

继承 [v55](runtime-launch-and-verification-v55.md)，仅退役 Kimi 的 Rovai 专属 Provider 配置。
以下规则替代继承合同中的 `kimi-code.env`、`ROVAI_KIMI_CONFIG` 与 Core-owned `KIMI_MODEL_*` overlay。
ACP 协议、权限、模型显式选择、MCP、原生 Session 恢复及其他 Runtime 保持原合同。

## Kimi 原生配置

正式 AgentRun、普通可用性检查与模型目录探测都通过选中安装的 `kimi acp` 使用 Kimi 原生配置。
Core 不读取、解析、复制或改写 Kimi 的 Provider、Key、端点与默认模型；`config.toml` 的路径、格式、
优先级、校验及刷新由 Kimi 决定。父进程已有 `KIMI_CODE_HOME` 时原样继承，未设置时由 Kimi 选择默认目录。

Core 不再读取 `~/.config/rovai/kimi-code.env` 或 `ROVAI_KIMI_CONFIG` 指定的文件，
也不从它们设置 `KIMI_MODEL_*`。旧文件存在、缺失、格式错误、权限变化或内容变化均不影响启动、
探测及 Host compatibility digest。用户直接配置的原生进程环境仍按通用启动规则继承，不由本次变更清除。

旧文件不自动迁移、覆盖官方配置或删除。既有显式模型选择不自动改成默认模型，原生 Runtime 负责报告
已不可用的模型。退出的 Provider overlay 摘要不再参与 Host 复用；已有 Session 和历史记录不删除。
凭据不进入 Rovai 数据库、Evidence、诊断、公开命令或日志。

## 验证边界

扩展现有正式冷恢复、原生 Home 探测与 Host compatibility owner：验证旧 env 文件被忽略、
原生 Home 被继承、官方配置不被改写、正式新建与精确恢复仍走同一原生 Home。
测试使用独立进程、临时 Home 和假凭据，不读取开发者配置；旧私有 env 解析、allowlist 与权限测试
随唯一生产路径退役。

真实 Runtime 验收由调用方提供隔离 Home，使用官方 `config.toml`；验收脚本不再从其他 Runtime
生成 Kimi 专属 env 文件。无 Prompt 的目录/Session 验证不证明真实模型生成或账号余额。
