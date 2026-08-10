---
document_type: version-overview
version: v0.55
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-10
---

# Rovai-ai v0.55：Agent 级连续执行过程

> 当前状态：设计、生产实现与打包 App 验收已完成。v0.55 以队员为稳定入口聚合一个 Camp 中同一
> Agent 的多个 `AgentRun`，在不合并或隐藏单次执行证据的前提下，提供连续的只读执行过程。
>
> 前置版本：[v0.54 Lead-Owned Task 与 Self Active Task Context](../v0.54/README.md)

## 版本目标

把旧的逐 `AgentRun` 执行摘要和详情选择替换为 Agent 级执行过程。用户从一位队员的一条稳定
入口进入，按时间阅读该 Agent 的多个 `AgentRun`、每次运行的边界、收件人与执行证据；
AgentRun 仍是 Core、Evidence、取消与投递的唯一领域身份，不被 Renderer 合并为新领域对象。

## 交付范围

- Agent 级执行过程入口：同一 Camp 中每位出现过 AgentRun 的队员恰有一个入口；
- 按时间连续展示各 AgentRun，保留 Run ID、CampTurn、调用来源、A2A 深度、Delivery 与证据边界；
- 打开过程时优先定位最新 `running`，其次最新非终态，最后最新终态 Run；后台事件不自动打开、
  切换或抢焦点；
- 执行详情仍是只读，不新增 Agent/AgentRun 级停止、取消、重试或领域写入；唯一停止入口仍在
  Composer，并 fence 当前 CampTurn 的整棵执行树；
- Inspector 收敛为“任务 / 上下文投递 / 审批”；Task 的 Related execution 与停止结果均进入对应
  Agent 过程，而不保留 Run 级详情路由或“审计”Tab；Camp Header 不再显示执行入口；
- 当前 Arctic Dawn/UI 与桌面验收更新为 Agent 级过程、焦点返回、窄窗/缩放和真实证据展示口径。

## 冻结边界

- Agent 级过程是 Renderer read-model grouping，不创建 Process 表、IPC 命令、持久化身份或
  兼容 reader；
- 不按相邻时间、相似正文、Task、CampTurn 或 Delivery 推断两个 AgentRun 是否属于同一执行；
  只按当前 Camp Snapshot 中的 `agentId` 分组；
- 不删除或折叠任何 AgentRun 的 Canonical Runtime Activity、Execution Evidence、ContextManifest
  或 Delivery 底层事实；会话 footer 与 Run stage 不重复显示 Delivery 状态标签；
- 不恢复旧的逐 Run chip、Inspector Activity/Audit tab、Run stop/cancel 或自动打开 Drawer；
- 不改变 Message Delivery、A2A、CampTurn cancellation、Runtime Activity、Core Read Side 或其
  持久化合同。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.54 已冻结为 historical，v0.55 成为唯一 current，并新增本版本概览与实施计划 |
| ADR | 已更新 | ADR-0154 完整替代 ADR-0133 的逐 Run Scheme C 过程 surface |
| Contracts | 已更新 | Run Process Detail Surface v2 成为当前 Agent 级过程合同；v1 保留为 historical |
| Architecture | 确认无需更新 | 不改变 Core 组件职责、领域真源、进程或传输结构；仅替换 Renderer read-model surface |
| UI | 已更新 | Arctic Dawn V3 与 UI 索引收敛 Agent 级入口、连续 Run 阶段、三 Tab Inspector 与无障碍边界 |
| Runtime Activity | 确认无需更新 | Canonical Runtime Activity、Evidence 分类和 Runtime coverage 均不变 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 支持范围或实测兼容性结论 |
| Documentation routing | 已更新 | ADR CURRENT 与 Contracts 索引已指向 ADR-0154 / Run Process Detail Surface v2 |
| Root README | 确认无需更新 | 项目定位与常青能力范围不变 |

## References

- [v0.55 实施与验收计划](implementation-plan.md)
- [ADR-0154](../../adr/0154-agent-level-execution-process-surface.md)
- [Run Process Detail Surface v2](../../contracts/run-process-detail-surface-v2.md)
- [Arctic Dawn V3](../../ui/arctic-dawn.md)
