---
document_type: ui-component-contract
authority: renderer-camp-workspace
status: accepted
last_updated: 2026-08-31
---

# Camp 会话工作区

## 成员 Fast 响应模式

成员浮层只为合格 Claude Code/Codex 绑定显示 Fast 胶囊；资格和作用域见
[Camp Member Fast v1](../../contracts/camp-member-fast-v1.md)。保留既有行高、头像/名称层级和末尾操作菜单。
胶囊视觉 20–22px、实际目标至少 28px、字体不低于 10.5px；使用现有语义主题 token，开启不只依赖颜色，
同时填充闪电图标。未知默认采用中性样式，可访问名称说明由 Runtime 继承，不承诺首次执行后显示实际状态。
按钮不显示悬浮或焦点提示框，保留键盘焦点样式。

点击直接切换并保存，不显示费用提示或二次确认；成员菜单不显示手动检测或恢复默认项。
切换仅保存当前 Camp 该队员后续执行的意图，不显示保存成功或运行中切换提醒。按钮不显示 cooldown、实际档位或
请求不一致警告；Runtime 观测只留在 Run 记录/监控，不影响选择。保存失败才显示错误并保留原状态，按钮不重建，
焦点保持在触发按钮。展开队员浮层时，仅对缺少有效结果且没有在途请求的 Claude/Codex 队员静默检查；
支持时显示胶囊，不支持或失败时保持隐藏，不显示 loading、检测完成通知或错误 Toast，也不阻止其他队员切换 Fast。
支持与不支持的结果跨展开/收起和浮层 Tab 切换复用；失败在下次展开重试，绑定或模型变化后自动重测。
浮层收起时不发起新检查，迟到的旧绑定结果不得恢复入口；缓存只存在于当前 Camp 工作区，不增加持久状态或接口。

长名册在浮层内滚动，最小验收 1280×720 保持 Composer/发送按钮可达。生产 CampWorkspace 的隔离 Electron
fixture 由 `pnpm test:camp-fast-layout` 验证主题、尺寸、键盘/焦点、失败、直接切换、自动检测/缓存和初始默认。

Camp 是开放阅读面，不按角色铺不同底色。时间线、Agent 执行台、Approval/Recovery Dock 和
Composer 共享主列；会话详情由标题栏入口打开浮层，不占用常驻侧列。普通叙述保持 `76ch` 阅读宽度，代码、表格等工件
可以扩展到 `930px`，宽会话轨道与 Dock 上限保持 `1040px`；Composer 常规上限为 `1040px`，
viewport `>= 1800px` 时独立扩展到 `1440px`。

打开文件时，会话与独立文件预览的共享顶栏、响应式列替换和焦点返回遵循
[Camp 文件预览区](file-preview.md)。文件预览不改变本文件拥有的时间线、Composer、Approval、执行台或
Files Changed 历史 Review 真源。

## 打开与渐进历史

Camp 的首个 meaningful paint 只依赖 [Camp Open Projection v9](../../contracts/camp-open-projection-v9.md)：
Camp/成员、最近消息、当前运行摘要、pending Approval 和 Composer 可用即完成。项目导航恢复、侧栏刷新
与可见来源确认在首屏后执行，失败不能撤销已打开会话。只显示“正在打开对话”的 Shell 不算完成。

应用内打开另一个 Camp 时，Renderer 不得在投影返回前提交目标 Camp ID、目标项目或空 Snapshot。缓存
未命中时保留当前 Quick Chat、Camp、成员、记忆或设置工作区，投影到达后一次性提交目标 Camp；有效缓存
命中时可以先恢复缓存阅读面，再用权威投影刷新。常规预算内打开不显示 loading；超过 400 ms 才在目标
侧栏行显示低强调度、非阻塞进度。打开失败保留原工作区并原位报告，快速 A→B 切换只允许最新 selection
提交。不得用整页 loading、提前改变项目导航或扩大缓存掩盖等待时间。

投影 coverage 不完整时，UI 必须把历史表达为“尚未加载”，不能表达为“不存在”。会话时间线顶部提供
低强调度“加载更早消息”；加载时保持现有消息可读、按钮显示忙碌状态，失败原位允许重试。较早页 prepend
后保持用户当前阅读锚点，不跳到顶部或最新消息。没有 earlier history 时不显示该控件。

non-terminal Run 的全部 Evidence 随 Camp open/refresh 返回；Renderer 与 live event 按稳定 Evidence identity
去重，在当前 Main Window Session 不按最后 80、600 或其他最后 N 项裁剪运行中正文与步骤。terminal Run
Evidence 继续在用户展开精确 Run 后按需加载；关闭的 Drawer、隐藏 Inspector 或世界地图不得触发 terminal
历史预取。普通 event refresh 保留用户已经加载的较早消息、Draft、滚动位置、Inspector 选择和地图模式。

用户主动提交消息时，时间线立即回到最底部并恢复 follow-latest；optimistic 用户消息和随后的权威回执
渲染完成后仍须保持在最新位置。其他新增消息只有在用户原本位于底部附近时才自动跟随，用户手动上滚
阅读较早内容时不得被后台消息抢走位置。

冷启动恢复与应用内切换的呈现边界不同。Main Window Session 一旦给出恢复目标，全局 StartupGate 必须
关闭并显示对应一级页面框架；Camp shell 可暂时显示标题区、局部状态与结构占位，但不得伪装成 meaningful
content，也不得在 `camps.enter` 成功前提交权威 Camp。成功 enter 的 Active Camp 保持 Active；meaningful
Pending Camp Draft 保持 Pending，并以“草稿”呈现，不能把恢复打开误作激活。Members 与 Memory 同样在
自己的内容区域读取，
不能继续占用全屏“正在恢复上次位置”。失败留在局部 surface 重试；仅明确 `camps.exists === false` 的已删除
Camp 可以回到 Quick Chat。Notification navigation、恢复位置写入和已读确认要等权威 route commit。

## Camp 队员管理

“当前会话”摘要行在标题右侧提供紧凑“邀请”按钮。它打开可搜索的多选 Dialog，说明固定为
“选择要加入这次讨论的队员。”；候选只包含当前 `present` 且不在 active Camp members 中的 AgentProfile；
曾离开的成员若再次出现，仍按普通候选与“邀请队员”
文案处理，不显示“重新加入”或历史离队分组。提交按权威 membership generation 顺序执行；多选出现局部失败
时保留失败项和明确原因，已成功项立即从候选移除，不伪装为整批回滚。

成员行保持头像、身份、Runtime 名称与真实“在队 / 暂离”状态；队长通过行内徽标表达。设为队长、模型信息展开与“移出当前会话”统一收进
行尾单个水平三点菜单，避免并排按钮破坏层级。入口保留 `28×28px` 命中区，静止态无边框、无底色，
仅在悬停、键盘聚焦或菜单打开时显示低强调度底色。菜单项必须有文本动作名、键盘焦点、Esc/外部点击关闭和
`aria-expanded`；模型项只控制既有详情 disclosure，不改变 Runtime 配置。

Camp 只有一位 active member 时，“移出当前会话”仍可见但禁用，并直接解释“Camp 至少需要一位队员”。
其他成员选择移除后，先打开读取
[Camp Membership v1](../../contracts/camp-membership-v1.md)权威 preview 的确认 Dialog；读取期间显示骨架，失败
原位重试。Dialog 只展示实际存在的影响：会被停止的 Run、被释放的 Task、等待/运行 Delivery 与 Gather Item，
对应计数为零时整行不出现；没有任何实际影响时正文区整体折叠，不用“没有需要处理”或“继续保留”补齐版面。
每项图标与标题首行基线对齐。Default Lead 必须先选择有效 successor。确认提交 exact membership
generation/version，冲突后不自动重放，必须刷新 preview。

移除提交成功即关闭 Dialog 并刷新 Camp。仍有运行责任在正式结算时，当前会话区域显示低强调度“正在收口”
及已结算/目标 Run 数，不阻断阅读、Composer 或其他成员操作；完成后随权威 refresh 消失。UI 不把这一状态
写入公共消息、模型 Context 或 Toast 成功叙事，也不声称 Runtime 已经退出。

## 常规会话与世界地图

会话阅读面可以在常规时间线与沉浸世界地图之间切换。切换入口与地图路线显隐使用阅读面内的紧凑
悬浮控件，不占用 Camp Header 或独立工具栏；左侧导航、Inspector、Approval/Recovery Dock、Composer
与 Agent 执行台保持当前用户选择的承载位置和权威。切换不得清空时间线滚动、Draft、Inspector 选择、Approval、
执行台焦点或正在接收的真实活动更新。

“设置 → 通用 → 会话”的世界地图 Switch 控制地图可用性；新安装与旧偏好迁移后均为开启。关闭时，
当前地图立即回到会话时间线，后续 Camp 也不得从本机保存的地图视图恢复。阅读面完全隐藏“会话 / 地图”
切换器及地图路线控件，不保留禁用入口、关闭说明浮层或设置跳转，也不得挂载地图或清空会话状态。
会话查找仍可通过快捷键独立使用。用户在通用设置中重新开启后恢复切换器，仍需主动选择地图，不自动离开时间线。

世界地图只消费当前 Camp 中可呈现队员和既有 AgentRun、Runtime activity、A2A/Delivery 事实的有界
只读投影。固定地点、路线、稳定随机移动、停留、视觉会合和闲时文案都属于 Renderer 瞬时状态；地图
位置不表示 Task 进度、Run 阶段、投递状态或协作成功，不持久化，也不向 Core 或 Runtime 写回。

忙时气泡只能压缩展示已有 narration、plan 或 tool activity；长文本可以有界省略，但不得合成步骤、
百分比或成功判断。没有进行中任务时可以显示受审阅的环境预设，但普通地图气泡只显示正文，不附加
“闲时 · 环境预设”或“闲时预设 · 偶遇”标签。它必须继续使用中性、非交互且区别于真实执行/A2A 的
视觉，不能伪装成 Agent 输出或真实协作；紧凑与拥挤布局的底部字幕仍保留来源标签以参与全局仲裁。
移动途中只能使用不声称已位于起点或终点的移动内容；静止时优先选择地点专属内容。等待或结果待确认
的队员保持静止，并沿用既有诚实文案。

一个 Camp 世界地图只允许一个 Renderer 全局闲时调度器，不得为每个角色分别计时。调度器使用独立、
按 Camp 播种的随机流；首次尝试在 6–12 秒，后续尝试间隔 4–6 秒，事件展示 5.6 秒。
同一参与者在单人或偶遇事件后至少 55 秒不得再次出现，同一偶遇 pair 额外至少间隔 120 秒；近期 ID、
主语义类别和节点历史去重不得通过重抽概率或无限重试制造偏差。偶遇只在存在同节点、静止、合格 pair
时按单次条件抽样出现，并使用一个共享气泡，不复用真实 A2A 会合状态、颜色、交互或临时头像位移。
角色路径动画必须以合成层位移更新，避免逐帧改写布局坐标；Renderer 快照刷新不得重新绑定未变化的
角色或路径 DOM 引用。

普通地图气泡中的真实执行或 waiting speech 只覆盖同一队员；只要仍有无活跃运行的队员，全局闲时
调度器就继续从合格队员中选择。闲时参与者开始真实执行、waiting、A2A 或强制移动，或节点、运动条件
失效时必须撤下相关事件。底部文字仲裁固定为真实执行、waiting、偶遇闲时、单人闲时的降序。紧凑布局统一
使用底部单行字幕；7 人及以上可以保留真实气泡，但没有真实播报时必须以 waiting/闲时字幕回退，不能
直接隐藏环境内容。真实或 waiting 字幕保留其既有可操作语义；闲时字幕是非交互静态文字，不进入
`aria-live`。

地图必须按会话容器而非窗口高度适配：文件预览和可上下拖动执行台压缩主列时，地图收缩、裁切
或降低次要信息密度，不能遮住 Approval/Recovery Dock、Composer 或执行台。静态模式与 reduced motion
停止角色移动、路线流光、脉冲和会合动画，但不能停止 Snapshot/Runtime 驱动的真实文字更新，也不能
关闭无动画的静态闲时文案。

## 当前会话查找

CampWorkspace 挂载时，`Command+F`（macOS）或 `Ctrl+F`（Windows）打开当前 Camp 会话查找。地图
状态必须先切回既有会话时间线再打开查找；Members、Memory、Settings、Quick Chat 等非 Camp 页面因
没有挂载 CampWorkspace，不得注册或显示该查找条。用户从会话主动切到地图时，已打开的查找关闭且不
恢复旧焦点；下一次快捷键仍按上述地图返回路径处理。

查找条与会话/地图切换器组成右上角同一紧凑悬浮工具组，不占 Header 或新增工具栏。输入 180 ms 后查询
当前 Camp 完整历史的公开 user/agent 正文；exact total、选中序号和目标由
[Camp Conversation Find v1](../../contracts/camp-conversation-find-v1.md)拥有。附件、Task、Tool output、
Approval、Inspector、地图文案、系统消息和其他 Camp 不属于结果。屏幕外或尚未加载的目标只通过有界
around-window 合入时间线，不触发 earlier page 全量加载，也不改变 open coverage。

`Enter` 前进、`Shift+Enter` 后退并在首尾循环；按钮提供同等能力。空查询显示输入提示，无结果显示
“无匹配”，读取中保留可理解的忙碌状态，失败说明“暂时无法搜索完整会话”并原位提供“重试”。`Esc`
或关闭按钮撤下高亮，恢复打开前的消息阅读锚点、follow-latest 状态与仍可见焦点；定位期间输入框保持
焦点，后台消息不能把时间线拉回最新。

所有已挂载公开正文命中使用主题语义高亮，当前 occurrence 使用更强背景与下划线；当前消息另有 1 px
定位线，不能只靠颜色表达。结果以 `aria-live` 播报，图标按钮有动作名称，reduced motion 关闭浮层进入
和 spinner 之外的非必要动画。每次首次查询或前后导航都必须以当前 occurrence 的文字 Range 定位，而不是
只把整条消息居中；Range 落在扣除悬浮查找条后的安全可视区中央，长消息中的首尾命中无需用户再次滚动。

## A2A 会话消息

Agent 公共正文不显示“来自执行”来源条，也不投影 compact 投递卡。已交付 A2A 消息只在正文后
显示简短转交轨迹“发送给 @队员”；底层 Delivery 状态、失败码和恢复事实仍由 Core Read Side
拥有，不在 footer 或 Run stage 重复展示。

用户、队员和已交付 A2A 正文支持原生鼠标拖选与系统复制。整条消息使用可见文字“复制”作为入口，固定在
内容列右上角，只在悬停或键盘聚焦消息区域时显现；不能退回只有图标的含糊操作，也不能随正文、宽屏
工件或 footer 漂移。用户消息保持
精确纯文本，仅对[文件链接](file-preview.md#会话内的文件链接)做展示投影：Markdown label 替代其链接语法，
文件代码路径保留等宽样式，原始消息及整条消息复制内容不改写；Agent 正文使用清洗后的 GFM；Tool 输出使用结构化证据组件。

当前可操作的队员头像、显示名和 Mention 可打开同一个锚定人物信息卡，不导航。已离开、移除或
不可解析身份保持静态。精确 token 行为见[结构化 Mention](structured-mentions.md)。

## 消息回复与父引用

稳定的 user/agent 公共消息在内容列右上角与“复制”并列提供“回复”；鼠标悬停、消息内键盘聚焦或
粗指针环境下可见。optimistic message 在取得稳定 Message ID 前不提供回复入口。点击回复把同 Camp
父消息写入 Core Composer Draft，并在 Composer 内显示轻量无框 reply dock：正常状态不绘制独立边框、
底色或阴影；作者与有界摘要共用一个可视行，超出可用宽度显示省略号，末尾保留取消按钮。

鼠标点击“回复”后正文编辑器获得焦点和插入光标，但不得因为程序化 focus 改变 Composer 的边框、阴影
或增加包围框。键盘激活“回复”或通过 Tab 进入编辑器时，必须保留只作用于编辑器的可见
`focus-visible` 提示；不得用去除全部焦点反馈来实现鼠标无框。

回复当前可寻址 Agent 是一次明确的用户双意图：同一 Draft revision 设置 reply target，并插入或复用
可见 Member Mention。已有其他 Mention 时全部保留，
`@所有队员` 已覆盖作者时不重复插入。回复当前用户自己的消息只建立引用，不从原消息的历史 recipient、
作者或 reply relation 猜 Agent；无 Mention 时必须明确显示“默认由 Lead · {name}接收”。显式 Mention、
`@所有队员`、reply 或接收者修复已经足以表达路由，不再重复显示“实际接收者”汇总。

原作者已退出 Camp、变为 `away`、被移除或不可解析时，reply dock 保留引用，但不插入失效 Mention，
并原位显示“原作者当前不可接收，请选择其他成员”。发送保持阻断，直到用户从当前可提及成员中显式
选择；不提供“仍然发送”或自动改交 Default Lead。若作者在点击后才失效，Core rejection 后正文、附件、
引用和错误保持，替代选择必须移除失效作者 token 并写入新 Mention。

取消 reply dock 只清除 reply intent；正文中已经可见的 Mention 保持不变。accepted 消息在正文前显示
一层紧凑父引用，作者与摘要同样只占一个可视行，超出显示省略号；点击通过 same-Camp anchor load 定位并
聚焦原消息。父消息不可用时显示“引用的消息当前不可用”，不落到最近消息。不递归展开祖先、不缩进
时间线，也不创建私密 thread。失效作者错误和替代成员选择独立展开，不受单行引用规则裁切。领域与字段边界见
[Camp Composer Draft v2](../../contracts/camp-composer-draft-v2.md)，评审方向见
[HTML 交互稿](../../prototypes/message-reply-chain/README.md)。

正文编辑器的折叠光标位于绝对开头时，`Backspace` 等价于取消 reply dock：只清除 reply intent，保留正文、
附件和所有可见 Mention，并让光标继续停在正文开头。有选区、光标不在开头或 IME 正在合成时不得触发该
快捷行为，仍由结构化编辑器处理正文或原子 Mention。

## Recipient continuation

当最近一条已接受 user message 的最终路由恰好是一个非 Lead 成员，且当前 Draft 没有 reply、显式
Mention、修复或手动接收者修改时，Composer 输入面上方的独立无框路由轨显示“继续发给 @成员”。
路由轨与输入面共用同一条宽度轨道，但不计入正文编辑区高度。标签不是正文 Mention，也不创建父引用；
发送成功时 Core 才把对象物化为 canonical Structured Mention。

“已接受”以正式发布到公共会话为准：私有 Pending 入队不改变候选，自动出队发布后与手动发送一样刷新
空白 Composer 的 Core 路由投影，不等待新一轮执行结束。刷新不得覆盖已输入正文、附件、显式接收者或
已经冻结来源的 Draft；迟到的读取结果也不得覆盖其间开始的编辑或另一个 Camp。

标签与默认 Lead 文案占用同一行。标签出现时不显示默认文案；显式 Member Mention、多人 Mention、
`@所有队员` 和 reply 出现时两者都隐藏。点击标签的关闭按钮只取消当前来源延续并恢复
“默认由 Lead · {name}接收”；同一 source 在导航、重载或重新进入 Camp 后不得复现。

reply 比 continuation 优先。回复 Agent 后取消引用，自动加入的 Mention 保留，因此延续不恢复；回复用户
消息未产生 Mention 且用户未改址时，取消可恢复此前只被隐藏的标签。用户主动改变过接收者后，即使再删光
Mention，本 Draft 也只回到默认 Lead，不能让路由控件反复出现。

标签出现后对象在空白 Draft 失效时，标签消失并持久抑制该来源；正文或附件已经存在时，保留全部 Draft，
展开“原接收者当前不可接收，请选择其他成员”，禁用发送并把焦点交给第一个有效替代选择。不得隐藏错误、
自动插入失效 Mention 或改投 Lead。字段和竞态边界见
[Camp Composer Draft v2](../../contracts/camp-composer-draft-v2.md)，交互探索见
[延续路由原型](../../prototypes/composer-continuation-routing/index.html)。

## Camp 执行过程

同一 Camp 中每个曾有 AgentRun 的队员只保留一个 Agent 过程入口。按需详情 surface 以时间顺序展示
该 Agent 的独立 Run stage、状态、收件人与证据；这只是 Renderer grouping，不创建 Process
领域对象，也不合并 AgentRun。

首次安装或旧偏好没有位置字段时，执行台默认由详情浮层承载（`inspector`）；已保存的合法 `bottom` 或
`inspector` 选择保持不变。“移到底部 / 移到浮层”是唯一位置偏好写入口；最后一次成功的显式选择作为本机安装级偏好跨 Camp、
页面切换和应用重启生效，不新增 Settings 默认项。提交中控件不可重复触发；写成功后才移动，失败时
保持原位置并在控件附近提供可重试错误。Camp workspace 必须在偏好解析后以正确位置挂载，不得先显示
底部再跳到浮层。

显式移到详情浮层时，底部入口与详情完全移除，标题栏增加首个“执行”入口，并自动打开执行浮层。
默认采用浮层不等于默认展开；仍遵循下文 running Run 进入与精确导航规则。浮层最大宽 440px，受当前会话阅读区宽高约束，不挤占会话或文件预览。
移到底部后“执行”入口消失、浮层收起，横向队员过程入口下方打开可调高度详情，并保留最后使用的“任务 / 队员”基础选择。位置偏好只拥有承载位置，
不跨 Camp 保存 Agent/Run selection、Drawer 开合、Tool 全文或滚动位置，也不根据窗口宽度自动改变。
重新进入 Camp 时可以从当前权威 snapshot 推导最新 running Run；这是新的瞬时 selection，不是恢复旧
Drawer 状态，也不改写位置偏好。

两个位置共享当前 Agent 与精确 Run selection、Evidence load 和状态投影，不允许同时存在两套过程列表
或详情。位置切换通过稳定 host 移动同一个已挂载 Drawer DOM，保留 disclosure、加载状态、
Drawer/结果阅读位置与 DOM identity，不得条件卸载后重建。底部入口保持横向，显示头像、最多两行
队员名称和带形状的状态标记，不显示“当前正在执行”等状态文案。浮层内“执行台”和执行人数、队员总数
保持同行；队员入口改为单行、不换行的头像轨道，按固定成员顺序排列，不随执行状态重排。
头像右下角以不同形状表达运行、等待、完成、失败等状态；选中项使用 `--brand-soft` 和
`--control-line`。Hover 或键盘 Focus 显示“队员名称 · 当前状态”Tooltip；完整姓名、模型与执行状态
继续由下方详情 Header 展示，可访问名称保留完整身份与状态。

头像轨道隐藏传统滚动条，仅在对应方向存在隐藏内容时显示渐隐与左右箭头。箭头每次移动四个头像位置
（38px 按钮 + 6px 间距，共 176px，末端按剩余距离收敛），不按整页翻动；鼠标纵向滚轮转为横向滑动，
触控板横向手势保留原生滚动。`← / → / Home / End` 移动焦点，`Enter / Space` 打开过程。
外部精确导航必须把目标头像滚入可见区域，包括重复定位同一队员；滚动仅作用于轨道，不移动公共时间线。
切换队员、后台状态刷新或浮层收起重开不重置轨道位置，不跨 Camp 保存轨道滚动。
右侧详情占据剩余高度并独立滚动，不显示高度把手；
底部详情继续保留鼠标、键盘调高与 Main Window Session 内高度偏好。

打开过程入口时，先定位最新 running，其次最新 non-terminal，最后最新 terminal Run。用户显式
发送成功且未在查看 non-terminal Run 时，按 Core 有序回执打开首个 Run 的精确 stage，但不夺走
Composer 焦点。若用户正在可见的“任务”Tab 新建任务，Renderer 消费本次自动聚焦请求但不切走表单，
离开表单后也不补跳；仅浏览任务、编辑既有任务或查看队员仍按回执自动打开执行。右侧不可见的旧 Run
selection 不算“正在查看 non-terminal Run”。从其他 Camp、一级页面或应用启动/恢复进入当前 Camp 时，若
权威 snapshot 含 running Run，则自动选择 `createdAt + id` 最新者并展开；右侧 placement 同时显示 Inspector、
激活首个“执行”Tab，底部 placement 直接展开 Drawer，均不移动 DOM 键盘焦点。没有 running Run 时不自动
打开；`queued`、`waiting`、`recovery_blocked` 与 terminal 均不具备资格。用户已经停留在同一 workspace 时，
后台 A2A、Runtime 事件、refresh 或后续状态变化不得自动打开、切换或抢焦点。

聚焦 live Run 且用户停留详情底部时可跟随最新输出；手动上滚后暂停，回到底部恢复。该跟随
不能滚动公共消息时间线。Drawer 空间不足时收缩、滚动或变为摘要，不能遮住 Approval Dock、
Composer 或唯一 Stop。

已加载的正文片段与计划说明完整呈现，不按固定字符数只保留末尾；后续输出追加时不得裁掉正文开头或
破坏已有 Markdown 结构。实时投影与历史 Evidence 回读、底部与 Inspector 共用此规则；这不改变 Evidence
分页、显式截断标记或 Managed Blob 的存储与读取边界。

Task related execution、停止结果和世界地图入口在右侧承载时必须显示 Inspector、激活“执行”并打开
精确 Agent/Run。关闭详情只清除 selection，保留位置和队员入口；隐藏 Inspector 只改变可见性，再次
显示时保留“执行”Tab、Agent 与 Run。位置切换后焦点进入另一位置的对应切换控件，详情关闭/Escape
优先返回仍连接的真实过程入口，无法返回时落到当前位置切换控件。

命令、文件操作及其失败作为可展开 Tool Call 留在对应 Run stage。已读取 Evidence 中的 Tool chronology
完整保留，不用最后 N 项切片静默删除较早操作，也不增加第二条“较早 N 项”时间线。Built-in Tool 从
Core 公共 `result/error` 形成同一 Tool 行的详情，`camp.read/search` 不因顶层 `input/output` 为空而退化为
静态行；Envelope、request/receipt 和 canonical input 不进入详情或剪贴板。

同一 Run 内最大连续的 Tool items 默认收成一条可展开组摘要；narration、plan 与 diagnostic 都会截断
分组，不能跨 Run 或跨队员合并。有 running/waiting 操作时，活动组只显示“执行中/等待审批 · 当前操作”，
不再同时追加累计数。当前 Tool 已结算但尾组尚未收口时，继续显示“执行中 · <最近一条指令>”，不回退为
“已执行/已汇总 N 项操作”；成功、失败、停止和仅记录仍只在展开后的精确 Tool 行表达。终态同样只保留
一段主文案。

当已投影的最后一个 process item 是 Tool 组且父 Run 仍为 running 时，该尾组在当前 Tool 已结算后继续保持
provisional 活动态，显示“执行中 · <最近一条指令>”，也不在下方重复“正在处理”。这里“执行中”表达父 Run
仍在运行，不改写上一条 Tool 的真实终态；下一条连续 Tool 到达后只在同一组原位替换为新指令。
narration、plan、diagnostic、waiting/cancelling 或 Run 终态才构成真实收口边界。该规则按 process/Run 事实
判断，不使用时间防抖。
组内只要有一项成功，真正收口后的组使用绿色实心圆点；只有全部失败才使用红色失败菱形，其他无成功的
混合结果使用中性状态。绿色只表示“含成功操作”，不表示全部成功；完整状态仍由辅助名称和展开后的每条
Tool 行表达。组 summary 的左侧 16px 图标与摘要文字共享 16px 中心线，底部和窄 Inspector 使用同一结构。

用户展开后保持展开，新 Tool 与组终态只原位更新，不自动收起或抢焦点。展开组只显示全部 Tool summary，
完整结果仍须再展开精确 Tool；结果 region 在首次展开前不进入 DOM，Managed Blob 也不提前读取。收起组时
其后代不参与布局，底部与 Inspector 移动同一 Drawer DOM 时保留组、Tool 与已经读取的结果状态。

`activity-v2` 的 Tool 行由 Renderer 统一生成中文 presentation，Core 不再生成本地化默认标题或 Codex
`commandActions` 中文标题。Shell 行只要同一公开 payload 有 command，就优先使用完整脱敏预览：去掉外层
Shell `-c/-lc` 包装，保留参数、Node inline/heredoc 代码开头、全部子命令及
`&&`、`||`、`|`、`;`、`&`。已知 token、password、
Authorization、API key 与 `rovai send` 正文值替换为脱敏占位。标题值不做固定字符截断，由名称轨在真实
宽度内单行视觉省略；完整脱敏值仍可通过 `title` 与辅助技术读取。没有公开 command 的 Runtime 继续使用
非通用 title/toolName 与“终端操作”。File 行在 typed `runtimeFileOperation` 或单文件 available Canonical
Diff 有可靠 path 时显示 `修改 <basename>`，否则使用 toolName/title/“文件操作”；`tool.web.search` 固定为“Web 搜索”，普通 Tool
使用 canonical toolName/title/“工具调用”，Runtime 与 Unknown 使用对应中文 fallback。命令展示只改变
presentation，不得参与 identity 或 lifecycle 合并；ACP 仅由 Adapter 白名单的 command shape 在原生 kind
缺失时证明 execute。

Tool 行固定为 `16px 类型图标 / 可缩略名称 / 16px 状态轨 / 20px disclosure 轨`，不可展开行也保留末轨占位。
类型图标收敛为 Terminal、File、Web、Tool、Rovai、Runtime 和 Unknown 七类统一 16px 单色 SVG，不代表状态。
Rovai 图标使用四向星与弧形地平线及 `--rail-logo` 色，只由 Core Catalog 验证后的
`sourceAuthority=core + credibility=core_verified + toolName` 选择；Shell command 即使以 `rovai` 开头也仍用
Terminal 图标，Web semantic kind 优先用 Web 图标。
Tool 行尾状态仍只使用 7px 小点：运行蓝色、等待审批橙色、成功绿色、失败或停止红色，仅记录为中性色。
普通 Tool 行不再重复显示“已完成”文字；状态仍须通过 `aria-label` 与 `title` 可读取。

Shell command Tool disclosure 展开后第一行显示 `$ ` 加完整脱敏 command；存在完整公开 output 时从第二行
连续显示，不插入“命令 / 输出”标签或空白分隔行。两者的数据来源不得互相替代；Claude/ACP terminal
Evidence 自带 command，不依赖 Renderer 回看 started event。其他 Tool
disclosure 继续在原位渲染完整公开结果，不再截断，不再提供复制按钮。本地已有全文时
直接展示；截断 Evidence/Managed Blob 只在用户展开精确 Tool 行后读取。读取中、精确错误与
“重试”都留在该 disclosure，重试成功后焦点进入结果区域。全文置于固定最大高度的可聚焦
`role=region` 中，超出后内部滚动；Arrow、Page Up/Down、Space、Home/End 可滚动，Escape 只返回
对应 summary。Web 搜索 disclosure 只有在 `runtimeSearchOperation.status=available` 且 Canonical semantic 同时为
`tool.web.search` 时，才在第一行以 `搜索 ` 紧接 typed 公共 query；多项 query 以中文逗号按原顺序连接。存在
公开结果时从下一行连续显示，不插入“搜索词 / 结果”标签或空白分隔行。query 原样展示，不做敏感词过滤或去重，历史 Evidence 缺失 typed
projection 时不显示空占位。Web 搜索仍是 Tool item，计入所在连续组的“已执行 N 项操作”，组内使用 Web 图标；
Shell 结果面的左边界与 Tool 行 16px 类型图标的左边界同轴，不再缩进到标题文本轨；其他 Tool detail 保持
既有对齐。底部和 Inspector 复用同一行为。仍不显示
standalone raw Evidence、Envelope JSON 或独立
“查看完整工具调用”。精确合同见
[Run Process Detail Surface v26](../../contracts/run-process-detail-surface-v26.md)。

### Runtime 终态文件变更与 AgentRun 文件变化

只有 [Runtime File Change Observation v2](../../contracts/runtime-file-change-observation-v2.md)准入的可靠终态
Evidence 才进入文件变化呈现。成功 Edit/Write 的可靠单路径足以把原 Tool 行呈现为 `修改 <basename>`；没有
可靠内容时不显示 `+A −D` 或空 disclosure。有完整 before/after、unified snapshot 或 exact mutation 时，每个
文件作为同一 Canonical Activity 的 presentation row 独立展开。

当前 Runtime Host 的精确 `ROVAI_RUN_TMP` 是 Rovai 可重置的临时交付区，不是用户文件面。其目录内的 HTML、
图片或其他中间产物不显示为 `修改 <basename>`，也不进入 `Files Changed`；mixed 事件只展示其余普通文件。
已经持久化的历史卡片不重算。临时文件经 `rovai send --file` 发布后，附件由独立的 Camp Attachment UI 呈现。

Renderer 不显示 `apply_patch` 父行或“编辑了 N 个文件”聚合层，不从 Tool 显示名、output、命令文本或当前文件
推测变化，也不为逐文件行创建新的 Activity identity。文件行留在现有“已执行 N 项操作”集合内，集合计数仍按
Canonical Activity 计算。每行复用既有 File Tool 图标，顶格占满现有 Tool list 横条，不增加结构缩进。

Claude Code `Edit` 的 exact mutation 展开只显示 `− oldText / + newText` 片段，不显示 `@@`、旧/新文件行号或
推测上下文。同一文件连续 Edit 在 Command View 中仍按各 Tool 时序分别显示；Write、NotebookEdit、ApplyPatch、
失败/缺失 result 与 `replace_all=true` 保持普通 Tool Activity。

每个 terminal `agentRunId + executionEpoch` 可以在对应 Run 的会话位置追加一张独立卡片，标题固定为
`Files Changed`。卡片紧跟来源 Run 的最后一条公开消息；没有公开消息时才以完成时间定位。并行 Run 分别产生卡片，
不共享、不覆盖，也不会因相邻完成而视觉归属到其他队员。移除明确的 `runtime_diff_no_changes` 后，每个文件只要
仍有一个或多个可靠 Diff，就按既有归约显示逐文件 `+A −D`；同文件的 path-only operation 只保留在时序和
operation count 中，不阻止可靠 Diff 参与统计。只有所有文件都有可靠统计时，卡片显示
`N 个文件 · +A −D`；任一文件只有 operation-only 时，整张卡片回退为 `N 个文件 · M 次修改`。

文件名顶格排列且不使用横线分隔。display root 内文件显示相对路径，Runtime 明确报告的 root 外文件显示规范化
绝对路径。卡片默认显示三行，更多文件由“再显示 N 个文件 / 收起文件”在原位切换；不增加行间分隔。
header 右侧是浅边框、非品牌色且没有箭头的“查看变化”，hover/focus 使用轻微底色。点击 header、“查看变化”或任一文件行
在[文件预览区](file-preview.md#file-change-标签页)打开 `File Change·文件名` 标签页；从文件行进入时预选该文件。
卡片不显示时间、“已保存”、Git 状态、参与运行或
底部 metadata。

Review 与普通文件共用预览区和标签栏，正常双栏中保留左侧会话、Composer 与审批信息。
宽预览内部使用文件列表与 Evidence 阅读面；窄预览改用文件选择框，单文件省略切换控件。
完整净差异显示 unified diff 及可靠 hunk、旧/新行号；exact mutation 不显示 hunk、行号或推测上下文；history
保留全部 operation 的时序与计数，但只渲染有可靠 diff 的代码块，并将可见代码块从“修改 1”连续编号，不为
operation-only 记录生成空白占位块。exact mutation 与 history 不显示额外解释提示；operation-only 文件仍可选择，
右侧显示“没有可审查的差异内容”。“打开当前文件”通过既有来源校验打开普通文件 Tab，历史 Review 保留原
选择和阅读位置；关闭预览或在单 Pane 模式返回时恢复原会话，不默认跳转系统编辑器。

卡片只读取不可变 AgentRun projection 与受管 detail blob，不读取当前 workspace 或重新执行 Git。`no_changes` 和
没有可靠 Evidence 的 Run 不生成卡片；Review 也只读取同一 projection/detail，不补造行号或 diff。Git 与非 Git
项目行为一致。执行台不增加共享 workspace observation，
底部/右侧 placement、会话连接轨、Tool list 宽度和其他既有视觉结构保持不变。

使用“Agent 运行时默认”的 Run 在既有 `.execution-run-meta` 中保持一个模型字段：尚无可信观测时显示
“模型 Agent 运行时默认”，首次 Runtime-native 观测到达后原位收敛为“模型 {modelId} · 默认”。固定模型
不增加本版字段；运行中后续换模不覆盖首值。长 ID 使用等宽单行省略并允许键盘聚焦取得完整 title，底部和
Inspector 复用同一语义。刷新不得自动打开执行台、改变 Run selection、移动焦点或创建 Toast/时间线消息。

当权威 AgentRun 已取消时，该 Run 中仍为 running 的 Tool Call 停止所有运行动画，并以中性图形和
“已停止”作为主状态。该展示只表达父 Run 已失去继续执行权，不改写子活动的 Canonical phase/outcome，
也不隐藏独立的外部效果待确认提示；明确 canonical cancelled 的 Tool Call 同样显示“已停止”。精确合同见
[Run Process Detail Surface v26](../../contracts/run-process-detail-surface-v26.md)。

当前非终态 Claude Code Run 收到安全 `runtime_api_retrying` Evidence 时，在精确 Run 过程内显示 attention
notice：“Claude Code API 暂时不可用”，并显示最新重试次数、等待秒数和“本次执行尚未结束，可继续等待或
停止执行”。同一 diagnostic 只显示最新 attempt，底部“正在处理”同步改为等待 Claude Code 自动重试。
该状态仍是 running，不产生 Tool、Toast、消息或终态 failure；Run 终态后隐藏旧 notice，真实失败继续使用
下述 Runtime failure 边界。Renderer 只接受固定 code/status 与有界数字，不展示 raw stderr、API body、
凭证、用户名或绝对路径。精确合同见
[Run Process Detail Surface v26](../../contracts/run-process-detail-surface-v26.md)。

failed Claude Code 或 Antigravity Run 的公开 `failure` 必须在对应 Run stage 显示 Runtime 名称、安全
summary 与可选 detail；即使没有任何 Execution Evidence 也默认展开，不能被空详情逻辑隐藏。标题按
`origin` 固定为 Runtime 返回错误、与当前 Rovai 版本不兼容、本机运行环境不可用、Rovai 内部错误或
未能完成运行。只有 `origin=rovai` 可以显示“Rovai 内部错误”；Renderer 不读取或展示原始 stderr、私有
日志、内部 error chain 或 digest，也不从公开文本重新猜归因。

`waiting/recovery_blocked` 显示“结果待确认”，不得显示 spinner 或“恢复中”。Recovery Blocker
必须说明 Runtime 已接受任务、重启后最终结果未知、原请求不会自动重发，并提供唯一“结束此运行”
动作。成功后按权威 Snapshot 显示失败并把焦点返回 Composer；Renderer 不确认成功、不重发正文、
不创建 successor。精确合同见
[Run Process Detail Surface v5](../../contracts/run-process-detail-surface-v5.md)。

## Task、Approval 与停止

每个 Task 在创建位置只显示一张读取当前五态文案、标题和负责人的实时卡。Inspector list/detail
负责发现和完整责任审计，Agent 过程负责执行事实；Task 取消不等于 AgentRun 或 CampTurn 取消。

所有 pending Approval 位于 Composer 正上方的唯一非模态 Dock。Header 待审批入口显示总数，
Dock 内以队列计数和上一项／下一项导航呈现多项请求，保留 Runtime 原生选项、范围和决定身份。
Header/通知摘要只展开、定位并聚焦 Dock，不改变执行台位置或 Run selection，不强制切换详情内容；浮层按外部焦点规则收起。Approval 不进入消息时间线。

Dock 与底部执行台共用会话列全宽，不跟随正文或 Composer 的内缩轨道。单行顶栏显示当前请求摘要、
当前队员与 Runtime、队列导航和收起入口；命令与请求 JSON 原样展示，达到内容高度上限后局部滚动。
选项使用紧凑内容宽度按钮，严格保留 Runtime 的原始顺序、原生标签和 `optionId`，不显示 `consequence`，
也不通过翻译或术语替换改写 Runtime 文案。ACP 缺少有效 `name` / `label` 时直接展示 `optionId`；
Codex 无原生显示标签的决定由 Adapter 提供固定英文标签，响应值和作用域不变。

翻页保持刚触发的导航按钮焦点。边界按钮使用 `aria-disabled`，仍可保持焦点但触发无操作。
顶栏定位以及当前审批结束后接续下一项时只聚焦请求摘要；初次显示和普通刷新不主动聚焦决策按钮。
Reason 仅在空白归一化后与动作摘要完全相同或自身为空时隐藏，不作语义推断。其余原文默认两行预览，
超出时提供“展开全文 / 收起全文”，状态按审批 ID 隔离。容器宽度变化（含详情/文件区显隐与调整）时重新
计算溢出，不重置该审批的展开状态；完整说明始终可读，不因压缩而永久丢失。

Composer 中的 CampTurn Stop 继续是唯一整轮停止入口并 fence 当前执行树。共享 ExecutionDrawer 顶栏在
“收起”旁提供唯一 AgentRun Stop，只停止当前聚焦 Run；底部和 Inspector 复用同一个直接停止入口与状态。
Header、Task 卡、时间线和 Composer 不增加 Run-local 入口。`recovery_blocked` 继续只显示“结束此运行”，
不与普通 Stop 同时出现。Run-local 请求不创建 Camp 时间线消息；Turn-level 终态用户取消仍以一条“你已在
{耗时} 后停止”进入时间线。精确资格、required/optional 后果与不确定态见
[Run Process Detail Surface v26](../../contracts/run-process-detail-surface-v26.md)。

## 会话 Pane 紧凑布局

布局依据会话列自身的宽度，而不是整个应用窗口宽度。时间线与 Composer 所在的两行共用同一列，分别以
`conversation-pane` inline-size container 暴露此宽度，不重新挂载正文、Draft 或文件 Viewer。宽于 480px
保留标准布局；420–480px 使用紧凑排版。双栏的最小宽度、单 Pane 替换及比例记忆由
[文件预览](file-preview.md#结构与布局)拥有，不新增 Sidecar 或移动端导航模式。

- 时间线与 Composer 左右边距缩至 12px。Task 与 Files Changed 取消 42px 额外左缩进，使用当前正文轨道的
  可用宽度。普通消息自然换行，Markdown 表格与代码块使用自己的横向滚动。
- Task 状态图标缩至 26px，隐藏右侧 Chevron；标题自然换行，负责人、验收条件和更新时间继续 wrap。
  状态说明标题与正文改为上下排列，任务语义不删减。
- Files Changed 的 header 图标缩至 28px、间距收紧，标题与摘要允许单行省略，但保留“查看变化”文字。
  文件行保留路径、增删统计和箭头，优先省略路径，不隐藏可靠的 `+N / −N` 统计。
- Composer 优先收紧间距和隐藏非必要快捷键提示，底部操作允许换行；附件、Mention、Skill、发送和停止的
  点击区域不缩小。输入区不横向滚动，也不因尺寸变化丢失 Draft 或编辑器状态。
- 查找打开时临时隐藏会话/地图切换器，查找条占用右上角工具组主要宽度；关闭查找立即恢复切换器。
  快捷键从地图回到会话、查询与恢复阅读位置的既有行为不变。
- Approval 与 Runtime Recovery 继续位于 Composer 上方，宽度随会话列变化；关键说明不截断，操作可换行。
  较长审批内容在 Dock 内滚动，不能因为文件区变宽而移入详情浮层或消失。

## Camp Composer

Composer 与消息轨道共享中心轴但拥有独立宽度；`.composer-box` 与 `.composer-route-rail` 必须同宽、
居中、同轴，Inspector 显隐不得改变这些关系。发送、Stop、Approval Dock、
附件、Skill 候选、Mention、reply intent 和 continuation intent 都使用同一 Core-owned Draft；任何浮层
都不能建立第二份草稿真源。回复条位于附件队列之上、正文编辑器之内，并与 Composer 共用开放工作面，
不创建 focus trap。鼠标点击 Composer 任意位置都不增加编辑器内层描边；键盘进入仍保留局部焦点提示。

Composer 为空时根据当前用户可见的 Camp 会话/任务时间线选择输入提示：没有有效历史时显示
“集结队伍，写下这次冒险的目标…”；已有历史时显示
“和队伍继续前行：补充线索、调整方向或布置新任务…”。有效历史包括 user/agent 公共消息、Task 卡和
用户可见的停止结果；初始化 system 消息、已隐藏的 `a2a_event` / `task_event`、原始 Domain Event 与其他
内部记录不参与判断。该提示只由既有投影派生，不新增持久或 Renderer 状态，也不改变发送、任务、附件、
回复、延续或路由行为。

### Skill 快速选择

Composer 在折叠光标前的 `/query` 位于正文开头、空白或中文标点 `，。！？；：、` 之后时，打开当前
Lead 可用 Skill 的原生候选；已有正文不影响触发。查询词不包含空白、`/`、`@`，也不跨越结构化 token，
URL、路径和紧贴普通正文或 token 的斜杠不触发。输入、粘贴、删除和原生输入同步都从编辑后的结构化正文与
光标推导；选区先被输入替换为折叠光标再判断。候选来自真实
Skill/生效组 Read Side；每行在 28×28 紧凑槽位复用 Skill 管理页由名称缩写和持久 Skill ID 稳定色
组成的身份标记，但名称仍是主识别信息，身份色不表达启用、选中或健康状态。标记对辅助技术隐藏；
方向键移动并保持当前项可见，Enter/Tab 选择，Shift+Enter 换行，Esc 关闭；IME 合成期间不选择或提交。
光标离开查询范围、形成选区或正文不再满足触发规则时关闭。选中只替换当前 `/query`，保留前后正文，
创建一个原子结构化 Skill token；视觉与正文投影仍为 `/<skill-name>`，随后补一个可编辑普通空格，
已有空白时复用。token 保存稳定 `skillId/nameAtSend`；
手写、粘贴和旧 Draft 的 lookalike 永远保持普通 Text，不自动升级。

删除 token 一次删除整个结构化 identity；Draft 保存/恢复、undo/redo、IME、Mention、附件和发送边界继续
使用同一编辑器真源。Skill 后来 disabled/deleted/renamed 时 token 仍显示发送 Marker，不查询当前名称改写
正文。是否向某个 Run 提供 `SKILL.md` 文件链接由 Core 在发送时与 start time 分别判断；Composer 不显示
虚构的 Runtime load 状态，也不把 token 变成 Slash Command、附件或 Provider-specific Skill 控件。

### 结构化 Mention 与当前用户

队员 Mention 和 `@所有队员` 遵守[不得回退的交互合同](structured-mentions.md#不得回退的交互合同)。
Agent 的 Core-owned `--to-user` 在历史消息中显示同色但非交互的 `@当前用户` token；它不打开
人物卡、不进入 tab 顺序，且 `aria-label` 明确“提及当前用户：{显示名称}”。手写 lookalike 仍是
普通文本。该 token 是 Agent sanitized GFM 正文的行内前缀，不得为了交互 token 把正文退化为
纯文本；详细的 Markdown literal 防注入规则见[结构化 Mention](structured-mentions.md#current-user-mention)。

Message Mention 通知导航必须以 `campId + sourceMessageId` 加载和定位精确消息。通知抽屉关闭后才
滚动并转移焦点；来源不可用、渲染或聚焦失败时显示可恢复错误，不静默落到最近消息。无论从侧栏、恢复
位置还是通知动作进入，只要应用仍在前台、“会话”视图已展示且精确消息节点进入时间线可见视口，就应
确认对应 Mention；同一可见消息绑定的本轮终态也可精确确认。仅打开会话、停留地图或看到屏幕外历史
不会批量已读，DOM 键盘焦点不是普通阅读的附加门槛。

### Composer 附件

文件和目录都进入当前 Draft。preparing/error 附件阻止发送；目录保存为一个只读快照附件，原文件
不移动。正文非空或至少存在一个 ready 附件时才可发送；submit guard 与按钮必须共用该判断，不能只放宽
视觉控件。纯附件消息保留完整时间线外壳、作者、时间、复制/回复和附件卡，但不渲染空正文气泡，也不生成
占位正文。拖放命中、反馈和卡片合同见[会话区文件与文件夹拖放](conversation-drop-zone.md)，领域与
快照限制见 [Camp Attachment v5](../../contracts/camp-attachment-v5.md)，发送边界见
[Camp Composer Draft v4](../../contracts/camp-composer-draft-v4.md)。

Timeline Attachment Card 必须投影 `runtimeProjectionState`。`pending | recovery_required` 使用低强调的
“正在准备供队员读取”，不得伪造百分比或进度；`failed` 明确显示“队员读取不可用”。该状态只描述队员
Runtime View，不禁用用户对仍完整 Authority Attachment 的预览、打开或显示所在位置。状态使用既有
Porcelain Day / Steel Night 语义 token，不引入新的视觉世界，也不暴露 Authority/View 路径或内部 operation ID。

图片单击继续打开会话内大图预览；图片 Authority preview 失败时，卡片退化为“使用系统应用打开”。普通
文件单击交给系统默认应用，目录单击在 Finder / 文件资源管理器中打开。Timeline 卡片右键菜单提供同一
主动作和“在 Finder / 文件资源管理器中显示”；菜单支持键盘循环、Escape 关闭、collision handling 与关闭后
焦点回到真实卡片。执行中单卡防重复提交；目标 parent 不可枚举、target 消失或 native 请求失败时均显示固定
的无路径提示，不把 best-effort Shell dispatch 当作文件管理器已确认选择。高风险文件由 Desktop Main 使用原生
确认，不在 Renderer 判断。Composer Prepared Attachment 保持既有预览/移除交互，不复用 Timeline open API。
精确安全与结果合同见 [Camp Attachment v5](../../contracts/camp-attachment-v5.md)。

## 空 Camp 欢迎状态

空 Camp 显示欢迎图形、真实协作配置摘要和三个只填充 Composer 的起步建议，不显示单行空占位。
建议不会直接发送、不会创建假消息，也不会改变已保存协作配置。

## Camp 详情浮层

标题栏使用直接入口，默认浮层位置（`inspector`）的顺序为“执行 / 任务 / 队员”；底部位置（`bottom`）时为“任务 / 队员”。
DOM、视觉和键盘顺序一致；不再提供常驻侧栏、独立折叠按钮或文件预览开关。执行入口只在有 `running` Run
时显示 loading，queued、waiting、recovery_blocked 与 terminal 不显示旋转状态。计数读取真实 Camp 投影，
不能将 coverage 未加载的数据表达为不存在。

所有入口共用一个非模态详情浮层，位于消息阅读区右上方，最大宽 440px，四周保留间距。浮层不覆盖
Approval/Recovery Dock、Composer 或文件预览，不改变会话网格列宽。点击当前入口再次收起，点击其他入口
切换内容；外部点击或焦点移出收起，Esc 收起并返回触发入口。菜单和任务 Dialog 保有自己的焦点边界；执行
详情与 Tool 结果继续使用既有 Esc 层级。键盘打开浮层时将焦点移入，后台刷新不抢焦点。

三个浮层共用 `--inspector-surface` 阅读底色、2px Steel 顶部色线和固定头尾栏。首行按“图标 / 执行、任务或队员 / 当前会话 / 关闭”排列，
底栏右侧显示 `Esc 收起`，左侧分别为“连续执行历史”“任务取消不等于执行停止”“仅管理当前会话队员”。
内容区独立滚动，头尾栏始终可见；执行台内部的颜色、列表与工具输出样式不随浮层外壳改变。

浮层开合只在当前工作区内保留，不读取旧的侧栏显隐偏好。进入没有 running Run 的 Camp 时默认收起；进入
含 running Run 的 Camp、显式移动到浮层或精确执行导航仍遵循上面的自动展开规则。切换内容或收起浮层不得
重建执行 Drawer，不得丢失 Agent/Run selection、已展开 Tool、已读结果或滚动位置。

任务区使用状态筛选和紧凑列表：标题、状态、负责人、验收条件数量，以及必要的阻塞原因。点击列表或时间线
任务卡打开只读详情；说明、完整有序验收条件、阻塞/完成/取消原因、关联执行与可展开审计均保留。新建和编辑
使用标准 Dialog；在当前 Camp 工作区内关闭 Dialog、切换详情或收起浮层保留各任务独立草稿，重新打开继续
编辑。草稿不跨 Camp 卸载或应用重启持久化。版本冲突刷新权威版本，保留草稿并要求用户再次提交；已结束任务
只读。取消任务使用填写原因的独立确认 Dialog，仍不取消已接受或运行中的执行。

队员区读取当前 CampMember 与 AgentProfile。队长以队员行徽标表达，“设为队长 / 查看模型信息 / 移出当前
会话”集中在该行菜单，不显示单独队长选择框或常驻操作说明。队长资格、版本检查、邀请候选、移出预览和在途
收拢仍由现有 Core 命令负责。ContextManifest 与 Runtime Input Delivery Evidence 不进入普通详情；审批继续
只在 Approval Dock 决定。

## Camp 顶栏与关闭等待面

项目目录与会话名称统一使用 UI 字体、`12px / 400`；项目目录使用 `--faint`，会话名称使用 `--ink`。
会话名称保留 `<h1>` 语义、单行省略和现有响应式布局，不再加粗；顶栏不显示“第 X 天”标签。
会话日期分隔保持本地自然日分组，只显示完整年月日（例如 `2026年8月31日`），使用 `11px / 400` UI 字体，
不使用等宽字体、星期或 `DAY N`。消息时间戳、详情入口、消息、任务卡片、文件变化卡片和 Composer 保持既有呈现。

Camp Header 显示会话定位、待审批摘要和详情直接入口；文件 Tabs 占据独立文件列。不增加 Stop、分享或 `•••`。主动退出、
重启或更新立即阻止新的界面交互；400ms 内完成则直接退出，超过门槛才显示无操作按钮的 modal 关闭等待面。
标题为“正在安全退出”，正文说明正在保存本地状态并关闭后台服务，并以条件文案说明尚未完成的 AgentRun
会一并取消。关闭开始后不再刷新 Camp 投影，取消结算产生的晚到请求拒绝也不显示为错误横幅或 Toast。
稳定快照后的全部非终态 AgentRun 使用普通终态“已取消”；无法确认的外部效果继续显示
“外部效果待确认”，不得被终态文案隐藏。普通 CampTurn Stop 继续显示“已取消”。精确边界见
[Planned Shutdown v3](../../contracts/planned-shutdown-v3.md)。

## Theme, keyboard and failure states

Day/Night 复用同一 DOM 和状态矩阵。主要操作支持键盘；Drawer、stage、Dock、menus、disclosure
和 Stop 均有可见焦点。Loading、Empty、Partial、Error、Disabled、Submitting 与 Recovery 必须
保留当前上下文、草稿和可恢复导航，而不是用通用错误页覆盖整个工作区。

## 连续消息与待发送编辑

Composer 输入和 Runtime 进度刷新不重新解析正文未变的历史 Markdown；文件链接、标题跳转回调和
本地图片投影仍使用当前权威。仅作为叙述分界的 thought/reasoning 事件保留顺序，但不单独触发 React
刷新；可见 Runtime 进度在短窗口内批量呈现，不截断事件或丢失文本 delta。私有待发送队列按变更事件、
前台恢复和 Core 重连刷新，不每秒轮询；入队本身不触发公共会话或侧栏全量读取。

执行期间 Composer 保持可输入，右侧主操作始终只有一个按钮：输入框没有正文（含仅空白字符）时显示“停止”，
有正文时切换为“发送”，删空后恢复“停止”；空闲时只显示“发送”。空输入框按 Enter 不触发停止。
发送动作的文字始终为“发送”，提交或准备附件期间仅禁用按钮并暴露 busy 状态，
不改成“加入待发送”或“提交中”。队列未空时，即使当前
没有运行也继续入队。队列条位于 Composer 上方，与输入框同宽、同轴，按 FIFO 排列，不显示单条
序号，不提供排序或合并；较长队列在有界区域滚动。Pending 不作为用户消息显示在公共时间线。
普通排队不额外显示自动续发说明；编辑时不再显示队首等待、编辑标题或本地草稿说明，
仅保留当前编辑行的状态标识和保存、取消操作。发送失败或编辑占用失效等需要处理的情况仍显示错误提示。

队列继承现有系统字体栈，正文为 10.5px；普通行最小高度为 32px，以 6px 空心圆点起行。普通底色
由 `--surface-subtle` 44% 与 `--conversation-surface` 混合，编辑底色由 `--brand-soft` 42% 与同一
会话底色混合，配合轻边框和“正在编辑”文字区分状态。Day/Night 沿用各自语义 token，不新增全局字级或控件样式。

队列正文和行背景仅展示，不响应编辑；只有右侧独立的 24px 小铅笔按钮在同一个输入位置打开编辑。
普通草稿独立保留，结束编辑后恢复；删除使用相邻的独立按钮。编辑正文继续使用 StructuredMentionComposer，
支持 @成员、@所有队员及取消已有 Reply。保存不能提交空消息，并保留原队列位置。切换编辑项或关闭编辑
遇到未保存修改时提供“保存 / 放弃修改 / 继续编辑”，不静默丢弃。

Core 编辑占用跨重启保留，刷新或重新进入 Camp 不自动认领或释放；恢复条提供“重新编辑 / 放弃未保存修改 / 删除”。
未保存修改只在 Renderer 内存，异常退出可以丢失，重新编辑从已保存内容开始。等待编辑的队首阻塞后续输入，
后面一条的编辑不阻塞前面消息。

Composer 点击一次“停止”后，必须等当前执行完全停止，才自动发送队首一条；其余输入等待新一轮结束后按 FIFO 自动继续，
不提供“暂停队列”或“继续发送”入口。上一轮正常结束、失败终态或停止完成都按同一规则推进，
仍等待现有编辑、审批、恢复或运行状态结算。队首发送失败时原位展示错误，用户编辑保存后自动再次准入，
或删除后让下一条继续；不隐藏失败、不自动重试，也不让后续消息越过队首。

普通草稿带有附件而需要排队时禁用提交并说明“暂不支持排队附件，草稿已保留”。待发送编辑禁用按钮、
粘贴和拖放附件。持久化和原子发布由 [Pending Camp Input v1](../../contracts/pending-camp-input-v1.md) 拥有。
