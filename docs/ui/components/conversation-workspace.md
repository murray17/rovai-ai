---
document_type: ui-component-contract
authority: renderer-camp-workspace
status: accepted
last_updated: 2026-08-17
---

# Camp 会话工作区

Camp 是开放阅读面，不按角色铺不同底色。时间线、Agent 执行台、Approval/Recovery Dock 和
Composer 共享主列；Inspector 是右侧辅助列。普通叙述保持 `76ch` 阅读宽度，代码、表格等工件
可以扩展到 `930px`，宽会话轨道与 Dock 上限保持 `1040px`；Composer 常规上限为 `1040px`，
viewport `>= 1800px` 时独立扩展到 `1440px`。

## 打开与渐进历史

Camp 的首个 meaningful paint 只依赖 [Camp Open Projection v1](../../contracts/camp-open-projection-v1.md)：
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

terminal Run Evidence 继续在用户展开精确 Run 后按需加载；关闭的 Drawer、隐藏 Inspector 或世界地图
不得触发完整历史预取。普通 event refresh 使用轻量 open projection，并保留用户已经加载的较早消息、
Draft、滚动位置、Inspector 选择和地图模式。

冷启动恢复与应用内切换的呈现边界不同。Main Window Session 一旦给出恢复目标，全局 StartupGate 必须
关闭并显示对应一级页面框架；Camp shell 可暂时显示标题区、局部状态与结构占位，但不得伪装成 meaningful
content，也不得在 `camps.enter` 成功前提交 active Camp。Members 与 Memory 同样在自己的内容区域读取，
不能继续占用全屏“正在恢复上次位置”。失败留在局部 surface 重试；仅明确 `camps.exists === false` 的已删除
Camp 可以回到 Quick Chat。Notification navigation、恢复位置写入和已读确认要等权威 route commit。

## 常规会话与世界地图

会话阅读面可以在常规时间线与沉浸世界地图之间切换。切换入口与地图路线显隐使用阅读面内的紧凑
悬浮控件，不占用 Camp Header 或独立工具栏；左侧导航、Inspector、Approval/Recovery Dock、Composer
与 Agent 执行台保持当前用户选择的承载位置和权威。切换不得清空时间线滚动、Draft、Inspector 选择、Approval、
执行台焦点或正在接收的真实活动更新。

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
按 Camp 播种的随机流；首次尝试在 6–12 秒，后续尝试按事件开始间隔 22–34 秒，事件展示 5.6 秒。
同一参与者在单人或偶遇事件后至少 55 秒不得再次出现，同一偶遇 pair 额外至少间隔 120 秒；近期 ID、
主语义类别和节点历史去重不得通过重抽概率或无限重试制造偏差。偶遇只在存在同节点、静止、合格 pair
时按单次条件抽样出现，并使用一个共享气泡，不复用真实 A2A 会合状态、颜色、交互或临时头像位移。
角色路径动画必须以合成层位移更新，避免逐帧改写布局坐标；Renderer 快照刷新不得重新绑定未变化的
角色或路径 DOM 引用。

任意真实执行或 waiting speech 存在时，全局禁止并立即撤下闲时事件；节点、运动、A2A 或强制移动条件
失效时也必须撤下。底部文字仲裁固定为真实执行、waiting、偶遇闲时、单人闲时的降序。紧凑布局统一
使用底部单行字幕；7 人及以上可以保留真实气泡，但没有真实播报时必须以 waiting/闲时字幕回退，不能
直接隐藏环境内容。真实或 waiting 字幕保留其既有可操作语义；闲时字幕是非交互静态文字，不进入
`aria-live`。

地图必须按会话容器而非窗口高度适配：Inspector 显隐和可上下拖动执行台压缩主列时，地图收缩、裁切
或降低次要信息密度，不能遮住 Approval/Recovery Dock、Composer 或执行台。静态模式与 reduced motion
停止角色移动、路线流光、脉冲和会合动画，但不能停止 Snapshot/Runtime 驱动的真实文字更新，也不能
关闭无动画的静态闲时文案。

## A2A 会话消息

Agent 公共正文不显示“来自执行”来源条，也不投影 compact 投递卡。已交付 A2A 消息只在正文后
显示简短转交轨迹“发送给 @队员”；底层 Delivery 状态、失败码和恢复事实仍由 Core Read Side
拥有，不在 footer 或 Run stage 重复展示。

用户、队员和已交付 A2A 正文支持原生鼠标拖选与系统复制。整条消息使用可见文字“复制”作为入口，固定在
内容列右上角，只在悬停或键盘聚焦消息区域时显现；不能退回只有图标的含糊操作，也不能随正文、宽屏
工件或 footer 漂移。用户消息保持
精确纯文本；Agent 正文使用清洗后的 GFM；Tool 输出使用结构化证据组件。

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

执行台默认位于时间线底部：横向队员过程入口下方打开可调高度详情。用户可通过具名操作把同一执行台
移到现有 Inspector；此时底部入口与详情完全移除，Inspector 临时增加“执行”第三 Tab，并自动显示、
激活该 Tab。右侧使用既有 310px / compact 260px 宽度，不新增可拖宽 Sidecar。移回底部后恢复用户
切换前最后使用的“任务 / 队员”基础 Tab；新 Camp workspace 和应用重开仍从底部开始。

两个位置共享当前 Agent 与精确 Run selection、Evidence load 和状态投影，不允许同时存在两套过程列表
或详情。底部入口保持横向；右侧入口改为全宽纵向行，按 CampMember 顺序显示头像、名称和非颜色状态，
最多约四行，更多队员在列表内部滚动。右侧详情占据剩余高度并独立滚动，不显示高度把手；底部详情继续
保留鼠标、键盘调高与 Main Window Session 内高度偏好。

打开过程入口时，先定位最新 running，其次最新 non-terminal，最后最新 terminal Run。用户显式
发送成功且未在查看 non-terminal Run 时，按 Core 有序回执打开首个 Run 的精确 stage，但不夺走
Composer 焦点。若用户正在可见的“任务”Tab 新建任务，Renderer 消费本次自动聚焦请求但不切走表单，
离开表单后也不补跳；仅浏览任务、编辑既有任务或查看队员仍按回执自动打开执行。右侧不可见的旧 Run
selection 不算“正在查看 non-terminal Run”。后台 A2A、Runtime 事件、重载与恢复不得自动打开、切换或抢焦点。

聚焦 live Run 且用户停留详情底部时可跟随最新输出；手动上滚后暂停，回到底部恢复。该跟随
不能滚动公共消息时间线。Drawer 空间不足时收缩、滚动或变为摘要，不能遮住 Approval Dock、
Composer 或唯一 Stop。

Task related execution、停止结果和世界地图入口在右侧承载时必须显示 Inspector、激活“执行”并打开
精确 Agent/Run。关闭详情只清除 selection，保留位置和队员入口；隐藏 Inspector 只改变可见性，再次
显示时保留“执行”Tab、Agent 与 Run。位置切换后焦点进入另一位置的对应切换控件，详情关闭/Escape
优先返回仍连接的真实过程入口，无法返回时落到当前位置切换控件。

命令、文件操作及其失败作为可展开 Tool Call 留在对应 Run stage。超长 Tool 输出只渲染有界的
开头预览；完整内容由轻量、Icon-only 且有可访问名称的复制控件按需从 Core 读取，不能为了复制
先把全文挂载进 Drawer。复制失败保留预览并原位说明，证据使用 evidence token 与等宽结构。

`waiting/recovery_blocked` 显示“结果待确认”，不得显示 spinner 或“恢复中”。Recovery Blocker
必须说明 Runtime 已接受任务、重启后最终结果未知、原请求不会自动重发，并提供唯一“结束此运行”
动作。成功后按权威 Snapshot 显示失败并把焦点返回 Composer；Renderer 不确认成功、不重发正文、
不创建 successor。精确合同见
[Run Process Detail Surface v5](../../contracts/run-process-detail-surface-v5.md)。

## Task、Approval 与停止

每个 Task 在创建位置只显示一张读取当前五态文案、标题和负责人的实时卡。Inspector list/detail
负责发现和完整责任审计，Agent 过程负责执行事实；Task 取消不等于 AgentRun 或 CampTurn 取消。

所有 pending Approval 位于 Composer 正上方的唯一非模态 Dock。多项请求显示“N 项待审批”，
保留 Runtime 原生选项、范围和决定身份。Header/通知摘要只展开、定位并聚焦 Dock，不改变
Inspector 显隐或页签；Approval 不进入消息时间线。

唯一 CampTurn Stop 占用 Composer 的发送位置并 fence 整棵当前执行树。Header 和过程详情不再提供
Agent/AgentRun 级 Stop。终态用户取消以一条“你已在 {耗时} 后停止”进入时间线；未确认外部效果
从相应详情进入 Inspector。

## Camp Composer

Composer 与消息轨道共享中心轴但拥有独立宽度；`.composer-box` 与 `.composer-route-rail` 必须同宽、
居中、同轴，Inspector 显隐不得改变这些关系。发送、Stop、Approval Dock、
附件、Skill 候选、Mention、reply intent 和 continuation intent 都使用同一 Core-owned Draft；任何浮层
都不能建立第二份草稿真源。回复条位于附件队列之上、正文编辑器之内，并与 Composer 共用开放工作面，
不创建 focus trap。鼠标点击 Composer 任意位置都不增加编辑器内层描边；键盘进入仍保留局部焦点提示。

### Skill 快速选择

Composer 为空或正文被完整选中时输入 `/`，打开当前 Lead 可用 Skill 的原生候选。候选来自真实
Skill/生效组 Read Side；方向键移动，Enter/Tab 选择，Esc 关闭。选中创建一个原子结构化 Skill token，
视觉与正文投影仍为 `/<skill-name>`，随后插入一个可编辑普通空格。token 保存稳定 `skillId/nameAtSend`；
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
不移动。拖放命中、反馈和卡片合同见[会话区文件与文件夹拖放](conversation-drop-zone.md)，领域与
快照限制见 [Camp Attachment v1](../../contracts/camp-attachment-v1.md)。

## 空 Camp 欢迎状态

空 Camp 显示欢迎图形、真实协作配置摘要和三个只填充 Composer 的起步建议，不显示单行空占位。
建议不会直接发送、不会创建假消息，也不会改变已保存协作配置。

## Camp 右侧详情栏（Inspector）

默认底部执行台时，ordinary Inspector 只有“任务 / 队员”。Task 提供列表与详情责任层；队员读取当前 CampMember 与
AgentProfile，并通过既有 versioned Core 命令提供唯一 Default Lead 选择器。ContextManifest 与
Runtime Input Delivery Evidence 继续存在于 Core/Snapshot，但不进入普通 Inspector；审批只在
Approval Dock 决定。

仅当用户把执行台移到右侧时，Inspector 增加条件式“执行”第三 Tab；它承载同一 Agent 过程详情，
不是新的 Activity/Audit timeline，也不改变 Task、队员、Default Lead 或 Approval 边界。移回底部后
该 Tab 从 DOM 和键盘顺序中消失。

Inspector 可从 Camp 顶栏完整隐藏/恢复，常规宽 310px，`1040–1179px` 为 260px。隐藏不会改变
当前页签、Draft、选择或消息滚动位置。

## Camp 顶栏与关闭等待面

Camp Header 右侧只保留待审批摘要和 Inspector 显隐，不提供执行入口、Stop 或 `•••`。主动退出、
重启或更新进入无操作按钮的 modal 关闭等待面：可访问标题/说明明确“正在等待可靠终态”；无法确认的
执行也会停止，同时保留外部效果现场。Runtime 明确因 planned shutdown 取消的 Run 显示“已停止”；
product fence 收敛的 Run 使用普通终态“已取消”，并在有未知效果时同时显示“外部效果待确认”；普通
CampTurn Stop 继续显示“已取消”。未知外部效果警告不得被终态文案隐藏。精确边界见
[Planned Shutdown v2](../../contracts/planned-shutdown-v2.md)。

## Theme, keyboard and failure states

Day/Night 复用同一 DOM 和状态矩阵。主要操作支持键盘；Drawer、stage、Dock、menus、disclosure
和 Stop 均有可见焦点。Loading、Empty、Partial、Error、Disabled、Submitting 与 Recovery 必须
保留当前上下文、草稿和可恢复导航，而不是用通用错误页覆盖整个工作区。
