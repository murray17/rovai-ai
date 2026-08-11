---
document_type: implementation-plan
version: v0.23
lifecycle: historical
authority: implementation-plan-and-acceptance
last_updated: 2026-07-30
---

# v0.23 实施与验收

## 实施检查点

- [x] ADR-0072 与领域词汇确认目录身份、动态 Git 能力和无 Repository Binding。
- [x] Core 安全目录准入、canonical 持久化与动态 Git Observation。
- [x] Camp schema/command 改为 `projectBindingKind + projectPath`。
- [x] AgentRun starting/ending Git Observation 与 Git 动作前动态探测。
- [x] Navigation 按 canonical path 分组，Read Side 移除 Repository Scope。
- [x] IPC、共享契约、目录选择器和能力提示改为普通目录模型。
- [x] Smoke 脚本改用 `workspaces.inspect` 与 `workspace.projectPath`。
- [x] Migration v35/v36、Run 审计、Renderer 能力提示补齐针对性测试。
- [x] 完整 Rust、Renderer、typecheck、clippy 与 desktop build 验收。

## 验收命令

```bash
cargo test --workspace
cargo clippy --workspace --all-targets -- -D warnings
pnpm typecheck
pnpm test
pnpm build:desktop
pnpm smoke:core
pnpm smoke:intake
```

真实 Runtime smoke 继续按 [测试与 Smoke Test](../../development/testing.md) 执行。`smoke:core`
必须包含普通目录与空 Git 仓库；`smoke:intake` 必须证明目录检查本身零写入、创建才
持久化 canonical 路径。

## 2026-07-30 验收证据

- `cargo test --workspace`：Core library 203 项、binary 44 项自动测试通过；5 项人工
  Runtime smoke 保持显式忽略。
- `cargo clippy --workspace --all-targets -- -D warnings`：通过。
- `pnpm typecheck`、`pnpm test`（21 files / 103 tests）、`pnpm build:desktop`：通过。
- `pnpm smoke:core`：普通目录与空 Git Camp 创建、无隐式 `git init`、canonical
  路径分组、重启恢复和删除清理通过。
- `pnpm smoke:intake`：真实 Codex Runtime 两次连续运行、starting/ending Git
  Observation、重启恢复与删除清理通过。
