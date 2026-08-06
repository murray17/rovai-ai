---
document_type: ui-style-index
authority: renderer-ui
status: accepted
design_direction: arctic-dawn-v3
target_version: cross-version
implementation_status: in_progress
last_updated: 2026-08-06
---

# Rovai-ai UI 规范

本文是 Renderer UI/UX 工作的跨版本稳定入口。当前全局视觉与交互详规是
[Arctic Dawn V3](arctic-dawn.md)；当前交付版本与实施状态始终从
[文档导航](../README.md)进入。历史版本只解释当时范围，不能覆盖本文或 Arctic Dawn
中的当前合同。

Arctic Dawn 设计文档已经冻结；用户已于 2026-07-30 明确授权生产实现。首轮范围及
随后确认的导航、设置覆盖与空 Camp 欢迎状态均已通过本地自动化与打包 App 验收；
v0.26 队员运行参数和会话表面 v3 交互也已通过 Core、Renderer 与打包 App 验收，
并按 ADR-0084 完成。
2026-08-03 新增的结构化 Mention 与用户消息原生拖选已经完成生产实现；2026-08-06
用户再次确认原交互稿的“Mention 视觉方案 A + 信息弹窗布局 2”，并将其冻结为当前
Renderer 合同；生产实现已重新打包，并通过 `pnpm accept:structured-mentions-ui` 的编辑区
与历史消息点击、键盘、焦点返回、拖选和截图验收。它不追溯改写上述基线验收。
外部 HTML 原型、本文 `accepted` 状态或 ADR 状态本身不等于实现完成，实际
证据记录在对应当前版本实施计划。

v0.27 的成员身份 HTML 原型只提供六字段命名、基础/高级分组与排列参考；颜色、
组件、间距、响应式行为和整体视觉继续以 Arctic Dawn V3 为准，不能从原型反向覆盖
现有设计系统。

v0.28 在同一 Arctic Dawn App Shell 中增加持久应用内通知入口、右侧通知抽屉、未读
徽标、临时浮层和通知设置。版本专属交互合同见
[v0.28 生产设计](../versions/v0.28/production-design.md)；设计已经确认并冻结，用户已授权
实施，生产代码与打包 App 验收已经完成；精确证据仍以版本实施计划为准。

v0.29 队员工作台信息架构已经形成共同理解、冻结并完成生产实施。版本级变更以
[v0.29 生产设计](../versions/v0.29/production-design.md)为准；本文未被替代的部分继续遵守
Arctic Dawn V3。实施与验收状态见[v0.29 实施计划](../versions/v0.29/implementation-plan.md)。

v0.33 将 Camp 与可置顶 Project 的操作统一进三点菜单，并移除 Project 标题和“查看全部”
中的会话数量。版本级合同见[v0.33 生产设计](../versions/v0.33/production-design.md)；它不
改变 Pin 持久化、Navigation Read Side、Core 或 IPC。该范围的生产实施、打包 App
与双尺寸桌面验收已完成，精确证据见版本实施计划。

v0.37 以确认的 MCP v4 HTML 原型为定向输入，局部替代本文与 Arctic Dawn V3 中旧 MCP
列表行、拆分 Stdio/HTTP 表单和自动初次扫描交互。生产页面继续使用现有设置侧栏和 Arctic
Dawn Token，具体三段结构、成员 tofu、Server tofu 与 JSON Dialog 见
[v0.37 MCP 生产设计](../versions/v0.37/production-design.md)。

v0.38 将历史上“每次 Task 状态变化一张不可变边界卡”替换为“创建位置的一张实时 Task
卡”。标题、负责人和四态从当前 Task Read Side 原地更新；描述与完整变更历史继续属于
任务详情和审计。具体投影、旧消息兼容和验收合同见
[v0.38 生产设计](../versions/v0.38/production-design.md)。

## 权威边界

1. 有效 ADR、`CONTEXT.md`、Core 合同和安全边界决定领域语义与可执行行为。
2. [Arctic Dawn V3](arctic-dawn.md)决定 Renderer 信息架构、视觉 Token、组件层级、
   产品文案、交互和适配。
3. [v0.38](../versions/v0.38/README.md)决定当前 Task 卡片的局部替代合同；全局当前
   版本由[文档导航](../README.md)指向，实施状态只能从代码、测试和版本验收证据判断。
4. 原型与 HTML 样例只帮助评审视觉层级，不是生产合同、数据真源或可直接复制的代码。

发生冲突时不得用视觉稿覆盖领域或安全合同，也不得用当前旧代码反向覆盖已经冻结的
新设计。必须明确报告文档—实现漂移。

## 稳定交互合同：结构化 Mention

结构化 Mention 分三层管理，修改时必须先判断所改层级：

| 层级 | 权威入口 | 负责内容 |
|---|---|---|
| Core 语义 | [ADR-0096](../adr/0096-core-owned-structured-mentions-and-derived-addressing.md) | 耐久 Structured Content、稳定身份、失效校验和派生寻址 |
| Renderer UI | [Arctic Dawn：不得回退的交互合同](arctic-dawn.md#不得回退的交互合同) | 飞书式行内样式、锚定人物信息卡、键盘、拖选与禁止导航边界 |
| 回归证据 | [桌面 UI 验收](../development/ui-acceptance.md#结构化-mention-门禁) | 单元语义测试、隔离打包 App 操作和截图 |

当前已确认的 Composer 与历史消息行为是：仍可用的 Member Mention 默认显示为无底色、
无边框的蓝色行内文字，仅在 Hover、Focus 或弹窗打开时使用 8% 蓝色轻反馈；单击、Enter
或 Space 在原 Mention 附近打开非模态人物信息卡，并保持当前 Camp 不变。信息卡固定采用
392px 宽、左侧 128px 受控 4:5 portrait 的“布局 2”，右侧展示名称、团队角色、Presence、
Agent 运行时、专业职责、工作准则和性格底色。它不是队员页链接，也不是全局 Toast。
拖选形成文本选区时不得误触发弹窗；已移除或不可解析队员保持不可操作。

`@所有成员` 同样可打开范围信息卡：历史消息读取发送时冻结的收件人 ID，Composer 读取
当前可提及队员。点击外部或 `Esc` 关闭；键盘打开后 `Esc` 关闭必须把焦点返回原 Mention。
普通手写、粘贴或旧消息中的 `@文字` 仍是普通文本。

此交互属于 accepted Renderer 合同，不单独创建 ADR。任何改为全局角色 Toast、页面跳转或其他信息架构的
变更，都必须被明确描述为产品变更，并在同一提交中更新 Arctic Dawn 详规、Renderer 测试
和 `pnpm accept:structured-mentions-ui`；只改事件处理器或样式视为文档—实现漂移。
[Mention Popover 原型](../prototypes/mention-popover/README.md)记录已确认选型，但生产代码、
精确可访问性与回归边界仍以本节及 Arctic Dawn 为权威。

## 当前设计摘要

- v0.24 全界面使用 Arctic Dawn Day。`system | day | night` 偏好继续保存，但当前
  三种都解析为 Day；Night 等待后续独立设计。
- 所有一级页面常驻 270px 统一侧栏；Camp Inspector 展开时为 310px，在
  `1040–1179px` 收窄为 260px，并可从 Camp 顶栏完整隐藏或恢复。
- 普通侧栏显示“置顶 / 项目”；Quick Chat 只在 Renderer 中作为项目列表末尾的
  文件夹式投影，底层继续是独立 `quick_chat`。侧栏品牌字标为 `Rovai AI`，无副标题。
- Camp 与可置顶 Project 只通过三点菜单置顶或取消置顶；Camp 菜单同时承载重命名和
  删除。Project 标题与“查看全部”不显示会话数量，快速对话不显示 Project 菜单。
- 设置分类覆盖同一 270px 侧栏槽位，返回 App 后恢复原页面；再次进入设置时保留上次
  分类。普通侧栏底部只保留“设置”，健康事实从“设置 → 诊断”访问。
- 产品中文使用“快速对话”，英文使用 `Quick Chat`；禁止当前 UI 使用“大厅”或
  `Lobby`。
- Quick Chat 没有 Composer；“新对话”先完成原子 Camp Creation，成功后才进入
  Camp Composer。
- Camp Composer 中通过 `@` 候选选中的队员以整体蓝色 Member Mention 显示，
  在编辑时是不可拆分的原子单元；Composer 与发送后的会话历史均使用默认无底色的
  飞书式蓝色行内文字。点击或键盘激活当前队员的 Mention 在原位置打开布局 2 人物信息卡，
  不显示全局角色 Toast，也不导航到队员页。
- 空 Camp 使用欢迎图形、真实上下文摘要和三个只填充 Composer 的起步建议，不再显示
  单行空占位。
- Camp 主阅读流左对齐并按权威顺序阅读。终态执行过程折叠为
  `处理过程 · {本地化耗时}`，最终回复保持可见。
- 终态取消以每个 CampTurn 一条“你已在 {耗时} 后停止”进入会话时间线，不再永久
  挂在队员消息标题；未确认外部效果从该事件进入 Inspector。
- 用户、队员和已交付 A2A 消息的正文支持鼠标拖选和系统复制快捷键；用户自己的
  纯文本消息不得拦截原生文本选择。整条消息的复制入口仍位于正文下方，仅在悬停或
  键盘聚焦正文区域时显示；消息轨道与 Composer 在 Inspector 展开或隐藏时始终同宽、同轴。
- 命令、文件操作及其失败是处理过程内可展开的 Tool Call；每个 Task 在创建位置只投影
  一张读取当前标题、负责人和状态的实时卡片。
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
- 记忆、技能、Agent 运行时、外观、诊断和创建新对话 Dialog 以 Arctic Dawn 详规为准；
  MCP 由 v0.37 生产设计局部替代，但继续复用同一 App Shell、Token 与通用交互规则。
- v0.28 通知入口常驻品牌行，通知中心使用右侧 Radix Drawer 式 Dialog；通知行保持单一
  列表表面，浮层不抢焦点，完整行为与数据边界以当前版本生产设计为准。

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
- 模态 Dialog/Drawer 使用 Radix 的 Focus Trap、`Escape` 和 Focus Return；非模态锚定
  Popover 不设 Focus Trap，并按各自合同处理 `Escape`、点击外部与 Focus Return。
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
- [x] 结构化 Member Mention、Mention-derived 寻址和原子编辑通过 Core、Renderer 与
  打包 App 验收；Composer 与历史 Mention 的无底色飞书式样式、布局 2 人物信息卡、键盘和不导航边界已纳入
  同一真实 App 回归门禁。
- [x] 用户自己的消息正文通过真实鼠标拖选与系统复制快捷键验收；整条复制入口继续仅在
  悬停或键盘聚焦时显示。
- [x] 相关测试、构建、Smoke 和真实 App 截图矩阵通过；依赖外部 Copilot 配额的 MCP
  Runtime Smoke 限制单独记录在版本证据中。
- [x] v0.28 全局通知入口、持久抽屉、未读徽标、浮层、设置、Focus Return 与
  reduced-motion 已通过 Core、Renderer 和隔离打包 App 验收。
