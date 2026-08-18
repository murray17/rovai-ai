---
document_type: implementation-plan
version: v1.08
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-18
---

# v1.08 实施与验收计划

## Checkpoint 0：版本与合同

- [x] 将 v1.07 以 `historical/not_started` 冻结，并建立唯一 current v1.08；
- [x] 接受 Run Process Detail Surface v7，保持 Core/Canonical Activity 权威不变；
- [x] 更新 Contract、ADR CURRENT、UI 规范与验收入口。

## Checkpoint 1：Renderer presentation

- [x] Activity presentation 增加 `stopped`；
- [x] canonical cancelled activity 映射为 `stopped`；
- [x] cancelled AgentRun 中仍为 running 的活动只在 Renderer 映射为 `stopped`；
- [x] Tool Call 使用“已停止”文案、中性停止图形且无动画；
- [x] completed、failed、waiting、recorded 和非 cancelled Run 保持原映射。

## Checkpoint 2：回归与交付

- [x] Renderer 定向测试通过；
- [x] `pnpm typecheck` 与 `pnpm build:desktop` 通过；`pnpm test` 的 59 个 Vitest 文件、406 条
  Renderer/TypeScript 测试及 186/187 条 Node 测试通过，唯一失败为 `origin/main` 已存在的
  current-contract-conformance 陈旧 Rust 测试名引用，相关基准文件与 `origin/main` 无差异；
- [x] `pnpm docs:test`、`pnpm docs:check`、`pnpm docs:adr:generate -- --check` 通过；
- [x] Impeccable detector 与差异检查已执行；detector 只报告 `styles.css` 既有全文件 baseline，
  v1.08 新增 stopped 样式无命中；
- [x] `pnpm package:mac` 完成，App/Core/CLI 严格签名与三项 arm64 二进制检查通过；
- [x] `pnpm accept:runtime-activity-ui` 在隔离 `userData` 的 packaged App 上通过，并证明
  cancelled `run-qoder` 中 `search_workspace` 显示“已停止”、`status-stopped` 且动画为 `none`。

提交、推送 `main` 与安装 `/Applications` 属于本计划完成后的交付动作，不在尚未提交的版本文档中
预先声明完成。

## 验收结果

2026-08-18 完成：

- `pnpm exec vitest run apps/desktop/src/renderer/src/App.test.ts`：92/92 通过；
- `pnpm typecheck`、`pnpm build:desktop`：通过；
- `pnpm docs:test`：21/21 通过；`pnpm docs:check` 与
  `pnpm docs:adr:generate -- --check`：通过；
- `pnpm test`：Vitest 59 files / 406 tests 通过；Node 186/187 通过。唯一失败要求
  `crates/rovai-core/src/db.rs` 存在
  `current_data_contract_accepts_current_and_exact_upgrade_sources`，但该函数在当前
  `origin/main` 已不存在；对应 Core 与 profile 三个文件均与 `origin/main` 一致；
- `pnpm package:mac`：通过；`codesign --verify --deep --strict` 与 Core/CLI 独立严格校验通过；
  App、`rovai-core`、`rovai` 均为 Mach-O 64-bit arm64；
- `pnpm accept:runtime-activity-ui`：通过；受控夹具报告 10 个 Runtime、10 条 Canonical Tool 行，
  `run-qoder` 为 `cancelled`，其 `search_workspace` Tool 行为“已停止”/`stopped`/无动画。

## References

- [v1.08 版本概览](README.md)
- [Run Process Detail Surface v7](../../contracts/run-process-detail-surface-v7.md)
