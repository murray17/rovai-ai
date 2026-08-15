---
document_type: implementation-plan
version: v0.86
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-15
---

# v0.86 实施与验收计划

## Checkpoint 0：兼容性与旧评测失效修复

- [x] 以最新 `main` 的 Transport v12/十四项 catalog 为最终基线；
- [x] 修复 `memory.view` 未进入 Core Evidence projection、导致真实操作在 dispatch 前失败的问题；
- [x] 增加当前 `TEAM_TOOL_NAMES` 全量 start/terminal projection gate，覆盖 `member.create`；
- [x] 让 Core health、Measurement Spec 与 Runner pre-dispatch gate 绑定 catalog/contract/IPC/projection version。

## Checkpoint 1：Camp、Memory 与 Task Adapter

- [x] Camp Adapter 纳入 `history.search`；Memory Retrieval 纳入 `memory.view`；
- [x] Memory v3 nested Target、bounded secret-filtered body/retrieval keys 与 exact readback evidence 闭合；
- [x] 增加 Task create/get/update/list Adapter、symbolic fixture、oracle、receipt/state effect 与 Judge projection；
- [x] 保持 A2A semantic items 不进入 Tool-Use Judge，避免与 Process Judge 重复构念。

## Checkpoint 2：Collaboration Process Evidence

- [x] Public Message content 按 Message identity 去重，fanout 不复制正文；
- [x] 绑定 Message sequence、reply parent、Task state references 与 Process interaction observations；
- [x] contribution/feedback/integration 继续保持 partial candidate relation，不制造 causal attribution。

## Checkpoint 3：合同、schema 与 replay

- [x] 增加 Tool Interaction Measurement/Judge Pack v2 schema 与 cross-version catalog；
- [x] 更新当前 Contract、Architecture、文档路由和版本生命周期；
- [x] 在 rebase 后完成 Bundle replay、schema、Runner 与全量 Qualification 回归；
- [x] 在 rebase 后完成 Rust fmt/test/strict Clippy 与文档治理。

## Checkpoint 4：评测准备度结论

- [x] 记录哪些能力可立即用单 Turn Case 测、哪些必须用多阶段或 paired Case；
- [x] 验证没有 aggregate score、call-volume reward、oracle/treatment leakage 或 Hard Outcome interference；
- [x] 回填 rebase 后自动门禁结果，并明确真实模型/paired Trial 尚未执行。

## 自动验收证据

- `pnpm typecheck`：通过；
- `pnpm test`：Vitest 340/340、package Node tests 186/186 通过；
- 全量 `scripts/**/*.test.mjs`：227/227 通过；
- `cargo test -p rovai-core --lib`：467/467 通过；
- `cargo test -p rovai-core --bin rovai-core`：75/75 通过，4 项显式 manual Runtime smoke 未执行；
- `cargo check -p rovai-core --bin rovai-core`、strict Clippy、Rust fmt：通过；
- 文档单测、ADR 生成检查与相对最终 rebase base 的 diff-aware governance：通过。

这些证据证明 v0.86 实现与离线回归闭合，不代表任何真实 Runtime/LLM、隔离 Qualification、
长期 Memory 效果或 Team/Solo paired Trial 已执行或通过。
