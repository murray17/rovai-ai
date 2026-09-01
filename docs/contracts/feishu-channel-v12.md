---
document_type: protocol-contract
contract: feishu-channel-v12
authority: feishu-channel-execution-card-and-lan-readonly-view
status: accepted
version: 12
source_version: v1.37
last_updated: 2026-09-01
---

# Feishu Channel v12 Contract

继承 [Feishu Channel v11](feishu-channel-v11.md) 的入站规范化，以及此前执行卡、固定 `open_url`、公开执行投影、
全局 LAN HTTP 服务、内存 Token、授权 scope、Owner callback、生命周期和持久兼容边界。本版只修订局域网执行台
首次使用时的启用默认值，并增加“至少一个渠道 Bot 当前已发布”才允许绑定 listener 的门槛；飞书卡片、Web 页面、
Core 授权和端口范围不变。

## 1. 首次使用与持久选择

`execution-web.json` 继续使用精确 schema 1。Main 按以下优先级加载：

1. 文件存在且 schema 有效时，持久化的 `enabled` 与 `port` 是唯一权威；用户已经保存的关闭状态不得被默认值覆盖；
2. 文件不存在时，使用不落盘的首次默认值
   `{ "schemaVersion": 1, "enabled": true, "port": 8765 }`；该值表达用户配置意图，不单独授权绑定端口；
3. 文件存在但内容无效、无法解析或无法读取时，必须失败关闭为
   `{ "schemaVersion": 1, "enabled": false, "port": 8765 }`，同时暴露结构化降级，不得自动覆盖原文件。

首次默认值本身不创建设置文件；只有用户保存设置时才通过既有私有原子写入持久化。因此本版不迁移、重写或重新解释
既有有效配置，保存为 `false` 的用户重启后仍保持关闭。

## 2. 已发布 Bot 门槛与服务状态

Main 从权威 `ChannelSettingsSnapshot` 判断是否至少有一个 `memberBots[].publicationStatus === "published"`。
`enabled: true` 与该条件同时成立时，`ExecutionViewService` 才按所选端口自动选择确定性的 RFC1918 IPv4 并尝试绑定。
没有当前已发布的渠道 Bot 时，服务进入 `no_published_bot`，不得解析网卡或创建 HTTP server；配置仍保持开启。

首个 Bot 进入 `published` 后自动尝试激活。最后一个已发布 Bot 离开该状态时，Main 必须关闭 listener、终止实时流并撤销
全部内存 Grant；旧卡链接随即失效。找不到私有地址或端口被占用时，用户选择仍保持 `enabled: true`，服务分别进入
`no_lan_address` 或 `port_conflict`；不得改写为关闭、漂移到其他端口或修复旧卡。

## 3. 设置界面

渠道设置中的“局域网执行台”仍位于页面底部并默认折叠。首次使用时 Switch 显示开启，摘要继续显示真实 listener 状态，
没有已发布 Bot 时显示“等待 Bot 发布 · 8765”；门槛满足后再显示“已开启”“无可用局域网地址”或“端口被占用”。
不得把配置意图伪装成 ready。已有持久设置和异常配置分别按第 1 节投影，不新增迁移提示、确认框或视觉体系。

## 4. 安全与兼容边界

默认开启本身不会造成端口监听；至少一个渠道 Bot 当前已发布后，Desktop 才可能在私有局域网地址监听。HTTP 页面仍只
暴露只读、Token 限定的冻结 scope；获取链接、能够进入该局域网且 Token 仍有效的人可以查看，不升级为公网分享、
HTTPS、Owner 身份认证或通用远程访问能力。

本版不新增 SQLite Migration，不改变持久设置 schema、SSE、Token 生命周期或 Card 2.0 payload；
`ExecutionWebServerState` 增加 `no_published_bot`。配置异常继续失败关闭，是与首次缺省默认开启相互独立的安全恢复边界。

## References

- [Feishu Channel v11](feishu-channel-v11.md)
- [飞书渠道架构](../architecture/feishu-channel.md)
- [渠道 UI](../ui/components/channel-settings.md)
- [v1.37 实施计划](../versions/v1.37/implementation-plan.md)
- [V1.37-D08](../versions/v1.37/decisions.md#v1-37-d08)
