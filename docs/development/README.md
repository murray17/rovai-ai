---
document_type: development-index
authority: development-routing
last_updated: 2026-08-30
---

# Rovai-ai 开发者指南

本目录是本地开发命令的唯一常青入口。根目录
[`package.json`](../../package.json)中的 scripts 决定命令实际行为；本文档负责说明
用途、前置条件和安全边界，不复制版本实施计划或测试内部断言。

## 快速开始

先阅读[本地开发与 App 隔离流程](local-workflow.md)。日常使用的 `.app` 必须安装在仓库外；
`dist/` 只是可覆盖的打包产物。开发、打包验收和自动测试都不得共享日常 `userData`。
所有 `rovai-core` 启动都必须收到显式绝对 `--data-dir`，并在互斥的日常默认 Skill Library 与绝对
隔离 `--skill-library-root` 中恰好选择一个；开发和测试只能选择隔离 Library。Core 会在打开 SQLite
或执行 startup recovery 之前获取 data-dir 的进程级独占锁；这些约束是启动器检查之外的最终写入边界。

为 durable Task 创建或复用隔离目录时，同时阅读
[Git Worktree 生命周期与清理](worktrees.md)。Rovai-ai 的 Rust、Electron 和打包生成物会让每个
活跃 worktree 占用数 GiB；Task 已合入或明确放弃后，清理 worktree 是同一次任务收口的一部分，
不能无限期留待以后处理。

代码 Push 流程统一走 PR，参考：[本地开发提交与主线合入流程](local-workflow.md#代码-push-流程)。

在仓库根目录安装锁定依赖并启动开发版桌面应用：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会构建 Debug 版 `rovai-core` 与 bundled `rovai` Agent CLI、复制到
`resources/bin/`，然后启动 Electron Vite 开发环境。该入口通过 `scripts/dev-desktop.mjs`
自动传入隔离 `userData`、拒绝日常
数据目录和独立 Skill Library，并锁定单一开发实例；Core 还会独占同一数据目录。不要直接运行
`electron-vite dev` 绕过它。

只重新构建 Debug Core：

```bash
pnpm core:build:debug
```

## 日常验证

当前仓库没有聚合的 `pnpm check` 命令。日常提交前分别运行：

```bash
pnpm typecheck
pnpm test
pnpm test:rust:staged
```

`test:rust:staged` 只读取 Git index 中的 staged 文件。没有 Rust/Cargo 改动时跳过；单一
Library、`rovai` CLI 或 `rovai-core` Main target 改动时先运行 `cargo check`，再运行对应
target 测试；Cargo 配置、`src/lib.rs`、多 target、删除/重命名或无法可靠分类的改动自动回退到
`pnpm test:rust:workspace-default`（default-feature workspace）。详细路由见
[测试与 Smoke Test](testing.md#staged-rust-路由)。

`pnpm test` 会先运行 `pnpm docs:check`，验证唯一当前版本指针、版本目录 Front Matter
和版本索引一致，并验证 Version Decisions、迁移证据、当前权威覆盖、Architecture 索引及
全仓 Markdown 本地链接；它还显式运行文档治理单测。只修改文档时，可以先运行：

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<目标分支 base SHA> pnpm docs:check:ci
```

PR CI 必须提供真实 base SHA；`docs:check:ci` 以它验证 historical
`decisions.md` 未被静默改写，本地普通 `docs:check` 不伪造或推测 base。

push / PR 前运行完整 Rust 验证：

```bash
pnpm test:rust:pr
cargo clippy --workspace --all-targets -- -D warnings
```

`test:rust:pr` 明确串行执行 fast library、`rovai` CLI 和 slow integration 三个范围。
`test:rust:workspace-default` 只运行 default-feature workspace；旧 `test:rust:full` 是该范围的
兼容 alias，不代表 PR 或 all-features 门禁。Rust CI 还会执行 `cargo fmt --all --check` 和 Clippy。
涉及桌面构建或跨边界改动时继续运行：

```bash
pnpm build:desktop
```

Preload 请求 transport 或 Renderer 错误读取改动还须运行 `pnpm test:desktop-bridge`，通过真实 Electron 隔离世界验证
成功值和结构化拒绝；临时目录与 headless CI 说明见[Electron 隔离世界回归](testing.md#electron-隔离世界回归)。
修改启动页面、Supervisor Renderer gate 或 400ms 反馈时运行 `pnpm test:startup-presentation`：真实 Electron 中挂载生产
App，以受控本机 API 和时钟验证页面框架、截止时间与 authority 请求门禁，不启动 Core 或访问日常数据。
修改文件预览分栏、Tab 或 File Change 详情时运行 `pnpm test:file-preview-layout`：真实 Electron 中组合生产标题栏、分栏、Tab 和 Viewer，
验证鼠标/键盘调整、关闭与取消、比例持久化、单 Pane 替换、420–480px 会话紧凑排版与阅读位置保留；
并验证常驻预览按钮、变更 Tab/当前文件切换、历史来源隔离、加载重试与原生拖拽区排除点击控件；不启动 Core 或模型。

真实 Runtime Smoke、完整 macOS 打包、Windows 打包/安装和 UI 截图验收耗时更长，且部分命令会调用上游
模型。它们保持独立，不进入普通 commit 门禁；运行前先阅读对应文档。

## 按任务阅读

| 任务 | 文档 |
| --- | --- |
| 启动开发 App、运行打包产物或区分日常/开发数据 | [本地开发与 App 隔离流程](local-workflow.md) |
| 配置和验收钉钉 OAuth/Developer API 渠道 | [本地开发与 App 隔离流程：钉钉 OAuth](local-workflow.md#钉钉-oauth-与-developer-api-验收前置)、[DingTalk Channel v3](../contracts/dingtalk-channel-v3.md)、[Channel Storage v2](../contracts/channel-storage-v2.md) |
| 创建、复用、交接、合入或清理 Git worktree | [Git Worktree 生命周期与清理](worktrees.md) |
| 判断主机、Node、pnpm、Rust、Git 或 Runtime 前置条件 | [开发环境与依赖](environment.md) |
| 新增 Product Runtime、建立真实 Probe 或完成逐平台准入 | [Agent Runtime 接入与准入 Checklist](runtime-integration-checklist.md) |
| 新增、合并或退役 Rust 测试，或选择单元测试、集成测试、Smoke 与版本验收命令 | [测试与 Smoke Test](testing.md) |
| 编写或更新仓库 Skill、触发 `description`、正文分层、references 或界面元数据 | [Skill 编写与 description 路由规范](skill-authoring.md) |
| 修改 Native Session Bootstrap、AgentRun Dynamic Context、模型可见 section/字段/语义或其证据与 formatter 版本 | [核心模型上下文变更治理](model-context-change-governance.md) |
| 构建 Release Core、App、DMG，检查签名 | [macOS 构建与打包](packaging.md) |
| 构建或验收 Windows x64 sidecar、NSIS、签名与升级 | [Windows x64 构建、打包与发布](packaging-windows.md) |
| 使用隔离 `userData` 运行真实 App、截图或桌面验收 | [桌面 UI 验收](ui-acceptance.md) |
| 为 Coding Agent 安装本地 Impeccable、更新设计上下文或维护 UI 文档分类 | [Coding Agent Impeccable 与 UI 文档工作流](coding-agent-impeccable-ui-workflow.md) |
| 处理 Core、Runtime、Git、签名、测试卡住或 Rust `target/` 膨胀 | [常见问题排查](troubleshooting.md) |

具体版本的页面矩阵、Schema 版本、Migration 路径和验收证据属于
[`docs/versions/`](../versions/README.md)。唯一当前版本指针由
[`docs/versions/README.md`](../versions/README.md)声明，[文档导航](../README.md)只负责路由。

## 真源与维护边界

- 命令名和命令组合：[`package.json#scripts`](../../package.json)。
- Node 与 macOS/Windows 打包声明：`package.json#engines`、`package.json#build.mac`、`package.json#build.win`
  和 `package.json#build.nsis`；命令仍以 `package.json#scripts` 为真源。
- Rust workspace 与共享构建 profile：[`Cargo.toml`](../../Cargo.toml)；当前没有最低 Rust 版本或
  `rust-toolchain.toml`，文档不得自行补造。
- 正式 Runtime 产品目录：Core 的
  [`AdapterKind::ALL`](../../crates/rovai-core/src/agent_profile.rs)。
- Runtime 实测兼容性：
  [`runtime-compatibility.md`](../runtime-compatibility.md)。
- 当前版本验收口径：当前版本的 `implementation-plan.md`。

常青开发文档不记录某台机器的即时版本，不把历史 Schema 编号写成永久要求，也不把
版本专属视觉结果提升为通用规则。新增、删除或重命名 `smoke:*`、`accept:*`、
`package:*` 命令时，必须在同一改动中更新本目录对应表格。

`pnpm doctor`、机器可读测试目录和自动生成命令表目前尚未实现。实现前不得把它们写成
可用命令；后续应单独设计其模式、最低版本政策和 CI 防漂移校验。

## 生成目录

以下目录由安装、开发或打包过程生成，不应提交：

| 路径 | 内容 |
| --- | --- |
| `node_modules/` | pnpm 安装依赖 |
| `target/` | Rust Debug/Test/Release 构建结果与增量编译缓存 |
| `resources/bin/` | 复制后供 Electron 使用的 Rust Core 与 Agent CLI |
| `out/` | Electron Vite 构建结果 |
| `dist/` | macOS App/DMG、Windows unpacked/NSIS package、verifier 与安装验收输出 |

不同 worktree 默认各自拥有这些生成目录。开发工作已完成时，应按
[Worktree 清理流程](worktrees.md#工作收口与安全清理)删除整个 worktree；仍在开发的 worktree
若只需处理 Rust 缓存异常，则按[常见问题排查](troubleshooting.md#target-占用异常增长或磁盘不足)
选择性清理，不把每日 `cargo clean` 当作常规维护。

Camp、运行、事件和审批数据位于 Electron `userData`。诊断中心和 v5 导出不再显示或输出绝对
`userData` / SQLite 路径；需要制作数据库副本时，应从已退出的隔离验收环境或 Electron 开发日志取得精确位置，
不根据文档推测。
