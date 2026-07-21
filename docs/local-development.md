# Lumen AI 本地开发、运行、测试与构建

> 当前开发目标：macOS 14+，Apple Silicon
>
> 更新日期：2026-07-21

本文档是本地开发命令的唯一入口。根目录 `package.json` 中的 scripts 是命令行为的最终依据。

## 1. 环境要求

开发仓库需要：

- macOS 14+，Apple Silicon；
- Node.js 24 或更高版本；
- pnpm 11；
- Rust stable 与 Cargo；
- Git；
- 已安装并登录的 Codex CLI；
- Codex app-server 能通过 Lumen 的初始化握手与必需能力探测。Lumen 不固定用户本机 Codex 的精确版本。

当前已验证的本地环境：

| 工具 | 版本 |
| --- | --- |
| macOS | 26.3 arm64 |
| Node.js | 26.5.0 |
| pnpm | 11.13.1 |
| Rust / Cargo | 1.97.0 |
| Git | 2.55.0 |
| Codex CLI | 0.144.6 |

检查关键依赖：

```bash
node --version
pnpm --version
rustc --version
cargo --version
git --version
codex --version
codex login status
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

真实 Codex 集成验证：

```bash
pnpm smoke:core
pnpm smoke:intake
pnpm smoke:agent-runtime
pnpm smoke:recovery
```

- `smoke:core` 创建一次性临时 Git 仓库，验证真实 app-server、流式事件、审批持久化、拒绝结果和干净 Diff。
- `smoke:intake` 验证 Start Preflight、不可用 Agent blocker、Task/CampTurn/AgentRun 原子受理及 `commandId` 幂等回放。
- `smoke:agent-runtime` 启动真实 v0.02 AgentRun，验证调度、Native Session、最终公共回复、CampTurn 聚合，并确认 Agent 自述不会越权完成 Task。
- `smoke:recovery` 在 Turn 执行中关闭 Core，再验证重启发现、Native Thread 恢复、Resume Frame 和完成状态。
- 四个 Smoke Test 都要求能力探测通过且已登录的 Codex CLI；除纯入口断言外，涉及 Runtime 的用例会实际调用模型服务，耗时和费用取决于当前 Codex 配置。

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

- 已安装、已登录且版本兼容的 Codex CLI；
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
