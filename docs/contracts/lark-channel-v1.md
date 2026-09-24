---
document_type: protocol-contract
contract: lark-channel-v1
authority: lark-channel-provider-identity-storage-login-and-runtime-domain
status: accepted
version: 1
source_version: v1.71
last_updated: 2026-09-24
---

# Lark Channel v1

Lark 是与飞书并列的独立渠道 provider，不是飞书 provider 下的品牌选项。本合同只定义 Lark 与飞书不同的部分：
provider 身份、请求面、存储、可信域、登录配置、运行期 SDK 域、模型上下文边界和能力 gate。未在本合同替换的
行为，逐条继承 [Feishu Channel v17](feishu-channel-v17.md) 及其继承链：Owner-only 入站、多 Bot 聚合、
PendingCampBinding 与项目卡、Quick Chat 与 `/new`、群 roster、执行卡与 LAN 只读执行台、永久正文与附件投递、
欢迎卡、队员发布状态机、Developer Session 扫码状态机与本地提交核对。

共享边界不变：[Channel Message Bridge v1](channel-message-bridge-v1.md)、
[Channel Storage v3](channel-storage-v3.md)、[Channel Host Maintenance v5](channel-host-maintenance-v5.md)、
[Camp Membership v2](camp-membership-v2.md)与 [ContextManifest Evidence v30](context-manifest-evidence-v30.md)。

## 1. Provider 身份

| 项 | 值 |
| --- | --- |
| provider 字符串 | `lark` |
| Core Host 组件 | `lark-channel-host` |
| `ChannelKind` | `lark` |
| Snapshot `displayName` | `Lark` |
| `AutomationNotifyChannel` | `lark` |
| 账号 `brand` | 固定 `lark` |

Lark 专属领域命令类型共 8 个：`lark_account.upsert`、`lark_account.commit_connection`、`lark_account.disconnect`、
`lark_account.expire`、`lark_member_bot.upsert`、`lark_member_bot_publication_intent.create`、
`lark_member_bot_publication_intent.advance`、`lark_owner.verify`。其余 `channel_*` 与
`pending_camp_binding.resolve` 命令类型保持中立，由命令 actor 决定 provider。

## 2. 请求面

Core 只从请求名决定 actor；请求 payload 不能声明或改写 actor。`channels.lark.account.disconnect` 与飞书、钉钉
同名请求一致，以本地 Owner 的用户信封执行，Host actor 调用时以 `lark_account.owner_required` 拒绝；由请求名选定
Lark 服务，只读写 `lark_account` 与 `provider = 'lark'` 的 Developer Session。其余 `channels.lark.` 前缀请求
一律以 `lark-channel-host` 执行。未列出的 `channels.lark.*` 请求返回未知方法。

Lark 专属请求 12 个，与飞书同名请求一一对应，命令语义相同但只读写 Lark 表：

| 请求 | 对应飞书请求 |
| --- | --- |
| `channels.lark.account.upsert` | `channels.feishu.account.upsert` |
| `channels.lark.account.commitConnection` | `channels.feishu.account.commitConnection` |
| `channels.lark.account.disconnect` | `channels.feishu.account.disconnect` |
| `channels.lark.account.expire` | `channels.feishu.account.expire` |
| `channels.lark.memberBot.upsert` | `channels.feishu.memberBot.upsert` |
| `channels.lark.owner.verify` | `channels.feishu.owner.verify` |
| `channels.lark.pendingBinding.resolve` | `channels.feishu.pendingBinding.resolve` |
| `channels.lark.publicationIntent.create` | `channels.feishu.publicationIntent.create` |
| `channels.lark.publicationIntent.advance` | `channels.feishu.publicationIntent.advance` |
| `channels.lark.publicationIntent.storeCredential` | `channels.feishu.publicationIntent.storeCredential` |
| `channels.lark.dm.startNew` | `channels.feishu.dm.startNew` |
| `channels.lark.snapshot` | `channels.feishu.snapshot` |

Actor 绑定请求 8 个。它们的飞书形式虽然没有 `feishu` 前缀，但 Core 以飞书 Host 身份执行，因此 Lark 需要独立
请求名；参数、结果、幂等和错误与不带前缀的形式相同：

| 请求 | 共享形式 |
| --- | --- |
| `channels.lark.inbound.observe` | `channels.inbound.observe` |
| `channels.lark.inbound.finalize` | `channels.inbound.finalize` |
| `channels.lark.roster.reconcile` | `channels.roster.reconcile` |
| `channels.lark.deliveries.settle` | `channels.deliveries.settle` |
| `channels.lark.host.tick` | `channels.host.tick` |
| `channels.lark.executionConsole.page.authorize` | `channels.executionConsole.page.authorize` |
| `channels.lark.executionConsole.recentOutput.authorize` | `channels.executionConsole.recentOutput.authorize` |
| `channels.lark.executionConsole.agentRun.cancel` | `channels.executionConsole.agentRun.cancel` |

已按 payload `provider` 选择组件的请求接受 `provider: "lark"`：`channels.credentials.delete`、
`channels.developerSession.replace`、`channels.developerSession.delete`。不依赖 Host 身份的读取与成员请求保持原名：
`channels.credentials.get`、`channels.credentials.listPublished`、`channels.developerSession.get`、
`channels.executionConsole.source`、`channels.executionConsole.webSnapshot`、`channels.membership.add`、
`channels.membership.remove`；它们按行上的 provider 列区分 Lark 事实。

一个 Host 用另一个 provider 的请求名或 provider 值写入时，Core 必须拒绝并不产生部分写入。Lark Host 以飞书请求
操作 Lark 行、或飞书 Host 以 Lark 请求操作飞书行，都属于此类拒绝。

## 3. 存储

Lark 拥有 5 张专属表：`lark_account`、`lark_owner_identity`、`lark_owner_app_identity`、`lark_member_bot`、
`lark_member_bot_publication_intent`。每张表的列、类型、默认值、非空、CHECK、唯一约束、索引和外键，与当前同名
`feishu_*` 表逐项相同，仅把名称前缀 `feishu_` 替换为 `lark_`，并有以下两处差异：

- `lark_account.brand` 为 `TEXT NOT NULL CHECK(brand = 'lark')`；
- `lark_account_single_connected_idx` 在 `lark_account(status) WHERE status = 'connected'` 上唯一。

因此 Lark 与飞书各自最多一个 connected 开发者账号，互不影响。同一个 Agent 可以同时拥有一个飞书队员 Bot 和一个
Lark 队员 Bot；每个 provider 内仍是一个 Agent 至多一个 Bot。

一个新迁移原子完成以下变化，飞书与钉钉既有行不改写：

1. 建立 5 张 Lark 表与索引；
2. 重建 `channel_credentials`、`channel_developer_sessions`、`automation_notification_delivery`，把 provider CHECK
   扩展为 `provider IN ('feishu', 'dingtalk', 'lark')`，保留全部行、索引、外键与其他约束；
3. 重建 `channel_member_bot_directory` 与 `channel_owner_app_identity_directory` 视图，增加 `'lark'` 分支，
   `owner_identity_kind` 与飞书相同为 `open_id`；
4. 按当前迁移惯例推进数据合同版本并提供测试用降级辅助。

迁移后测试必须比较 `PRAGMA table_xinfo`、`index_list`、`index_info` 与 `foreign_key_list` 的规范化结果，证明
每对 `feishu_*`/`lark_*` 结构只在上述两处不同。

## 4. 可信域与登录配置

| 用途 | Lark 允许 | 飞书允许（见 Feishu v17） |
| --- | --- | --- |
| 登录与交接主机 | `accounts.larksuite.com`、`passport.larksuite.com` | `feishu.cn`、`larkoffice.com` 的 accounts/passport |
| 开放平台 origin | `https://open.larksuite.com` | `https://open.feishu.cn`、`https://open.larkoffice.com` |
| Cookie 根域 | `larksuite.com` 及其子域 | `feishu.cn`、`larkoffice.com` 及其子域 |
| 管理链接 | `https://open.larksuite.com/app/<appId>/baseinfo` | 飞书 origin 下同路径 |

两组集合不相交。任何一跳落到对方集合即按 URL 拒绝处理，不能以包含 `lark` 的字符串推断 provider。

Lark 登录配置：`loginOrigin=https://accounts.larksuite.com`，`redirectUri` 与 `portalUrl` 均为
`https://open.larksuite.com/app?lang=zh-CN`。Passport 应用标识、API version 与 device info 在本版暂取飞书当前值，
状态为未验证；真实 Lark 探测结果不一致时，只修改 Lark 配置，不得改动飞书配置。协议、字段与阶段机沿用
Feishu v16 登录合同，错误码前缀使用 `lark_`，例如 `lark_login_protocol_incomplete`、`lark_session_url_rejected`、
`lark_developer_session_expired`、`lark_developer_identity_changed`。

身份归一化要求 `brand=lark` 且最终开放平台 origin 为 `https://open.larksuite.com`；HTML 声明的开放平台域与最终站点
不一致时拒绝。

## 5. 运行期 SDK 域

Lark Host 创建的每一个 SDK 对象都必须显式使用 `Domain.Lark`：已发布 Bot 的长连接 channel、发布器的 App-only
Client、卡片与消息发送 Client、外部引用读取和欢迎卡。缺省 domain 视为缺陷，不能依赖 SDK 默认值。飞书 Host
同样显式使用 `Domain.Feishu`。

## 6. Snapshot、Renderer 与 Web

`ChannelSettingsSnapshot.schemaVersion` 保持 4。`channels[]` 可以包含 `kind: "lark"`、`displayName: "Lark"` 的
Provider，结构与飞书 Provider 相同，账号 `brand` 为 `lark`。Host 渠道请求的 `publish` 与 `retry` 接受
`kind: "lark"`；`selectApprover` 仍只接受钉钉。Web `ChannelKind` 增加 `lark` 变体。

Lark 的重连类失败码 `lark_session_expired`、`lark_developer_session_expired`、`lark_developer_identity_changed`
映射为 `channel_session_expired`；`lark_login_interaction_required` 映射为 `channel_native_interaction`。

两个 Provider 的连接、切换、断开、过期、发布与重试相互独立。任一 Host 启动失败不阻止另一 Host 与钉钉 Host 启动；
协调器聚合 Snapshot 时保持 Provider 顺序为飞书、Lark、钉钉。

## 7. 模型上下文

本版不改变任何模型可见内容。Lark 绑定的 Camp 不注入飞书文件交付提示；判断该提示的条件仍精确匹配
`provider = 'feishu'`。把该提示扩展到 Lark 属于核心模型上下文变更，必须按
[核心模型上下文变更治理](../development/model-context-change-governance.md)建立独立说明并取得开发者二次确认。
在此之前，Agent 显式使用 `rovai send --file` 时 Lark 仍按继承的附件投递合同发送。

## 8. 能力 Gate

| 能力 | 本版状态 | 解除条件 |
| --- | --- | --- |
| Provider 身份、请求面、存储与隔离 | 自动化测试验收 | Core 与 Main 测试通过 |
| 开发者账号扫码连接 | 未验证 | 真实 Lark 账号完成 init、轮询、交接、身份读取与本地提交 |
| 队员 Bot 发布 | 未验证 | 真实 Lark 租户完成建应用、头像、能力、版本发布与凭据提交 |
| 私聊、群聊、多 Bot、执行卡、永久输出、附件 | 继承实现，未验证 | 真实 Lark 客户端逐项验收并记录 qualification |

未验证能力的入口可以开放，但 Renderer 必须在 Lark 页签说明区显示“Lark 支持尚未完成真实租户验收”，发布说明与
根 README 不得宣称支持 Lark。全部解除条件满足后，由后续版本移除该提示。

## 9. 与飞书既有数据的关系

迁移前 `feishu_account.brand = 'lark'` 的行不移动、不复制到 Lark 表；其处理由 Feishu v17 定义。Lark 账号与
Bot 只能通过 Lark 渠道新建。

## 10. 验证

- Core：结构等价测试；Lark 与飞书各自单 connected 账号且互不影响；错误 provider 请求被拒绝且无部分写入；
  8 个 actor 绑定请求使用 `lark-channel-host`；目录视图返回 Lark Bot；三张中立表接受 `lark` 并保留旧行；
  Lark 绑定 Camp 的 Charter 不含飞书文件交付提示。
- Main：两个渠道服务实例并存；Lark 实例注入 Lark 登录配置、`Domain.Lark` 与 `channels.lark.*` 方法名；
  所有 SDK 构造点的 domain 断言；可信域拒绝对方站点；一个实例启动失败不影响另一个。
- Renderer 与 Web：三个 Provider 页签、Lark 标志与文案、未验收提示、`kind: "lark"` 的发布与重试。
- 真实环境：按第 8 节逐项记录，未完成的项保持未验证。
