---
document_type: implementation-plan
version: v0.78
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-14
---

# v0.78 实施与验收计划

## Checkpoint 0：决策与版本

- [x] 将 complete v0.77 冻结为 historical，并建立唯一 current v0.78；
- [x] 接受 ADR-0186、Memory Capture v3 与 Built-in Tool Transport v11；
- [x] 冻结 complete exact-Scope View、copyable target、64 KiB production projection limit 与 clean break；
- [x] 完成九项跨版本文档影响判断。

## Checkpoint 1：Memory Core

- [x] 新增三种 exact-Scope View、actor-relative Relationship selection、排序与 complete output；
- [x] 在同一 SQLite transaction 内完成授权、production serialization limit 与 access evidence；
- [x] Read/Revise 收敛为 nested target，并保持 unavailable anti-oracle 在 CAS/no-change 之前；
- [x] 增加三类 active body aggregate quota，覆盖所有净增长与释放路径；
- [x] 使用 schema 39 / migration 84 清理 Memory domain 并保留非 Memory 状态。

## Checkpoint 2：Transport 与 Skill

- [x] Built-in Transport/CLI/capability 推进到 v11，Catalog/Charter/CLI 固定十三项 operation；
- [x] 增加 View closed schema、canonical projection、exact help 与 smoke assertions；
- [x] 更新 `memory-stewardship` 为 `view -> write`，并保留 `search -> read` broad recall；
- [x] 完成 Skill validation 与独立 forward test。

## Checkpoint 3：验证与交付

- [x] 增加 View exactness、pending isolation、copy-target、mutual、evidence 与 corruption regressions；
- [x] 增加 legal extreme serializer、aggregate quota 和 clean-break migration regressions；
- [x] 运行完整 Core、TypeScript/contracts、Rust format、script syntax 与 smoke-compatible automated gates；
- [x] 运行文档治理、ADR history generation/check 与 diff 检查；
- [x] 只在全部自动门禁通过后把本计划和版本概览标记 complete。

## 当前证据与缺口

- `cargo test --workspace`、严格 Clippy、Rust format、TypeScript、完整 JS tests 与非模型 Memory smoke 通过；
- View、quota、serializer、target anti-oracle、migration 83/84 串联与 clean-break 定向回归通过；
- 文档真实 base-diff、ADR generated history、Skill static validation、独立 forward test 与最终 diff 门禁通过；
- 真实 Runtime smoke 与 Renderer UI 不在本版本验收声明范围，未据此新增兼容性结论。
