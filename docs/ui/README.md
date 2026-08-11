---
document_type: ui-style-index
authority: renderer-ui
status: accepted
design_direction: neutral-porcelain-steel
target_version: cross-version
implementation_status: complete
last_updated: 2026-08-11
---

# Rovai-ai UI 规范

本文是 Renderer UI/UX 工作的跨版本稳定入口。当前全局视觉方向是 Neutral Porcelain +
Steel；完整信息架构与交互详规继续由历史稳定路径
[当前 UI 详规](arctic-dawn.md)承载。当前交付版本与实施状态始终从
[文档导航](../README.md)进入。历史版本只解释当时范围，不能覆盖本文或当前详规中的合同。

v0.56 把一次性 P2 HTML 中确认的瓷灰表面与 Steel 强调迁移进生产 Renderer，同时保留
现有功能、数据、交互和安全边界。P2 不是新的产品模型：Project、Camp、Agent 级执行过程、
New Conversation、七个设置分类、队员、记忆与各类浮层继续使用原生产组件和 Read Side。
实现与验收状态见[v0.56 实施计划](../versions/v0.56/implementation-plan.md)。

v0.57 在该视觉基线上为 directory Project 增加可恢复的“移除项目”：只从这台 Mac 的侧栏
隐藏并取消相关置顶，不删除工作目录、Camp 或执行历史；重新选择同一目录即可恢复。v0.58 继续
保持 Main-owned Navigation preference，同时把移除状态镜像为 Core 的 Skill projection root-access
ledger：active Run 可完成一次终态清理，之后启动、周期任务和历史 observation 不再访问该目录。
当前实施与验收状态见[v0.57 实施计划](../versions/v0.57/implementation-plan.md)与
[v0.58 实施计划](../versions/v0.58/implementation-plan.md)。

v0.58 将用户与 Agent 普通正文统一到同一开放阅读平面，并在 2K 宽屏下把自然语言叙述与代码、
表格等真实工件拆成两种宽度。该变化不增加 Agent 身份底色，不改变 Task、Approval、AgentRun、
Composer 或 Inspector 的功能边界；当前实施与验收状态见
[v0.58 实施计划](../versions/v0.58/implementation-plan.md)。

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

v0.27 的队员身份 HTML 原型只提供六字段命名、基础/高级分组与排列参考；颜色、
组件、间距、响应式行为和整体视觉继续以当前 Neutral Porcelain + Steel 详规为准，不能从原型反向覆盖
现有设计系统。

v0.28 在同一 Arctic Dawn App Shell 中增加持久应用内通知入口、右侧通知抽屉、未读
徽标、临时浮层和通知设置。版本专属交互合同见
[v0.28 生产设计](../versions/v0.28/production-design.md)；设计已经确认并冻结，用户已授权
实施，生产代码与打包 App 验收已经完成；精确证据仍以版本实施计划为准。

v0.29 队员工作台信息架构已经形成共同理解、冻结并完成生产实施。版本级变更以
[v0.29 生产设计](../versions/v0.29/production-design.md)为准；本文未被替代的部分继续遵守
当前 UI 详规。实施与验收状态见[v0.29 实施计划](../versions/v0.29/implementation-plan.md)。

v0.33 将 Camp 与可置顶 Project 的操作统一进三点菜单，并移除 Project 标题和“查看全部”
中的会话数量。版本级合同见[v0.33 生产设计](../versions/v0.33/production-design.md)；它不
改变 Pin 持久化、Navigation Read Side、Core 或 IPC。该范围的生产实施、打包 App
与双尺寸桌面验收已完成，精确证据见版本实施计划。

v0.37 以确认的 MCP v4 HTML 原型为定向输入，局部替代本文与当时详规中的旧 MCP
列表行、拆分 Stdio/HTTP 表单和自动初次扫描交互。生产页面继续使用现有设置侧栏和当前
Porcelain/Steel Token，具体三段结构、队员 tofu、Server tofu 与 JSON Dialog 见
[v0.37 MCP 生产设计](../versions/v0.37/production-design.md)。

v0.38 将历史上“每次 Task 状态变化一张不可变边界卡”替换为“创建位置的一张实时 Task
卡”。标题、负责人和四态从当前 Task Read Side 原地更新；描述与完整变更历史继续属于
任务详情和审计。具体投影、旧消息兼容和验收合同见
[v0.38 生产设计](../versions/v0.38/production-design.md)。

v0.44 删除公共消息摘要系统后，队员详情同时删除 `MemberAdvancedSettings`、
`SummaryModelSettings`、“高级设置”展开入口和“对话压缩模型”文案，不保留空壳。
Member Runtime Parameters 及其模型、推理强度、权限与 sandbox 配置继续保留；实施状态按
[v0.44 实施计划](../versions/v0.44/implementation-plan.md)与代码证据判断。

v0.45 曾采用 Scheme C 会话区改版：执行动态常驻提供过程摘要，执行详情按需成为唯一的
AgentRun 过程详情面；Inspector 删除“活动”页。该逐 Run surface 已被 v0.55 取代，仅保留为
历史背景。原型入口：[Scheme C 会话区原型](../prototypes/run-activity/README.md)。

v0.55 以 Agent 级连续执行过程取代逐 Run 选择：同一 Camp 中每位有 AgentRun 的队员只保留
一个底部执行过程入口，按需 Drawer 以时间顺序保留该 Agent 的每个 Run stage、收件人与执行证据。
过程只是一层 Renderer read model，不创建领域 Process 或合并运行事实。当时 Inspector 收敛为“任务 /
上下文投递 / 审批”，Task Related execution 与停止结果均打开对应 Agent 过程；Header 不再显示执行
入口。详情不提供 Agent/AgentRun 级停止，唯一 CampTurn Stop 仍位于 Composer；Approval Dock 继续
固定在 Composer 上方，空间不足时过程 surface 收缩或滚动而不遮挡 Approval。完整合同见
[Run Process Detail Surface v2](../contracts/run-process-detail-surface-v2.md)，实现状态见
[v0.55 实施计划](../versions/v0.55/implementation-plan.md)。

v0.58 进一步把 ordinary Camp Inspector 收敛为“任务 / 队员”：ContextManifest 和 Runtime Input
Delivery Evidence 继续留在 Core/Snapshot，但不再占用普通阅读页签；审批只保留 Composer 正上方的
唯一 Approval Dock。Header 与通知摘要只展开、定位并聚焦该 Dock，不改变 Inspector 显隐或页签。
“队员”页读取当前 CampMember 与 AgentProfile 事实，并通过既有 versioned Core 命令提供唯一
Default Lead 选择器。当前合同见
[Run Process Detail Surface v3](../contracts/run-process-detail-surface-v3.md)。

v0.47 保留 v0.38 的创建位置唯一实时 Task 卡，并把它升级为五态；会话卡继续只显示状态、
标题和负责人。Inspector list 负责 compact 发现，detail 负责完整责任/审计并只读派生 Related
execution，现有 AgentRun UI 继续拥有执行事实。编辑器按 projected final state 展示条件字段，
terminal Task 只读，version conflict 保留草稿且不自动 replay。永久移除队员使用中文 preview，
在无非终态 AgentRun 时由 Core 原子结束全部 Current CampMembership 并释放未完成 Task。
完整合同见[v0.47 生产设计](../versions/v0.47/production-design.md)；生产实现与验收已经完成，状态见
[v0.47 实施计划](../versions/v0.47/implementation-plan.md)。

v0.49 在设置顶部增加“通用”，并冻结每个 Main Window Session 一次性解析启动位置、稳定一级
位置即时提交、macOS 登录项四态和窗口几何重置；后续同版本范围增加显式保存的默认队员/Lead、
确认式一键创建、失效锁存、持久当前项目与项目级 `＋`。一键入口使用 ADR-0145 的 Core-owned
Pending Draft：空草稿不进入导航/恢复，输入后标记“草稿”，首消息成功才激活；普通创建 Dialog
仍直接创建 Active Camp。选择新工作目录并成功一键创建时，Renderer 仍以非 Core、不可置顶的
零 Camp 当前项目行显示该空目录，不暴露空 Pending。设置侧栏因此扩展为七分类；设置和临时
表面仍不能成为启动目标。完整合同见[v0.49 生产设计](../versions/v0.49/production-design.md)，实施
状态见[v0.49 实施计划](../versions/v0.49/implementation-plan.md)。

v0.51 用可操作诊断中心替代旧四项健康摘要：顶部只保留“运行完整自检 / 导出诊断
JSON”，下方固定为三态摘要、attention-only 问题列表和四筛选全量结果。完整自检严格只读，
修复必须由用户显式点击单项操作并经复检确认；不存在修复全部。完整生产交互见
[v0.51 生产设计](../versions/v0.51/production-design.md)，安全与导出合同见
[ADR-0148](../adr/0148-read-only-diagnostics-and-data-minimized-export.md)。

2026-08-10 用户确认 A2A 消息 Scheme C：Agent 公共正文删除“来自执行”来源条和 compact
投递卡片，正文后只保留短折线/身份点与“发送给@队员”轻量 footer；`@队员` 使用飞书式蓝色
Mention，在身份仍可用时复用既有锚定人物信息卡。成功与非成功 Delivery 状态都不在 footer
或 Run stage 重复显示。Delivery 底层事实继续属于原有 Core Read Side；HTML 原型只保留为选型输入。

## 权威边界

1. 有效 ADR、`CONTEXT.md`、Core 合同和安全边界决定领域语义与可执行行为。
2. [当前 UI 详规](arctic-dawn.md)决定 Renderer 信息架构、Neutral Porcelain + Steel Token、组件层级、
   产品文案、交互和适配。
3. [v0.47 生产设计](../versions/v0.47/production-design.md)决定当前 Task 卡、Inspector、
   冲突恢复和删除确认合同；它保留 [v0.38](../versions/v0.38/README.md)的唯一实时卡模型。
   全局当前版本由[文档导航](../README.md)指向，实施状态只能从代码、测试和版本验收证据判断。
4. [v0.49 生产设计](../versions/v0.49/production-design.md)决定 General 页面、Main Window
   Session 启动恢复、登录项和窗口 reset 的版本级 Shell/Renderer 合同。
5. [v0.51 生产设计](../versions/v0.51/production-design.md)决定诊断中心的摘要、问题、全量结果、单项操作与七态恢复合同。
6. 原型与 HTML 样例只帮助评审视觉层级，不是生产合同、数据真源或可直接复制的代码。
7. [Run Process Detail Surface v3](../contracts/run-process-detail-surface-v3.md)决定当前 Camp
   Agent 执行过程入口、连续 Run stage、Inspector 收敛和与 Approval/Stop 的 layering。

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

`@所有队员` 同样可打开范围信息卡：历史消息读取发送时冻结的收件人 ID，Composer 读取
当前可提及队员。点击外部或 `Esc` 关闭；键盘打开后 `Esc` 关闭必须把焦点返回原 Mention。
从候选中选中队员或所有队员后，Composer 在 Mention 后自动补一个普通空格并把光标
放到空格之后；后方已是空白时只复用它，不重复插入。普通手写、粘贴或旧消息中的
`@文字` 仍是普通文本。

此交互属于 accepted Renderer 合同，不单独创建 ADR。任何改为全局角色 Toast、页面跳转或其他信息架构的
变更，都必须被明确描述为产品变更，并在同一提交中更新 Arctic Dawn 详规、Renderer 测试
和 `pnpm accept:structured-mentions-ui`；只改事件处理器或样式视为文档—实现漂移。
[Mention Popover 原型](../prototypes/mention-popover/README.md)记录已确认选型，但生产代码、
精确可访问性与回归边界仍以本节及 Arctic Dawn 为权威。

## 当前设计摘要

- v0.56 全界面使用 Neutral Porcelain + Steel Day。`system | day | night` 偏好继续保存，但当前
  三种都解析为 Day；Night 等待后续独立设计。
- 所有一级页面常驻 270px 统一侧栏；Camp Inspector 展开时为 310px，在
  `1040–1179px` 收窄为 260px，并可从 Camp 顶栏完整隐藏或恢复。
- 普通侧栏显示“置顶 / 项目”；Quick Chat 只在 Renderer 中作为项目列表末尾的
  文件夹式投影，底层继续是独立 `quick_chat`。侧栏品牌字标为 `Rovai AI`，无副标题。
- Camp 与可置顶 Project 只通过三点菜单置顶或取消置顶；Project 继续显示文件夹、项目级
  `＋` 和唯一三点菜单，主行本身承担展开/折叠且不显示独立折叠图标。当前项目使用稳定
  `--surface-selected` 瓷灰底色。Camp 菜单同时承载重命名、
  “复制会话 ID”和删除。复制只写入稳定会话 ID 原文；Project 标题与“查看更多 / 收起”
  不显示会话数量，快速对话不显示 Project 菜单。
- 设置分类覆盖同一 270px 侧栏槽位，固定分为“应用 / 能力 / 支持”三组：“应用”包含
  “通用 / 外观 / 通知”，“能力”包含“Skill / MCP / Agent 运行时”，“支持”仅包含
  “诊断与修复”；不增加“关于与更新”。返回 App 后恢复原页面；设置分类跨 Main Window Session
  记住最后选择，全新安装默认 General。七个设置分类统一使用无外框、带底部分隔线的共享页头；
  普通侧栏底部只保留“设置”，健康事实从“设置 → 诊断与修复”访问。
- 产品中文使用“快速对话”，英文使用 `Quick Chat`；禁止当前 UI 使用“大厅”或
  `Lobby`。
- Quick Chat 没有 Composer；普通 Dialog 先完成原子 Active Camp Creation；一键入口先获得
  Core Pending Camp 身份并进入同一 Composer，第一条消息成功时再原子激活。
- Camp Composer 为空或正文被完整选中时，键入 `/` 打开当前 Lead 可用 Skill 的原生下拉；
  候选来自真实 Skill/生效组读侧，方向键移动，Enter 或 Tab 选择，Esc 关闭。选中后只写入
  普通 `/<skill-name> ` 文本并保留草稿、Mention、附件和发送边界，不新增 Slash Command
  协议，也不声称 Runtime 已读取该 Skill。
- Camp Composer 中通过 `@` 候选选中的队员以整体蓝色 Member Mention 显示，
  选中后自动补一个普通空格并把光标放到空格之后；在编辑时是不可拆分的原子单元；
  Composer 与发送后的会话历史均使用默认无底色的
  飞书式蓝色行内文字。点击或键盘激活当前队员的 Mention 在原位置打开布局 2 人物信息卡，
  不显示全局角色 Toast，也不导航到队员页。
- 空 Camp 使用欢迎图形、真实协作配置摘要和三个只填充 Composer 的起步建议，不再显示
  单行空占位。
- Camp 主阅读流左对齐并按权威顺序阅读。Agent 执行台按队员提供一个过程入口；执行详情
  按需展示所选 Agent 的连续 AgentRun stage、Run 状态、收件人与过程证据。当前用户显式发送成功且
  没有正在查看 non-terminal Run 时，按 Core 有序回执打开本次第一条 Run 所属 Agent 的过程并聚焦精确
  stage，但不夺走 Composer 焦点；已经在查看 non-terminal Run 时保持当前选择。后台 A2A、Runtime
  事件、重载和恢复仍不得自动打开、切换或抢焦点。打开入口时优先定位最新 running、否则最新
  non-terminal、最后最新 terminal Run。聚焦 live Run 时只在用户停留 Drawer 底部时跟随最新输出，
  手动上滚暂停、回到底部恢复，且不滚动公共消息时间线。
- Agent 公共正文不显示“来自执行”来源条；A2A 消息不显示 compact 投递卡片，只在正文后使用
  Scheme C 短转交轨迹显示“发送给@队员”。所有 Agent 使用同一开放阅读表面，不按角色铺不同消息
  底色；`@队员` 是飞书式蓝色 Mention，可用身份可打开既有人物信息卡。footer 与 Run stage 都不重复投影 Delivery 状态标签；
  Delivery 底层状态、失败码与恢复事实仍由原有 Core Read Side 负责。
- 终态取消以每个 CampTurn 一条“你已在 {耗时} 后停止”进入会话时间线，不再永久
  挂在队员消息标题；未确认外部效果从该事件进入 Inspector。
- 用户、队员和已交付 A2A 消息的正文支持鼠标拖选和系统复制快捷键；用户自己的
  纯文本消息不得拦截原生文本选择。整条消息的复制入口固定在消息内容列右上角，不跟随正文
  长度、宽屏工件或 A2A footer 改变位置，仅在悬停或键盘聚焦消息区域时显示；消息轨道与
  Composer 在 Inspector 展开或隐藏时始终同宽、同轴。
  `2560×1440` 等 2K 宽窗口下 Composer 扩展到 1040px；可见 `Enter` 提示紧邻发送按钮，
  不能悬在输入框的孤立位置。
- 命令、文件操作及其失败是处理过程内可展开的 Tool Call；每个 Task 在创建位置只投影
  一张读取当前五态文字、标题和负责人的实时卡片。Inspector list/detail 与现有 AgentRun UI
  分别承担发现、完整责任审计和执行事实，不能合并进卡片。
- Approval 不进入消息区。所有 pending 请求进入 Composer 正上方的非模态停靠式审批
  弹框，多项聚合显示“N 项待审批”，并保留各 Runtime 的原生选项、范围和决定身份。
- Approval Dock 始终位于 Composer 正上方；Drawer 空间不足时退化为摘要/收起态，不能遮挡
  Dock、Composer 或唯一的 CampTurn Stop。
- Camp Header 右侧只有待审批摘要和 Inspector 显示/隐藏按钮，没有执行入口、“停止”或 `•••`。
  停止只占用 Composer 发送位；待审批摘要只展开、定位并聚焦 Composer 正上方的 Approval Dock，
  不改变 Inspector 显隐或页签；置顶、重命名、复制
  会话 ID 和删除只从侧栏
  Camp 行进入。
- 队员页采用半身 portrait + 独立圆形 icon 的双 rendition 身份设计；编辑身份支持
  圆形取景拖拽、缩放、键盘微调与实际尺寸预览。
- 队员 Header 的 Presence 与 Runtime 是两个角标：“在队”是静态状态，“{Runtime} 可用 →”
  使用 Hover、Focus、箭头和可访问名称体现可点击性，并进入现有运行配置；不得把二者合并为
  一个状态或让 Runtime 角标变成死文案。
- 队员页“运行配置”下保留默认收起的“运行参数”；九种 Runtime 使用专用模型与
  原生权限字段，Product Runtime、模型和权限通过唯一的“保存运行时”原子保存。
- 队员详情在运行配置后只保留 Memory Capability 和危险区，不渲染“高级设置”或
  摘要模型配置入口；这不删除或折叠 Member Runtime Parameters。
- 永久移除队员在存在非终态 AgentRun 时阻塞；否则确认界面以中文展示将离开的 Camp 与
  将释放的未完成 Task 数量，Core 在一个事务中完成全部 membership/Task/Lead 收口。
- Runtime 检查与缓存由 Core 后台统一管理；队员页和 Agent 运行时设置只展示可操作结果，
  不显示“已找到”“尚未检查”等内部探测阶段，也不在配置保存时同步完整检查。
- 工作目录选择先完成目录安全校验并立即可用于创建；动态 Git 能力随后异步加载，检测中或
  失败只影响 Git 状态提示，不阻塞普通目录 Camp 创建。
- 记忆、通用、技能、Agent 运行时、外观、通知、诊断与修复和创建新对话 Dialog 以当前 UI
  详规为准。七个设置分类、队员、记忆和浮层统一使用 Porcelain 表面与低频 Steel 顶边、标题轨和
  选中态；attention、danger、success 与 evidence 继续使用各自语义色。MCP 由 v0.37 生产设计
  局部替代，但继续复用同一 App Shell、Token 与通用交互规则。
- 创建新对话继续提供工作目录、安全校验、动态 Git 能力、队员、Lead 和可选名称；不增加
  原型式“创建摘要”区或黄色静态提示。会话日期只从真实时间戳和 Camp 创建时间派生，不补造
  “今天 · 发布准备”等不可取得阶段字段。
- v0.28 通知入口常驻品牌行，通知中心使用右侧 Radix Drawer 式 Dialog；通知行保持单一
  列表表面，浮层不抢焦点，完整行为与数据边界以当前版本生产设计为准。

## 不可破坏的 UI 规则

1. **证据优先。** 命令、路径、Diff、审批、审计、错误和恢复信息不能被装饰削弱。
2. **语义分离。** 品牌色、队员身份色和系统状态色不能互相替代。
3. **状态不只靠颜色。** 必须结合文字、图标、形状或稳定位置。
4. **不做卡片墙。** 核心工作区优先使用单一表面、分隔、列表行和选择态。
5. **主题不进领域。** Theme 切换不得产生 Camp 事件、消息、AgentRun 或审计。
6. **身份图像是窄例外。** 头像只进入身份表面，不进入证据、审批、审计、错误或背景。
7. **安全 Markdown。** Agent 公开正文使用经过清洗的 GFM；用户正文保持精确纯文本；
   Tool 输出使用结构化证据组件。
8. **产品词汇稳定。** 普通 UI 使用“队员”“记忆”“Agent 运行时”“快速对话”等已确认术语；
   Member 的正式中文名只使用“队员”，不以“成员”或“伙伴”代称，也不使用“长期记忆”“执行引擎”
   作为对应正式名称。界面不泄漏 handle、Installation ID、裸 Runtime
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
- 几何基准 `1440×920`，2K 基准 `2560×1440`，最小窗口 `1040×700`；不得出现整页横向滚动
  或遮挡核心操作。

## Coding Agent 工作规则

1. 先阅读目标组件、`styles.css`、相关测试和[当前 UI 详规](arctic-dawn.md)。
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

- [x] 全部主题偏好都渲染同一套 Neutral Porcelain + Steel Day，且没有加载旧 Night。
- [x] v7 导航投影、覆盖式设置侧栏和空 Camp 欢迎状态在两个目标尺寸无溢出。
- [x] Camp 阅读流、Tool Call、Task、固定 Approval 队列、Composer 与 Inspector
  符合详规。
- [x] Header 没有 Stop/`•••`；Sidebar 行操作和 Composer Stop 可键盘访问。
- [x] Quick Chat 项目式视觉投影、七个覆盖式设置入口与空 Camp 边界状态完整。
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
- [x] v0.45 执行动态、执行详情、Inspector Activity 页删除、Approval layering 与
  CampTurn Stop 的生产实现和打包 App 验收。
- [x] v0.47 五态实时 Task 卡、compact list、完整 detail/Related execution、projected-state
  Editor、冲突草稿恢复、terminal read-only 与中文队员删除确认的生产实现和打包 App 验收。
- [ ] v0.49 General 页面、每窗口一次启动恢复、macOS 登录项四态、窗口可见性/reset、无领域事件
  负向证明与 packaged App 验收。
