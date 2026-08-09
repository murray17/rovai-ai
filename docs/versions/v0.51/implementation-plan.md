---
document_type: implementation-plan
version: v0.51
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-09
---

# v0.51 实施与验收计划

## Checkpoint 0：版本、决策与合同

- [x] v0.50 按实施事实冻结为 historical，v0.51 成为唯一 current；
- [x] ADR-0148 冻结只读检测/显式单项修复、Runtime 问题准入和 v5 集中脱敏；
- [x] Diagnostics Center v1 冻结 typed report、三态、修复映射、导出 shape 与 Recovery；
- [x] Core/Renderer/Electron/Startup Recovery 架构与 Arctic Dawn 生产设计同步。

## Checkpoint 1：Core 严格只读诊断

- [x] 新增 `diagnostics.check` 与 typed `DiagnosticsReport`；
- [x] SQLite 仅运行只读 `PRAGMA quick_check`，Core 启动失败仍由 Startup Recovery 负责；
- [x] Skill audit 重读 Library/观测/文件系统事实，不修复链接或更新 observation；
- [x] MCP `inspect` 在缺文件时不创建 reviewed defaults；
- [x] 九 Runtime 全部输出，按未移除队员的 `selected_runtime_adapter_kind` 决定问题准入；
- [x] 诊断 Method 只读取 Runtime cache，不 rescan 也不排队 probe。

## Checkpoint 2：显式修复与 Renderer

- [x] 复用设置侧栏、共享页头、Arctic Dawn Token、现有 Core Method 与 CSS 结构；
- [x] 实现三态摘要、attention-only 问题、可展开证据与四筛选全量结果；
- [x] Skill/MCP/Runtime/SQLite 单项下一步符合安全白名单，不包含修复全部；
- [x] 修复后只在复检同 ID 为 `ok` 时更新 Success；
- [x] Loading、Running、Partial、Error、Success、Disabled 与 Recovery 状态都有明确结构；
- [x] 交互稿状态切换器和旧“重新检测”Runtime rescan 不进生产。

## Checkpoint 3：v5 导出

- [x] `diagnostics.export` 只输出 typed report 与 allowlisted aggregate counts；
- [x] 格式单线切换为 `rovai-diagnostics-v5`，不保留 v4 分支；
- [x] Core 集中 redaction 移除敏感 key/value 与绝对 Home/Runtime/Project 路径；
- [x] Electron 使用 Save Dialog、临时文件原子替换与最终 `0600`，Finder 只接受当前 session 刚成功导出的路径。

## Checkpoint 4：自动验收

- [x] TypeScript typecheck 与 Renderer 定向 Vitest；
- [x] SQLite quick_check 只读、MCP missing 零创建、Skill missing-link 只读发现定向 Rust 测试；
- [x] v5 Token/绝对路径 canary 与三态汇总测试；
- [x] Runtime “未使用缺失 = ok / 已使用缺失 = attention / 检测中 = unknown”定向测试；
- [x] `1440×920` 与 `1040×700` 隔离打包 App 验收，覆盖严格只读、MCP 权限修复复检、筛选和水平溢出；
- [x] Rust workspace format/check/clippy/test、TypeScript/Vitest 全量、docs:check、desktop build 与 `git diff --check`。

## Checkpoint 5：完成条件

- [x] 所有工作区级命令和双尺寸打包 App 验收通过；
- [x] 导出 canary 证明无 v4、Token、绝对 Home/Runtime/Project 路径；
- [x] 本概览、生产设计和本计划更新为 complete，记录实际命令和截图证据。

## 实际验证结果（2026-08-09）

- `cargo fmt --all -- --check`、`cargo check --workspace --all-targets` 和
  `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `cargo test --workspace`：Core Library 302 项、bundled CLI 9 项、Core Main 54 项全部通过；
  3 项真实 Runtime smoke 按合同 ignored。沙箱内首次执行的 2 项 Unix socket CLI 测试被系统
  `Operation not permitted` 拒绝，在允许临时 socket 的同机隔离权限下复跑通过；
- `tsc --noEmit`：通过；`vitest run`：39 个文件、239 项全部通过；Node Qualification
  18 个文件、78 项全部通过；
- `node scripts/check-doc-version.mjs`、`git diff --check`：通过；
- Release Core/bundled CLI、macOS NSOpenPanel prewarmer、Electron Vite Renderer/Main/Preload 与 ad-hoc signed
  `dist/mac-arm64/Rovai-ai.app` 构建成功；
- `node scripts/accept-diagnostics-ui.mjs`：最终复跑通过。`1440×920` 证明完整自检不改
  `0644` MCP 文件，显式修复仅收紧为 `0600`、JSON 字节不变且复检更新 Success；
  `1040×700` + reduced motion 证明 MCP 缺失时打开页面与完整自检均不创建文件。两尺寸均显示
  15 项检查/全部 9 Runtime，筛选、v5/no-v4 脱敏 canary 和零水平溢出通过；
- 最终截图：`diagnostics-attention-1440x920.png`、`diagnostics-results-1440x920.png`、
  `diagnostics-success-1440x920.png`、`diagnostics-clean-1040x700.png`、
  `diagnostics-results-1040x700.png`。
