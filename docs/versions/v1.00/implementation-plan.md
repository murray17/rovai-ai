---
document_type: implementation-plan
version: v1.00
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-17
---

# v1.00 实施与验收计划

## 计划状态与使用方式

本计划实现 [ADR-0206](decisions.md#adr-0206)与
[Camp Permanent Deletion v1](../../contracts/camp-permanent-deletion-v1.md)。修改 Rust 测试遵守
[Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)；本地 App 验收
遵守[本地 Runtime 工作流](../../development/local-workflow.md)。

## Checkpoint 0：治理

- [x] 开启唯一 current v1.00 并冻结 v0.99；
- [x] 接受 ADR-0206 与 Camp Permanent Deletion v1；
- [x] 生成 ADR HISTORY 并通过全部文档门禁。

## Checkpoint 1：Core force delete

- [x] `DeleteCampCommand.force` 默认 false，旧 blocker 路径保持兼容；
- [x] force 模式在同一事务内删除带非终态执行的 Camp 聚合并返回 bypassed blockers；
- [x] Main 在删除前捕获 Run identity，提交后按 Adapter 停止 Runtime、清理 active registration 与 Resident；
- [x] Rust 定向测试、fmt 与严格 Clippy 通过。

## Checkpoint 2：Renderer

- [x] 永久删除 Dialog 直接提交 force 请求并删除旧 blocker/停止/打开分支；
- [x] 文案明确强制停止、物理删除、不可撤销和项目目录边界；
- [x] TypeScript、Vitest、Desktop build 与 Impeccable detector 通过。

## Checkpoint 3：最终验收

- [x] `pnpm docs:test`、`pnpm docs:check` 与 diff-aware 文档门禁通过；
- [x] `git diff --check` 与最终差异复核通过；
- [x] 生成 arm64 ad-hoc 签名 App，以隔离 `userData` 验收后提升到 `/Applications`，并保留旧版备份；
- [x] 实施状态和实际命令证据回填本计划。

## 实施结果

- `cargo test --workspace -- --quiet --test-threads=2`：325 passed、0 failed、3 ignored；
  `camp_delete_blocks_by_default_and_force_removes_running_work` 的 `slow-tests` 定向事务测试通过；
- `cargo fmt --all --check`、`cargo clippy --workspace --all-targets -- -D warnings`、
  `cargo check -p rovai-core --bin rovai-core` 与 `pnpm typecheck` 通过；
- `App.test.ts`：90 passed；聚合 Vitest：59 files、400 passed；`pnpm build:desktop` 成功；
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=c09a82703818cb00f9010b90b462b2ada6e89686 pnpm docs:check:ci`
  与 `pnpm docs:adr:generate -- --check` 通过；
- Impeccable detector 对本次三个 Renderer 目标完成一次机械检查，只报告 `styles.css` 中本次改动前
  已存在的 side-tab、rounded accent 与 width transition 告警，本次删除路径没有新增对应样式；
- 聚合 `pnpm test` 的 Docs、Skills 与 Vitest 阶段通过，Node/Protocol 为 186 passed、1 failed；唯一失败是
  既有 `current-contract-conformance.test.mjs` 仍引用主线已删除的
  `current_data_contract_accepts_current_and_exact_upgrade_sources` Rust 测试名。该无关 Benchmark
  profile 漂移已在 v0.99 验收记录中存在，本版未修改 Benchmark 合同。
- `pnpm package:mac` 成功；`codesign --verify --deep --strict` 以及内置 Core/CLI 严格签名检查通过，
  Main、Core 与 CLI 均为 arm64。打包产物和安装版三项 SHA-256 分别为
  `686d27ee9986e9bface43a08458a4ee08c451be92e98f1eaac1a0e68ca444e1a`、
  `e1e97832c4d14110424d4dc7472ab73be16f767147c567752e3392219f36ca11`、
  `14673be20b7960dbedb44b0dbd082e417a6160d1fe9e2531ce8cc2b6d8a804db`；
- 打包 App 使用 `/tmp/rovai-v1.00-package-acceptance.tiiIV1/user-data` 隔离启动，Core 同时绑定对应
  `managed-skill-library` 并到达 ready。随后安装到 `/Applications/Rovai AI.app`，从安装路径启动确认
  Main、Renderer 与 Core 均不引用仓库 `dist/`；旧安装版保存在
  `<local-backup>/Rovai AI.app.backup-v0.99-pre-v1.00-20260817-221401`。

## References

- [v1.00 版本概览](README.md)
- [ADR-0206](decisions.md#adr-0206)
- [Camp Permanent Deletion v1](../../contracts/camp-permanent-deletion-v1.md)
