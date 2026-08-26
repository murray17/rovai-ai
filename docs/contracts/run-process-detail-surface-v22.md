---
document_type: contract
contract: run-process-detail-surface-v22
authority: agent-process-live-tail-tool-group
status: accepted
source_version: v1.28
last_updated: 2026-08-26
---

# Run Process Detail Surface v22（Tool 尾组延迟收口）

本合同完整继承 [Run Process Detail Surface v21](run-process-detail-surface-v21.md) 的连续 Tool 分组、
摘要文案、组级状态、两级 disclosure、结果惰性读取与执行台位置边界。v22 收敛运行中摘要的信息密度，
改变 running Run 最后一个 Tool 组在两条 Tool 之间的呈现，并统一组图标与摘要文字的对齐；它不改变 Core
Evidence、Tool identity、chronology 或 Run lifecycle。

## 1. Live-tail 判定

Renderer 已投影的最后一个 process item 若为 Tool 组，且父 Run 的权威状态仍为 `running`、未进入停止提交，
该组是 provisional live tail。组内当前没有 running Tool 不构成收口证据；不得按固定毫秒数防抖，也不得因
下一条 Tool 尚未到达就制造一次终态。

narration、plan 或 diagnostic 出现在组后、父 Run 离开 `running`、停止开始或 Run 进入终态时，live tail
立即结束。若父 Run 为 `waiting` 且组内没有 waiting Tool，组按已结算结果收口，并由现有 Run wait feedback
表达真实等待原因；不得把所有等待原因猜成 Tool 审批。

## 2. 间隙摘要与状态

live tail 内存在 running Tool 时显示 `执行中 · <当前操作>`，当前操作与累计数不同时竞争摘要空间；waiting
Tool 同理显示 `等待审批 · <当前操作>`。当前 Tool 已结算而下一条尚未到达时，摘要显示
`执行中 · 已执行 N 项操作`，不保留上一条指令，也不虚构下一条指令；包含 recorded / not_executed 时使用
`已汇总 N 项操作`。两种状态都使用 running 的蓝色状态标记，且组后不重复挂载通用“正在处理”。

下一条连续 Tool 到达时必须复用同一组 key、同一 disclosure 与用户展开状态，只在原摘要中加入新的当前操作。
真实边界到达后，组只切换一次为 v21 的终态文案和归约图标：有任一 completed 为绿色，只有全部 failed
才为红色，其余无成功结果为中性。

## 3. 布局与视觉对齐

组 summary 继续使用 `16px 类型图标 / 可缩略摘要 / 16px 状态 / 20px disclosure` 四轨。左侧 16px 组图标
与摘要文字共享同一条 16px 垂直中心线；不得用不同的 24px 图标盒与字体 baseline 形成可见上下错位。
底部与 310px/260px Inspector 都保留已经结算的操作总数，长当前操作只在自身弹性轨内省略。

running Tool → live-tail 间隙 → 下一条 running Tool 的过程卡高度必须保持稳定。真实 narration、plan、
diagnostic 或 Run 状态边界可以引入自己的内容，但不得把两条 Tool 之间的短间隙表现为终态加额外 Loading 行。

## 4. 键盘与辅助技术

组 summary 继续使用原生 disclosure、可见焦点、`aria-live="polite"` 与 `aria-atomic="true"`。live-tail
间隙的辅助名称为“执行中；已执行/已汇总 N 项操作”，不朗读不存在的当前指令；组状态图标的辅助名称仍为
“执行中”。组真正收口后恢复 v21 的终态辅助名称。

## 5. 验收

- running Run 的尾组含 3 条 completed、1 条 failed 且当前无 active Tool 时，显示
  `执行中 · 已执行 4 项操作`、running 状态图标且无通用“正在处理”；
- 下一条 Tool 到达后，同一组原位显示 `执行中 · <新操作>`，不重复显示累计数，也不改变 disclosure
  展开状态或焦点；
- narration、plan、diagnostic、waiting/cancelling 或 terminal Run 结束 live tail，组按 v21 只收口一次；
- recorded live tail 使用“已汇总”，不把未执行操作称为已执行；
- 组图标和摘要文字共享 16px 中心线，底部、310px/260px Inspector、Day/Night 与 200% zoom 无错位或横向溢出；
- 完整 Tool 结果继续只在精确 Tool 首次展开后进入 DOM 和 Managed Blob 读取路径。

## References

- [Run Process Detail Surface v21](run-process-detail-surface-v21.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
