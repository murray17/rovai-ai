# Rovai AI · Steel Night

## 设计判断

夜间模式采用 **Steel Night**，以冷石墨作为结构骨架，低饱和钢蓝只承担选择、焦点、主操作与关键结构锚点。它延续 Rovai 的 Steel 品牌语义，但不机械反转 Day，也不借用 DevTools 式纯黑、霓虹高亮或密集仪表盘气质。

这次由用户明确授权我判断风格与覆盖范围，因此没有追加 taste/scope 确认。参考只用于校准完成度：吸收 Linear 的亮度层级与精确交互、Notion 的安静阅读面；Rovai 自身功能合同和 Arctic Dawn 结构优先。

## 目标体验

- 长时间协作时安静、克制，文字是第一层，容器退到第二层。
- 状态能够快速扫读，但不靠大面积彩色背景制造注意力。
- 页面之间共享同一套壳层、密度、分割线和焦点反馈。
- 高风险、审批与恢复阻塞在正确的业务位置出现，而不是混入普通侧栏标签。

## 视觉语言

- Canvas：`#0D1114`
- Conversation：`#181D21`
- Raised Surface：`#1B2227`
- Primary Ink：`#E7ECEF`
- Muted Ink：`#ABB5BC`
- Steel：`#7897AE`
- Steel Strong：`#B1C8D8`
- Steel Soft：`#22303A`
- 成功、提醒、危险、信息保持独立语义色，不复用 Steel。
- 大圆角、渐变光晕和阴影只用于真正浮起的 Dialog / Drawer；普通页面依靠亮度与 1px 分割线分层。
- Camp 消息采用开放阅读面，正文不放进聊天气泡。

## 页面覆盖

| Surface | 原型覆盖 | 关键合同 |
| --- | --- | --- |
| App Shell | 完整 | 270px 统一侧栏、项目层级、通知、设置入口 |
| Quick Chat | 完整 | 启动页无 Composer；新对话、选择目录、最近 Camp |
| Camp | 完整 | 开放阅读流、A2A footer、任务行、执行台、Composer |
| Inspector | 完整 | 仅 Tasks / Members；任务第一行可操作 |
| Approval Dock | 完整 | 只在 Composer 正上方；允许一次 / 拒绝 |
| Agent Process | 完整 | Agent 级入口、连续 AgentRun、证据展开、恢复阻塞 |
| Members | 完整 | 名册、身份详情、Runtime、在队状态、记忆能力、危险操作 |
| Memory | 完整 | 范围、治理筛选、检索、详情、Revision、提案 Drawer |
| Settings / General | 完整 | 启动、新对话默认值、窗口行为 |
| Settings / Appearance | 完整 | Steel Night 主题与 token 样例 |
| Settings / Notifications | 完整 | 浮层偏好和持久边界 |
| Settings / Skill | 完整 | Library、导入、启停、生效组 |
| Settings / MCP | 完整 | Server、导入、Assignment、高权限确认 |
| Settings / Agent Runtime | 完整 | Runtime 产品与修复入口 |
| Settings / Diagnostics | 完整 | 诊断摘要、日志、修复动作 |
| Overlays | 完整 | 新对话、跳转、Mention、通知、记忆提案、编辑 Dialog |

## 交互原则

- Quick Chat 文件夹点击同时切换到 Quick Chat 首页；最近项进入 Camp。
- Settings 使用替换式侧栏，返回后恢复来源页面。
- Inspector、执行台与审批各自承担单一职责，不互相复制内容。
- `recovery_blocked` 显示为“结果待确认”，用户查看证据后显式结束运行。
- 原型中的保存、删除、导入和权限动作只给本地反馈，不写入 Main / Core / Desktop Shell。

## 可访问性与窗口基准

- 基准视口：1440×920。
- 最小视口：1040×700，无页面级水平溢出，Composer 和 Inspector 保持可用。
- 所有主文字、次文字、Steel 主按钮与语义状态配色按 WCAG AA 对比度检查。
- 键盘焦点使用 `#8FB3CB` 的 2px focus ring；Tab、Dialog、Drawer 和菜单保留语义角色。
- 尊重 `prefers-reduced-motion`。

## 验收结果

- 1440×920 与 1040×700 均完成实际浏览器截图检查。
- Quick Chat、Camp、Members、Memory、7 个 Settings 页面及关键 Overlay 完成点击巡检。
- 浏览器控制台错误：0。
- 核心文本/背景对比度：5.62:1–14.86:1，全部通过 AA。

## 生产落地

2026-08-12 已将方向落入 Desktop 生产界面，而不是复用原型 DOM：

- `system | day | night` 分别驱动 Electron `nativeTheme` 的 `system | light | dark`，首帧与后续系统切换一致；
- Porcelain Day 的现有 Token、功能状态和交互合同保留，Steel Night 只通过根级语义 Token 切换；
- Skill、MCP 与成员继续按稳定 ID 映射 `identity-1…8`，Night 使用对应的高亮度身份色，不收敛成 Steel 单色；
- Day/Night 的正文、状态、Diff、Evidence 与身份色均加入 AA 对比度门禁；
- Packaged App 已覆盖 Quick Chat、Camp、Members、Memory、全部 Settings、关键 Dialog/Drawer、1040×700 与 200% 缩放实机验收。
