---
document_type: version-overview
version: v0.69
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-13
---

# Rovai-ai v0.69：Planned Shutdown 线性化与硬期限修正

> 当前状态：v0.66 建立的 planned-shutdown 领域边界保持不变；后续源码审查确认的 launch handoff、
> waiting live Run 终态和 deadline 三个正确性缺口已完成修正，并通过自动化、packaged App 与真实
> Claude Code accepted-input 关闭/重启验收。
>
> 前置版本：[v0.68 Tool-use 测量与配对协作价值实验](../v0.68/README.md)

## 版本目标

补全 ADR-0168 已冻结但 v0.66 实现未完全满足的受控关闭不变量：关闭 execution launch admission
后，必须先等所有已进入 launch 的执行完成 route handoff 或安全退出，之后才能让 terminal handler
切换到 planned-shutdown 语义；持有同 generation 可靠 terminal permit 的 `waiting` live Run 必须能够
完成 abortive settlement；Core deadline 之后不得再依赖无界 barrier、Runtime reap 或 worker join。

本版本不改变 planned shutdown 与 CampTurn Stop、异常重启恢复或跨 generation reconciliation 的领域
边界，也不新增持久字段、Migration、公共 wire、AgentRun 主状态或 Renderer 交互。

## 交付范围

### Launch 与 terminal 线性化

- Core lifecycle coordinator 使用单调阶段区分 `accepting`、`closing_launch`、`draining` 与
  `terminal_closed`，不再由互相独立的布尔值推断阶段；
- `closing_launch` 立即拒绝新 execution launch，并停止新的 Scheduler、recovery 与后台 Runtime 启动，
  但此阶段已经到达的真实 terminal 继续走普通 terminal 路径；
- 只有 launch handoff barrier 完成、所有成功执行的 route binding 已稳定后才进入 `draining`，再枚举
  active execution 并发出 planned stop；
- Codex、ACP 与 one-shot Adapter 使用同一 terminal admission 入口；真实 route mismatch 继续被 fence，
  不以等待或盲目重试掩盖身份错误。

### Waiting abortive settlement

- generation-local terminal permit 是 planned-shutdown abortive settlement 的授权边界；
- 可靠 `failed | cancelled` terminal 可以结算仍持有 live Runtime route 的 `running | waiting` Run；
- `waiting/recovery_blocked` 等没有当前 generation live route 的 Run 无法取得 permit，不因本次放宽而
  获得新的结算路径；
- success 仍遵守普通 success blocker，CampTurn aggregation、Message Delivery 局部结算和
  `cancel_requested_at` fencing 均保持不变。

### Deadline 与 guard 生命周期

- launch、terminal、live route、agent task、Runtime reap 与 worker 收口都使用统一 deadline 或严格有界、
  位于 Desktop watchdog 内的 cleanup grace；deadline 耗尽后不再发起任何无界等待；
- terminal guard 只覆盖可靠身份校验、领域 terminal transaction 与 active execution 收口；
- Runtime route guard 在 correctness-critical terminal 收口完成后释放；Renderer event emit、Skill/MCP
  reconciliation 和 Adapter cleanup 不延长 terminal/route drain；
- deadline 后仍未取得可靠 terminal 的 accepted input 保持非终态，并在下一 generation 继续进入既有
  recovery blocker。

## 冻结边界

- 不修改 ADR-0168 的长期决定，不创建替代 ADR；
- 不复用 CampTurn cancellation、`AgentRun.cancel_requested_at` 或 cancellation acknowledgement；
- 不把 interrupt 成功、process exit、route detach、reap 或 transport error 当作 terminal proof；
- 不增加跨 generation Runtime reattach、Native Turn reconciliation、Supervisor 或 terminal receipt ledger；
- 不修改 Migration 77、Data Contract `v0.67` / projection schema 33 或任何持久字段；
- 不改变 Main-only shutdown wire、Desktop watchdog 参数或 Renderer 关闭等待面。

## 发布门槛

1. 可控竞态测试证明 `closing_launch` 期间尚未完成 Core binding 的 terminal 不会进入 planned route
   mismatch，且 barrier 完成前绝不进入 `draining`；
2. DB/domain tests 覆盖 waiting Approval、Action 与 Runtime Delivery 上的可靠 failed/cancelled terminal，
   并保留 success、cancel intent、final output 与 recovery blocker 的负向 fencing；
3. deadline tests 覆盖卡住的 launch、terminal callback、Adapter shutdown、Runtime reap 与 worker join，
   证明 Core 不依赖 Desktop SIGTERM/SIGKILL 才结束普通受控关闭；
4. Rust fmt/check/Clippy/workspace test、Desktop/Renderer 回归、文档门禁与 diff check 全部通过；
5. 隔离 packaged App 在真实 accepted input 上完成自然退出、真实 terminal 或诚实 unknown、进程树 reap
   与相同数据重启 no-resend 验收后，才能把本版本标记为 `complete`。

以上门槛已全部通过，精确命令、计数、真实 Runtime 版本与关闭报告见
[实施计划的当前证据](implementation-plan.md#当前证据)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.68 按已完成事实冻结为 historical；v0.69 成为唯一 current，并新增本概览与实施计划 |
| ADR | 确认无需更新 | [ADR-0168](../../adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md)已拥有 launch admission、同 generation terminal authority 与有界 deadline；本版本只修复实现漂移 |
| Contracts | 已更新 | [Planned Shutdown v1](../../contracts/planned-shutdown-v1.md)澄清 `closing_launch`、waiting abortive settlement、guard 生命周期与 deadline 上界，不改变 wire 或持久字段 |
| Architecture | 已更新 | [Planned Shutdown](../../architecture/planned-shutdown.md)明确 lifecycle phase、handoff happens-before 与有界收口职责 |
| UI | 确认无需更新 | 关闭等待 modal、terminal reason 与 recovery blocker 的 Renderer 合同不变 |
| Runtime Activity | 确认无需更新 | 修正 Core lifecycle ordering，不新增 Runtime Activity identity、classifier 或 provider event mapping |
| Runtime compatibility | 确认无需更新 | 不声明新的 Adapter capability；Codex、ACP 与 one-shot Adapter 继续使用既有同 generation correlation |
| Documentation routing | 已更新 | 版本索引切换到 v0.69；现有 planned-shutdown Architecture、Contract 与 ADR 路由保持当前入口 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持 Runtime 集合不变；根 README 不记录版本局部正确性修复 |

## References

- [v0.69 实施与验收计划](implementation-plan.md)
- [ADR-0168](../../adr/0168-planned-shutdown-preserves-runtime-terminal-authority.md)
- [Planned Shutdown 架构](../../architecture/planned-shutdown.md)
- [Planned Shutdown v1](../../contracts/planned-shutdown-v1.md)
- [v0.66 历史勘误](../v0.66/README.md#历史勘误2026-08-13)
- [Accepted Input Recovery v1](../../contracts/accepted-input-recovery-v1.md)
