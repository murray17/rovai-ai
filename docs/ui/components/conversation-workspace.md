---
document_type: ui-component-contract
authority: renderer-camp-workspace
status: accepted
last_updated: 2026-09-24
---

# Camp 会话工作区

## Public Camp v1.60 当前边界

- 已激活 Camp 的输入内容不进入 Core Draft/Pending；Desktop 按 Camp 保存本机快照，切换、刷新、重建窗口和普通重启后恢复。
  发送失败或结果未知保留当前内容，确认发送成功才清空已发送快照。
- 等待阶段在执行台展示由 Delivery 支撑的“排队消息”卡，但不伪装尚不存在的 AgentRun，也不提供 Run 停止入口。
  Scheduler claim 后才出现真实 Run，并由真实 Run 接管后续状态与停止语义。
- 执行区“停止”只 CAS 当前精确 Run。没有公屏通用停止、队列暂停/恢复、Camp 全部停止、业务重试或手工放行入口；终态后队列按正常规则继续。
- accepted/outcome-unknown 对用户显示普通红色失败，不显示“结果未知”产品状态；诊断和 evidence 仍保留内部真实分类。旧执行尚未隔离时，后继消息继续显示等待，不制造必败 Run。
- 本地用户消息仅在首次目标 claim 前显示撤回；成功后时间线可显示“你撤回了一条消息”。Agent 主动读取可在 claim 前看到原文，撤回后 `camp.read` 仅在原序号返回 `Message withdrawn` 状态项，搜索不再命中原文。
- Channel-bound Camp 的 Agent 公共发言默认外发；没有 `--to-channel` 或 Run 级外发开关。
- 本地用户或 External Principal 的公开消息使用 `addressMode=default` 且只有一个冻结
  `addressedAgentId` 时，历史气泡在正文前派生该队员的 Member Mention；附件-only 消息也显示该 Mention。
  身份取自消息快照，名称与可用状态沿用当前成员目录。该前缀只属于 Renderer 展示，不写回用户正文或
  Structured Content，也不进入复制、选文引用、搜索、`camp.read` 或渠道正文；显式寻址、广播、零/多接收者和
  Agent 发言不增加前缀。

字段与状态见 [Message Delivery v10](../../contracts/message-delivery-v10.md)、
[Camp Composer Draft v15](../../contracts/camp-composer-draft-v15.md)和
[Camp History v10](../../contracts/camp-history-v10.md)。本文件后续仍描述的 Core-owned public Draft/Pending、
CampTurn Stop、Gather 或业务重试均为历史交互，不再适用于当前 public Camp；本机草稿与 recipient
continuation 是当前 Desktop 行为。

## 成员 Fast 响应模式

成员浮层与执行详情顶栏只为合格 Claude Code/Codex 绑定显示 Fast 胶囊；资格和作用域见
[Camp Member Fast v1](../../contracts/camp-member-fast-v1.md)。保留既有行高、头像/名称层级和末尾操作菜单。
胶囊视觉 20–22px、实际目标至少 28px、字体不低于 10.5px；使用现有语义主题 token，开启不只依赖颜色，
同时填充闪电图标。开启使用中性选中底色和 `--conversation-action`，不使用品牌蓝；未知默认采用中性样式，可访问名称说明由 Runtime 继承，不承诺首次执行后显示实际状态。
按钮不显示悬浮或焦点提示框，保留键盘焦点样式。

点击直接切换并保存，不显示费用提示或二次确认；成员菜单不显示手动检测或恢复默认项。
切换仅保存当前 Camp 该队员后续执行的意图，不显示保存成功或运行中切换提醒。按钮不显示 cooldown、实际档位或
请求不一致警告；Runtime 观测只留在 Run 记录/监控，不影响选择。保存失败才显示错误并保留原状态，按钮不重建，
焦点保持在触发按钮。进入 Camp 工作区后，仅对缺少有效结果且没有在途请求的活跃 Claude/Codex 队员静默检查；
支持时显示胶囊，不支持或失败时保持隐藏，不显示 loading、检测完成通知或错误 Toast，也不阻止其他队员切换 Fast。
支持与不支持的结果跨展开/收起和浮层 Tab 切换复用；失败在下次展开重试，绑定或模型变化后自动重测。
检查不依赖浮层显隐，迟到的旧绑定结果不得恢复入口；缓存只存在于当前 Camp 工作区，不增加持久状态或接口。
执行详情与成员浮层共用按 Camp/member 隔离的偏好、资格和保存状态；保存一名队员时，其他队员不变暗且可独立操作。
无关投影刷新不重置已确认选择。执行详情右侧按 Fast → 停止 → 收起排列，间隔分别为 16px、8px；
Fast 资格未知时只保留紧凑槽位。停止复用删除会话的 `--danger-soft` 背景和 `--danger` 字色，日夜主题一致。

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

Camp 的首个 meaningful paint 只依赖 [Camp Open Projection v24](../../contracts/camp-open-projection-v24.md)：
Camp/成员、最近消息、当前运行摘要、pending Approval 和 Composer 可用即完成。项目导航恢复、侧栏刷新
与可见来源确认在首屏后执行，失败不能撤销已打开会话。只显示“正在打开对话”的 Shell 不算完成。

Open schema 8 不返回审计 timeline；Renderer 适配 Snapshot 时使用空 timeline，并清空包括已加载旧页在内
的消息 `timelineGlobalSequence`。会话仍显示消息、Task、Stop 与 Files Changed：消息按 Camp-local
`sequence`，卡片按业务时间、显式类型顺序和稳定 ID 分别排序后合并。同时间依次为消息、Task、Stop、
Files Changed；时钟回拨时消息 sequence 优先，不能用非传递比较器混排。Files Changed 仍锚定在其来源 Run
最后一条公开消息后。Task 详情保留业务状态原因、责任与时间，去掉从审计事件推断的可选“审计原因”。

应用内打开另一个 Camp 时，Renderer 不得在投影返回前提交目标 Camp ID、目标项目或空 Snapshot。缓存
未命中时保留当前 Quick Chat、Camp、成员、记忆或设置工作区，投影到达后一次性提交目标 Camp；有效缓存
命中时可以先恢复缓存阅读面，再用权威投影刷新。常规预算内打开不显示 loading；超过 400 ms 才在目标
侧栏行显示低强调度、非阻塞进度。打开失败保留原工作区并原位报告，快速 A→B 切换只允许最新 selection
提交。不得用整页 loading、提前改变项目导航或扩大缓存掩盖等待时间。

投影 coverage 不完整时，UI 必须把历史表达为“尚未加载”，不能表达为“不存在”。会话时间线顶部提供
低强调度“加载更早消息”；加载时保持现有消息可读、按钮显示忙碌状态，失败原位允许重试。较早页 prepend
后保持用户当前阅读锚点，不跳到顶部或最新消息。没有 earlier history 时不显示该控件。

Camp open/refresh 仅返回最多 96 个 Run 摘要与每个返回 Run 的原始 Evidence 计数；它不计算或返回全 Camp Evidence 总数。可见展开的 Run 才读取执行窗口，按详情高度估算首屏项数，
并预取相邻更早一页。滚到边界或点击后才翻页，只挂载视口附近的内容；完整历史可继续按需访问，关闭的 Drawer、
隐藏 Inspector、收起的 Run 与世界地图不读取历史。活动操作可补充到最新页，原始 Evidence 不被删除。
普通 event refresh 保留较早消息、Draft、阅读位置、Inspector 选择和地图模式；在途执行刷新不覆盖历史阅读。

用户主动提交消息时，时间线立即回到最底部并恢复 follow-latest；optimistic 用户消息和随后的权威回执
渲染完成后仍须保持在最新位置。其他新增消息只有在用户原本位于底部附近时才自动跟随，用户手动上滚
阅读较早内容时不得被后台消息抢走位置。

### 回到最新

会话时间线、执行台（底部或详情浮层）与单聊共用一个悬浮向下箭头：36px 中性圆形外观，
44×44px 独立点击区域，位于所属阅读区底部中央，圆形距底边 12px。不占正文行，不放入 Run 摘要或
展开／折叠行；每个阅读区最多一个。按钮按下只改变底色，不改变位置；边角和整次指针操作由按钮接住，
不会触发下面的 Run。保留可访问名称、悬停说明、键盘 Enter／Space 和可见焦点。

向上阅读且离底部超过 96px 时显示；回到 24px 内或内容不足以滚动时隐藏。执行最新缓存尚未恢复到
当前窗口时仍保留入口。没有新内容时只显示箭头；阅读历史期间收到新回复／输出时加一个亮蓝小点，
可访问名称说明“有新回复／输出，回到最新”，不编造未读数量。旧的单聊“有新回复 · 查看”合并到此入口。
会话查找期间保留查找自身的定位和恢复流程。

点击只把所属阅读区带到底部并恢复其既有跟随状态；执行台同时恢复最新一次 Run 的已读缓存，
保持所有 Run 的展开／折叠状态，不改变公共时间线。原先聚焦按钮时，按钮消失后将焦点交给所属阅读区。
控件使用局部 overlay 和有界几何测量；不扫描全部正文、增加首屏请求或改变分页、内容缓存与虚拟列表预算。
较新页读取失败仍在执行记录内保留原位重试。

冷启动恢复与应用内切换的呈现边界不同。Main Window Session 一旦给出恢复目标，Renderer 必须挂载对应一级页面框架；
不足 400ms 不显示加载提示，超时后由共享的不透明整窗品牌画布遮住框架，直到真实目标内容可用再淡出。Camp shell 不得
用标题区、骨架或结构占位伪装 meaningful content，也不得在 `camps.enter` 成功前提交权威 Camp。成功 enter 的 Active Camp 保持 Active；meaningful
未激活的 Pending Camp 外壳保持 Pending。若该 Camp 已有有效 Desktop-local Composer snapshot，则在 Camp
权威进入后恢复，但本机草稿本身不会激活 Camp 或使其进入导航。Members 与 Memory 同样由自己的读取 owner 取得数据，
但冷启动可见等待共用品牌画布；失败切换到独立恢复面，应用已就绪后的普通切换仍留在局部 surface 重试。仅明确
`camps.exists === false` 的已删除 Camp 可以回到 Quick Chat。Notification navigation、恢复位置写入和已读确认要等权威 route commit。

## Camp 队员管理

队员区保留在队/暂离计数，去掉重复“协作队员”标题；右侧提供使用 `--conversation-action` 的紧凑“邀请”按钮。它打开可搜索的多选 Dialog，说明固定为
“选择要加入这次讨论的队员。”；候选只包含当前 `present` 且不在 active Camp members 中的 AgentProfile；
曾离开的成员若再次出现，仍按普通候选与“邀请队员”
文案处理，不显示“重新加入”或历史离队分组。提交按权威 membership generation 顺序执行；多选出现局部失败
时保留失败项和明确原因，已成功项立即从候选移除，不伪装为整批回滚。

成员行保持头像、身份、Runtime 名称与真实“在队 / 暂离”状态；队长通过中性灰行内徽标表达。设为队长、模型信息展开与“移出当前会话”统一收进
行尾单个水平三点菜单，避免并排按钮破坏层级。入口保留 `28×28px` 命中区，静止态无边框、无底色，
仅在悬停、键盘聚焦或菜单打开时显示低强调度底色。菜单项必须有文本动作名、键盘焦点、Esc/外部点击关闭和
`aria-expanded`；模型项使用“模型信息”，已配置时不重复 Runtime 副说明；未配置时保留原因。模型信息使用中性结构线，
只控制既有详情 disclosure，不改变 Runtime 配置。“移出当前会话”不显示泛化说明，禁用原因继续显示。

Camp 只有一位 active member 时，“移出当前会话”仍可见但禁用，并直接解释“Camp 至少需要一位队员”。
其他成员选择移除后，先打开读取
[Camp Membership v2](../../contracts/camp-membership-v2.md)权威 preview 的确认 Dialog；读取期间显示骨架，失败
原位重试。Dialog 只展示实际存在的影响：会被停止的 Run、被释放的 Task 与等待/运行 Delivery，
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

“设置 → 通用 → 会话”的世界地图 Switch 控制地图可用性；不存在本机通用偏好文件的新 profile 默认关闭。
schema v4 已保存的开关值始终优先，schema v1–v3 仍迁移为开启，避免升级静默撤销此前已经生效的地图能力。关闭时，
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
或关闭按钮撤下高亮，恢复打开前的消息阅读锚点和 follow-latest 状态，不额外将焦点送回入口或阅读容器；定位期间输入框保持
焦点，后台消息不能把时间线拉回最新。

所有已挂载公开正文命中使用主题语义高亮，当前 occurrence 使用更强背景与下划线；当前消息另有 1 px
定位线，不能只靠颜色表达。结果以 `aria-live` 播报，图标按钮有动作名称，reduced motion 关闭浮层进入
和 spinner 之外的非必要动画。每次首次查询或前后导航都必须以当前 occurrence 的文字 Range 定位，而不是
只把整条消息居中；Range 落在扣除悬浮查找条后的安全可视区中央，长消息中的首尾命中无需用户再次滚动。

文件预览展开时，`Cmd/Ctrl+F` 依据焦点区域独立路由；文件正文、Tabs 与文件搜索入口不触发会话查找。会话与文件分别保存查询和结果，只统一视觉样式，详见[文件区域内查找](file-preview.md#文件区域内查找)。

## A2A 会话消息

Agent 公共正文不显示“来自执行”来源条，也不投影 compact 投递卡。已交付 A2A 消息只在正文后
显示简短转交轨迹“发送给 @队员”；底层 Delivery 状态、失败码和恢复事实仍由 Core Read Side
拥有，不在 footer 或 Run stage 重复展示。
该轨迹仅属于 Agent 正文；用户和外部 Principal 即使存在 Delivery 也不渲染“发送给”脚注，
其 Delivery 仍完整保留给排队卡投影，用户处理回执与复制操作不变。

用户、队员和已交付 A2A 正文支持原生鼠标拖选与系统复制。当前用户和外部 Principal 消息只提供复制；
队员消息提供复制与回复，使用统一的 17px 线性 SVG 图标，回复采用“消息气泡 + 回折箭头”的对话回折图形。
用户复制行位于正文右下方且在消息底色之外；除下文连续组内的紧凑操作外，队员操作行位于整组公开输出左下方，须排在正文、父引用、
图片、附件、转交 footer 和锚定的 `Files Changed` 卡片之后。`Files Changed` 仍是独立时间线卡片与 Evidence
入口，只在视觉布局上与来源消息组成同一操作范围。队员操作行相对原正文锚点整体左移 5px，复制在左、
回复在右，两枚 28×28px 按钮之间保留 1px 间距；放大图标不得改变按钮占位。当前可见时间线中最新一条
队员消息的操作行常驻，其余队员消息和用户复制行只在悬停或键盘聚焦消息区域时显现，粗指针环境下始终
可见。按钮保留动作名称和简短 tooltip。复制成功在同一操作行以短暂文字状态反馈，
不能只改变图标颜色。整条消息悬停或聚焦不增加背景洗色；单个图标按钮仍保留 hover 与 focus-visible 反馈。
用户消息保持
精确纯文本，仅对[文件链接](file-preview.md#会话内的文件链接)做展示投影：Markdown label 替代其链接语法，
文件代码路径保留等宽样式，原始消息及整条消息复制内容不改写；Agent 正文使用清洗后的 GFM；Tool 输出使用结构化证据组件。

当前用户与通过 Owner 校验的外部 Principal 消息整体右对齐，头像位于消息右侧，作者与时间也在右侧收口；
正文使用 `--conversation-user-message-surface` / `--conversation-user-message-line` 的浅灰圆角底面。底面按正文
固有宽度自然收窄，只把同列 Composer 的约三分之二作为最大宽度；短消息不得被拉伸到该上限。宽屏仍受
可读正文上限约束，紧凑会话列按 Composer 实际内边距等比例收窄。
用户消息的图片与文件区不继承正文底面的固有宽度或三分之二上限：它拥有独立工件轨道，右边缘与正文、
头像间距保持同轴，内容增加时向左扩展，最远到同列队员头像或姓名轨道，不越出时间线。图片和文件在该
轨道内从右侧开始排列；短正文不能把附件压成窄列，少量附件也不被强制拉伸。用户文件卡在 Composer 与
Timeline 中的最大宽度均为 220px，长基础文件名使用单行省略号；完整 `displayName` 继续保留在 `title` 与
操作按钮的可访问名称中。这个上限不改变图片附件或 Agent 交付文件卡。
Agent 公共消息继续左对齐，仅正文使用与用户消息相同的雾灰底面、1px 边框、12px 圆角和
`9px 12px 10px` 内边距。父引用、图片、文件、转交 footer 和 Files Changed 各自保持独立边界；
纯附件消息不生成空正文框，不添加身份色气泡或整条消息 hover 底色。消息边线与底色相同，保留边框占位，
完整色值由主题 token 拥有。单聊仅用户消息同步这组雾灰 token 和 12px 圆角，队员正文、执行过程、
菜单栏或 Composer 保持既有表面。

已发布的当前用户消息在正文下方、与复制按钮同一操作行提供轻量处理回执，只显示“待处理 / 处理中”和数量；
终态失败不增加“未完成”汇总。点击可见回执后才列出具体队员、各自状态与已建立 Run 的“查看执行”。当权威
`canWithdraw` 投影为真时，同一行显示撤回入口；确认框只显示
“所有接收队员尚未领取，可直接撤回。”，取消关闭弹窗，撤回提交期间防止重复操作。成功后原位置显示
“你撤回了一条消息”，不再呈现正文、附件或队员状态。队员消息不增加这组回执，继续保留上面的底色框和操作行。
事务资格、并发围栏与标记投影由 [Camp Message Send v23](../../contracts/camp-message-send-v23.md) 拥有。

消息复制成功只把复制图标短暂换成勾号，不增加可见“已复制”标签；读屏播报保留，错误沿用原反馈。
单聊新回复入口沿用上文的中性圆形箭头与亮蓝小点。提醒来源旁的提示点使用既有语义：完成/提及亮蓝，审批/未完成为警示，
失败为危险色；文字仍说明具体内容。既有提醒聚合、暂停计时、可见确认和导航逻辑不变。

同一队员、同一来源 Run、同一天且相邻间隔不超过 5 分钟的连续公开消息，前一条内容在当前宽度下
实际高度小于 320px 时，后续消息省去重复头像、姓名与 Runtime 标签，保留头像列与正文左轴。缺少 Turn 时
只允许相同的已知来源 Run 作为回退；来源不明时保留身份。任意非消息时间线项（包括 Files Changed）、
换人、新一轮、跨日或较长间隔均重新显示身份。

高度读取正文、图片、文件与转交 footer 的实际呈现，不按字数、文件数或图片原始尺寸推断，且不包含
身份头、操作行或 Lightbox。图片仍读取中时保留下一条身份，解码、换行或列宽变化后重新测量；分组变化
保留阅读锚点或原有跟随最新状态。组内间距为 8px，同作者重新分段时为 20px。

连续组内每条消息仍有独立复制、回复和可访问作者名称。桌面细指针下，中间消息的操作在悬停或键盘
聚焦时浮于该条内容右上缘，组末使用原底部操作行；窄窗口和粗指针保留各条底部操作。省略身份的消息
在悬停或聚焦操作时显示左侧时间。会话查找当前命中以及引用定位后聚焦的消息临时恢复完整身份。
纯图片或纯文件消息的复制结果为该条交付的显示名称列表；有正文时继续复制完整正文与既有结构化内容。

当前用户消息正文超过 20 个显式文本行时，初始只挂载前 19 行，并在正文左下方显示灰色“展开”按钮；
点击后在原位挂载全文并改为“收起”，再次点击恢复前 19 行。按钮须暴露 `aria-expanded`、关联正文区域，
并保留可见键盘焦点；恰好 20 行不截断。复制、回复摘要和 Core 中的原始消息始终使用完整正文，不得复制
截断投影；当前会话查找命中这类消息时临时挂载全文，使首尾 occurrence 都能被定位。关闭或切换查找后
恢复用户此前的展开状态，未主动展开时回到折叠态。

会话消息正文、底部与浮层执行台中的 Runtime 过程正文，以及 Markdown 文件预览共享 Mist Gray 分层：行内 code 以
`--conversation-inline-code-canvas` 为底色，保留 `1px 4px` 留白、`6px` 圆角和跨行连续底色；围栏代码块使用
`--conversation-code-block-canvas`、`--conversation-code-line`、`11px 12px` 留白与 `8px` 圆角。块内
`pre code` 必须继续透明且不保留行内留白或圆角。该覆盖不改变更新说明、附件卡片、Tool 结果、其他 Evidence
或其他 SafeMarkdown 表面；Day 与 Night 分别使用主题文档给出的独立 token 值。

当前可操作的队员头像、显示名和 Mention 可打开同一个锚定人物信息卡，不导航。已离开、移除或
不可解析身份保持静态。精确 token 行为见[结构化 Mention](structured-mentions.md)。

飞书、钉钉通过 Owner 校验后进入 Camp 的用户消息，与普通 Camp 用户消息统一显示“你”和相同的用户头像、
姓名颜色；不显示平台成员称呼或平台字样头像。这只是 Renderer 呈现，底层 `external_principal` 作者、Provider
来源与权限边界保持不变，不转换为 `local_user`。

## 系统消息

公共时间线中的 system-authored 消息（包括定时任务触发的 Prompt）使用独立的系统消息块：标准会话列与
队员正文轨道对齐，保留 42px 左缩进，宽度随内容收窄且不超过 `76ch`；会话列不超过 480px 时取消额外缩进。
表面复用当前消息的雾灰 token、1px 同色边框和 12px 圆角，不使用引用竖线、品牌蓝底或人物头像。

块内顶部以共享线性系统图标、“系统”和消息时间标明来源，使用 muted 元数据；正文使用正常 ink、聊天字号和
阅读行高，保留完整纯文本、换行和原生选文，长路径自然换行。复制入口位于块外左下方，复用普通消息的
悬停、键盘聚焦、粗指针可见性与复制反馈，不提供回复、撤回或个人资料入口。
Day/Night 使用同一组件树与现有语义 token；展示调整不改变作者身份、模型输入、Delivery 或消息可搜索范围。
Web 与 Desktop 共用上述结构和样式；Mobile 横竖屏均取消额外左缩进，保留消息区两侧 14px 留白、共享灰阶
表面和系统来源头部。正文沿用手机阅读字号（默认 12.5px），复制入口常驻，复用 17px 图标、24px 背景区域与
32px 纵向点击区域，不另外引入手机消息组件或业务状态。完整适配规则见 [Mobile WebUI](../host-web-mobile.md#对话与执行)。

## 消息回复与父引用

稳定的 Agent 公共消息在角色对应的底部操作行与复制图标并列提供对话回折回复图标；最新一条队员消息
常驻，较早消息在鼠标悬停、消息内键盘聚焦或粗指针环境下可见，且按钮使用“回复这条消息”可访问名称。
当前用户与外部 Principal 消息不提供回复入口；optimistic message 在取得稳定 Message ID 前也不提供回复。
点击回复把同 Camp
父消息写入当前 Renderer Composer，并在 Composer 内显示轻量无框 reply dock：正常状态不绘制独立边框、
底色、阴影或回复图标；作者与有界摘要共用一个可视行，超出可用宽度显示省略号，末尾保留取消按钮。

鼠标点击“回复”后正文编辑器获得焦点和插入光标，但不得因为程序化 focus 改变 Composer 的边框、阴影
或增加包围框。键盘激活“回复”或通过 Tab 进入编辑器时也只保留输入光标，不增加额外焦点装饰。

回复当前可寻址 Agent 是一次明确的用户双意图：当前 Renderer 编辑状态设置 reply target，并插入或复用
可见 Member Mention。已有其他 Mention 时全部保留，
`@所有队员` 已覆盖作者时不重复插入。回复当前用户自己的消息只建立引用，不从原消息的历史 recipient、
作者或 reply relation 猜 Agent；无 Mention 时必须明确显示“默认由队长 @{name} 接收”。显式 Mention、
`@所有队员`、reply 或接收者修复已经足以表达路由，不再重复显示“实际接收者”汇总。

原作者已退出 Camp、变为 `away`、被移除或不可解析时，reply dock 保留引用，但不插入失效 Mention，
并原位显示“原作者当前不可接收，请选择其他成员”。发送保持阻断，直到用户从当前可提及成员中显式
选择；不提供“仍然发送”或自动改交 Default Lead。若作者在点击后才失效，Core rejection 后正文、附件、
引用和错误保持，替代选择必须移除失效作者 token 并写入新 Mention。

取消 reply dock 只清除 reply intent；正文中已经可见的 Mention 保持不变。accepted 消息在正文前显示
一层紧凑父引用，作者与摘要同样只占一个可视行，超出显示省略号；点击通过 same-Camp anchor load 定位并
聚焦原消息。父消息不可用时显示“引用的消息当前不可用”，不落到最近消息。不递归展开祖先、不缩进
时间线，也不创建私密 thread。失效作者错误和替代成员选择独立展开，不受单行引用规则裁切。领域与字段边界见
[Camp Composer Draft v15](../../contracts/camp-composer-draft-v15.md)，评审方向见
[HTML 交互稿](https://github.com/murray17/rovai-ai/blob/0de773a75231038e384c03cd761fea56344a6e4f/docs/prototypes/message-reply-chain/README.md)。

渠道 `external_quote` 复用相同的回复图标、作者与单行摘要，无独立底色或边框；附件名称并入摘要，长内容省略。
外部引用没有本地父消息导航关系，因此是不可点击、不可 Tab 聚焦、无交互悬停态的静态预览；保留真实引用作者，
不统一改为“你”。此呈现不改变 Structured Content、引用正文/附件摘要或 Agent 上下文投影。

正文编辑器的折叠光标位于绝对开头时，`Backspace` 等价于取消 reply dock：只清除 reply intent，保留正文、
附件和所有可见 Mention，并让光标继续停在正文开头。有选区、光标不在开头或 IME 正在合成时不得触发该
快捷行为，仍由结构化编辑器处理正文或原子 Mention。

## Recipient continuation

当最近一条已接受 user message 的最终路由恰好是一个非 Lead 成员，且当前 Draft 没有 reply、显式
Mention、修复或手动接收者修改时，Composer 输入面上方的独立无框路由轨显示“继续发给 @成员”。
路由轨与输入面共用同一条宽度轨道，但不计入正文编辑区高度。标签不是正文 Mention，也不创建父引用；
确认发送成功时 Desktop 才在下一份空白 Camp-local Draft 中记录该对象，下一次提交前把它物化为普通
Member recipient，Core 仍只接收和校验普通显式目标。

“已接受”以正式发布到公共会话为准，不等待新一轮执行结束。候选来自该条本地用户消息唯一、显式、
非 Lead 的最终接收者，不取最后发言 Agent，也不从 reply 或 anchor 推导。恢复不得覆盖另一个 Camp，
成员状态变化要在显示和发送前重新校验。

标签与默认 Lead 文案占用同一行。标签出现时不显示默认文案；显式 Member Mention、多人 Mention、
`@所有队员` 和 reply 出现时两者都隐藏。点击标签的关闭按钮只取消当前来源延续并恢复
“默认由队长 @{name} 接收”；该 dismiss 写回 Camp-local snapshot，同一 source 在导航、重载或重新进入
Camp 后不得复现。

默认接收人与 continuation 均将 `@姓名` 用同一 `--mention-ink` 与字重突出；界面角色名称使用“队长”。
默认接收人提示只表达当前路由，不向正文插入 Mention。

reply、显式 Member Mention、多人 Mention 和 `@所有队员` 都比 continuation 优先。取消 reply 后若用户尚未
显式改址，可以恢复此前只被隐藏的 continuation；用户主动改址后，即使再删光 Mention，本 Draft 也只回到
默认 Lead，不能让路由控件反复出现。

标签出现后对象在空白 Draft 失效时，标签消失并持久抑制该来源；正文或附件已经存在时，保留全部 Draft，
展开“原接收者当前不可接收，请选择其他成员”，禁用发送并把焦点交给第一个有效替代选择。不得隐藏错误、
自动插入失效 Mention 或改投 Lead。字段和竞态边界见
[Camp Composer Draft v15](../../contracts/camp-composer-draft-v15.md)，交互探索见
[延续路由原型](https://github.com/murray17/rovai-ai/blob/0de773a75231038e384c03cd761fea56344a6e4f/docs/prototypes/composer-continuation-routing/index.html)。

## Camp 内单聊

Camp Header 的“当前会话”详情入口包含一个独立“单聊”项；打开后使用锚定在会话区右上方的非模态 panel，
与既有成员/Task/文件详情互斥，但不改变 Camp route、公共时间线、Composer Draft 或执行台位置。入口显示 active
Single Chat 数量；任一会话正在回复时复用紧凑运行 spinner，不用未读或通知语义。

panel 顶部先显示标题，再显示单聊对象选择栏和直接“结束”按钮，不提供省略号菜单。选择器 trigger 使用当前队员头像、
显示名和团队角色；展开列表每个选项也显示头像、名称和角色，不把对象分成“已有单聊 / 新的单聊”两组，也不暴露
Conversation、Binding 或 Session 状态。选择器和用户消息沿用既有 `--execution-running-surface` token 分层，
不能新增主题专属色值。

transcript 采用对话式双轨：用户正文与附件居右，队员回复居左；正文区两侧都不显示头像。用户正文继续使用既有
`--execution-running-surface` token，队员消息容器不使用背景、边框或气泡，只以开放排版承载执行过程与 final。队员一次回复由“执行过程 +
final message”组成。运行中过程复用当前执行台的 narration、plan、command/tool 与状态视觉；连续 Command 聚合为一个
可展开的工具组；组件、列表组图标、命令类型图标、28px / 11.5px 四轨工具行、精确结果展开与步骤计数直接复用执行台。
发送确认前与 Run 排队立即显示“连接中”；开始处理但尚未输出时，未收到明确 phase 显示“执行中”，收到 `thinking` phase 显示“思考中”。正文、计划、工具或 final 首次出现时，
同一次渲染移除普通等待提示，不在后续正文尾部追加，也不等待计时器或 Run 终态。存在活动工具或尚未收口的尾组时，用“执行中 · 当前指令”表达进度。组收口才显示“已完成 x 个步骤”，统计全部已结算逻辑操作；摘要不追加各终态数量，具体结果由展开后的 Tool 行表达。
运行中直接展开过程，不提供含耗时的外层 summary；用户仍可独立展开/收起工具组和命令结果。Run 进入 terminal 后
过程自动折叠，才出现耗时 summary，使用中文：成功为“工作了 {时长}”，取消为“你在 {时长}后停止了运行”，失败保持明确失败语义。
summary 下方以一条分隔线连接始终展开的 final message；不得把 final 收进执行 disclosure。整轮状态切换保持已展开的工具组、结果 DOM、加载缓存和滚动位置，不重置子级状态；
单条工具完成不代表整轮完成。审批、重试、停止与失败保留实际状态，不用普通等待提示替代。不得保留英文
“Working for / You stopped after”。取消或失败没有 final 时只显示诚实终态，不合成队员答案。

Single Chat Composer 与当前 Camp Composer 使用同一输入框风格和操作层级：输入区、附件入口、待发送附件卡片、
“↵ 发送 · ⇧↵ 换行”提示与发送按钮。底部固定提示为“单聊正文不会进入公屏”。支持文件选择、粘贴文件和仅附件消息；附件暂存与已发送附件都只展示在
当前私有 Conversation，不复用公屏 Draft，但选择、可用性状态、`AttachmentCard`、Preview、Open 与 Reveal 都复用
Camp 公共 Source Attachment 组件。`Enter` 发送、`Shift+Enter` 换行，IME 合成期间不提交。

同一段 Single Chat 有非终态 Run 时 Composer 仍可输入后续正文和附件。Draft 为空时主要动作显示“停止”；一旦存在正文
或附件，主要动作恢复为“发送”，提交后把内容放入该 Conversation 自己的 FIFO，不改变当前 Run 输入。队列按顺序展示，
支持删除和移回普通输入框编辑；移回会覆盖当前正文、附件和引用并取消原队列项。发布前附件失效时队首显示可理解的修复状态并阻塞同一
Conversation 的后项，用户移回编辑或删除队首后恢复；不得阻塞 Camp 公屏或其他 Single Chat。停止只结束当前回复，
对话和未发布队列仍可继续。发送后回到最新；后台 Evidence 更新仅在用户原本接近底部时跟随，
用户上滚阅读时不得抢走位置。选择另一个对象恢复其 active transcript 或创建新 transcript，UI 不区分这两种内部结果。
切换对象时立即撤下旧 Snapshot；新对象加载完成前，发送、附件、停止与结束等依赖当前 Conversation 的操作保持禁用。
打开 panel、切换对象和成员目标变化是唯一可以决定当前对象、清空 Snapshot 和改变 loading 的路径。晚到的打开或读取结果
必须同时匹配最后一次 target request sequence 和当前队员，不能覆盖较新的选择。panel 收起、离开 Camp 或组件卸载时必须使旧
target request 失效。结束确认只固定打开确认框时的 `campId`、Conversation ID 与队员显示名称，不保存 version，确认时也不得从
可能已切换的全局 Snapshot 重新解析目标。

panel 每次打开时读取一次 active Conversation 列表和当前对象的完整 Snapshot；空闲后不保留固定刷新计时器。只有当前
Conversation 存在非终态 Run，或存在会在 Run 结束后自动发布的 `queued` Pending Input 时，才按约 800ms 周期只读取当前
Conversation；读到不再满足这两个条件的 terminal Snapshot 后立即停止，`needs_repair` 不触发轮询。panel 可见时沿用
`single_chat.changed` 做定向刷新：`refreshList` 只读列表并更新对象列表/运行标记，不选择对象、不加载正文也不改变 loading；
`refreshCurrent` 只读当前 Conversation Snapshot。轮询、事件与本地 mutation 共用同一 `refreshCurrent`；同一目标已有 get 在途时
不并发新读取，期间的重复需求合并为当前读取完成后的一次补读。接口返回完整 Snapshot 时可先直接呈现，但在途旧读取不得成为
本地修改后的最后结果。所有后台刷新都不清空 Snapshot、不切换对象且不改变 loading。panel 收起后停止计时刷新，再次打开时重新执行
一次 list + get。
本流程继续使用完整 `singleChat.get`，不引入增量 Read API 或另一套事件流。

“结束”在默认情况下打开危险确认 Dialog。说明必须为“这段对话将被删除且无法回复。”，按钮为“取消 / 结束”，
并提供“不再询问”复选框；选择后只把该确认偏好保存在本机。结束成功立即从产品 surface 移除该 transcript，之后与
同一队员发起单聊显示新的空白 Conversation。具体 ended/审计保留、取消和迟到事件行为由
[Single Chat v8](../../contracts/single-chat-v8.md)拥有，Renderer 不从旧 Runtime 事件恢复正文。

panel 保留明确的收起按钮与 `Esc`，对象菜单和确认 Dialog 打开时 `Esc` 先关闭最上层浮层。选择器、Disclosure、停止、
结束和发送均需可键盘到达，不添加额外焦点框；spinner 有文本或可访问名称。窄窗口中 panel 以会话区宽度为上限，
不能遮住全局侧栏或溢出可视区；reduced motion 关闭非必要位移和旋转动画但保留状态变化。

领域、权限与输出路由见 [Single Chat v8](../../contracts/single-chat-v8.md)，组件数据流见
[Single Chat Architecture](../../architecture/single-chat.md)。

## Camp 执行过程

底部、详情浮层与右侧标签中的执行台使用同一背景：外壳、队员入口区、详情操作栏、所有状态的 Run 卡片及其标题与空白区域均使用
`--conversation-surface`；运行卡片不再使用单独底色，日夜具体色值由双主题合同拥有。
“会话 / 地图”视图按钮仍使用原有 `--brand-soft`。选中态、状态形状、
边框、焦点及工具结果的专用 Evidence 底色保持各自语义，不用背景分层改变执行状态或交互。
详情操作栏与运行卡片将弱提示文字局部提升到 `--muted`，保证日夜主题的文字对比度，不改变历史 Run 与会话区文字层级。
Runtime narration 与 plan explanation 的 SafeMarkdown 在底部和浮层复用上文的 Mist Gray 代码分层；Tool 行、
Shell 结果、Diff 与其他结构化 Evidence 继续使用各自专用样式，不因承载位置改变。

同一 Camp 中每个曾有 AgentRun 的队员只保留一个 Agent 过程入口。按需详情 surface 以时间顺序展示
该 Agent 的独立 Run stage、状态、收件人与证据；这只是 Renderer grouping，不创建 Process
领域对象，也不合并 AgentRun。

每个 Run 的“协作投递”只显示 `public_a2a` 且 `sourceAgentRunId` 精确匹配该 Run 的收件人；不能从接收方
Run、target parent、return target 或同一 CampTurn 推断发送归属。投递来源由
[Camp Open Projection v14](../../contracts/camp-open-projection-v14.md#public-a2a-投递来源)提供；缺少来源时不展示猜测结果。
同一队员的多次消息或重试按 `recipientAgentId` 去重，按首次消息时间、消息 ID 和消息内 canonical position
保留稳定顺序，不随投递状态变化重排；底层投递、失败和恢复事实不合并、不修改。

保留“协作投递”标签，对象仅以 24px 头像展示，焦点槽位 28px、间距 4px。底部和浮层共用单行布局，
按实际可用宽度为 `+N` 预留完整位置；不换行、不横滑、不裁掉半个头像。Hover 或键盘 Focus 显示完整姓名，
`+N` 是可操作入口，以非模态名单展示其余头像与完整姓名，缺失头像使用既有身份回退。Escape 先收起姓名提示
或名单，不连带收起执行详情；名单关闭后焦点回到入口。没有公开投递对象时隐藏整行。

首次安装或旧偏好没有位置字段时，执行台默认由详情浮层承载（`inspector`）；已保存的合法 `right`、`bottom` 或
`inspector` 选择保持不变。执行台的单个位置图标打开“右侧 / 浮层 / 底部”菜单，当前项有勾选；最后一次成功的
显式选择作为本机安装级偏好跨 Camp、页面切换和应用重启生效，不新增 Settings 默认项。提交中控件不可重复
触发；写成功后才移动，失败时保持原位置并在控件附近提供可重试错误。Camp workspace 必须在偏好解析后以
正确位置挂载，不得先显示另一个位置再跳转。

显式移到详情浮层时，底部和右侧执行内容完全移除，标题栏增加首个“执行”入口，并自动打开执行浮层。
默认采用浮层不等于默认展开；仍遵循下文 running Run 进入与精确导航规则。浮层最大宽 440px，受当前会话阅读区宽高约束，不挤占会话或文件预览。
移到右侧时，“执行”成为文件预览同级标签，共用当前分栏比例；切换执行、Mission 活动或文件不得改变右侧宽度。
移到底部后顶部执行入口消失、浮层和右侧标签收起，横向队员过程入口下方打开可调高度详情，并保留最后使用的
“任务 / 队员”基础选择。位置偏好只拥有承载位置，
不跨 Camp 保存 Agent/Run selection、Drawer 开合、Tool 全文或滚动位置，也不根据窗口宽度自动改变。
重新进入 Camp 时可以从当前权威 snapshot 推导最新 running Run，并以总览作为过程 scope、该 Run 作为精确
focused Run；这是新的瞬时 selection，不是恢复旧 Drawer 状态，也不改写位置偏好。

三个位置共享当前 Agent 与精确 Run selection、Evidence load 和状态投影，不允许同时存在多套过程列表
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
浮层和右侧标签的详情占据剩余高度并独立滚动，不显示高度把手；
底部详情继续保留鼠标、键盘调高与 Main Window Session 内高度偏好。

“总览”入口打开全部队员的执行总览：三种位置的入口和详情统一使用四格聚合图标，承载为 6px 圆角方块，
不模拟人物头像；底部入口为 24px，侧面入口与详情为 30px，详情的“总览”文字与图标垂直居中。单队员
与总览均把 non-terminal Run 留在当前区，terminal Run 按新到旧进入默认收起的“执行历史”；历史标题只显示
历史总数，不增加失败待处理汇总。收起卡片显示触发消息摘要、状态或耗时及常驻的展开/停止动作；只有总览卡片重复队员头像。
展开后直接显示过程正文，不重复元数据。队员 Header 保留身份、Runtime、模型与 Fast，移除 Run 总数和冗余统计。
尚未被 Scheduler claim、没有 `targetAgentRunId` 的 waiting 当前 CampMessageDelivery 按接收队员合为一个 Delivery-backed
“排队消息”卡，即使该队员尚无 AgentRun 也进入执行台当前区和队员入口。该卡只允许展开、查看输入和定位原消息，
不显示停止；Delivery 被 claim 或离开 waiting 后，由真实 Run 或终态投递事实接管。若同一队员同时存在终态历史和
waiting Delivery，队员入口优先显示“排队中”；已有 non-terminal Run 仍优先于 Delivery 预览。用户和 Agent 作者都使用
同一队列投影；用户消息缺少 `sourceAgentRunId` 不影响卡片准入。

同一队员的 queued Run 合为一个排队批次，按不同来源消息显示层数；展开后逐条显示用户或 Agent 作者、两行摘要与
“定位原消息”。任一 Run、queued Run 批次或 Delivery-backed 排队卡含多条不同来源消息时，卡头显示独立于展开按钮的
可点击层数图标；点击打开同一输入清单，`Escape` 关闭并把焦点还给层数按钮。计数使用冻结输入 ID，不因消息正文尚未载入
而退化为单条。单卡停止只作用 exact Run，批次停止只作用该批列出的 queued Run；执行台不提供消息撤回。

卡头为最小 46px 的标题区域，摘要使用随 Run 返回的 `inputSummary`，与聊天区已载入消息页无关；
保留来源措辞、归一空白并最多 240 个 Unicode scalar，超出以 `…` 结尾。纯附件使用附件名，显式不可用来源
回退 purpose；加载历史消息不替换标题。使用 12.5px/600 字重及单行省略；标题按钮具有 heading 语义。
展开时标题和原有操作只在本卡范围内吸顶，滚过本卡后退出，不复制全局标题或脱离所属 Run 的停止按钮。
Desktop 与宽屏 Web 的展开正文首尾、主要过程项间距及相邻 Run 间距统一使用 8px，运行中切到终态时不得改变
这组密度；Mobile 继续由独立 mobile stylesheet 拥有其触控行高与紧凑过程间距，不继承该桌面调整。
运行中卡片默认显示 live 耗时，窄详情同样保留；仅标题行 hover 或标题内 `:focus-visible` 时，
在固定尾部槽内切换为折叠／展开与红色终止按钮。正文 hover 不触发，鼠标移出标题恢复耗时，不挤动标题。
折叠／展开保留 1px 边框、抬升面底色和 5px 圆角；终止始终使用 danger/danger-soft，禁用时仍保留危险色。
粗指针或无 hover 环境同时展示耗时与操作。非运行状态保留原有静态操作，不套用 hover 切换。
滚动容器为键盘焦点留出标题安全区，不改变跟随最新、折叠、输入清单或 exact Run 停止语义。
总览中的队员头像固定为 20×20px，不随 flex 收缩拉伸。左侧状态节点与卡头首行垂直居中并跟随本卡标题，
展开与停止操作距卡片右边保留 9px。字段与验收边界见
[Run Process Detail Surface v42](../../contracts/run-process-detail-surface-v42.md)。

执行浮层入口、右侧标签、消息区“处理中”回执和底部标题共用同一 24×24 心跳路径与 1.65 描边；
queued 回执的时钟及各执行状态图形不变。

打开过程入口时，先定位最新 running，其次最新 non-terminal，最后最新 terminal Run。用户显式
发送成功且未在查看 non-terminal Run 时，按 Core 有序回执打开首个 Run 的精确 stage，但不夺走
Composer 焦点。若用户正在可见的“任务”Tab 新建任务，Renderer 消费本次自动聚焦请求但不切走表单，
离开表单后也不补跳；仅浏览任务、编辑既有任务或查看队员仍按回执自动打开执行。不可见的旧 Run
selection 不算“正在查看 non-terminal Run”。从其他 Camp、一级页面或应用启动/恢复进入当前 Camp 时，若
权威 snapshot 含 running Run，则自动选择总览，并以 `createdAt + id` 最新者作为精确 focused Run 展开；
`inspector` placement 激活首个“执行”
入口，`right` placement 打开右侧“执行”标签，底部 placement 直接展开
Drawer，均不移动 DOM 键盘焦点。Mission 仍先打开“活动”；若 `right` 位置有 running Run，再选择“执行”，
活动标签继续保留。打开后执行阅读区定位到最新指令，并在用户停留底部时跟随新增指令。没有 running Run 时不自动
打开；`queued`、`waiting`、`recovery_blocked` 与 terminal 均不具备资格。用户已经停留在同一 workspace 时，
后台 A2A、Runtime 事件、refresh 或后续状态变化不得自动打开、切换或抢焦点。

使命板上的 Mission 抽屉在 `bottom` placement 下是进入与提交后自动聚焦的例外：已有 running Run 或本抽屉
新提交消息产生 Run 时，底部队员入口继续显示真实状态，但不自动选中队员或展开 Drawer。用户显式点击总览或
队员入口后仍打开同一个详情。普通 Camp、完整 Mission 会话及其他 placement 继续遵循上述规则。

### 通知浮层与 AgentRun 精确定位

Rovai 窗口可见且有焦点、当前 surface 是普通 Camp 或 Mission 会话（含使命板抽屉）时，同 Camp 的完成、失败、
未完成、Mention 与审批都不弹临时浮层；切到其他 Camp、其他一级页面或应用失焦后恢复正常。静默只撤下瞬时卡片，
不把屏幕外消息、Run 或审批伪标为已读，也不清除侧栏未读事实；精确来源进入真实可见视口后才确认。

AgentRun 通知定位必须先显示目标承载位置，再选择成员、展开并聚焦 exact Run。`right` placement 在页面关闭或
正在显示其他文件标签时显式打开“执行”标签；紧凑布局不得以“让出会话阅读区”为由关闭该目标页。三个 placement
的定位与可见来源扫描都以移动同一执行 DOM 的稳定 Portal 为边界，不能只查询会话根节点；右侧 Run 只有在其 stage
与执行视口相交时才进入 `agentRunIds`。定位成功由目标实际获得 DOM 焦点证明，缺失或不可见继续走可恢复失败反馈。

聚焦 live Run 且用户停留详情底部时可跟随最新输出；手动上滚后暂停，回到底部恢复。该跟随
不能滚动公共消息时间线。Drawer 空间不足时收缩、滚动或变为摘要，不能遮住 Approval Dock、
Composer 或唯一 Stop。

本工作区显式提交后入队的消息，在真正发布时沿用发送后的精确定位规则；上一轮被取消同样适用。
Renderer 以公开消息和 Delivery ID 跟踪刚提交输入；Scheduler claim 后按返回的真实 Run 展开并恢复详情底部跟随，
不创建 pending-input 占位，也不夺走 Composer 焦点。
删除待发送消息、无执行发布或离开 Camp 会消费或丢弃意图；其他窗口的发送和后台新 Run 不触发该行为。

单聊与执行台的发送确认前和排队显示“连接中”；开始处理但尚未输出时，未收到明确 phase 显示“执行中”，收到 `thinking` phase 显示“思考中”。正文、计划、工具或 final 到达即移除初始等待提示。执行台在最新阅读窗口的已结算尾部 Tool 组若再次收到 `thinking` phase，且 Run 仍运行、没有活动 Tool／压缩或后续正文、计划、final，则组收口并在尾部显示一条瞬时“思考中”；新正文、计划、Tool、等待／停止或 Run 终态到来时撤下，不留下历史思考条目。单聊仍不在后续正文尾部追加普通等待提示。
Runtime 的 private thought/reasoning 文本不进入 Renderer state、搜索、缓存或 disclosure；仅消费不含正文的
`thinking | executing` phase 来切换上述等待反馈，并把 phase edge 作为匿名公开正文的分段边界。
Camp 执行卡片的普通等待提示与正文共用字号、行高和文字起点，加载图标放在提示文字后；底部、桌面浮层和手机端切入首行正文时不改变卡片位置或单行高度。
需要审批、网络恢复、重试或停止时继续显示明确状态。非终态过程不显示耗时总结，非聚焦执行摘要在已有输出时显示“执行中”。成功后才显示“工作了 {时长}”
并自动折叠过程；失败保留明确失败摘要及可操作错误，取消保持停止语义。正文或工具首次到达、单条工具返回、步骤组
收口都不能触发整轮耗时总结。关闭 Run 后卸载详情；再次打开读取最新窗口。组跨页按稳定操作身份保留展开意图。

已加载的正文片段与计划说明完整呈现，不按固定字符数只保留末尾；后续输出追加时不得裁掉正文开头或
破坏已有 Markdown 结构。实时投影与历史 Evidence 回读、底部与 Inspector 共用此规则；这不改变 Evidence
分页、显式截断标记或 Managed Blob 的存储与读取边界。

Task related execution、停止结果和世界地图入口在右侧承载时必须显示 Inspector、激活“执行”并打开
精确 Agent/Run。关闭详情只清除 selection，保留位置和队员入口；隐藏 Inspector 只改变可见性，再次
显示时保留“执行”Tab、Agent 与 Run。位置切换后焦点进入另一位置的对应切换控件；底部详情关闭/Escape
优先返回仍连接的真实过程入口，无法返回时落到当前位置切换控件。浮层内 Escape 在子菜单和工具结果
处理后关闭整个浮层，返回顶部执行入口，保留 Agent/Run selection、已展开记录与滚动位置。

命令、文件操作及其失败作为可展开 Tool Call 留在对应 Run stage。已读取 Evidence 中的 Tool chronology
按窗口呈现。顶部“加载更早记录”复用会话区的文字箭头、已显示计数与原位加载／重试样式；向下滚动自动恢复
已读缓存，取消“加载较新记录”按钮。“回到最新”采用最新缓存并跳转；首次展开执行中 Run 时，首屏与完整正文
异步到达后仍定位到最新。历史阅读期间后台只更新最新缓存，不替换当前窗口或抢滚动位置。缓存预算见
[Camp Open v24](../../contracts/camp-open-projection-v24.md)，不把未加载部分当作不存在。Built-in Tool 有唯一已确认
Shell 载体时，标题使用完整命令的单行预览，展开显示 `$ command` 与下一行原始 JSON／文本输出，保留正文参数
和多行输入，沿用 Shell Evidence 的按条惰性读取。Core 操作身份、图标和状态保持不变；不新增入参存储。
缺少可靠关联时回退对应 `rovai` CLI 名称和同一 operation 的 Core 公共 `canonicalInput`，省略投影辅助事实和
由消息面拥有的 Send 正文或历史 Gather 正文；没有可显示入参时为无箭头静态行，不借用其他调用的结果。
纯 CLI Shell 的完整成功返回值与其生命周期内唯一 Core 调用精确匹配时，折叠到 Built-in 行；单记录生命周期
改用同 Run、同 epoch、紧邻序号和精确结果 digest 证明关联。混合命令、帮助、
提前失败或不确定关联保留。底层 Evidence 和 Canonical 身份不变。完整规则见
[Run Process Detail Surface v42](../../contracts/run-process-detail-surface-v42.md)。

新 operation 的 started/progress/terminal 按稳定 Evidence ID 合并为一行；Renderer 只接受更高
`revision/changeSequence`，不以记录数量或固定展示 `sequence` 判断内容是否变化。终态后的输入补齐、结果更新和
冲突仍在原位置刷新，保留 disclosure 展开、当前选择与阅读锚点；历史无版本 Evidence 继续使用兼容路径。

同一 Run 内最大连续的 Tool items 默认收成一条可展开组摘要；收起时只挂载摘要，展开后才挂载子行，文件 Diff 在文件行展开后读取和解析；narration、plan 与 diagnostic 都会截断
分组，不能跨 Run 或跨队员合并。有 running 操作时，活动组只显示当前指令；waiting 保留“等待审批 · 当前操作”，
不再同时追加累计数。当前操作优先展示已有公开证据中的具体指令：Shell 使用原 command，File 使用
可靠阅读／编辑文件名或多文件数量，Web 搜索使用 typed query，其他操作使用非通用 Runtime title/toolName；
没有具体值时回退稳定 Tool 行标题，不从 raw input/output 猜测。当前 Tool 已结算但尾组尚未收口时，继续显示
“<最近一条指令>”。真正收口后只显示 `已完成 x 个步骤`；`x` 统计成功、失败、停止、跳过和结果未知在内的
全部已结算逻辑操作，各终态不再追加独立数量，具体结果由展开后的 Tool 行表达。分页读取沿用相同的执行结果摘要，不改成“已载入 x 项执行记录”；组摘要只统计
当前组已读取的逻辑操作，不表示整轮总量。已载入范围只在“加载更早记录”入口呈现。
`x` 按去重后的可见逻辑操作计数；同一 Built-in 与已关联 Shell 载体计一步，started/result/delta 和一个 Activity 的多文件行不重复计数。
精确计数语义见 [Run Process Detail Surface v42](../../contracts/run-process-detail-surface-v42.md)。

Runtime Compaction 作为根级、非 Tool process item 同样截断前后 Tool 分组，但不进入“已完成 x 个步骤”。
它复用普通 command 的桌面 28px 行、最右侧状态 icon、文字后展开提示与结果文本框，并保留独立压缩 SVG；同一
`compactionId` 的 started/completed 在当前 Run 原位更新。只有明确 token 字段或非空 summary 才可展开；message count、
elapsed、Runtime/事件/Session identity、trigger 与 phase 单独存在时保持无箭头、不可点击的静态单行。summary 的完整内容
沿用本地 Managed Blob 惰性读取，不投影到渠道、局域网执行台、世界地图或公开 Evidence。精确归属、协议和失败关闭边界见
[Run Process Detail Surface v34](../../contracts/run-process-detail-surface-v34.md)。
独立图标沿用普通 command 的 muted 色，不使用品牌色。`imminent` 是一次性 `recorded` 记录，不压掉 Run 尚未输出时的“思考中”；只有
非终态 Run 的 `started` 显示 running 状态并暂停重复的底部进行中提示，`completed` 使用完成状态。

当已投影的最后一个 process item 是 Tool 组且父 Run 仍为 running 时，该尾组在当前 Tool 已结算后继续保持
provisional 活动态，显示“<最近一条指令>”，也不在下方追加普通等待提示；唯一例外是收到 `thinking` phase 且 Run 内已无活动 Tool 时，组显示“已完成 x 个步骤”，下方由瞬时“思考中”接替。此处活动态表达父 Run
仍在运行，不改写上一条 Tool 的真实终态；下一条连续 Tool 到达后只在同一组原位替换为新指令。
narration、plan、diagnostic、`thinking` phase、waiting/cancelling 或 Run 终态才构成真实收口边界。该规则按 process/Run 事实
判断，不使用时间防抖。
组 summary 的左侧 16px 图标与摘要文字共享中心线；活动组的图标与文字从同一条当前操作选择，使用已有
Terminal、File Read、File Write、Web 等图标。运行时最右端只有状态 icon；收起组在悬停或键盘聚焦时，
文字后的预留槽显示 `>`，展开后原位转为向下并保持可见，移开指针或焦点也不消失，出现时不挤动文字。
组收口后恢复分组图标、成功步骤数与最右端上下展开箭头，
不重复显示终态状态 icon。底部和窄 Inspector 使用同一结构。

收起且运行的组摘要、收起且压缩中的 Compact、思考中与连接中文字，以约 2.4 秒一轮从左到右依次高亮。
高亮只覆盖静止的文字，不移动文字或闪烁背景；展开组或 Compact 后停止该行高亮，子指令及结果正文保持静态。
完成、失败、等待、停止和结果未知保持静态；减少动态效果或 forced-colors 时关闭文字高亮，状态事实仍保留。

用户展开后保持展开，新 Tool 与组终态只原位更新，不自动收起或抢焦点。展开组只显示全部 Tool summary，
截断后的结果仍须再展开精确 Tool；结果 region 在首次展开前不进入 DOM，Managed Blob 也不提前读取。普通输出超过
7.5 KiB 时在结果下显示“结果过长，部分内容已省略。”，并将读取文案改为“结果”，不提供全文恢复
暗示；结构化 diff、Files Changed、输入与附件仍使用各自入口。收起组时
其后代不再挂载 DOM，底部与 Inspector 移动同一 Drawer DOM 时保留组、Tool 与已经读取的结果状态。

`activity-v3` 的 Tool 行由 Renderer 统一生成中文 presentation，Core 不再生成本地化默认标题或 Codex
`commandActions` 中文标题。Shell 行只要同一公开 payload 有 command，就优先使用完整命令预览：去掉外层
Shell `-c/-lc` 包装，保留参数、Node inline/heredoc 代码开头、全部子命令及
`&&`、`||`、`|`、`;`、`&`。参数值不进行敏感内容扫描或替换；当前 `rovai send` 与历史 `rovai gather` 证据中的正文参数和静态 stdin 内容保留原值。标题值不做固定字符截断，由名称轨在真实
宽度内单行视觉省略；完整命令值仍可通过 `title` 与辅助技术读取。没有公开 command 的 Runtime 继续使用
非通用 title/toolName 与“终端操作”。available typed read 显示 `阅读 <basename>`；typed write operation 或
文件 Diff 明确 add 时显示 `新增 <basename>`，update、path-only write 或无法可靠区分时显示
`编辑 <basename>`，否则使用 toolName/title/“文件操作”；`tool.web.search` 固定为“Web 搜索”，普通 Tool
使用 canonical toolName/title/“工具调用”，Runtime 与 Unknown 使用对应中文 fallback。命令展示只改变
presentation，不得参与 identity 或 lifecycle 合并；ACP 仅由 Adapter 白名单的 command shape 在原生 kind
缺失时证明 execute。上述稳定 Tool 行标题不因活动组的具体当前指令而改变，渠道卡片也不读取该组摘要字段。

Tool 与 Compact 行使用 `16px 类型图标 / 可缩略名称与行内展开提示 / 20px 状态轨`，已有状态 icon 移至最右端，
不新增重复 icon。可展开行在文字后预留 `>` 提示槽；悬停和键盘聚焦时出现，单条展开后转为向下并保持可见。
无详情行不显示展开提示。触摸设备常显可用提示、行点击区域至少 44px；桌面仍为 28px，并提供可见键盘焦点。
窄视口仍显示“移到浮层／移到底部”文字及原方向图标。
类型图标收敛为 Terminal、File Read、File Write、Web、Tool、Rovai、Runtime 和 Unknown 统一 16px 单色 SVG，不代表状态。
Rovai 图标使用四向星与弧形地平线及 `--rail-logo` 色，只由 Core Catalog 验证后的
`sourceAuthority=core + credibility=core_verified + toolName` 选择；Shell command 即使以 `rovai` 开头也仍用
Terminal 图标，Web semantic kind 优先用 Web 图标。
Tool 行尾状态同时用形状和颜色表达：执行中为外环、旋转弧线和中心点，等待审批为圆形内暂停线，成功为带勾
圆形，失败为带叉菱形，停止为圆形内实心方块，跳过为带横线圆形，结果未知为圆形内信息标记；排队时钟只用于
存在排队事实的 Run，取消等待终态时使用没有中心点的中性弧线。Tool 子行、底部执行台、Inspector 头像角标、
Run 时间线与单聊工具行复用同一组件。forced-colors 保留形状，reduced-motion 下弧线不旋转。
普通 Tool 行不再重复显示“已完成”文字；状态仍须通过 `aria-label` 与 `title` 可读取。取消请求等待终态时状态
容器保持透明，不出现覆盖整轨的色条；不可展开静态行不提供整行 hover。

一个 Shell Activity 含多条确定的纯读取动作时，折叠摘要按完整路径去重，但仍保持一个可展开命令项。优先使用
现有结构化命令动作；结构化动作不可用时，只补充识别由引号外分号连接的
`sed -n '起始行,结束行p' <直接路径>`。所有段都满足该形式且至少两段时才准入；明确非读取动作、管道、重定向、
变量展开、命令替换、反引号、换行分隔、`sed -i`、混合命令或其他未支持语法继续显示原 Shell。不同读取区间
的同一完整路径只列一次并保留首次顺序；同名不同路径使用最短可区分路径。一个不同文件显示 `阅读 <文件>`，
多个显示 `阅读 <文件一>，<文件二>`，文件名以中文逗号分隔并横向单行排列，空间不足时只省略文件名。展开后保留完整原命令、输出与整次状态；该摘要不拆分 Activity/Evidence、
不改变步骤计数，也不参与权限或安全判断。

Shell command Tool disclosure 展开后第一行显示 `$ ` 加完整 command；存在完整公开 output 时从第二行
连续显示，不插入“命令 / 输出”标签或空白分隔行。两者的数据来源不得互相替代；Claude/ACP terminal
Evidence 自带 command，不依赖 Renderer 回看 started event。除没有可靠 Shell 关联、仅显示入参的 Built-in 外，其他 Tool
disclosure 继续在原位渲染完整公开结果，不再截断，不再提供复制按钮。本地已有全文时
直接展示；截断 Evidence/Managed Blob 只在用户展开精确 Tool 行后读取。读取成功但没有公开文本时，
原位显示“没有可展示的公开结果。”，不误报读取失败或提供重试。读取中、真实读取错误与“重试”都留在该
disclosure，重试成功后焦点进入结果区域，若仍无公开文本则返回对应 summary。全文置于固定最大高度的可聚焦
`role=region` 中，超出后内部滚动；Arrow、Page Up/Down、Space、Home/End 可滚动，Escape 只返回
对应 summary。Web 搜索 disclosure 只有在 `runtimeSearchOperation.status=available` 且 Canonical semantic 同时为
`tool.web.search` 时，才在第一行以 `搜索 ` 紧接 typed 公共 query；多项 query 以中文逗号按原顺序连接。存在
公开结果时从下一行连续显示，不插入“搜索词 / 结果”标签或空白分隔行。query 原样展示，不做敏感词过滤或去重，历史 Evidence 缺失 typed
projection 时不显示空占位。Web 搜索仍是 Tool item，计入所在连续组的步骤数，组内使用 Web 图标；
Shell、Web、Built-in 和普通 Tool detail 统一使用现有 Shell 详情底色与 2px 左外边距，同时保留各自内容、
内边距、字号和换行；不增加标签、分隔线或额外空行。详情填满当前内容轨道，移除旧的 52px 右侧预留；保留 2px 左外边距、结果/加载底色、字号、圆角和阴影。
底部和 Inspector 复用同一行为。用户展开或收起 command／Compact 时，summary 保留点击前的屏幕纵坐标；
加载切换到结果、错误或重试结果仍原位，不自动追到最新。内容较少的底部执行台保留点击时的外壳高度，
必要的末尾阅读空间避免收起时浏览器夹紧 scrollTop；既有用户高度调整仍优先。生产窗口与实测高度虚拟列表
共同保留该行，不靠扩大外壳解决详情宽度。用户滚轮、触摸或键盘滚动立即解除该点击锚点，继续自由阅读；
显式“回到最新”解除锚点并恢复既有跟随。文件预览按钮保留样式和点击预览，点击不展开 command。
仍不显示
standalone raw Evidence、Envelope JSON 或独立
“查看完整工具调用”。精确合同见
[Run Process Detail Surface v34](../../contracts/run-process-detail-surface-v34.md)。

### Runtime 终态文件变更与 AgentRun 文件变化

只有 [Runtime File Change Observation v6](../../contracts/runtime-file-change-observation-v6.md)准入的可靠
Evidence 才进入文件操作呈现。成功 read 的可靠单路径显示为不可展开的 `阅读 <basename>`；成功 write 的可靠
单路径显示 `编辑 <basename>`。有完整 before/after、unified snapshot 或 exact mutation 时，每个文件作为同一
Canonical Activity 的 presentation row，明确 add 显示“新增”，其他显示“编辑”；没有可靠内容时不显示
`+A −D` 或空 disclosure。read 只属于过程事实，永不进入 AgentRun `Files Changed`。

当前 Runtime Host 的精确 `ROVAI_RUN_TMP` 是 Rovai 可重置的临时交付区，不是用户文件面。其目录内的 HTML、
图片或其他中间产物不显示为 `修改 <basename>`，也不进入 `Files Changed`；mixed 事件只展示其余普通文件。
已经持久化的历史卡片不重算。临时文件经 `rovai send --file` 发布后，附件由独立的 Camp Attachment UI 呈现。

文件操作使用阅读文件或笔形 16px 图标。动作词和文件名始终横向单行排列，之间固定保留 5px 间距；空间不足时仅文件名显示省略号，动作词与状态保持完整，完整路径保留在 title 与可访问名称中。执行抽屉与其他执行面使用同一布局。文件名以虚线底线按钮展示。canonical diff 修改文件行优先用 exact Run Activity Evidence 授权，并以来源 AgentRun
的 `executionRoot` 解析；无 Diff 的终态 Read/Write 行使用同一 Run Activity 来源，以该 Evidence 已准入的
文件操作路径校验并按 Run 根解析。历史 Run 缺少有效执行根时才回退 Camp 项目，缺少 Evidence identity 的历史 Diff presentation
保留当前 Camp workspace 兼容回退。鼠标或键盘点击后成功才提交预览导航；失败只在当前页显示 danger Toast `无法打开该文件`，不创建或切换
预览页。写入行有 Diff 时，除文件名预览链接外，动作文字、图标、统计、空白和右侧箭头都属于同一个
可展开摘要，提供 hover/focus 反馈并控制原有 Diff；键盘可聚焦摘要并用 Enter/Space 切换。文件预览与
Diff 展开互不触发。展开后的代码宽度不得撑大执行抽屉、WebUI 或 MobileUI；长行只在 Diff 容器内部横向滚动。缺少可靠路径
不制造链接，缺少 Diff 不制造展开入口。

Renderer 不显示 `apply_patch` 父行或“编辑了 N 个文件”聚合层，不从 Tool 显示名、output、命令文本或当前文件
推测变化，也不为逐文件行创建新的 Activity identity。文件行留在现有“已完成 x 个步骤”集合内，集合计数仍按
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

Run 已成功、失败或取消但没有公开消息时，图片与文件变化按精确 `agentRunId` 组成运行产物区域，
直接使用该 `AgentRun.agentId` 显示队员头像和姓名。同 Run 的多个 epoch 共用一次作者头，图片排在文件卡之前；
不同 Run 保持各自作者和归属。头像、姓名沿用公开消息的人物信息卡资格与缺失头像回退，离队或移除队员保持静态。
该区域不创建 CampMessage、不合成正文，也不提供消息复制或回复；来源 Run 未加载时保留文件卡，不猜测作者。

文件行按“目录/文件名”连续展示，目录与分隔符保持次级灰色，文件名保持主文字色。display root 根目录文件只显示文件名，
不补“当前目录”。宽度不足时优先从目录右侧按完整目录段省略，例如 `/xxx/.../CONTEXT.md`，文件名优先保留；
极窄时先隐藏目录，文件名自身仍超宽才省略。宽度恢复后还原完整目录，完整路径保留在 title 与文件行可访问名称中。
display root 内文件使用相对路径，
Runtime 明确报告的 root 外文件使用规范化绝对路径。卡片默认显示三行，更多文件由“再显示 N 个文件 / 收起文件”在原位切换；不增加行间分隔。
卡片保持细线轮廓，标题图标为 20px 单色 SVG、24px 占位，不加图标底块。
卡片含可靠差异时，header 右侧是无内边框、非品牌色且没有箭头的轻量“查看变化”文字入口，hover 提升文字对比；点击 header
进入[文件预览区](file-preview.md#file-change-标签页)的 `File Change·文件名` 标签页，并优先保留仍可审查的历史选择，
否则选择第一个可审查文件。点击有可靠差异的文件行进入同一 Review 并预选该文件。点击 operation-only 文件行直接以
既有 `run_evidence / open_current` 来源打开普通当前文件 Tab；根外绝对路径仍指向证据报告的文件，而非 Camp 项目内同名文件。
整张卡片都没有可靠差异时，header 文案改为“查看文件”
并打开第一项当前文件；具体文件仍由对应行精确选择。当前文件只有在来源校验和首屏读取成功后才提交导航，失败只显示
danger Toast“无法打开该文件”，不切换预览或启动系统应用。
卡片不显示时间、“已保存”、Git 状态、参与运行或
底部 metadata。

Review 与普通文件共用预览区和标签栏，正常双栏中保留左侧会话、Composer 与审批信息。
宽预览内部使用文件列表与 Evidence 阅读面；选中项使用中性整行底色与细边框，不加左侧竖线。
窄预览改用可搜索、可滚动且支持键盘操作的文件选择框，单文件省略切换控件。
完整净差异显示 unified diff 及可靠 hunk、旧/新行号；exact mutation 不显示 hunk、行号或推测上下文；history
保留全部 operation 的时序与计数，但只渲染有可靠 diff 的代码块，并将可见代码块从“修改 1”连续编号，不为
operation-only 记录生成空白占位块。exact mutation 与 history 不显示额外解释提示；在已经打开的混合 Review 内，
operation-only 文件仍可选择，右侧显示“没有可审查的差异内容”。卡片上的 operation-only 入口直接打开当前文件，
不以内联当前正文补齐历史 Review。“打开当前文件”通过既有来源校验打开普通文件 Tab，历史 Review 保留原
选择和阅读位置；关闭预览或在单 Pane 模式返回时恢复原会话，不默认跳转系统编辑器。

卡片只读取 AgentRun/epoch 的版本化 projection 与受管 detail blob，不读取当前 workspace 或重新执行 Git。来源水位
推进后，`complete` 与 `no_changes` 都会失效并只重算该 Run/epoch；合法迟到事实可以让旧 `no_changes` 生成卡片，
也可以让既有卡片原位更新。卡片与 detail 使用同一 projection revision，Renderer 拒绝旧异步响应；已打开 Review
保留文件选择、展开、查找、滚动和 Pane 状态，失败时保留上一份明确标为待更新的可读内容并允许重试。没有可靠
Evidence 的 Run 不生成卡片；Review 也只读取同一 projection/detail，不补造行号或 diff。Git 与非 Git
项目行为一致。执行台不增加共享 workspace observation，
底部/右侧 placement、会话连接轨、Tool list 宽度和其他既有视觉结构保持不变。

使用“Agent 运行时默认”的 Run 在既有 `.execution-run-meta` 中保持一个模型字段：尚无可信观测时显示
“模型 Agent 运行时默认”，首次 Runtime-native 观测到达后原位收敛为“模型 {modelId} · 默认”。固定模型
不增加本版字段；运行中后续换模不覆盖首值。长 ID 使用等宽单行省略并允许键盘聚焦取得完整 title，底部和
Inspector 复用同一语义。刷新不得自动打开执行台、改变 Run selection、移动焦点或创建 Toast/时间线消息。

当权威 AgentRun 已取消时，该 Run 中仍为 running 的 Tool Call 停止所有运行动画，并以中性图形和
“已停止”作为主状态。该展示只表达父 Run 已失去继续执行权，不改写子活动的 Canonical phase/outcome，
也不删除底层 Input/Action 审计；业务取消本身不产生外部效果待确认提示。明确 canonical cancelled 的 Tool Call
同样显示“已停止”，其他非取消路径独立投影的待确认提示仍保留。精确合同见
[Run Process Detail Surface v34](../../contracts/run-process-detail-surface-v34.md)。

当前非终态 Claude Code Run 收到安全 `runtime_api_retrying` Evidence 时，在精确 Run 过程内显示 attention
notice：“Claude Code API 暂时不可用”，并显示最新重试次数、等待秒数和“本次执行尚未结束，可继续等待或
停止执行”。同一 diagnostic 只显示最新 attempt，底部“正在处理”同步改为等待 Claude Code 自动重试。
该状态仍是 running，不产生 Tool、Toast、消息或终态 failure；Run 终态后隐藏旧 notice，真实失败继续使用
下述 Runtime failure 边界。Renderer 只接受固定 code/status 与有界数字，不展示 raw stderr、API body、
凭证、用户名或绝对路径。精确合同见
[Run Process Detail Surface v34](../../contracts/run-process-detail-surface-v34.md)。

同一 App/Core generation 内，权威 Run 为 `waiting/network_recovery` 时显示 attention 状态“连接中断，等待恢复”，
并说明只有在确认当前输入未被接收后才会自动重试；新 epoch 已进入正式恢复但 Input 尚未 accepted 时显示“正在恢复”／
“正在恢复连接”。`waiting/network_recovery_blocked` 显示 danger 状态“需要处理”和无 spinner 的“自动恢复已停止”，
说明安全条件已变化且不会自动重发，并保留普通 Run“停止”入口。Renderer 的 `online` 和 Electron system resume 只
唤醒 Core 安全检查，不直接发送输入；页面切换、窗口最小化和 Renderer 未产生 signal 不停止 Core timer。只有当前
恢复 epoch 的 Runtime Input accepted 后才清除过期网络提示，单纯连接或 Session 建立不能显示任务已经恢复。精确合同见
[Network Interruption Recovery v2](../../contracts/network-interruption-recovery-v2.md)。

failed AgentRun 的公开 `failure` 必须在对应 Run stage 显示 Core 已脱敏并限长的 Runtime 原始错误文本；
非空 `detail` 优先，否则回退 `summary`。错误位于本次 Run 的执行记录末尾，作为运行中断原因；即使没有
任何 Execution Evidence 也默认展开并直接显示，不能被空详情逻辑隐藏。AgentRun 不增加 Runtime 名称或
`origin` 标题，不翻译错误文本，所有 `origin` 统一使用 danger
错误底色；成员管理等非 AgentRun surface 继续使用各自既有标题与语义色。Renderer 不读取或展示原始
stderr、私有日志、内部 error chain 或 digest，也不从公开文本重新猜归因。

内部 accepted/outcome-unknown 在主界面显示普通红色失败，不显示“结果待确认”、spinner、“恢复中”或
“结束此运行”。诊断证据保留 Runtime 已接受、最终结果无法确认且原请求不会自动重发的真实类型；
Renderer 不确认成功、不重发正文，也不提供用户强制放行入口。

## Runtime 图片与消息图片

Runtime 图片自动展示只接受 Core 已投影的两类 Adapter 确认来源：Codex 原生 `imageGeneration` 与精确
conversation/step 关联且已完成的 Antigravity 原生生图。截图、读图、Codex MCP image、Claude tool result、
ACP/TRAE/Copilot 图片及未知历史来源不进入本 Surface；Renderer 不按工具名、路径、格式或 MIME 补做判断。
显式消息图片附件不属于该门禁。

来源 Run 尚未产生公开消息且仍未终态时，已准入 Runtime 图片留在该 Run 内等待，不提前进入会话 Timeline。
公开正文出现后，每个 Run/epoch 的已准入图片固定并入该 Run 最后一条公开消息的 Agent 图片区；`Files Changed`
仍在整条消息之后。只有 Run 已终态仍没有公开消息时，才按图片时间显示独立兜底，并保持在同 Run 文件变化卡
之前，并沿用运行产物区域的来源 Run 作者头。未准入图片不能以独立兜底出现。只读取图片元数据，不把图片变成正文或执行台 Tool。

消息附件先按类型稳定分区，保留图片内部和文件内部的原顺序，不再让两类对象混排。用户消息顺序固定为
“图片区 → 文件区 → 正文”，Agent 消息固定为“正文 → 图片区 → 文件区”；空区域不渲染。Agent 的显式图片
附件与 Runtime 图片进入同一个 `agent-output-images`，同摘要过滤后显式附件在前、Runtime 图片在后；进入图片区
的对象不再生成重复文件卡。两个区域必须是独立容器，不能因为横向空间充足而进入同一内容行。

Agent 图片继续共用 `ImageGallery` / `ImageTile` / Lightbox：单张按原比例、最大宽约 560px，多张只在图片区
以 160–240px 单元响应式排列，窄容器退为单列。预览使用 `object-fit: contain`，保留截图、文字和图表完整边界；
区域不随正文长度收缩，预览框和大图窗口贴合原图比例，不补黑边、不裁切或重编码。

用户消息图片使用同一读取、decoder、Tile 和 Lightbox 基础能力，但时间线缩略图固定为 72×72px 圆角方块，
多张只在图片区内换行；缩略图允许 `cover`，大图仍按原比例完整显示。该差异由显式 Gallery variant 表达，
不能复制 decoder、缓存或 Lightbox 实现。
用户图片区和文件区共用独立于正文宽度的右锚定工件轨道；内容向左增长至队员头像或姓名轨道，不能因为
正文很短而收窄，也不能为了取得宽度改变图片、文件、正文的固定顺序。

普通文件使用集中分类函数，不能在 Composer、用户消息和 Agent 消息分别维护扩展名判断。用户侧只用中性的
文档、代码、文件夹三类图形，目录与压缩包共用文件夹，未知格式回退文档；文件项高 46px，显示文件名与独立
格式标签，不显示大小。Agent 文件使用 Web、Code、Notes、PDF、Word、Sheet、Slide、Image、Archive、Generic
十个主题 token 家族，未知格式回退 Generic；桌面两列、窄容器一列，并可保留大小和打开入口。`previewKind`
不是图片的 image MIME/扩展名对象进入 Agent 文件区的 Image 家族。

图片接近可视区域时读取，历史附件的 `availability = unknown` 不阻止该懒加载；缓存图片的重验也只在接近
可视区域时发起。通过 Chromium 真实图片解码后自动展示缩略图，点击或键盘激活才放大，加载成功不自动打开
Lightbox。读取失败沿用当前图片错误展示，不新增持久状态、后台扫描或文件复制。损坏/消失的 Runtime 图片显示“图片已不可用”，
不影响其他图片或 AgentRun。稳定路径重开时可读取更新后的内容，不承诺历史不可变；临时路径和 inline 内容由
已有 Blob 保留。缩略图点击或键盘激活打开大图，关闭后焦点回到该图，两个主题均使用现有颜色与焦点 token。

同一 Renderer 进程以实际 Blob 大小保留 128 MiB 已成功解码的图片 payload，Tile 各自创建并释放 Object URL；
淘汰 payload 不破坏正在显示的缩略图或 Lightbox。缓存命中的消息附件在首次可见绘制前直接恢复，不重新读取；
任意 Runtime 图片同样先恢复缓存内容，但后台仍调用现有读取接口以取得稳定路径当前内容。后台请求异常保留
旧图；正常返回不可用或候选内容解码失败则清除缓存并显示失败；成功候选完成真实解码后无空白替换。
不持久化缓存，不区分 Runtime 底层存储，也不保证 Chromium 不重新进行内部解码。

已准入 Runtime 图片和显式图片附件均只显示图片，不显示文件名、来源/数量标题或 Runtime projection 说明；
移除附件操作菜单、右键菜单、系统打开和在 Finder/文件资源管理器中显示的入口。非图片附件不受影响。
只保留点击或键盘查看大图及关闭；大图标题仅供辅助技术读取，不占据可见空间，关闭控件覆盖在图片角落。
图片解码失败时显示“图片已不可用”并禁用点击，不回退到系统打开。
同一 Run 的可用图片附件与 Runtime Blob 摘要完全相同时只显示显式附件；底层记录保留，失效附件不能
隐藏 Runtime 图。不同 Run、不同内容和可变稳定路径不参与过滤。底层边界见
[Runtime Images v5](../../contracts/runtime-images-v5.md)，不引入 File Preview 授权流程。

## Task、Approval 与停止

每个 Task 在创建位置只显示一张读取当前五态文案、标题和负责人的实时卡。Inspector list/detail
负责发现和完整责任审计，Agent 过程负责执行事实；Task 取消不等于 AgentRun 或 CampTurn 取消。

所有 pending Approval 位于 Composer 正上方的唯一非模态 Dock。Header 待审批入口显示总数，
Dock 内以队列计数和上一项／下一项导航呈现多项请求，保留 Runtime 原生选项、范围和决定身份。
Header/通知摘要只展开、定位并聚焦 Dock，不改变执行台位置或 Run selection，不强制切换详情内容；浮层按外部焦点规则收起。Approval 不进入消息时间线。

Desktop / 宽屏 Web 的 Dock 与底部执行台共用会话列全宽，不跟随正文或 Composer 的内缩轨道。单行顶栏显示当前请求摘要、
当前队员与 Runtime、队列导航和收起入口；命令与请求 JSON 原样展示，达到内容高度上限后局部滚动。
选项使用紧凑内容宽度按钮，严格保留 Runtime 的原始顺序、原生标签和 `optionId`，不显示 `consequence`，
也不通过翻译或术语替换改写 Runtime 文案。ACP 缺少有效 `name` / `label` 时直接展示 `optionId`；
Codex 无原生显示标签的决定由 Adapter 提供固定英文标签，响应值和作用域不变。

Dock 保留橙色顶部，以中性边框界定请求，移除左侧橙线和浮层阴影。原始 JSON 的底色与执行台 command
结果框共用 `--shell-result-canvas`，使用 11.5px 等宽文字，保留空白与局部滚动；请求区可由键盘聚焦和滚动。
按钮保留原生标签与顺序，使用中性边框、500 字重和明确的按下／提交中状态。
手机的上下标题、44px 控件、双列选项与可视高度适配见 [Mobile WebUI](../host-web-mobile.md#对话与执行)。

翻页保持刚触发的导航按钮焦点。边界按钮使用 `aria-disabled`，仍可保持焦点但触发无操作。
顶栏定位以及当前审批结束后接续下一项时只聚焦请求摘要；初次显示和普通刷新不主动聚焦决策按钮。
Reason 仅在空白归一化后与动作摘要完全相同或自身为空时隐藏，不作语义推断。其余原文默认两行预览，
超出时提供“展开全文 / 收起全文”，状态按审批 ID 隔离。容器宽度变化（含详情/文件区显隐与调整）时重新
计算溢出，不重置该审批的展开状态；完整说明始终可读，不因压缩而永久丢失。

public Composer 不提供 CampTurn 或整轮停止。共享 ExecutionDrawer 顶栏在“收起”旁提供唯一 AgentRun Stop，
只停止当前聚焦 Run；底部和 Inspector 复用同一个直接停止入口与状态。
停止等待只覆盖 IPC 提交阶段，文案为“正在提交停止请求…”；Applied 后立即显示 Core 返回的实际终态并刷新。
既有 cancel_requested_at 或 Runtime 清理未完成不产生停止 spinner；取消 Run 显示已取消并清除旧外部效果提示，
底层发送与 Action 证据不因此删除。
Run 卡片与步骤组均以权威终态优先：即使取消标记尚存，终态也不得被“正在停止 · 等待执行结束”覆盖；
已完成步骤保持完成，取消 Run 中未结束的工具按既有终态投影显示已停止。
Header、Task 卡、时间线和 Composer 不增加 Run-local 入口。accepted/unknown 只显示普通红色失败，
不与普通 Stop 同时出现。Run-local 请求不创建 Camp 时间线消息；新 public Camp 不再生成 Turn-level 停止消息，
历史停止占位只按已有记录只读展示。精确资格、required/optional 后果与不确定态见
[Run Process Detail Surface v34](../../contracts/run-process-detail-surface-v34.md)。

## 会话 Pane 紧凑布局

布局依据会话列自身的宽度，而不是整个应用窗口宽度。时间线与 Composer 所在的两行共用同一列，分别以
`conversation-pane` inline-size container 暴露此宽度，不重新挂载正文、Draft 或文件 Viewer。宽于 480px
保留标准布局；420–480px 使用紧凑排版。双栏的最小宽度、单 Pane 替换及比例记忆由
[文件预览](file-preview.md#结构与布局)拥有，不新增 Sidecar 或移动端导航模式。

- 时间线与 Composer 左右边距缩至 12px。Task 与 Files Changed 取消 42px 额外左缩进，使用当前正文轨道的
  可用宽度。当前用户消息底面继续按内容收窄，最大不超过 Composer 可用宽度的约三分之二，头像留在右侧；
  用户附件仍使用独立工件轨道并在可用宽度内向左扩展，不跟随正文底面变窄。普通消息自然换行，Markdown
  表格与代码块使用自己的横向滚动。
- Task 状态图标缩至 26px，隐藏右侧 Chevron；标题自然换行，负责人和更新时间继续 wrap。
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

Core Draft/Pending/revision/lease 规则已退役；public Camp 当前以 Desktop-local、按 Camp 隔离的唯一 snapshot
为准，不建立跨客户端合并或恢复列表。

Composer 与消息轨道共享中心轴但拥有独立宽度；`.composer-box` 与 `.composer-route-rail` 必须同宽、
居中、同轴，Inspector 显隐不得改变这些关系。发送、Stop、Approval Dock、
附件、Skill 候选、Mention、reply intent 和 continuation intent 都使用同一 Camp-local Draft；任何浮层
都不能建立第二份草稿真源。回复条位于附件队列之上、正文编辑器之内，并与 Composer 共用开放工作面，
不创建 focus trap。鼠标点击 Composer 任意位置都不增加编辑器内层描边；键盘进入保留输入光标，不增加局部焦点框或光晕。

接收者提示始终预留一行 34px 高度及 5px 底部间距。草稿首次 loading 时显示无接收者文案、无循环动画的模糊占位；
ready 后原位显示默认 Lead 或 continuation。显式 Mention、reply 或错误状态不显示路由时保留空白行，
避免路由加载或显隐挤动会话内容。占位不提前声明接收者，也不提前启用编辑或发送。

新建会话成功后的首次打开，把该 Camp 的本地 snapshot 与 Open 投影并行准备，在首次绘制前一次性交给
Draft Coordinator，因此直接呈现已恢复内容或就绪的默认接收人。普通重新进入读取相同 Camp-local snapshot；
读取失败继续走 loading/error 与重试流程，不能用空时间线推定空 Draft。

Draft 首次读取只有 loading、ready 和 error。loading 与 error 时正文、附件、Reply/Continuation 和发送不可操作；
error 在 Composer 上方原位显示“草稿无法加载”、具体错误与“重新加载草稿”，不能渲染可编辑的 revision-zero 空
Draft。发送和路由 mutation 在第一个异步等待前同步禁用编辑器；本地路由 mutation 改变正文时在解除禁用前回写
Lexical。发送失败保留正文并恢复交互，成功则以空 Draft/continuation 替换。导航或卸载前的同步本地保存失败时，
留在当前 Camp、显示保存错误并恢复交互；打开新会话 Dialog、展开或选择 Project 等未卸载 Composer 的动作不
伪装成已离开。附件预览、打开与 reveal 由 Main 的 Camp+attachment authority 重验，不依赖 Core Draft locator。

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

文件和目录都以原位置引用进入当前 Draft；只有没有本地路径的粘贴图片或 Blob 才先写入 OS Temp。
短暂 preparing 表示 Core 正在接纳引用，不表示创建内容快照；preparing/error 附件阻止发送。正文非空或
至少存在一个 ready 附件时才可发送；submit guard 与按钮必须共用该判断，不能只放宽视觉控件。纯附件消息
保留完整时间线外壳、作者、时间、复制/回复和附件卡，但不渲染空正文气泡，也不生成占位正文。原文件随后
修改会影响后续读取，移动、删除或失去权限可以使引用不可用。非图片文件卡按内容自然收窄但不超过 220px，
长名称必须省略且可取得完整名称。拖放命中、反馈和卡片合同见
[会话区文件与文件夹拖放](conversation-drop-zone.md)，领域边界见
[Camp Attachment v9](../../contracts/camp-attachment-v9.md)，发送边界见
[Camp Composer Draft v15](../../contracts/camp-composer-draft-v15.md)。

准备区固定使用 D 档：普通文件项高 48px、约 11px 圆角并始终显示浅边框，采用用户侧中性图形、文件名和
独立格式标签，不显示大小；图片是 48×48px 圆角缩略块，不显示文件名。两者共处一条不换行的附件带，删除
按钮固定在每项右上角。超宽时隐藏视觉滚动条，保留触控板水平滚动；普通鼠标的主滚轮在附件带仍有可滚空间
时转为横向浏览。附件带本身可聚焦，并以 Left/Right 分段浏览、Home/End 到首尾，不抢占移除按钮的键盘入口。

Renderer 对新 source refs、Managed v2 和 legacy 附件只消费同一个无路径 View，不显示或分支判断底层
storage model。历史加载时 `availability = unknown`，不得为了填充附件卡而批量 `stat`、启动 watcher 或
持久化状态。图片接近可视区域时按需预览，或用户执行预览、打开、显示所在位置后，当前卡片才按该次结果更新为 available、missing、
unreadable 或 kind_changed；重新读取历史仍从 unknown 开始。状态使用既有 Porcelain Day / Steel Night
语义 token，不引入新的视觉世界，也不暴露 source、Authority/View 路径或内部 operation ID。

普通文件单击继续进入应用内文件预览或受控系统打开，目录单击在 Finder / 文件资源管理器中打开。Timeline
文件项右键菜单提供同一
主动作和“在 Finder / 文件资源管理器中显示”；菜单支持键盘循环、Escape 关闭、collision handling 与关闭后
焦点回到真实卡片。执行中单卡防重复提交；目标 parent 不可枚举、target 消失或 native 请求失败时均显示固定
的无路径提示，不把 best-effort Shell dispatch 当作文件管理器已确认选择。高风险文件由 Desktop Main 使用原生
确认，不在 Renderer 判断。Composer 附件保持既有预览/移除交互；所有动作都提交 composer、pending、
pending_edit 或 message 的精确 owner locator，不提交路径。
精确动作与结果合同见 [File Preview v5](../../contracts/file-preview-v5.md)和
[Camp Attachment v9](../../contracts/camp-attachment-v9.md)。

## 空 Camp 欢迎状态

宽屏空 Camp 使用开放的中央欢迎态：标题为“想先做些什么？”，下方以一行轻量文字显示真实
Project / Quick Chat、“队长{显示名}”和在队人数，不再显示品牌图形、头像、胶囊或正常 Runtime 状态。
Runtime 未就绪、部分就绪、检查中或无在队队员时，仍在建议下方显示明确文字，不用精简态隐藏失败边界。
“先了解项目 / 整理成任务 / 检查工作区”三个建议以并排文字按钮显示，只填入并聚焦现有 Composer，
不自动发送、创建领域记录或更改接收路由。
普通手机空 Camp 只保留开始标题，并把三个建议折叠为“起步建议”；展开行只显示建议标题，不显示品牌图形或配置标签。
首次使用欢迎状态不受手机精简影响。所有建议都不会直接发送、创建假消息或改变已保存协作配置。

## Camp 详情浮层

标题栏使用直接入口，默认浮层位置（`inspector`）的顺序为“执行 / 任务 / 队员”；底部位置（`bottom`）时为“任务 / 队员”。
DOM、视觉和键盘顺序一致；不再提供常驻侧栏、独立折叠按钮或文件预览开关。

执行入口采用钢蓝／琥珀双弧与运行队员头像：沿用 28px 高度、6px 圆角和灰色展开背景；只在存在
`status === running` 且尚未请求停止的 Run 时显示。两条独立弧沿同一圆角轮廓运动，分别读取 `--brand` 与
`--ember`，各占周长 24%、线宽 1.65px、相隔半圈、4.8 秒一周；不使用渐变、发光或额外旋转图标，
弧长不代表任务进度。浮层收起不停止运行提示；减少动态和强制颜色模式下弧线静止，页面隐藏时暂停。

头像复用现有 MemberAvatar／avatarRef，每张 20px、相邻叠放 4px，只展示真正运行的队员。同一队员的多个
Run 按 agentId 去重，再按成员顺序展示最多三张，超出显示 `+N`；头像保持静止，不加单独光环或状态点。
悬停或键盘聚焦入口展示完整运行名单，入口可访问名称包含运行人数与姓名；头像和 `+N` 属于同一个按钮，
点击均打开既有执行浮层，不增加嵌套控件。排队、等待、恢复阻塞、停止中和终态不单独启用双弧或头像；
全部结束后恢复“执行＋实际有执行记录的队员数”，按 AgentRun 的 agentId 去重，并继续允许打开执行历史。
任务和队员计数仍读取真实 Camp 投影，不能将 coverage 未加载的数据表达为不存在。

所有入口共用一个非模态详情浮层，位于消息阅读区右上方，最大宽 440px，四周保留间距。浮层不覆盖
Approval/Recovery Dock、Composer 或文件预览，不改变会话网格列宽。点击其他入口切换内容；外部点击、指针
操作或焦点移出均保持打开。只有再次点击当前入口、点击标题栏关闭按钮或按 Esc 才收起；Esc 收起后返回触发
入口。菜单和任务 Dialog 保有自己的焦点边界；执行详情与 Tool 结果继续使用既有 Esc 层级。键盘打开浮层时
将焦点移入，后台刷新不抢焦点。

任务与队员浮层使用 `--inspector-surface` 阅读底色，执行浮层使用 `--conversation-surface`；三个浮层共用
1px 中性结构边界和固定头尾栏。首行按“图标 / 执行、任务或队员 / 收起 + 向上箭头”排列，
不显示顶部彩线与重复作用域；底栏仅在右侧显示 `Esc 收起`。任务取消与执行停止的关系在取消确认时说明。
内容区独立滚动，头尾栏始终可见；执行台内部沿用上面的背景分层，列表与工具输出样式不随承载位置改变。

浮层开合只在当前工作区内保留，不读取旧的侧栏显隐偏好。进入没有 running Run 的 Camp 时默认收起；进入
含 running Run 的 Camp、显式移动到浮层或精确执行导航仍遵循上面的自动展开规则。切换内容或收起浮层不得
重建执行 Drawer，不得丢失 Agent/Run selection、已展开 Tool、已读结果或滚动位置。
Mobile 的执行标签由用户主动打开；发送或排队后发布 Run 不自动切换页面。手机 Run 摘要仍复用相同时间、状态与当前执行标记，具体布局见 [Mobile WebUI](../host-web-mobile.md#对话与执行)。

执行浮层内部不重复“执行台”标题，底部承载位置仍保留该名称。头像选中与“当前执行”徽标使用中性色。
每个 Run 不再展示“运行信息”区域；只移除这处元信息呈现，不改变 Run 或执行证据的存储与读取。
队员 Header 继续展示完整模型配置，Fast 放在模型旁；停止留在头部右侧，底部承载时另有收起详情，
浮层承载时只保留浮层顶部收起。历史计数保持紧凑，coverage 不完整时仍明确标注当前载入范围
并保留历史未加载提示；Run 卡片、连接线、带圆圈的完成图标与执行过程保持独立。

任务区的创建入口为“新建”，使用中性主操作；详情入口缩为“返回 / 编辑”，不展示 Task 对象版本。
任务区使用状态筛选和紧凑列表：标题、状态、负责人，以及必要的阻塞原因。点击列表或时间线
任务卡打开只读详情；“责任范围与要求”使用合成后的单一 `description`，历史结构化要求也只在这里并入正文；
阻塞/完成/取消原因、关联执行与可展开审计均保留。新建和编辑
使用标准 Dialog；在当前 Camp 工作区内关闭 Dialog、切换详情或收起浮层保留各任务独立草稿，重新打开继续
编辑。草稿不跨 Camp 卸载或应用重启持久化。提交时只发送相对打开时实际改动的字段，未编辑字段保留 Core 当前值，同字段以后成功提交覆盖；已结束任务
只读。取消任务使用填写原因的独立确认 Dialog，仍不取消已接受或运行中的执行。

队员区读取当前 CampMember 与 AgentProfile。队长以队员行徽标表达，“设为队长 / 模型信息 / 移出当前
会话”集中在该行菜单，不显示单独队长选择框或常驻操作说明。队长资格、版本检查、邀请候选、移出预览和在途
收拢仍由现有 Core 命令负责。ContextManifest 与 Runtime Input Delivery Evidence 不进入普通详情；审批继续
只在 Approval Dock 决定。

## Camp 顶栏与关闭等待面

项目目录与会话名称统一使用 UI 字体、`12px / 400`；项目目录使用 `--faint`，会话名称使用 `--ink`。
会话名称保留 `<h1>` 语义、单行省略和现有响应式布局，不再加粗；顶栏不显示“第 X 天”标签。
会话日期分隔保持本地自然日分组，只显示完整年月日（例如 `2026年8月31日`），使用 `11px / 400` UI 字体，
不使用等宽字体、星期或 `DAY N`。消息时间戳、详情入口、消息、任务卡片、文件变化卡片和 Composer 保持既有呈现。

Camp Header 显示会话定位、待审批摘要和详情直接入口；文件 Tabs 占据独立文件列。不增加 Stop、分享或 `•••`。主动退出、
重启或更新保留已激活 Camp 的 Desktop-local Composer snapshot，并在进入关闭前收口已经开始的本地输入操作。收到
`runtime.state = shutting_down` 后才阻止全局新交互；400ms 内完成则直接
退出，超过门槛才显示无操作按钮的 modal 关闭等待面。
标题为“正在安全退出”，正文说明正在保存本地状态并关闭后台服务，并以条件文案说明尚未完成的 AgentRun
会一并取消。关闭开始后不再刷新 Camp 投影，取消结算产生的晚到请求拒绝也不显示为错误横幅或 Toast。
业务事务将所有目标 Run 结算为已取消，Input/Action 不确定证据留在底层审计并继续进入 shutdown report，
但不产生公共“外部效果待确认”。精确 AgentRun Stop 显示“已取消”。精确边界见
[Planned Shutdown v8](../../contracts/planned-shutdown-v8.md)。

## Theme, keyboard and failure states

Day/Night 复用同一 DOM 和状态矩阵。主要操作支持键盘；Drawer、stage、Dock、menus、disclosure
和 Stop 均可通过键盘操作，不添加额外焦点装饰。Loading、Empty、Partial、Error、Disabled、Submitting 与 Recovery 必须
保留当前上下文、草稿和可恢复导航，而不是用通用错误页覆盖整个工作区。

主会话与单聊 Composer 共用中性色边界、光标和路由强调，不添加额外焦点框；使用 `--conversation-control-line`、
`--conversation-focus`、`--conversation-focus-soft`、`--conversation-route-accent` 和主操作 token。
不改变布局、路由占位、禁用、附件或发送/停止行为；状态与身份颜色保留。

## 连续消息与待发送编辑（public Camp 已退役）

以下 Pending 队列交互只解释历史实现。当前等待区只展示已经公开的 Delivery 数量；未发送编辑不入 Core 队列，不能移回、排序、暂停或恢复。

Composer 输入和 Runtime 进度刷新不重新解析正文未变的历史 Markdown；文件链接、标题跳转回调和
本地图片投影仍使用当前权威。仅作为叙述分界的 thought/reasoning 事件保留顺序，但不单独触发 React
刷新；可见 Runtime 进度在短窗口内批量呈现，不截断事件或丢失文本 delta。私有待发送队列按变更事件、
前台恢复和 Core 重连刷新，不每秒轮询；入队本身不触发公共会话或侧栏全量读取。

执行期间 Composer 保持可输入，右侧主操作始终只有一个 32px 圆角图标按钮：输入框没有正文（含仅空白字符）时
使用中性表面的方形停止图标，有正文时切换为 `--conversation-action` 底的向上发送图标，删空后恢复停止图标；空闲时只显示发送图标。
空输入框按 Enter 不触发停止。按钮不显示“发送”“停止”或“正在提交停止请求”等可见文字，通过 tooltip、`aria-label`
和 `aria-busy` 保留动作与提交状态；停止请求处理中在按钮内部用环形反馈围绕停止图标，不改变按钮宽度。提交期间禁用正文、
附件、路由和发送，附件准备期间只禁用发送；不改成“加入待发送”或“提交中”。队列未空时，即使当前
没有运行也继续入队。队列条位于 Composer 上方，与输入框同宽、同轴，按 FIFO 排列，不显示单条
序号，不提供排序或合并；较长队列在有界区域滚动。Pending 不作为用户消息显示在公共时间线。
普通排队不额外显示自动续发说明。队列使用系统字体、10.5px 正文、32px 最小行高与 6px 空心圆点；
普通底色由 `--surface-subtle` 44% 与 `--conversation-surface` 混合。Day/Night 使用相同结构。

仅右侧 24px 铅笔按钮触发编辑，正文和行背景不响应。点击后把完整消息移出队列，覆盖普通输入框的正文、
附件、@成员、Reply 和选文引用，并把光标置于末尾。提示文字为“移回输入框编辑（覆盖当前内容）”。
原行消失，不保留蓝色编辑行、“正在编辑”标记、独立编辑器或保存/取消按钮。再次点击其他行按同一规则覆盖。
再次发送按新消息处理：执行中或队列非空时进入队尾，否则直接发送，不恢复原序号或位置。

移回请求在 Core 事务内完成出队和 Draft 写入，成功前锁定普通输入框及附件/路由操作；期间离开 Camp 被 guard
阻止。失败保留输入；若消息已经先发出，提示它已变化或发出并刷新队列。未知结果或成功后的 Draft 读取失败
先显示加载错误，用户重读后再恢复输入，不能用旧正文覆盖已经移回的 Draft。切换 Camp、页面和关窗均沿用
普通 Composer Draft 的保存路径。旧版遗留编辑占用使用中性的“上次编辑未完成 · 请移回输入框”提示；移回或删除
会清除该行占用，新 Desktop 不再创建占用。

Pending 行只展示正文，不展示附件或附件数量；纯附件摘要留空。移回后完整复用普通 Composer 的横向附件带、
预览、移除、引用与 Mention 能力；失败附件可先移回再修复。用户原文件不移动、不删除。

上一轮正常结束、失败终态或停止完成都取当前队列第一条；输入框编辑不阻塞续发。停止仍只结束当前执行，
待其完全结算才发送下一条，不提供暂停/继续队列入口。队首发送失败时原位展示错误并阻塞后续；用户移回编辑
或删除后，剩余队列继续推进。移回的消息需要用户再次发送才重新进入队列。

上述持久化、双方 revision 与移回竞争只属于 [Pending Camp Input v4（历史）](../../contracts/pending-camp-input-v4.md)。

## 多段消息选文引用

引用仅针对同一条用户/队员消息正文，一次可跨段落、列表和代码，分次操作追加多段。跨消息、正文外、附件/文件/历史引用/过程卡片均不显示入口；复制和右键菜单关闭残留浮层，正常复制不受影响。

引用元数据放在现有 composer-box 内：回复摘要 → 引用标签 → 问题 → 工具栏。常驻约 36px 单行，只显示一个 28px 无描边圆角标签，使用中性底色、无分隔线；标签显示引用图标、段数和去重作者名称，不预览选文。

悬浮约 160ms 或键盘 focus 后出现非模态内容气泡。鼠标移入气泡保持打开，离开约 220ms 收起；ArrowDown/Tab 进入选文行，Escape 关闭并回到标签，点击/触屏使用同一气泡。每个选文行展示完整捕获文本，长列表可滚动，点击整行直接定位来源；不再存在查看全文/跳转原文按钮或引用模态框。只有草稿提供独立 × 直接移除，不提供撤销；历史只读。移除最后一段后关闭气泡并隐藏整个引用标签区，不保留空占位。键盘移除后聚焦相邻选文，最后一段移除后回到问题输入框；失败保留原引用与问题。

引用不改变 Reply/接收者。框外 route slot 保持原有 39px 占位及 continuation 语义。公共来源限当前 Camp，私聊限当前精确 Conversation。历史在新正文之前使用同样的小型引用标签；引用标签不是正文选择 root。来源不可用时说明“原消息暂不可用，已保留引用选文”。失败保留草稿，超限提示，不自动发送或截断。

来源定位使用柔和底色覆盖选区涉及的完整视觉行，包括首尾只选择部分字符的行；其余行和整条消息底色不变。约 3 秒后淡出，尊重 reduced motion，宽度变化重算。来源已变化或无法唯一定位时明确反馈并保留引用文字，不猜测重复句子位置。装饰不妨碍继续选文与复制。

字段、快照、owner、预算及安全边界由 [Message Quotes v1](../../contracts/message-quotes-v1.md)拥有。
