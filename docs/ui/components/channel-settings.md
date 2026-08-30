---
document_type: ui-component
component: channel-settings
authority: channel-settings-presentation-and-interaction
status: accepted
last_updated: 2026-08-30
---

# 渠道设置

渠道设置是 Owner 在 Rovai 本机维护飞书/钉钉连接与队员 Bot 的 Renderer surface。群首次项目选择发生在对应外部会话的
Owner-only 卡片中；Renderer 不提供 Channel 项目目录或会话绑定操作。领域状态和错误按 Provider 分别见
[Feishu Channel v5](../../contracts/feishu-channel-v5.md)与
[DingTalk Channel v3](../../contracts/dingtalk-channel-v3.md)；本页只拥有信息层级、交互与可访问性。

## 页面结构

页面沿用设置工作区的 Porcelain Day / Steel Night 世界和现有 `SettingsPageHeader`：

1. `Settings / Channels` eyebrow、标题“渠道”、Owner 本机说明；
2. 飞书/钉钉 Provider Tab；切换只改变当前展示，不合并账号、Bot 状态或诊断；
3. 当前 Provider 的渠道连接，展示真实开发者用户名、企业与可选 email，提供登录、切换和断开；
4. 队员 Bot 列表，按成员稳定顺序显示头像、名称、角色、发布状态和单行动作；
5. 只有存在 pending binding 或 binding error 时，显示安静的诊断计数，不提供正常操作入口。

窄窗口保持同一内容顺序，表格式行折为纵向信息，不产生横向滚动。共享色彩只使用现有语义 Token；头像、按钮、
Dialog、状态点和间距复用现有组件语法。

<a id="渠道连接与二维码"></a>
## 渠道连接与 OAuth

飞书未连接时主动作是“登录开放平台”，已连接时为“切换账号”；钉钉为“连接钉钉／重新连接”。已连接时均保留次级“断开”。连接行只展示真实 `userName`、
`tenantName`、可选 email 与 Feishu/Lark/DingTalk brand，不显示 controller App 或“平台 Owner/企业”占位值。说明必须明确：
连接只决定以后发布的目标，切换不会迁移或停用已发布 Bot。点击“切换账号”后，当前账号在新二维码成功完成前继续
有效；取消或失败关闭 Dialog 后仍显示原账号，不得降级为“登录已过期”。只有切换成功才展示新账号。

飞书账号二维码使用 modal Dialog，标题“登录飞书开放平台”，并明确“本次不会创建应用、读取 App Secret 或发布 Bot”。
它展示 preparing、awaiting scan、scan confirmed、identity inspection 和过期/错误；关闭必须取消 exact attempt，
迟到状态不再打开或更新 UI。用户取消是成功的 no-op：Dialog 立即关闭，不形成 failed state、页面 alert 或 toast。账号登录
是产品中唯一的扫码流程；队员发布没有兼容扫码或平台 registration 确认入口。
账号登录在 preparing 前展示 `loading_local_session`（“正在读取 Rovai 本地渠道数据…”），identity inspection 后展示
`saving_local_session`（“身份读取完成，正在保存开发者会话…”）。页面不得出现系统安全存储、钥匙串、加密授权或
`system_credential_encryption_unavailable`；身份读取超时和页面失败使用中文可操作提示，不向用户显示 `unknown` 或原始异常文本。
连接行统一说明“开发者账号会话 · 保存在 Rovai 本地数据库”。

钉钉使用同一个 modal 结构，只打开系统浏览器 OAuth，frame 只显示钉钉标记和当前阶段，不伪造二维码。未连接时为
“连接钉钉”，已连接或明确失效时为“重新连接”；进行中显示“等待授权…”。设备授权按钮、提示、等待状态和备用入口均删除。
说明 OAuth Profile 保存在 Rovai 本地数据库，本次不创建应用或读取 AppSecret。重启复用既有 Profile，Token 静默续期
不打开 Dialog；只有明确失效才显示“登录已失效，请重新连接”。取消浏览器授权是无告警的 no-op；网络、超时、存储或新
OAuth/Core commit 失败保留旧账号。缺少 Rovai OAuth Client 时显示可行动配置错误，不静默改用第三方工具的 Client 或队员 AppKey。

普通发布不得进入 QR Dialog。点击列表“发布”先打开独立确认 Dialog，展示现有 `MemberAvatar`、队员名称/职责、
应用说明、当前开发者账号和租户；“确认发布”后在同一 Dialog 逐步展示八个进行中阶段。主文案固定为：

1. “正在校验发布账号…”；
2. 首次发布“正在创建独立应用…”，恢复时“正在核对已绑定应用…”；
3. “正在启用应用…”；
4. “正在读取并提交配置…”；
5. “正在等待配置生效…”；
6. “正在发布最终配置…”；
7. “正在确认 Bot 与版本…”；
8. “正在建立 Bot 长连接…”；

完成文案为“发布完成”。配置阶段说明 Rovai 正在读取当前配置并提交所需权限、事件与回调变更；等待阶段须说明平台控制面可能需要时间；
最终核验只描述 Bot、发布版本和应用资料，不声称重新读取已经由同次 convergence 证明的权限与事件。在线配置核验与真正 WebSocket connect 不得合并成
同一阶段。若配置没有 mutation，可以跳过第 6 阶段，但不得伪造一次最终版本发布。普通发布不得打开平台应用创建确认
窗口。Session 失效/身份漂移时显示“重新连接飞书/钉钉”并停止发布，不存在其他发布流程。

钉钉远端要求 `SELECT_APPROVER` 时，同一发布 Dialog 在 `waiting_configuration` 阶段显示“版本审批人”下拉框。候选人只
来自当前远端返回的 bounded 列表；Owner 必须明确选择并点击“提交审批并继续发布”，Rovai 不自动选择第一人。提交后仍在
审核时显示等待说明和原 App ID，关闭 Dialog 不撤销远端审批，也不把 waiting 状态报成失败。

若上次发布已冻结 App ID 并失败，Owner 再次点击“继续核对”沿用同一 Dialog 与进度语言，后台核对
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
| published | 已发布 | 当前 Provider 管理（官方应用详情链接） |
| failed，已有 App ID | 需处理 | 继续核对同一 App |
| failed，无 App ID | 需处理 / 远端创建结果待核对 | 安全失败可重试；true unknown 不提供重建入口 |
| disabled（历史数据状态） | 已停用 | 重新发布同一 App |

已发布行不打开 Rovai 管理 Dialog，也不提供停用命令。“飞书管理”或“钉钉管理”是带可访问名称的外部链接，使用 Main
从该 Bot 绑定账号与冻结 App ID 生成的精确 `managementUrl`，以 `_blank + noreferrer noopener` 交给 Electron 在系统
浏览器打开。链接不依赖当前 Developer Session 的连接状态；Renderer 不拼接或接受任意 URL。关闭、停用、删除等
远端应用治理只在官方开放平台完成。

重新发布 Dialog 必须显示已经冻结的 App ID，明确“不会创建或换绑其他应用”；进度中的创建阶段改为“正在核对已绑定应用…”。Renderer
头像只从现有 `MemberAvatar` 读取；发布时 Main 独立解析同一个受控 `avatarRef` 并上传 exact icon rendition，渠道页不
解析或接收本机头像路径。非空头像引用无法安全读取时，发布失败而不是展示或上传另一身份。

## Owner identity 与绑定诊断

Owner identity 是入站安全边界，不是 Owner 需要处理的产品状态。Renderer 不展示“Owner 身份待核验”、核验按钮或任何
per-App identity 状态。已连接 Developer Identity 已确定 canonical Owner；首条携带匹配 tenant user identity 的可靠
message/callback envelope 会在同一入站流程自动记录 App-scoped identity 并继续处理。映射缺失或冲突时由 Host/Core
内部 fail closed，不能把用户名、群管理员身份或卡片 payload 当成 Owner 证据。

页面可在 Provider 卡底部显示 `待处理项目选择 N` 与 `绑定异常 N` 两个低强调诊断值；零值可省略。它们只帮助 Owner
理解当前 Provider 状态，不把另一 Provider 的计数相加到当前 Tab，也不展开项目列表、路径、会话 picker 或 resolve 操作。
正常流程是 Owner 私聊自动 Quick Chat，或飞书群/话题、钉钉普通群第一次有效 mention 后在对应卡片中选择项目；钉钉话题
当前不接入。

项目卡沿用 Rovai 克制、信息先行的表达：标题为“选择 Rovai 项目”，正文按普通群/Topic 明确选择作用域；选项只显示
bounded project display name，提供绑定动作与“刷新项目”，不提供换绑入口。卡片不得显示 canonical path、外部 identity、
credential 或内部错误。钉钉卡固定使用官方 AI Markdown 模板、Stream callback 且禁止转发。

只有 Owner 点击会消费卡片；Non-owner 只看到“仅 Rovai Owner 可以选择项目”私有 toast，公共卡不变化。项目失效时显示
“该项目已不可用，请重新选择”并刷新原卡；旧卡/双击显示“该项目选择已完成或卡片已过期”。成功只显示短暂
“项目已绑定，正在处理消息”反馈，Core 随后异步撤回卡片，不留下永久完成卡。

## 飞书执行卡

飞书外部执行卡沿用原生执行台的阅读顺序：公开文字与 command 混排。执行中没有折叠容器；终态把完整 timeline 放进
默认收起的“执行过程 · N 条”原生面板。每条 command 自带第二层原生折叠，安全命令/flags/路径在 header，展开后只有
一个结果代码框，无二级标题。两层展开/收起都不请求 Rovai；永久 Markdown 正文仍独立显示。
文字最多 10 行，长文为前 9 行加截断提示；安全结果最多 20 行和 4KiB，长结果显示前 9 / 截断提示 / 后 10。
多页才在总面板内出现页码和上一页/下一页；翻页后总面板展开，单条 command 收起，包括返回第 1 页。
成功翻页无 Toast；可响应的超时/服务不可用返回清晰的错误 Toast，完全离线时由飞书提示平台错误，不承诺自定义文案。
安全、预算、封存与 callback 约束由 [Feishu Channel v5](../../contracts/feishu-channel-v5.md) 拥有，不增加 Renderer 设置或视图状态。

## 状态、错误与键盘

- 首次读取使用页面内 status；无 Snapshot 时提供重试；已有 Snapshot 刷新失败保留旧内容并显示 alert；
- 所有异步操作使用稳定 busy key，防止双击；失败后恢复原动作；
- Dialog 使用 Radix focus trap、Escape/关闭、可见 label、描述和 footer actions；
- 状态不仅靠颜色，始终有文本；loading/failed 通过 `role=status/alert` 公布；
- Tab 顺序按页面视觉顺序，链接和按钮均可键盘操作，焦点不因 Snapshot 更新跳到页面起点。

## References

- [全局设计系统](../../../DESIGN.md)
- [设置工作区 brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Feishu Channel v5](../../contracts/feishu-channel-v5.md)
- [飞书渠道架构](../../architecture/feishu-channel.md)
- [DingTalk Channel v3](../../contracts/dingtalk-channel-v3.md)
- [钉钉渠道架构](../../architecture/dingtalk-channel.md)
