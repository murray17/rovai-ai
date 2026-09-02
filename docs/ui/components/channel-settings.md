---
document_type: ui-component
component: channel-settings
authority: channel-settings-presentation-and-interaction
status: accepted
last_updated: 2026-09-02
---

# 渠道设置

渠道设置是 Owner 在 Rovai 本机维护当前开放渠道连接与队员 Bot 的 Renderer surface。群首次项目选择发生在对应外部会话的
Owner-only 卡片中；Renderer 不提供 Channel 项目目录或会话绑定操作。领域状态和错误按 Provider 分别见
[Feishu Channel v15](../../contracts/feishu-channel-v15.md)与
[DingTalk Channel v11](../../contracts/dingtalk-channel-v11.md)；本页只拥有信息层级、交互与可访问性。

当前渠道页只开放飞书管理。钉钉保留官方图标，但固定显示为置灰、不可选择的“敬请期待”入口；它使用原生
`disabled` 与 `aria-disabled=true`，不响应鼠标、键盘或触控，也不展示已保存的钉钉账号、Bot、发布、重连或管理事实。
已有钉钉数据和 Main/Core 实现不因这个 Renderer gate 删除或迁移，后续重新开放范围记录在
[v1.38](../../versions/v1.38/README.md)。

重新开放以飞书同等体验为目标：产品时机、反馈、失败和恢复应同等清晰；平台没有提供的原生 `@`、reply、附件或
disclosure 必须明确呈现为限制，不用伪造字段或自制伪原生组件掩盖。该宗旨不改变当前 disabled gate。

## 页面结构

页面沿用设置工作区的 Porcelain Day / Steel Night 世界和现有 `SettingsPageHeader`：

1. `Settings / Channels` eyebrow、标题“渠道”、Owner 本机说明；
2. 飞书可选 Provider Tab 与固定禁用的钉钉“敬请期待”Tab，均使用打包进 App 的真实品牌图标；
3. 飞书渠道连接，展示真实开发者用户名、企业与可选 email，提供登录、切换和断开；
4. 飞书队员 Bot 列表，按成员稳定顺序显示头像、名称、角色、发布状态和单行动作；
5. 页面最底部显示默认折叠的“局域网执行台”全局设置，不放入单个 Bot、Camp 或队员行。

窄窗口保持同一内容顺序，表格式行折为纵向信息，不产生横向滚动。共享色彩只使用现有语义 Token；头像、按钮、
Dialog、状态点和间距复用现有组件语法。

<a id="渠道连接与二维码"></a>
## 渠道连接与 OAuth

飞书未连接时主动作是“登录开放平台”，已连接时为“切换账号”，并保留次级“断开”。连接行只展示真实 `userName`、
`tenantName`、可选 email 与 Feishu/Lark brand，不显示 controller App 或“平台 Owner/企业”占位值。说明必须明确：
连接只决定以后发布的目标，切换不会迁移或停用已发布 Bot。点击“切换账号”后，当前账号在新二维码成功完成前继续
有效；取消或失败关闭 Dialog 后仍显示原账号，不得降级为“登录已过期”。只有切换成功才展示新账号。

飞书账号二维码使用 modal Dialog，标题“登录飞书开放平台”，并明确“本次不会创建应用、读取 App Secret 或发布 Bot”。
它展示 preparing、awaiting scan、scan confirmed、identity inspection 和过期/错误；关闭必须取消 exact attempt，
迟到状态不再打开或更新 UI。用户取消是成功的 no-op：Dialog 立即关闭，不形成 failed state、页面 alert 或 toast。账号登录
是产品中唯一的扫码流程；队员发布没有兼容扫码或平台 registration 确认入口。
账号登录在 preparing 前展示 `loading_local_session`（“正在读取 Rovai 本地渠道数据…”），identity inspection 后展示
`saving_local_session`（“身份读取完成，正在保存开发者会话…”）。页面不得出现系统安全存储、钥匙串、加密授权或
`system_credential_encryption_unavailable`；身份读取超时和页面失败使用中文可操作提示，不向用户显示 `unknown` 或原始异常文本。
连接行统一说明“开发者账号会话 · 保存在 Rovai 本地数据库”。

钉钉登录、重连、断开、发布和管理 Dialog 当前都不从 Renderer 挂载。Main/Core 中已有 Web Session、credential 和
published Bot 数据保持原样，但这些事实不得绕过禁用入口重新出现在渠道页；即使 Snapshot 只含钉钉，页面也只展示
“当前版本没有可用的渠道”和禁用预告，不把钉钉设为当前 Provider。

普通发布不得进入 QR Dialog。点击列表“发布”先打开独立确认 Dialog，展示现有 `MemberAvatar`、队员名称/职责、
应用说明、当前开发者账号和租户；“确认发布”后在同一 Dialog 逐步展示八个进行中阶段。主文案固定为：

1. “正在校验发布账号…”；
2. 首次发布“正在创建独立应用…”，恢复时“正在核对已绑定应用…”；
3. “正在启用应用…”；
4. “正在读取并提交配置…”；
5. “正在等待配置生效…”；
6. “正在发布最终配置…”；
7. “正在确认 Bot 与版本…”；
8. “正在建立 Bot 长连接…”；

完成文案为“发布完成”。配置阶段说明 Rovai 正在读取当前配置并提交所需权限、事件与回调变更；等待阶段须说明平台控制面可能需要时间；
最终核验只描述 Bot、发布版本和应用资料，不声称重新读取已经由同次 convergence 证明的权限与事件。在线配置核验与真正 WebSocket connect 不得合并成
同一阶段。若配置没有 mutation，可以跳过第 6 阶段，但不得伪造一次最终版本发布。普通发布不得打开平台应用创建确认
窗口。Session 失效/身份漂移时显示“重新连接飞书”并停止发布，不存在其他发布流程。

若上次发布已冻结 App ID 并失败，Owner 再次点击“继续核对”沿用同一 Dialog 与进度语言，后台核对
并接管该 App；不显示新的创建确认，也不生成第二个 App。初始版本已发布但头像仍是旧 Rovai icon 时，同一流程可以显示
配置与发布阶段，把当前队员头像作为 `1.0.1` 修复版本发布到原 App；修复版本已 published 时只核对而不重复 mutation。
成功后依次进入在线配置核验、长连接与完成；失败继续显示原 App ID、可恢复说明和“继续核对”。只有 create 结果不明且
没有可信 App ID 时显示“远端创建结果待核对”，并隐藏重建入口。人类可行动说明是主要错误文案，固定 failure code 只在
终态作为次级诊断信息展示。

## 队员 Bot

只列出 `presence=present` 的 AgentProfile。状态文案固定对应：

| 状态 | 展示 | 动作 |
| --- | --- | --- |
| unpublished | 未发布 | 发布 |
| provisioning | 发布中 | 禁用当前行 |
| published | 已发布 | 当前 Provider 管理（官方应用详情链接） |
| failed，已有 App ID | 需处理 | 继续核对同一 App |
| failed，无 App ID | 需处理 / 远端创建结果待核对 | 安全失败可重试；true unknown 不提供重建入口 |
| disabled（历史数据状态） | 已停用 | 重新发布同一 App |

已发布行不打开 Rovai 管理 Dialog，也不提供停用命令。“飞书管理”是带可访问名称的外部链接，使用 Main
从该 Bot 绑定账号与冻结 App ID 生成的精确 `managementUrl`，以 `_blank + noreferrer noopener` 交给 Electron 在系统
浏览器打开。链接不依赖当前 Developer Session 的连接状态；Renderer 不拼接或接受任意 URL。关闭、停用、删除等
远端应用治理只在官方开放平台完成。

未发布行的身份说明固定为“发布后沿用队员身份”，不再解释名称和图标的内部配置方式。首次发布完成后，由新 Bot
主动向 exact Owner 私聊发送“`<队员名> · 已发布`”欢迎卡；渠道页只显示正常已发布状态，不为欢迎卡增加进度、重试或
错误状态。欢迎卡失败不得把该行改回“需处理”。

重新发布 Dialog 必须显示已经冻结的 App ID，明确“不会创建或换绑其他应用”；进度中的创建阶段改为“正在核对已绑定应用…”。Renderer
头像只从现有 `MemberAvatar` 读取；发布时 Main 独立解析同一个受控 `avatarRef` 并上传 exact icon rendition，渠道页不
解析或接收本机头像路径。非空头像引用无法安全读取时，发布失败而不是展示或上传另一身份。

## Owner identity 与绑定诊断

Owner identity 是入站安全边界，不是 Owner 需要处理的产品状态。Renderer 不展示“Owner 身份待核验”、核验按钮或任何
per-App identity 状态。已连接 Developer Identity 已确定 canonical Owner；首条携带匹配 tenant user identity 的可靠
message/callback envelope 会在同一入站流程自动记录 App-scoped identity 并继续处理。映射缺失或冲突时由 Host/Core
内部 fail closed，不能把用户名、群管理员身份或卡片 payload 当成 Owner 证据。

Renderer 不显示“会话接入”、待处理项目选择、绑定异常或不可换绑提示；这些值即使存在于后台快照，也不形成页面区块或占位。
正常流程仍是 Owner 私聊自动 Quick Chat，或飞书群/话题、钉钉同组织内部群第一次有效 mention 后在对应卡片中选择项目；
钉钉 Bot 必须经群“添加机器人”入口安装，普通成员形态的普通群/外部群不产生 Robot Stream callback，钉钉话题当前不接入。

项目卡沿用 Rovai 克制、信息先行的表达：标题为“选择 Rovai 项目”。飞书正文为“选择一个项目，或直接开始快速对话。”，
后接“选择项目后，这个话题之后都会使用该项目；快速对话不绑定项目。”；普通群用“群聊”替换“话题”。项目下拉框独占
一行，仅显示 bounded project display name；下一行依次为“开始快速对话”和“刷新项目”。没有可用项目时不展示空下拉框，
保留两个按钮及可直接快速对话的说明。两种选择都冻结同一个 Camp 工作区，不提供换绑入口。
卡片不得显示 canonical path、外部 identity、credential 或内部错误。钉钉固定使用平台内置通用 AI Markdown 模板，
用户无需创建、选择或发布模板；卡片使用 Stream callback 且禁止转发。项目以最近使用顺序显示最多六个按钮，随后是
“开始快速对话”和“刷新项目”，没有项目时仍能直接 Quick Chat；不为模拟飞书下拉框增加用户自定义模板前置条件。

只有 Owner 点击会消费卡片；飞书 Non-owner 看到私有无权限 toast，钉钉 Non-owner 的 callback 只完成平台 ACK，公共卡不变化。
项目失效时显示
“该项目已不可用，请重新选择”并刷新原卡；旧卡/双击显示“该项目选择已完成或卡片已过期”。成功只显示短暂
“项目已绑定，正在处理消息”反馈；Quick Chat 为“已开始快速对话，消息已进入处理”。Core 随后异步撤回卡片，
不留下永久完成卡。

## 飞书永久正文卡

公开 Agent 回复使用无标题 Card 2.0，正文为正常 Markdown；下方按 Rovai 的转交层级，以辅助字号显示
“发送给 @雾切响子 @Murray”一类的接收对象行。多个原生 @ 之间只有空格，不加逗号或顿号；没有“A2A 对象／Owner”标签、
执行状态、操作按钮或折叠。没有真实接收对象时省略整行，不把普通正文中的人名当作寻址。

有真实回复关系时，在正文上方以辅助字号的原生 Markdown 引用显示“回复 药师寺惠”及直接父消息摘要，最多 3 行/240 个
Unicode 字符，超长用省略号收尾。引用只作展示，不跳转、不额外 @；没有回复对象则省略，已删除/不可读时显示
“回复的消息已不可用”，无文本时显示“（无文本）”。不把 Topic root 当成每条消息的引用，也不嵌套展示原消息自带的引用。

该行只呈现 Core 的实际 A2A 接收对象和显式 Owner attention；不代表新的飞书 Bot 互相调用。结构化 `@你` 不再重复留在
飞书正文，普通文字中真正写出的 `@你` 保留。无法取得原生身份时名称静态显示，不冒充可用身份。
永久正文完整保留，超长拆成连续卡片，仅首张显示回复摘要，只有最后一张显示接收对象。历史已发消息不批量替换；
钉钉永久 Markdown 输出保持既有格式，不与状态卡合并。

## 飞书执行卡

钉钉复用本节的状态入口规则。飞书与钉钉执行卡都不把 Rovai 执行台压缩进群消息；执行中只显示“队员名 · 执行中”和
“显示最近输出 / 打开执行台 / 停止执行”；终态标题改为已完成、执行失败或已取消，并移除停止入口。
默认不显示正文、command、结果、进度或统计。

“显示最近输出”展开最多最后 30 个公开正文与安全 command，按真实顺序混排，不提供分页。两端的长 command 都显示
状态符号与 `$`，按约 72 个显示列保留开头和目标尾部。飞书把每条 command 呈现为默认收起的原生面板，展开后最多显示
两行安全结果；钉钉只展开整个最近输出区，不模拟逐 command 折叠，也不显示 command result。
“显示最近输出”仍是 Owner callback，文案在展开后变成“收起最近输出”。“打开执行台”是直接 `open_url`，没有 loading、
“已发送到私聊”或 Owner-only 文案；按钮只在卡片首次创建时已有可用 URL 才显示。“停止执行”在平台支持时使用危险样式，
只在非终态显示，不使用 Spinner 制造第二个执行状态。

飞书把“打开执行台”作为唯一蓝色主按钮；其余动作层级不变。三个按钮在桌面宽端保持等宽同行，在手机或其他窄端各自
独占一整行，文字不得依靠裁切表达。该适配使用 Card 2.0 的 stretch 列布局，不按设备生成两套卡片。最近输出展开后，
安全 Command 仍是默认收起的原生折叠面板。

卡片只在状态、按钮可用性或已展开最近输出窗口变化时更新。永久正文卡继续独立发布，执行卡仍是临时 surface；
下一轮召回后不留下完成占位。钉钉真正排队时发送排队 AI Card，admission 后与旧执行卡都通过 Robot recall 删除，
不更新成“已开始”“状态已结束”或“此执行记录已结束”。安全、固定 URL、Token、callback、双身份和串行更新边界由
[Feishu Channel v15](../../contracts/feishu-channel-v15.md)和
[DingTalk Channel v11](../../contracts/dingtalk-channel-v11.md)拥有。

## 局域网执行台设置

“局域网执行台”位于渠道页所有连接、发布与诊断内容之后，使用原生 `details/summary`，每次进入页面默认折叠。
摘要只显示名称、一句“在同一网络中查看公开执行记录”和真实状态；展开后按现有设置行语法依次显示启用 Switch、
端口、ready 时的当前地址、固定旧链接警告和一个保存按钮。端口输入使用数字键盘、`1024..65535`，完成输入并失焦后
才显示行内错误；保存期间禁用按钮。状态必须以文字表达，不只依赖颜色。

缺少本地设置文件的首次使用默认开启，Switch 必须显示为开启并选择端口 8765；有效的已保存选择始终优先，
不得把用户保存的关闭状态重新打开。设置文件内容无效、无法解析或无法读取时失败关闭，并通过真实状态呈现降级；
没有当前已发布渠道 Bot 时不开放端口，摘要以中性状态显示“等待 Bot 发布 · 8765”；首个 Bot 发布后自动尝试监听，
最后一个退出已发布状态时自动关闭。端口冲突或没有私有局域网地址时保留开启选择，同时显示对应不可用状态。
详情仍默认折叠，不增加确认框或迁移提示。

Web 执行台延续 Porcelain Day / Steel Night 的冷瓷灰、Steel 品牌、身份色与中性 Evidence 层级，不建立暖色替代主题。
顶部只保留 Camp 名与“只读”，随后显示当前选中 Run 的触发消息和该队员的连续历史时间线；外部触发者在该阅读面固定显示
为“你”，不显示“飞书成员”，A2A Run 则显示实际发起队员的名称与首字头像。每个 AgentRun 都有独立过程 disclosure，当前 Run 默认展开、历史 Run 默认收起；连续操作组
与每个 Command 继续使用生产执行台的嵌套 disclosure，即使没有公开结果也保留可展开行。点击 Run 标题只切换顶部触发消息，
不代替折叠入口。
页面无写控制、分页或解释性图例，桌面与手机使用同一阅读顺序，无横向滚动；状态有文本、可见键盘焦点和最小 44px 手机点击区域。

## 状态、错误与键盘

- 首次读取使用页面内 status；无 Snapshot 时提供重试；已有 Snapshot 刷新失败保留旧内容并显示 alert；
- 所有异步操作使用稳定 busy key，防止双击；失败后恢复原动作；
- Dialog 使用 Radix focus trap、Escape/关闭、可见 label、描述和 footer actions；
- 状态不仅靠颜色，始终有文本；loading/failed 通过 `role=status/alert` 公布；
- 钉钉预告使用原生 disabled 语义、可见“敬请期待”文本与灰度图标；禁用状态不获得 hover/press，也不能成为当前 Tab；
- Tab 顺序按页面视觉顺序，链接和按钮均可键盘操作，焦点不因 Snapshot 更新跳到页面起点。

## References

- [全局设计系统](../../../DESIGN.md)
- [设置工作区 brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Feishu Channel v15](../../contracts/feishu-channel-v15.md)
- [飞书渠道架构](../../architecture/feishu-channel.md)
- [DingTalk Channel v11](../../contracts/dingtalk-channel-v11.md)
- [钉钉渠道架构](../../architecture/dingtalk-channel.md)
