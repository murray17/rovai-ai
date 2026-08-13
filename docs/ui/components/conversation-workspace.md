---
document_type: ui-component-contract
authority: renderer-camp-workspace
status: accepted
last_updated: 2026-08-13
---

# Camp 会话工作区

Camp 是开放阅读面，不按角色铺不同底色。时间线、Agent 执行台、Approval/Recovery Dock 和
Composer 共享主列；Inspector 是右侧辅助列。普通叙述保持 `76ch` 阅读宽度，代码、表格等工件
可以扩展到 `930px`，2K Composer/工作区上限为 `1040px`。

## 常规会话与世界地图

会话阅读面可以在常规时间线与沉浸世界地图之间切换。切换入口与地图路线显隐使用阅读面内的紧凑
悬浮控件，不占用 Camp Header 或独立工具栏；左侧导航、Inspector、Approval/Recovery Dock、Composer
与 Agent 执行台保持既有位置和权威。切换不得清空时间线滚动、Draft、Inspector 选择、Approval、
执行台焦点或正在接收的真实活动更新。

世界地图只消费当前 Camp 中可呈现队员和既有 AgentRun、Runtime activity、A2A/Delivery 事实的有界
只读投影。固定地点、路线、稳定随机移动、停留、视觉会合和闲时文案都属于 Renderer 瞬时状态；地图
位置不表示 Task 进度、Run 阶段、投递状态或协作成功，不持久化，也不向 Core 或 Runtime 写回。

忙时气泡只能压缩展示已有 narration、plan 或 tool activity；长文本可以有界省略，但不得合成步骤、
百分比或成功判断。没有进行中任务时可以显示组合式环境预设，但必须标记“闲时 · 环境预设”，不能
伪装成 Agent 输出。等待或结果待确认的队员保持静止，并沿用既有诚实文案。

地图必须按会话容器而非窗口高度适配：Inspector 显隐和可上下拖动执行台压缩主列时，地图收缩、裁切
或降低次要信息密度，不能遮住 Approval/Recovery Dock、Composer 或执行台。静态模式与 reduced motion
停止角色移动、路线流光、脉冲和会合动画，但不能停止 Snapshot/Runtime 驱动的真实文字更新。

## A2A 会话消息

Agent 公共正文不显示“来自执行”来源条，也不投影 compact 投递卡。已交付 A2A 消息只在正文后
显示简短转交轨迹“发送给 @队员”；底层 Delivery 状态、失败码和恢复事实仍由 Core Read Side
拥有，不在 footer 或 Run stage 重复展示。

用户、队员和已交付 A2A 正文支持原生鼠标拖选与系统复制。整条消息的复制入口固定在内容列
右上角，只在悬停或键盘聚焦消息区域时显现；不能随正文、宽屏工件或 footer 漂移。用户消息保持
精确纯文本；Agent 正文使用清洗后的 GFM；Tool 输出使用结构化证据组件。

当前可操作的队员头像、显示名和 Mention 可打开同一个锚定人物信息卡，不导航。已离开、移除或
不可解析身份保持静态。精确 token 行为见[结构化 Mention](structured-mentions.md)。

## Camp 执行过程

同一 Camp 中每个曾有 AgentRun 的队员只保留一个 Agent 过程入口。按需 Drawer 以时间顺序展示
该 Agent 的独立 Run stage、状态、收件人与证据；这只是 Renderer grouping，不创建 Process
领域对象，也不合并 AgentRun。

打开过程入口时，先定位最新 running，其次最新 non-terminal，最后最新 terminal Run。用户显式
发送成功且未在查看 non-terminal Run 时，按 Core 有序回执打开首个 Run 的精确 stage，但不夺走
Composer 焦点。后台 A2A、Runtime 事件、重载与恢复不得自动打开、切换或抢焦点。

聚焦 live Run 且用户停留 Drawer 底部时可跟随最新输出；手动上滚后暂停，回到底部恢复。该跟随
不能滚动公共消息时间线。Drawer 空间不足时收缩、滚动或变为摘要，不能遮住 Approval Dock、
Composer 或唯一 Stop。

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

Composer 与消息轨道同宽同轴，Inspector 显隐不得改变二者关系。发送、Stop、Approval Dock、
附件、Skill 候选和 Mention 都使用同一 Core-owned Draft；任何浮层都不能建立第二份草稿真源。

### Skill 快速选择

Composer 为空或正文被完整选中时输入 `/`，打开当前 Lead 可用 Skill 的原生候选。候选来自真实
Skill/生效组 Read Side；方向键移动，Enter/Tab 选择，Esc 关闭。选中只写普通
`/<skill-name> ` 文本并保留 Mention、附件和发送边界，不创建 Slash Command 协议，也不声称
Runtime 已读取 Skill。

### 结构化 Mention 与当前用户

队员 Mention 和 `@所有队员` 遵守[不得回退的交互合同](structured-mentions.md#不得回退的交互合同)。
Agent 的 Core-owned `--to-user` 在历史消息中显示同色但非交互的 `@当前用户` token；它不打开
人物卡、不进入 tab 顺序，且 `aria-label` 明确“提及当前用户：{显示名称}”。手写 lookalike 仍是
普通文本。该 token 是 Agent sanitized GFM 正文的行内前缀，不得为了交互 token 把正文退化为
纯文本；详细的 Markdown literal 防注入规则见[结构化 Mention](structured-mentions.md#current-user-mention)。

Message Mention 通知导航必须以 `campId + sourceMessageId` 加载和定位精确消息。通知抽屉关闭后才
滚动并转移焦点；来源不可用、渲染或聚焦失败时显示可恢复错误，不静默落到最近消息。仅打开 Camp
不会批量读掉 Message Mention；自动已读要求精确消息节点在仍聚焦、可见的时间线视口内。

### Composer 附件

文件和目录都进入当前 Draft。preparing/error 附件阻止发送；目录保存为一个只读快照附件，原文件
不移动。拖放命中、反馈和卡片合同见[会话区文件与文件夹拖放](conversation-drop-zone.md)，领域与
快照限制见 [Camp Attachment v1](../../contracts/camp-attachment-v1.md)。

## 空 Camp 欢迎状态

空 Camp 显示欢迎图形、真实协作配置摘要和三个只填充 Composer 的起步建议，不显示单行空占位。
建议不会直接发送、不会创建假消息，也不会改变已保存协作配置。

## Camp 右侧详情栏（Inspector）

ordinary Inspector 只有“任务 / 队员”。Task 提供列表与详情责任层；队员读取当前 CampMember 与
AgentProfile，并通过既有 versioned Core 命令提供唯一 Default Lead 选择器。ContextManifest 与
Runtime Input Delivery Evidence 继续存在于 Core/Snapshot，但不进入普通 Inspector；审批只在
Approval Dock 决定。

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
