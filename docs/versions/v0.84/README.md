---
document_type: version-overview
version: v0.84
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
last_updated: 2026-08-15
---

# Rovai-ai v0.84：可切换执行台与 Inspector Sidecar

> 当前状态：交互方向已确认，Renderer、自动验收与打包交付正在实施。
>
> 前置版本：[v0.83 TRAE CLI CN Runtime](../v0.83/README.md)

## 版本目标

保留现有 Agent 级连续执行过程、Run stage、证据与唯一详情 surface，同时允许用户在同一 Camp 内把
执行台从默认底部位置移动到右侧 Inspector。右侧模式把“执行”作为“任务 / 队员”旁的第三个 Tab，
使用现有 310px / 260px Inspector，不创建第二套宽 Sidecar，也不复制执行事实。

底部模式继续使用横向队员过程入口与可调高度详情；右侧模式改用有界滚动的纵向队员列表，并让执行
详情占据剩余高度。切换只改变 Renderer 承载位置，保留当前 Agent、精确 Run、详情开合和 Inspector
基础页签，不改变 AgentRun、Delivery、Evidence、Task、Approval 或 CampTurn Stop 权威。

## 交付范围

- 执行台初始位于会话时间线底部，提供具名“移到右侧”操作；
- 右侧模式自动显示 Inspector 并激活“执行”Tab，提供“移回底部”操作；
- 底部横向入口与右侧纵向入口消费同一 Agent 级过程投影，状态、排序与选择规则一致；
- 右侧队员列表最多占用约四行高度，更多队员在列表内部纵向滚动，执行详情继续独立滚动；
- 右侧详情不提供高度拖拽，底部 Drawer 的鼠标、键盘高度调整和 Session 内高度偏好保持不变；
- Task related execution、停止结果和世界地图入口在右侧模式下定位“执行”Tab，不产生第二条过程时间线；
- 位置切换、Inspector 显隐、关闭详情、Escape 与键盘 Tab 导航保持可恢复焦点和非模态行为；
- 双主题、1040×700、1440×920、2560×1440、200% zoom、reduced motion 与无横向溢出进入验收。

## 非目标

- 不新增 Core Process、IPC、数据库字段、Migration、Adapter 或 Runtime Activity 映射；
- 不改变 Agent 级分组、preferred Run、Run stage、Delivery、Evidence 或 Recovery Blocker 语义；
- 不把右侧 Inspector 扩宽为独立可拖拽 Sidecar，不同时渲染两份执行详情；
- 不持久化执行台位置；新 Camp 或重新打开页面仍从底部开始；
- 不新增 Agent/Run 级 Stop、Cancel、Retry 或 Approval 决策入口。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.83 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.84。 |
| ADR | 已更新 | [ADR-0190](../../adr/0190-user-placeable-agent-execution-console.md)冻结默认底部、可移入 Inspector 且不复制执行事实的长期边界。 |
| Contracts | 已更新 | [Run Process Detail Surface v6](../../contracts/run-process-detail-surface-v6.md)定义两种承载位置、列表方向、焦点与唯一详情 surface。 |
| Architecture | 确认无需更新 | Core、Read Side、进程、传输和权威边界不变；这是 Renderer 内的可逆承载位置变化。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)记录执行台位置切换、条件式第三 Tab、纵向名册和响应式边界。 |
| Runtime Activity | 确认无需更新 | Canonical Activity、Evidence 分类、Runtime provider event 与展示映射均不变化。 |
| Runtime compatibility | 确认无需更新 | Runtime 目录、实测版本、能力与 Adapter 行为均不变化。 |
| Documentation routing | 已更新 | [文档导航](../../README.md)移除对 v0.83 的错误“当前版本”称呼；现有 Camp Renderer 与 Run detail 路由继续覆盖本任务。 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；根 README 不记录版本局部的执行台位置偏好。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0190](../../adr/0190-user-placeable-agent-execution-console.md)
- [Run Process Detail Surface v6](../../contracts/run-process-detail-surface-v6.md)
- [Camp 会话工作区 UI 合同](../../ui/components/conversation-workspace.md)
