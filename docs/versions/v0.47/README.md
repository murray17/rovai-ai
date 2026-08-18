---
document_type: version-overview
version: v0.47
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-08
---

# Rovai-ai v0.47：Durable Task v2 与责任准入边界

> 当前状态：实现与发布前本机验收已完成。Task v2、Transport v4、Snapshot v25、成员删除
> 原子收口和 Renderer 四层分工已经进入生产代码；确定性测试、九 Runtime 实测、clean reset、
> packaged App 签名与 Task UI 验收共同构成完成证据。
>
> 前置版本：[v0.46 Agent CLI 精简与隐式 Camp 作用域](../v0.46/README.md)
>
> 后续版本：[v0.48 Native Session Compaction Bootstrap Redelivery](../v0.48/README.md)
>
> 主要决策：
> [ADR-0136](decisions.md#adr-0136)、
> [ADR-0137](decisions.md#adr-0137)。字段级真源：
> [Durable Task v2](../../contracts/durable-task-v2.md)、
> [Built-in Tool Transport v4](../../contracts/builtin-tool-transport-v4.md)。

## 版本目标

v0.47 在现有固定 Built-in CLI 架构上一次性升级 Task 模型，不把 Task 变成工作流或执行
控制器：

- Task 从四态升级为 `pending | in_progress | blocked | completed | cancelled`，增加有序
  Acceptance Criteria、Blocked Reason、Completion Summary、Cancellation Reason 与 actor-derived
  Closure Metadata；
- 新增 `team.get_task` / `rovai task get`，Built-in operation 从 12 增至 13；Create、Get、
  Update 使用完整 `TaskDetail` canonical result，List 使用专用 compact projection；
- 所有 update 在应用 patch 后校验 projected final state。普通 Agent 可编辑、转交、释放、
  阻塞和完成自己的 Task，但不得取消；User 与 Default Lead 才能取消；
- Default Lead 的 Camp-wide Task coordination authority 成为明确规则，局部替代 ADR-0058 的
  “只读”旧条款，但不扩张为通用 Camp 管理员；
- Current CampMembership 决定能否被创建/转交为 Assignee；Member Presence 额外决定 Assignee
  是否可接受新的 linked execution。`away` 不释放责任；membership ending 原子释放非终态 Task；
- `RemoveMember` 保留非终态 AgentRun gate。无此类 Run 时，在一个事务中结束全部 Current
  CampMembership、释放 Task、收口 Default Lead，再标记 Profile removed；
- Task-linked execution 采用一次性 admission：Direct 路径在 queued AgentRun 创建时、A2A 路径
  在 MessageDelivery responsibility 接受时检查 Task 与 Executable Assignee，并冻结 admission
  version/Assignee；后续 Task 改派、阻塞或关闭不撤销已接受执行；
- 会话继续只显示创建位置的一张实时 Task 卡。发现、完整责任/审计和执行事实分别由 Inspector
  list、Inspector detail 与现有 Run UI 承担。

## 设计边界

```text
Task                    持久责任、负责人、范围与业务状态
camp.message.send       通知与显式公共 A2A 委派
MessageDelivery/Run     已接受责任、执行生命周期与运行证据
```

Task mutation 不自动创建消息、Delivery、AgentRun 或 Wake；Run outcome 不自动改变 Task。
`cancelled` 终止的是持久责任，不是所有由它历史触发的执行。要停止已经接受的工作，必须使用
现有 Delivery、AgentRun 或 CampTurn cancellation。

本版本不增加 Task priority、deadline、dependency graph、progress、Runtime permission/budget/
sandbox、任意 evidence JSON、独立 claim/complete/block/cancel/delete operation，也不恢复成员级
Task Capability gate。

## 关键领域规则

### Projected final state

- `in_progress` 必须有 Assignee；
- `blocked` 必须有 Assignee 与 Blocked Reason；
- `completed` 必须有 Completion Summary 与完整 Closure Metadata；
- `cancelled` 必须有 Cancellation Reason 与完整 Closure Metadata；
- 离开某一条件状态时，Core 清除不再适用的 reason/summary；
- 清除 Assignee 的 final status 只能是 `pending`；
- terminal Task 完全不可修改或重开。

普通 Agent 原子认领 unassigned Task 时只能认领给自己，且整个 projected final state 只允许
`pending | in_progress | blocked`。检查不能只看显式 `status` 字段；任何组合都不能 claim-and-close。

### Membership 与删除

单 Camp leave 与永久 RemoveMember 都复用同一 membership-ending 领域路径。每个受影响的
`pending / in_progress / blocked` Task 原子变为 `pending`、清除 Assignee 与 Blocked Reason、
增加 version，并记录 `cause = assignee_membership_ended`。`away` 不触发该路径，terminal Task
保留历史 Assignee。

永久删除在有 `queued / running / waiting` AgentRun 时继续以
`agent_profile.non_terminal_runs` 拒绝；否则一次事务处理所有 Camp。已接受但尚未 materialize
的 Delivery 不属于该 gate，并可在 Profile removed 后因独立身份 eligibility 停止。

### 一次性 linked admission

新责任被接受时，Task 必须是 `pending` 或 `in_progress`，recipient 必须是当前 Executable
Assignee，并冻结 `taskVersionAtAdmission` 与 `assigneeAgentIdAtAdmission`。此后 dispatch/start
不得再按 Task 当前 status 或当前 Assignee 二次准入。Membership、Presence、Runtime readiness、
cancellation、budget、lease、lineage、capacity、permission 与 safety 仍是独立的当前执行条件。

## 固定版本矩阵

```yaml
dataContractVersion: v0.47
contractVersion: 4
cliCommandVersion: 4
agentOutputContractVersion: 2
runtimeCapability: builtin_cli.transport.v4
ipcProtocolVersion: 1
envelopeContractVersion: 1
receiptVersion: 1
campSnapshotSchemaVersion: 25
builtinOperationCount: 13
```

Transport v3 成为 historical；v3/v4 不在同一 App、Runtime process、lease、Session 或 Replay
路径混用。Envelope、IPC 和 receipt 仍是 v1，不表示旧 Task 或 v3 Agent contract 可兼容。

## Clean break

v0.47 不迁移 v0.46 Task、旧 command result、旧 replay 或旧 catalog，不保留旧状态/字段 alias、
dual schema、translation 或 runtime fallback。切换时依
[ADR-0118](../v0.41/decisions.md#adr-0118)执行一次完整
Rovai-owned App data clean reset。

清理范围不得扩展到用户 workspace、外部 Runtime Home、Runtime config、credentials 或外部
MCP state。历史设计文档仍保留，不是可运行 compatibility source。

## Renderer 分层

| Surface | 责任 |
| --- | --- |
| 会话 Task 卡 | 只感知当前五态、title 与 Assignee；原地刷新，不新增消息 |
| Inspector list | 发现 compact Task、单行 preview 与 Acceptance Criteria 数量 |
| Inspector detail | 完整责任内容、Closure Metadata、版本与 audit cause |
| 现有 Run UI | Delivery/AgentRun 当前与历史执行事实 |

完整交互、冲突恢复、取消警告、成员删除确认和无障碍边界见
[v0.47 生产设计](production-design.md)。

## 实施状态与发布判断

v0.47 已按[实施与验收计划](implementation-plan.md)完成，主要证据如下：

1. `cargo test --workspace --no-fail-fast`、`cargo clippy --workspace --all-targets -- -D warnings`、
   `pnpm typecheck` 与 `pnpm test` 全部通过；
2. `pnpm smoke:core`、`pnpm smoke:recovery` 与 `pnpm smoke:intake` 通过，clean reset 另有只读受管
   目录和 symlink 越界负向测试；
3. `pnpm smoke:builtin-cli` 在九种正式 Runtime 上各完成 13 项 v4 operation、stale-version recovery、
   初始/恢复 lease fence 与 continuation；
4. `pnpm package:mac` 生成 arm64 ad-hoc hardened-runtime App，App/Core/CLI 通过 deep/strict
   `codesign`，打包内 Core/CLI Mach-O UUID 与 release 产物一致；未执行 Apple notarization，
   因而不声称已公证；
5. `pnpm accept:task-card-ui` 通过 1440×920、1040×700、Reduced Motion、键盘打开、200% Zoom、
   单卡原地更新、完整详情/审计与横向溢出检查。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | [版本索引](../README.md)把 v0.47 设为唯一 current；[v0.46](../v0.46/README.md)冻结为 historical，并补齐前后版本链接 |
| ADR | 已更新 | [ADR-0136](decisions.md#adr-0136)与[ADR-0137](decisions.md#adr-0137)冻结责任、权限、删除级联和一次性 admission；ADR-0057/0058 增加局部替代说明 |
| Contracts | 已更新 | [Durable Task v2](../../contracts/durable-task-v2.md)、[Built-in Tool Transport v4](../../contracts/builtin-tool-transport-v4.md)及[合同索引](../../contracts/README.md)成为当前入口，Transport v3 标记 historical |
| Architecture | 已更新 | [Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)更新为 v4、13 项命令、完整 canonical Task result 与显式 Agent projection；组件权威边界不另起新组件 |
| UI | 已更新 | [v0.47 生产设计](production-design.md)、[UI 规范索引](../../ui/README.md)与[Camp 会话工作区](../../ui/components/conversation-workspace.md)冻结五态实时卡、Inspector 分层、冲突恢复和中文删除确认 |
| Runtime Activity | 确认无需更新 | Task operation 增至 13 项但仍属于既有 Built-in Tool Activity domain，不改变 Runtime evidence 到 Canonical Activity 的映射、classifier 或 presentation rules |
| Runtime compatibility | 已更新 | [Runtime 兼容性清单](../../runtime-compatibility.md)记录同一轮 v0.47/v4 九 Runtime、十三项操作、lease 与 continuation 实测证据 |
| Documentation routing | 已更新 | [文档导航](../../README.md)把 Built-in 修改路由到 Transport v4，并增加 Durable Task v2 当前合同入口 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持范围未改变，根 README 也不保存当前版本号或版本流水账 |

## References

- [v0.47 实施与验收计划](implementation-plan.md)
- [v0.47 生产设计](production-design.md)
- [Durable Task v2](../../contracts/durable-task-v2.md)
- [Built-in Tool Transport v4](../../contracts/builtin-tool-transport-v4.md)
- [Rovai-ai domain language](../../../CONTEXT.md)
