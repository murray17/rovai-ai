---
document_type: version-overview
version: v0.64
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-12
---

# Rovai-ai v0.64：Accepted Input 恢复阻断与安全收敛

> 当前状态：P0 Core/Renderer、完整门禁和生产 UI 验收已完成；真实 Copilot P1 的 2 × 3 矩阵也已完成，
> `native_turn.reconcile.v1` 未获证明，P0 blocker 边界保持不变。
>
> 前置版本：[v0.63 MCP 队员分配工作台与开放 Library](../v0.63/README.md)

## 版本目标

修复 Core 重启后 accepted Runtime input 永久显示“恢复中”却没有实际恢复动作的问题。在未证明 Provider
支持旧 Native Turn reattach 时，Rovai 明确阻断自动重发，向用户展示结果未知，并允许安全结束后创建
新的后续任务。同时执行 Copilot P1 实验，以真实跨 Host 证据决定是否声明 capability。

## 交付范围

- Startup Recovery 把无其他 safety blocker 的 accepted-input Run 收敛为
  `waiting/recovery_blocked`，清除 `runtime_recovery_required`；
- blocker 跨重复重启幂等，不进普通 Scheduler、不触发 Runtime rebind、不增加 execution epoch；
- Codex 与 ACP accepted-input 分支删除虚假的 `agent_run.input_resumed`；
- 新增 versioned user command，把 blocker 结束为
  `failed/accepted_input_outcome_unknown`，保留 accepted Delivery 与执行现场；
- CampTurn Stop 和 Execution Budget 到期复用 outcome-unknown Run 终态；
- Execution Drawer 展示“结果待确认”、原因、现场检查建议与“结束此运行”，不显示恢复 spinner；
- 更新 recovery smoke 断言原 prompt 未重发、第二次重启稳定、显式结束保留 accepted evidence；
- 冻结并执行 Copilot P1 实验：无 prompt preflight 与 control/in-flight/terminal-before-persist 各两轮；
- 被测 Copilot `1.0.79` / `gpt-5.4` 只提供 Session history replay，没有稳定 Turn ID、机器可判状态或
  terminal result 重读，因此不声明 `native_turn.reconcile.v1`。

## 验收证据

- Core：346 个 library test、10 个 `rovai` CLI test、66 个 `rovai-core` test 通过，3 个真实 Runtime
  manual smoke 按合同保持 ignored；`cargo check --workspace --all-targets` 与 Rust format gate 通过；
- Renderer：TypeScript typecheck、44 个 Vitest 文件 / 293 项测试与 production build 通过；
- 生产 UI：隔离 packaged App fixture 验证“结果待确认”、无 spinner、不自动重发文案、“结束此运行”、
  `role=status`、danger token，以及 blocker 不计入“执行中”汇总；
- 文档：21 项 ADR governance test、version check、diff-aware ADR check 与 generated history 通过；
- `smoke-recovery.mjs` 已冻结 blocker、重复重启 no-op、same epoch、accepted evidence 保留和 no-resend
  断言；真实 Runtime smoke 未在 P0 中运行，避免把新 prompt 当成旧 Turn reconcile 证据。
- P1：六个有效真实样本均为 Host A prompt/Tool Call/nonce 各一次；Host B 两次 load、prompt 零次、执行
  permission request 零次；[digest-closed evidence manifest](evidence/copilot-native-turn-reconciliation-2026-08-12/manifest.json)
  与离线 evidence test 通过，最终 `capability_not_proven`。

## 冻结边界

- 不移除 accepted-input Scheduler fence，不把 accepted 改回 prepared/delivery-unknown；
- 不把 Session load、Session ID、Compatibility Key 或 Rovai correlation ID 当成旧 Turn reattach；
- 不实现通用 Native Turn reconcile，不宣称 Copilot exactly-once reattach；
- 用户动作不确认成功、不生成 final output、不自动重发或创建 successor；
- Data Contract 保持 v0.62/schema 31，CampSnapshot 保持 schema 28，本版本没有数据迁移；
- 不改变 Runtime Activity classifier、证据身份、Runtime 实测兼容性清单或 Agent-facing CLI。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.63 冻结为 historical，v0.64 成为唯一 current，并新增概览、实施计划与 P1 实验协议 |
| ADR | 已更新 | 新增 [ADR-0164](../../adr/0164-accepted-input-recovery-requires-proven-native-turn-reconciliation.md)，冻结 Session/Turn 分离和 accepted-input fail-closed 边界 |
| Contracts | 已更新 | 新增 [Accepted Input Recovery v1](../../contracts/accepted-input-recovery-v1.md)和[Run Process Detail Surface v4](../../contracts/run-process-detail-surface-v4.md) |
| Architecture | 已更新 | 新增 [AgentRun Recovery](../../architecture/agent-run-recovery.md)，组合启动分类、Scheduler、Adapter、取消与用户收敛职责 |
| UI | 已更新 | Arctic Dawn 当前规范和 Renderer v4 合同增加“结果待确认” blocker，沿用现有 Neutral Porcelain + Steel token |
| Runtime Activity | 确认无需更新 | 删除虚假 input-resumed 通知但不改变 Canonical Activity 分类、operation identity 或 Evidence mapping |
| Runtime compatibility | 已更新 | 记录 Copilot 1.0.79 / gpt-5.4 的 P1 负向能力证据；不新增产品 capability |
| Documentation routing | 已更新 | 文档导航、CURRENT、Architecture/Contract 索引和 current version 指针路由到恢复合同 |
| Root README | 确认无需更新 | 项目定位和常青能力集合不变；根 README 不记录当前版本恢复细节 |

## References

- [v0.64 实施与验收计划](implementation-plan.md)
- [Copilot Native Turn Reconciliation 实验](copilot-native-turn-reconciliation-experiment.md)
- [ADR-0164](../../adr/0164-accepted-input-recovery-requires-proven-native-turn-reconciliation.md)
- [Accepted Input Recovery v1](../../contracts/accepted-input-recovery-v1.md)
- [Run Process Detail Surface v4](../../contracts/run-process-detail-surface-v4.md)
- [AgentRun Recovery 架构](../../architecture/agent-run-recovery.md)
