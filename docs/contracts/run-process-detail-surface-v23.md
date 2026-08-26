---
document_type: contract
contract: run-process-detail-surface-v23
authority: agent-process-live-tail-latest-command
status: accepted
source_version: v1.28
last_updated: 2026-08-26
---

# Run Process Detail Surface v23（Tool 间隙保留最近指令）

本合同完整继承 [Run Process Detail Surface v22](run-process-detail-surface-v22.md) 的连续 Tool 分组、live-tail
判定与收口边界、组级状态、两级 disclosure、结果惰性读取、执行台位置和视觉对齐。v23 只改变 running
Run 最后一个 Tool 组在两条 Tool 之间的摘要：不再显示已结算总数，改为持续保留最近一条具体指令。
它不改变 Core Evidence、Tool identity、chronology、Tool 终态或 Run lifecycle。

## 1. Live-tail 与最近指令

v22 的 live-tail 判定和真实收口边界保持不变。live tail 内存在 running Tool 时显示
`执行中 · <当前指令>`；存在 waiting Tool 时显示 `等待审批 · <当前指令>`。当前 Tool 已结算而下一条尚未
到达时，摘要必须显示 `执行中 · <最近一条指令>`，其中“最近一条指令”取该连续 Tool 组最后一个已投影
Tool 的完整安全标题。该间隙态不得回退为“已执行/已汇总 N 项操作”，也不得在组后重复“正在处理”。

间隙态的“执行中”表达父 Run 与 provisional live tail 仍在运行，不把精确 Tool 行的 completed、failed、
stopped 或 recorded 状态改写为 running。用户展开组后仍能看到每条 Tool 的真实状态。用户已确认摘要优先
保持最近的具体执行上下文，因此间隙态不额外插入“最近”“刚完成”等限定词。

下一条连续 Tool 到达时必须复用同一组 key、同一 disclosure 与用户展开状态，只把摘要中的标题原位更新为
新 Tool。narration、plan、diagnostic、waiting/cancelling 或 Run 终态形成真实边界后，组恢复 v21 的终态
累计文案和归约图标。

## 2. 布局与辅助技术

活动摘要始终只包含状态主文案和一条具体指令，不追加累计数。长指令继续只在现有弹性名称轨内单行省略，
完整安全标题保留在 `title` 与辅助名称中；底部、310px/260px Inspector、Day/Night 和 200% zoom 共用同一
结构。running Tool → live-tail 间隙 → 下一条 running Tool 的卡片高度必须保持稳定。

组 summary 继续使用原生 disclosure、可见焦点、`aria-live="polite"` 与 `aria-atomic="true"`。live-tail
间隙的辅助名称为“执行中：<最近一条指令>”，组状态图标的辅助名称仍为“执行中”。

## 3. 验收

- running Run 的尾组含 3 条 completed、最后一条标题为 `pnpm test` 且当前无 active Tool 时，显示
  `执行中 · pnpm test`、running 状态图标且无累计数或通用“正在处理”；
- 最后一条 Tool 为 failed、stopped 或 recorded 时，同样保留其具体安全标题，展开行继续显示真实状态；
- 下一条 Tool 到达后，同一组原位显示 `执行中 · <新指令>`，不改变 disclosure 展开状态或焦点；
- narration、plan、diagnostic、waiting/cancelling 或 terminal Run 结束 live tail，组按 v21 只收口一次；
- 完整 Tool 结果继续只在精确 Tool 首次展开后进入 DOM 和 Managed Blob 读取路径。

## References

- [Run Process Detail Surface v22](run-process-detail-surface-v22.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
