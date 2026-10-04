---
document_type: development-index
authority: development-routing
last_updated: 2026-09-27
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

`pnpm dev` 会构建 Debug 版 `rovai-host`、兼容 `rovai-core` 与 bundled `rovai` Agent CLI、复制到
`resources/bin/`，然后启动 Electron Vite 开发环境。该入口通过 `scripts/dev-desktop.mjs`
自动传入隔离 `userData`、拒绝日常
数据目录和独立 Skill Library，并锁定单一开发实例；Core 还会独占同一数据目录。不要直接运行
`electron-vite dev` 绕过它。

只重新构建 Debug Core：

```bash
pnpm core:build:debug
```

独立 Host/Web 的运行与当前能力边界见 [Server 开发预览](server-preview.md)。

## 执行评测

修改上下文或内置 Skill、运行每周回归、配置每日 Trace 分析时，读取[Gate 与双轨评测](evaluation.md)。规则、实际执行、Judge 与统计覆盖分别保留证据。

## 日常验证

当前仓库没有聚合的 `pnpm check` 命令。日常提交前分别运行：

```bash
pnpm typecheck
pnpm test
cargo test -p rovai-core --lib runtime_discovery::
```

上面的 Rust 命令以 Runtime discovery 改动为例。局部修改直接用 Cargo 名称过滤运行相关 owner；
涉及共享基础设施时扩大范围。同一轮集成只由一个执行者运行完整回归，不在每个 worktree 重复执行。
兼容的 staged 路由仍见[测试与 Smoke Test](testing.md#兼容-staged-rust-路由)，但它按 target 选择范围，
不能替代模块级定向命令。

`pnpm test` 会先运行 `pnpm docs:check`，验证唯一当前版本指针、版本目录 Front Matter
和版本索引一致，并验证 Version Decisions、迁移证据、当前权威覆盖、Architecture 索引及
全仓 Markdown 本地链接；它还显式运行文档治理单测。只修改文档时，可以先运行：

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<目标分支 base SHA> pnpm docs:check:ci
```

PR 快速门禁必须提供真实 base SHA；`docs:check:ci` 以它验证 historical
`decisions.md` 未被静默改写，本地普通 `docs:check` 不伪造或推测 base。合并到 `main` 后不再自动重复
执行该门禁。

push / PR 前由集成执行者运行默认 feature 的 Rust 回归：

```bash
pnpm test:rust:pr
```

`test:rust:pr` 一次运行当前 400 项 default-feature workspace，不包含 `extended-tests`、`slow-tests`
或历史 Migration feature。修改扩展 owner 时运行 `pnpm test:rust:extended`；`test:rust:full` 一次运行
all-features workspace，供手动完整验收使用。PR 的 `CI / gate` 仅执行
`cargo fmt --all --check` 和生产 target 的 `cargo check --workspace`；测试 target、all-features
Clippy、测试与 Windows 专项验证由手动 `Full check` workflow 承接。
涉及桌面构建或跨边界改动时继续运行：

```bash
pnpm build:desktop
```

Preload 请求 transport 或 Renderer 错误读取改动还须运行 `pnpm test:desktop-bridge`，通过真实 Electron 隔离世界验证
成功值和结构化拒绝；临时目录与 headless CI 说明见[Electron 隔离世界回归](testing.md#electron-隔离世界回归)。
修改 macOS 独立关窗 Draft fence 时运行 `pnpm test:window-close`：隔离 Electron 验证等待准备、失败重试、关窗不退出
及重新开窗，不启动 Core 或 Runtime；该项属于 `test:desktop:integration`，headless Linux 使用 `xvfb-run -a`。
修改 Windows 关闭选择、记忆或托盘生命周期时运行 `pnpm test:windows-close`：使用生产 Main owner、preload 与设置/Dialog
组件，在隔离 Electron 中验证隐藏、恢复、保存失败和显式退出。非 Windows 主机只证明控制流；Windows 主机额外创建
真实 Tray。`Full check` 的 `desktop-windows` scope 可单独运行 Windows Desktop 自动化，不代表 Windows 10/11 交互验收。
修改 Desktop 历史导航、侧栏按钮或平台输入时运行 `pnpm test:navigation-shell` 与 `pnpm test:startup-presentation`，
并运行 `desktop-navigation` / `window-navigation` 定向 Vitest；历史只在内存中保存，复用既有隔离 Electron 夹具。
修改启动页面、Supervisor Renderer gate 或 400ms 反馈时运行 `pnpm test:startup-presentation`：真实 Electron 中挂载生产
App，以受控本机 API 和时钟验证页面框架、截止时间与 authority 请求门禁，不启动 Core 或访问日常数据。
修改审批 Dock 的焦点、原生选项或 Reason 展示时运行 `pnpm test:approval-dock`，使用生产组件的隔离 Electron
夹具验证键盘操作与动态布局，不启动 Core 或模型。
修改消息选文引用时运行 `pnpm test:message-quotes`：隔离 Electron 使用生产正文、引用组件与共享投影样例，验证选区排除、原生悬浮、键盘、完整选文和整行定位。验收窗口使用独立 userData，不启动 Core 或模型；其他会争用 OS 焦点的 Electron 验收应顺序运行。
修改发布说明语言分段或更新页语言选择时运行 `pnpm test:release-notes-ui`：隔离 Electron 挂载正式更新页，验证即时中英文切换、当前/新版本 tab 保留、历史与单语回退、引用链接及安全 Markdown，不启动 Core 或模型；`ROVAI_KEEP_RELEASE_NOTES_FIXTURE=1` 保留截图。
修改用户消息锚点时运行 `pnpm test:message-anchors`：隔离 Electron 使用生产 CampWorkspace，验证用户数量阈值、日夜主题、原生悬浮、可见范围、首条回复、长轨道与内部滚动、键盘定位、历史加载和草稿保留；不启动 Core 或模型。
修改队员运行配置批量应用时运行 `pnpm test:member-runtime-apply`：隔离 Electron 挂载正式 MembersView，验证选择、覆盖、逐人版本校验、部分失败重试、未知回执核对、两部分草稿、提交中的离开保护、中英文、手机横竖屏和缩放。使用显式 transport fixture，不启动 Core 或模型；`ROVAI_KEEP_MEMBER_RUNTIME_APPLY_FIXTURE=1` 保留截图及验证记录。原有 `node --test scripts/lib/member-editor.test.mjs` 仍保护队员编辑主流程。
修改飞书接口扫码时运行 `pnpm test:feishu-login`：隔离 Electron 使用生产 Session HTTP、被动 HTML bootstrap、Cookie
恢复和 QR Dialog 验证登录没有隐藏窗口、进度与本地提交的取消边界。默认使用受控响应；
`ROVAI_FEISHU_LIVE_PROBE=1 pnpm test:feishu-login` 另做匿名真实 init/poll，不替代真人扫码与 Bot 发布。
修改钉钉内置扫码与官方原生页时运行 `pnpm test:dingtalk-login`：使用生产 Renderer/preload、Main native view 与本机页面
验证二维码、刷新、静默取消、旧账号保留、缩放/裁剪和 bridge 隔离；不替代真实扫码、Core 或远端发布验收。
修改文件预览分栏、Tab 或 File Change 详情时运行 `pnpm test:file-preview-layout`：真实 Electron 中组合生产标题栏、分栏、Tab 和 Viewer，
验证鼠标/键盘调整、关闭与取消、比例持久化、单 Pane 替换、420–480px 会话紧凑排版与阅读位置保留；
并验证常驻预览按钮、变更 Tab/当前文件切换、历史来源隔离、加载重试与原生拖拽区排除点击控件；不启动 Core 或模型。

真实 Runtime Smoke、完整 macOS 打包、Windows 打包/安装和 UI 截图验收耗时更长，且部分命令会调用上游
模型。它们保持独立，不进入普通 commit 门禁；运行前先阅读对应文档。

修改执行台指标读取生命周期时运行 `pnpm test:execution-metrics-ui`：使用生产 CampWorkspace 和 CSS、
隔离 Electron 与 500 个合成 Run，验证视口范围、展开、隐藏／恢复、稳定终态停止轮询、
迟到 Usage 和 Session Context 换代／失效；不启动 Core 或真实 Runtime。

## 按任务阅读

| 任务 | 文档 |
| --- | --- |
| 启动开发 App、运行打包产物或区分日常/开发数据 | [本地开发与 App 隔离流程](local-workflow.md) |
| 配置和验收钉钉 Web Session 渠道 | [本地开发与 App 隔离流程：钉钉 Web Session](local-workflow.md#钉钉-web-session-验收前置)、[DingTalk Channel v14](../contracts/dingtalk-channel-v14.md)、[Channel Storage v3](../contracts/channel-storage-v3.md) |
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
