---
document_type: version-overview
version: v1.08
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-18
---

# Rovai-ai v1.08：取消 Run 的活动停止投影

> 历史状态：设计、Renderer Contract、生产实现、隔离 UI 验收与 macOS 打包验证均已完成。
>
> 前置版本：[v1.07 Public-only、A2A 指导与 Principal 投影提案](../v1.07/README.md)
>
> 后续版本：[v1.09 当前会话精确查找](../v1.09/README.md)

## 版本目标

修复 AgentRun 已取消后，执行台中缺少自身终端回执的最后一条 Tool Call 仍显示“执行中”并持续旋转的
冲突状态。执行台直接表达用户当前最需要的事实：该操作已经随本轮执行停止；Canonical Runtime
Activity 与外部效果证据保持不变。

## 交付范围

- Activity presentation 增加 `stopped` 状态和“已停止”文案；
- canonical `outcome = cancelled` 的 Tool Call 显示“已停止”；
- `AgentRun.status = cancelled` 时，仅把仍为 `running` 的活动行投影为 `stopped`；
- completed、failed、waiting 与 recorded 活动不被父 Run 状态覆盖；
- stopped 图形使用中性圆形边界与方形停止标记，不运行 spinner 或 pulse；
- 底部与 Inspector 执行台共享同一映射，Porcelain Day 与 Steel Night 使用同一组件树；
- Run Process Detail Surface v7 与 Camp 会话工作区 UI 规范记录展示边界。

## 明确不做

- 不改写 Canonical Activity `phase/outcome`、Execution Evidence 或终端时间；
- 不把“已停止”解释为成功、失败、未执行、已回滚或外部效果已确定；
- 不修改 Runtime adapter、ACP/Codex cancel 协议、Core Schema 或 Read Side wire；
- 不隐藏 `hasUnsettledExternalEffects`、Recovery Blocker 或既有 Evidence 详情；
- 不实施 v1.07 的 Public-only、A2A guidance、Principal projection 或其 proposal Contract。

## 验收边界

- cancelled Run 中 canonical `progress + unknown` 的最后一条活动显示“已停止”且没有动画；
- canonical cancelled 活动显示“已停止”；
- 同 Run 中已完成、失败和已记录活动保持原状态；
- running/failed/succeeded Run 的既有活动展示不发生越界变化；
- TypeScript、Renderer 定向回归、双主题 CSS 检查、文档治理和 Desktop 构建通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.07 以 `not_started` 提案状态冻结为 historical；本概览、计划和版本索引建立唯一 current v1.08。 |
| ADR | 确认无需更新 | ADR-0062、ADR-0079 与 ADR-0115 已拥有执行停止、活动证据和未知效果分离边界，本版不改变其语义。 |
| Contracts | 已更新 | [Run Process Detail Surface v7](../../contracts/run-process-detail-surface-v7.md)继承 v6 并增加取消 Run 的活动停止展示。 |
| Architecture | 确认无需更新 | 本版不改变 Renderer/Core 职责、进程、传输、持久化或权威边界。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)记录“已停止”主状态、无动画和不改写 Canonical Activity 的规则。 |
| Runtime Activity | 已更新 | `ui-model.ts` 与 `CampWorkspace.tsx` 更新 Renderer presentation；classifier、operation identity、Evidence 与 Registry mapping 不变。 |
| Runtime compatibility | 确认无需更新 | 十个 Runtime 的实测版本、能力、coverage 和平台资格结论均未变化。 |
| Documentation routing | 已更新 | Version、Contract、ADR CURRENT 与 UI acceptance 的当前入口指向 v1.08 / Run Process Detail Surface v7。 |
| Root README | 确认无需更新 | 这是既有执行台的终态展示修正，不改变项目定位、常青能力或支持范围。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Run Process Detail Surface v7](../../contracts/run-process-detail-surface-v7.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [ADR-0062](../../adr/0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0079](../../adr/0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md)
- [ADR-0115](../../adr/0115-evidence-bounded-activity-phase-and-outcome-resolution.md)
