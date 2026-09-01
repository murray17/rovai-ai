---
document_type: ui-component
component: channel-settings
authority: channel-settings-presentation-and-interaction
status: accepted
last_updated: 2026-09-01
---

# 渠道设置

渠道设置是 Owner 在 Rovai 本机维护飞书/钉钉连接与队员 Bot 的 Renderer surface。群首次项目选择发生在对应外部会话的
Owner-only 卡片中；Renderer 不提供 Channel 项目目录或会话绑定操作。领域状态和错误按 Provider 分别见
[Feishu Channel v11](../../contracts/feishu-channel-v11.md)与
[DingTalk Channel v6](../../contracts/dingtalk-channel-v6.md)；本页只拥有信息层级、交互与可访问性。

当前渠道页同时显示飞书与钉钉。切换 Provider 只切换本地管理投影，不合并账号、Bot、待绑定或异常计数；
既有钉钉账号和已发布 Bot 直接按真实状态恢复，不显示“待接入”占位入口。

## 页面结构

页面沿用设置工作区的 Porcelain Day / Steel Night 世界和现有 `SettingsPageHeader`：

1. `Settings / Channels` eyebrow、标题“渠道”、Owner 本机说明；
2. 飞书与钉钉 Provider Tab；切换只改变当前展示，不合并账号、Bot 状态或诊断；
3. 当前 Provider 的渠道连接，展示真实开发者用户名、企业与可选 email，提供登录、切换和断开；
4. 队员 Bot 列表，按成员稳定顺序显示头像、名称、角色、发布状态和单行动作；
5. 只有存在 pending binding 或 binding error 时，显示安静的诊断计数，不提供正常操作入口；
6. 页面最底部显示默认折叠的“局域网执行台”全局设置，不放入单个 Bot、Camp 或队员行。

窄窗口保持同一内容顺序，表格式行折为纵向信息，不产生横向滚动。共享色彩只使用现有语义 Token；头像、按钮、
Dialog、状态点和间距复用现有组件语法。

<a id="渠道连接与二维码"></a>
## 渠道连接与 OAuth

飞书未连接时主动作是“登录开放平台”，已连接时为“切换账号”；钉钉为“连接钉钉／重新连接”。已连接时均保留次级“断开”。连接行只展示真实 `userName`、
`tenantName`、可选 email 与 Feishu/Lark/DingTalk brand，不显示 controller App 或“平台 Owner/企业”占位值。说明必须明确：
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

钉钉使用同一个 modal 结构，标题“登录钉钉开放平台”，直接展示 Main 从官方登录页读取的二维码，不打开系统浏览器或独立窗口。
扫码后清除二维码并显示确认状态；平台提示过期时提供“刷新二维码”，未取得可信过期时间不显示倒计时。
需要组织选择/安全确认时仅扩大同一个 Dialog，在内容区嵌入 Main-owned 原生官方页面；没有可提取的 QR 时也保留这个交互入口。
原生页不持有 Rovai bridge；随窗口缩放和内容滚动裁剪，不能覆盖标题、关闭或取消按钮。普通 QR、状态和存储说明分行呈现，
沿用 Day/Night Token、现有图标与按钮。关闭按钮、取消和 Escape 均取消 exact attempt，只有原子保存阶段短暂禁用。
未连接时为
“连接钉钉”，已连接或明确失效时为“重新连接”；进行中显示“等待授权…”。设备授权按钮、提示、等待状态和备用入口均删除。
说明开发者 Web Session 保存在 Rovai 本地数据库，本次不创建应用或读取 AppSecret。重启恢复 Cookie，平台 SSO 能自动续接
时不打开 Dialog；只有明确失效才显示“登录已失效，请重新连接”。取消登录是无告警的 no-op；网络、超时、存储或新
Session/Core commit 失败保留旧账号。不需要 Rovai OAuth Client 配置；旧 OAuth Profile 不能当作 Cookie 使用，提示显式重连，
但成功提交前不删除旧数据或已发布 Bot。

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
窗口。Session 失效/身份漂移时显示“重新连接飞书/钉钉”并停止发布，不存在其他发布流程。

钉钉远端要求 `SELECT_APPROVER` 时，同一发布 Dialog 在 `waiting_configuration` 阶段显示“版本审批人”下拉框。候选人只
来自当前远端返回的 bounded 列表；Owner 必须明确选择并点击“提交审批并继续发布”，Rovai 不自动选择第一人。提交后仍在
审核时显示等待说明和原 App ID，关闭 Dialog 不撤销远端审批，也不把 waiting 状态报成失败。

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

已发布行不打开 Rovai 管理 Dialog，也不提供停用命令。“飞书管理”或“钉钉管理”是带可访问名称的外部链接，使用 Main
从该 Bot 绑定账号与冻结 App ID 生成的精确 `managementUrl`，以 `_blank + noreferrer noopener` 交给 Electron 在系统
浏览器打开。链接不依赖当前 Developer Session 的连接状态；Renderer 不拼接或接受任意 URL。关闭、停用、删除等
远端应用治理只在官方开放平台完成。

重新发布 Dialog 必须显示已经冻结的 App ID，明确“不会创建或换绑其他应用”；进度中的创建阶段改为“正在核对已绑定应用…”。Renderer
头像只从现有 `MemberAvatar` 读取；发布时 Main 独立解析同一个受控 `avatarRef` 并上传 exact icon rendition，渠道页不
解析或接收本机头像路径。非空头像引用无法安全读取时，发布失败而不是展示或上传另一身份。

## Owner identity 与绑定诊断

Owner identity 是入站安全边界，不是 Owner 需要处理的产品状态。Renderer 不展示“Owner 身份待核验”、核验按钮或任何
per-App identity 状态。已连接 Developer Identity 已确定 canonical Owner；首条携带匹配 tenant user identity 的可靠
message/callback envelope 会在同一入站流程自动记录 App-scoped identity 并继续处理。映射缺失或冲突时由 Host/Core
内部 fail closed，不能把用户名、群管理员身份或卡片 payload 当成 Owner 证据。

页面可在 Provider 卡底部显示 `待处理项目选择 N` 与 `绑定异常 N` 两个低强调诊断值；零值可省略。它们只帮助 Owner
理解当前 Provider 状态，不把另一 Provider 的计数相加到当前 Tab，也不展开项目列表、路径、会话 picker 或 resolve 操作。
正常流程是 Owner 私聊自动 Quick Chat，或飞书群/话题、钉钉普通群第一次有效 mention 后在对应卡片中选择项目；钉钉话题
当前不接入。

项目卡沿用 Rovai 克制、信息先行的表达：标题为“选择 Rovai 项目”。飞书正文为“选择一个项目，或直接开始快速对话。”，
后接“选择项目后，这个话题之后都会使用该项目；快速对话不绑定项目。”；普通群用“群聊”替换“话题”。项目下拉框独占
一行，仅显示 bounded project display name；下一行依次为“开始快速对话”和“刷新项目”。没有可用项目时不展示空下拉框，
保留两个按钮及可直接快速对话的说明。两种选择都冻结同一个 Camp 工作区，不提供换绑入口。
卡片不得显示 canonical path、外部 identity、credential 或内部错误。钉钉固定使用官方 AI Markdown 模板、Stream callback
且禁止转发；项目以最近使用顺序显示最多六个按钮，随后是“开始快速对话”和“刷新项目”，没有项目时仍能直接 Quick Chat。

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

“显示最近输出”展开最多最后 30 个公开正文与安全 command，按真实顺序混排；不展示结果、逐条状态或分页。
它仍是 Owner callback，文案在展开后变成“收起最近输出”。“打开执行台”是直接 `open_url`，没有 loading、
“已发送到私聊”或 Owner-only 文案；按钮只在卡片首次创建时已有可用 URL 才显示。“停止执行”在平台支持时使用危险样式，
只在非终态显示，不使用 Spinner 制造第二个执行状态。

卡片只在状态、按钮可用性或已展开最近输出窗口变化时更新。永久正文卡继续独立发布，执行卡仍是临时 surface；
下一轮召回后不留下完成占位。安全、固定 URL、Token、callback 和串行更新边界由
[Feishu Channel v11](../../contracts/feishu-channel-v11.md)和
[DingTalk Channel v6](../../contracts/dingtalk-channel-v6.md)拥有。

## 局域网执行台设置

“局域网执行台”位于渠道页所有连接、发布与诊断内容之后，使用原生 `details/summary`，每次进入页面默认折叠。
摘要只显示名称、一句“在同一网络中查看公开执行记录”和真实状态；展开后按现有设置行语法依次显示启用 Switch、
端口、ready 时的当前地址、固定旧链接警告和一个保存按钮。端口输入使用数字键盘、`1024..65535`，完成输入并失焦后
才显示行内错误；保存期间禁用按钮。状态必须以文字表达，不只依赖颜色。

Web 执行台延续 Porcelain Day / Steel Night 的冷瓷灰、Steel 品牌、身份色与中性 Evidence 层级，不建立暖色替代主题。
顶部只保留 Camp 名与“只读”，随后显示当前选中 Run 的触发消息和该队员的连续历史时间线；外部触发者在该阅读面固定显示
为“你”，不显示“飞书成员”。每个 AgentRun 都有独立过程 disclosure，当前 Run 默认展开、历史 Run 默认收起；连续操作组
与每个 Command 继续使用生产执行台的嵌套 disclosure，即使没有公开结果也保留可展开行。点击 Run 标题只切换顶部触发消息，
不代替折叠入口。
页面无写控制、分页或解释性图例，桌面与手机使用同一阅读顺序，无横向滚动；状态有文本、可见键盘焦点和最小 44px 手机点击区域。

## 状态、错误与键盘

- 首次读取使用页面内 status；无 Snapshot 时提供重试；已有 Snapshot 刷新失败保留旧内容并显示 alert；
- 所有异步操作使用稳定 busy key，防止双击；失败后恢复原动作；
- Dialog 使用 Radix focus trap、Escape/关闭、可见 label、描述和 footer actions；
- 状态不仅靠颜色，始终有文本；loading/failed 通过 `role=status/alert` 公布；
- Tab 顺序按页面视觉顺序，链接和按钮均可键盘操作，焦点不因 Snapshot 更新跳到页面起点。

## References

- [全局设计系统](../../../DESIGN.md)
- [设置工作区 brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Feishu Channel v11](../../contracts/feishu-channel-v11.md)
- [飞书渠道架构](../../architecture/feishu-channel.md)
- [DingTalk Channel v6](../../contracts/dingtalk-channel-v6.md)
- [钉钉渠道架构](../../architecture/dingtalk-channel.md)
