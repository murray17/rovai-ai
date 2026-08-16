---
document_type: implementation-plan
version: v0.90
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-16
---

# v0.90 实施与验收计划

## Checkpoint 0：版本与合同

- [x] 从 `main` 建立 `codex/v0.90-gather-corrections` 独立 worktree；
- [x] 冻结 v0.89，建立唯一 current v0.90 与九范围影响记录；
- [x] 接受 ADR-0195/0196，切换四份 current Contract 与 completion schema v2；
- [x] 通过 ADR generator、schema catalog 与 base-aware 文档门禁。

## Checkpoint 1：Capture budget 与 result authority

- [x] captured return 不再增加 ordinary accepted-A2A/Run-responsibility ledger；
- [x] 每 Item/current Run/generation 原子限制 16 次 capture，保持 deadline 与混合发送原子性；
- [x] Barrier 只选择 current target Run/current generation 最后一条 settled capture；
- [x] zero-capture successful terminal fallback 语义保持，成员 Run Notice 明确最后显式回传为完整结果。

## Checkpoint 2：Durable Completion v2 与 Migration

- [x] Completion Input v2 包含完整 durable request、activeRetryGeneration 与最多一条 current capture；
- [x] Formatter v16 / Manifest v14 与 512 KiB input / 640 KiB completion context 上限实现；
- [x] Migration 88 建立 v0.90/schema-43 并允许 v14/v15/v16 manifests；
- [x] Context loader 保留 input v1 / Formatter v15 exact recovery；
- [x] migration、schema 与 frozen recovery 定向测试全部通过。

## Checkpoint 3：CLI、Skill 与长期文档

- [x] 更新 `rovai gather --help`、Session Charter、`skills/cli-operations/references/gather.md`；
- [x] 更新 Documentation routing、Contract/Architecture 索引与当前组合；
- [x] `skills/campfire/**` 保持不变；Built-in Transport v13 wire/capability 保持不变。

## Checkpoint 4：验证与交付

- [x] Rust fmt、定向/全量测试与 strict Clippy 通过；
- [x] TypeScript、Vitest、Node/schema catalog、docs governance 与 Desktop build 通过；
- [x] 提交分支，fast-forward 合入本地 `main` 并无 force 推送 `origin/main`；
- [x] 清理已合并 worktree 与临时分支。

## 自动验收证据

- `cargo test --workspace`：Core library 481/481、CLI 12/12、Core binary 79/79 通过，3 个明确标记的手工
  Runtime smoke 保持 ignored；Gather capture、retry generation、v1 frozen recovery 与多 completion FIFO 均在
  全量套件中通过；
- `cargo fmt --all -- --check` 与 `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- `pnpm test`：ADR 文档测试 21/21、Vitest 358/358、Node/benchmark tests 186/186 通过；
- `pnpm typecheck`、`pnpm build:desktop`、schema catalog validation：通过；
- `DOCS_BASE_REF=46e1ed18 pnpm docs:check:ci`：版本、accepted ADR freeze 与跨版本文档治理全部通过；
- 额外定向回归确认 recipient-free public send 仍不受 A2A/deadline 预算扩张影响，Gather captured return 在普通
  accepted-A2A 已满时仍按独立 16 条限额工作。

以上证据证明本版本的持久数据、Completion 输入、预算与代际选择合同闭合；Built-in Transport v13 wire、
真实 Runtime 兼容矩阵和 Renderer 行为均未改变。
