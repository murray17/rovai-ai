---
document_type: implementation-plan
version: v0.62
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-12
---

# v0.62 实施与验收计划

## Checkpoint 0：领域与合同

- [x] 冻结 `--to` + inline Mention 两种显式寻址、无寻址 public-only 与 exact Immediate Caller
  return 语义；
- [x] 冻结非直属 ancestor 继续拒绝、return 仍消耗 budget 且创建新 continuation Run；
- [x] 删除 Agent-facing reply ID，区分 Message Reply Reference 与执行收件人；
- [x] 完成 ADR-0163、Camp Message Send v3、Message Delivery v2、Built-in Tool Transport v6 与
  领域词汇更新。

## Checkpoint 1：持久化与迁移

- [x] Migration 76 增加 `edge_kind`、target parent 与 exact caller Run，并放开 return depth 0；
- [x] 历史 Delivery 原样回填为 forward，冻结 snapshot 升到 schema 2，不根据 reply/recipient 猜测；
- [x] Data Contract 升到 v0.62/schema 31，CampSnapshot 升到 28 并公开三项 Delivery 审计字段；
- [x] command result clean break 阻止旧 send input replay 穿过新 closed schema。

## Checkpoint 2：寻址、返回与 Context

- [x] `--to` 与 inline token 去重后逐 recipient 分类 forward/return；
- [x] return 恢复 Immediate Caller 原有 parent/root/depth，同时保留 current source 作为 Delivery
  causality；
- [x] dispatch/materialization、retry、Context preflight、Current Input sender 与 originating user
  message traversal 使用分离后的冻结身份；
- [x] Core 从 trigger CampMessage 自动建立 reply reference，并交叉验证 A2A trigger Delivery。

## Checkpoint 3：Agent CLI

- [x] 从 JSON schema、Rust input、catalog、errors、direct flags 与 help 删除
  `replyToCampMessageId`；
- [x] 保留 repeatable `--to` 与 inline Mention，未增加 `--return-to`；
- [x] help 明确 wake/public-only/direct-caller return，`--to` 描述保持一行，并提供 public-only 与
  addressed 两个示例；
- [x] Built-in contract/capability/CLI command version 升到 6。

## Checkpoint 4：回归与门禁

- [x] 覆盖 `--to` + inline 同 caller 去重、root caller return、三层 lineage pop 与非直属 ancestor
  拒绝；
- [x] 覆盖 public-only 自动 reply、forward snapshot、Migration 76 与移除旧 CLI flag；
- [x] `cargo test -p rovai-core` 全量通过；
- [x] TypeScript、Node/Vitest、文档治理、格式与 diff 门禁全部通过；
- [x] 完整证据齐全后把本计划和版本概览标记为 complete。

## 当前证据

- `cargo test -p rovai-core` 全量通过：library 345/345、CLI 10/10、main 66/66（另有 3 项明确
  ignored）；Immediate Caller dedupe/return、三层 non-immediate ancestor guard 与 lineage pop、
  tombstoned/missing-delivery trigger fail-closed、Context lineage、Migration 76 与 CLI help 均包含在内；
- `pnpm test` 全量通过：文档单测 21/21、Vitest 281/281、Node benchmark/qualification 154/154；
- `cargo check -p rovai-core`、`cargo fmt --all`、`pnpm typecheck`、`pnpm build:desktop` 与
  `git diff --check` 通过；
- `pnpm docs:check`、diff-aware `pnpm docs:check:ci` 与 ADR history deterministic check 通过；
- `rovai send --help` 实际输出已核对，不含 reply/return-to flag。
