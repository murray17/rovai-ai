---
document_type: ui-component-index
authority: renderer-component-routing
status: accepted
last_updated: 2026-08-27
---

# Rovai AI 复杂 UI 组件

本目录只保存跨版本、Rovai AI 特有且无法由基础视觉语法充分表达的呈现合同。Button、Input、
Dialog、Popover 等基础原子遵守根目录 [`DESIGN.md`](../../../DESIGN.md)，不在这里逐个复制。

| 组件合同 | 适用范围 |
|---|---|
| [App Shell 与统一侧栏](app-shell-navigation.md) | 一级导航、Project/Camp 投影、Quick Chat、设置入口和窗口布局 |
| [Camp 会话工作区](conversation-workspace.md) | 消息、过程 Drawer、终态文件行、Files Changed 卡片/View、Task、Approval、Composer、Inspector、Stop 与关闭等待面 |
| [首次训练与“初次集结”](first-run-onboarding.md) | 三页 mandatory gate、Runtime/模型选择、断点恢复与真实 Quick Chat 的 Draft-only starter |
| [结构化 Mention](structured-mentions.md) | Composer/历史消息的身份 token、Popover、复制粘贴、键盘和选择边界 |
| [应用内提醒与会话未读](notification-center.md) | 暂时隐藏持久中心后的轻量 heads-up、Camp 未读点、精确可见确认与错误恢复 |
| [队员身份与图像](member-identity.md) | stable identity color、portrait/icon、身份入口和降级行为 |
| [会话区文件与文件夹拖放](conversation-drop-zone.md) | Drop target、Drag feedback、目录快照附件卡和响应式边界 |

组件文档拥有结构、信息层级、状态呈现、键盘与焦点行为；领域对象、命令、事务和恢复语义仍由
对应 ADR/Contract 拥有。完整主题值只在 [`themes/`](../themes/README.md) 定义。
