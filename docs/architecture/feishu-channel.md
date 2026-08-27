---
document_type: architecture
architecture: feishu-channel
authority: feishu-channel-component-and-authority-boundaries
status: accepted
last_updated: 2026-08-27
---

# 飞书渠道架构

字段、状态和恢复合同见 [Feishu Channel v1](../contracts/feishu-channel-v1.md)，模型输入证据见
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
          ├─ Compat Provisioner：显式兼容注册确认
          ├─ 每 App WebSocket
          ├─ 入站规范化、群 Bot roster 观测
          └─ 领取并发送 Core ChannelDelivery
                         │
                         ▼
                    Rust Core
          ├─ Developer Identity / Publication Intent
          ├─ ProjectBinding / conversation binding
          ├─ ExternalPrincipal / App identity
          ├─ multi-Bot aggregate / ChannelTurnRequest
          ├─ Camp、membership 与统一 admission
          └─ durable ChannelDelivery outbox
```

Rust Core 是项目绑定、渠道会话、Camp、消息、Turn、Run、成员关系、排队和 Outbox 的唯一持久权威。
Electron Main 只拥有需要网络和本机秘密的 Feishu Host；Renderer 只获得设置投影与主人操作，不获得 App
Secret、原始 `userId`、Session Cookie、Host 恢复游标或内部路由事实。

`ExternalPrincipal` 表达消息作者、上下文来源和回复目标。它不是 `local_user`，不能连接账号、发布 Bot、维护
`ProjectBinding`、绑定会话或执行任何主人命令。绑定后的群成员只因显式 `@` 受管 Bot 而获得一次消息入口，
不会因此得到 Camp、项目或本机管理权限。

## 开发者会话与队员发布

“连接飞书账号”只在独立 Electron Session 中加载开放平台登录页，截取真实登录二维码，回读
`userId + userName + tenantId + tenantName + brand`，并把 Cookie jar 经 `safeStorage` 加密后原子写入本机私有文件。
它不创建 App、不产生 App ID/Secret，也不启动 Bot。Core 只保存由 `brand + tenantId + userId` 派生的不透明
`accountId`、`userIdDigest` 与可展示身份；缺少任一必需身份字段时不能进入 connected。
登录页打开前先异步预检 OS 安全存储；身份回读与安全保存是两个可见阶段。安全存储操作和身份回读都具有固定截止
时间，系统拒绝、超时或身份不完整会 fail closed，不让 Renderer 永久停留在 loading。显式隔离验收实例在 Electron
ready 前把应用名切换为 `Rovai AI Isolated <userData 摘要>`，从而与日常 App 和其他验收目录使用不同的 macOS
Keychain 命名空间；摘要不暴露原始路径，非隔离 App 继续使用原应用名以保持既有密文可读。

普通队员发布先创建持久 `MemberBotPublicationIntent`，再要求当前 Web Session 仍属于 intent 冻结的
`userId + tenantId`。`FeishuWebSessionMemberBotProvisioner` 从同一 Electron Session 的 Cookie jar 加载开放平台页，
只在 Main 中读取 `csrfToken + apiOrigin`；后续请求使用该 Session 的 Chromium 网络栈和 Cookie policy，不组装、记录或
返回 Cookie header。`apiOrigin` 必须精确匹配当前 brand 的 `https://open.feishu.cn | https://open.larksuite.com`，API
路径只允许 `/developers/`，相似域、跨源 URL 和页面身份漂移均在创建前拒绝。

`OpenPlatformApiClient` 按顺序上传受控队员头像、创建自建应用、读取 App Secret、启用 Bot、配置 tenant scopes、
receive/roster events、callback 与 event WebSocket mode，创建并发布 `1.0.0` 版本，再回读 manifest 与 version status。
scopes、events 和 callbacks 使用开放平台当前 manifest console API 分步写入；每一步保留服务端已有字段并在最终回读中
证明目标 `avatar_url`、必需集合、Bot enable、两类 WebSocket mode 与 published status。完成后 Main 才把独立 credential 写入
safeStorage、验证 Bot WebSocket 并完成 intent。普通流程始终保持隐藏窗口，不打开飞书“创建飞书智能体应用 /
立即创建”确认页，也不向 Renderer 产生二维码。

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
协议变化不得降级为确认页、SDK 注册或另一条静默创建路径。真实租户仍须回归“连接不增 App、普通发布不弹平台确认、
配置完整且能建立长连接”。

`/oauth/v1/app/registration + verification_uri_complete + showRegistrationConfirmation + pollRegistration` 整体只属于
`FeishuCompatMemberBotProvisioner`，由主人显式选择兼容模式时使用。兼容确认入口只接受官方精确 origin 上的
`/page/launcher | /page/cli` 与非空 `user_code`；相似域名、非 HTTPS、用户信息、端口和其他路径均在导航前拒绝。
正常失败不得自动进入兼容流程，兼容流程也不覆盖 Developer Identity。创建结果不确定、或已取得远端 App ID 但凭据
尚未安全提交时，intent 进入
`failed_unknown_remote_state`，自动重试被锁住，避免重复创建 App。Main 启动时只从持久 intent 判断可恢复/待人工核对，
不从 Renderer 状态推断。

当该未知 intent 已冻结 `remoteAppId` 时，主人再次点击普通“发布”是显式 reconciliation，而不是新的 create attempt。
Host 复核同一 Developer Identity，先对冻结 App 读取 Secret、版本列表/detail 与 manifest；不得创建 App、改变 App ID 或
进入兼容流程。若最新 published 仍为初始 `1.0.0` 且队员有可用受控头像，reconciliation 会把同一头像上传到同一 App、
重放幂等 manifest 配置，并创建或复用 `1.0.1` 头像修复版本后发布与回读。若 `1.0.1` 已 published，则只回读验证，
不重复上传或发布。完成证明后才保存 credential、验证 WebSocket，并让同一 intent 从
`failed_unknown_remote_state` 进入 `credentials_read` 后继续完成；Core 拒绝更换 App ID。缺少冻结 App ID、头像读取失败
或远端核对失败时仍保持未知状态，不允许创建第二个 App。

## 项目与会话

`ProjectBinding` 是 Core-owned 本机目录目录，保存不透明 ID、显示名、`quick_chat | directory`、规范路径、
状态和版本。只有主人可以创建、重命名、归档或把渠道会话切换到一个 Binding。飞书消息和 Card Action 都不携带
本机路径，也没有项目列表、申请绑定或自动选择入口。

渠道会话 identity 按场景冻结：

- 私聊：`provider + tenant + chat + receiving app`，不同队员 Bot 私聊不会合并；
- 普通群：`provider + tenant + chat`；
- 话题：`provider + tenant + chat + canonical topic`。

未绑定消息只更新 `ChannelConversation` 与有 TTL 的传输聚合。它不创建 ExternalPrincipal、Camp、
ChannelTurnRequest、CampMessage、CampTurn 或 AgentRun。主人之后在本机绑定只改变未来 admission；已观察消息
冻结的 binding 仍为空，必须由发送者重新发送。

首次合格消息需要 Camp 时，Core 在同一准入流程解析 active `ProjectBinding`，把现有
`project_binding_kind + project_path` 冻结到 Camp。后续重命名 Binding 不改 Camp；切换会话先要求旧 Binding 没有
queued/admitted 请求，并让下一条消息创建新的 Camp，旧 Camp 历史保持独立。

## 入站、聚合与串行准入

Host 只转交私聊，或普通群/话题中显式 `@` 一个以上已发布受管 Bot 的用户消息。echo、未 mention 群消息、
未知 Bot 和不完整 topic identity 在 Host 边界停止。多个 App 可能收到同一飞书消息，因此 Core 先写
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

第一条 observation 永远不直接创建业务事实；finalize 是独立命令。不同 App 对同一 canonical message 的冻结
payload 不一致时失败，缺少完整映射或预期 observation 时在三秒窗口后 fail closed。聚合只服务 transport
dedup/aggregation，并在终态七天后清理；external message ID 不成为 Camp History 或 reply identity。

Finalize 先重查 observation 时冻结的 exact active binding、项目、已发布 Bot 和群 roster，再创建一个
`ChannelTurnRequest`。每个 Binding 同时最多一个 admitted 请求；其余保持 queued，且不进入 Camp conversation、
Context 或 AgentRun。提升复用与本地用户发送相同的 `CollaborationService` 原子 admission，一次性创建唯一触发
CampMessage、一个根 CampTurn 与全部初始 AgentRun。只有 Runtime 暂未 ready 属于可重试排队 blocker；永久目标或
授权错误终结请求并产生 attention delivery。

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
reconciliation generation 同步。Bot 移出群或被本机停用都走同一原子 cutover/reconciliation。

话题 Camp 首次只加入当前显式 mention 的队员，父群增加 Bot 不污染既有话题。话题内显式 mention 或 A2A exact
target 需要一个尚未加入的队员时，Core 只有在该队员 Bot 仍 published 且 present 于父群 roster 时，才先通过同一
membership source 加入该话题 Camp。群 roster 不完整时 admission fail closed。

## 输出、恢复与秘密

Core 只从已提交公开 CampMessage 和请求状态生成 `ChannelDelivery`。Outbox 使用 lease、attempt、退避和稳定
dedupe key；Main 发送成功后回写外部消息 ID，网络错误不会回滚 CampMessage。队列卡从“等待”原位更新为“开始”，
Agent 输出使用实际作者 Agent 的已发布 Bot；作者 Bot 不可用时不冒充其他队员，而是生成 attention 状态。
`CurrentUserMention` 在群/话题投影为飞书原生 `<at>`，不靠普通 `@名称` 字符串猜身份。

Core Snapshot 保存 pending aggregate、transport conversation 和 delivery 恢复事实，Main 启动后恢复所有 published
Bot 长连接、过期 lease、collecting finalize 与 Outbox。Renderer snapshot 在 Main 中剥离这些 Host-only 字段。
每个 App Secret 只以随机 credential ref 关联 Core；Developer Session Cookie jar 和 App Secret 都只在 Electron
`safeStorage` 可用时经异步 API 加密落盘。明文不进入 SQLite、Renderer、日志、Agent Context 或诊断输出，也不因
安全存储超时而降级。断开账号只删除 Developer Session；已发布 Bot 的 credential 与 WebSocket 生命周期保持独立。
