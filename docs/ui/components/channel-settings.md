---
document_type: ui-component
component: channel-settings
authority: channel-settings-presentation-and-interaction
status: accepted
last_updated: 2026-08-28
---

# 渠道设置

渠道设置是主人在 Rovai 本机维护渠道连接与队员 Bot 的 Renderer surface。项目选择发生在 Owner 的飞书私聊卡片中；
Renderer 不提供 Channel 项目目录或会话绑定操作。
领域状态和错误见 [Feishu Channel v2](../../contracts/feishu-channel-v2.md)；本页只拥有信息层级、交互与可访问性。

## 页面结构

页面沿用设置工作区的 Porcelain Day / Steel Night 世界和现有 `SettingsPageHeader`：

1. `Settings / Channels` eyebrow、标题“渠道”、主人本机说明；
2. 渠道 Provider 卡，当前只显示飞书；
3. 渠道连接，展示真实开发者用户名、企业与可选 email，提供登录、切换和断开；
4. 队员 Bot 列表，按成员稳定顺序显示头像、名称、角色、发布状态和单行动作；
5. 只有存在 pending binding 或 binding error 时，显示安静的诊断计数，不提供正常操作入口。

窄窗口保持同一内容顺序，表格式行折为纵向信息，不产生横向滚动。共享色彩只使用现有语义 Token；头像、按钮、
Dialog、状态点和间距复用现有组件语法。

## 渠道连接与二维码

未连接时主动作是“登录开放平台”；已连接时为“切换账号”，并提供次级“断开”。连接行只展示真实 `userName`、
`tenantName`、可选 email 与 Feishu/Lark brand，不显示 controller App 或“飞书主人/飞书企业”占位值。说明必须明确：
连接只决定以后发布的目标，切换不会迁移或停用已发布 Bot。点击“切换账号”后，当前账号在新二维码成功完成前继续
有效；取消或失败关闭 Dialog 后仍显示原账号，不得降级为“登录已过期”。只有切换成功才展示新账号。

账号二维码使用 modal Dialog，标题“登录飞书开放平台”，并明确“本次不会创建应用、读取 App Secret 或发布 Bot”。
它展示 preparing、awaiting scan、scan confirmed、identity inspection、过期/错误和取消；关闭必须取消 exact attempt，
迟到状态不再打开或更新 UI。账号登录是产品中唯一的扫码流程；队员发布没有兼容扫码或平台 registration 确认入口。
账号登录在 preparing 前展示安全存储检查，在 identity inspection 后展示安全保存；两者必须使用不同文案，不能把
钥匙串等待描述成“读取账号”。安全存储拒绝、身份读取超时和页面失败使用中文可操作提示，不向用户显示 `unknown`
或原始异常文本。

普通发布不得进入 QR Dialog。点击列表“发布”先打开独立确认 Dialog，展示现有 `MemberAvatar`、队员名称/职责、
应用说明、当前开发者账号和租户；“确认发布”后在同一 Dialog 逐步展示八个进行中阶段。主文案固定为：

1. “正在校验发布账号…”；
2. 首次发布“正在创建独立应用…”，恢复时“正在核对已绑定应用…”；
3. “正在启用应用…”；
4. “正在配置权限和事件…”；
5. “正在等待配置生效…”；
6. “正在发布最终配置…”；
7. “正在核对在线配置…”；
8. “正在建立 Bot 长连接…”；

完成文案为“发布完成”。等待阶段须说明飞书控制面可能需要几十秒；在线配置核验与真正 WebSocket connect 不得合并成
同一阶段。若配置没有 mutation，可以跳过第 6 阶段，但不得伪造一次最终版本发布。普通发布不得打开飞书“创建飞书智能体应用 /
立即创建”页或其他平台确认窗口。Session 失效/身份漂移时显示“重新连接飞书”并停止发布，不存在其他发布流程。

若上次发布已冻结 App ID 并失败，主人再次点击“继续核对”沿用同一 Dialog 与进度语言，后台核对
并接管该 App；不显示新的创建确认，也不生成第二个 App。初始版本已发布但头像仍是旧 Rovai icon 时，同一流程可以显示
配置与发布阶段，把当前队员头像作为 `1.0.1` 修复版本发布到原 App；修复版本已 published 时只核对而不重复 mutation。
成功后依次进入在线配置核验、长连接与完成；失败继续显示原 App ID、可恢复说明和“继续核对”。只有 create 结果不明且
没有可信 App ID 时显示“远端创建结果待核对”，并隐藏重建入口。人类可行动说明是主要错误文案，固定 failure code 只在
终态作为次级诊断信息展示。

## 队员 Bot

只列出 `presence=present` 的 AgentProfile。状态文案固定对应：

| 状态 | 展示 | 动作 |
| --- | --- | --- |
| unpublished | 未发布 | 发布 |
| provisioning | 发布中 | 禁用当前行 |
| published | 已发布 | 飞书管理（官方应用详情链接） |
| failed，已有 App ID | 需处理 | 继续核对同一 App |
| failed，无 App ID | 需处理 / 远端创建结果待核对 | 安全失败可重试；true unknown 不提供重建入口 |
| disabled（历史数据状态） | 已停用 | 重新发布同一 App |

已发布行不打开 Rovai 管理 Dialog，也不提供停用命令。“飞书管理”是带可访问名称的外部链接，使用 Main 从该 Bot
绑定账号的 brand 与冻结 App ID 生成的精确 `managementUrl`，以 `_blank + noreferrer noopener` 交给 Electron 在系统
浏览器打开。链接不依赖当前 Developer Session 的连接状态；Renderer 不拼接或接受任意 URL。关闭、停用、删除等
远端应用治理只在官方开放平台完成。

重新发布 Dialog 必须显示已经冻结的 App ID，明确“不会创建或换绑其他应用”；进度中的创建阶段改为“正在核对已绑定应用…”。Renderer
头像只从现有 `MemberAvatar` 读取；发布时 Main 独立解析同一个受控 `avatarRef` 并上传 exact icon rendition，渠道页不
解析或接收本机头像路径。非空头像引用无法安全读取时，发布失败而不是展示或上传另一身份。

## Owner identity 与绑定诊断

Owner identity 是入站安全边界，不是主人需要处理的产品状态。Renderer 不展示“主人身份待核验”、核验按钮或任何
per-App identity 状态。已连接 Developer Identity 已确定 canonical Owner；首条携带匹配 tenant user identity 的可靠
message/callback envelope 会在同一入站流程自动记录 App-scoped identity 并继续处理。映射缺失或冲突时由 Host/Core
内部 fail closed，不能把用户名、群管理员身份或卡片 payload 当成 Owner 证据。

页面可在 Provider 卡底部显示 `待处理项目选择 N` 与 `绑定异常 N` 两个低强调诊断值；零值可省略。它们只帮助主人
理解当前渠道状态，不展开项目列表、路径、会话 picker 或 resolve 操作。正常流程是 Owner 私聊自动 Quick Chat，或群/
话题第一次有效 mention 后在飞书私聊卡片中选择项目。

## 状态、错误与键盘

- 首次读取使用页面内 status；无 Snapshot 时提供重试；已有 Snapshot 刷新失败保留旧内容并显示 alert；
- 所有异步操作使用稳定 busy key，防止双击；失败后恢复原动作；
- Dialog 使用 Radix focus trap、Escape/关闭、可见 label、描述和 footer actions；
- 状态不仅靠颜色，始终有文本；loading/failed 通过 `role=status/alert` 公布；
- Tab 顺序按页面视觉顺序，链接和按钮均可键盘操作，焦点不因 Snapshot 更新跳到页面起点。

## References

- [全局设计系统](../../../DESIGN.md)
- [设置工作区 brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Feishu Channel v2](../../contracts/feishu-channel-v2.md)
- [飞书渠道架构](../../architecture/feishu-channel.md)
