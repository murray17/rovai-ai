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
          ├─ Developer Session Adapter：开放平台登录、身份回读、加密 Cookie jar
          ├─ Member Bot Provisioner：身份复核、应用确认与发布状态机
          ├─ OS safeStorage：每 Agent App Secret
          ├─ 显式兼容注册二维码与每 App WebSocket
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

普通队员发布先创建持久 `MemberBotPublicationIntent`，再要求当前 Web Session 仍属于 intent 冻结的
`userId + tenantId`。`MemberBotProvisioner` 使用官方应用注册协议的 begin/poll，并在同一已登录 Electron Session
中打开官方确认页；因此正常路径不向 Renderer 产生二维码。平台确认成功后，官方 preset/addons 一次提交 Bot、
最小权限与事件，Main 保存独立 credential、验证 WebSocket，再完成 intent。确认页若跳回登录、身份漂移或 Session
失效，流程 fail closed，并要求主人重新连接。

SDK `registerApp` 只由主人显式选择“兼容扫码发布”时调用；正常失败不得静默切换。兼容流程不覆盖 Developer
Identity。创建结果不确定、或已取得远端 App ID 但凭据尚未安全提交时，intent 进入
`failed_unknown_remote_state`，自动重试被锁住，避免重复创建 App。Main 启动时只从持久 intent 判断可恢复/待人工核对，
不从 Renderer 状态推断。

Developer Session Adapter 依赖开放平台 Web 登录页和公开页面身份对象，是可替换、版本敏感的边界；它不调用开发者
后台私有 CSRF 创建接口。仓库自动化只验证 fail-closed 状态机、秘密隔离和协议拼装，真实租户的“连接不增 App、
连续发布不扫码”必须另行验收，不能由本地测试冒充。

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
`safeStorage` 可用时加密落盘。明文不进入 SQLite、Renderer、日志、Agent Context 或诊断输出。断开账号只删除
Developer Session；已发布 Bot 的 credential 与 WebSocket 生命周期保持独立。
