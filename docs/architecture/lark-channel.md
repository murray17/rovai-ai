---
document_type: architecture
architecture: lark-channel
authority: lark-channel-component-and-authority-boundaries
status: accepted
last_updated: 2026-09-24
---

# Lark 渠道架构

Lark 是与飞书、钉钉并列的独立 provider。它与飞书使用同一开放平台协议族和同一 SDK，因此复用飞书的 Host 实现与
Core 领域逻辑，但拥有自己的 provider 身份、表、请求名、可信域、登录配置和 SDK 域。字段与请求面见
[Lark Channel v1](../contracts/lark-channel-v1.md)，被继承的行为见 [Feishu Channel v17](../contracts/feishu-channel-v17.md)
与[飞书渠道架构](feishu-channel.md)，取舍理由见 [V1.72-D01](../versions/v1.72/decisions.md#v1-72-d01)。

## 组件与权威

```text
Renderer 渠道设置（飞书 / Lark / 钉钉 三个 Provider 页签）
  └─ typed Preload API
       └─ Electron Main / ChannelSettingsCoordinator
          ├─ 飞书渠道服务实例 ← FeishuProviderProfile
          ├─ Lark 渠道服务实例 ← LarkProviderProfile
          │    ├─ 登录配置：accounts.larksuite.com / open.larksuite.com
          │    ├─ 可信域：larksuite.com 集合
          │    ├─ SDK：Domain.Lark
          │    ├─ Core 方法：channels.lark.*
          │    └─ 失败码与文案：lark_* / “Lark”
          └─ 钉钉渠道服务（既有）
                              │
                              ▼
                         Rust Core
          ├─ ChannelProviderSpec：provider、Host 组件、表名集合、请求前缀
          ├─ 参数化的账号 / Owner / Bot / 发布意图领域逻辑
          ├─ feishu_* 表族 与 lark_* 表族（结构等价，行级隔离）
          └─ provider-neutral：会话、绑定、roster、入站聚合、Delivery、执行台、凭据、Developer Session
```

飞书与 Lark 在 Main 中是同一个渠道服务类的两个实例，差异全部来自注入的 Provider Profile；在 Core 中是同一套
领域函数，差异全部来自 `ChannelProviderSpec`。两者都不以运行期字符串判断品牌。

Core 只从请求名决定 actor：`channels.lark.*` 以 `lark-channel-host` 执行，`channels.feishu.*` 与既有飞书
共享形式以 `feishu-channel-host` 执行；两家的 `account.disconnect` 例外，与钉钉一致以本地 Owner 执行，由请求名
选定服务的 Spec。领域函数再以 actor 选择 Spec，因此一个 Host 无法借请求 payload 写入另一个 provider 的表。

## 隔离

- **账号**：每个表族各有一条 connected 唯一索引。飞书与 Lark 可以同时连接，各自切换、断开和过期互不影响。
- **Bot**：每个表族以 `agent_id` 为主键。同一队员可同时拥有飞书 Bot 与 Lark Bot，二者是不同远端 App。
- **会话**：`channel_conversation` 以 provider 为唯一键的一部分，两家同名 chat 或 tenant 不会相撞。
- **可信域**：两组主机与 Cookie 根域不相交，任一跳越界即拒绝。
- **SDK 域**：每个 SDK 构造点显式传入 Profile 的域，缺省视为缺陷。

## 共享而不复制

凭据与 Developer Session 继续存放在 provider 分区的中立表中，Main 启动时仍以一次批量查询加载所有 Provider 的
已发布凭据再分发给各实例。Host 维护调度、执行台服务、Outbox 租约与重试、FIFO、项目卡和 Quick Chat 目录全部共用，
只以 provider 区分事实。

## 模型上下文

Lark 不改变任何模型可见内容。飞书绑定 Camp 的文件交付提示仍只对 `provider = 'feishu'` 注入；是否扩展到 Lark
需要独立的核心模型上下文变更与开发者二次确认。

## 验证 Gate

Provider 身份、存储、隔离和请求面由自动化测试验收。登录协议、控制台发布和客户端交互依赖 Lark 站点的真实行为，
在真实租户验收前保持未验证，Renderer 显示未验收提示，产品不宣称支持 Lark。

## References

- [Lark Channel v1](../contracts/lark-channel-v1.md)
- [Feishu Channel v17](../contracts/feishu-channel-v17.md)
- [飞书渠道架构](feishu-channel.md)
- [Channel Storage v3](../contracts/channel-storage-v3.md)
- [Channel Message Bridge v1](../contracts/channel-message-bridge-v1.md)
- [渠道设置](../ui/components/channel-settings.md)
- [V1.72-D01](../versions/v1.72/decisions.md#v1-72-d01)
