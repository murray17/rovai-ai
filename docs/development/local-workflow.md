---
document_type: development-guide
authority: local-development-workflow
last_updated: 2026-08-11
---

# 本地开发与 App 隔离流程

本文是人类开发者和 AI Agent 在本机构建、启动或验收 Rovai-ai 时的执行合同。目标不是约定某台
机器的绝对路径，而是保证正在日常使用的 App、开发进程、打包产物和测试夹具不会共享可变二进制
或 `userData`。

## 四个运行通道

| 通道 | App / Core 来源 | `userData` | 允许用途 |
| --- | --- | --- | --- |
| 日常安装版 | 仓库外的已安装 `.app`，通常位于 `/Applications` 或 `~/Applications` | Electron 日常数据目录 | 用户真实 Camp 和 Runtime 工作；开发任务默认只读 |
| 开发版 | `pnpm dev` 使用 `resources/bin/` 与 Electron Vite | 启动器生成的逐仓库隔离目录 | HMR、功能开发、手工调试 |
| 打包产物 | `dist/mac-arm64/Rovai-ai.app` | 每次验收显式创建的隔离目录 | 签名、打包和一次性 App 验收 |
| 自动验收 | 脚本声明的 App/Core 与 fixture | 脚本创建的临时目录 | Smoke、截图和回归测试 |

`dist/` 是可被 `pnpm package:mac` 覆盖的生成目录，不是安装位置。日常 App 不得从仓库的
`dist/`、`out/` 或 `resources/` 运行。只把 `.app` 复制到另一个目录仍不足以完成隔离：开发和验收
进程还必须使用独立 `userData`。

无论通道如何，Core 都只接受显式绝对 `--data-dir`。它会在打开 SQLite 和执行 startup recovery
之前独占该目录的 `.rovai-core-instance.lock`；第二个 Core 必须拒绝启动且不得修改数据库。该文件
会保留供诊断使用，进程退出时释放的是操作系统锁，不要把“删除锁文件”当作并发修复手段。

## AI 必读规则

任何 AI Agent 在启动 Electron、Core 或真实 Runtime 前必须完成以下判断：

1. 先读取根目录 `AGENTS.md`、[开发者指南](README.md)和本文；
2. 执行 `git status --short`，保留不属于当前任务的并行改动；
3. 明确本次属于“开发版”“打包产物”还是“自动验收”，并在更新中写出目标通道；
4. 在命令执行前解析精确、绝对的 `userData`；没有独立目录证据时不得启动 App/Core；Core 自身的
   独占锁是最终防线，不替代通道选择；
5. 真实日常数据默认只读。诊断不授权启动第二个 Core、写 SQLite、取消 Run、Retry 或发送消息；
6. 不得为了方便直接调用 `electron-vite dev`、直接打开 `dist/.../Rovai-ai.app`，或让
   `rovai-core --data-dir` 指向日常目录；
7. 测试结束后只清理本次命令创建且路径已经确认的临时目录，不推测或递归删除日常目录。

## 开发版：只使用 `pnpm dev`

安装依赖后启动开发版：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 先构建 Debug Core 和原生模块，再通过 `scripts/dev-desktop.mjs` 启动 Electron。启动器会：

- 为当前仓库解析稳定、独立的开发 `userData` 并在启动日志中打印精确路径；
- 同时传入 `--user-data-dir` 与 `ROVAI_ALLOW_ISOLATED_INSTANCE=1`；
- 拒绝已知的日常 Rovai/历史 Lumen 数据目录及其子目录；
- 使用开发启动锁拒绝两个 `pnpm dev` 共享同一 `userData`；Core 再用进程级锁封住所有其他入口。

只检查解析结果而不启动 App：

```bash
node scripts/dev-desktop.mjs --print-config
```

需要显式保留某个开发 fixture 时，可以覆盖目录，但仍会经过日常目录拒绝检查：

```bash
ROVAI_DEV_USER_DATA_DIR="$(mktemp -d)/user-data" pnpm dev
```

不要用 `electron-vite dev` 绕过启动器。不要把日常数据库复制到默认开发目录；复现真实 Camp 时按
[桌面 UI 验收](ui-acceptance.md#从明确来源创建只读隔离副本)创建一次性副本。

## 打包产物：构建与运行分开

构建只生成产物，不改变或重启日常安装版：

```bash
pnpm package:mac
```

需要运行刚生成的 App 时，必须显式使用隔离目录：

```bash
ROVAI_APP="$(pwd)/dist/mac-arm64/Rovai-ai.app"
FIXTURE_ROOT="$(mktemp -d)"
ROVAI_ALLOW_ISOLATED_INSTANCE=1 \
"$ROVAI_APP/Contents/MacOS/Rovai-ai" \
  --user-data-dir="$FIXTURE_ROOT/user-data"
```

AI Agent 不得把 `open "$(pwd)/dist/mac-arm64/Rovai-ai.app"` 当作打包验证，因为该命令没有证明
`userData` 隔离。签名和二进制检查不需要启动 App，优先使用
[macOS 构建与打包](packaging.md)中的只读命令。

## 日常安装版：显式提升，不参与开发循环

日常安装版必须位于仓库和生成目录之外。把一个已验收构建提升为日常安装版属于显式用户操作，
不是 `pnpm build`、`pnpm package:mac`、测试或 AI 收尾步骤。提升前必须：

1. 完成隔离 App 验收；
2. 彻底退出旧日常 App 和开发/验收实例；
3. 将已确认的 `.app` 安装到仓库外位置；
4. 从安装位置重新启动，并确认进程命令行不再指向仓库 `dist/`；
5. 保留原日常 `userData`，不把开发 fixture 覆盖过去。

除非用户明确要求安装或升级，AI Agent 不复制、替换、移动或删除日常 `.app`。

## 日常数据诊断边界

排查真实 Camp 时可以执行与问题直接相关的只读检查，但不能启动另一份 Core 来“读取”数据。允许的
典型操作包括进程列表、文件元数据、`sqlite3 -readonly` 和系统日志查询。需要数据库副本时，先退出
日常 App，再使用 SQLite Backup API；不得复制单独的主数据库文件而忽略 WAL。

如果发现以下任一情况，应停止新的 Runtime 投递并报告隔离事故：

- 日常 App 进程路径位于仓库 `dist/`、`out/` 或 `resources/`；
- 两个 `rovai-core` 同时使用同一 `--data-dir`；
- 开发或验收命令未声明独立 `userData`；
- `runtime.input_prepared` 后出现非预期 startup recovery、`delivery_unknown` 或版本冲突；
- 构建期间正在运行的日常 App 引用了同一个可覆盖 bundle。

发生事故后不要盲目 Retry。先确认 Runtime 是否可能已经接收输入、检查目标工作区副作用，再决定创建
successor Run、人工恢复或只保留诊断证据。

使用包含 Core 独占锁的新构建时，第二个 Core 会在数据库恢复前失败；若仍看到它写入
`runtime.v2_recovery_prepared`，先核对实际运行二进制是否来自旧构建，再继续诊断。

## 最小验证矩阵

| 改动 | 最低验证 |
| --- | --- |
| 启动器或本流程 | `node --test scripts/lib/dev-desktop.test.mjs`、`node scripts/dev-desktop.mjs --print-config` |
| 普通 TypeScript / Renderer | `pnpm typecheck`、相关测试 |
| Rust Core | 按[测试与 Smoke Test](testing.md)选择定向或完整 Rust 验证 |
| 打包或 Electron Main | `pnpm build:desktop`；需要运行 App 时继续做隔离验收 |
| 文档路由 | `pnpm docs:test`、`pnpm docs:check`、ADR 通用治理检查 |
