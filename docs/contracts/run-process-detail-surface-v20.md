---
document_type: contract
contract: run-process-detail-surface-v20
authority: agent-process-tool-grouping
status: accepted
source_version: v1.28
last_updated: 2026-08-25
---

# Run Process Detail Surface v20（连续 Tool 聚合）

本合同完整继承 [Run Process Detail Surface v19](run-process-detail-surface-v19.md) 的执行台位置、完整 Tool
chronology、公开命令、结果读取、停止、Runtime retry 与终态语义。v20 只改变 Renderer 中连续 Tool 的默认
呈现层级，不创建新的 Core Process、Tool identity 或 Evidence 归属。

## 1. 分组边界

Renderer 在同一 AgentRun 内把最大连续的 Tool items 派生为一个 Tool 组。narration、plan 与 diagnostic
都会结束当前组；不得跨 AgentRun、跨队员或跨这些非 Tool items 合并。组展开后必须按原顺序显示全部
Tool 行，不裁剪较早操作，也不改写任何 Tool 的 identity、状态或详情。

## 2. 摘要与状态

Tool 组默认收起。存在 running 或 waiting Tool 时，摘要显示最后一条非终态操作、对应的“执行中”或
“等待审批”，以及已完成、失败、停止或仅记录的真实计数；此时组摘要承担活动反馈，不在组后重复一条
通用“正在处理”。组已经结束但父 Run 仍继续时，通用处理提示才重新出现。

终态组显示“已执行 N 项操作”；包含 `recorded / not_executed` 时使用中性的“已汇总 N 项操作”。失败、
停止和仅记录必须分别进入摘要，不能统一写成成功。新 Tool 只原位更新组摘要；用户手动展开后保持展开，
组完成时不自动收起、不抢焦点。

## 3. 两级 disclosure 与性能边界

点击 Tool 组只展开全部 Tool summary；单条 Tool 的完整公开结果仍由第二级 disclosure 独立打开。完整
结果区域在该 Tool 首次展开前不进入 Renderer DOM，Managed Blob 也只在这一刻读取。首次打开后，结果的
加载状态、内容、Tool disclosure 与滚动区域在当前 Drawer/Agent selection session 内保持；收起外层组时
其后代不参与布局，重新展开仍保留用户状态。

底部与 Inspector 继续移动同一个 Drawer DOM，Tool 组和已打开结果的 identity 不因换位重建。组收起时，
宽度变化只需布局摘要；若用户同时保持组与超长结果展开，完整结果仍按 v19 的换行合同参与重排，v20
不把该最坏情况误报为虚拟化。terminal Run 的 Evidence history 仍只在用户打开精确 Run 后读取，
non-terminal Run 的完整 Evidence open projection 不变。

## 4. 键盘与辅助技术

组 summary 使用原生 disclosure 键盘语义和可见焦点。摘要的辅助技术名称包含未视觉截断的当前操作与真实
计数，状态同时使用形状、文本名称和主题语义色。单条结果区域继续支持 Arrow、Page Up/Down、Space、
Home/End；Escape 返回对应 Tool summary，而不是跳过 Tool 层直接返回组 summary。

## 5. 验收

- `Tool → Tool → narration → Tool` 派生为两个组，展开后的 Tool 顺序与 identity 完整保留；
- running、waiting、succeeded、failed、cancelled 与 recorded 组摘要均诚实，活动组后不重复“正在处理”；
- 默认收起时不挂载任何完整结果 region；首次打开精确 Tool 才显示本地结果或读取 Managed Blob；
- 新 Tool 与组终态更新不改变用户的展开状态或焦点；
- 同一个 Drawer 在底部与 Inspector 之间移动后保持组、Tool、结果和阅读状态；
- Day/Night、310px/260px Inspector、`1040×700`、200% zoom、reduced motion 与 Forced Colors 无页面级横向溢出。

## References

- [Run Process Detail Surface v19](run-process-detail-surface-v19.md)
- [Camp Open Projection v6](camp-open-projection-v6.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
