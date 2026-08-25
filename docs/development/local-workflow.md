---
document_type: development-guide
authority: local-development-workflow
last_updated: 2026-08-25
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
| 打包产物 | `dist/mac-arm64/Rovai AI.app` | 每次验收显式创建的隔离目录 | 签名、打包和一次性 App 验收 |
| 自动验收 | 脚本声明的 App/Core 与 fixture | 脚本创建的临时目录 | Smoke、截图和回归测试 |

`dist/` 是可被 `pnpm package:mac` 覆盖的生成目录，不是安装位置。日常 App 不得从仓库的
`dist/`、`out/` 或 `resources/` 运行。只把 `.app` 复制到另一个目录仍不足以完成隔离：开发和验收
进程还必须使用独立 `userData`。显式隔离的 Desktop 实例会同时把 Core Skill Library 绑定到该
`userData` 下的 `managed-skill-library/`；只隔离 SQLite、却继续共享日常 Skill Library 不构成完整隔离。

无论通道如何，Core 都只接受显式绝对 `--data-dir`，并要求 Skill Library 选择恰好为以下一种：
日常 macOS Desktop 显式传入 `--use-default-skill-library`；Windows Desktop、显式收到
`--user-data-dir` 的 Desktop，以及其他开发、Smoke 或验收入口，都必须显式传入绝对
`--skill-library-root`。缺失或同时传入两种选择时，
Core 必须在创建、修复或清理 Skill Revision 前失败。Core 会在打开 SQLite 和执行 startup recovery
之前独占 data-dir 下的 `.rovai-core-instance.lock`；第二个 Core 必须拒绝启动且不得修改数据库。
该文件会保留供诊断使用，进程退出时释放的是操作系统锁，不要把“删除锁文件”当作并发修复手段。

Windows 的 `--user-data-dir=<root>` 是隔离 data-root 开关，不直接等于 Electron `userData`。Desktop 在
`app.ready` 前先由 `rovai-core.exe --prepare-windows-data-root <root>` 原生创建并准入完整布局，再把 Core
绑定到 `<root>\Core`，把 Electron `userData` / `sessionData` 分别绑定到
`<root>\Electron\User Data` / `<root>\Electron\Session Data`，并将隔离 Skill Library 放在
`<root>\Core\managed-skill-library`。验收方必须传入一个尚未被普通 `mkdir` 以继承 ACL 创建的目标 root；
已有但不满足 protected DACL 的未知目录会按合同拒绝，而不是被静默修权后复用。macOS 的现有
`--user-data-dir` 语义保持不变。

## AI 必读规则

任何 AI Agent 在启动 Electron、Core 或真实 Runtime 前必须完成以下判断：

1. 先读取根目录 `AGENTS.md`、[开发者指南](README.md)和本文；
2. 执行 `git status --short`，保留不属于当前任务的并行改动；
3. 明确本次属于“开发版”“打包产物”还是“自动验收”，并在更新中写出目标通道；
4. 在命令执行前解析精确、绝对的 `userData` 和隔离 Skill Library；没有两者的独立目录证据时不得
   启动开发、Smoke 或验收 App/Core；Core 的启动参数门和独占锁是最终防线，不替代通道选择；
5. 真实日常数据默认只读。诊断不授权启动第二个 Core、写 SQLite、取消 Run、Retry 或发送消息；
6. 当前会话宿主保护：默认保持承载当前 AI/Camp 会话的日常 App 运行。一般性的“安装”“升级”或
   “打包到 Applications”不构成退出、终止或重启该宿主的授权；用户已经明确要求安装或升级时，优先按
   [非终止安装交接](#当前会话中的非终止安装交接)保留当前进程并替换磁盘上的日常安装版。前置条件不满足时
   停在安装边界，交由用户手动处理，或先取得针对本次退出的明确即时授权；
7. 不得为了方便直接调用 `electron-vite dev`、直接打开 `dist/.../Rovai AI.app`，或让
   `rovai-core --data-dir` 指向日常目录；
8. 测试结束后只清理本次命令创建且路径已经确认的临时目录，不推测或递归删除日常目录。

## 代码 Push 流程

本仓库所有变更统一通过 Pull Request 合入 `main`。

本地开发完成后的固定流程是：

1. 从已同步的 `origin/main` 创建 `rovai/<task>` 任务分支。需要隔离目录时，按
   [Git Worktree 生命周期与清理](worktrees.md)创建并记录分支、基线和绝对路径；
2. 在任务分支实施、提交并完成与改动风险相称的本地门禁；
3. 使用 `git push -u origin <任务分支>` 推送任务分支，然后创建以 `main` 为 base 的 PR，并向用户提供
   PR 链接；
4. 等待仓库要求的 Review 与 CI 通过后合并 PR；
5. 合并后执行 `git fetch origin main`，确认任务提交已进入 `origin/main`，再同步本地主 checkout；
6. 使用 worktree 时，确认远端已合入且工作目录干净后，再移除 worktree 与本地任务分支。

若 PR 创建或合并受阻，保留已推送的任务分支并报告原因。

## 开发版：只使用 `pnpm dev`

安装依赖后启动开发版：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 先构建 Debug Core 与 bundled Agent CLI，再通过 `scripts/dev-desktop.mjs` 启动 Electron。启动器会：

- 为当前仓库解析稳定、独立的开发 `userData` 并在启动日志中打印精确路径；
- 让 Desktop 通过显式 Core 参数把 Skill Library 固定在该开发 `userData` 内；
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
ROVAI_APP="$(pwd)/dist/mac-arm64/Rovai AI.app"
FIXTURE_ROOT="$(mktemp -d)"
ROVAI_ALLOW_ISOLATED_INSTANCE=1 \
"$ROVAI_APP/Contents/MacOS/Rovai AI" \
  --user-data-dir="$FIXTURE_ROOT/user-data"
```

Desktop 检测到这组显式隔离标记后，会以
`--skill-library-root "$FIXTURE_ROOT/user-data/managed-skill-library"` 启动 Core；验收脚本不得绕过
Desktop 另起一个仍指向日常全局 Skill Library 的 Core。

AI Agent 不得把 `open "$(pwd)/dist/mac-arm64/Rovai AI.app"` 当作打包验证，因为该命令没有证明
`userData` 隔离。签名和二进制检查不需要启动 App，优先使用
[macOS 构建与打包](packaging.md)中的只读命令。

## 日常安装版：显式提升，不参与开发循环

日常安装版必须位于仓库和生成目录之外。把一个已验收构建提升为日常安装版属于显式用户操作，
不是 `pnpm build`、`pnpm package:mac`、测试或 AI 收尾步骤。`package:mac` 是隔离验收用 ad-hoc 产物，
不得复制到日常安装位置；日常提升只能使用 `pnpm package:mac:daily` 生成的固定签名产物和
`pnpm install:mac:daily` 安装门。提升前必须：

1. 完成隔离 App 验收；
2. 验证待安装 `.app`、内置 Core 和 CLI 的签名与目标架构，并把它暂存到日常安装目录所在文件系统中的
   唯一路径；
3. 确认日常安装目标只能是 `/Applications/Rovai AI.app`；暂存和备份路径必须是同一父目录中的精确
   绝对路径，备份路径尚不存在；
4. 旧日常 App 已退出时，替换安装并从日常安装路径重新启动；承载当前会话的 App 仍在运行时，执行下方
   非终止安装交接；
5. 保留原日常 `userData`，不把开发 fixture 覆盖过去，并确认新进程命令行不再指向仓库 `dist/`。

除非用户明确要求安装或升级，AI Agent 不复制、替换、移动或删除日常 `.app`。

典型命令（备份路径必须是本次解析出的、尚不存在的绝对路径）：

```bash
pnpm package:mac:daily
pnpm install:mac:daily -- --backup "/Applications/Rovai AI.backup-before-<timestamp>.app"
```

安装脚本以 no-follow 路径项检查准入 target 和 backup：任何既有 backup 路径项、以及符号链接 target 都在
验签、复制或改名前 fail closed，dangling symlink 也不例外。脚本在源、同文件系统暂存和最终目标三个位置
执行固定签名验证，并在最终验证失败时尽力恢复旧安装。交换开始前失败会明确报告旧安装仍在规范路径；若
宿主文件系统在回滚期间又拒绝改名，脚本会分别报告规范路径是旧安装、未验证候选或缺失，并保留可用的
备份/失败候选位置，不会把不完整回滚误报成成功。需要管理员权限时，只提升安装脚本本身；不要以管理员
身份执行依赖安装或构建。

### 当前会话中的非终止安装交接

用户明确要求把新构建安装到日常位置、而当前日常 App 正承载同一 AI/Camp 会话时，按以下顺序完成安装，
无需终止当前进程：

1. 记录当前 App、Core 和 Helper 的 PID，并确认它们都来自同一个日常 `.app`；新构建必须通过
   `package:mac:daily` 的固定签名与架构验证；
2. 用 `install:mac:daily` 把新 bundle 复制到日常安装目录的唯一暂存路径；脚本验证暂存 bundle 后，将旧
   App 原子改名到不存在的显式备份路径，再把暂存 App 原子改名到规范路径，不修改 `userData`；
3. 脚本从规范安装路径第三次验证新 App、Core 和 CLI；任一复制、改名或验证失败时，在不扩大清理范围的
   前提下恢复旧安装。若回滚本身受宿主故障阻断，以脚本报告的规范路径和备份状态为准，不得宣称旧安装
   已恢复。随后确认记录的旧进程仍存活；
4. 将结果表述为“新版本已安装、当前进程仍是旧版本”，不把磁盘替换误报为热升级，也不在旧实例仍运行时
   打开第二个日常实例；
5. 用户稍后自行退出后，应从规范安装路径显式打开新 App，不能依赖可能仍指向已改名备份的 Dock、Spotlight
   或 LaunchServices 引用。新版本验证完成前保留备份；删除备份需要独立、明确的用户指令。

文件系统改名本身不向已运行进程发送终止信号，因此当前会话可以继续使用已经加载的旧版本；新版本只在
下一次从规范安装路径启动时生效。

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
