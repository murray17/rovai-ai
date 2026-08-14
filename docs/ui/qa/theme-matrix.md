---
document_type: ui-qa-contract
authority: renderer-theme-verification
status: accepted
last_updated: 2026-08-13
---

# Renderer 主题覆盖矩阵

Porcelain Day 与 Steel Night 必须在同一生产组件、数据和功能上逐项通过。主题不能通过隐藏功能、
替换假数据或禁用状态来换取视觉一致。

| Surface / state | Day | Night | 重点检查 |
|---|---|---|---|
| 首次绘制与 System 解析 | Required | Required | 无反色闪烁；Main snapshot 最终权威 |
| App Shell / Project / Quick Chat | Required | Required | rail、选中、未读、菜单和焦点 |
| 空 Camp 与长会话 | Required | Required | 阅读宽度、宽工件、复制入口、滚动 |
| Composer / Mention / Skill / Attachment | Required | Required | Draft 不丢失；Popover、候选、错误和 disabled |
| Agent Process Drawer | Required | Required | running、terminal、recovery blocked、长证据 |
| Task / Inspector / Approval Dock | Required | Required | layering、focus、danger/attention 语义 |
| 队员 / Memory / Settings | Required | Required | identity、evidence、表单、列表、partial/recovery |
| New Conversation / Reminders | Required | Required | Dialog/heads-up、后台暂存、focus 不被抢占 |
| Planned shutdown | Required | Required | modal 文案、进度、无操作按钮、未知效果警告 |
| 主题切换中的活动 UI | Required | Required | focus、Draft、选择、滚动、Dialog 不改变 |

## Viewport and environment matrix

- `1040×700`: 最小窗口，无整页横向滚动或被遮挡的主要操作。
- `1440×920`: 默认桌面基准。
- `2560×1440`: prose/artifact/wide 三种宽度仍有清楚层级。
- 200% zoom: Dialog、Dock、菜单、Popover 和 Inspector 仍可达。
- reduced motion: 状态仍清楚，不依赖动画传达。

## Automated and visual evidence

自动化至少覆盖完整 Token、两主题对比度、偏好解析、首次绘制和同组件映射；真实 App 验收
补足排版、遮挡、焦点、macOS 系统主题切换和截图。版本是否完成只由对应当前版本实施计划与
可复现证据判断，本文 `accepted` 不代表某次实现自动完成。
