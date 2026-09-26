---
document_type: protocol-contract
contract: feishu-channel-v17
authority: feishu-channel-account-provisioning-admission-delivery
status: accepted
version: 17
source_version: v1.72
last_updated: 2026-09-24
---

# Feishu Channel v17 Contract

继承 [v16](feishu-channel-v16.md) 的全部登录、身份、发布、入站、执行卡与投递合同。本版只收窄飞书 provider 的
品牌与可信域：`open.larksuite.com` 及其账号站点改由独立 provider [Lark Channel v1](lark-channel-v1.md) 拥有。
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

## 4. 验证

- 可信域：三组 Lark 主机在请求层、身份归一化和 Session 恢复中均被拒绝；`open.larkoffice.com` 仍映射为飞书。
- Core：`brand=lark` 的飞书账号命令被拒绝且无写入；历史 `brand=lark` 行保持可读。
- Main：所有飞书 SDK 构造点断言 `Domain.Feishu`；遗留 `brand=lark` 账号按第 3 节过期且不启动其 Bot。
