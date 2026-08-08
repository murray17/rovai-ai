---
document_type: development-index
authority: development-routing
last_updated: 2026-08-08
---

# Rovai-ai 开发者指南

本目录是本地开发命令的唯一常青入口。根目录
[`package.json`](../../package.json)中的 scripts 决定命令实际行为；本文档负责说明
用途、前置条件和安全边界，不复制版本实施计划或测试内部断言。

## 快速开始

在仓库根目录安装锁定依赖并启动开发版桌面应用：

```bash
pnpm install --frozen-lockfile
pnpm dev
```

`pnpm dev` 会构建 Debug 版 `rovai-core` 与 bundled `rovai` Agent CLI、复制到
`resources/bin/`，然后启动 Electron Vite 开发环境。

只重新构建 Debug Core：

```bash
pnpm core:build:debug
```

## 日常验证

当前仓库没有聚合的 `pnpm check` 命令。提交前至少分别运行：

```bash
pnpm typecheck
pnpm test
cargo test --workspace
```

`pnpm test` 会先运行 `pnpm docs:check`，验证唯一当前版本指针、版本目录 Front Matter
和版本索引一致。只修改版本治理文档时，可以先单独运行 `pnpm docs:check` 获得快速反馈。

涉及 Rust lint、桌面构建或跨边界改动时继续运行：

```bash
cargo clippy --workspace --all-targets -- -D warnings
pnpm build:desktop
```

真实 Runtime Smoke、完整 macOS 打包和 UI 截图验收耗时更长，且部分命令会调用上游
模型。运行前先阅读对应文档。

## 按任务阅读

| 任务 | 文档 |
| --- | --- |
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
| `out/` | Electron Vite 构建结果 |
| `dist/` | macOS App 和 DMG |

Camp、运行、事件和审批数据位于 Electron `userData`。准确位置以应用诊断页显示为准。
