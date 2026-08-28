---
document_type: protocol-contract
contract: feishu-channel-v2
authority: feishu-channel-project-binding-admission-delivery
status: accepted
version: 2
last_updated: 2026-08-29
---

# Feishu Channel v2 Contract

本合同拥有 Owner-only 入站、Quick Chat generation、Core Project Catalog、PendingCampBinding、渠道会话、
ExternalPrincipal、多 Bot 聚合、串行 ChannelTurnRequest、群 roster 和 ChannelDelivery 的字段与状态语义。Camp membership 仍由
[Camp Membership v1](camp-membership-v1.md)拥有，模型输入由
[ContextManifest Evidence v22](context-manifest-evidence-v22.md)拥有。v2 替换队员 Bot 的创建、首次发布、
配置收敛、远端失败分类、恢复和 Renderer 进度合同；v1 成为历史合同。

## 1. Actor 与秘密边界

| 能力 | 合格 Actor |
| --- | --- |
| 连接/断开账号、发布队员 Bot | 本机 Owner 经 typed Desktop API |
| Owner identity verify、inbound observe/finalize、DM `/new`、项目卡 resolve、roster、Host tick、delivery settle | `feishu-channel-host` System component |
| Camp membership source mutation | `channel-membership-sync` + exact `feishu` source binding/generation |

`ExternalPrincipal` 没有任何本机 Owner 能力。不存在 authorized user、sender allowlist、渠道侧人工项目目录、会话换绑或
外部成员项目申请。只有已验证 Feishu Owner 可以触发消息；Owner 仍投影为 ExternalPrincipal，不能借渠道消息调用
`local_user` 命令。项目卡 resolve 是窄的 `ChannelBindingApproval`：只能为 exact pending binding 选择一个现存 active
project 或取消/刷新，不能创建项目、改路径、改 Agent 或发布 Bot。

Developer Session Cookie jar 与 App Secret 只存于 Electron Main，并以 OS `safeStorage` 加密；页面 bootstrap 取得的
CSRF 只在一次 Main 发布流程内存活。Core 仅持久化
Developer Identity 的摘要/显示字段和每 Bot `credentialRef`；Renderer/API Snapshot 不得出现 `userId`、
`appSecret`、Cookie、CSRF、token、原始 credential payload、transport conversation 或 pending aggregate。系统加密
不可用或 15 秒内未完成时 Session/credential read/write 必须失败，不能降级为明文。登录必须在打开飞书页面前完成
安全存储预检；显式隔离验收实例使用由其 `userData` 目录摘要派生的独立应用名作为 safeStorage 命名空间，目录原文
不得进入命名空间或日志。

## 2. Owner-only Camp 与项目选择

连接账号后 Core 为其建立 `FeishuOwnerIdentity`。每个 Bot 发布或同 App reconciliation 在完成 Scope、Event、
Callback/WebSocket 与版本在线核验后，必须先再次证明 publication intent 对应的 Developer Identity，再用该 App
credential 调用 Application v6 get，并以 `user_id_type=open_id` 读取响应中不可变的 `creator_id`。App 创建与 durable
freeze 均发生在该已证明 Session 中，因此该值就是 App 作用域的 `ownerOpenId`。可信 Main Host 随
`channels.feishu.memberBot.upsert` 把 `(account_id, app_id, owner_open_id digest)` 与 Bot binding 在同一 Core
事务冻结；现有非空 digest 不同则拒绝，禁止换绑。解析失败时发布不得进入 completed，已创建 App 仍由原
publication intent 冻结并只允许原地 reconciliation。

稳定入站只以本地 `(app_id, open_id)` 证明当前 App 的 Owner，不做 exact-message 回读，也不依赖逐消息远程
Contact 请求。`union_id` 和 tenant `user_id` 只用于补充映射、跨 App 归并和冲突检查。个人版事件即使只携带
`open_id + union_id` 也可直接通过已冻结映射；不得把首个发送者提升为 Owner。缺少冻结映射或出现冲突时，
当前消息按 identity unverified/连接异常 fail closed，不得误报 non-owner；这不是 Renderer 待处理状态。
Developer Session 的 `tenantId` 属于开放平台账号身份，消息 envelope 的 `tenant_key` 属于事件路由身份，两者不得直接
比较。首条消息必须先由 frozen App 下的 `(app_id, open_id)` 证明 Owner，再把该
`tenant_key` 冻结到 canonical ExternalPrincipal；后续 tenant key 漂移必须 fail closed。
顺序固定为 transport dedup、sender 解析、Owner 校验、会话类型、
群/话题显式 mention、multi-Bot observe。Non-owner 私聊最多收到每 App/身份 24 小时一次提示，群/话题静默忽略；两者
都不得创建 ExternalPrincipal、ChannelConversation、aggregate、PendingCampBinding、Camp 或 Run。

Core 从现有 directory-backed Camp 的 canonical project path 投影 Project Catalog，而不是让 Channel 维护第二套目录：

```ts
type ChannelProjectCatalogItem = {
  projectId: `rvproj_${string}`
  displayName: string
  status: 'active' | 'unavailable' | 'archived'
  lastOpenedAt: string | null
  version: number
  // canonicalPath 只在 Core 内部持久化
}
```

卡片只包含 active 项的 `projectId + displayName`。路径缺失时项目变为 unavailable，已经不在当前项目事实源的项变为
archived；旧卡 resolve 必须重新回读状态和目录可用性，不能静默选择其他路径。Camp 创建后冻结 existing
`project_binding_kind + project_path`，Project Catalog 后续变化不改写 Camp。

```ts
type ChannelConversationBinding = {
  bindingId: string
  channelConversationId: string
  executionScopeKind: 'quick_chat' | 'project'
  projectId: string | null
  campId: string | null
  status: 'active' | 'closed'
  generation: number
  version: number
}
```

会话 identity 保持：p2p 为 `tenant + receiving app + chat`；普通群为 `tenant + chat`；话题为
`tenant + chat + canonical topic`。私聊第一条 Owner 消息自动创建 `quick_chat` active generation 和 Camp，并立即走统一
admission；不展示项目卡。精确 `/new` 只在 Owner p2p 生效：要求没有 collecting aggregate、queued/admitted request，
关闭当前 generation，立即创建新 Quick Chat Camp，并回复“已开始新的快速对话”。该控制命令不创建 aggregate、
CampMessage、CampTurn 或 AgentRun；群/话题中的 `/new` 静默不生效。

普通群一个不可换绑的 project Camp；每个 topic identity 各有一个不可换绑 project Camp。首次合格 Owner mention 在
aggregate finalize 时创建或复用：

```ts
type PendingCampBinding = {
  pendingBindingId: string
  channelConversationId: string
  ownerPrincipalId: string
  acknowledgementAppId: string
  status: 'pending' | 'resolving' | 'resolved' | 'cancelled' | 'expired'
  version: number
  nonceDigest: string
  expiresAt: string
  projectId: string | null
  bindingId: string | null
  campId: string | null
}
```

原始 Structured Content、target Agents 与 ack App 进入 `PendingCampMessage` FIFO；此时没有 ChannelTurnRequest、Camp、
CampMessage、CampTurn 或 AgentRun。同一 conversation 的后续合格消息复用 pending row，不重复发卡。唯一
`project_selection` delivery 由完整 canonical mention 顺序中的第一个受管 Bot 发送到原 conversation：普通群直接使用
原 `chatId`，Topic 使用父群 `chatId + canonical topic reply anchor`。它的 `acknowledgementAppId` 对重试、恢复和后续
pending messages 保持冻结。卡片可对会话成员可见，但只包含 bounded conversation/project display name 与 opaque
project ID；不得包含 canonical path、operator identity 或本机权限事实。

Card action 只携带 `pendingBindingId + projectId? + expectedVersion + nonce + action`。Host 只从 callback envelope 读取
operator identity 和 clicked `messageId`，再把后者作为 `externalPickerMessageId` 交给 Core；action payload 中的身份字段一律
不可信。Core 对 frozen App、App-scoped Owner open ID、当前 sent `project_selection` delivery 的 exact external message
ID、nonce、version、expiry 与 project availability 重新校验；`union_id/user_id` 只做补充归并与冲突检查。Non-owner
点击不得改变 pending、version 或 nonce，只返回私有 toast；旧卡、双击、重放、错误 App 或非权威 message ID 都 fail closed。

bind 使用 `pending -> resolving -> resolved` CAS，在同一事务创建 immutable binding/Camp，并把全部 frozen messages 按
FIFO 转为 ChannelTurnRequest 后调用统一 admission；所有 roster/project 前置条件必须在 CAS 前通过。事务提交后 Core
追加 durable recall，卡片的安全失效不依赖 recall 成功。项目在点击时 unavailable/archived 或目录不可用则保持 pending，
轮换 version/nonce 并 durable update 原卡的 active options。刷新同样轮换 version/nonce。任何失败都不能创建第二个 Camp。

## 3. 飞书账号与队员 Bot

`feishu_account` 表达 Developer Identity，不表达 App：`accountId` 是
`digest(brand + tenantId + userId)`，并保存 `userIdDigest + tenantId + userName + email? + tenantName + brand +
status + version + connectedAt + lastVerifiedAt`。状态为 `connected | disconnected | session_expired`。缺少真实
`userId/userName/tenantId/tenantName` 时不能 upsert connected；同一 `accountId` 的 identity digest 不可变化。

连接只有以下状态：

```text
checking_secure_storage -> preparing -> awaiting_scan -> scan_confirmed
                                              -> inspecting_identity -> securing_session -> connected
                                                                   \-> expired | cancelled | failed
```

二维码 attempt 的 purpose 是 `account_login`，只登录开放平台并保存 Developer Session，不创建 App、Secret 或
WebSocket。只有最新 exact `attemptId` 可以更新 UI；取消/切换会 abort 旧窗口并废弃迟到回调。已连接状态下的账号切换
必须在新的非持久 Electron Session 中打开二维码，旧 Session 与加密 Cookie store 在新身份完整读取并安全保存前保持
不变。新 Cookie jar 安全写入后先成为可回滚 staged replacement；只有新 identity upsert 在 Core 成功，才确认替换并
清理旧内存 Session。取消、超时、页面失败、安全存储失败或 Core upsert 失败都会丢弃/回滚 staged replacement，当前
账号继续 connected；成功的 Core 事务把此前 connected account 变为 disconnected。显式
disconnect 才直接删除当前 Developer Session 并断开 current account；已有 Bot credential、映射和 WebSocket 不删除、
不迁移、不停用。
开放平台已经到达但连续 20 秒仍不能产生完整必需身份时，attempt 必须以
`feishu_developer_identity_incomplete` 失败；轮询不得重入，也不能一直保留在 identity inspection。

首次普通发布先持久化 `MemberBotPublicationIntent`：

```text
created -> session_verified -> app_created -> credentials_read
        -> bot_configured -> version_published -> connection_verified -> completed
        \-> failed_recoverable | failed_unknown_remote_state
```

每名队员的飞书 App 身份由这一个持久状态机冻结。第一次取得非空 `remoteAppId` 后，`agentId + accountId +
remoteAppId` 成为不可换绑身份，`credentialRef` 在首次写入后同样冻结；`completed` 不是再次创建 App 的许可。Core 从此拒绝为该队员创建会产生
第二个 App 的 intent，也拒绝 `memberBot.upsert` 改写上述绑定。首次写入 `feishu_member_bot` 只能发生在同一 intent 的
`version_published`，`connection_verified | completed` 又必须引用已经写入且状态为 `published` 的 exact Bot 绑定。
数据库主键和唯一索引只是约束的最后防线，不替代这些状态转换。

在尚未取得 `remoteAppId` 的 `failed_recoverable` 之后可以开始一次新的首次发布尝试；一旦任何 intent 已冻结
`remoteAppId`，后续发布、核对、重试和恢复都只能沿用该 App。当前可写生命周期只有
`unpublished -> published`；Rovai 不提供管理、停用、关闭、删除或换绑命令。历史数据库中的 `disabled` 仍可读取，且
只允许使用原 completed intent 进入 `session_verified -> app_created -> ... -> completed` 恢复为 `published`，其中
`app_created` 表示已核对原 App 身份，不表示新建。恢复要求当前 Developer Session 仍是原 `accountId`，通过普通
console reconciliation 读取同一 App Secret、配置、版本并验证连接。远端应用生命周期由 Owner 在官方开放平台管理。

Intent 冻结 `agentId + accountId + expectedUserIdDigest + expectedTenantId + requestedAppName + provisioningMode`，所有
推进带 exact version。唯一的 `developer_session` 模式必须执行以下顺序：

```text
requireExpectedIdentity
  -> read current Electron Session cookies
  -> load Open Platform page and obtain csrfToken + exact apiOrigin
  -> template-first console create app
  -> await Core durable App-ID freeze
  -> read secret -> enable Bot -> request eventMode=4
  -> create/reuse and publish activation version 1.0.0
  -> parallel read Scope + Event + Callback + Manifest
  -> submit ordered Scope/Event/Manifest/Callback mutations without intermediate polling
  -> parallel readback under one shared configuration deadline
  -> if configuration mutated, create/reuse and publish next patch version
  -> verify online configuration -> return credential
  -> persist credential -> upsert frozen Bot -> establish WebSocket
  -> return ProvisionedMemberBot
```

Cookie value、CSRF 与 App Secret 不得离开 Main，也不得进入错误、日志或 Renderer。console fetch 必须使用同一
Electron `Session.fetch` 与 `credentials=include`；不允许手工复制 Cookie header。`apiOrigin` 只接受当前 brand 对应的
`https://open.feishu.cn | https://open.larksuite.com`，请求路径只接受 `/developers/`。页面 identity 必须再次匹配
intent 冻结的 `userId + tenantId`。任何跨源、相似域、登录跳转、身份漂移、bootstrap/响应结构缺失都 fail closed。

正常 provisioner 必须先调用 `/developers/v1/manifest/upsert_by_template`，使用固定模板
`developer_console`、当前队员名称/说明/头像和当前 `publicationIntentId` correlation 创建应用。只有模板请求被服务器
明确拒绝且能证明没有创建应用时，才可在同一首次尝试中调用一次 `/developers/v1/app/create`。transport failure、
timeout、connection reset、HTTP 408/409/429/5xx、成功 envelope 缺少 `ClientID`、无法判断 commit，以及 Developer
Session 中途失效都属于创建结果不确定，必须 fail closed；不得 fallback 再创建。

模板或受限 fallback 返回非空 App ID 后，Provisioner 必须 await Main 提供的 `onRemoteAppCreated` barrier。该 barrier
使用 exact intent version 把 `remoteAppId` 推进到 `app_created`；在它成功前不得读取 Secret、启用 Bot、配置能力或创建
版本。进度回调只负责展示，不能替代 durable freeze。barrier 失败时停止全部后续 mutation；只有 Core 已持久化的 App
ID 才是可信恢复身份。

durable freeze 后，Provisioner 读取 Secret、启用 Bot、请求 `eventMode=4`，创建或复用 `1.0.0` activation version 并
确认 published。activation 只证明应用已经启用和首次发布，不声称业务权限、事件或 callback 已经收敛。随后才通过
开放平台在线 Scope、Event
和 Callback API 配置运行时能力。Manifest 可保存名称、头像与 Scope/Event/Callback 兼容投影，但不能作为 scopes、事件订阅或长连接模式
已经生效的 authority。普通模式的 `publishedVersionId` 不得为空。普通流程不得调用 `/oauth/v1/app/registration`、不得调用
`showRegistrationConfirmation`，也不得打开飞书“创建飞书智能体应用 / 立即创建”页面。

Scope 必须先通过 `/developers/v1/scope/all/:appId` 把当前 catalog 中的名称映射为 App identity scope ID，再用
`/developers/v1/scope/update/:appId` 提交；catalog 缺失或发布后在线状态不是 enabled 都 fail closed。消息入口至少要求
`im:message`、`im:message.p2p_msg:readonly`、`im:message.group_at_msg:readonly`、
`im:message:send_as_bot` 与 `application:application:self_manage`。最后一项只允许成员 App 在发布期读取自身
Application 信息，以 `user_id_type=open_id` 取得创建者 ID；该流程不得要求 Contact scope、不得读取通讯录，也只
持久化 `open_id` 摘要。当前目标租户 catalog 使用
`im:chat:readonly`，不得把未经 catalog 证明的
`im:chat:read` 写成固定名称；roster 读取还要求 `im:chat.members:read`。

Event 必须通过 `/developers/v1/event/:appId` 回读，以 `/developers/v1/event/switch/:appId` 把 `eventMode` 设置为 `4`，
再由 `/developers/v1/event/update/:appId` 写入 App events。最终在线状态必须包含
`im.message.receive_v1`、`im.chat.member.bot.added_v1`、`im.chat.member.bot.deleted_v1` 且 `eventMode=4`。
项目选择依赖 interactive card，所有队员 Bot 必须在线订阅 `card.action.trigger`，并经 callback switch 与回读证明
`callbackMode=4`。配置入口先并行读取 Scope、Event、Callback 与 Manifest，一次计算全部差异，再按
`scope/update -> event/switch -> event/update -> manifest/upsert -> callback/switch` 的稳定顺序提交所需 mutation；
mutation 之间不得等待控制面传播。每次配置最多一次 `manifest/get` 和一次 `manifest/upsert`，且不得覆盖无关 Manifest 字段。

全部 mutation 提交后，Scope、Event 与 Callback 共享一份 120 秒 deadline，默认每秒在同一轮并行回读三类在线状态。
单项只读瞬态失败只丢弃该轮该项结果；其他成功状态保留，下一轮继续并行读取，绝不重放 mutation。三个维度同时 ready
后才生成仅在本次 Provisioner 操作内有效的 `VerifiedConfigurationState`；它冻结 exact App ID、规范化 requirements digest
及最后一次在线状态。App、requirements 或后续配置 mutation 任一变化都会使它失效。该预算是平台最终一致性的安全网，
不得拆成多个串行 120 秒窗口、缩短成 10 秒或用重复创建替代等待。

同次 convergence 后的 final verify 可以复用 exact `VerifiedConfigurationState`，不立即重复读取 Scope、Event 与 Callback；
仍必须在线回读 Bot enable、published version 和需要核验的头像/Manifest。进程重启、恢复路径没有可信 state，或 App/
requirements 不匹配时，final verify 必须重新完整读取三类在线配置。任一 mutation 的 HTTP/envelope 成功都不能替代这些
在线证据。

Main 必须用单调时钟为 Session 打开、头像上传、模板创建、activation、Scope 提交、Event/Callback/整体 convergence、
Manifest reconcile、final publish/verify、Owner identity、WebSocket handshake 和 total 记录结构化耗时；成功与失败样本
都要保留。日志只允许 publication intent、Agent、creation/recovery/mutation 分类和 App ID digest，不得记录 App Secret、
Developer Cookie、CSRF、Owner OpenID 或完整 App ID。

任一配置发生变化时，从当前 published semantic version 递增 patch，创建或复用 exact 下一版本并发布；全部无变化时
复用当前 published version。crash 后发现同一 patch 已存在时继续读取或发布它，不创建重复版本。

版本 detail read-back 是发布状态 authority。commit/release 的单次 HTTP 或 envelope 失败不能独自证明发布失败；
release 每个 attempt 最多提交一次，随后除取消和 Developer Session 失效外必须在原 deadline 内继续回读同一 App 与
Version。任何回读的 published 立即收敛成功，rejected 立即失败；未在 deadline 内收敛才返回已保存的 release failure
或 publish timeout。不得因 release 返回 400 而覆盖随后已经回读证明的 published 状态，也不得重发 release。

旧的 `/oauth/v1/app/registration + verification_uri_complete + showRegistrationConfirmation + pollRegistration`
协议不属于当前产品：不存在对应 Provisioner、Developer Session 确认窗口、typed API、IPC 或 Renderer 入口。任何
console 失败都不得要求队员再次扫码、打开平台创建确认页或切换到 registration 创建路径；模板到 self-build 的受限
fallback 只能使用上文已证明 non-creation 的分类。

一旦 intent 持有 `remoteAppId`，包括失败、完成、历史 `disabled` 恢复和重新发布在内的后续状态都不得改成另一个 App。
远端状态分类只有 `none | known_frozen | create_outcome_unknown`：`create_outcome_unknown` 只表示 create mutation 结果无法
确认且没有可信冻结 App ID，是进入 `failed_unknown_remote_state` 的唯一原因。App ID 已 durable freeze 后，Secret、Bot、
Scope、Event、Callback、Version、credential 写入、Core upsert 或 WebSocket 任一步失败都写 `failed_recoverable`，即使
credential 尚未保存。Main 重启按持久 intent 收敛，不从 UI 临时进度推断；历史
`failed_unknown_remote_state + remoteAppId` 可先重分类为 `failed_recoverable`，但无 App ID 的真正 unknown 仍锁住再创建。

Owner 对含冻结 `remoteAppId` 的 `failed_recoverable` 或历史 `failed_unknown_remote_state` 再次执行普通发布时，必须进入同一 intent 的显式
reconciliation，不得创建新 intent、新 App 或更换 `remoteAppId`。它先复核 exact Developer Identity，
再读取冻结 App 的 Secret、版本列表/detail、在线 Bot/Scope/Event/Callback 状态与 manifest 头像元数据。最新 published 为 `1.0.0` 且当前队员头像可用时，允许且只允许
针对同一 App 执行头像修复：upload 当前受控 icon、重放幂等 manifest 配置、创建或复用 `1.0.1`、commit/release 并回读。
头像已经正确但在线消息权限、事件订阅或长连接模式不完整时，同一 reconciliation 可以配置原 App，并创建或复用 latest
published 的下一 patch 版本；不得以修复为名调用 create App。在线 readiness 已完整时不得重复
upload/configure/create-version/commit/release。published status、目标头像、完整在线 Bot/scopes/events/WebSocket 配置同时成立后，才写 credential 并允许 Core 以 exact version 从
`failed_recoverable | failed_unknown_remote_state -> credentials_read` 继续。核对失败保持 `failed_recoverable`；缺少冻结
App ID 的 true unknown 仍禁止重试。

普通发布在创建 intent 和任何 console mutation 前解析 `AgentProfile.avatarRef`。内置引用读取 exact 打包
`icon-192.png`；managed 引用必须经 Main 受管头像存储的 manifest、尺寸、长度与 SHA-256 校验后读取 icon rendition。
非空引用未知、缺失或损坏返回 `feishu_member_bot_avatar_ref_invalid | feishu_member_bot_avatar_unavailable`，不得回退成
其他身份。只有 `avatarRef=null` 使用打包内受控 Rovai App icon。上传后的 URL 必须写入 manifest `avatar_url` 并纳入
发布回读验证；Renderer 与 Core 都不接收本地路径。

最终 `verifyMemberBot()` 只核对在线 Bot、Scope、Event、Callback 与 published version；它与真正 WebSocket connect 是
两个阶段。验证通过后依次写入 safeStorage credential、Core upsert exact frozen Bot、建立 WebSocket 并回读 identity，
最后才把 intent 推进到 `connection_verified -> completed`。Main 启动时为所有 published Bot 读取 exact credential 并独立恢复长连接；单连接失败只改变该 Bot
的可见 failure，不停止其他 Bot。

Main 必须为每个 Bot 记录脱敏的 `ws.connecting/connected/reconnecting/reconnected/error`、SDK policy reject、
`message.normalized` 与 Rovai handler `message.accepted/rejected` 诊断。App、message、chat ID 只记录 SHA-256 digest，
原因使用固定代码；不得记录 App Secret、Cookie、CSRF、完整外部身份或消息正文。当前 Channel SDK 没有归一化前的 raw
event hook，因此不得把 `message.normalized` 冒充 `raw_event.received`。

## 4. ExternalPrincipal 与 Structured Content

只有已通过 Owner gate 的消息才建立 ExternalPrincipal。Owner 按 `union_id`、tenant `user_id`、App-scoped `open_id`
归并为同一个 canonical principal；最终 key 是 `provider + tenant + canonical external user identity`。Core 可以持久化
per-App identity 以找回私聊接收 open ID，但 Agent-facing 投影只含 provider 和 display name，Actor 仍不是 local user。

当前触发消息的 Structured Content 为：

```ts
type ExternalQuote = {
  kind: 'external_quote'
  senderDisplayName: string
  body: string
  attachmentSummaries: Array<{ name: string; mediaType: string | null }>
  contentDigest: `sha256:${string}`
}

type ChannelTriggerContent = Array<
  | ExternalQuote
  | { kind: 'member_mention'; agentId: string }
  | { kind: 'text'; text: string }
>
```

ExternalQuote 最多 8,000 Unicode scalar、20 个附件摘要；sender/name/media type 有独立边界校验，digest 必须
匹配 canonical quote content。它是 channel-owned segment，Composer 和普通 user-authored admission 必须拒绝
直接构造。引用读取失败投影确定性 `飞书消息 / [引用的飞书消息不可读取]`。被引用消息不
单独物化；飞书来源 CampMessage 的 `replyToCampMessageId = null`。没有 prompt-only override，也没有持久
`externalMessageId -> campMessageId` reply projection。

## 5. 多 Bot 入站聚合

```ts
type ObserveChannelInbound = {
  provider: 'feishu'
  appId: string
  externalMessageId: string
  tenantKey: string
  chatId: string
  topicKey: string
  conversationKind: 'p2p' | 'group' | 'topic'
  senderExternalUserId: string
  senderOpenId?: string | null
  senderUserId?: string | null
  senderUnionId?: string | null
  senderDisplayName: string
  body: string
  attachmentSummaries: Array<{ name: string; mediaType: string | null }>
  quote?: Omit<ExternalQuote, 'kind' | 'contentDigest'> | null
  canonicalAgentIds: string[]
  canonicalMentionsComplete: boolean
  expectedAppIds: string[]
  acknowledgementAppId: string
}
```

Host 在 observe 前先调用 Core Owner verify；只有 classification=owner 才继续。p2p 接受普通消息，精确 `/new` 在这里
分流为控制命令；group/topic 要求显式 mention 一个以上 published managed Bot。echo、non-owner、未 mention、群内
`/new` 和缺失 canonical topic 都在 observation 前停止。Core 在 observe/finalize 再验 Owner、target Agent 与 App 映射。

入站消息资源仍只把 SDK 提供的名称和类型冻结为 Structured Content 文本摘要，不下载或绑定为 Camp Attachment。
出站方向不同：Agent 已通过 [Camp Attachment v6](camp-attachment-v6.md)正式发布并由 Managed Attachment v2 authority
持有的图片/文件，可以按第 7 节作为原生飞书资源发送；不得把入站摘要、Runtime 临时路径或未经发布的 workspace 文件
提升为出站附件。

Aggregate identity 是 `provider + tenant + digest(externalMessageId)`，observation identity 是
`aggregate + receivingAppId`。第一条 observation 必须只建立 `collecting`，不能创建业务对象。所有 observation
的 canonical payload digest 必须相同；不一致立即 `failed/observation_mismatch`。

仅当 `canonicalMentionsComplete=true` 或 `expectedAppIds` 已全部出现在 observed Apps 时才允许独立 finalize。
否则 finalize 在 deadline 前返回 `channel.inbound.not_ready`，三秒后写
`failed/aggregation_timeout`。Host tick 对过期 collecting aggregate执行同一 fail-closed 终态。finalize 和失败
均幂等；终态 transport rows 七天后且无开放请求时可清理。

`acknowledgementAppId` 只能在 canonical mentions 已完整映射后按其顺序选择第一个受管 Bot；第一条 observation 不得
抢先定卡片发送者。expected Apps 的持久集合可以稳定排序，但不得改变该选择。即使所有 expected App observations
已经到齐，尚无 active binding 的 group/topic 若仍不能证明 canonical 顺序，也必须以
`acknowledgement_app_unresolved` fail closed，不能发项目卡。

## 6. Camp 创建、roster 与 admission

Finalize 必须重查 Owner、observation 时冻结的 exact binding 与 project/roster readiness。p2p 没有 binding 时自动建立
Quick Chat generation/Camp；普通群或话题没有 binding 时只追加 PendingCampBinding FIFO 并终结 aggregate，不创建
ChannelTurnRequest 或业务消息。项目卡 resolve 后创建 Camp：普通群初始成员是父群 roster 中全部 present/published
Bot；p2p 和话题初始成员只含当前 targets。默认 Lead 使用稳定 Agent ID order；Camp 同时建立 `feishu` membership
source binding。

父群 roster 输入必须是 Host 对所有 published Bot 完成的 authoritative `presentAppIds` 快照。每个快照推进
roster generation；未知 App 拒绝。普通群对 desired/current 差异调用 Camp Membership v1 正式 add/remove。
话题不因父群新增 Bot自动添加；显式 topic mention 或 A2A exact target 只有在父群 present/published 时按需 add。
Bot 缺失或 roster 未建立分别拒绝 `channel.bot_not_in_roster` / `channel.roster_sync_required`。

一个 finalized aggregate恰好创建一个 `ChannelTurnRequest`：

```ts
type ChannelTurnRequestStatus = 'queued' | 'admitted' | 'completed' | 'failed'
```

同一 Binding 的 `admitted` 部分唯一。queued 行没有 CampMessage/CampTurn/sequence，不能进入 Timeline、History、
Search、SHARED_CONVERSATION 或 CURRENT_INPUT。队首通过
`CollaborationService.admit_external_channel_message` 复用本地用户发送的统一原子 admission，一次提交：

- 一条 `authorType='external_principal'`、`replyTo=null` 的触发 CampMessage；
- 一个 root CampTurn；
- 全部 canonical target 的初始 AgentRun；
- request 的 admitted identity 与 queue acknowledgement 更新。

active root Turn 的 Run、A2A 与 Gather 全部正式终结，且本次请求的永久正文、附件和 attention delivery 全部进入终态后，
请求才可 completed/failed，下一队首才能提升。执行控制台和 queue acknowledgement 是临时 presentation，不阻塞该
内部 settlement。
只有 `agent_run.runtime_not_ready` 可以留在 queued 并重试；目标 Bot 未发布/不在 roster 或其他永久 admission
错误写 failed 与 attention delivery，不静默改派。

## 7. ChannelDelivery

```ts
type ChannelDeliveryKind =
  | 'project_selection'
  | 'queue_ack'
  | 'execution_console_upsert'
  | 'execution_console_recall'
  | 'agent_output'
  | 'agent_attachment'
  | 'attention'

type ChannelDeliveryStatus = 'pending' | 'attempting' | 'sent' | 'failed'
```

普通 delivery 关联 exact request；`project_selection` 只关联 exact pending binding。每项 delivery 有唯一
`dedupeKey`、priority、target App、可选 source Agent/CampMessage/ExecutionConsole、payload、attempt count、available
time 和外部 message ID。
claim 使用 30 秒 lease；过期 attempting 可以被新 worker 领取。retryable error 使用有界指数退避，最多五次；terminal
sent/failed 单调。成功 CampMessage 不因飞书发送失败回滚。

project selection 必须由 frozen acknowledgement App 投递到原群或原 Topic，不以 Owner open ID 作为正常目标。payload
只有 `placement=conversation`、conversation kind/display name、opaque project options、nonce/version 和闭集
`operation = send | update | recall`，没有 path 或 operator identity。`sent` 的 send/update 行所持 external message ID
与当前 pending version 共同定义 authoritative picker；recall 行只引用该 exact message ID，不重新推断目标。

refresh 或项目失效先在 Core 轮换 version/nonce，再 durable update 原卡；bind/cancel/expiry 先使 pending 单调离开可操作
状态，再 durable recall。Main 将“消息已不存在”视为 recall/update 的幂等终态；网络与限流继续按 Outbox lease/retry
处理。成功后不 patch 永久结果卡。旧 private picker 不再可领取；Host tick 发现仍 pending 的 legacy row 时先轮换
version/nonce，排入旧 external message ID 的 recall，再向原 conversation 发送 replacement picker。

`queue_ack` 只在请求确实留在 queued 时创建；admission 删除尚未发送的 ack，或在已发送/正在发送时追加 recall
delivery。它不更新成“已开始”，也不承担最终状态。`attention` 是独立永久卡片，不覆盖 queue ack 或 Agent 输出。

每个 AgentRun（包括 A2A/Gather 派生 Run）拥有一个 Core-owned `ChannelExecutionConsole`，冻结 request、conversation、
CampTurn、Agent、目标 App 与外部 message ID，使用单调 snapshot sequence 和以下状态：

```ts
type ChannelExecutionConsoleState =
  | 'opening' | 'active' | 'terminal'
  | 'recall_pending' | 'recalled' | 'recall_failed'
```

Core 从公开 Execution Evidence、AgentRun 状态和已提交公开输出生成可合并的 `execution_console_upsert`；Main 与 Renderer
复用同一纯 presentation 模块，隐藏 `agent.reasoning.summary.delta`、`agent.thought.delta`，保留公开 narration、plan、
tool/activity 与 public output。活跃工具展开；终态连续成功/已记录工具折叠，失败、等待和停止工具保持展开。Main 只由
该 Agent 的冻结 App 创建或更新 Card 2.0；同一 App 不能修改其他 Bot 的控制台。下一条 root request admission 把该
ChannelConversation 中更早 Turn 的控制台转为 `recall_pending`，等待其在途 upsert 结束后由原 App recall；不存在或已被
飞书撤回的消息按幂等成功收口。

`agent_output` 是实际作者 Bot 发送的永久、无标题 Markdown 消息，永远不复用/更新控制台、queue ack 或更早输出。
作者不可用时生成 attention，不由 ack Bot 冒充。group/topic 中结构化 `CurrentUserMention` 只有找到原始
ExternalPrincipal 在目标 App 下的有效 open ID 才通过 SDK structured mention 投影；p2p 不重复 mention，不手写
`<at>` 字符串。

公开 CampMessage 引用的每个 available Managed Attachment v2 文件各生成一个 `agent_attachment` delivery，payload
只携带 `(campId, attachmentId)` authority identity、source message/Agent、ordinal、显示名、媒体类型、字节数与内容
摘要。Main 在发送时通过 Core 再解析并验证 authority path，读取后复核字节数和 digest；图片使用飞书原生 image，其他
文件使用原生 file。正文 delivery 必须先进入终态，附件再按 ordinal 依次领取；每个附件有独立 dedupe/retry/终态，
单个上传失败只追加一次 attention，不重发正文或其他已成功附件。

ChannelTurnRequest settlement 只等待 terminal CampTurn 与 `agent_output | agent_attachment | attention` 永久 delivery
终态；任一永久 delivery failed 或 Turn 非 completed 时 request failed。临时控制台、recall 和 queue ack 的迟到、失败或
清理不改变已提交业务结果。

Main 发送到原 p2p/group/topic；topic 使用 canonical root/thread reply。回推事件由 SDK per-App dedup、出站 Bot
identity 和 Core transport aggregation阻止再次触发。

## 8. Snapshot 与恢复

Core Host snapshot schema 2 包含 Developer Identity account、带绑定账号 brand/内部 Owner verification 的 member bots、
publication intents、pending/bound diagnostic counts，以及仅供 Main 的 `transportConversations` 与
`pendingAggregates`。Main 对 Renderer 投影 schema 4，只保留账号显示字段、每 Bot 发布状态、当前
provisioning 进度、静默诊断计数，以及由绑定 brand 和冻结 App ID 生成的 `managementUrl`。不存在项目目录或会话绑定
操作投影，也不投影 per-App Owner identity 状态。该 URL 只能是 `https://open.feishu.cn/app/{encodedAppId}/baseinfo` 或
`https://open.larksuite.com/app/{encodedAppId}/baseinfo`；Renderer 不接收任意管理 URL。投影必须删除 Host-only 后两项、
原始 userId 与所有 credential refs。

进行中的 provisioning stage 依次为 `verifying_session | creating_app | activating_app |
configuring_permissions | waiting_configuration | publishing_version | verifying_configuration | connecting_bot`；终态仍为
`completed | failed | unknown_remote_state`。`waiting_configuration` 必须明确说明平台仍在同步在线配置，
`verifying_configuration` 只表示在线回读，`connecting_bot` 才表示正在建立真正的 Bot 长连接。已冻结 App 的失败动作显示
“继续核对”，true unknown 且无 App ID 时不提供重建入口；原始固定错误码只作为次级诊断信息展示。

启动恢复依次：恢复所有 published Bot 长连接；周期性重取已知父群 roster；finalize 已 ready 的 collecting
aggregate；Host tick 迁移旧 private picker、终结超时 pending picker/aggregate、投影/coalesce execution console、永久
正文与附件、结算 terminal request、提升 FIFO、建立旧控制台 recall 并按 priority 领取 Outbox。
所有步骤依赖持久 Core facts，不能从 Renderer 状态或飞书最近历史重建。

## 9. Data Contract

Migration 113 从 `Data Contract v1.25 / projection schema 66` 升到 `v1.26 / schema 67`，增加基础渠道表、
`external_principal` CampMessage author、ContextManifest 22 pairing 和 Formatter 22 new-write trigger。Migration 114
再升到 `Data Contract v1.27 / projection schema 68`，给 `feishu_account` 增加真实 Developer Identity/Session 时间字段，
并增加持久 publication intent。旧 controller account 记录全部退出 connected；没有 Bot 引用的错误记录删除，有已发布
Bot 引用的旧记录仅作历史外键保留，不能再投影为当前账号。Migration 115 收紧队员 App identity 唯一状态机；Migration
116 升到 `Data Contract v1.28 / projection schema 69`，以 Core Project Catalog、Feishu Owner identity/per-App mapping、
generation-aware conversation binding、PendingCampBinding/FIFO message 和 project-selection delivery 替换旧的
人工 ProjectBinding 正常路径。Migration 117/118 将 Developer Session、发布状态与 Owner-only Camp binding 合同推进到
`Data Contract v1.31 / projection schema 72`。Migration 119 升到 `Data Contract v1.32 / projection schema 73`，新增
`channel_execution_console`，给 ChannelDelivery 增加 console identity、priority 与 attachment ordinal，并把 kind
闭集替换为本节当前集合；旧 `agent_status/completion` transport 行不迁移，既有 project selection、queue ack、Agent
output 与 attention 保留。原会话 picker 复用现有 `project_selection` kind、external message ID 和 additive payload
operation，因此 Data Contract 仍为 v1.32/schema 73、无需新 Migration；Host tick 负责让旧 private picker 失权、撤回和
重发。迁移保留既有 Camp、消息、Manifest、Bot credential reference、Attachment authority 与 terminal evidence，不删除
或新建任何远端 App。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [Camp Membership v1](camp-membership-v1.md)
- [ContextManifest Evidence v22](context-manifest-evidence-v22.md)
- [v1.30 决策记录](../versions/v1.30/decisions.md#v1-30-d12)
