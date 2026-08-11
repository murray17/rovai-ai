---
document_type: development-index
authority: development-routing
last_updated: 2026-08-11
---

# Rovai-ai 开发者指南

本目录是本地开发命令的唯一常青入口。根目录
[`package.json`](../../package.json)中的 scripts 决定命令实际行为；本文档负责说明
用途、前置条件和安全边界，不复制版本实施计划或测试内部断言。

## 快速开始

先阅读[本地开发与 App 隔离流程](local-workflow.md)。日常使用的 `.app` 必须安装在仓库外；
`dist/` 只是可覆盖的打包产物。开发、打包验收和自动测试都不得共享日常 `userData`。
所有 `rovai-core` 启动都必须收到显式绝对 `--data-dir`，并在打开 SQLite 或执行 startup recovery
之前获取该目录的进程级独占锁；这是启动器检查之外的最终写入边界。

在仓库根目录安装锁定依赖并启动开发版桌面应用：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会构建 Debug 版 `rovai-core` 与 bundled `rovai` Agent CLI、复制到
`resources/bin/`，再构建 macOS 文件面板原生预热器到 `resources/native/`，然后启动
Electron Vite 开发环境。该入口通过 `scripts/dev-desktop.mjs` 自动传入隔离 `userData`、拒绝日常
数据目录并锁定单一开发实例；Core 还会独占同一数据目录。不要直接运行 `electron-vite dev` 绕过它。

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
`cargo test --workspace`。详细路由见[测试与 Smoke Test](testing.md#staged-rust-路由)。

`pnpm test` 会先运行 `pnpm docs:check`，验证唯一当前版本指针、版本目录 Front Matter
和版本索引一致，并验证 ADR schema/生命周期/直接替代图、CURRENT/HISTORY、Architecture 索引及
全仓 Markdown 本地链接；它还显式运行文档治理单测。只修改文档时，可以先运行：

```bash
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=<目标分支 base SHA> pnpm docs:check:ci
pnpm docs:adr:generate -- --check
```

最后一条只验证生成式 HISTORY 未漂移；更新 HISTORY 时运行不带 `--check` 的
`pnpm docs:adr:generate`。PR CI 必须提供真实 base SHA，本地缺少该参数时 `docs:check:adr`
只运行 snapshot check 并明确报告 diff freeze skipped。

push / PR 前运行完整 Rust 验证：

```bash
pnpm test:rust:full
cargo clippy --workspace --all-targets -- -D warnings
```

Rust CI 还会执行 `cargo fmt --all --check`，并在 pull request 时保留完整测试和
Clippy 覆盖。涉及桌面构建或跨边界改动时继续运行：

```bash
pnpm build:desktop
```

真实 Runtime Smoke、完整 macOS 打包和 UI 截图验收耗时更长，且部分命令会调用上游
模型。它们保持独立，不进入普通 commit 门禁；运行前先阅读对应文档。

## 按任务阅读

| 任务 | 文档 |
| --- | --- |
| 启动开发 App、运行打包产物或区分日常/开发数据 | [本地开发与 App 隔离流程](local-workflow.md) |
| 判断主机、Node、pnpm、Rust、Git 或 Runtime 前置条件 | [开发环境与依赖](environment.md) |
| 选择单元测试、集成测试、Smoke 或版本验收命令 | [测试与 Smoke Test](testing.md) |
| 构建 Release Core、App、DMG，检查签名 | [macOS 构建与打包](packaging.md) |
| 使用隔离 `userData` 运行真实 App、截图或桌面验收 | [桌面 UI 验收](ui-acceptance.md) |
| 处理 Core、Runtime、Git、签名或测试卡住 | [常见问题排查](troubleshooting.md) |

具体版本的页面矩阵、Schema 版本、Migration 路径和验收证据属于
[`docs/versions/`](../versions/README.md)。唯一当前版本指针由
[`docs/versions/README.md`](../versions/README.md)声明，[文档导航](../README.md)只负责路由。

## 真源与维护边界

- 命令名和命令组合：[`package.json#scripts`](../../package.json)。
- Node 与 macOS 打包声明：`package.json#engines` 和 `package.json#build.mac`。
- Rust workspace 声明：[`Cargo.toml`](../../Cargo.toml)；当前没有最低 Rust 版本或
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
| `target/` | Rust Debug/Release 构建结果 |
| `resources/bin/` | 复制后供 Electron 使用的 Rust Core 与 Agent CLI |
| `resources/native/` | macOS 文件面板原生预热器 |
| `out/` | Electron Vite 构建结果 |
| `dist/` | macOS App 和 DMG |

Camp、运行、事件和审批数据位于 Electron `userData`。诊断中心和 v5 导出不再显示或输出绝对
`userData` / SQLite 路径；需要制作数据库副本时，应从已退出的隔离验收环境或 Electron 开发日志取得精确位置，
不根据文档推测。
