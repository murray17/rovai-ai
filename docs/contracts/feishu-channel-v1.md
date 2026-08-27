---
document_type: protocol-contract
contract: feishu-channel-v1
authority: feishu-channel-project-binding-admission-delivery
status: accepted
version: 1
last_updated: 2026-08-27
---

# Feishu Channel v1 Contract

本合同拥有飞书账号与队员 Bot、ProjectBinding、渠道会话、ExternalPrincipal、多 Bot 聚合、串行
ChannelTurnRequest、群 roster 和 ChannelDelivery 的字段与状态语义。Camp membership 仍由
[Camp Membership v1](camp-membership-v1.md)拥有，模型输入由
[ContextManifest Evidence v22](context-manifest-evidence-v22.md)拥有。

## 1. Actor 与秘密边界

| 能力 | 合格 Actor |
| --- | --- |
| ProjectBinding create/update/archive | `local_user` |
| 渠道会话 bind/switch | `local_user` |
| 连接/断开账号、发布/停用队员 Bot、选择兼容发布 | 本机主人经 typed Desktop API |
| inbound observe/finalize、roster、Host tick、delivery settle | `feishu-channel-host` System component |
| Camp membership source mutation | `channel-membership-sync` + exact `feishu` source binding/generation |

`ExternalPrincipal` 没有上述管理能力。不存在 authorized user、sender allowlist、项目申请或飞书侧项目选择。
绑定会话中的任意成员可发送私聊消息，或在群/话题显式 mention 已发布 Bot。

Developer Session Cookie jar 与 App Secret 只存于 Electron Main，并以 OS `safeStorage` 加密；页面 bootstrap 取得的
CSRF 只在一次 Main 发布流程内存活。Core 仅持久化
Developer Identity 的摘要/显示字段和每 Bot `credentialRef`；Renderer/API Snapshot 不得出现 `userId`、
`appSecret`、Cookie、CSRF、token、原始 credential payload、transport conversation 或 pending aggregate。系统加密
不可用或 15 秒内未完成时 Session/credential read/write 必须失败，不能降级为明文。登录必须在打开飞书页面前完成
安全存储预检；显式隔离验收实例使用由其 `userData` 目录摘要派生的独立应用名作为 safeStorage 命名空间，目录原文
不得进入命名空间或日志。

## 2. ProjectBinding 与渠道会话

```ts
type ProjectBinding = {
  projectBindingId: `rvpb_${string}`
  displayName: string
  bindingKind: 'quick_chat' | 'directory'
  canonicalPath: string
  status: 'active' | 'archived'
  version: number
}
```

创建前 Main 复用 workspace inspection，Core 再验证显示名、kind 和规范路径。`canonicalPath` 唯一。update 只改
显示名；archive 要求 exact version、active 且没有渠道会话引用。所有命令幂等并使用 User Actor。

```ts
type ChannelConversation = {
  channelConversationId: string
  provider: 'feishu'
  tenantKey: string
  chatId: string
  topicKey: string
  botScopeAppId: string
  conversationKind: 'p2p' | 'group' | 'topic'
  displayName: string
  lastSenderDisplayName: string
  lastSenderPrincipalId: string | null
  version: number
}
```

Identity 必须满足：

- `p2p`: `topicKey=''` 且 `botScopeAppId=receivingAppId`；
- `group`: `topicKey=''` 且 `botScopeAppId=''`；
- `topic`: `topicKey` 非空且 `botScopeAppId=''`。

一个会话至多一个 active `ChannelConversationBinding`。bind 输入为
`channelConversationId + projectBindingId + expectedConversationVersion`。相同 Binding 是成功 no-op；switch 要求
没有 `queued | admitted` 请求，并把 `campId` 清空。下一次合格消息才基于新 Binding 创建 Camp。

首次未绑定消息只允许创建或更新 `ChannelConversation` 和临时 transport aggregate。它不得创建
ExternalPrincipal、ChannelTurnRequest、Camp、CampMessage、CampTurn 或 AgentRun。observation 冻结
`bindingIdAtObservation`；空值或 finalize 时不再匹配 exact active Binding 时返回：

```json
{"code":"channel.inbound.unbound","payload":{"status":"unbound","requiresResend":true}}
```

之后完成 bind 不回放该消息。

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
WebSocket。只有最新 exact `attemptId` 可以更新 UI；取消/切换会 abort 旧窗口并废弃迟到回调。新 identity upsert
在同一 Core 事务把此前 connected account 变为 disconnected。显式 disconnect 只删除 Developer Session 并断开
当前 account；已有 Bot credential、映射和 WebSocket 不删除、不迁移、不停用。
开放平台已经到达但连续 20 秒仍不能产生完整必需身份时，attempt 必须以
`feishu_developer_identity_incomplete` 失败；轮询不得重入，也不能一直保留在 identity inspection。

每次普通发布先持久化 `MemberBotPublicationIntent`：

```text
created -> session_verified -> app_created -> credentials_read
        -> bot_configured -> version_published -> connection_verified -> completed
        \-> failed_recoverable | failed_unknown_remote_state
```

Intent 冻结 `agentId + accountId + expectedUserIdDigest + expectedTenantId + requestedAppName + provisioningMode`，所有
推进带 exact version。普通 `developer_session` 模式必须执行以下顺序，且不得进入 compatibility protocol：

```text
requireExpectedIdentity
  -> read current Electron Session cookies
  -> load Open Platform page and obtain csrfToken + exact apiOrigin
  -> console create app -> read secret -> enable Bot
  -> configure scopes -> configure events -> configure callbacks/WebSocket
  -> create version -> publish version -> read back/verify
  -> return ProvisionedMemberBot
```

Cookie value、CSRF 与 App Secret 不得离开 Main，也不得进入错误、日志或 Renderer。console fetch 必须使用同一
Electron `Session.fetch` 与 `credentials=include`；不允许手工复制 Cookie header。`apiOrigin` 只接受当前 brand 对应的
`https://open.feishu.cn | https://open.larksuite.com`，请求路径只接受 `/developers/`。页面 identity 必须再次匹配
intent 冻结的 `userId + tenantId`。任何跨源、相似域、登录跳转、身份漂移、bootstrap/响应结构缺失都 fail closed。

正常 provisioner 必须从 console API 创建应用并取得非空 App ID/Secret，启用 Bot，以分步 manifest upsert 配置本
合同的 tenant scopes、receive/roster events、event/callback `websocket` mode，创建并发布版本。返回前必须回读并
验证 Bot enable、所有必需 scopes/events、两类 WebSocket mode 和 published version status；普通模式的
`publishedVersionId` 不得为空。普通流程不得调用 `/oauth/v1/app/registration`、不得调用
`showRegistrationConfirmation`，也不得打开飞书“创建飞书智能体应用 / 立即创建”页面。

`FeishuCompatMemberBotProvisioner` 独占
`/oauth/v1/app/registration + verification_uri_complete + showRegistrationConfirmation + pollRegistration`。它只由
主人显式选择 `compat_registration` 时进入，可能要求每名队员单独扫码/确认，且结果不覆盖 Developer Identity。
官方确认 URL 只接受 `https://open.feishu.cn | open.larksuite.com` 上的 `/page/launcher | /page/cli` 与非空
`user_code`；不得放宽到相似域、任意飞书路径、HTTP、显式端口或 URL userinfo。正常失败不得静默切换兼容模式。

一旦 intent 持有 `remoteAppId`，后续状态不得改成另一个 App。App Secret 写入失败，或网络中断导致无法证明远端是否
创建成功时，写 `failed_unknown_remote_state + failureCode` 并锁住自动再创建；持久 credential 已存在时才允许
`failed_recoverable` 继续验证同一 App。Main 重启按这些事实收敛，不从 UI 临时进度推断。

普通发布由 Main 向 console image endpoint 上传打包内受控 Rovai App icon；本机成员头像仍只作 Rovai 身份展示，
Renderer 不宣称已把成员头像上传到飞书。兼容模式的 avatar preset 仍只能使用确认页可访问的 URL。

Bot 只有 WebSocket 首次握手与 identity 回读成功、credential 已写入 safeStorage 且 Core upsert 成功后才成为
`published`。Main 启动时为所有 published Bot 读取 exact credential 并独立恢复长连接；单连接失败只改变该 Bot
的可见 failure，不停止其他 Bot。

## 4. ExternalPrincipal 与 Structured Content

绑定消息按以下优先级归并同一真人的 App identity：`union_id`、tenant `user_id`、App-scoped `open_id`；最终
ExternalPrincipal key 是 `provider + tenant + canonical external user identity`。Core 可以持久化 App identity
映射以找到同一 principal 的接收 open ID，但 Agent-facing 投影只含 provider 和 display name。

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

Host 在 observe 前执行有效消息门：p2p 接受；group/topic 要求显式 mention 一个以上 published managed Bot；
echo、未 mention 和缺失 canonical topic 忽略。Core 重验所有 target Agent 与 App 映射。

当前消息的资源一期只把 SDK 提供的名称和类型冻结为 Structured Content 文本摘要，不下载或绑定
`message_attachment`。ChannelDelivery 一期只发送状态卡、文本和卡片，不发送 Camp 图片/文件；资源传输需要
后续独立合同补齐大小、病毒扫描、存储、publication 与 retry identity 后再接入。

Aggregate identity 是 `provider + tenant + digest(externalMessageId)`，observation identity 是
`aggregate + receivingAppId`。第一条 observation 必须只建立 `collecting`，不能创建业务对象。所有 observation
的 canonical payload digest 必须相同；不一致立即 `failed/observation_mismatch`。

仅当 `canonicalMentionsComplete=true` 或 `expectedAppIds` 已全部出现在 observed Apps 时才允许独立 finalize。
否则 finalize 在 deadline 前返回 `channel.inbound.not_ready`，三秒后写
`failed/aggregation_timeout`。Host tick 对过期 collecting aggregate执行同一 fail-closed 终态。finalize 和失败
均幂等；终态 transport rows 七天后且无开放请求时可清理。

`acknowledgementAppId` 按 canonical mention 顺序冻结，保证同一消息只有一个 Bot 发送状态卡。expected Apps 的
持久集合排序不改变该选择。

## 6. Camp 创建、roster 与 admission

Finalize 必须重查 observation 时的 exact active Binding/ProjectBinding。首次创建 Camp 时冻结
`bindingKind + canonicalPath`：普通群初始成员是父群 roster 中全部 present/published Bot；p2p 和话题初始成员只
是当前 targets。默认 Lead 使用稳定 Agent ID order；Camp 同时建立 `feishu` membership source binding。

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

active root Turn 的 Run、A2A、Gather 和 required Delivery 全部正式终结后，请求 completed，下一队首才能提升。
只有 `agent_run.runtime_not_ready` 可以留在 queued 并重试；目标 Bot 未发布/不在 roster 或其他永久 admission
错误写 failed 与 attention delivery，不静默改派。

## 7. ChannelDelivery

```ts
type ChannelDeliveryKind =
  | 'queue_ack'
  | 'agent_status'
  | 'agent_output'
  | 'completion'
  | 'attention'

type ChannelDeliveryStatus = 'pending' | 'attempting' | 'sent' | 'failed'
```

每项 delivery 有唯一 `dedupeKey`、target App、可选 source Agent/CampMessage、payload、attempt count、available
time 和外部 message ID。claim 使用 30 秒 lease；过期 attempting 可以被新 worker 领取。retryable error 使用有界
指数退避，最多五次；terminal sent/failed 单调。成功 CampMessage 不因飞书发送失败回滚。

queue ack 首次发送后保存 external message ID，admission 原位更新为“已开始”；失败/attention 同样优先更新既有
状态卡。Agent output 选择实际作者 Agent 的 published Bot；作者不可用时生成 attention，不由 ack Bot 冒充。
group/topic 中结构化 `CurrentUserMention` 只有找到原始 ExternalPrincipal 在目标 App 下的有效 open ID 才投影原生
`<at>`；p2p 不重复 mention。

Main 发送到原 p2p/group/topic；topic 使用 canonical root/thread reply。回推事件由 SDK per-App dedup、出站 Bot
identity 和 Core transport aggregation阻止再次触发。

## 8. Snapshot 与恢复

Core Host snapshot schema 1 包含 Developer Identity account、member bots、publication intents、ProjectBindings、
unbound/bound conversations，以及仅供 Main 的 `transportConversations` 与 `pendingAggregates`。Main 对 Renderer
投影 schema 3，只保留账号显示字段、每 Bot 状态和当前 provisioning 进度，必须删除后两项、原始 userId 与所有
credential refs。

启动恢复依次：恢复所有 published Bot 长连接；周期性重取已知父群 roster；finalize 已 ready 的 collecting
aggregate；Host tick 终结超时 aggregate、投影 request output、完成 terminal request、提升 FIFO 并领取 Outbox。
所有步骤依赖持久 Core facts，不能从 Renderer 状态或飞书最近历史重建。

## 9. Data Contract

Migration 113 从 `Data Contract v1.25 / projection schema 66` 升到 `v1.26 / schema 67`，增加基础渠道表、
`external_principal` CampMessage author、ContextManifest 22 pairing 和 Formatter 22 new-write trigger。Migration 114
再升到 `Data Contract v1.27 / projection schema 68`，给 `feishu_account` 增加真实 Developer Identity/Session 时间字段，
并增加持久 publication intent。旧 controller account 记录全部退出 connected；没有 Bot 引用的错误记录删除，有已发布
Bot 引用的旧记录仅作历史外键保留，不能再投影为当前账号。两次迁移均保留既有 Camp、消息、Manifest、Bot credential
reference 与 terminal evidence，不自动删除远端测试 App。

## References

- [飞书渠道架构](../architecture/feishu-channel.md)
- [Camp Membership v1](camp-membership-v1.md)
- [ContextManifest Evidence v22](context-manifest-evidence-v22.md)
- [v1.30 决策记录](../versions/v1.30/decisions.md)
