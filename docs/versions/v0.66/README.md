---
document_type: version-overview
version: v0.66
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-13
---

# Rovai-ai v0.66：计划内受控关闭与可靠终态收口

> 当前状态：领域语义、ADR、Architecture、Contract、Core、Desktop、Migration、Read Side 与 UI
> 实现已完成；全量自动化、隔离 packaged App 视觉与真实 Claude Code Runtime 受控关闭验收均已
> 通过，版本状态为 `complete`。
>
> 前置版本：[v0.65 当前用户注意力与渐进式 CLI 教学](../v0.65/README.md)的统一范围在业务实现开始前
> 因优先级切换冻结为 `closed_incomplete`；其已完成的目录附件独立增量保留在主线，但未实现设计不构成
> 本版本的发布依赖。

## 历史勘误（2026-08-13）

v0.66 下方记录的自动化、真实 Claude Code 与 packaged App 验收均为当时真实通过的发布证据；
`implementation_status: complete` 也继续表示该版本交付包已经结束。后续源码审查确认，当时的测试没有
覆盖三个会使实现偏离 ADR-0168 / Planned Shutdown v1 的并发边界，因此“完整实现”不能继续被解释为
这些边界已经获得证明：

- coordinator 在等待 launch handoff barrier 前已经设置 `draining`，Provider route 已激活但 Core
  binding 尚未完成时到达的真实 terminal 可能被 planned admission 以 route mismatch fence；
- abortive settlement 只接受 `running`，仍持有当前 generation live Runtime route 的 `waiting` Run
  无法使用已经取得的可靠 failed/cancelled terminal；
- Core deadline 后仍存在无界 launch/terminal/route barrier、Runtime reap 与 worker join，且部分 terminal
  handler 在领域事务完成后仍长期持有 guard。

这些缺口不推翻 v0.66 冻结的领域决定、Migration 77 或当时已验证的诚实 unknown 行为；其实现修正和
新增竞态证据由后续 [v0.69](../v0.69/README.md)负责。v0.66 实施计划中的完成勾选是当时验收快照，
不得作为 v0.69 三项新增门槛已经通过的证据。

## 版本目标

让用户主动退出、应用主动重启或更新前重启时，Rovai 先线性化关闭新执行准入，再向当前 Core
generation 的 active Runtime 请求停止，并在统一 deadline 内保留真实 terminal、Built-in IPC 和 Adapter
event route。可靠成功、失败或取消按真实语义结算；只看到 interrupt 成功、进程退出或 transport error
时不伪造 cancelled。

本版本不处理 Core crash、SIGKILL、系统强杀或断电。deadline 后仍无法确认的 accepted input 保持
AgentRun 非终态，下次启动继续进入 v0.64 的 Accepted-Input Recovery Blocker。

## 交付范围

- 新增 Core lifecycle coordinator，分别拥有 execution launch admission 与 terminal settlement admission；
- 修复 Scheduler claim 后 detached launch 与 drain 的竞态，并阻止 draining generation 启动 queued、
  recovery 或后台 Runtime 工作；
- 登记 generation-local active execution handle，绑定 live route、Run、epoch 与 Adapter Turn correlation；
- planned stop 不写 CampTurn cancellation 或 `AgentRun.cancel_requested_at`；
- 同时支持可靠 `succeeded`、abortive `failed` 和 `cancelled` terminal；后两者原子收敛 Run-local
  Approval、Action、Runtime Delivery 与 prepared input；
- AgentRun 持久化 `terminalResolutionSource / terminalReasonCode`，CampTurn 持久化
  `aggregateReasonCode`，Message Delivery 区分 planned-shutdown cancellation；
- `CampTurn.cancelled` 只来自明确 Turn cancellation intent；required Run-local cancelled 聚合为
  failed/incomplete，optional cancelled 不阻止 completed；
- Main-only `core.shutdown` 和 `CoreClient.shutdown()` 等待 shutdown report 与 Core 子进程真实退出，外层
  watchdog 才使用 SIGTERM/SIGKILL；
- Renderer 以稳定字段显示“已停止”，并在 cancelled Run 上继续展示 unsettled external effect。

## 冻结边界

- 不复用 `campTurns.cancel`、cancellation coordinator 或 cancellation acknowledgement；
- 不用 Runtime process exit、route detach、interrupt RPC 或 shutdown transport error 证明 terminal；
- 不要求所有 Adapter 提供跨进程 Provider Turn ID，不引入 `native_turn.reconcile.v1`；
- 不跨 Core generation reattach Runtime，不引入独立 Supervisor 或 durable terminal receipt ledger；
- 不新增 AgentRun 主状态、人工确认成功或自动 successor；
- v1 使用固定全局 deadline，不提供“取消退出”；planned stop 发出后不能恢复原执行；
- queued Run、等待 Approval/Action/用户输入的 Run 和已有 recovery blocker 保持原领域状态；只有当前
  generation 实际持有的 active execution 收到 planned stop。

## 发布门槛

1. Migration 77、AgentRun/Message Delivery/CampTurn settlement 与 read projection 全部完成；
2. launch/terminal admission、active handle、deadline fence 与九 Runtime planned stop 路径完成；
3. Main-only shutdown handshake、child-exit wait、restart suppression 和 watchdog 完成；
4. Core/DB/Desktop/Renderer 回归覆盖竞态、幂等、冲突 terminal、timeout 与 unknown 保留；
5. Rust workspace、TypeScript、Vitest、production build 和全部文档门禁通过；
6. packaged App 在真实 accepted input 上完成 Day/Night、`1040×700`、200% zoom、自然退出、无
   terminal 伪造与下次启动 recovery blocker 验收后，才可标记 complete。

## 验收证据

- Rust：`cargo fmt --all`、workspace check/Clippy 通过；library `363/363`、CLI `10/10`、Core
  `68/68` 通过，另有 `3` 个显式标注的真实 Runtime 手工 smoke 保持 ignored；
- Desktop/Renderer：`pnpm test` 的文档治理 `21/21`、Vitest `302/302`、Node/benchmark
  `155/155` 通过，并通过 `pnpm typecheck`、`pnpm build:desktop` 与 `pnpm package:mac`；
- 过程 UI：`pnpm accept:runtime-activity-ui` 以九 Runtime 受控 fixture 验证 Agent 过程、恢复
  blocker、Day 基线、`1040×700`、200% zoom、reduced motion 与无横向溢出；
- 真实关闭：`pnpm accept:planned-shutdown` 在全新临时 Git workspace 和隔离 `userData` 中启动
  Claude Code `2.1.220`，等待 Runtime input 达到 `accepted` 后触发 packaged App 退出。App 在
  `12273ms` 自然 `exit 0`，六个已观察子进程全部 reap；Run/Turn 没有 cancellation intent、没有
  terminal source/reason，accepted evidence 保持不变；
- 重启核对：相同隔离数据下，同一 AgentRun 保持 `executionEpoch=1` 并进入
  `waiting/recovery_blocked`，没有自动重发；恢复 blocker、Day/Night、`1040×700`、Night 200%
  zoom 和 reduced motion 截图/DOM 断言均通过，第二次退出在 `7626ms` 自然完成；
- Core wire：非法 shutdown 字段返回 `CORE_SHUTDOWN_INVALID` 且 Core 继续存活，合法 v1 request
  返回 completed report、flush stdout 并自行退出；文档生成、diff-aware CI 与链接门禁全部通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.65 的注意力/CLI 统一范围以未实施事实冻结为 historical/closed_incomplete，并保留其已完成的目录附件独立增量；v0.66 成为唯一 current，并新增本概览与实施计划 |
| ADR | 已更新 | [ADR-0168](../../adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md)冻结独立 planned-shutdown lifecycle、同 generation terminal authority 与 CampTurn cancellation intent 不变量 |
| Contracts | 已更新 | 新增 [Planned Shutdown v1](../../contracts/planned-shutdown-v1.md)与[Run Process Detail Surface v5](../../contracts/run-process-detail-surface-v5.md) |
| Architecture | 已更新 | 新增 [Planned Shutdown](../../architecture/planned-shutdown.md)，组合 launch admission、active registry、terminal guard、deadline 与 Desktop 边界 |
| UI | 已更新 | 当前 Porcelain/Steel 规范路由 v5 terminal source 文案，并取消 cancelled Run 隐藏 unsettled warning 的旧规则 |
| Runtime Activity | 确认无需更新 | planned shutdown 改变 AgentRun terminal settlement 与进程 lifecycle，不新增 Runtime Activity classifier、operation identity 或 provider event mapping |
| Runtime compatibility | 确认无需更新 | 不声明新 Adapter capability；真实 terminal 继续使用各 Adapter 已有同 generation route correlation |
| Documentation routing | 已更新 | docs map、CURRENT、Architecture/Contract/UI 索引和 current version pointer 共同路由到 v0.66 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持 Runtime 集合不变；根 README 不记录当前版本关闭协议 |

## References

- [v0.66 实施与验收计划](implementation-plan.md)
- [ADR-0168](../../adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md)
- [Planned Shutdown 架构](../../architecture/planned-shutdown.md)
- [Planned Shutdown v1](../../contracts/planned-shutdown-v1.md)
- [Run Process Detail Surface v5](../../contracts/run-process-detail-surface-v5.md)
- [Accepted Input Recovery v1](../../contracts/accepted-input-recovery-v1.md)
