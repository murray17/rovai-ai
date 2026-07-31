---
document_type: ui-style-index
authority: renderer-ui
status: accepted
design_direction: arctic-dawn-v3
target_version: v0.27
implementation_status: complete
last_updated: 2026-07-31
---

# Rovai-ai UI 规范

本文是 Renderer UI/UX 工作的稳定入口。当前唯一视觉与交互详规是
[Arctic Dawn V3](arctic-dawn.md)；版本范围、实施门禁和验收见
[v0.27](../versions/v0.27/README.md)及其
[实施计划](../versions/v0.27/implementation-plan.md)。

Arctic Dawn 设计文档已经冻结；用户已于 2026-07-30 明确授权生产实现。首轮范围及
随后确认的导航、设置覆盖与空 Camp 欢迎状态均已通过本地自动化与打包 App 验收；
v0.26 队员运行参数和会话表面 v3 交互也已通过 Core、Renderer 与打包 App 验收，
并按 ADR-0084 完成。
外部 HTML 原型、本文 `accepted` 状态或 ADR 状态本身不等于实现完成，实际
证据记录在对应当前版本实施计划。

v0.27 的成员身份 HTML 原型只提供六字段命名、基础/高级分组与排列参考；颜色、
组件、间距、响应式行为和整体视觉继续以 Arctic Dawn V3 为准，不能从原型反向覆盖
现有设计系统。

## 权威边界

1. 有效 ADR、`CONTEXT.md`、Core 合同和安全边界决定领域语义与可执行行为。
2. [Arctic Dawn V3](arctic-dawn.md)决定 Renderer 信息架构、视觉 Token、组件层级、
   产品文案、交互和适配。
3. [v0.26](../versions/v0.26/README.md)决定当前版本范围；实施状态只能从代码、测试和
   版本验收证据判断。
4. 原型与 HTML 样例只帮助评审视觉层级，不是生产合同、数据真源或可直接复制的代码。

发生冲突时不得用视觉稿覆盖领域或安全合同，也不得用当前旧代码反向覆盖已经冻结的
新设计。必须明确报告文档—实现漂移。

## 当前设计摘要

- v0.24 全界面使用 Arctic Dawn Day。`system | day | night` 偏好继续保存，但当前
  三种都解析为 Day；Night 等待后续独立设计。
- 所有一级页面常驻 270px 统一侧栏；Camp Inspector 展开时为 310px，在
  `1040–1179px` 收窄为 260px，并可从 Camp 顶栏完整隐藏或恢复。
- 普通侧栏显示“置顶 / 项目”；Quick Chat 只在 Renderer 中作为项目列表末尾的
  文件夹式投影，底层继续是独立 `quick_chat`。侧栏品牌字标为 `Rovai AI`，无副标题。
- 设置分类覆盖同一 270px 侧栏槽位，返回 App 后恢复原页面；再次进入设置时保留上次
  分类。普通侧栏底部只保留“设置”，健康事实从“设置 → 诊断”访问。
- 产品中文使用“快速对话”，英文使用 `Quick Chat`；禁止当前 UI 使用“大厅”或
  `Lobby`。
- Quick Chat 没有 Composer；“新对话”先完成原子 Camp Creation，成功后才进入
  Camp Composer。
- 空 Camp 使用欢迎图形、真实上下文摘要和三个只填充 Composer 的起步建议，不再显示
  单行空占位。
- Camp 主阅读流左对齐并按权威顺序阅读。终态执行过程折叠为
  `处理过程 · {本地化耗时}`，最终回复保持可见。
- 终态取消以每个 CampTurn 一条“你已在 {耗时} 后停止”进入会话时间线，不再永久
  挂在队员消息标题；未确认外部效果从该事件进入 Inspector。
- 用户、队员和已交付 A2A 消息的复制入口位于正文下方，悬停或键盘聚焦正文区域时
  显示；消息轨道与 Composer 在 Inspector 展开或隐藏时始终同宽、同轴。
- 命令、文件操作及其失败是处理过程内可展开的 Tool Call；Task 是消息区边界事件。
- Approval 不进入消息区。所有 pending 请求进入 Composer 正上方的非模态停靠式审批
  弹框，多项聚合显示“N 项待审批”，并保留各 Runtime 的原生选项、范围和决定身份。
- Camp Header 右侧只有 Run/审批状态摘要，没有“停止”或 `•••`。停止只占用 Composer
  发送位；另有唯一 Inspector 显示/隐藏按钮。状态摘要可恢复 Inspector 并打开对应
  页签；置顶、重命名和删除只从侧栏 Camp 行进入。
- 队员页采用半身 portrait + 独立圆形 icon 的双 rendition 身份设计；编辑身份支持
  圆形取景拖拽、缩放、键盘微调与实际尺寸预览。
- 队员页“运行配置”下保留默认收起的“运行参数”；九种 Runtime 使用专用模型与
  原生权限字段，Product Runtime、模型和权限通过唯一的“保存运行时”原子保存。
- Runtime 检查与缓存由 Core 后台统一管理；队员页和 Agent 运行时设置只展示可操作结果，
  不显示“已找到”“尚未检查”等内部探测阶段，也不在配置保存时同步完整检查。
- 记忆、技能、MCP、Agent 运行时、外观、诊断和创建新对话 Dialog 均以 Arctic Dawn
  详规为准，不允许长期混用旧设计。

## 不可破坏的 UI 规则

1. **证据优先。** 命令、路径、Diff、审批、审计、错误和恢复信息不能被装饰削弱。
2. **语义分离。** 品牌色、队员身份色和系统状态色不能互相替代。
3. **状态不只靠颜色。** 必须结合文字、图标、形状或稳定位置。
4. **不做卡片墙。** 核心工作区优先使用单一表面、分隔、列表行和选择态。
5. **主题不进领域。** Theme 切换不得产生 Camp 事件、消息、Run 或审计。
6. **身份图像是窄例外。** 头像只进入身份表面，不进入证据、审批、审计、错误或背景。
7. **安全 Markdown。** Agent 公开正文使用经过清洗的 GFM；用户正文保持精确纯文本；
   Tool 输出使用结构化证据组件。
8. **产品词汇稳定。** 普通 UI 使用“队员”“记忆”“Agent 运行时”“快速对话”，不使用
   “成员”“长期记忆”“执行引擎”，也不泄漏 handle、Installation ID、裸 Runtime
   或内部 binding。
9. **没有假能力。** Runtime 未报告的进展、Approval 选项、MCP 控制或 Skill 加载不能
   由 Renderer 补造。
10. **没有兼容壳。** 删除旧视觉结构、文案、CSS class 和无使用者状态；只保留已经
    明确确认的 ThemePreference 扩展位与领域合同。

## 无障碍与适配

- 目标 WCAG 2.2 AA：普通文字至少 `4.5:1`，组件边界、Focus 和非文字状态至少 `3:1`。
- `focus-visible` 清晰且不被 Sticky、Overlay 或 Overflow 裁切。
- 主要操作可通过键盘完成；Icon-only 控件有可访问名称；Focus 顺序与视觉顺序一致。
- Dialog/Drawer/Popover 使用 Radix 的 Focus Trap、`Escape` 和 Focus Return。
- 重要状态使用适当 `aria-live`，但流式日志和 Agent 输出不能逐字播报。
- 支持 `prefers-reduced-motion`；减少动画不能丢失状态反馈。
- 几何基准 `1440×920`，最小窗口 `1040×700`；不得出现整页横向滚动或遮挡核心操作。

## Coding Agent 工作规则

1. 先阅读目标组件、`styles.css`、相关测试和 [Arctic Dawn V3](arctic-dawn.md)。
2. 涉及领域、持久化、安全、Runtime、Memory、A2A 或 Camp Creation 时继续读取相关
   有效 ADR，不能从 UI 文档推导业务语义。
3. 共享色值只扩展语义 Token；组件内不得新增散落的十六进制、RGB 或主题分支色。
4. 纯状态映射、主题解析、排序、耗时和文案格式化保持为可测试纯函数。
5. 不引入新的 UI 框架、CSS-in-JS、字体、图标库、动画库或状态管理库。
6. 每个页面同时实现 Loading、Empty、Partial、Error、Disabled、Submitting 和
   Recovery，而不是只实现静态 Happy Path。
7. 先更新测试再删除旧结构，确保断言验证用户可见语义而非遗留 class 名。
8. 实施后运行 Typecheck、Renderer 测试、构建、相关 Core/Smoke，并完成版本计划中的
   真实 App 截图与键盘验收。

## 完成检查

- [x] 全部主题偏好都渲染同一套 Arctic Dawn Day，且没有加载旧 Night。
- [x] v7 导航投影、覆盖式设置侧栏和空 Camp 欢迎状态在两个目标尺寸无溢出。
- [x] Camp 阅读流、Tool Call、Task、固定 Approval 队列、Composer 与 Inspector
  符合详规。
- [x] Header 没有 Stop/`•••`；Sidebar 行操作和 Composer Stop 可键盘访问。
- [x] Quick Chat 项目式视觉投影、五个覆盖式设置入口与空 Camp 边界状态完整。
- [x] 品牌色、身份色、状态色、证据 Token 没有混用。
- [x] 对比度、Focus、Dialog、Tabs、Reduced Motion、200% Zoom 通过。
- [x] 没有旧 Meridian、Lobby、竖向时间轨、旧 Approval 卡或无使用者 CSS/测试。
- [x] 队员运行参数按九种 Runtime 的原生字段实现，v41 清空旧队员 Runtime 配置，
  且打包 App 中的折叠、草稿、原子保存与无 Installation 信息边界通过。
- [x] Runtime 配置读取缓存并异步刷新；用户状态收敛为可用性与修复动作，保存和页面
  打开不再等待完整探测。
- [x] Inspector 本机偏好、Header 页签路由、独立停止事件、正文复制入口和共享页面
  顶栏通过生产实现与验收。
- [x] 相关测试、构建、Smoke 和真实 App 截图矩阵通过；依赖外部 Copilot 配额的 MCP
  Runtime Smoke 限制单独记录在版本证据中。
