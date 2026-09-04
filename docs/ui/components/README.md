---
document_type: ui-component-index
authority: renderer-component-routing
status: accepted
last_updated: 2026-09-04
---

# Rovai AI 复杂 UI 组件

本目录只保存跨版本、Rovai AI 特有且无法由基础视觉语法充分表达的呈现合同。Button、Input、
Dialog、Popover 等基础原子遵守根目录 [`DESIGN.md`](../../../DESIGN.md)，不在这里逐个复制。

| 组件合同 | 适用范围 |
|---|---|
| [App Shell 与统一侧栏](app-shell-navigation.md) | 一级导航、Project/Camp 投影、Quick Chat、设置入口和窗口布局 |
| [Desktop Bootstrap Shell](bootstrap-shell.md) | Full Core ready 前的 authority 状态、重试、诊断、本机主题与偏好降级；不挂载业务空态 |
| [Camp 会话工作区](conversation-workspace.md) | 消息、作者感知附件/图片分区、过程 Drawer、终态文件行、每 Run 文件变化卡片、Task、Approval、Composer、Inspector、Stop 与关闭等待面 |
| [Camp 文件预览区](file-preview.md) | 共享顶栏、Codex 风格文件 Tabs、相对路径行、多类型 Viewer、外部更新、刷新、响应式替换与平台投影 |
| [首次训练与“初次集结”](first-run-onboarding.md) | Full Core ready 后的三页 mandatory gate、Runtime/模型选择、断点恢复与真实 Quick Chat 的 Draft-only starter |
| [结构化 Mention 与 Composer Atom](structured-mentions.md) | 结构化纯文本边界、Member/Skill Atom、局部 Typeahead、IME、Popover、Clipboard、键盘与历史消息投影 |
| [应用内提醒与会话未读](notification-center.md) | 暂时隐藏持久中心后的轻量 heads-up、Camp 未读点、精确可见确认与错误恢复 |
| [队员身份与图像](member-identity.md) | stable identity color、portrait/icon、身份入口和降级行为 |
| [渠道设置](channel-settings.md) | 飞书/钉钉 Provider Tab、Owner 本机的 Developer Identity/OAuth、队员 Bot 发布与审批、官方应用管理链接、Provider-local 绑定诊断、状态和错误交互；不含项目目录或会话绑定操作 |
| [会话区文件与文件夹拖放](conversation-drop-zone.md) | Drop target、Drag feedback、目录快照附件卡和响应式边界 |

组件文档拥有结构、信息层级、状态呈现、键盘与焦点行为；领域对象、命令、事务和恢复语义仍由
对应 ADR/Contract 拥有。完整主题值只在 [`themes/`](../themes/README.md) 定义。
