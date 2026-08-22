---
document_type: development-guide
authority: development-environment
last_updated: 2026-08-15
---

# 开发环境与依赖

## 已声明要求

| 项目 | 仓库声明 | 真源 |
| --- | --- | --- |
| Node.js | `>=24` | `package.json#engines.node` |
| 包管理器 | 使用 pnpm；尚未声明最低版本或 `packageManager` pin | `pnpm-lock.yaml`、`package.json#scripts` |
| Rust | Cargo workspace 使用 edition 2024；尚未声明 `rust-version` 或固定 toolchain | `Cargo.toml` |
| macOS App | 最低 macOS 14.0，当前打包命令目标为 arm64 | `package.json#build.mac`、`package:mac`、`dist:mac` |

当前已记录和验证的开发、打包主机范围是 macOS 14+ Apple Silicon。其他平台不应仅凭
Electron、Node 或 Rust 能够启动就宣称受支持。

仓库目前没有 `pnpm doctor`。检查本机基础工具：

```bash
node --version
pnpm --version
rustc --version
cargo --version
```

只有声明了 Git 前置条件的测试才必须额外检查：

```bash
git --version
```

不要把这些命令在某次运行输出的版本复制回常青文档。最低版本需要由结构化声明和
兼容性测试共同决定。

## Git 是动态工作区能力

Rovai-ai 产品工作区可以是：

- 普通非 Git 目录；
- 尚无 Commit 的空 Git 仓库；
- 有 HEAD 的 Git 仓库；
- 在生命周期中获得或失去 Git 能力的目录。

因此，启动应用、创建普通目录 Camp 或打包 App 不要求用户工作区包含 `.git`，更不要求
至少一个 Commit。Git 只在某项能力或测试明确需要它时成为前置条件，例如创建 Git
fixture、采集 Run Git observation 或验证 Git 相关 UI。

开发 Rovai-ai 源码通常仍通过 Git 管理；这与产品工作区是否必须是 Git 仓库是两件事。

## Agent Runtime 是按用途选择的能力

基础安装、TypeScript/Rust 测试、App 启动和非模型 Smoke 不要求所有 Product Runtime 全部存在。
实际启动 AgentRun 或执行真实 Runtime Smoke 时，只需要对应测试所声明的 Runtime
已安装、可发现并完成上游认证。

Core 的正式 Runtime 产品目录以
[`AdapterKind::ALL`](../../crates/rovai-core/src/agent_profile.rs)为准。当前目录包含
Codex CLI、OpenCode、GitHub Copilot、Claude Code、Antigravity、Kiro、Qoder、
CodeBuddy、Qwen Code、TRAE CLI CN、Cursor Agent 和 Kimi Code。各测试只覆盖其中明确列出的子集；例如
`smoke:acp-runtime` 覆盖 OpenCode、Copilot、TRAE 和 Kimi。

优先使用应用“设置 → 执行引擎”和诊断页的 Runtime Discovery/Deep Probe 检查路径、
版本、认证和能力。只有在排查 PATH 或覆盖搜索时，才使用 Core 定义的环境变量：

```text
ROVAI_CODEX_BIN
ROVAI_OPENCODE_BIN
ROVAI_COPILOT_BIN
ROVAI_CLAUDE_CODE_BIN
ROVAI_ANTIGRAVITY_BIN
ROVAI_KIRO_BIN
ROVAI_QODER_BIN
ROVAI_CODEBUDDY_BIN
ROVAI_QWEN_BIN
ROVAI_TRAE_CN_BIN
ROVAI_CURSOR_BIN
ROVAI_KIMI_BIN
```

环境变量只改变对应进程的发现输入，不应写入仓库、截图、诊断导出或用户内容。

Kimi Code 的可选 provider 配置默认位于 `~/.config/rovai/kimi-code.env`，也可用
`ROVAI_KIMI_CONFIG` 指向另一私有文件。Unix 文件必须为 `0600` 或更严格，只允许：

```text
KIMI_MODEL_NAME
KIMI_MODEL_PROVIDER_TYPE
KIMI_MODEL_API_KEY
KIMI_MODEL_BASE_URL
KIMI_MODEL_MAX_CONTEXT_SIZE
KIMI_MODEL_CAPABILITIES
```

前四项必填。真实 key 不得写入仓库、fixture、命令行、截图或诊断；
`KIMI_MODEL_CAPABILITIES=thinking` 只声明 provider 能力，Rovai 不强制关闭 Kimi/MiniMax thinking。

## 安装依赖

日常开发使用锁定依赖：

```bash
pnpm install --frozen-lockfile
```

只有在明确更新依赖并准备审查 `pnpm-lock.yaml` 时使用：

```bash
pnpm install
```

安装后若 Core 或原生依赖异常，继续阅读
[常见问题排查](troubleshooting.md)。
