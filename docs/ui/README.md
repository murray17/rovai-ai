---
document_type: ui-style-index
authority: renderer-ui
status: accepted
design_direction: meridian
last_updated: 2026-07-29
---

# Rovai-ai UI 规范

本文是 Renderer UI/UX 工作的稳定入口。任何修改
`apps/desktop/src/renderer/**` 的任务都必须先阅读本文；涉及主题、共享样式、
组件外观、身份色或无障碍时，再阅读
[Meridian 详细规范](meridian.md)。

当前双主题迁移的版本范围、实施状态与验收口径见
[v0.07](../versions/v0.07/README.md)；版本实施状态不能从本文推断。
当前成员生命周期与 Workbench 的版本范围见
[v0.15](../versions/v0.15/README.md)；长期组件和交互规则仍以本文及
[Meridian 详细规范](meridian.md)为准。
当前 Runtime 权限请求与审批选项的版本范围见
[v0.16](../versions/v0.16/README.md)。
当前可中断执行、持久执行证据、安全 Markdown 与结构化时间线卡的版本范围见
[v0.17](../versions/v0.17/README.md)。
当前普通目录工作区选择、动态 Git 能力状态和 Project 路径分组见
[v0.23](../versions/v0.23/README.md)。
长期记忆页的 Scope、治理状态、列表/详情、伙伴写入与 Hearth Proposal 交互见
[长期记忆页设计](long-term-memory.md)。

## 设计方向

Rovai-ai 采用 **Meridian｜子午线**：

- **Meridian Day｜晨线**：冷调纸白与纯白表面，清晰、安定，强调日常协作与长期陪伴。
- **Meridian Night｜夜航**：深海军蓝与炭黑，低眩光，强调专注执行、审批、审计与夜间工作。
- 品牌色为北极星靛蓝（呼应品牌图形：四角星 + 地平线弧 + 营火点）；营火橙为低频暖色。
- 两种主题共享完全相同的信息架构、组件尺寸、状态语义和交互行为。
- 故事感只作为低频品牌层；工作区始终是可信、紧凑、证据优先的工程界面。

## 不可破坏的规则

1. **证据优先于氛围。** 命令、路径、Diff、审批、审计、错误和恢复信息不得被装饰削弱。
2. **品牌色、成员身份色和语义状态色分离。** 任意一种都不能替代另外两种。
3. **状态不能只靠颜色表达。** 必须同时使用文字、图标、形状或稳定位置。
4. **昼夜功能等价。** 不允许某一主题缺失状态、焦点、信息或操作。
5. **核心工作区不做卡片墙。** 优先使用表面层级、分隔线、行和选中态。
6. **紧凑但不拥挤。** 不得以密度为理由降低文字对比度、点击目标或焦点可见性。
7. **不新增视觉技术栈。** 优先复用 React、Radix、原生 CSS、现有组件和 CSS Variables。
8. **主题不进入领域模型。** 切换主题不得产生 Camp 事件、消息、AgentRun 或审计记录。
9. **身份图像是窄例外。** 受控成员头像/肖像只进入身份表面；工作区背景、证据、
   审批、审计、错误和恢复继续禁止插画。

## v0.07 固定边界（历史）

本节曾约束 v0.07 Hearth & Camp 双主题迁移的版本范围（保留当时的侧栏、顶栏与
组件几何，只替换视觉材料），现仅作为历史版本范围记录，原文见
[v0.07 版本文档](../versions/v0.07/README.md)。当前的实施边界、界面规格与
迁移顺序以 [Meridian 详细规范](meridian.md)及后续版本计划为准。

## 主题行为

- 用户偏好为 `system | day | night`，默认 `system`。
- 设置页显示“跟随系统 / 晨线（Meridian Day）/ 夜航（Meridian Night）”，偏好是全局应用设置，不属于 Camp。
- `system` 实时响应 macOS 外观变化；手动选择覆盖系统外观。
- Renderer 与 Electron 原生界面在平台允许范围内使用同一解析主题。
- 主题必须在首次绘制前解析，避免亮色或暗色闪烁。
- 切换原子生效，不做全应用颜色渐变，不移动焦点，不改变 Tab、草稿、滚动或选择状态。
- 精确主题和状态 Token 见[详细规范](meridian.md)。

## 稳定信息架构

- 左侧栏：新对话、大厅与 Project/Camp 树、成员、长期记忆、设置和本地健康状态。
- 顶栏：当前上下文、运行/审批摘要及与当前内容直接相关的操作。
- 中央区：公共讨论、系统边界事件、执行证据和 Composer。
- 右侧 Inspector：活动、Task、上下文、审批和审计。

UI 必须帮助用户快速回答：

- 当前在哪个 Project 和 Camp？
- 当前 Default Lead 和参与成员是否就绪？
- Agent 正在做什么，最近证据是什么？
- 哪一步在等待用户？
- 有哪些长期 Task、风险、审批和恢复状态？

## 视觉语义

- 成员身份色来自受昼夜验证的固定色板，按 `AgentProfile.id` 稳定分配。
- 同一成员跨 Camp 保持同色；身份色不提供用户配置，也不硬编码成员名称。
- 成员图像由受控 `avatarRef` 解析；空值、未知引用、文件缺失和加载失败统一回退，
  不得解释为远程 URL 或任意本地路径。
- `success / attention / danger / info / neutral` 只表达系统状态。
- 品牌靛蓝只表达 Rovai-ai 品牌、主要建设性操作和稳定选中关系，不表示成功。
- 营火橙只用于低频品牌温度，不表示等待或警告。
- 危险操作始终使用 `danger`；审批等待和恢复始终使用明确文字与状态图标。

## 组件底线

- 用户消息、Agent 消息、系统事件、错误、恢复和活动证据必须是不同的行类型。
- 用户消息正文必须可选择，并提供可键盘访问的复制操作；复制结果使用当前展示名称，
  不重新暴露内部 handle。
- Agent 身份色只点缀头像、名称或细边，不填满消息。
- 头像和肖像只表达身份，不表达 Runtime readiness、执行状态、权限或 Capability。
- 命令以原子活动块展示；数据存在时显示命令、`cwd`、状态、时长、退出码和输出。
- 运行中的 Agent 应展示 Runtime 实际报告的进展说明、思考摘要、计划和结构化步骤；
  不得展示原始隐藏思维链，也不得在 Runtime 未报告时伪造过程。
- 以上执行过程按 AgentRun 持久化为独立 Execution Evidence，重开 Camp 或重启后
  仍可恢复；不得写入公共消息、摘要、检索索引、ContextManifest、A2A 或后续 Agent
  上下文。用户可见不等于 Agent 可检索。
- 执行披露按 Run 独立展示，不能跨成员或跨 Run 合并过程。运行中 Thinking 在公开
  reasoning 流结束后自动折叠，Progress 保持展开，Steps 默认折叠；Run 输出最终结论
  并进入终态时三者统一折叠，用户之后仍可手动展开历史内容。
- Agent 最终回复、公开 reasoning summary、narration、plan 和 step 使用安全 GFM；
  禁止 raw HTML、脚本、危险 URL 和远程嵌入。工具/命令/文件结果使用结构化证据组件，
  用户消息保持精确纯文本。
- Task 与 A2A 边界事件使用紧凑结构化时间线卡。历史卡冻结事件时文字和状态，点击
  Task 卡才读取 Inspector 当前状态；A2A 卡不得泄漏私有正文或内部 Run/Inbox ID。
- CampTurn 活动时 Composer 输入保持可编辑，发送位置变为 danger「停止」；停止作用
  于整棵 Run/A2A 树。`Enter` 在发送态提交，`Shift + Enter` 换行；输入法组合态和
  @候选选择不得误发，停止态按 Enter 也不得误触停止。fencing 完成后立即恢复发送。
- 审批必须说明请求能力、准确范围、原因、每个 Runtime 原生选项的后果及阻塞影响；
  不得发明当前 Runtime 没有提供的通用允许/拒绝档位。
- Diff 使用等宽字体和符号；新增/删除不能只靠底色区分。
- Audit 优先展示时间、Actor、动作、目标、结果和证据，不表现为聊天。
- `recovering` 是持久状态，必须说明恢复对象、最后状态、不确定性和下一步。
- 表单使用可见 Label；Placeholder 不替代 Label。
- Dialog/Popover 使用现有 Radix 能力，支持焦点约束、`Escape` 和关闭后焦点返回。
- 设置导航不为摘要模型保留独立「上下文」页。摘要模型放在成员详情默认折叠的
  「高级设置」中；表单只显示模型选择，不显示执行引擎选择器。明确模型只能来自
  当前成员自己的 Agent运行时，另保留自动回退与当前成员运行时默认模型。

## 产品术语

- 普通用户界面统一把 Agent Runtime 与 Adapter Installation 称为「执行引擎」。
- 表单标签、状态、空状态、Toast、Dialog、帮助文案和无障碍名称不得直接显示
  `Adapter Installation`、`Agent Runtime` 或裸 `Runtime`。
- 需要区分实现时使用「执行引擎类型」或「适配器」；Codex CLI、OpenCode CLI 等
  具体产品名以及诊断 JSON、协议字段和开发文档中的稳定标识保持不变。
- 来自 Core 或 Adapter 的动态错误、权限选项和诊断摘要进入普通 UI 前也要遵守同一
  术语映射，不能让内部词汇经 Toast 或卡片重新泄漏。

## 无障碍与适配

- 最低目标为 WCAG 2.2 AA：普通文字至少 `4.5:1`，组件边界和状态指示至少 `3:1`。
- `focus-visible` 必须清晰，且不能被 Sticky、Overlay 或 `overflow` 裁切。
- 主要操作必须可通过键盘完成，焦点顺序与可见顺序一致。
- Icon-only 控件必须有可访问名称；重要状态使用适当的 `aria-live`，不逐字播报流式日志。
- 支持 `prefers-reduced-motion`；减少动画时不得丢失状态反馈。
- 当前几何基线为 `1440×920`，最小窗口为 `1040×700`；不得出现整页横向滚动或遮挡核心操作。

## Coding Agent 工作规则

1. 先阅读目标组件、`styles.css` 和相关测试，不从设计稿猜测现有结构。
2. 涉及共享视觉时阅读[详细规范](meridian.md)，先扩展语义 Token，再修改组件。
3. 组件中不得新增散落的十六进制、RGB 或主题专属硬编码颜色。
4. 纯状态映射、主题解析和格式化逻辑保持为可测试纯函数。
5. 不为单一页面引入字体、图标库、CSS 框架、CSS-in-JS、动画库或状态管理库。
6. 同时覆盖相关的 Loading、Empty、Error、Disabled、Running、Approval 和 Recovery 状态。
7. 运行相关 Typecheck、Renderer 测试、构建和版本计划要求的真实 App 验收。

## 完成检查

- [ ] Day 与 Night 功能、状态和焦点等价。
- [ ] 品牌色、身份色和语义色没有混用。
- [ ] 证据区域只使用独立中性 Token。
- [ ] 关键状态不只依赖颜色。
- [ ] 主题切换不丢失任何交互状态。
- [ ] 键盘、焦点、Dialog 和可访问名称可用。
- [ ] Loading、Empty、Error、Disabled 和 Recovery 状态完整。
- [ ] `1440×920` 与 `1040×700` 均无核心操作遮挡。
- [ ] 没有新增散落颜色、旧 Token 使用者或不必要依赖。
- [ ] 相关测试、构建和 App 验收通过。
