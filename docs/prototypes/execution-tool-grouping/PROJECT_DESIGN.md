---
document_type: prototype-design-input
status: design-review
last_updated: 2026-08-25
---

# 连续 Tool 聚合设计输入

## Job and mode

Operate 模式。用户在长时间 AgentRun 中首先要确认“现在正在做什么、有没有异常”，只有审计或排错时
才需要查看全部 Tool 和单条完整结果。聚合必须降低默认信息密度，同时保留准确 chronology、状态、
公开证据与既有恢复动作。

## 还原基线

本稿把生产 Renderer 视为母版，只替换连续 Tool 段的呈现节点：

- App Shell 保持 `270px rail / 50px top row / flexible workspace`；
- 底部 placement 保留右侧普通 Inspector，主列依次承载会话、Run Pulse、同一个 ExecutionDrawer 与 Composer；
- 右侧 placement 从底部移除 Run Pulse 和 Drawer，在既有 `310px / compact 260px` Inspector 中增加首个
  “执行”Tab，并移动同一个 Drawer DOM；
- Drawer header、Agent 入口、Run stage、Tool 四轨、证据 surface、Day/Night 与状态色均沿用生产结构；
- 评审控制条属于原型外壳，不进入生产 Renderer。

## 三个方案

| 方案 | 活动态 | 终态 | 取舍 |
| --- | --- | --- | --- |
| A 当前操作（推荐） | `执行中 · {currentCommand}`，末尾低强调度显示已完成数量 | `已执行 N 项操作 · 全部成功/1 项失败` | 与现有单条 Tool 四轨最接近；底部和窄 Inspector 都能先读到当前命令 |
| B 状态账本 | 第一行状态与计数，第二行完整视觉省略命令 | 第二行显示真实 Tool 类型构成 | 进度与构成更明确，但每组更高、长 Run 中更占空间 |
| C 最近轨迹 | 第一行当前命令，第二行最近三项轨迹 | 最近轨迹保留到组关闭前 | 监督感最强；在 Inspector 中最吵，适合作为比较上限而非默认 |

推荐 A。它把用户最关心的当前动作放在唯一标题轨，状态点与 disclosure 仍处于生产四轨位置；计数是
辅助信息，310px Inspector 中可以先隐藏计数而不牺牲当前命令。

## Grouping semantics

- 输入是既有 `ExecutionProgressItem[]` 有序 Renderer 投影。
- 每个最大连续 `kind=tool` 序列派生一个 `ToolActivityGroup` 展示节点。
- narration、plan、diagnostic、公开 failure、recovery blocker 和 Run 边界终止当前组。
- 派生组 key 由首尾 canonical Tool key 组成；不生成 Core ID，不合并 Tool lifecycle。
- 活动态选择最后一条 `running` 或 `waiting` Tool；没有非终态 Tool 时按真实 outcome 汇总。

## Interaction contract

- Tool 组默认关闭；summary 点击或键盘激活后展开该组全部 Tool 行。
- 每条 Tool 仍保持 `16px 类型图标 / minmax(0, 1fr) 标题 / 16px 状态 / 20px disclosure`。
- 展开组不批量展开或读取结果；单条 Tool disclosure 仍是第二层，完整结果按既有边界按需出现。
- 用户手动打开组后，新 Tool 只原位追加并更新 summary，不自动折叠、不抢焦点。
- Run 终态不自动关闭用户已经打开的组。
- 组内存在 running / waiting Tool 时，组 summary 承担活动反馈，不在下面重复“正在处理”。
- 组结束而父 Run 继续时，通用处理行重新出现。
- 位置切换移动同一个 Drawer DOM，保留组、Tool 与结果 disclosure；结果 Escape 返回精确 Tool summary。

## 状态文案

| 状态 | A 方案主文案 | 辅助信息 |
| --- | --- | --- |
| running | `执行中 · {currentTitle}` | `{completedCount} 项已完成` |
| waiting | `等待审批 · {currentTitle}` | `{completedCount} 项已完成` |
| completed | `已执行 {totalCount} 项操作` | `全部成功` |
| failed | `已执行 {totalCount} 项操作` | `{failedCount} 项失败` |
| stopped | `已执行 {totalCount} 项操作` | `{stoppedCount} 项已停止` |
| recorded | `已记录 {totalCount} 项操作` | 不推断成功 |

纯 Shell 组在生产实现时可以将终态收束为“运行了 N 条指令”，混合域继续使用“已执行 N 项操作”。

## Layout, accessibility and performance

- 底部 A 保持一行；Inspector 优先保留状态与当前命令，低优先计数可以隐藏。
- 状态同时使用文字、颜色与非颜色形状；summary 使用原生 `details/summary` 名称计算。
- 独立 polite live region 只播报新事件和模式变化，不把整组 summary 设为 live。
- 结果区保持具名 `role=region`、键盘滚动与 Escape 返回语义。
- 关闭组时其完整结果不参与可见布局；若用户展开组与超长结果后仍发生换位卡顿，再单独评估分块结果查看器。

## Anti-goals

- 不创建新 Core Process、Evidence schema、Tool identity 或持久化分组。
- 不跨叙述、计划、诊断、Recovery、AgentRun 或队员合并。
- 不用组展开代替 Tool 结果二次展开。
- 不把失败、停止、等待审批或仅记录统一包装成“完成”。
- 不借原型重做 App Shell、Inspector、Drawer 或 Rovai AI 视觉世界。
