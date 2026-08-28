---
document_type: version-decisions
version: v1.30
lifecycle: current
last_updated: 2026-08-28
---

# v1.30 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前规范由链接的 Architecture、Contract、UI 与 Context 说明拥有。

<a id="v1-30-d01"></a>
## V1.30-D01：项目绑定是 Owner 本机目录，不把外部成员提升为本地用户

> 当前产品语义已由 [V1.30-D09](#v1-30-d09)取代；本节保留早期方案的取舍记录。

### 背景

飞书群成员需要使用 Agent，但本机项目路径可以暴露源码、凭据和文件权限。authorized users、sender allowlist 或
飞书侧项目申请都会把消息身份误当成本机管理身份，也会把路径选择扩散到不受控渠道表面。

### 决定

Core 建立 owner-only `ProjectBinding` 目录；只有 `local_user` 可以维护路径和绑定/切换渠道会话。飞书只使用不透明
Binding ID。绑定后任意会话成员可通过私聊或显式 mention 使用 Agent；`ExternalPrincipal` 只表达作者、上下文来源
和回复目标，不获得任何 Owner 能力。

未绑定消息只记录待绑定会话，不建立 Principal、Camp 或执行；Owner 绑定后发送者必须重发。当前规范见
[飞书渠道架构](../../architecture/feishu-channel.md#owner-only-入站与会话执行范围)和
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#2-owner-only-camp-与项目选择)。

### 后果

- 项目路径和选择入口始终留在本机 Renderer；
- 群成员使用 Agent 不需要维护第二套授权名单；
- 绑定不会把之前的消息变成迟到执行，安全边界可由 frozen binding 证明。

### 被拒绝方案

- **sender allowlist / 已授权用户：** 混淆消息准入与本机项目管理，并产生持续名册治理；
- **飞书项目 picker 或申请卡：** 会暴露本机目录和 Owner 操作面；
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
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#5-多-bot-入站聚合)。

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
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#4-externalprincipal-与-structured-content)。

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
只有话题内显式目标或 A2A exact target 且其 Bot 仍在父群时，才按需调用同一 add。移出统一走既有 remove。

当前规范见 [飞书渠道架构](../../architecture/feishu-channel.md#bot-roster-与-camp-membership)、
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#6-camp-创建roster-与-admission)和
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
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#7-channeldelivery)。

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
Manifest 可以保存应用元数据，但它不是飞书运行时权限、事件订阅或接收模式的在线 authority；写入后再读同一 Manifest
会形成自证假阳性，即使 WebSocket 能握手也不代表飞书会推送消息。

### 决定

连接只建立独立 Developer Web Session，读取真实 `userId + userName + tenantId + tenantName + brand`，并用
`safeStorage` 加密 Cookie jar；不创建 App、Secret 或 Bot。Core account 使用本地不透明 identity ID 与 digest。

普通发布由 `FeishuWebSessionMemberBotProvisioner` 先复核原始 user/tenant，再从同一 Electron Session 读取 Cookie
jar、加载开放平台页取得 CSRF 与 exact API origin。`OpenPlatformApiClient` 使用该 Session 的 Chromium fetch，通过
console API 创建并 durable freeze App、读取 Secret、启用 Bot、配置 scopes/events/callback WebSocket、发布版本，最后
回读 robot、scope catalog、event/callback state 与 version status。具体 template-first、activation-first 与恢复顺序由
[V1.30-D08](#v1-30-d08)进一步收敛。Manifest 只保留头像和兼容元数据，不参与运行时 readiness
判定。Cookie、CSRF、Secret 不离开 Main；origin/path、响应 shape 与 read-back verification 全部 fail
closed。正常路径不调用 application registration endpoint，不打开飞书确认页，也不向 Renderer 产生二维码。

该 console Adapter 明确接受上游内部协议可能变化的代价：实现集中在一个 typed client，只有精确 Feishu/Lark
origin 与 `/developers/` 路径可达，协议变化只产生可诊断失败；不得静默降级为 registration、确认页或结果不明时的
第二次创建。真实租户回归负责证明
当前上游页面与 API 仍兼容，仓库测试只证明本地请求顺序、秘密边界、回读和恢复状态机。

旧的 `/oauth/v1/app/registration + verification_uri_complete + showRegistrationConfirmation + pollRegistration`
实现整体退出产品；对应 Provisioner、Developer Session 确认窗口、typed API、IPC 与 Renderer 入口一并删除。console
发布失败保持可诊断失败，不要求队员单独扫码，不打开平台创建确认页，也不存在向 registration/确认页的手动或自动
fallback。

首次创建前写持久 `MemberBotPublicationIntent`；第一次取得 App ID 后，状态机永久冻结该队员的
`agentId + accountId + remoteAppId`，并在首次写入后冻结 `credentialRef`。失败、完成、历史 `disabled` 恢复和重新发布都不能新建 intent 或把 Bot 记录换成
第二个 App；`completed` 后只允许在 exact Bot 绑定仍存在且原账号已连接时重开同一 intent，核对并恢复原 App。Core
在 intent create、Bot 首次写入、连接完成和重复 upsert 各状态边界交叉验证这份身份，不以 Renderer 隐藏按钮代替唯一性。
当前规范见[飞书渠道架构](../../architecture/feishu-channel.md#开发者会话与队员发布)、
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#3-飞书账号与队员-bot)和
[渠道设置](../../ui/components/channel-settings.md#渠道连接与二维码)。

锁定的是任何第二个 App 和换绑，不是对同一冻结 App 的 Owner 显式核对。未知 intent 已有 `remoteAppId` 时，再次普通发布
继续使用同一 intent 和冻结 App ID；在线 readiness 不完整时只允许在同一 App 配置并发布下一 patch 版本，缺少 App ID
的未知结果仍不可恢复。队员头像来源与同 App 头像修复 mutation 的
后续修正见 [V1.30-D07](#v1-30-d07)。

### 后果

- 一次账号登录可服务多个队员发布；连接与发布是两个独立生命周期；
- 真实 identity 能在切换/失效时做 exact user/tenant 检查，Renderer 不再显示假 owner/tenant；
- 正常发布只展示 Rovai 的账号校验、创建、启用、配置、等待、发布、在线核验、长连接和完成进度，不出现飞书创建确认页；
- WebSocket 握手与 Manifest 都不是消息可达证明；只有在线 Scope/Event/Callback 状态和 published version 联合通过才完成发布；
- Rovai 不再提供 Bot 管理/停用命令；已发布 Bot 只按绑定 brand 和冻结 App ID 跳转官方应用详情页，远端生命周期由 Owner
  在开放平台治理；
- Web 页面身份/bootstrap 与 console API 是版本敏感的可替换 Adapter，真实租户效果必须独立验收，不能由本地测试
  声明成功。

### 被拒绝方案

- **保留或改名 controller App：** 它既不是账号 Session，也没有渠道运行职责；
- **连接/发布共用 application registration：** 会把每次应用注册误投影为账号授权，并让普通发布进入平台确认页；
- **保留显式兼容扫码发布：** 维持第二套创建路径、扩大版本敏感攻击面，并使首次发布的唯一状态机出现旁路；
- **普通失败后自动弹兼容二维码：** 改变用户选择，并可能在未知远端状态下重复建 App；
- **在 Rovai 中保留无远端控制力的管理/停用动作：** 会让用户误以为本机状态能够关闭飞书 Bot；
- **把 console endpoint 散落在 ChannelSettings/Renderer：** 扩大 Cookie/CSRF 暴露面，且无法统一做同源准入、响应校验
  和回读；
- **以 Manifest 写入与回读自证权限/事件已生效：** 无法证明飞书运行时会向长连接投递消息；
- **用占位 identity 标记 connected：** 无法证明发布发生在预期 user/tenant。

<a id="v1-30-d07"></a>
## V1.30-D07：飞书 Bot 复用队员受控头像，并允许冻结 App 做同身份修复

### 背景

初版普通发布统一上传 Rovai App icon，理由是本机头像不是公网 URL。但正常
console 路径本来就能上传 PNG bytes，Main 也已经拥有内置素材和 managed avatar 的完整性校验边界。继续使用统一 icon
会让飞书里的独立 Bot 丢失最重要的队员身份；在远端版本已经发布、Rovai intent 仍为 unknown 时只读接管，又会把这个
错误永久固化到当前 App。

### 决定

普通发布使用 `AgentProfile.avatarRef` 对应的 exact icon rendition：内置头像来自打包素材，managed 头像只通过 Main
受管存储校验后读取；路径和任意文件输入都不进入发布接口。只有 `avatarRef=null` 才回退 Rovai App icon，非空引用
无法读取时在远端 mutation 前 fail closed。上传 URL 同时写入创建请求与 manifest，并纳入 read-back verification。

Owner 显式重试一个已经冻结 `remoteAppId` 的 unknown intent 时仍不得创建第二个 App。若其 latest published 是初始
`1.0.0`，允许在同一 App 上传当前队员头像、重放幂等在线配置并创建或复用 `1.0.1` 修复版本；头像及在线 readiness
已经完整时只读
验证，避免重复发布。当前规范见
[飞书渠道架构](../../architecture/feishu-channel.md#开发者会话与队员发布)、
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#3-飞书账号与队员-bot)和
[渠道设置](../../ui/components/channel-settings.md#队员-bot)。

### 后果

- Rovai 与飞书显示同一名队员的同一受控头像；
- managed 文件损坏不会悄悄退化成另一身份，且本地路径仍不出 Main；
- 当前错误 App 可原地修复，不需要删除、重建或产生第二份 Secret；
- 头像修复会产生一次新的飞书版本，真实租户仍需验证平台对 manifest avatar 的最终展示。

### 被拒绝方案

- **所有 Bot 继续使用 Rovai icon：** 独立 Bot 只有名称不同，无法保持队员视觉身份；
- **把本机文件路径或 data URL 交给 Renderer/网络请求：** 破坏受控头像与本地路径边界；
- **删除并新建 App：** 会产生第二个远端身份、Secret 和潜在群成员漂移；
- **unknown reconciliation 永远只读：** 能接管错误发布，但无法修复已知由本地错误输入造成的头像。

<a id="v1-30-d08"></a>
## V1.30-D08：队员 App 采用 template-first、durable freeze 与 activation-first 收敛

### 背景

开放平台新应用在第一次发布前立即配置完整 Scope、Event 和 Callback 时，在线控制面可能长时间不返回目标状态，连续
出现 `feishu_console_event_verification_failed`。单纯延长轮询不能修正创建与发布顺序；同时，取得 App ID 后若只更新
Renderer 进度、等整个 Provisioner 返回才写 Core，会留下“远端 App 已创建、本机没有冻结 ID”的重复创建窗口。旧错误
分类还把所有“已有 App ID、credential 尚未写入”的失败视为 unknown，导致本来能安全核对同一 App 的配置失败被锁死。

飞书同时提供模板创建和 self-build 创建：永远只用其中一条会牺牲兼容性，但在结果不明时自动尝试另一条又可能产生两个
App。因此创建 fallback 必须以“服务器明确未创建”为边界，而不是以普通错误为边界。

### 决定

首次创建优先调用固定 `developer_console` 模板，并以 `publicationIntentId` 作为 correlation。只有模板请求被明确拒绝且
能够证明没有创建时，才调用一次 self-build create；transport、timeout、HTTP 408/409/429/5xx、成功响应缺少 App ID、
Session 失效或其他 commit 结果不明都 fail closed，不进入第二次创建。

取得 App ID 后，Provisioner 必须 await Main 的 durable barrier，把 exact `remoteAppId` 持久推进到 `app_created`；该
写入成功前不允许读取 Secret、启用 Bot、配置或创建版本。随后先启用 Bot、请求长连接事件模式，并创建或复用
`1.0.0` activation version 直到 published；完整 Scope/Event/Callback 配置移到 activation 之后。Event mode 与事件条目
继续共享 120 秒、每秒一次的 bounded convergence。配置方法报告真实 mutation：有变化时发布当前版本的下一 patch，
无变化时复用现有 published version，crash recovery 复用已经存在的 exact patch。

远端失败分类收敛为 `none | known_frozen | create_outcome_unknown`。只有创建结果不明且没有可信冻结 App ID 才进入
`failed_unknown_remote_state`；App ID 已冻结后的 Secret、配置、版本、credential、upsert 或 WebSocket 失败一律
`failed_recoverable`，再次操作只核对同一 App。在线 `verifyMemberBot()` 与真正 WebSocket connect 分成两个进度阶段；
Renderer 使用八个进行中阶段，并把固定 failure code 降为次级诊断。

当前规范见[飞书渠道架构](../../architecture/feishu-channel.md#开发者会话与队员发布)、
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#3-飞书账号与队员-bot)和
[渠道设置](../../ui/components/channel-settings.md#渠道连接与二维码)。

### 后果

- 新 App 先获得可发布的 activation 基线，再等待完整在线能力收敛；120 秒预算保留但不再承担修正创建顺序的职责；
- App ID 在任何后续 mutation 前成为 Core durable fact，配置失败、进程退出和重试都不会创建第二个 App；
- template 与 self-build 兼容性被限制在一个可审计 fallback，结果不明时以唯一性优先；
- 已冻结 App 的事件等待超时显示可恢复说明和“继续核对”，只有真正 create outcome unknown 锁住重建；
- 最终版本只在配置发生变化时递增，在线验证和长连接分别给出诚实进度。

### 被拒绝方案

- **继续 self-build-first：** 与平台标准模板初始化路径偏离，放大首次发布前控制面不完整的窗口；
- **模板失败一律 fallback：** transport 或响应丢失后可能再次创建，破坏每名队员唯一 App 身份；
- **拿到 App ID 后只发 progress、最终再持久化：** crash 会丢失唯一恢复锚点；
- **首次发布前等待完整业务配置：** 把最终一致性等待放在应用尚未 activation 的阶段，重复触发 Event 假失败；
- **所有后续失败继续标成 unknown：** 混淆“创建是否发生”和“已知 App 是否配置完成”，阻断安全 reconciliation；
- **固定总是发布 `1.0.1`：** 重试或 crash recovery 会重复版本，无法表达配置实际是否发生 mutation。

<a id="v1-30-d09"></a>
## V1.30-D09：飞书一期收敛为 Owner-only Camp，群与话题首次在私聊冻结项目

### 背景

V1.30-D01 允许绑定会话中的任意飞书成员触发 Agent，并让 Owner 在渠道设置页维护第二套 ProjectBinding 目录与会话
绑定。该模型同时引入外部成员准入、桌面端手工目录、未绑定消息重发和项目切换四套长期状态，却没有提升一期的核心
体验。群内公开项目列表还会泄露本机工作范围，多 Bot 各自抢先回卡则会重复暴露选择入口。

### 决定

飞书一期只有连接开发者账号所确认的 Owner 能触发人类根消息；每个 App 通过 `union_id -> tenant user_id -> verified
open_id` fail closed 识别。Owner 的渠道消息仍是 `ExternalPrincipal`，不映射为 `local_user`。非 Owner 私聊最多收到
节流提示，群/话题静默忽略，且都在 observation 前终止，不产生 Principal、conversation、pending binding、Camp 或 Run。
Developer Session 的开放平台 `tenantId` 与消息 envelope 的 `tenant_key` 属于不同命名空间，禁止直接比较。首条消息
必须由 frozen App 下匹配 canonical Developer Identity 的 tenant `user_id` 建立 Owner，并把 event `tenant_key` 冻结到
canonical ExternalPrincipal；后续漂移 fail closed。

删除渠道侧人工 ProjectBinding 与会话绑定操作。Core 从 Rovai 既有 directory Camp 事实投影 Project Catalog；飞书只
接收 opaque `projectId + displayName`。Owner 私聊自动使用当前 Quick Chat Camp；精确 `/new` 只在私聊关闭当前 generation、
创建新 Quick Chat Camp，且不产生 CampMessage/Turn/Run。活动根请求期间 fail closed。

普通群一个长期 Camp，话题按 canonical topic 各有一个 Camp。首次合格 Owner mention 在完整 multi-Bot aggregate finalize
后建立 `PendingCampBinding`，冻结原始消息并私聊 Owner 一张项目卡；canonical mention 顺序中的第一个受管 Bot 被冻结为
`acknowledgementAppId`，重试、恢复和后续 pending 消息不能换 Bot 或重复发卡。Card callback 只信 envelope operator，
使用 nonce/version/CAS 校验；选择 active 项目后原子创建不可换绑的 Camp，并把冻结消息按 FIFO 送入既有统一 admission。

当前规范见[飞书渠道架构](../../architecture/feishu-channel.md#owner-only-入站与会话执行范围)、
[Feishu Channel v2](../../contracts/feishu-channel-v2.md#2-owner-only-camp-与项目选择)和
[渠道设置](../../ui/components/channel-settings.md#页面结构)。

### 后果

- 一期没有飞书成员授权、渠道项目管理或会话换绑状态；
- 私聊即时可用，`/new` 只轮换 Quick Chat 历史，不把控制指令送入模型；
- 群/话题只选择一次项目，Camp 冻结路径后不可换绑；
- 项目列表只发送给 Owner，多 Bot 同一消息只有一张可恢复卡；
- `card.action.trigger`、callback mode 4 与在线回读成为每个队员 Bot 的发布必需能力。

### 被拒绝方案

- **继续允许绑定后的任意成员触发：** 扩大一期身份与滥用面，并需要额外的项目可见性和治理规则；
- **保留渠道页手工项目目录/会话绑定：** 重复 Rovai 既有项目事实源，造成路径和生命周期漂移；
- **未绑定消息要求重发：** 丢失 Owner 已明确表达的首条请求，且无法提供连续群聊体验；
- **每个被 mention Bot 都发项目卡：** 重复展示项目并产生 callback 竞态；
- **在公共群展示项目选择：** 泄露本机项目名称和工作范围；
- **允许群内 `/new` 或项目换绑：** 破坏一个群/话题、一个 Camp、一个冻结执行范围的不变量。
