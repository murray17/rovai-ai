# Lumen AI 本地开发、运行、测试与构建

> 当前开发目标：macOS 14+，Apple Silicon
>
> 更新日期：2026-07-22

本文档是本地开发命令的唯一入口。根目录 `package.json` 中的 scripts 是命令行为的最终依据。

## 1. 环境要求

开发仓库需要：

- macOS 14+，Apple Silicon；
- Node.js 24 或更高版本；
- pnpm 11；
- Rust stable 与 Cargo；
- Git；
- 至少一个已安装并完成上游认证的受支持 Coding Agent CLI；
- 完整 Runtime 验收需要 Codex CLI、OpenCode CLI、GitHub Copilot CLI 与 Antigravity/AGY CLI。Lumen 不固定这些 CLI 的精确版本，而是在运行时探测实际版本和能力。

当前已验证的本地环境：

| 工具 | 版本 |
| --- | --- |
| macOS | 26.3 arm64 |
| Node.js | 26.5.0 |
| pnpm | 11.15.1 |
| Rust / Cargo | 1.97.1 |
| Git | 2.55.0 |
| Codex CLI | 0.145.0 |
| OpenCode CLI | 1.18.0 |
| GitHub Copilot CLI | 1.0.73 |
| Antigravity/AGY CLI | 1.1.5 |

检查关键依赖：

```bash
node --version
pnpm --version
rustc --version
cargo --version
git --version
codex --version
codex login status
opencode --version
copilot --version
agy --version
agy models
```

## 2. 安装依赖

在仓库根目录执行：

```bash
pnpm install --frozen-lockfile
```

需要有意更新依赖或 lockfile 时改用：

```bash
pnpm install
```

## 3. 本地开发运行

```bash
pnpm dev
```

该命令会：

1. 编译 Debug 版 `lumen-core`；
2. 将 Core 复制到 `resources/bin/lumen-core`；
3. 启动 Electron Vite 开发环境和桌面窗口。

仅重新编译 Debug Core：

```bash
pnpm core:build:debug
```

## 4. 测试与验证

日常快速验证：

```bash
pnpm typecheck
pnpm test
cargo test --workspace
```

进程与真实 Runtime 集成验证：

```bash
pnpm smoke:core
pnpm smoke:member-config
pnpm smoke:intake
pnpm smoke:agent-runtime
pnpm smoke:acp-runtime
pnpm smoke:agy-runtime
pnpm smoke:action-approval
pnpm smoke:multi-agent
pnpm smoke:recovery
```

- `smoke:core` 创建一次性临时 Git 仓库，验证真实 app-server、流式事件、审批持久化、拒绝结果和干净 Diff。
- `smoke:member-config` 验证通用成员、共享 Installation、Runtime 配置、Readiness 与重启持久化，不调用模型。
- `smoke:intake` 验证项目选择零写入、Runtime Ready 创建门、首条消息原子创建 Camp/CampTurn/AgentRun、`commandId` 幂等回放、同一 Conversation 连续执行及 Core 重启恢复。
- `smoke:agent-runtime` 启动真实 v0.02 AgentRun，验证调度、Native Session、最终公共回复、CampTurn 聚合，并确认 Agent 自述不会越权完成 Task。
- `smoke:acp-runtime` 分别验证 OpenCode 与 Copilot 的模型目录、Native Session 连续、一次性批准和拒绝，以及文件副作用审计。
- `smoke:agy-runtime` 验证 AGY 的模型发现、默认/显式模型、Conversation UUID 续接、私有日志清理和 AGY → Codex 换绑。
- `smoke:action-approval` 让真实 AgentRun 请求一个越出项目目录的 Shell 动作，验证精确 Action/Approval、用户授权、Runtime Delivery 与唯一副作用结果。
- `smoke:multi-agent` 在同一 CampTurn 中真实并发两个 AgentRun，验证共享 Host 下的 Conversation、Native Thread、Native Turn 与公共输出互不串线。
- `smoke:recovery` 在 Turn 执行中关闭 Core，再验证重启发现、Native Thread 恢复、Resume Frame 和完成状态。
- `smoke:core`、`smoke:intake`、`smoke:agent-runtime`、`smoke:action-approval`、`smoke:multi-agent` 与 `smoke:recovery` 需要 Codex；`smoke:acp-runtime` 需要 OpenCode 和 Copilot；`smoke:agy-runtime` 同时需要 AGY 与 Codex。涉及 Runtime 的用例会实际调用模型服务，耗时和费用取决于各上游账户配置。

## 5. 构建

构建 Release Core 和 Electron 产物：

```bash
pnpm build
```

只构建对应部分：

```bash
pnpm core:build
pnpm build:desktop
```

生成本地 macOS App：

```bash
pnpm package:mac
```

产物位置：

```text
dist/mac-arm64/Lumen AI.app
```

生成 DMG：

```bash
pnpm dist:mac
```

本地构建使用 ad-hoc 签名，不执行 Apple Notarization。正式对外分发仍需 Developer ID 签名和公证。

## 6. 运行打包后的 App

打包后的 App 不要求系统安装 Node.js、pnpm 或 Rust，但仍需要：

- 至少一个已安装、已认证且能力探测通过的受支持 Coding Agent CLI；
- 项目对话所需的 Git；
- 用户选择的本地 Git 项目至少包含一次 Commit。

启动：

```bash
open "dist/mac-arm64/Lumen AI.app"
```

校验本地签名：

```bash
codesign --verify --deep --strict "dist/mac-arm64/Lumen AI.app"
```

使用隔离数据目录执行打包 App 的 AGY 成员配置验收：

```bash
LUMEN_CAPTURE_USER_DATA_DIR="$(mktemp -d)/user-data" \
LUMEN_CAPTURE_RUNTIME_KIND=agy-cli \
node scripts/capture-desktop.mjs \
  "dist/mac-arm64/Lumen AI.app" \
  /tmp/lumen-agy-app
```

可通过 `LUMEN_CAPTURE_WIDTH=1040 LUMEN_CAPTURE_HEIGHT=700` 验证最小窗口。脚本只操作隔离的 Electron `userData`，不会修改日常 App 数据。

## 7. 生成目录

以下目录由开发或构建过程生成，不应提交：

| 路径 | 内容 |
| --- | --- |
| `target/` | Rust Debug/Release 构建结果 |
| `resources/bin/` | 复制后用于打包的 Rust Core |
| `out/` | Electron Vite 构建结果 |
| `dist/` | macOS App 和 DMG |
| `node_modules/` | pnpm 安装依赖 |

任务、事件和审批等运行数据位于 Electron `userData` 目录；准确位置可在应用“诊断”页查看。
