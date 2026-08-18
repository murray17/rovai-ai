---
document_type: implementation-plan
version: v1.03
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-18
---

# v1.03 实施与验收计划

## 计划状态与使用方式

本计划实现 [ADR-0208](decisions.md#adr-0208)与
[Runtime Launch and Verification v5](../../contracts/runtime-launch-and-verification-v5.md)。Rust 测试遵守
[准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)，真实 Runtime 遵守
[本地 Runtime 工作流](../../development/local-workflow.md)。

## Checkpoint 0：治理与边界

- [x] 开启唯一 current v1.03 并冻结 v1.02；
- [x] 接受 ADR-0208 与 Runtime Launch and Verification v5；
- [x] 保留 health/refresh/preflight 零进程，只开放版本轻检与用户检查。

## Checkpoint 1：Core 与 Renderer

- [x] TRAE `--version` 进入有界轻检并生成 `light_ready|light_failed`；
- [x] AvailabilityCheck purpose 传递到 ACP Probe，快速完成 initialize/session/new；
- [x] Ready 后的 discovery event 不重复静态落库；
- [x] TRAE light-ready 成员可进入首次真实 Host 验证；
- [x] 设置页按钮和其 Renderer 测试统一到“检查可用性”。

## Checkpoint 2：验收

- [x] 本机 `trae-cli 0.120.52 --version` 在一秒内成功；
- [x] 本机用户授权 Availability Probe 在三秒内生成可映射的 Ready snapshot；
- [x] 定向 Rust、slow-test 与 Renderer Vitest 通过；
- [x] 全量 Rust、fmt、Clippy、TypeScript、Desktop build 与文档门禁通过；
- [x] 最终差异复核并将版本状态更新为 complete。

## 最终验收结果

- 本机 TRAE `0.120.52 --version` 在 0.8 秒内返回版本、build date 与 commit；用户授权
  Availability Probe 在 1.97 秒内完成 initialize/session/new，并映射出非空 model/permission Ready snapshot；
- `cargo test --workspace -- --quiet --test-threads=2` 通过：Library 227/227、CLI 12/12、Core Main
  91/91，另有 4 个明确 ignored 的真实 Runtime smoke；
- slow-test `trae_light_ready_installation_defers_deep_verification_to_the_real_session` 通过；
- `cargo fmt --all --check` 与 `cargo clippy --workspace --all-targets -- -D warnings` 通过；
- `pnpm typecheck`、`pnpm exec vitest run`（59 Files、403 Tests）和 `pnpm build:desktop` 通过；
- `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=origin/main pnpm docs:check:ci`、
  `pnpm docs:adr:generate -- --check` 与 `git diff --check` 通过。

## References

- [v1.03 版本概览](README.md)
- [ADR-0208](decisions.md#adr-0208)
- [Runtime Launch and Verification v5](../../contracts/runtime-launch-and-verification-v5.md)
