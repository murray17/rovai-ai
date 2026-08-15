---
document_type: renderer-contract
contract: run-process-detail-surface-v6
authority: agent-process-detail-placement-and-recovery-surface
status: accepted
last_updated: 2026-08-15
---

# Run Process Detail Surface v6（底部与 Inspector 承载位置）

本合同继承 [Run Process Detail Surface v5](run-process-detail-surface-v5.md) 的 Agent 级连续过程、
Recovery Blocker、planned-shutdown 终态与 unsettled-effect 诚实投影，并替代 v5 作为当前 Renderer
入口。v6 只增加同一执行 console 的用户位置切换与容器适配。

## 1. Placement 状态

每个 mounted Camp Workspace 有一个 Renderer 瞬时 placement：

```text
bottom | inspector
```

初值固定为 `bottom`，不写 Core、SQLite、IPC 或跨重启偏好。切换位置不得改变 selected Agent、focused
AgentRun、已经加载的有界 Evidence 或 Core Snapshot；新 Camp workspace 重新从 `bottom` 开始。

`bottom` 使用既有横向 Run Pulse 和唯一可调高度详情。`inspector` 不同时保留底部副本，而是在既有
310px / compact 260px Inspector 中增加“执行”Tab。移动到右侧必须显示 Inspector 并激活该 Tab；移回
底部恢复切换前最后一个“任务 / 队员”基础 Tab。

## 2. Agent selector 与详情

两个位置对 Agent 过程使用相同 CampMember 排序、preferred Run、状态文案和 `agentId` selection。
底部 selector 保持横向滚动；Inspector selector 使用全宽纵向行，最多约四行高度，超出后只在列表内部
纵向滚动。状态必须包含文字和既有 tone，不以身份色表达运行状态。

详情仍只显示 selected Agent 的全部独立 Run stage、Delivery、Evidence、Recovery 和终态事实。Inspector
详情占据 selector 下方剩余高度并独立滚动；不显示 resize separator，也不读取或改写底部高度偏好。
底部详情继续提供现有 pointer/keyboard resize、Session 内高度恢复和 sticky-latest 行为。

未选择 Agent 时，Inspector Execution Tab 保留列表并显示具名空详情状态。收起详情只清除 selection，
不改变 placement 或移除 Execution Tab。

## 3. 导航、焦点与唯一性

Task related execution、停止结果和世界地图入口在 `inspector` placement 下必须显示 Inspector、激活
Execution Tab，并打开精确 Agent/Run。普通 Runtime、A2A、Snapshot refresh 与恢复事件仍不得自动打开
详情、切换 Agent/Tab、滚动或抢 Composer 焦点。

用户显式发送产生新 AgentRun 时，若当前没有在可见执行 surface 中查看另一个 non-terminal Run，Renderer
自动打开并聚焦回执中的首个 Run。唯一抑制场景是用户正在可见的“任务”Tab 新建任务表单中输入：此时消费
本次自动聚焦请求但保留任务草稿，不在离开表单后补跳。仅浏览任务列表、编辑既有任务或查看队员不构成
抑制；右侧隐藏的旧 Run selection 也不得被误判为当前正在查看执行。

位置按钮至少 28×28px，具有动作型可访问名称。切换后焦点进入另一位置的对应 placement 控件；关闭或
在详情内按 Escape 时，焦点返回仍连接的真实 Agent selector，无法连接时返回当前 placement 控件。
Tabs 继续使用 manual activation 与方向键/Home/End。

任一时刻 DOM 中只能存在一组可交互 `.run-pulse-chip[data-agent-id]` 和一个
`#agent-execution-drawer`。隐藏 Inspector 只隐藏其当前承载 surface；再次显示保持 placement、Tab、
Agent 与 Run selection。

## 4. 不变边界

v5 的 Agent 级 grouping、Run 边界、Evidence 按需读取、Tool 输出复制、Recovery Blocker、planned
shutdown、unsettled external effects、唯一 CampTurn Stop 和无 Agent/Run mutation 继续有效。Placement
不创建新领域对象、不改变 Core contract，也不授权第二条 audit/process 时间线。
