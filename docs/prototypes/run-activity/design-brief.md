---
document_type: prototype-design-brief
prototype: scheme-c-run-activity
authority: interaction-reference-only
status: accepted
target_version: v0.45
last_updated: 2026-08-07
---

# Scheme C 会话区设计简报

## 目标

在现有 Arctic Dawn 会话区中让用户快速知道“哪些 Run 正在发生”，并在需要时查看某一个
Run 的过程证据，同时不把 Runtime 过程变成第二条聊天记录，不抢走用户对公共消息的阅读焦点。

## 关键状态

| 状态 | 会话区投影 | 用户操作 |
| --- | --- | --- |
| 无活跃 Run | 不显示空 Run 徽标 | 正常发送 |
| 有活跃 Run | Run Pulse 显示数量/chips | 选择 Run，按需展开 Drawer |
| Drawer 已展开 | 显示选中 Run 的状态、Delivery、等待/终态和证据摘要 | 切换 Run、收起、跳回消息 |
| pending Approval | Approval Dock 固定在 Composer 上方 | 在 Dock 或 Inspector Approvals 决定 |
| 活跃 CampTurn | Composer 发送位显示 Stop | Stop 一次 fence 整棵执行树 |
| Drawer 空间不足 | Drawer 收缩为摘要 | Approval Dock 和 Stop 仍可见 |

## 交互不变量

1. 后台 Run 状态更新不得自动打开 Drawer、改变 selected Run、滚动时间线或抢焦点。
2. 选中的终态 Run 保持打开，直到用户关闭或选择另一个 Run。
3. Drawer 没有 Run 级 Stop/Cancel；所有停止都由 Composer 的 CampTurn Stop 发起。
4. Approval Dock 始终位于 Composer 上方，非模态且可键盘操作；Drawer 不遮挡它。
5. 公共 A2A Message 的 Run-origin/Delivery 状态是消息关系的只读入口，不是第二套发送入口。
6. 过程日志使用摘要与证据链接，不用 `aria-live` 逐字播报；状态变化使用可访问文本。

## 视觉取舍

- 沿用 Arctic Dawn Day 的现有 surface、line、brand、state 和 focus Token；
- 保持公共消息流的左对齐阅读轴，不引入竖向执行轨或全屏覆盖层；
- Drawer 是会话区内的浮动/可收起详情面，窄窗口优先保证 Composer、Stop 和 Approval；
- 原型中的图标和色值只用于示意，生产实现必须映射到既有 Token/图标系统。

## 验收场景

- 选择不同 Run Pulse chip，Drawer 内容切换但 URL/Camp/时间线不变；
- 后台状态变化时 Drawer 保持原选择和焦点；
- 收起 Drawer 后 Approval Dock 仍在 Composer 上方；
- 活跃 CampTurn 下点击 Stop 后进入“正在停止…”，不存在第二个 Run stop；
- 键盘可聚焦 Run Pulse、展开/收起 Drawer、返回触发按钮，200% zoom 无遮挡；
- `prefers-reduced-motion` 下不自动滑入/脉冲，但状态文字和图标仍清楚。
