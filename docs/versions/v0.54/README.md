---
document_type: version-overview
version: v0.54
lifecycle: historical
authority: version-scope-and-status
design_status: complete
implementation_status: complete
last_updated: 2026-08-10
---

# Rovai-ai v0.54：Lead-Owned Task 与 Self Active Task Context

> 当前状态：设计与实施均已完成。该版本以 clean break 收敛 Durable Task 的责任定义权、
> Assignee 执行态更新、Camp-wide 按需读取和 self-only AgentRun awareness。
>
> 前置版本：[v0.53 Versioned Benchmark Protocol v3](../v0.53/README.md)

## 版本目标

减少多 Agent 并行时重复、过细的 durable Task，同时保留明确的执行 owner、阻塞/完成/交接语义和
Camp 协作态势感知。User/Default Lead 统一定义责任，Assignee 只更新自己的执行态；每个 AgentRun
只获得有界 self active Task compact projection，完整共享面板由 CLI 按需读取。

## 交付范围

- Durable Task v3 Lead/User creation 与责任定义权限；
- Assignee-only execution-state patch、闭合状态矩阵和字段级 Core authorization；
- unassigned holding/recovery state 与普通 Agent claim 删除；
- Camp-wide `task list/get` 和最小 Task list projection；
- Lead-facing Task creation restraint contract/help 与最小 Session Charter authority fact；
- `[SELF_ACTIVE_TASKS]` compact JSON、explicit empty clearing snapshot、Profile v3、Formatter v13 与 ContextManifest v11 Evidence；
- Built-in Tool Transport v5、current-only schema migration 和兼容代码删除。

## 冻结边界

- Core 不判断两个 Task 是否语义重复，不把 Task 变成计划步骤或 workflow DAG；
- Task 创建/更新不会自动通知、唤醒或启动 Assignee；
- Task 生命周期变化不取消、重定向或停止已经接受的 Delivery/AgentRun；
- Self Active Task Projection 不是最新 Task 状态或 mutation authority；
- Camp-wide read 不扩大任何写权限；
- 现有 Camp 非终态 `512` 与 source AgentRun create `32` 只作为 safety cap 保留；
- 不新增 claim、Task watermark、delta、ACK 或历史 Task revision 表。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.53 冻结为 historical，v0.54 成为唯一 current |
| ADR | 已更新 | ADR-0152 冻结 Lead-owned responsibility、Assignee execution state、Camp-wide read 与 self active awareness；ADR-0153 区分 explicit empty snapshot 与 budget omission |
| Contracts | 已更新 | Durable Task v3、Built-in Tool Transport v5、Context Delivery Profile v3 与 ContextManifest Evidence v11 |
| Architecture | 已更新 | Built-in Tool Runtime 收敛 Task authority、CLI read 与 Dynamic Context/Manifest 分层 |
| UI | 确认无需更新 | 本版本不改变稳定 Renderer UX 合同；Task list wire shape 由 Built-in CLI/Contract 使用 |
| Runtime Activity | 确认无需更新 | 不新增或重分类 Canonical Runtime Activity |
| Runtime compatibility | 确认无需更新 | 不改变已交付 Runtime 支持范围或实测能力结论 |
| Documentation routing | 已更新 | 文档导航、Contract/Architecture/ADR/Version 索引切换到 v0.54 当前入口 |
| Root README | 确认无需更新 | 项目定位与常青能力范围不变 |

## References

- [v0.54 实施与验收计划](implementation-plan.md)
- [ADR-0152](decisions.md#adr-0152)
- [ADR-0153](decisions.md#adr-0153)
- [Durable Task v3](../../contracts/durable-task-v3.md)
- [Built-in Tool Transport v5](../../contracts/builtin-tool-transport-v5.md)
- [Context Delivery Profile v3](../../contracts/context-delivery-profile-v3.md)
- [ContextManifest Evidence v11](../../contracts/context-manifest-evidence-v11.md)
