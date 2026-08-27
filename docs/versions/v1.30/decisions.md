---
document_type: version-decisions
version: v1.30
lifecycle: current
last_updated: 2026-08-27
---

# v1.30 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前规范由链接的 Architecture、Contract、UI 与 Context 说明拥有。

<a id="v1-30-d01"></a>
## V1.30-D01：项目绑定是主人本机目录，不把外部成员提升为本地用户

### 背景

飞书群成员需要使用 Agent，但本机项目路径可以暴露源码、凭据和文件权限。authorized users、sender allowlist 或
飞书侧项目申请都会把消息身份误当成本机管理身份，也会把路径选择扩散到不受控渠道表面。

### 决定

Core 建立 owner-only `ProjectBinding` 目录；只有 `local_user` 可以维护路径和绑定/切换渠道会话。飞书只使用不透明
Binding ID。绑定后任意会话成员可通过私聊或显式 mention 使用 Agent；`ExternalPrincipal` 只表达作者、上下文来源
和回复目标，不获得任何主人能力。

未绑定消息只记录待绑定会话，不建立 Principal、Camp 或执行；主人绑定后发送者必须重发。当前规范见
[飞书渠道架构](../../architecture/feishu-channel.md#项目与会话)和
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#2-projectbinding-与渠道会话)。

### 后果

- 项目路径和选择入口始终留在本机 Renderer；
- 群成员使用 Agent 不需要维护第二套授权名单；
- 绑定不会把之前的消息变成迟到执行，安全边界可由 frozen binding 证明。

### 被拒绝方案

- **sender allowlist / 已授权用户：** 混淆消息准入与本机项目管理，并产生持续名册治理；
- **飞书项目 picker 或申请卡：** 会暴露本机目录和主人操作面；
- **绑定后自动回放首条消息：** 不能证明用户仍希望执行，也跨越 observation 时的授权事实。

<a id="v1-30-d02"></a>
## V1.30-D02：多 Bot 先聚合、再走统一原子 admission 与单根 FIFO

### 背景

同一飞书消息同时 mention 多个独立 Bot 时，每个 App 都可能收到相同事件。由第一个连接立即创建 Run 会遗漏目标；
由 Host 直接写 CampMessage/Run 会形成第二套发送事务。同一 Camp 并行接受多条根用户消息又会交错公共结果。

### 决定

第一条 observation 只建立 collecting aggregate。只有 canonical mentions 完整或全部预期 App observation 到齐，
独立 finalize 才可继续；payload mismatch 或三秒 timeout fail closed。Finalize 创建持久
`ChannelTurnRequest`，每个 Binding 同时至多一个 admitted root，后续 FIFO queued 且不进入 conversation。

真正提升调用 `CollaborationService.admit_external_channel_message`，复用本地用户发送的同一原子 admission，一次性
创建触发 CampMessage、CampTurn 和全部目标 Run。当前规范见
[飞书渠道架构](../../architecture/feishu-channel.md#入站聚合与串行准入)和
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#5-多-bot-入站聚合)。

### 后果

- 多 App 重试只得到一个请求和一张状态卡；
- queued 请求不污染 History/Context，Core 重启可从持久队列恢复；
- 不同 Camp 仍并行，同一根 Turn 内的多 Agent/A2A/Gather 仍按既有语义运行。

### 被拒绝方案

- **第一条 observation 直接 admission：** canonical target 集可能尚不完整；
- **Host 拼装 CampMessage/Run：** 绕过用户路径已具备的原子门禁；
- **把 queued 消息先放入 Timeline：** 会让后续 Turn 指令提前进入当前 Run 上下文。

<a id="v1-30-d03"></a>
## V1.30-D03：飞书 reply 永远冻结为当前消息的 ExternalQuote

### 背景

判断飞书 parent message 是否已经投影到当前 Camp 需要长期维护 external ID 到 CampMessage 的双向账本，并处理
编辑、撤回、跨 Camp、Bot 回声和未 mention 历史。该复杂度只为模拟 Rovai 本地 reply，却会让同一渠道回复出现
两种不可预测语义。

### 决定

任意飞书 `parent_id` 都只在本次入站读取一次并冻结为当前触发 CampMessage 的 Structured Content
`ExternalQuote`。被引消息不单独物化，飞书触发消息的 `replyToCampMessageId` 始终为空；external message ID 只在
有 TTL 的 dedup/aggregation/outbox transport 中使用。Core Context projector 通过 Formatter/Manifest 22 把 quote
投影进标准 `CURRENT_INPUT.message`，不接受 Host prompt override。

当前规范见 [ContextManifest Evidence v22](../../contracts/context-manifest-evidence-v22.md)、
[模型上下文变更说明](model-context-change-feishu-external-principal.md)和
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#4-externalprincipal-与-structured-content)。

### 后果

- 本轮唯一自然语言指令仍是一个可审计 CampMessage；
- 回复用户消息和 Bot 消息行为一致，缺失来源使用确定性不可读摘要；
- 不建立永久 external-message reply projection，也不污染 reference closure。

### 被拒绝方案

- **命中时内部 reply、未命中时 quote：** 结果依赖异步投影时序；
- **把被引消息建成第二条 CampMessage：** 未 mention 历史会进入公共会话；
- **Host 直接拼 Runtime prompt：** 绕过 Structured Content、Manifest 和 Runtime delivery evidence。

<a id="v1-30-d04"></a>
## V1.30-D04：群 Bot roster 复用 Camp Membership v1，普通群与话题采用不同扩张规则

### 背景

普通群直觉上所有在群 Rovai Bot 都属于同一 Camp；话题群若同步父群完整名册，则以后加入的新 Bot 会污染每个
历史话题。另建飞书专属成员表又会绕过 v1.29 的 lifetime fence、移除 cutover 与 reconciliation。

### 决定

Host 只提交所有 published Bot 的完整 `isInChat` 快照。普通群首次及后续都把 present roster 通过既有
`camp.member.add/remove` 与 exact source generation 同步。话题首次只使用当前 mentions，父群新增不自动扩张；
只有话题内显式目标或 A2A exact target 且其 Bot 仍在父群时，才按需调用同一 add。移出/停用统一走既有 remove。

当前规范见 [飞书渠道架构](../../architecture/feishu-channel.md#bot-roster-与-camp-membership)、
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#6-camp-创建roster-与-admission)和
[Camp Membership v1](../../contracts/camp-membership-v1.md)。

### 后果

- 动态成员沿用 membership generation/version、source binding 与 reconciliation；
- 普通群 roster 与 Camp 一致，历史话题保持最小成员集；
- roster 不完整、未知 App 或 absent target 都 fail closed。

### 被拒绝方案

- **飞书专属 add/remove：** 会形成第二套成员授权与收口；
- **父群 roster 广播到全部话题：** 历史 Camp 被无关 Bot 污染；
- **只信 botAdded/botDeleted delta：** 丢事件或乱序后无法证明完整当前集合。

<a id="v1-30-d05"></a>
## V1.30-D05：秘密与网络留在 Main，公开结果由 Core Outbox 可靠投影

### 背景

多 App Secret、WebSocket 和飞书网络重试属于桌面宿主能力；把 Secret 放进 Core/Renderer 会扩大暴露面。另一边，
若 Agent 输出由 Main 临时监听并直发，网络失败或重启会丢失已经提交的公共结果，也可能泄漏 Runtime 原始流。

### 决定

Main 使用 OS safeStorage 保存 Developer Session Cookie jar 与每 App Secret，Core 只保存 identity 摘要、
credential ref 和业务身份。公开输出和状态先由 Core 从
权威请求/CampMessage 投影为 durable ChannelDelivery；Main 使用 lease 领取、发送并回写结果。只有 Core 已提交
内容可以外发，实际作者使用其独立 Bot，不能用另一个 Bot 冒充。Renderer snapshot 删除 credential 和 Host-only
恢复字段。

Developer Session 与 App provisioning 的进一步边界由 [V1.30-D06](#v1-30-d06)修正；本决定继续拥有
Main/Core/Renderer 的秘密和 Outbox 分工。当前规范见 [飞书渠道架构](../../architecture/feishu-channel.md#输出恢复与秘密)和
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#7-channeldelivery)。

### 后果

- 飞书不可用不回滚或丢失 Core CampMessage；
- App 间故障隔离，重启后可恢复连接、queue card 和 Outbox；
- 断开 Developer Session 不删除已发布 Bot credential，也不停止其独立长连接。

### 被拒绝方案

- **Secret 存 SQLite 或返回 Renderer：** 扩大日志、诊断和 UI 注入暴露面；
- **直接转发 Runtime stream：** 可能泄漏推理/工具输出且没有公共消息 authority。

<a id="v1-30-d06"></a>
## V1.30-D06：Developer Session 与队员 App credential 分离，普通发布直连开放平台控制台

### 背景

把应用注册结果当成账号连接，会把 App credential 误当 Developer Identity；连接本身会意外新增远端应用，用户名/
企业只能写占位值，而每名队员发布仍要重新扫码。继续把官方 application registration begin/poll 当作普通发布，虽能
复用已登录 Session，却仍会打开飞书“创建飞书智能体应用 / 立即创建”确认页，无法形成 Rovai 自己拥有的连续发布
体验。开放平台 console API 与页面 CSRF 又是版本敏感、未公开稳定合同，需要明确隔离而不能扩散到业务层。

### 决定

连接只建立独立 Developer Web Session，读取真实 `userId + userName + tenantId + tenantName + brand`，并用
`safeStorage` 加密 Cookie jar；不创建 App、Secret 或 Bot。Core account 使用本地不透明 identity ID 与 digest。

普通发布由 `FeishuWebSessionMemberBotProvisioner` 先复核原始 user/tenant，再从同一 Electron Session 读取 Cookie
jar、加载开放平台页取得 CSRF 与 exact API origin。`OpenPlatformApiClient` 使用该 Session 的 Chromium fetch，依次
创建 App、读取 Secret、启用 Bot、分步配置 scopes/events/callback WebSocket、创建并发布版本，最后回读 manifest 和
version status。Cookie、CSRF、Secret 不离开 Main；origin/path、响应 shape 与 read-back verification 全部 fail
closed。正常路径不调用 application registration endpoint，不打开飞书确认页，也不向 Renderer 产生二维码。

该 console Adapter 明确接受上游内部协议可能变化的代价：实现集中在一个 typed client，只有精确 Feishu/Lark
origin 与 `/developers/` 路径可达，协议变化只产生可诊断失败；不得静默降级为另一条创建路径。真实租户回归负责证明
当前上游页面与 API 仍兼容，仓库测试只证明本地请求顺序、秘密边界、回读和恢复状态机。

旧的 `/oauth/v1/app/registration + verification_uri_complete + showRegistrationConfirmation + pollRegistration`
整体移入 `FeishuCompatMemberBotProvisioner`，只服务主人明确选择的兼容模式。兼容确认入口继续只接受
`open.feishu.cn | open.larksuite.com` 的精确 `/page/launcher | /page/cli` 与非空 `user_code`，不得成为普通失败的
fallback。

每次创建前写持久 `MemberBotPublicationIntent`；远端结果未知时锁定自动重试，已冻结 App ID/credential ref 不可换成
第二个 App。当前规范见[飞书渠道架构](../../architecture/feishu-channel.md#开发者会话与队员发布)、
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#3-飞书账号与队员-bot)和
[渠道设置](../../ui/components/channel-settings.md#渠道连接与二维码)。

锁定的是自动创建和第二个 App，不是对同一冻结 App 的主人显式核对。未知 intent 已有 `remoteAppId` 时，再次普通发布
继续使用同一 intent 和冻结 App ID，缺少 App ID 的未知结果仍不可恢复。队员头像来源与同 App 头像修复 mutation 的
后续修正见 [V1.30-D07](#v1-30-d07)。

### 后果

- 一次账号登录可服务多个队员发布；连接与发布是两个独立生命周期；
- 真实 identity 能在切换/失效时做 exact user/tenant 检查，Renderer 不再显示假 owner/tenant；
- 正常发布只展示 Rovai 的账号校验、创建、配置、发布、验证和完成进度，不出现飞书创建确认页；
- Web 页面身份/bootstrap 与 console API 是版本敏感的可替换 Adapter，真实租户效果必须独立验收，不能由本地测试
  声明成功。

### 被拒绝方案

- **保留或改名 controller App：** 它既不是账号 Session，也没有渠道运行职责；
- **连接/发布共用 application registration：** 会把每次应用注册误投影为账号授权，并让普通发布进入平台确认页；
- **普通失败后自动弹兼容二维码：** 改变用户选择，并可能在未知远端状态下重复建 App；
- **把 console endpoint 散落在 ChannelSettings/Renderer：** 扩大 Cookie/CSRF 暴露面，且无法统一做同源准入、响应校验
  和回读；
- **用占位 identity 标记 connected：** 无法证明发布发生在预期 user/tenant。

<a id="v1-30-d07"></a>
## V1.30-D07：飞书 Bot 复用队员受控头像，并允许冻结 App 做同身份修复

### 背景

初版普通发布统一上传 Rovai App icon，理由是本机头像不是公网 URL，兼容 registration 也只能接受 URL preset。但正常
console 路径本来就能上传 PNG bytes，Main 也已经拥有内置素材和 managed avatar 的完整性校验边界。继续使用统一 icon
会让飞书里的独立 Bot 丢失最重要的队员身份；在远端版本已经发布、Rovai intent 仍为 unknown 时只读接管，又会把这个
错误永久固化到当前 App。

### 决定

普通发布使用 `AgentProfile.avatarRef` 对应的 exact icon rendition：内置头像来自打包素材，managed 头像只通过 Main
受管存储校验后读取；路径和任意文件输入都不进入发布接口。只有 `avatarRef=null` 才回退 Rovai App icon，非空引用
无法读取时在远端 mutation 前 fail closed。上传 URL 同时写入创建请求与 manifest，并纳入 read-back verification。

主人显式重试一个已经冻结 `remoteAppId` 的 unknown intent 时仍不得创建第二个 App。若其 latest published 是初始
`1.0.0`，允许在同一 App 上传当前队员头像、重放幂等配置并创建或复用 `1.0.1` 修复版本；`1.0.1` 已 published 时只读
验证，避免重复发布。兼容 registration 仍不接收本机 bytes。当前规范见
[飞书渠道架构](../../architecture/feishu-channel.md#开发者会话与队员发布)、
[Feishu Channel v1](../../contracts/feishu-channel-v1.md#3-飞书账号与队员-bot)和
[渠道设置](../../ui/components/channel-settings.md#队员-bot)。

### 后果

- Rovai 与飞书显示同一名队员的同一受控头像；
- managed 文件损坏不会悄悄退化成另一身份，且本地路径仍不出 Main；
- 当前错误 App 可原地修复，不需要删除、重建或产生第二份 Secret；
- 头像修复会产生一次新的飞书版本，真实租户仍需验证平台对 manifest avatar 的最终展示。

### 被拒绝方案

- **所有 Bot 继续使用 Rovai icon：** 独立 Bot 只有名称不同，无法保持队员视觉身份；
- **把本机文件路径或 data URL 交给 Renderer/registration：** 破坏受控头像与本地路径边界；
- **停用并新建 App：** 会产生第二个远端身份、Secret 和潜在群成员漂移；
- **unknown reconciliation 永远只读：** 能接管错误发布，但无法修复已知由本地错误输入造成的头像。
