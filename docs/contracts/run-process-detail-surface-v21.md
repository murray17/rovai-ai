---
document_type: contract
contract: run-process-detail-surface-v21
authority: agent-process-tool-group-summary-semantics
status: accepted
source_version: v1.28
last_updated: 2026-08-26
---

# Run Process Detail Surface v21（Tool 组摘要语义）

本合同完整继承 [Run Process Detail Surface v20](run-process-detail-surface-v20.md) 的连续 Tool 分组、
chronology、两级 disclosure、结果惰性读取、执行台位置、完整 Tool 状态和性能边界。v21 只收敛 Tool 组
摘要的可见文案与组级状态图标；它不改写组内任一 Tool 的 identity、状态或 Evidence。

## 1. 可见摘要

存在 running 或 waiting Tool 时，摘要继续显示最后一条非终态操作，以及对应的“执行中”或“等待审批”。
其后只显示已经结算的操作总数；`N` 是 completed、failed、stopped 与 recorded 的总和。没有 recorded 时
显示 `已执行 N 项操作`；包含 recorded / not_executed 时显示中性的 `已汇总 N 项操作`，不把未执行操作称为
已执行。摘要不再分别显示“已完成”“失败”“已停止”或“仅记录”计数。

终态组只显示一段主文案：普通执行为 `已执行 N 项操作`；包含 recorded / not_executed 时继续使用
`已汇总 N 项操作`。摘要主行不追加“全部成功”、失败数量、停止数量或仅记录数量。用户展开组后，每条 Tool
仍显示自己的真实状态，因此摘要精简不得删除、改写或隐藏组内失败、停止和仅记录事实。

## 2. 组级状态图标

活动组的图标继续表达 running 或 waiting，不受已经结算操作的结果影响。终态组按以下优先级派生图标：

1. 只要至少一条 Tool 为 completed，组使用绿色实心圆点；全部 completed 的辅助名称为“全部成功”，混合
   completed 与其他结果时为“含成功操作”。绿色只表示组内存在成功操作，不表示每条操作都成功。
2. 只有全部 Tool 都为 failed 时，组使用红色失败菱形，辅助名称为“全部失败”。
3. 没有 completed 且并非全部 failed 时，若存在 stopped 则使用中性停止菱形，否则使用中性 recorded 圆点；
   失败事实继续保留在组内 Tool 行和辅助名称中，但组级图标不得使用红色。

组展开后，completed、failed、stopped、waiting 与 recorded Tool 行继续使用各自现有状态文案、形状和颜色；
组级归约不向下覆盖单项状态。

## 3. 键盘与辅助技术

组 summary 继续使用原生 disclosure、可见焦点、`aria-live="polite"` 和完整未截断的当前操作名称。终态
summary 的辅助名称包含组级状态，例如“状态：含成功操作”或“状态：全部失败”；状态图标的 `aria-label`
与 `title` 使用同一名称。这样可见摘要可以保持简洁，同时不让颜色成为唯一状态载体。

## 4. 继承的性能边界

组默认收起、完整结果第二级惰性挂载、Managed Blob 按精确 Tool 读取、同一 Drawer DOM 换位和超长结果
最坏路径全部沿用 v20。摘要文案或图标归约不得触发额外 Evidence 读取，也不得把全部 Tool 结果预先挂入 DOM。

## 5. 验收

- 活动组含 3 条 completed、1 条 failed 和 1 条 running 时显示
  `执行中 · <当前操作> · 已执行 4 项操作`，图标仍为 running；
- 3 条全部 completed 的终态组只显示 `已执行 3 项操作`，使用绿色实心圆点，辅助名称为“全部成功”；
- completed、failed 混合的终态组只显示 `已执行 N 项操作`，使用绿色实心圆点，辅助名称为“含成功操作”；
- 全部 failed 的终态组使用红色失败菱形；failed + stopped 或 failed + recorded 且没有 completed 时使用中性图标；
- 展开任一混合组后，所有 Tool 行按原顺序保留自己的真实状态；
- Day/Night、310px/260px Inspector、`1040×700`、200% zoom、reduced motion 与 Forced Colors 继续满足 v20。

## References

- [Run Process Detail Surface v20](run-process-detail-surface-v20.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
