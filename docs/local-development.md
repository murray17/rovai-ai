# Lumen AI 本地开发、运行、测试与构建

> 当前开发目标：macOS 14+，Apple Silicon
>
> 更新日期：2026-07-24

本文档是本地开发命令的唯一入口。根目录 `package.json` 中的 scripts 是命令行为的最终依据。

## 1. 环境要求

开发仓库需要：

- macOS 14+，Apple Silicon；
- Node.js 24 或更高版本；
- pnpm 11；
- Rust stable 与 Cargo；
- Git；
- 至少一个已安装并完成上游认证的受支持 Coding Agent CLI；
- 完整 Runtime 验收需要 Codex CLI、OpenCode CLI、GitHub Copilot CLI、Claude Code CLI，以及 Antigravity App 随附或用户配置的 `agy` companion。Lumen 不固定这些程序的精确版本，而是在运行时探测实际版本和能力。

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
| Claude Code CLI | 2.1.206 |
| Antigravity App companion (`agy`) | 1.1.5 |

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
claude --version
claude auth status
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
pnpm smoke:acp-runtime
pnpm smoke:claude-runtime
pnpm smoke:antigravity-runtime
pnpm smoke:action-approval
pnpm smoke:multi-agent
pnpm smoke:team-context
pnpm smoke:team-tasks
pnpm smoke:recovery
```

- `smoke:core` 从全新数据库启动，验证 Starter Profile、零 Camp/零 Project 分组、Git Repository 只读检查以及重启后仍不物化 compatibility Camp。
- `smoke:member-config` 验证通用成员、共享 Installation、Runtime 配置、Readiness 与重启持久化，不调用模型。
- `smoke:intake` 验证项目选择零写入、Runtime Ready 创建门、首条消息原子创建 Camp/CampTurn/AgentRun、`commandId` 幂等回放、同一 Conversation 连续执行、Core 重启恢复，以及永久删除后 Project 分组不会复活。
- `smoke:acp-runtime` 分别验证 OpenCode 与 Copilot 的模型目录、Native Session 连续、一次性批准和拒绝，以及文件副作用审计。
- `smoke:claude-runtime` 验证 Claude Code CLI 的本机探测、原生权限选项、真实执行、Conversation 连续性和 Native Session Resume。
- `smoke:antigravity-runtime` 验证 Antigravity App companion 的模型发现、默认/显式模型、Conversation UUID 续接、私有日志清理和 Antigravity → Codex 换绑。
- `smoke:action-approval` 让真实 AgentRun 请求一个越出项目目录的 Shell 动作，验证精确 Action/Approval、用户授权、Runtime Delivery 与唯一副作用结果。
- `smoke:multi-agent` 在同一 CampTurn 中真实并发两个 AgentRun，验证共享 Host 下的 Conversation、Native Thread、Native Turn 与公共输出互不串线。
- `smoke:team-context` 使用真实 Runtime 验证 A2A 关联、冻结上下文、有条件压缩、重启去重；设置 `LUMEN_TEAM_TASK_HANDOFF=1` 后还会验证“分配 Task 不唤醒，显式消息才唤醒，接收者自行更新 Task”的完整闭环。
- `smoke:team-tasks` 验证一个真实 Runtime 能发现并调用 `team.create_task`、`team.list_tasks` 与 `team.update_task`，且重启后不重复执行。
- `smoke:recovery` 默认使用 OpenCode，在 Runtime 已确认接收输入后杀死 Core；重启必须保留同一 Run/Manifest/Task 和原 Execution Epoch，并将 Run 留在 `waiting(runtime_recovery)` 等待确定性对账，禁止盲目重发已接收输入。
- `smoke:core` 与 `smoke:member-config` 不调用模型。其余 Runtime Smoke 会按名称调用本机对应 Agent；涉及模型的用例耗时和费用取决于上游账户配置。

`smoke:team-context` 默认验证 Codex→Codex；可分别指定源端和接收端 Runtime。下面的最后一条同时开启 v0.06 Task 交接：

```bash
LUMEN_TEAM_SOURCE_ADAPTER=copilot-cli \
LUMEN_TEAM_TARGET_ADAPTER=copilot-cli \
LUMEN_COPILOT_ALLOW_ALL=on \
LUMEN_TEAM_TASK_HANDOFF=1 \
pnpm smoke:team-context

LUMEN_TEAM_TARGET_ADAPTER=opencode-cli pnpm smoke:team-context
LUMEN_TEAM_TARGET_ADAPTER=copilot-cli pnpm smoke:team-context
LUMEN_TEAM_TARGET_ADAPTER=claude-code-cli pnpm smoke:team-context
```

单独验证 Task Tool 发现时使用：

```bash
LUMEN_TEAM_TARGET_ADAPTER=copilot-cli \
LUMEN_COPILOT_ALLOW_ALL=on \
pnpm smoke:team-tasks
```

恢复 Smoke 可切换 Adapter；默认值为 `opencode-cli`：

```bash
LUMEN_RECOVERY_ADAPTER=opencode-cli pnpm smoke:recovery
```

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

### Hearth & Camp 主题矩阵

首次启动、成员、Runtime 诊断、设置和新对话可以使用全新隔离目录验收。
`LUMEN_CAPTURE_THEME` 支持 `system`、`day` 和 `night`：

```bash
LUMEN_CAPTURE_USER_DATA_DIR="$(mktemp -d)/user-data" \
LUMEN_CAPTURE_THEME=night \
LUMEN_CAPTURE_WIDTH=1040 \
LUMEN_CAPTURE_HEIGHT=700 \
node scripts/capture-desktop.mjs \
  "dist/mac-arm64/Lumen AI.app" \
  /tmp/lumen-night-1040
```

验证已有 Camp 时，先通过 SQLite Backup API 创建隔离副本，禁止让验收脚本直接操作日常
App 数据：

```bash
SOURCE="$HOME/Library/Application Support/lumen-ai/lumen.sqlite"
FIXTURE="$(mktemp -d)/user-data"
sqlite3 "$SOURCE" ".backup '$FIXTURE/lumen.sqlite'"

LUMEN_CAPTURE_USER_DATA_DIR="$FIXTURE" \
LUMEN_CAPTURE_THEME=day \
LUMEN_CAPTURE_RELAXED=1 \
LUMEN_CAPTURE_WIDTH=1440 \
LUMEN_CAPTURE_HEIGHT=920 \
node scripts/capture-camp-inspectors.mjs \
  "dist/mac-arm64/Lumen AI.app" \
  /tmp/lumen-camp-day-1440
```

Camp 脚本依次截取 Activity、Task、Context、Approval 和 Audit，并校验解析主题与整页横向溢出。
严格的 A2A/Context 验收不设置 `LUMEN_CAPTURE_RELAXED`，仍要求测试数据满足固定行数和上下文断言。

使用隔离数据目录执行打包 App 的 Antigravity App 成员配置验收：

```bash
LUMEN_CAPTURE_USER_DATA_DIR="$(mktemp -d)/user-data" \
LUMEN_CAPTURE_RUNTIME_KIND=antigravity-app \
node scripts/capture-desktop.mjs \
  "dist/mac-arm64/Lumen AI.app" \
  /tmp/lumen-antigravity-app
```

对已经配置至少两名 Runtime Ready 成员的隔离 `userData`，可验证大厅 `@` 菜单只展示就绪成员、支持一次选择全部成员，并在最小窗口下保持可用：

```bash
LUMEN_CAPTURE_USER_DATA_DIR="<isolated-user-data>" \
LUMEN_CAPTURE_MENTIONS=1 \
LUMEN_CAPTURE_EXPECT_MENTION_COUNT=2 \
LUMEN_CAPTURE_WIDTH=1040 \
LUMEN_CAPTURE_HEIGHT=700 \
node scripts/capture-desktop.mjs \
  "dist/mac-arm64/Lumen AI.app" \
  /tmp/lumen-mentions-app
```

可通过 `LUMEN_CAPTURE_WIDTH=1040 LUMEN_CAPTURE_HEIGHT=700` 验证最小窗口。脚本只操作隔离的 Electron `userData`，不会修改日常 App 数据。

验证运行中删除门、显式停止、Lead 调整、重命名和永久删除：

```bash
LUMEN_CAPTURE_USER_DATA_DIR="$(mktemp -d)/user-data" \
LUMEN_CAPTURE_RUNTIME_KIND=codex-cli \
LUMEN_CAPTURE_SEND_CAMP=1 \
LUMEN_CAPTURE_CAMP_MANAGEMENT=1 \
LUMEN_CAPTURE_DELETE_AFTER_RUN=1 \
node scripts/capture-desktop.mjs \
  "dist/mac-arm64/Lumen AI.app" \
  /tmp/lumen-v004-app
```

复用该 `userData` 并设置 `LUMEN_CAPTURE_ASSERT_EMPTY_ON_START=1`，可验证已删除 Camp 和其派生 Project 在 App 重启后不会复活。

## 7. 生成目录

以下目录由开发或构建过程生成，不应提交：

| 路径 | 内容 |
| --- | --- |
| `target/` | Rust Debug/Release 构建结果 |
| `resources/bin/` | 复制后用于打包的 Rust Core |
| `out/` | Electron Vite 构建结果 |
| `dist/` | macOS App 和 DMG |
| `node_modules/` | pnpm 安装依赖 |

Camp、运行、事件和审批等数据位于 Electron `userData` 目录；准确位置可在应用“设置”的诊断区查看。
