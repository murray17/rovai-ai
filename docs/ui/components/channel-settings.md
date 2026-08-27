---
document_type: ui-component
component: channel-settings
authority: channel-settings-presentation-and-interaction
status: accepted
last_updated: 2026-08-27
---

# 渠道设置

渠道设置是主人在 Rovai 本机维护渠道连接、队员 Bot、ProjectBinding 与待绑定会话的唯一 Renderer surface。
领域状态和错误见 [Feishu Channel v1](../../contracts/feishu-channel-v1.md)；本页只拥有信息层级、交互与可访问性。

## 页面结构

页面沿用设置工作区的 Porcelain Day / Steel Night 世界和现有 `SettingsPageHeader`：

1. `Settings / Channels` eyebrow、标题“渠道”、主人本机说明；
2. 渠道 Provider 卡，当前只显示飞书；
3. 渠道连接，展示状态、账号与企业，提供连接/切换；
4. 队员 Bot 列表，按成员稳定顺序显示头像、名称、角色、发布状态和单行动作；
5. 项目绑定，展示主人登记的显示名、kind 与安全路径，提供新建、重命名和未使用项归档；
6. 会话绑定，先显示待绑定会话，再显示已经绑定的会话与 Camp 状态。

窄窗口保持同一内容顺序，表格式行折为纵向信息，不产生横向滚动。共享色彩只使用现有语义 Token；头像、按钮、
Dialog、状态点和间距复用现有组件语法。

## 渠道连接与二维码

未连接时主动作是“连接渠道”；已连接时为“切换连接”。说明必须明确：连接只决定以后发布的目标，切换不会迁移
或停用已发布 Bot。二维码使用 modal Dialog，包含阶段、二维码、过期/错误说明和取消；关闭 Dialog 必须取消 exact
attempt，迟到状态不再打开或更新 UI。

当前官方设备注册路径在发布单名队员时也会出现同一二维码 Dialog。列表和 Dialog 都必须说明一次只处理一名队员；
不得用假的自动进度掩盖仍需要主人的扫码确认。连接、发布与失败期间只禁用冲突动作，页面其余只读信息保持可用。

## 队员 Bot

只列出 `presence=present` 的 AgentProfile。状态文案固定对应：

| 状态 | 展示 | 动作 |
| --- | --- | --- |
| unpublished | 未发布 | 发布 |
| provisioning | 发布中 | 禁用当前行 |
| published | 已发布 | 管理 |
| failed | 发布失败 | 重试 |
| disabled | 已停用 | 重新发布 |

管理 Dialog 显示队员身份、Bot 名称和 App ID，并提供停用。停用不声称删除飞书开放平台应用或历史消息。Agent
头像只从现有 `MemberAvatar` 读取；渠道页不自行解析本机头像路径。

## ProjectBinding

“登记项目”Dialog 先选择 Quick Chat 或普通目录。普通目录必须通过 Main 的系统目录选择器取得；Renderer 不接收
任意路径文本。提交显示名、kind 和 canonical path，由 Core 返回新 Snapshot。重命名/归档使用 exact version；
冲突与 in-use 错误显示在页面级 inline alert，不乐观改行。

路径只对主人本机可见。飞书用户、二维码、卡片和渠道消息都不展示项目列表或路径。

## 会话绑定

待绑定行显示会话类型、显示名、最后发送者和最近出现时间；每行只提供一个本机 ProjectBinding picker 和“绑定”。
没有 active ProjectBinding 时显示空状态并引导主人先登记，不提供飞书用户申请入口。绑定成功不展示“正在执行旧消息”；
辅助文案明确要求发送者重新发送。

已绑定行显示会话、ProjectBinding 显示名与 `等待首条消息 | Camp 已建立`。切换 picker 属于主人主动切换，busy
错误保持原值。外部成员、sender allowlist 或授权用户列表不出现在任何状态。

## 状态、错误与键盘

- 首次读取使用页面内 status；无 Snapshot 时提供重试；已有 Snapshot 刷新失败保留旧内容并显示 alert；
- 所有异步操作使用稳定 busy key，防止双击；失败后恢复原动作；
- Dialog 使用 Radix focus trap、Escape/关闭、可见 label、描述和 footer actions；危险停用/归档与普通主动作分层；
- 状态不仅靠颜色，始终有文本；loading/failed 通过 `role=status/alert` 公布；
- Tab 顺序按页面视觉顺序，列表按钮和 select 均可键盘操作，焦点不因 Snapshot 更新跳到页面起点。

## References

- [全局设计系统](../../../DESIGN.md)
- [设置工作区 brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Feishu Channel v1](../../contracts/feishu-channel-v1.md)
- [飞书渠道架构](../../architecture/feishu-channel.md)
