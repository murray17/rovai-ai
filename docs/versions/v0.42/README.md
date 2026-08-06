---
document_type: version-overview
version: v0.42
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-06
---

# Rovai-ai v0.42 Built-in Tool CLI-only Transport

> 状态：历史版本，实施与验收完成。v0.42 对 Rovai-owned built-in operations 执行一次本地 clean break：
> 九个正式 Runtime 统一通过 bundled `rovai` CLI 调用，旧内置 MCP transport 不保留回退、
> 兼容、迁移或自动清理逻辑。
>
> 前置版本：[v0.41 Runtime Activity 统一观测语义](../v0.41/README.md)
>
> 长期决策：[ADR-0124](../../adr/0124-cli-only-transport-for-rovai-built-in-operations.md)
>
> 字段级真源：[Built-in Tool Transport v1](../../contracts/builtin-tool-transport-v1.md)
>
> 组件结构真源：[Built-in Tool Runtime Architecture](../../architecture/builtin-tool-runtime.md)

## 版本目标

v0.42 把十二个 Rovai 内置操作从 Runtime-specific MCP 注入切换为同一条本地路径：

```text
Runtime shell → bundled rovai CLI → private local IPC → Core Router → Domain Services
```

版本内交付范围：

- Canonical Operation Result 与 Built-in Tool Invocation Envelope 两层合同；
- Core-only Envelope/receipt 生成、requestId 重放、active lease 与旧 Run fencing；
- 直接参数、stdin/heredoc、`--input-file` 和 `tool list/describe`；
- Codex、OpenCode、Copilot、Claude Code、Antigravity、Kiro、Qoder、CodeBuddy、Qwen Code
  的同一 CLI 注入；
- 删除内置 Team/Context/Memory MCP Server、Bridge、alias、permission bundle 和 Antigravity
  Plugin 管理；用户外部 MCP 继续使用独立 Runtime-native Projection；
- 删除应用级、成员级和 Profile 级 Memory 写权限开关；每个可执行成员都可调用全部十二项，
  Core 继续执行领域状态、范围、配额、幂等和乐观锁规则；
- App 同包携带 `rovai-core` 与 `rovai` 两个可执行文件。

## 合同与兼容表述

领域结果语义和既有扁平业务字段保持不变；不保证旧内置 MCP 的完整输出字节结构不变。
Canonical Result 不包含 `rovaiTeamTool`、`rovaiTeamReceipt` 或 `result.task` wrapper。版本文档不
复制字段、Schema、receipt preimage 或 IPC 结构；这些内容只由长期 Contract 文档和
`rovai tool describe` 发布。

本版本不处理旧本地数据或旧 Runtime 配置。开发机在切换后清空本地 App 数据并重启 App；产品
代码不识别、迁移、自动删除或兼容旧内置 MCP 状态。

## 验收阈值

v0.42 只有同时满足以下事实才可标记完成：

1. Rust/TypeScript/Renderer 全量静态与自动测试通过；
2. `cargo clippy --workspace --all-targets -- -D warnings` 通过；
3. 九个已安装、已认证 Runtime 各自在真实 AgentRun 中发现同一 catalog、描述全部十二项、
   实际执行全部十二项、观察乐观锁冲突、完成后拒绝旧 lease，并在后续 Run 获得新 lease；
4. 每个真实 Run 的 Core Evidence 都覆盖十二个 canonical operation，不能以 fixture 或模拟调用
   代替；
5. Release Core/CLI、Desktop build 与 arm64 `.app` 本地打包通过，bundle 内两个二进制均可执行；
6. 并行 Renderer 改动已复核并与本版本改动一起通过最终测试。

具体执行记录维护在[实施与验收计划](implementation-plan.md)，长期 Runtime 结论回写
[兼容性清单](../../runtime-compatibility.md)。
