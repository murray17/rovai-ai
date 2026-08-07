---
document_type: prototype-readme
prototype: scheme-c-run-activity
status: reference
target_version: v0.45
last_updated: 2026-08-07
---

# v0.45 Scheme C 会话区原型

这个目录把用户提供的 `rovai-run-activity-layout-options.html` 放入项目，作为布局探索的
可追溯输入，并提供只取会话区关键交互的 Scheme C 版本：

- [Scheme C 会话区焦点原型](scheme-c-conversation.html)；
- [布局探索原始来源](source-layout-options.html)；
- [设计简报与验收边界](design-brief.md)。

## 使用边界

原型只帮助评审 Run Pulse、Execution Drawer、公共消息 Run-origin 入口、Approval Dock 和
Composer Stop 的层级/键盘行为。它不是生产代码、领域状态真源、IPC schema、Runtime Activity
实现或视觉 Token 来源。生产实现必须继续使用现有 Arctic Dawn App Shell、导航、Token、
Composer、Approval、断点和无障碍合同。

原始来源中以下内容明确不采纳：

- demo Agent/Run/Project 数据；
- 原型专用顶部布局切换条和风险标签；
- 右侧 Inspector Activity 页；
- 每个 Run 的“停止”按钮；
- 后台事件自动打开或切换 Drawer 的假逻辑。

`scheme-c-conversation.html` 使用内置 demo 状态仅演示交互，不产生 Core 事件，也不保存
浏览器数据。点击 Run Pulse chip 会选择 Drawer 的 Run；“收起/展开过程”只改变本地展示；
Composer 在有活跃 CampTurn 时展示 Stop，并明确说明这是 CampTurn 级操作。
