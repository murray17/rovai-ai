---
document_type: protocol-contract
contract: dingtalk-channel-v2
authority: dingtalk-channel-account-provisioning-admission-delivery
status: accepted
version: 2
last_updated: 2026-08-30
---

# DingTalk Channel v2 Contract

本合同拥有钉钉账号、直接 OAuth/Developer API、队员应用发布、Stream 入站、Owner identity、Provider-specific snapshot 和外部投递
语义。项目冻结、ExternalPrincipal、ExternalQuote、PendingCampBinding、ChannelTurnRequest、统一 admission、Camp
Membership、执行控制台和 ChannelDelivery 的共享字段继续沿用 provider-neutral 现有合同；本合同规定它们在
`provider=dingtalk` 下的约束。

## 1. Actor、Main 网络与秘密边界

| 能力 | 合格 Actor / 进程 |
| --- | --- |
| 连接/切换/断开 OAuth、发布队员、选择审批人 | 本机 Owner 经 typed Desktop API |
| account/publication/Bot fact、Owner verify、inbound、roster、卡片 resolve、Host tick、delivery settle | `dingtalk-channel-host` System component |
| Camp membership source mutation | `channel-membership-sync` + exact `dingtalk` binding/reconciliation generation |

`ExternalPrincipal` 无本机 Owner 权限。Renderer 不能接收 OAuth Token、refresh token、AppSecret、OAuth profile 原文、
profile selector、credential payload 或 Host-only routing facts。Core 只保存 identity digest、显示字段、远端非秘密 identity
和 `credentialRef`。Main 用 OS `safeStorage` 分别保存 OAuth profile 和每 App `{appKey, appSecret, robotCode}`；加密不可用时
fail closed。

Main OAuth 必须固定钉钉 authorization/token/device endpoint，浏览器 callback 必须绑定随机 state 和 loopback 地址；OAuth
Client Secret 只保留在 Main 进程内存及到 token endpoint 的 HTTPS credential body。Developer API 必须固定官方钉钉 HTTPS endpoint，Token 只进入
`Authorization` 与 `x-user-access-token` header；redirect 禁止，operation/argument 闭集、响应大小、timeout 与 AbortSignal
必须受限。未知 endpoint、operation、argument、空值、NUL、超长值或非 JSON 响应均拒绝。Renderer、Core、URL、业务 body、
日志和命令行参数均不得出现 Token 或 Secret。

安装包不得包含或启动 DWS；不得保留 DWS version/SHA pin、重签排除、物化目录、subprocess 生命周期或 stdout/stderr 协议。
macOS 包体检查必须拒绝 `dws`、`dws.gz` 与 `dws.exe`，Windows `extraResources` 同样只能包含 Rovai 自有 sidecar。

允许的 Gateway operation 闭集为：

```text
app.create / app.get / app.update / app.credentials.get
app.robot.get / app.robot.config / app.robot.enable
app.permission.list / app.permission.add
app.event.list / app.event.subscribe
app.version.create / app.version.checkApproval
app.version.publish / app.version.status
```

## 2. Account 与 staged OAuth

`DingTalkAccount` 当前字段：

```ts
{
  accountId: string
  userIdDigest: `sha256:${string}`
  corpId: string
  userName: string
  corpName: string
  oauthProfileRef: string
  status: 'connected' | 'disconnected' | 'oauth_expired'
  version: positive integer
  connectedAt: RFC3339
  lastVerifiedAt: RFC3339
}
```

只有一个 account 可为 `connected`。`accountId` 由 exact `corpId + userId` 稳定派生；Core 不保存原始 OAuth token。
authorization code exchange 后必须以当前 access token 从官方 identity endpoint 读取完整
`corpId/userId/userName/corpName`，才能投影 connected identity。access token 到期前在 Main 内使用 exact refresh token 轮换；
refresh token 到期、身份改变或加密存储不可用时 fail closed。

切换事务顺序：inspect old → OAuth new → inspect complete new → Core upsert → commit current。取消、timeout 或新登录失败
不改旧 Profile；Core upsert 失败且 identity 已改变时必须恢复 exact `oldCorpId + oldUserId` 的本地 current profile。切回不删除
新 Profile。断开只删除 exact `corpId + userId` 的本地 OAuth profile 并 CAS 更新 Core account；不删除 Bot credential 或
远端 App。

没有显式 `ROVAI_DINGTALK_OAUTH_CLIENT_ID` 与 `ROVAI_DINGTALK_OAUTH_CLIENT_SECRET` 时，登录固定失败
`dingtalk_oauth_client_unconfigured`。生产不得把该开发环境注入方式误称为完成的 Client 分发方案。

## 3. Publication Intent 与应用唯一性

```ts
type DingTalkPublicationState =
  | 'created' | 'account_verified' | 'app_created' | 'credentials_read'
  | 'avatar_configured' | 'robot_configured' | 'permissions_configured'
  | 'version_created' | 'awaiting_approver_selection' | 'awaiting_approval'
  | 'version_released' | 'stream_verified' | 'card_verified' | 'completed'
  | 'failed_recoverable' | 'failed_unknown_remote_state'
```

Intent 唯一绑定 `agentId`，并冻结 `accountId/expectedUserIdDigest/expectedCorpId/requestedAppName/provisioningMode`。
`provisioningMode` 只能是 `direct_open_platform`。远端 facts 为
`remoteUnifiedAppId/appKey/robotCode/credentialRef/versionId/approvalMode/approverUserIdDigest`。所有 advance 使用
`expectedVersion` CAS；状态只能前进或进入失败恢复规则，不能清空/替换已冻结 identity。

发布顺序固定为：

```text
require exact OAuth identity
→ create app when and only when unifiedAppId absent
→ durably advance app_created with unifiedAppId
→ read appKey/appSecret
→ upload controlled Agent avatar and update app
→ configure/enable STREAM robot with addScope
→ verify/add qyapi_robot_sendmsg, qyapi_chat_manage,
  Card.Instance.Write, Card.Streaming.Write and configured event codes
→ create or recover version
→ inspect approval mode
→ explicitly select approver when required
→ publish/read status until RELEASE or preserve AUDIT
→ start exact App Stream
→ create official AI card template instance
→ completed
```

取得 `unifiedAppId` 后必须先 await Core durable advance，再读取 Secret 或做远端 mutation。`agentId`、
`remoteUnifiedAppId`、`appKey`、`robotCode`、`credentialRef` 都全局唯一；同一 Agent 不允许第二个 intent、换绑或重新创建。
create throw/invalid response 且无 App ID 时是 `failed_unknown_remote_state`，自动重试必须锁住。已有 App ID 的 credential、
avatar、robot、permission、event、version、approval、Stream 或 card 失败为 recoverable，只能恢复同一 App。

`approvalMode` 为 `SELECT_APPROVER` 且未选人时停在 `awaiting_approver_selection` 并返回 bounded
`{userId, displayName}[]`；只有 Owner 的显式选择可继续。远端版本仍为 `AUDIT`/review 时停在 `awaiting_approval`，不得
标记 failed/completed。publish response 丢失后必须先 `version.status`；读到 `RELEASE` 即收敛成功，不重复 mutation。

`completed` 要求所有 remote identity、credentialRef、versionId 存在且无 failure。之后“重试”只恢复 Stream/卡片或核对
同一 App，不执行新的 create。

## 4. Member Bot、Owner 与 Snapshot

Published Bot 字段：

```ts
{
  agentId: string
  accountId: string
  unifiedAppId: string
  appKey: string
  robotCode: string
  botDisplayName: string
  credentialRef: string
  ownerUserIdDigest: `sha256:${string}`
  status: 'published' | 'disabled'
  failureCode: string | null
  version: positive integer
}
```

首次 upsert 同时冻结 `(appKey, accountId, corpId, ownerUserIdDigest)`。Owner classification 只比较 callback
`senderStaffId` 的 namespace digest 与该 App identity，并要求 callback corpId 等于冻结 corpId。用户名、群管理员、encrypted
senderId、首个发言者或 Renderer 状态都不是 Owner 证据。

Core `channels.dingtalk.snapshot` schema 固定为 1，返回 account、memberBots、publicationIntents、Provider-local
`pendingBindingCount/bindingIssueCount`，以及只给 Main 的 `transportConversations/pendingAggregates`。Renderer 聚合 snapshot
schema 4 把钉钉投影为 `ChannelProviderView{kind:'dingtalk'}`；它只包含 account 显示信息、Bot status、冻结
`unifiedAppId`、官方 management URL、failure code 和 Provider-local 诊断，不含 appKey/robotCode/credentialRef/Host facts。

## 5. Core 入站与 Camp 语义

规范化消息闭集：

```ts
{
  provider: 'dingtalk'
  appId: string       // exact appKey
  robotCode: string
  externalMessageId: string
  tenantKey: string   // exact sender corpId namespace
  chatId: string
  conversationKind: 'p2p' | 'group'
  senderUserId: string // senderStaffId
  senderDisplayName: string
  body: string
  attachmentSummaries: {name: string, mediaType: string | null}[]
  explicitlyAtBot: boolean
  atUsers: {staffId: string | null, dingtalkId: string | null}[]
  quote: ExternalQuote | null
}
```

`robotCode` 若存在必须匹配当前 binding 的 `robotCode` 或 `appKey`；缺 `msgId`、corpId、senderStaffId、chat identity 或 payload
shape 时拒绝。群消息只有 `isInAtList=true` 且 bounded canonical `atUsers` 恰好一个条目才继续；私聊视为 direct。非 Owner
群消息不留业务事实，非 Owner 私聊只发送 24 小时/App/user 限流提示。Owner 私聊 exact body `/new` 调用 DM generation
rotate，不创建 CampMessage/Turn/Run。

其他消息通过 provider-neutral `observe → finalize`。普通群首个 receiving App 先以
`canonicalMentionsComplete=false` 持久化 collecting aggregate；3 秒观察窗内只有同一 App 且首个 observation 成功时，才以同一
payload 重放为 complete 并进入独立 finalize command。DingTalk finalize 不得仅凭 `expectedApps ⊆ observedApps` 提前放行。
共享 aggregate/dedup key 必须包含 provider namespace；payload mismatch、timeout、不完整 target 或 unknown Bot fail closed。
未绑定群建立 PendingCampBinding 并在原群由一个确定性 Bot 发送项目卡；callback 只有 exact App、Owner userId、outTrackId、
version、nonce 和 active project 同时匹配才消费。项目冻结后不可换绑。

已绑定请求建立 ChannelTurnRequest；同一 binding 同时最多一个 admitted root，其他请求保持 FIFO queued 且不提前进入 History
或 Context。最终提升必须调用 `CollaborationService.admit_external_channel_message`，原子创建唯一触发 CampMessage、CampTurn
和首轮目标 AgentRun。DingTalk Host 不得直接写这三类对象。

reply 始终冻结为当前触发消息的 ExternalQuote，`replyToCampMessageId=null`。附件只保存 bounded name/mediaType summary，
不下载、不把外部 URL 或本机路径变为 Camp Attachment。

## 6. Roster 与协作成员

远端 `getBotListInGroup(openConversationId)` 返回的 appKey/robotCode 集与本机 published DingTalk Bot 取交集后，作为该群
roster 完整快照。Host 提交 `provider=dingtalk, tenantKey, chatId, presentAppIds`；Core 拒绝未知 App，使用 existing
`camp.member.add/remove`、exact source binding 与 reconciliation generation 同步 Camp。新增/移除只影响下一次新 Run；
已运行 Run、历史消息和冻结项目不变。roster API 失败不能用缓存或 observation 猜测完整集合。

当前不支持 topic，因此不存在 DingTalk Topic Camp 或父群 Topic membership 规则。

## 7. Stream、卡片与 Delivery

每个 App 只有一个 Stream Client。Robot/Card callback 收到后必须先调用
`socketCallBackResponse(messageId,{status:'SUCCESS'})`，再异步 parse/admit；业务异常只进入脱敏 failure handler。connect 失败
必须从 registry 删除并 disconnect，不影响其他 App。

卡片模板固定 `382e4302-551d-4880-bf29-a30acfab2e71.schema`，callbackType 为 `STREAM`，group/robot space 都
`supportForward=false`。私聊 openSpaceId 为 `dtv1.card//IM_ROBOT.<userId>`，deliver model 只带
`spaceType=IM_ROBOT`；群聊为 `dtv1.card//IM_GROUP.<openConversationId>`，deliver model 的 `robotCode` 使用 exact appKey。
项目 callback 与执行分页 callback 都必须经过 Core authorize，Renderer/卡片值不能直接更新绑定或 console state。

模板状态固定为 `PROCESSING=1`、`INPUTING=2`、`FINISHED=3`、`FAILED=5`：可操作项目卡使用 `2`，运行中控制台使用
`1`，所有终态/retire 使用 `3`，失败控制台使用 `5`；不得发送未定义的 `4`。终态流式帧必须设置
`isFinalize=true`，失败终态同时设置 `isError=true`。

Delivery 继续使用既有 kind：`project_selection | queue_ack | execution_console_upsert |
execution_console_recall | agent_output | agent_attachment | attention`。目标 identity 必须同时匹配 `provider=dingtalk`、
`targetAppId=appKey` 和 Bot `credentialRef`。正式 `agent_output` 以实际作者 Bot 发送 Markdown；卡片失败允许在远端确认卡片
失败后降级成 Markdown 状态，但不能把业务失败标记成功。`agent_attachment` 当前固定结算
`dingtalk_attachment_delivery_not_supported`。

执行卡只消费 Core `executionConsolePublicPage`：允许公开 narration、safe command、file change 和 public output；禁止
stdin/stdout/stderr、tool JSON、reasoning、patch body 和消息私密正文。运行态可 stream 原卡；终态 page callback 必须匹配
`agentRunId + snapshotSequence + appKey + outTrackId` 且 source 已 `terminal_sealed`。

## 8. Feature Gate 与错误

| 条件 | 必须结果 |
| --- | --- |
| 任一 `topic/thread` identity | `dingtalk_topic_not_supported`；不得按普通群继续 |
| 普通群 canonical mention | 仅 `isInAtList=true` 且 bounded canonical `atUsers` 恰好包含一个直接目标时进入收集；缺失、歧义或多个条目 fail closed |
| 同消息多个直接 Bot observation | 3 秒观察窗内出现多个 receiving App 时整条 fail closed；不得启动先到的部分 target |
| 缺 Rovai OAuth Client | `dingtalk_oauth_client_unconfigured` |
| OAuth 不可达/过期/拒绝 | `dingtalk_oauth_unavailable` / `dingtalk_oauth_expired` / `dingtalk_oauth_access_denied` |
| Developer API 不可达/超时/拒绝 | `dingtalk_open_platform_unavailable` / `dingtalk_open_platform_timeout` / `dingtalk_open_platform_operation_failed` |
| create outcome 无 App ID | `dingtalk_app_create_unknown_remote_state` 或 response invalid；锁住重建 |
| frozen App 后配置失败 | recoverable，同 App 重试 |
| 审批人未选 | `dingtalk_approver_selection_required` + bounded candidates |
| 版本仍审核 | `dingtalk_version_under_review`，保留 waiting |
| outbound attachment | `dingtalk_attachment_delivery_not_supported` |
| roster 不可读/未知 Bot | fail closed，不猜测或移除运行中 Run |

卡片 create API 成功只允许推进本地 `card_verified`；生产 GO 仍要求真实 deliver/callback/streaming/page matrix。多 Bot、topic
或 attachment gate 只能由新的当前 Contract 与外部证据解除，不能由宽松 parser 或 UI flag 绕过。

## 9. Data Contract

Migration 122 只接受完整 `Data Contract v1.34 / projection schema 75` 且 Migration 121 已存在的 store。它新增
`dingtalk_account`、`dingtalk_owner_identity`、`dingtalk_member_bot_publication_intent`、`dingtalk_member_bot` 和
`dingtalk_owner_app_identity`，并把 `channel_member_bot_directory` 与 `channel_owner_app_identity_directory` 重建为
Feishu/DingTalk UNION view。随后写入 `Data Contract v1.35 / projection schema 76` 与 Migration 122。Migration 123 只接受
该完整来源，把每条 publication intent 的 `provisioning_mode='dws_gateway'` 原子改写为 `direct_open_platform`，保持 intent
identity、状态、冻结远端 App、credential reference、审批、failure、version 与时间字段不变，并写入
`Data Contract v1.36 / projection schema 77` 与 Migration 123。

迁移不重写 Camp、CampMessage、CampTurn、AgentRun、Feishu account/Bot、conversation、binding、roster、request、console、
Outbox、Context 或 Attachment。旧 Feishu rows 通过 directory view 原样保留；DingTalk 是 additive provider namespace，
没有 remote App 创建、credential 导入或历史数据猜测。

## References

- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [Camp Membership v1](camp-membership-v1.md)
- [ContextManifest Evidence v22](context-manifest-evidence-v22.md)
- [v1.33 决策记录](../versions/v1.33/decisions.md)
