---
document_type: ui-component-contract
authority: renderer-automation-workspace
status: accepted
last_updated: 2026-09-05
---

# Automation 工作区

## 一级入口与构图

统一侧栏在队员之后、记忆之前提供“定时任务”一级入口。入口不依赖当前 Camp，进入前仍经过现有 Camp leave guard。
工作区使用与队员页一致的固定拖拽带和两列关系：左侧 260px 任务列表，右侧编辑器内含表单与紧凑运行摘要；小窗口下列表和
编辑器按顺序纵向排列，主要操作保持可见。

左栏顶部提供“新建任务”，随后按更新时间列出任务名称、计划摘要和启用状态。工作区沿 Core cursor 读取全部分页，计数不会
把首批结果伪装成完整列表。选中项同时使用当前行状态和 `aria-current`；空列表解释任务会在 App 运行且设备唤醒时触发，
不展示虚构样例。

## 创建与编辑

创建态可选择三个轻量模板之一：Issue / PR 巡检、每周进展和发布说明。模板预填名称、Prompt 与计划，用户仍需确认队员和项目。
名称可留空，由 Core 从 Prompt 派生。表单包含：名称、Prompt、队员、项目、计划类型、计划参数和飞书/钉钉通知。

已创建定义采用低频自动保存：用户输入后约 650ms 提交完整变化，就地显示等待保存、保存中、已保存、失败和版本冲突；
失败保留草稿并提供重试。立即运行、切换任务、新建、关闭、启用或删除之前必须先 flush 当前草稿，避免动作使用用户尚未
保存的旧配置。版本冲突保留当前草稿，并让用户明确选择“重新载入”或“保留草稿并重试”，不静默覆盖。

删除使用同页两步确认。关闭只禁止未来领取，已运行项继续收口。一次性任务被消费后读取到关闭状态，界面不伪装成仍会
再次触发。

## 状态与结果

运行摘要显示下次运行和最近一次运行。核心标签为运行中、正在停止、已完成、失败、已跳过；跳过原因在详情中区分
“错过触发时间”和“已有运行”。通知状态独立显示，因此成功运行可以呈现“运行成功 · 通知失败”。

有 `campId` 时提供“打开结果会话”，复用 App 的既有 Camp activation，不建立 Automation 专用结果阅读器。运行失败、
无结果和未创建 Camp 的跳过项不显示无效入口。

## 可访问性与主题

所有表单控件有持久 label，计划参数仅在对应类型下出现；通知组合使用 fieldset/legend。任务行、模板和操作均可键盘触发，
焦点遵循全局可见 focus ring。状态不能只依靠颜色；Day/Night 只使用现有语义 token，不增加主题专属业务结构。

## References

- [App Shell 与统一侧栏](app-shell-navigation.md)
- [Scheduled Automation v1](../../contracts/scheduled-automation-v1.md)
- [Scheduled Automation Architecture](../../architecture/scheduled-automation.md)
- [Rovai AI Design](../../../DESIGN.md)
