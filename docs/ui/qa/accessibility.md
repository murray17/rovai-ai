---
document_type: ui-qa-contract
authority: renderer-accessibility
status: accepted
last_updated: 2026-09-08
---

# Renderer 无障碍基线

## Contrast and non-color meaning

- 对比度目标：普通文字至少 4.5:1；控件边界与非文字状态至少 3:1。当前产品明确取消额外焦点装饰，因此不宣称满足 WCAG 的 Focus Visible 条款或完整 AA。
- 状态必须结合文字、图标、形状或稳定位置，不能只依赖颜色。
- 八组身份色在实际 Day/Night surface 上验证；身份色不承担状态语义。
- Diff 同时使用 `+/-`、行号或结构标签；错误与恢复说明保留可读正文和下一步。

## Keyboard and focus

- 主要操作完全可键盘完成，Focus 顺序与视觉顺序一致，Icon-only 控件有可访问名称。
- 全局及局部不添加 Focus 外框、光晕、仅聚焦时的边线或查找输入下划线。保留 DOM focus、输入光标、IME、Tab 与方向键操作；禁止以全局 blur 或删除 tabIndex 代替样式清理。
- Tab 使用手动激活与方向键、Home/End。List selection、Switch、Menu、Disclosure 使用正确语义，
  不以 clickable `div` 模拟。
- 可点击目标至少 `28×28px`，主要操作优先 32px；Hover 不是发现操作的唯一方式。

## Dialogs, drawers and popovers

模态 Radix Dialog/Drawer 负责 focus trap 与 Esc；关闭时不额外将焦点送回入口按钮。提交中可阻止关闭，但必须说明
忙碌状态。非模态锚定 Popover 不设 focus trap，保留 Esc、点击外部与必要输入定位。原有运行配置下拉框交互不重做。
Approval Dock 是非模态且不得遮住 Composer/Stop。

## Announcements and motion

完成的非阻塞反馈可用 `aria-live="polite"` Toast；错误、审批、身份详情和恢复不能只靠短暂 Toast。
流式 AgentRun 不逐 token 播报。动效限于 120–180ms opacity 或 2–4px 位移，遵守
`prefers-reduced-motion`；禁止脉冲依赖、粒子、视差、大幅弹簧和全局 `transition: all`。

## States, zoom and failure recovery

一级 surface 覆盖 Loading、Empty、Partial、Error、Disabled、Submitting 与 Recovery。局部失败
保留 Header、导航、Draft、选择、滚动和焦点；不确定状态必须说明对象、最后已知事实、未知范围和
下一步。按[主题矩阵](theme-matrix.md)在最小窗口、2K、200% zoom 和双主题中检查所有路径。

## Host assistive technology

- macOS 真实验收保留 VoiceOver 与系统外观切换；Windows 真实验收覆盖 NVDA 的浏览/表单模式、系统
  High Contrast 与 CSS Forced Colors。固定 Server CI 或浏览器模拟不能代替客户端 OS 证据。
- `forced-colors: active` 下使用系统色与可见边界，不以背景图、阴影或身份色保留关键含义；原生标题栏仍由
  Windows 拥有，Renderer 不覆盖 caption button 的系统对比度。
- 中文 IME composition 期间 Enter、Space、方向键和候选选择不得触发发送、保存、Mention 选择或快捷键；
  只在 `compositionend` 后按普通键盘合同处理。
- Windows 100/125/150/200% display scale、多屏不同 DPI 和 200% page zoom 都要保持输入光标、Dialog、
  Popover、菜单与主要操作可见可达。
