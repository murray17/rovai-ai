---
document_type: implementation-plan
version: v1.31
status: completed
last_updated: 2026-08-30
---

# v1.31 Implementation Plan

## Checkpoint 1 — Lease and admission

- [x] data-dir OS lease、canonical directory identity 与 typed active-owner result；
- [x] Rovai/Lumen exact artifact observation、read-only SQLite contract probe 与 opaque one-shot tickets；
- [x] WAL/journal/SHM、未知合同、busy、permission、corrupt 与 identity-race regression。

## Checkpoint 2 — Exact open, initialization and migration

- [x] production Core 只使用 admitted open/init/migration surface；旧 direct-create path 限制到测试；
- [x] staging initialization + pre-publish absence revalidation + atomic create-if-absent；
- [x] SQLite Backup API copy migration、validation、backup、manifest、switch 与 recovery；
- [x] supported fixture 与 switch-boundary process-kill regression；
- [x] bundled SQLite 升级并核对版本。

## Checkpoint 3 — Supervisor and transport

- [x] startup NDJSON frames、generation/child-token fencing、完整 revision snapshot；
- [x] deterministic refusal 不消耗 crash budget；
- [x] request generation-scoped failure 与 structured value/failure IPC transport；
- [x] 全量 Desktop/Main 回归与 packaged sidecar smoke。

## Checkpoint 4 — Shell-first Desktop

- [x] BrowserWindow 先创建，本机默认与偏好加载不阻塞 Full Core；
- [x] preference corruption 保留原文件并发布 local degradation；
- [x] Renderer capability gate、Bootstrap Shell、主题/重试/诊断与 migration 状态；
- [x] Onboarding 使用 admitted authority origin；
- [x] Day/Night、窄窗口、200% zoom 与 reduced-motion 视觉验收。

## Checkpoint 5 — Governance and release evidence

- [x] Architecture、Contract、UI、Version 与 decision routing 更新；
- [x] `pnpm docs:test && pnpm docs:check` 与 merge-base governance；
- [x] `cargo check --workspace --all-targets`、Rust library/bin suites、full Vitest、Desktop build；
- [x] Impeccable changed-target detector 与最终 diff audit。

## Completion evidence

- `cargo test --workspace --no-fail-fast`、`cargo check --workspace --all-targets` 与
  `cargo clippy --workspace --all-targets -- -D warnings` 通过；migration switch-boundary process-kill regression 包含在全仓套件；
- `pnpm test`、`pnpm typecheck`、`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check` 与
  `DOCS_BASE_REF=origin/main pnpm docs:check:ci` 通过；
- `pnpm package:mac:unsigned && pnpm accept:bootstrap-shell-ui` 以隔离 `userData` 证明未知 authority 在两次检查后
  byte-for-byte 不变，业务树未挂载，retry 不消耗 crash budget，并产生 Day 与 Night/200%/reduced-motion 截图；
- Impeccable changed-target detector 未命中新 Bootstrap Shell 代码；报告项均位于本版本未修改的既有 CSS 区域。
