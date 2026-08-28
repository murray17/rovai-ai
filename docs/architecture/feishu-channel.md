---
document_type: architecture
architecture: feishu-channel
authority: feishu-channel-component-and-authority-boundaries
status: accepted
last_updated: 2026-08-28
---

# 飞书渠道架构

字段、状态和恢复合同见 [Feishu Channel v2](../contracts/feishu-channel-v2.md)，模型输入证据见
[ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)，取舍理由见
[v1.30 决策记录](../versions/v1.30/decisions.md)。

## 组件与权威

```text
Renderer 渠道设置
  └─ typed Preload API
       └─ Electron Main / Feishu Channel Host
          ├─ Developer Session Adapter：开放平台登录、身份回读、加密 Cookie jar、控制台 bootstrap
          ├─ OpenPlatformApiClient：同源控制台创建、配置、发布与回读
          ├─ Member Bot Provisioner：身份复核与发布状态机
          ├─ OS safeStorage：每 Agent App Secret
          ├─ 每 App WebSocket
          ├─ 入站规范化、群 Bot roster 观测
          └─ 领取并发送 Core ChannelDelivery
                         │
                         ▼
                    Rust Core
          ├─ Developer Identity / Publication Intent
          ├─ Feishu Owner / per-App identity
          ├─ Project Catalog / conversation binding generation
          ├─ PendingCampBinding / frozen message FIFO
          ├─ ExternalPrincipal
          ├─ multi-Bot aggregate / ChannelTurnRequest
          ├─ Camp、membership 与统一 admission
          └─ durable ChannelDelivery outbox
```

Rust Core 是 Owner identity、项目目录投影、渠道会话/执行范围、Camp、消息、Turn、Run、成员关系、排队和 Outbox 的
唯一持久权威。
Electron Main 只拥有需要网络和本机秘密的 Feishu Host；Renderer 只获得设置投影与 Owner 操作，不获得 App
Secret、原始 `userId`、Session Cookie、Host 恢复游标或内部路由事实。

`ExternalPrincipal` 表达消息作者、上下文来源和回复目标。即使它代表已验证 Feishu Owner，也不是 `local_user`，不能
连接账号、发布 Bot、维护路径或执行任何 Owner 命令。项目卡 callback 只有 exact pending binding 的窄批准能力。非 Owner
没有消息入口；不会因私聊、群管理员身份或显式 `@` 获得 Camp、项目或本机权限。

## 开发者会话与队员发布

“连接飞书账号”只在独立 Electron Session 中加载开放平台登录页，截取真实登录二维码，回读
`userId + userName + tenantId + tenantName + brand`，并把 Cookie jar 经 `safeStorage` 加密后原子写入本机私有文件。
它不创建 App、不产生 App ID/Secret，也不启动 Bot。Core 只保存由 `brand + tenantId + userId` 派生的不透明
`accountId`、`userIdDigest` 与可展示身份；缺少任一必需身份字段时不能进入 connected。
登录页打开前先异步预检 OS 安全存储；身份回读与安全保存是两个可见阶段。安全存储操作和身份回读都具有固定截止
时间，系统拒绝、超时或身份不完整会 fail closed，不让 Renderer 永久停留在 loading。显式隔离验收实例在 Electron
ready 前把应用名切换为 `Rovai AI Isolated <userData 摘要>`，从而与日常 App 和其他验收目录使用不同的 macOS
Keychain 命名空间；摘要不暴露原始路径，非隔离 App 继续使用原应用名以保持既有密文可读。

切换账号采用 staged Session：Main 为新二维码建立一次性非持久 partition，当前活动 Session 与 safeStorage 文件继续
服务旧账号。临时 Session 得到完整 Developer Identity 且新 Cookie jar 原子写入后，只建立可回滚 replacement；Core
account upsert 成功才 confirm 并清理旧内存存储。取消、超时、导航失败、加密失败或 Core commit 失败都会恢复旧 Cookie
store/活动 Session 并清理临时 partition，Core 中的当前账号不失效。显式“断开”仍
直接清除当前 Session。该切换只替换以后发布所用的 Developer Identity，不迁移或停止任何已发布 Bot。

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
version，先确认它 published。之后才配置 tenant scopes、receive/roster events 与 `card.action.trigger` callback。Event mode 与事件条目共享
120 秒、每秒一次的 bounded convergence budget；Scope/Event/Callback 各自报告是否发生远端或 Manifest mutation。
任一配置发生变化时，从当前 published version 递增 patch，创建或复用 exact 下一版本并发布；全部无变化时复用现有
版本。头像与兼容元数据可以继续写 manifest；Scope 使用在线 catalog 把名称映射为 App identity ID，再经 scope update
写入；在线 `callbackMode=4` 与 `card.action.trigger` 都是必需条件。最终回读以 robot、scope、event、callback 和 version
detail API 为运行时 authority，manifest 中的 scope/event/WebSocket 字段不能自证配置完成。在线配置验证通过后，
Main 依次把独立 credential 写入 safeStorage、Core upsert exact frozen Bot、建立并回读 Bot WebSocket identity，最后
完成 intent。普通流程始终保持隐藏窗口，不打开飞书“创建飞书智能体应用 / 立即创建”确认页，也不向 Renderer 产生二维码。

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
- 普通群：`provider + tenant + chat`；首次 Owner 显式 mention 选择一次项目，此后一个长期 Camp；
- 话题：`provider + tenant + chat + canonical topic`；每个话题各选择一次项目并拥有独立 Camp。

精确 `/new` 只在 Owner 私聊中是控制命令。它要求当前没有 collecting aggregate 或 queued/admitted request，关闭 active
generation，保留旧 Camp，并立即创建新 Quick Chat Camp；控制文本不进入 CampMessage、Turn、Run 或模型。群和话题
不解释 `/new`，也没有 rebind/change-project 命令。

普通群/话题首次 finalize 时创建 `PendingCampBinding`，把原始 Structured Content、targets 和 canonical-first
acknowledgement App 冻结到 FIFO；此时没有 CampMessage/Turn/Run。同一会话后续 Owner mention 复用同一 pending row，
不重复发卡。Core 通过 frozen Bot 私聊 Owner 一张项目卡；callback 只信 envelope 的 operator union/open identity，并以
nonce、version、expiry、frozen App 和 CAS 防双击/重放。所有 roster/project 前置检查通过后，同一事务创建 immutable
binding/Camp，再把 frozen messages 按 FIFO 提升到统一 admission。

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

话题 Camp 首次只加入当前显式 mention 的队员，父群增加 Bot 不污染既有话题。话题内显式 mention 或 A2A exact
target 需要一个尚未加入的队员时，Core 只有在该队员 Bot 仍 published 且 present 于父群 roster 时，才先通过同一
membership source 加入该话题 Camp。群 roster 不完整时 admission fail closed。

## 输出、恢复与秘密

`project_selection` 是唯一不依赖 ChannelTurnRequest 的 delivery：它关联 exact PendingCampBinding，使用冻结的
acknowledgement App 直接发送到 Owner open ID，不公开到原群/话题。payload 只有会话显示名、opaque 项目选项和
nonce/version；重启、重试和后续 pending 消息都复用同一 dedupe identity 与 Bot。

Core 只从已提交公开 CampMessage、Managed Attachment authority、AgentRun 公共 Evidence 和请求状态生成
`ChannelDelivery`。Outbox 使用 priority、lease、attempt、退避和稳定 dedupe key；Main 发送成功后回写外部消息 ID，
网络错误不会回滚 CampMessage。queue ack 只在真正排队时出现，admission 后删除或 recall，不再更新成“已开始”。
Agent 永久输出使用实际作者 Agent 的已发布 Bot；作者 Bot 不可用时不冒充其他队员，而是生成独立 attention。
飞书没有本地 AgentRun retry/decline 操作面，因此 required Run 失败且只剩人工重试决定时，Channel Host 确定性 decline
该重试并让 Turn/Request 收口，再继续同一 Binding 的 FIFO。

每个 AgentRun 有一个 Core-owned execution console identity。Core 把可公开 Execution Evidence、Run 状态和公开输出
coalesce 为同一 Card 2.0 snapshot；Main 与 Renderer 共享一套纯 presentation 规则，始终滤掉 reasoning/thought，活跃
工具展开，终态连续成功/已记录工具折叠。控制台只能由该 Agent 的冻结 App 创建、更新和撤回；下一条 root request
admission 召回同 ChannelConversation 中更早 Turn 的控制台，recall 等待在途 upsert 并把飞书 target revoked 当作幂等
成功。控制台是临时执行 presentation，不是 CampMessage，也不参与请求业务 settlement。

公开 Agent 正文永远新建无标题 Markdown 消息，不覆盖控制台、queue ack 或其他正文。`CurrentUserMention` 在群/话题
通过 SDK structured mention 投影为飞书原生 mention，不靠普通 `@名称` 或手写标签猜身份。公开 CampMessage 的 available
Managed Attachment v2 引用逐个生成原生 image/file delivery：Main 发送前经 Core 重新解析 authority，并在读取后复核
字节数与 digest；正文先终态，附件按 ordinal 依次发送且独立重试。单个附件最终失败只追加 attention，不重放正文或
已成功附件。请求 settlement 只等待 terminal Turn 与永久正文、附件、attention；queue ack、控制台及 recall 不阻塞 FIFO。

Core Snapshot 保存 pending aggregate、transport conversation 和 delivery 恢复事实，Main 启动后恢复所有 published
Bot 长连接、过期 lease、collecting finalize 与 Outbox。Renderer snapshot 在 Main 中剥离这些 Host-only 字段。
Host 为连接阶段、SDK policy reject、归一化 message 和 Rovai handler 接受/拒绝记录结构化诊断；所有 App/message/chat
identity 都先摘要，消息正文与外部用户 ID 不进入日志。当前 SDK 不提供归一化前 raw-event hook，Host 不虚构该观测层。
每个 App Secret 只以随机 credential ref 关联 Core；Developer Session Cookie jar 和 App Secret 都只在 Electron
`safeStorage` 可用时经异步 API 加密落盘。明文不进入 SQLite、Renderer、日志、Agent Context 或诊断输出，也不因
安全存储超时而降级。断开账号只删除 Developer Session；已发布 Bot 的 credential 与 WebSocket 生命周期保持独立。
