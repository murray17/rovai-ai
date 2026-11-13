---
document_type: protocol-contract
contract: feishu-channel-v17
authority: feishu-channel-account-provisioning-admission-delivery
status: accepted
version: 17
source_version: v1.72
last_updated: 2026-11-13
---

# Feishu Channel v17 Contract

继承 [v16](feishu-channel-v16.md) 的登录、身份、发布、入站、执行卡与投递合同。当前共享执行卡撤回时机
由 [Channel Message Bridge v1](channel-message-bridge-v1.md#execution-card-recall) 覆盖继承版本的根请求入场规则；
本版收窄飞书 provider 的品牌与可信域，连接观测扩展见第 5 节：`open.larksuite.com` 及其账号站点改由独立 provider [Lark Channel v1](lark-channel-v1.md) 拥有。
飞书表结构不变，无飞书数据迁移。

## 1. 品牌与可信域

飞书 provider 只接受 `brand=feishu`。可信集合为：

- 登录与交接主机：`accounts.feishu.cn`、`passport.feishu.cn`、`accounts.larkoffice.com`、`passport.larkoffice.com`；
- 开放平台 origin：`https://open.feishu.cn`、`https://open.larkoffice.com`，两者均映射为 `feishu`；
- Cookie 根域：`feishu.cn`、`larkoffice.com` 及其子域。

v16 中的第三站点 `open.larksuite.com`、`accounts.larksuite.com`、`passport.larksuite.com` 与 Cookie 根域
`larksuite.com` 从飞书集合移除。任一跳落到这些主机按 `feishu_session_url_rejected` 拒绝；开放平台 HTML 声明的
`outDomain.larkOpen` 指向它们时按身份不一致拒绝。不能以包含 `lark` 的字符串推断品牌。

`channels.feishu.account.upsert` 与 `channels.feishu.account.commitConnection` 对 `brand` 不等于 `feishu` 的输入
按参数错误拒绝，不产生部分写入。`feishu_account.brand` 列与其 CHECK 保持原样，只约束历史行的可读性。

## 2. 运行期 SDK 域

飞书 Host 创建的每一个 SDK 对象都显式使用 `Domain.Feishu`，包括已发布 Bot 的长连接 channel、发布器的 App-only
Client、卡片与消息发送 Client、外部引用读取和欢迎卡；不依赖 SDK 默认值。

## 3. 历史 `brand=lark` 行

v17 之前，飞书登录入口固定为 `accounts.feishu.cn`，正常流程不会产生 `brand=lark` 的飞书账号；以下规则只处理
异常遗留：

- 这类 `feishu_account` 行及其 Bot、发布意图、Owner identity 与凭据不删除、不移动、不复制到 Lark 表；
- 若它是当前 connected 账号，飞书 Host 恢复时通过 `channels.feishu.account.expire` 将其置为过期，公开失败码
  `feishu_brand_moved_to_lark`；Owner 需要在飞书渠道重新连接飞书账号，或在 Lark 渠道连接 Lark 账号；
- 其已发布 Bot 不由飞书 Host 启动，Snapshot 以 `connectionFailureCode: "feishu_brand_moved_to_lark"` 呈现；
- 需要在 Lark 使用该队员时，通过 Lark 渠道重新发布，得到新的 Lark App 与凭据。

## 4. 验证

- 可信域：三组 Lark 主机在请求层、身份归一化和 Session 恢复中均被拒绝；`open.larkoffice.com` 仍映射为飞书。
- Core：`brand=lark` 的飞书账号命令被拒绝且无写入；历史 `brand=lark` 行保持可读。
- Main：所有飞书 SDK 构造点断言 `Domain.Feishu`；遗留 `brand=lark` 账号按第 3 节过期且不启动其 Bot。

## 5. 连接观测与恢复

`channels.feishu.memberBot.observeConnection` 只允许 `feishu-channel-host`。输入为
`accountId, agentId, appId, credentialRef, expectedVersion, botOpenId, botDisplayName`；`botOpenId`
非空且最多 512 字节。Lark 的对应命令只允许 `lark-channel-host`，钉钉和 Renderer 均不开放。

Core 必须找到 `published` Bot、逐项匹配冻结绑定，并确认该 App 的 Owner 映射已验证。已有 `bot_open_id`
为空时填入，相同时保留，非空且不同时返回 `member_bot.identity_conflict`；display name 可以更新。
版本不符返回 version conflict。命令只更新 Bot 自身字段；无实际变化时 no-op，不递增版本；有变化时版本加一。
Owner、绑定、`published_at` 均不变化。首次发布的 upsert 拥有绑定写入，之后身份观测使用本命令。
历史 disabled 行须先经过原发布状态机恢复为 published，不能通过观测命令激活。
Owner 验证要求映射行的 `open_id_digest` 和 `verified_at` 均非空，Snapshot 使用相同判定。历史已发布 Bot
尚未验证 Owner 时，Host 跳过观测与 intent 收尾，保留在线连接，让首条可信 Owner 入站消息执行原
`owner.verify`；验证后再观测。Core 返回 `owner_identity.unverified` 也按观测暂缓处理，不能关闭连接。
新的观测尝试使用新的命令标识，不能重放验证之前缓存的拒绝回执。

Host 为每个 App 保留同一 HTTP channel 与 safety cache；单次失败只关闭 WSClient。首个 onReady 之前
由 Host 调度，之后正常断线由 SDK 调度，SDK 终态退出后才交回 Host；同 App 不并行建连。身份阶段（含
Token）、endpoint、握手上限分别为 15/15/20 秒。关闭永久使旧生命周期失效，迟到结果不得重启连接。
`start` 调度后返回；停止和 Core 切代次不等待远端身份请求。
60 秒防御 watchdog 只覆盖 transport 的 connect，握手结算后立即清除，不覆盖 Core 本地确认。
传输在线但本地确认暂不可用时保留在线事实，只重试本地保存；绑定缺失进入配置终态。
endpoint 先判断平台 code，再读取成功 data；HTTP 错误响应使用同一分类。`514/403`、明确配置错误
不可重试；`99991400` 和 HTTP 429 可重试，遵守 `x-ogw-ratelimit-reset`（剩余秒数）及 Retry-After；
`99991401` 是 IP 白名单配置终态。不能仅凭通用 permission_denied 标签判定凭据失效。

只差连接验证的最新 exact intent，实际握手和身份持久观测成功后，可在本地 CAS 推进
`version_published → connection_verified → completed`；`failed_recoverable` 仅在最后完成步骤为
version_published/connection_verified 时进入此收尾。每轮 CAS 重读最新版本，出现更新的 intent 时停止旧收尾；
冲突耗尽以可恢复的本地确认失败保留，不能静默成功。不能重放远端创建、配置和发布。恢复不补发欢迎卡。

连接失败不抹去持久 published，不推断 Developer Session 失效。身份冲突、冻结绑定不符、凭据缺失或明确
拒绝进入需处理终态，并停止该记录的 WS 与 HTTP 外发；可恢复网络故障无限重试，间隔封顶。
传输恢复不保证平台补发所有入站，也不重放已终结的外发。真正断网、凭据或身份冲突时仍适用 Core
最多 5 次 delivery 尝试；身份冲突停止外发后，已有 delivery 也可能耗尽并进入终态。
