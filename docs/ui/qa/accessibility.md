---
document_type: ui-qa-contract
authority: renderer-accessibility
status: accepted
last_updated: 2026-08-13
---

# Renderer 无障碍基线

## Contrast and non-color meaning

- 目标 WCAG 2.2 AA：普通文字至少 4.5:1；控件边界、Focus 与非文字状态至少 3:1。
- 状态必须结合文字、图标、形状或稳定位置，不能只依赖颜色。
- 八组身份色在实际 Day/Night surface 上验证；身份色不承担状态语义。
- Diff 同时使用 `+/-`、行号或结构标签；错误与恢复说明保留可读正文和下一步。

## Keyboard and focus

- 主要操作完全可键盘完成，Focus 顺序与视觉顺序一致，Icon-only 控件有可访问名称。
- 全局 `focus-visible` 使用 2px `--focus` 和 2px offset；局部内描边必须提供同等可见性，且
  不被 sticky、overflow、Drawer 或 Dock 裁切。
- Tab 使用手动激活与方向键、Home/End。List selection、Switch、Menu、Disclosure 使用正确语义，
  不以 clickable `div` 模拟。
- 可点击目标至少 `28×28px`，主要操作优先 32px；Hover 不是发现操作的唯一方式。

## Dialogs, drawers and popovers

模态 Radix Dialog/Drawer 负责 focus trap、Esc 和 focus return；提交中可阻止关闭，但必须说明
忙碌状态。非模态锚定 Popover 不设 focus trap，按局部合同处理 Esc、点击外部与焦点返回。
Approval Dock 是非模态且不得遮住 Composer/Stop。

## Announcements and motion

完成的非阻塞反馈可用 `aria-live="polite"` Toast；错误、审批、身份详情和恢复不能只靠短暂 Toast。
流式 AgentRun 不逐 token 播报。动效限于 120–180ms opacity 或 2–4px 位移，遵守
`prefers-reduced-motion`；禁止脉冲依赖、粒子、视差、大幅弹簧和全局 `transition: all`。

## States, zoom and failure recovery

一级 surface 覆盖 Loading、Empty、Partial、Error、Disabled、Submitting 与 Recovery。局部失败
保留 Header、导航、Draft、选择、滚动和焦点；不确定状态必须说明对象、最后已知事实、未知范围和
下一步。按[主题矩阵](theme-matrix.md)在最小窗口、2K、200% zoom 和双主题中检查所有路径。
