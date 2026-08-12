---
document_type: implementation-plan
version: v0.64
authority: implementation-plan-and-acceptance
status: complete
last_updated: 2026-08-12
---

# v0.64 实施与验收计划

## Checkpoint 0：领域与合同

- [x] 区分 Native Session Resume、Native Turn Reconciliation 与 Runtime Input Delivery；
- [x] 冻结 `recovery_blocked`、`accepted_input_outcome_unknown` 和 user resolution 语义；
- [x] 完成 ADR-0164、Accepted Input Recovery v1、AgentRun Recovery 架构与 Renderer v4 合同。

## Checkpoint 1：Core P0

- [x] Startup Recovery 分类 accepted input，并保证重复重启 no-op；
- [x] 保留 Scheduler accepted-input fence，阻止 recovery marking/rebind/新 epoch；
- [x] 删除 Codex/ACP 的虚假 input-resumed 分支；
- [x] 用户显式结束为 failed/outcome-unknown，并保留 accepted evidence；
- [x] Stop 与 Execution Budget 到期使用同一 Run 终态。

## Checkpoint 2：Renderer P0

- [x] 增加“结果待确认”状态和非颜色语义；
- [x] Drawer 展示原因、现场检查建议与“结束此运行”；
- [x] blocker 不显示恢复 spinner，成功后刷新权威 Snapshot 并把焦点返回 Composer。

## Checkpoint 3：P1 准备

- [x] 冻结 Copilot Host A/Host B 最小实验、kill windows、观测字段和通过条件；
- [x] 明确 `native_turn.reconcile.v1` capability 最低保证；
- [x] 通过无 prompt preflight，验证固定 executable/model、SIGKILL、脱敏、计数器与 Host B allowlist；
- [x] 在隔离 data/workspace 上完成 control、in-flight kill、terminal-before-persist kill 各两个有效重复；
- [x] 形成 digest-closed evidence bundle，并确认 Copilot 1.0.79 未证明 `native_turn.reconcile.v1`；
- [x] 保持 P0 blocker，不设计 Native Turn Coordinator，不向 capability catalog 写入推断能力。

## Checkpoint 4：回归与门禁

- [x] 覆盖 startup classification、第二次重启稳定、Scheduler fence 与用户收敛；
- [x] 覆盖 Execution Budget 到期仍保留 accepted evidence；
- [x] 更新 recovery smoke 的 blocker、no-resend 与 explicit close 断言；
- [x] Rust 全量、TypeScript/Vitest、文档治理、格式、diff 与生产 UI 检查全部通过；
- [x] 完整证据齐全后把本计划和版本概览标记为 complete。
