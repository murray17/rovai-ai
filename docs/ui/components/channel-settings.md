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
3. 渠道连接，展示真实开发者用户名、企业与可选 email，提供登录、切换和断开；
4. 队员 Bot 列表，按成员稳定顺序显示头像、名称、角色、发布状态和单行动作；
5. 项目绑定，展示主人登记的显示名、kind 与安全路径，提供新建、重命名和未使用项归档；
6. 会话绑定，先显示待绑定会话，再显示已经绑定的会话与 Camp 状态。

窄窗口保持同一内容顺序，表格式行折为纵向信息，不产生横向滚动。共享色彩只使用现有语义 Token；头像、按钮、
Dialog、状态点和间距复用现有组件语法。

## 渠道连接与二维码

未连接时主动作是“登录开放平台”；已连接时为“切换账号”，并提供次级“断开”。连接行只展示真实 `userName`、
`tenantName`、可选 email 与 Feishu/Lark brand，不显示 controller App 或“飞书主人/飞书企业”占位值。说明必须明确：
连接只决定以后发布的目标，切换不会迁移或停用已发布 Bot。

账号二维码使用 modal Dialog，标题“登录飞书开放平台”，并明确“本次不会创建应用、读取 App Secret 或发布 Bot”。
它展示 preparing、awaiting scan、scan confirmed、identity inspection、过期/错误和取消；关闭必须取消 exact attempt，
迟到状态不再打开或更新 UI。账号登录是产品中唯一的扫码流程；队员发布没有兼容扫码或平台 registration 确认入口。
账号登录在 preparing 前展示安全存储检查，在 identity inspection 后展示安全保存；两者必须使用不同文案，不能把
钥匙串等待描述成“读取账号”。安全存储拒绝、身份读取超时和页面失败使用中文可操作提示，不向用户显示 `unknown`
或原始异常文本。

普通发布不得进入 QR Dialog。点击列表“发布”先打开独立确认 Dialog，展示现有 `MemberAvatar`、队员名称/职责、
应用说明、当前开发者账号和租户；“确认发布”后在同一 Dialog 逐步展示账号校验、创建应用、配置 Bot、权限/事件、
发布版本、验证连接与完成。阶段主文案固定为“正在校验飞书账号… / 正在创建应用… / 正在配置 Bot… /
正在配置权限和事件… / 正在发布版本… / 正在验证连接… / 发布完成”。普通发布不得打开飞书“创建飞书智能体应用 /
立即创建”页或其他平台确认窗口。Session 失效/身份漂移时显示“重新连接飞书”并停止发布，不存在其他发布流程。

若上次发布已冻结 App ID 但落入“远端状态待核对”，主人再次点击普通“发布”沿用同一 Dialog 与进度语言，后台核对
并接管该 App；不显示新的创建确认，也不生成第二个 App。初始版本已发布但头像仍是旧 Rovai icon 时，同一流程可以显示
配置与发布阶段，把当前队员头像作为 `1.0.1` 修复版本发布到原 App；修复版本已 published 时只核对而不重复 mutation。
成功后进入“正在验证连接…”与“发布完成”；失败则继续显示待核对及原 App ID。

## 队员 Bot

只列出 `presence=present` 的 AgentProfile。状态文案固定对应：

| 状态 | 展示 | 动作 |
| --- | --- | --- |
| unpublished | 未发布 | 发布 |
| provisioning | 发布中 | 禁用当前行 |
| published | 已发布 | 飞书管理（官方应用详情链接） |
| failed | 发布失败 / 远端状态待核对 | 重试或核对同一 App |
| disabled（历史数据状态） | 已停用 | 重新发布同一 App |

已发布行不打开 Rovai 管理 Dialog，也不提供停用命令。“飞书管理”是带可访问名称的外部链接，使用 Main 从该 Bot
绑定账号的 brand 与冻结 App ID 生成的精确 `managementUrl`，以 `_blank + noreferrer noopener` 交给 Electron 在系统
浏览器打开。链接不依赖当前 Developer Session 的连接状态；Renderer 不拼接或接受任意 URL。关闭、停用、删除等
远端应用治理只在官方开放平台完成。

重新发布 Dialog 必须显示已经冻结的 App ID，明确“不会创建或换绑其他应用”；进度中的创建阶段改为“正在核对应用…”。Renderer
头像只从现有 `MemberAvatar` 读取；发布时 Main 独立解析同一个受控 `avatarRef` 并上传 exact icon rendition，渠道页不
解析或接收本机头像路径。非空头像引用无法安全读取时，发布失败而不是展示或上传另一身份。

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
- Dialog 使用 Radix focus trap、Escape/关闭、可见 label、描述和 footer actions；危险归档与普通主动作分层；
- 状态不仅靠颜色，始终有文本；loading/failed 通过 `role=status/alert` 公布；
- Tab 顺序按页面视觉顺序，列表按钮和 select 均可键盘操作，焦点不因 Snapshot 更新跳到页面起点。

## References

- [全局设计系统](../../../DESIGN.md)
- [设置工作区 brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Feishu Channel v1](../../contracts/feishu-channel-v1.md)
- [飞书渠道架构](../../architecture/feishu-channel.md)
