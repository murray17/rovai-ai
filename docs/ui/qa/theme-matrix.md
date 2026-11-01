---
document_type: ui-qa-contract
authority: renderer-theme-verification
status: accepted
last_updated: 2026-10-30
---

# Renderer 主题覆盖矩阵

下表每项均覆盖 `day`、`night`、`horizon`、`classic-red`、`ember`，使用相同生产组件、数据和功能。
`system` 另验日间/夜间解析。不得通过隐藏功能、替换假数据或禁用状态规避检查。

| Surface / state | 重点检查 |
|---|---|
| 首次绘制、System 与主题切换 | 无反色闪烁；Main snapshot 权威；根配色、窗口和 Windows caption controls 同步 |
| Checkbox / Radio / Switch / Range | 默认、选中、hover、disabled；使用当前动作 Token，不回退 OS 蓝色或 Steel 品牌色 |
| 普通功能图标与图标按钮 | 遵循 DESIGN 的图标色彩职责；默认继承控件前景色，实心按钮继承对比文字色；语义图标与组件专用反馈保留各自 Token |
| Portal 菜单、Dialog、Popover、Sheet | 检查实际挂载节点的计算色；动作、选中和文字正确，不依赖页面局部别名 |
| App Shell / Project / Quick Chat | rail、安静选中面、未读、菜单和键盘；不将普通标签染成品牌色 |
| 会话与文件阅读 | 空态、长会话、气泡、代码、Diff、执行台、阅读宽度、宽工件与滚动块 |
| Composer / Mention / Skill / Attachment | Draft、图片/文件分区、十类 artifact、横向浏览、浮层、错误与 disabled |
| Agent Process / Task / Inspector / Approval | running、terminal、recovery blocked、长证据、遮挡、danger/attention 语义 |
| 队员 / 通用设置 / 新对话 | 表单、选择队员、保存、创建、权限开关、头像裁切与队员浮层 |
| Memory | 内容与浮层使用无彩色 `--memory-*` 家族；共享侧栏仍跟随 App 主题 |
| Automation | 操作跟随当前主题 action 家族，选中与悬浮用中性表面；保留独立滚动块 |
| Runtime Monitoring | Empty/Partial/Populated/Stale/Error、Coverage、未知值与长表格 |
| 提醒与关闭等待 | heads-up、后台暂存、不抢焦点；关闭进度与条件取消说明，无操作按钮 |
| 活动 UI 中切换配色 | focus、Draft、选择、滚动、Dialog 和页面挂载保持不变 |

## Viewport and environment matrix

- `1040×700`：无整页横向滚动或被遮挡的主要操作。
- `1440×920`：默认桌面基准。
- `2560×1440`：prose/artifact/wide/Composer 层级清楚；Composer 上限 `1440px`，不拉宽时间线、Dock 或执行台。
- 200% zoom：Dialog、Dock、菜单、Popover 和 Inspector 可达。
- Reduced motion：保留状态，不依赖动画传意。
- Windows display scale `100/125/150/200%`：标题条、WCO、菜单、App 顶行与内容不重叠；
  多屏切换读取系统 WCO environment value，不以固定像素伪造 caption 尺寸。
- Forced Colors / High Contrast：系统色、选中、禁用与错误保留非颜色语义，遵循[无障碍基线](accessibility.md)。

## Automated and visual evidence

自动化覆盖完整 Token、对比度、偏好解析、首次绘制和同组件映射。控件回归检查实际计算色，
同时覆盖普通容器与 Portal，不能只断言 Token 已定义。

真实 App 验收覆盖排版、遮挡、键盘及宿主系统主题切换。Windows WCO、原生菜单、DPI、High Contrast、
NVDA 与 IME 由真实客户端 OS 验证，不能用 Server CI 或浏览器模拟替代。
已有测试只覆盖日间/夜间时，记录该范围并补足其他配色；不得将模式覆盖写成全部配色已通过。
实施结论和证据归对应版本记录，本文只定义要求。
