---
document_type: implementation-plan
version: v0.53
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-10
---

# v0.53 实施与验收计划

## Checkpoint 0：Characterization 与无行为拆分

- [x] 固定历史公开 artifact digest；
- [x] Suite 校验/排程/调用/聚合/发布职责拆分，旧 CLI 成为薄 wrapper；
- [x] source reader/normalizer/selection/aggregation/Markdown/filesystem/Camp import 拆分；
- [x] 删除 generic pipeline 中的 schema 特判、固定 TQ Case 和固定矩阵文案。

## Checkpoint 1：Protocol v3 与 Adapter

- [x] v3 Writer/Validator、canonical identity、round-trip、unknown-major 和 public disclosure gate；
- [x] Product Contract Fingerprint 与保留 `teamRuntimeCompatibilityDigest` 的 compatibility envelope；
- [x] v0.32/v0.34/v0.36/v3 Registry 和带 source digest 的 derived v3；
- [x] Profile 驱动 Suite 与非 3×4 fixture，v0.34 legacy 仍严格 3×4。

## Checkpoint 2：比较、报告与投影

- [x] 五轴 comparison eligibility、稳定 reason code、suppressed/display-only metrics；
- [x] failure taxonomy、JSON/Markdown/baseline diff；
- [x] 默认单 Review Camp、`execution=null`、零 Turn/Run 验证和显式 legacy Trial Camps。

## Checkpoint 3：Current Contract Regression

- [x] 15 项 v0.52 current-contract criteria 映射到既有 Rust tests；
- [x] Task v2、Built-in Transport v4、accepted-only ACK prerequisite evidence；
- [x] 完成一次离线 `benchmark:run:contract` 并记录真实结果。

## 完成条件

- [x] 新增 Benchmark Node tests 通过；
- [x] 现有 Qualification/Node/Vitest/TypeScript tests 全部通过；
- [x] Rust format/check/clippy/workspace tests 全部通过；
- [x] docs check/CI 与 `git diff --check` 通过；
- [x] 复核历史公开 artifact source digest 没有变化；
- [x] 将本计划和版本实现状态更新为 complete。

## 实际验证结果

2026-08-10 在独立 worktree 完成验证：

| 命令 | 结果 |
| --- | --- |
| `CI=true pnpm benchmark:check` | 通过；17 个 Protocol/Adapter/Profile/Comparison/Projection/legacy characterization 测试 |
| `CI=true pnpm benchmark:run:contract --output <output-dir> --run-id v053-current-contract-local` | 通过；15/15 criteria，Hard Outcome `pass` |
| `node scripts/benchmark-validate.mjs <output-dir>/benchmark-run.json` | 通过；v3 schema、integrity 与 disclosure gate 均有效 |
| `node scripts/benchmark-compare.mjs --baseline <run> --candidate <run>` | 通过；同一 Run 的五个轴均 eligible |
| `node scripts/benchmark-project.mjs --run <run> --project-path <project> --no-import` | 通过；生成默认单 Review projection |
| `CI=true pnpm typecheck` | 通过 |
| `CI=true pnpm test` | 通过；文档测试、Vitest、Qualification 与 Benchmark Node tests 全部通过 |
| `CI=true pnpm docs:check` | 通过 |
| `DOCS_BASE_REF=main CI=true pnpm docs:check:ci` | 通过 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo check --workspace --all-targets` | 通过 |
| `cargo clippy --workspace --all-targets -- -D warnings` | 通过 |
| `cargo test --workspace --no-fail-fast` | 通过；308 library、9 CLI、54 Core binary 测试，3 个既有手工 Runtime smoke ignored |
| `git diff --check` | 通过 |

CLI 测试中两个 Unix socket fixture 在受限沙箱内会得到 `Operation not permitted`；在允许本地 IPC 的同一
worktree 重跑原始 workspace 命令后全部通过。默认门禁仍未执行付费模型、真实用户 Runtime 账户或私有 Sealed
Pack；这些仍只允许人工、私有、专用隔离触发。

在用户明确授权后，另行执行了 public Demo smoke（不计入正式 Qualification Pass Rate）：`DEMO-001`、
`DEMO-002`、`DEMO-003`、`DEMO-004` 各有至少一次有效通过；`DEMO-005` 的两次早期 trial 在 Runtime 已失败后
因旧 Runner 等待满预算而失败，修正无人值守 failure boundary 后的独立 trial 通过。失败 trial 保留为不可变
诊断证据，未被重算、覆盖或从公开历史中抹除。
