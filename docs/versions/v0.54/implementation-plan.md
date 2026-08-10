---
document_type: implementation-plan
version: v0.54
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-10
---

# v0.54 实施与验收计划

## Checkpoint 0：合同与 clean break

- [x] ADR-0152、Durable Task v3、Built-in Tool Transport v5、Profile v3 与 Manifest v10；
- [x] Formatter v12/shared fixture 与 current-only migration 70；
- [x] 删除旧版本双读、claim 和 actor-specific compatibility 分支。

## Checkpoint 1：Task authority 与 CLI

- [x] User/Default Lead create hard gate、显式 Current Camp Assignee 与 creation restraint help；
- [x] Assignee execution-state field allowlist、状态矩阵、原子拒绝与 expectedVersion；
- [x] unassigned pending recovery、claim 删除与 membership ending 收口；
- [x] Camp-wide list/get、最小 list item 与 advisory `availableActions`。

## Checkpoint 2：Self Active Task Context

- [x] direct/A2A 共用 self active Task selector；
- [x] compact JSON 最小字段、上限 8、稳定排序、预算淘汰与 omission；
- [x] Manifest v10 selection evidence/digest、恢复复用与无 watermark/ACK；
- [x] Session Charter 唯一 Task authority 句与工具级操作指导。

## Checkpoint 3：验证与文档治理

- [x] Task authority/read/list/update/unassigned 与 CLI schema/output 测试；
- [x] direct/A2A/empty/truncated/budget/recovery Context 测试；
- [x] migration/data-contract、formatter/manifest/profile/transport fixture 测试；
- [x] Rust format/check/clippy/tests、前端相关检查、docs gates 与 diff check。

## 完成条件

- [x] 所有 v0.54 contracts 与实现一致；
- [x] 无 v2/v3、v4/v5、v11/v12 或 v9/v10 兼容 reader/shim；
- [x] 既有用户工作区改动保持不变；
- [x] 验证结果记录在本计划并将版本实施状态更新为 complete。

## 实际验证结果

- `cargo fmt --all -- --check`：通过；
- `cargo check --workspace --all-targets`：通过；
- `cargo clippy --workspace --all-targets -- -D warnings`：通过；
- Rust 测试：library `310 passed`；`rovai-core` binary `54 passed, 3 ignored`；`rovai` CLI
  `10 passed`。完整 workspace 首轮在两个 Unix socket 测试清理 `/tmp` 时被 sandbox 拒绝；相同 CLI
  测试在 sandbox 外重跑全部通过；
- `pnpm typecheck`：通过；
- `pnpm test`：docs `21 passed`、Vitest `39 files / 242 tests passed`、Node/benchmark
  `115 passed`；
- `pnpm docs:check`、`pnpm docs:adr:generate -- --check` 与 `git diff --check`：通过。
