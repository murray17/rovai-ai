---
document_type: architecture
architecture: feishu-channel
authority: feishu-channel-component-and-authority-boundaries
status: accepted
last_updated: 2026-09-01
---

# 飞书渠道架构

字段、状态和恢复合同见 [Feishu Channel v10](../contracts/feishu-channel-v10.md)，credential 与 Developer Session 持久化见
[Channel Storage v3](../contracts/channel-storage-v3.md)，模型输入证据见
[ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)，取舍理由见
[v1.35 决策记录](../versions/v1.35/decisions.md)。

## 组件与权威

```text
Renderer 渠道设置
  └─ typed Preload API
       └─ Electron Main / Feishu Channel Host
          ├─ Developer Session Adapter：临时登录、身份回读、Cookie jar、控制台 bootstrap
          ├─ OpenPlatformApiClient：同源控制台创建、配置、发布与回读
          ├─ Member Bot Provisioner：身份复核与发布状态机
          ├─ SQLite Channel Store Client：Session/credential 批量读取与原子命令
          ├─ 每 App WebSocket
          ├─ 入站规范化、群 Bot roster 观测
          ├─ ExecutionViewService：全局 LAN HTTP/SSE、内存 Token hash 与只读投影
          └─ 领取并发送 Core ChannelDelivery
                         │
                         ▼
                    Rust Core
          ├─ Developer Identity / Session / Credential / Publication Intent
          ├─ Feishu Owner / per-App identity
          ├─ Project Catalog / conversation binding generation
          ├─ PendingCampBinding / frozen message FIFO
          ├─ ExternalPrincipal
          ├─ multi-Bot aggregate / ChannelTurnRequest
          ├─ Camp、membership 与统一 admission
          ├─ Execution Web scope 复核与 exact AgentRun cancel
          └─ durable ChannelDelivery outbox
```

Rust Core 是 Owner identity、项目目录投影、渠道会话/执行范围、Camp、消息、Turn、Run、成员关系、排队和 Outbox 的
唯一持久权威。
Electron Main 与 Rust Core 共同位于渠道秘密边界：Main 拥有需要网络的 Feishu Host 与运行期 Cookie/Secret，Core 在
`rovai.sqlite` 中拥有明文持久 credential/Session。Renderer 只获得设置投影与 Owner 操作，不获得 App
Secret、原始 `userId`、Session Cookie、Host 恢复游标或内部路由事实。

`ExternalPrincipal` 表达消息作者、上下文来源和回复目标。即使它代表已验证 Feishu Owner，也不是 `local_user`，不能
连接账号、发布 Bot、维护路径或执行任何 Owner 命令。项目卡 callback 只有 exact pending binding 的窄批准能力。非 Owner
没有消息入口；不会因私聊、群管理员身份或显式 `@` 获得 Camp、项目或本机权限。

## 开发者会话与队员发布

“连接飞书账号”只在一次性 Electron Session 中加载开放平台登录页，截取真实登录二维码，回读
`userId + userName + tenantId + tenantName + brand` 并收集受限飞书/Lark 域 Cookie。它不创建 App、不产生 App
ID/Secret，也不启动 Bot。身份与 Cookie 在登录期间只留在临时 Session；Main 随后调用
`channels.feishu.account.commitConnection`，由 Core 在一个 SQLite 事务中同时写入 connected account 与
`channel_developer_sessions`。缺少任一身份字段、identity mismatch、previous account version conflict 或 SQLite 失败都不能
进入 connected。

事务成功后临时 Session 才成为当前内存 Session 并清理旧 partition；失败只丢弃临时 Session，既有 SQLite row 和旧内存
Session 均保持不变。持久层没有 confirm/rollback 文件，也不访问系统凭据库。启动与 refresh 从 SQLite 恢复 Cookie，并用
Developer Session revision CAS 保存远端刷新；断开/过期在 Core 同一事务删除 Session row 与更新账号状态。隔离验收只依赖
不同 `userData`/SQLite，不改变 `app.setName(APP_NAME)`，也没有 Keychain namespace。

启动先恢复 published Bot 和消息 worker，再异步复核开发者账号；两者不共享等待或失败生命周期。Session 检查区分 valid、
明确 invalid 和 unavailable：网络、页面、身份字段不完整、Cookie 恢复和 SQLite/CAS 异常均保留原 Session；只有明确失效
才允许 Core expire。后台检查有 Host/账号代次与版本保护，不能用迟到结果覆盖或清理新登录态。

普通队员发布先创建持久 `MemberBotPublicationIntent`，再要求当前 Web Session 仍属于 intent 冻结的
`userId + tenantId`。`FeishuWebSessionMemberBotProvisioner` 从同一 Electron Session 的 Cookie jar 加载开放平台页，
只在 Main 中读取 `csrfToken + apiOrigin`；后续请求使用该 Session 的 Chromium 网络栈和 Cookie policy，不组装、记录或
返回 Cookie header。`apiOrigin` 必须精确匹配当前 brand 的 `https://open.feishu.cn | https://open.larksuite.com`，API
路径只允许 `/developers/`，相似域、跨源 URL 和页面身份漂移均在创建前拒绝。

`OpenPlatformApiClient` 先上传受控队员头像，再以固定 `developer_console` 模板和 publication intent correlation 调用
`manifest/upsert_by_template`。只有上游明确拒绝模板且能够证明没有创建应用，才调用一次 self-build create；transport、
timeout、408/409/429/5xx、缺少 ClientID、Session 失效或任何 commit 结果不明都 fail closed，不能 fallback 再创建。
模板或受限 fallback 返回 App ID 后，Provisioner 必须 await Main 把 exact ID 持久推进为 `app_created`；该 durable
barrier 完成前不能读取 Secret、启用 Bot、配置能力或创建版本。

App ID 冻结后，client 读取 App Secret、启用 Bot、请求 event WebSocket mode，并创建或复用 `1.0.0` activation
version，先确认它 published。之后统一配置 tenant scopes、receive/roster events 与 `card.action.trigger` callback：先并行
读取 Scope/Event/Callback/Manifest，一次计算差异，按确定顺序提交所有必要 mutation，Manifest 最多读写一次；mutation
之间不做传播等待。全部写入完成后，三类在线状态共享一个 120 秒 deadline，每轮并行回读，单项瞬态读取失败不会重放写入。
任一配置发生变化时，从当前 published version 递增 patch，创建或复用 exact 下一版本并发布；全部无变化时复用现有
版本。头像与兼容元数据可以继续写 manifest；Scope 使用在线 catalog 把名称映射为 App identity ID，再经 scope update
写入；在线 `callbackMode=4` 与 `card.action.trigger` 都是必需条件。最后一次共享 convergence 生成仅限同一 Provisioner
操作使用的可信配置状态；没有后续配置 mutation 时，final verify 复用它并只回读 robot、version 和需要核验的头像/
Manifest。重启恢复或 App/requirements 不匹配时仍完整回读 scope/event/callback。Manifest 字段不能自证配置完成。在线配置验证通过后，
Main 通过 `publicationIntent.storeCredential` 在同一 SQLite 事务写入独立 credential 并推进 intent，再由 Core upsert exact
frozen Bot、建立并回读 Bot WebSocket identity，最后
完成 intent。普通流程始终保持隐藏窗口，不打开飞书“创建飞书智能体应用 / 立即创建”确认页，也不向 Renderer 产生二维码。
Provisioner 与 Channel Host 共用单调时钟计时上下文，记录从 Session、创建、配置、发布、核验、Owner 解析到真实
WebSocket handshake 的阶段与总耗时；日志只含白名单分类和 App digest，失败也记录，秘密与原始外部身份不进入样本。

队员与飞书 App 的一对一身份不是 Renderer 按钮约定，而是 Core publication 状态机不变量。首次远端创建取得 App ID
后，intent 永久冻结 `agentId + accountId + remoteAppId`，并在首次写入后冻结 `credentialRef`；新 intent 不能越过已有冻结身份，Bot 写入只能
承接同一 intent 的 `version_published`，`connection_verified/completed` 又必须回指 exact published Bot。已有 Bot 的
Core 写路径只更新连接回读、显示字段和 lifecycle status，不更新 App、账号或 credential identity，也不存在换绑命令。

Rovai 不提供 Bot 管理、停用、关闭、删除或换绑命令。已发布行只提供官方开放平台应用详情入口；远端应用的停用、
删除和其他治理由 Owner 在飞书/Lark 开放平台完成。历史数据库中的 `disabled` 仅作为历史读取状态保留：Owner 连接原开发者
账号后，可以把同一 completed intent 重新推进到 `session_verified`，由 console reconciliation 核对原 App、重读
Secret、配置并验证后回到 `completed`；状态机中的 `app_created` 在这条路径表示原 App 已确认。新 intent 和第二次
create App 均不可用于恢复。发布状态为 `published` 时再次调用普通 publish 直接拒绝；凭据丢失的显式 retry 也只核对
同一 App。

头像来源与 `AgentProfile.avatarRef` 使用同一受控身份：内置引用由 Main 读取打包内对应 `icon-192.png`，managed 引用
通过既有 `MemberAvatarAssetService` 校验 manifest、大小、尺寸和 SHA-256 后读取 icon rendition。Main 不接收 Renderer
路径，也不把绝对路径传给飞书。`avatarRef=null` 才使用打包内 Rovai App icon 作为明确 fallback；非空引用未知、缺失或
损坏时在任何 console mutation 前失败，不能静默把一名已有头像的队员发布成 Rovai 公共图标。

版本发布以 detail read-back 为最终 authority，而不是 commit/release 的单次 HTTP 结果。release 一旦发出便不得在同一
attempt 重复提交；除取消和 Developer Session 失效外，即使该请求返回 HTTP/rejected/transport failure，也继续在原
deadline 内回读同一 App 与 Version。回读为 published 时收敛成功，为 rejected 时失败；直到 deadline 仍未收敛才保留
原 release failure。这样覆盖个人版租户中“release 返回 400、版本实际已发布”的幂等冲突或短暂竞态，同时不重复发布。

开放平台 console API 和页面 bootstrap 是版本敏感、未公开稳定合同的 Adapter 边界。它被限制在独立 client 中，使用
exact origin/path、严格响应结构、秘密不出 Main、创建后 read-back verification 和 fail-closed error mapping；页面或
协议变化不得降级为确认页或 SDK 注册。模板到 self-build 的唯一 fallback 只接受已分类的明确 non-creation rejection；
创建结果不明时绝不进入第二条 mutation。真实租户仍须回归“连接不增 App、普通发布不弹平台确认、
在线 Scope/Event 状态完整且能建立长连接并实际收到消息”。

旧的 `/oauth/v1/app/registration + verification_uri_complete + showRegistrationConfirmation + pollRegistration`
兼容协议已经从 Provisioner、Developer Session、typed API、IPC 与 Renderer 全部移除。console 发布失败只返回可诊断
错误，不得打开注册确认页或要求队员再次扫码。只有 create mutation 结果不确定且没有可信冻结 App ID 时，intent 进入
`failed_unknown_remote_state`，自动重建被锁住。App ID 已 durable freeze 后，Secret、配置、版本、credential、upsert
或 WebSocket 失败都进入 `failed_recoverable`，即使 credential 尚未写入；Main 启动时只从持久 intent 判断可恢复/待人工
核对，不从 Renderer 状态推断。

当 `failed_recoverable` 或历史 unknown intent 已冻结 `remoteAppId` 时，Owner 再次点击普通“发布”是显式
reconciliation，而不是新的 create attempt。
Host 复核同一 Developer Identity，先对冻结 App 读取 Secret、版本列表/detail、在线 Bot/Scope/Event/Callback 状态与
manifest 头像元数据；不得创建 App 或改变 App ID。
若最新 published 仍为初始 `1.0.0` 且队员有可用受控头像，reconciliation 会把同一头像上传到同一 App、
重放幂等 manifest 配置，并创建或复用 `1.0.1` 头像修复版本后发布与回读。若 `1.0.1` 已 published，则只回读验证，
不重复上传或发布。头像已正确但在线消息权限、事件或模式不完整时，reconciliation 在同一 App 配置后使用下一 patch
版本发布；readiness 已完整时保持只读。完成证明后才保存 credential、Core upsert 并验证 WebSocket，让同一 intent 从
`failed_recoverable | failed_unknown_remote_state` 进入 `credentials_read` 后继续完成；Core 拒绝更换 App ID。头像读取、
远端核对或连接失败时保持 `failed_recoverable`；只有缺少可信 App ID 的 create outcome unknown 继续锁住，不允许创建第二个 App。

## Owner-only 入站与会话执行范围

连接开发者账号时 Core 建立 canonical Feishu Owner。每个 Bot 发布或同 App reconciliation 完成在线配置后，
Provisioner 在再次证明同一 Developer Identity 后，用该 App credential 调用 Application v6 get，并以
`user_id_type=open_id` 读取不可变 `creator_id`。由于 App 创建与 durable freeze 都发生在已证明的 Developer Session
中，该 `creator_id` 就是当前 App 作用域的 `ownerOpenId`；可信 Main Host 在 Bot upsert 的同一 Core 事务冻结
`(account_id, app_id, owner_open_id digest)`。
Owner 解析失败时发布不完成；已创建 App 保持冻结，只能原地 reconciliation，不得创建第二个 App。

稳定入站只以本地 `(app_id, open_id)` 证明 Owner，不依赖每条消息的远程身份请求。事件携带的 `user_id` 与
`union_id` 只用于补充 identity、跨 App 归并和冲突检查，不得把首个发送者提升为 Owner，也不存在 Owner
手工核验步骤或 Renderer 状态。Core 无冻结映射或发现冲突时按连接异常 fail closed。
开放平台 Developer Identity 的 `tenantId` 与消息 envelope 的 `tenant_key` 是不同命名空间，不能互相做相等校验。首条
消息由 frozen App 下的 `(app_id, open_id)` 建立信任后，Core 把事件 `tenant_key` 冻结在 canonical
ExternalPrincipal；后续 App/identity/tenant key 任一冲突都 fail closed。
后续事件即使携带 `union_id` 或 tenant `user_id`，也只能用于补充归并和冲突检查，不能替代已冻结的
`(app_id, open_id)`。Owner 仍以 ExternalPrincipal 写入；non-owner 私聊只允许一次节流提示，群/话题静默停止，
并且都不能留下 conversation、aggregate、Principal、pending binding、Camp 或 Run。

Core 不再拥有 Owner 手工维护的 Channel ProjectBinding 目录。它从 Rovai 已存在的 directory Camp 事实投影 stable
Project Catalog：卡片只得到 opaque project ID 和 display name，canonical path 始终留在 Core。目录失效或项目退出
当前事实源会标记 unavailable/archived；旧卡点击必须 fail closed。Camp 一旦创建即冻结当时的
`project_binding_kind + project_path`，项目目录变化不能自动改派。

渠道会话 identity 按场景冻结：

- 私聊：`provider + tenant + chat + receiving app`；首次 Owner 消息自动创建 Quick Chat binding generation/Camp；
- 普通群：`provider + tenant + chat`；首次 Owner 显式 mention 选择项目或开始 Quick Chat，此后一个长期 Camp；
- 话题：`provider + tenant + chat + canonical topic`；每个话题独立选择项目或 Quick Chat，并拥有独立 Camp。

这里的“话题”只指父群本身 `chat_mode=topic` 的独立话题群中的 canonical topic。普通群
`chat_mode=group` 内从单条消息开启的 thread 不受支持：事件携带非空 `thread_id` 时，Host 在 observation 前静默停止，
不得把它降级为普通群消息、创建 Topic identity 或向该 thread 投递。独立话题群的 canonical topic 同时使用可回复的根
消息锚点：根消息取自身 `message_id`，话题内回复取 `root_id`；`thread_id` 不得作为飞书 Reply API 的 `message_id`。

精确 `/new` 只在 Owner 私聊中是控制命令。它要求当前没有 collecting aggregate 或 queued/admitted request，关闭 active
generation，保留旧 Camp，并立即创建新 Quick Chat Camp；控制文本不进入 CampMessage、Turn、Run 或模型。群和话题
不解释 `/new`，也没有 rebind/change-project 命令。

普通群/话题首次 finalize 时创建 `PendingCampBinding`，把原始 Structured Content、targets 和 canonical-first
acknowledgement App 冻结到 FIFO；此时没有 CampMessage/Turn/Run。同一会话后续 Owner mention 复用同一 pending row，
不重复发卡。frozen Bot 把唯一项目卡发回原群或原 Topic；卡片只公开可控的项目显示名，不公开 canonical path。
callback 只信 envelope 的 operator identity 与 clicked message ID，并以 App-scoped Owner open ID、authoritative picker
message ID、nonce、version、expiry、frozen App 和 CAS 防 non-owner、双击与重放。所有 roster/project 前置检查通过后，
同一事务创建 immutable binding/Camp、消费 pending，再把 frozen messages 按 FIFO 提升到统一 admission；随后才通过
durable delivery 异步撤回卡片。项目失效时 Core 保留 pending、轮换 nonce/version 并更新原卡。

Owner 也可在同一张卡选择“开始快速对话”，即使本机没有可用项目。它不是取消或跳过绑定：Core 使用自己受管的
Quick Chat 目录，在同一 resolved 事务建立无 Project Catalog ID 的 binding/Camp，仍完成全部 Owner、卡片和 roster
检查，并提升相同的 frozen FIFO。群/话题继续复用该 Camp，后续不能通过项目选择换绑；私聊及钉钉入口不变。
Migration 132 只放宽 resolved pending 的项目可空约束，保留全部历史字段、行与 FK 引用，其他状态约束不变。

## 入站、聚合与串行准入

Host 只转交已验证 Owner 的私聊，或 Owner 在普通群/话题中显式 `@` 一个以上已发布受管 Bot 的消息。echo、non-owner、
未 mention 群消息、未知 Bot、群内 `/new` 和不完整 topic identity 在 observation 前停止。多个 App 可能收到同一飞书消息，因此 Core 先写
`collecting` aggregate：

```text
observation 1 ─┐
observation 2 ─┼─ canonical payload equality
observation N ─┘
                     │
        canonical mentions complete
             OR all expected Apps observed
                     │
                     ▼
                  finalize
```

第一条 observation 永远不触发 admission、PendingCampBinding 或卡片；finalize 是独立命令。只有完整 canonical mention
映射才能按顺序冻结第一个受管 Bot 为 `acknowledgementAppId`。不同 App 对同一 canonical message 的冻结
payload 不一致时失败，缺少完整映射或预期 observation 时在三秒窗口后 fail closed。聚合只服务 transport
dedup/aggregation，并在终态七天后清理；external message ID 不成为 Camp History 或 reply identity。

Finalize 先重查 Owner、exact binding、项目、已发布 Bot 和群 roster。p2p 自动建立/复用 Quick Chat 后创建
`ChannelTurnRequest`；未绑定 group/topic 只写 PendingCampBinding FIFO。绑定完成后，每个 Binding 同时最多一个 admitted
请求，其余 queued 且不进入 Camp conversation、Context 或 AgentRun。提升复用与本地用户发送相同的
`CollaborationService` 原子 admission，一次性创建唯一触发 CampMessage、一个根 CampTurn 与全部初始 AgentRun。只有
Runtime 暂未 ready 属于可重试排队 blocker；永久目标或授权错误终结请求并产生 attention delivery。任何 Channel 命令
新建 Camp 时，Main 必须在释放数据库锁并让 Scheduler 看见 AgentRun 前先 materialize 空的 Published Attachment View，
避免首次执行与 Camp 文件视图创建竞态。

## 外部引用与模型输入

飞书 `parent_id` 只触发一次当前读取。Host 读取并规范化被引用消息，把 `ExternalQuote` 作为当前唯一触发
CampMessage 的 Structured Content segment 冻结；读取失败使用确定性不可读取文本。被引用消息不单独进入 Camp，
飞书来源 CampMessage 的 `replyToCampMessageId` 始终为空，也不维护
`externalMessageId -> CampMessageId` 投影。

Core Context projector 把 ExternalQuote 通过标准 agent-facing body projection 放入 `CURRENT_INPUT.message`，并把
来源投影为 `{type: external_principal, provider, displayName}`。Host 没有 prompt override，Agent 不接触 open ID、
union ID、tenant key、chat ID 或 external message ID。

## Bot roster 与 Camp membership

Host 对父群中每个已发布 Bot 调用 `isInChat`，只有完整快照才提交 Core roster generation。普通群 Camp 首次创建
使用当前全部 present Bot；以后完整快照通过 v1.29 已有 `camp.member.add/remove`、`feishu` source binding 和 exact
reconciliation generation 同步。Bot 移出群走同一原子 cutover/reconciliation。

独立话题群的父群 roster 是其全部 Topic Camp 的动态默认协作队员池。新 Topic Camp 首次创建时使用当前全部
present/published Rovai Bot 建立 membership，但首条消息仍只为明确 mention 的 targets 创建初始 AgentRun；因此“本轮
初始目标”和“Camp 可协作队员”是两个独立集合。父群新增 Bot 后，完整快照通过同一 membership source 把它加入新旧
Topic Camp；移出 Bot 后，从下一次 AgentRun 起不得再以它为目标，历史消息、历史 Run、Camp 和冻结项目不变。

Host 在新 Topic 建 Camp、每条 Owner 根消息和项目卡 resolve 前强制重读完整 `isInChat` 快照，并消费 Bot 加入/移出
事件与周期性全量恢复。A2A、Gather、delivery retry/successor 等内部路径在真正物化 Topic AgentRun 前，由 Core 建立
所需的下一 roster generation 门闩；Host tick 取得请求、重读父群并提交 generation，Core 完成 membership
reconciliation 后才恢复物化。若目标已经移出则 fail closed。已经运行的 AgentRun 继续使用创建时冻结的执行上下文；
为避免 membership remove 取消它，实际离群队员的 membership cutover 可延迟到其非终态 Run 结束，但最新 roster 已立即
阻止任何新 Run。群 roster 读取不完整时所有这些边界都 fail closed。

## 输出、恢复与秘密

共享 Host tick 按 [Channel Host Maintenance v2](../contracts/channel-host-maintenance-v2.md) 使用直接参数与响应，
不生成 commandId 或永久 poll 回执；超时、投影、FIFO 提升和 delivery 领取仍原子提交。响应丢失依靠持久 lease 恢复，
真实入站、绑定、admission 事件与 delivery settlement 的防重不变；历史 tick 回执不清理。

`project_selection` 是唯一不依赖 ChannelTurnRequest 的 delivery：它关联 exact PendingCampBinding，使用冻结的
acknowledgement App 直接发送到原群或原 Topic。payload 只有会话显示名、opaque 项目选项、nonce/version 与
`send | update | recall` operation，以及只用于 presentation 兼容恢复的 `cardRevision`；重启、重试和后续 pending 消息都复用同一 pending authority 与 Bot。当前 pending
version 对应 sent send/update 行的 external message ID 是唯一权威卡；Core 提交后即失权，recall 失败不会重新开放。Host
tick 会把旧 private picker 先失权并排入 recall，再在原 conversation 生成 replacement picker；当前 version 的旧
`cardRevision` 若已有 external message ID，则轮换 version/nonce 并原位更新到当前 revision；若未落地的 `send` 以
`format_error` 且无 external message ID 终结，则只轮换并重发一次。当前 revision 的同类失败不自动重发，避免持久错误形成循环。

Core 只从已提交公开 CampMessage、Managed Attachment authority、AgentRun 公共 Evidence 和请求状态生成
`ChannelDelivery`。Outbox 使用 priority、lease、attempt、退避和稳定 dedupe key；Main 发送成功后回写外部消息 ID，
网络错误不会回滚 CampMessage。queue ack 只在真正排队时出现，admission 后删除或 recall，不再更新成“已开始”。
Agent 永久输出使用实际作者 Agent 的已发布 Bot；作者 Bot 不可用时不冒充其他队员，而是生成独立 attention。
飞书没有本地 AgentRun retry/decline 操作面，因此 required Run 失败且只剩人工重试决定时，Channel Host 确定性 decline
该重试并让 Turn/Request 收口，再继续同一 Binding 的 FIFO。

每个 AgentRun 有一个 Core-owned execution console identity，但飞书 Card 2.0 只承担状态入口。收起态不再把正文、command、
结果或进度复制进卡片；只保留 Owner callback“显示最近输出”、直接 `open_url`“打开执行台”和 Owner callback
“停止执行”。终态移除停止入口。最近输出只在 Main 的 per-message 内存状态中展开最后 30 个公开正文/安全 command，
不含结果与分页；Main 重启恢复收起。所有 upsert、callback 与 recall 共用 per-card 串行队列。

“打开执行台”不进入 Host callback，也不识别飞书操作者。Main 仅在卡片第一次发送且 `ExecutionViewService` ready 时，
把当时的私有 LAN IPv4、全局用户端口与新随机 Token 拼成固定 URL；卡片后续更新只复用该字符串。IP/端口变化不扫描、
补发或改写旧卡，服务恢复也不补按钮。能够取得链接、访问该局域网且 Token 仍有效的人均可查看，因此该入口不是
Owner-only 权限面。

`ExecutionViewService` 是 Desktop Main 唯一的全局 HTTP/SSE listener，默认关闭、默认端口 8765。它自动选择 RFC1918
IPv4，只接受设置页显式选择的 1024–65535 端口，不自动漂移。Token 明文只出现在 URL fragment 与页面内存；Main 只保存
hash 和冻结的 `ChannelConversation/App/Camp/Agent/focusRun/maxRunCreatedAt` scope。服务关闭、卡片 recall 或 Main 重启会
撤销内存 grant；不建立持久 Capability/撤销领域。

浏览器先取当前 snapshot，再以 Fetch Streaming 建立 SSE。Main 每次都把冻结 scope 交给 Core，Core 复核 focus Run、
渠道/App、Camp、队员、成员关系和历史上界，并只返回同 Camp/队员且不晚于 focus Run 的公开投影。Main 继续复用 shared
execution grouping、redactor 与 result projector，把公开正文和连续操作组投影为页面所需的最小 shape；reasoning、完整工具输入、
原始 patch、任意文件、终端/写入/审批能力、Cookie、Token 和敏感环境变量不跨出进程边界。网页使用当前双主题与连续时间线，
外部触发者固定显示“你”；AgentRun、连续操作组和每个 Command 使用独立嵌套 disclosure，文件变化逐文件展开，不提供分页。

“显示最近输出”和“停止执行”仍通过 callback envelope 的 operator、冻结 App 与 authoritative external message 做
Owner 校验。停止命令还校验 exact AgentRun 仍可取消，Core 只结算这一条 Run；Main 不直接操作 Runtime 或扩大到整轮。
SDK event ID 继续承担 callback 防重。可响应故障返回安全 Toast；Host 或设备离线时
不承诺自定义飞书提示。

Core 既有 `terminal_pending / terminal_sealed` 与不可变 terminal snapshot 继续供安全读取和历史兼容，但 v10 飞书卡不再
呈现旧双层折叠或终态分页。钉钉仍消费原纯文本执行投影。下一条 root request admission 召回同 ChannelConversation 更早
Turn 的执行卡，等待在途更新并把 target revoked 当作幂等成功；执行卡不是 CampMessage，也不参与请求业务 settlement。

公开 Agent 正文新建无标题 Card 2.0，不覆盖控制台、queue ack 或其他正文。正文下方的“发送给”行只消费 Core 从公共
MessageDelivery 提取的有序 A2A 接收对象及 Structured CurrentUserMention；多个原生 @ 用空格分隔。飞书专用正文从
Structured Content 排除 CurrentUserMention，不改写源消息、Renderer/Agent Context，不按字面 `@你` 删除文字。
卡片顶部的回复摘要只沿 CampMessage 的 `reply_to_camp_message_id` 读取同 Camp 的直接父消息，最多 3 行/240 个 Unicode
字符，不读取 Human body cache 或嵌套 ExternalQuote，也不从 Topic root 推断关系；引用作者与摘要静态转义，不再触发 @。
无关系不显示，父消息不可用只显示占位。Owner 名称只在 canonical Principal 与作者 Bot 账号匹配时使用该账号名称。
原生 Bot ID 来自与作者同账号的已发布绑定，Owner ID 来自原 Principal 在发送 App 下的映射；缺失时显示静态名称，
不猜身份。正文中的原始 `<at>` 标签不获得通知能力。提及只展示/通知，不参与 A2A dispatch 或创建新 Run。
长正文按 24KB 卡片预算完整拆分，每片仍回复同一 Topic root，仅第一张显示回复摘要，只有最后一张展示接收对象；Main 使用同 Bot SDK client
发送 interactive，并以 delivery/分片稳定 UUID 覆盖飞书一小时内的重试去重。旧未发送 delivery 在 claim 内升级投影，
已发送卡不回填；钉钉保持原输出格式。详细恢复及字段见 [Feishu Channel v6](../contracts/feishu-channel-v6.md#4-永久公开正文与接收对象)。
公开 CampMessage 的 available
Managed Attachment v2 引用逐个生成原生 image/file delivery：Main 发送前经 Core 重新解析 authority，并在读取后复核
字节数与 digest；正文先终态，附件按 ordinal 依次发送且独立重试。单个附件最终失败只追加 attention，不重放正文或
已成功附件。请求 settlement 只等待 terminal Turn 与永久正文、附件、attention；queue ack、控制台及 recall 不阻塞 FIFO。

Core Snapshot 保存 pending aggregate、transport conversation 和 delivery 恢复事实，Main 启动后恢复所有 published
Bot 长连接、过期 lease、collecting finalize 与 Outbox。Renderer snapshot 在 Main 中剥离这些 Host-only 字段。
Main 的 `ChannelHostLifecycle` 等待 Supervisor 的 Core authority 与请求能力同时就绪后启动 Host；同 generation
不重复启动，authority 丢失后停止，新的 ready generation 再恢复同一 SQLite 绑定和凭据，shutdown 后不再重启。
Host 为连接阶段、SDK policy reject、归一化 message 和 Rovai handler 接受/拒绝记录结构化诊断；所有 App/message/chat
identity 都先摘要，消息正文与外部用户 ID 不进入日志。当前 SDK 不提供归一化前 raw-event hook，Host 不虚构该观测层。
每个 App Secret 只以稳定 credential ref 关联 Bot。Developer Session Cookie jar 和 App Secret 明文存于同一个
`rovai.sqlite`，只允许 Core/Main 读取；Renderer、日志、Agent Context 和诊断输出仍不得获得 raw payload。Main 启动时通过
一次 `channels.credentials.listPublished` 批量加载所有 Provider 的 published Bot credential，并把运行期对象分发给各 Host；
普通收发与重连不逐 Bot 查询。旧 `.bin` 不读取、不解密，只允许 Main 按严格已知文件名 best-effort 删除。断开账号只删除
Developer Session；已发布 Bot credential 与 WebSocket 生命周期保持独立。
