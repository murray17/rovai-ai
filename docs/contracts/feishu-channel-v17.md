---
document_type: protocol-contract
contract: feishu-channel-v17
authority: feishu-channel-account-provisioning-admission-delivery
status: accepted
version: 17
source_version: v1.72
last_updated: 2026-09-28
---

# Feishu Channel v17 Contract

继承 [v16](feishu-channel-v16.md) 的登录、身份、发布、入站、执行卡与投递合同。当前共享执行卡撤回时机
由 [Channel Message Bridge v1](channel-message-bridge-v1.md#execution-card-recall) 覆盖继承版本的根请求入场规则；
本版收窄飞书 provider 的品牌与可信域，并定义 Desktop 原生的本地发布绑定删除：`open.larksuite.com` 及其账号站点改由独立 provider [Lark Channel v1](lark-channel-v1.md) 拥有。
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
- 其已发布 Bot 不由飞书 Host 启动，Snapshot 以 `failureCode: "feishu_brand_moved_to_lark"` 呈现；
- 需要在 Lark 使用该队员时，通过 Lark 渠道重新发布，得到新的 Lark App 与凭据。

## 4. 本地删除发布绑定

Desktop 原生渠道页可通过受信任 Feishu Host 调用 `channels.feishu.memberBot.delete`，
命令为 `{agentId, expectedAppId, expectedVersion}`。Main 冻结用户确认的 App ID、读取最新版本，
与同 Provider 发布/重试共用互斥；Core 在 Domain Command Gateway 单事务内验证精确绑定及版本。
该命令不是远端删除，也不是 `disabled`，不要求 Developer Session 仍登录。

- 仅无发布意图或全部意图处于 `completed` / `failed_recoverable` 时可删除；活动或远端结果不明的意图拒绝删除。
- 验证当前凭据属于同一 Feishu App，且没有其他 Bot 或其他发布意图引用。凭据已缺失不阻止清理；身份冲突或交叉引用则全部不写入。
- 同事务删除该队员的旧飞书发布意图、精确 Bot 绑定和对应本地凭据；保留账号、Owner identity、成员、Thread/Camp、消息与 Run 历史。
- 删除前 Host 断开旧 App 长连接、停止聊天 worker 并阻止新入站；成功后失效私有凭据缓存。失败不伪造未发布，可重新读取或重试连接。
- 旧 App 未发送聊天出站标记 `failed`，已领取者标记 `unknown`，等待事项暂停；工作出站按 [Channel Storage v3](channel-storage-v3.md) 抑制重试。已发送事实不变，删除不声称撤回在途请求。
- 同 commandId 回放既有结果；新命令必须再次通过 App/version 比较，不能误删后来新建的绑定。旧 App 的工作出站在 Bot 缺失或不再 published 时不可领取。
- 成功后快照无该发布绑定，UI 恢复未发布；下次发布创建新的意图和 App，不因旧 completed intent 恢复已移除应用。

拒绝码为 `channel.host_required`、`feishu_member_bot.binding_conflict`、
`feishu_publication_intent.active_conflict`、`channel_credential.identity_conflict`、
`channel_credential.still_referenced`；Main 按 code 投影短文案，不透传 Core 原文。
本地删除不扩展 Lark、钉钉或 hosted Web 写协议，无数据库迁移。

## 5. 验证

- 可信域：三组 Lark 主机在请求层、身份归一化和 Session 恢复中均被拒绝；`open.larkoffice.com` 仍映射为飞书。
- Core：`brand=lark` 的飞书账号命令被拒绝且无写入；历史 `brand=lark` 行保持可读。
- Main：所有飞书 SDK 构造点断言 `Domain.Feishu`；遗留 `brand=lark` 账号按第 3 节过期且不启动其 Bot。
