---
document_type: version-overview
version: v1.31
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-30
---

# Rovai-ai v1.31：钉钉队员 Bot 与 Camp 渠道

> 当前状态：Migration、Core、Electron Main 直接 OAuth/Developer API、Renderer、每 App Stream 与本地自动化已经实现。
> 真实钉钉租户的 OAuth、应用创建/审批/发布、AI 卡片 callback、私聊和群聊收发仍需外部验收。生产包还没有可安全
> 分发的 Rovai OAuth Client 方案；缺少显式注入的 Client ID/Secret 时连接按合同失败，不复用上游工具内置身份。

前置版本：[v1.30 飞书队员 Bot 与 Camp 渠道](../v1.30/README.md)已按完成事实转为 historical。

## 版本目标

在不复制 Camp 业务链的前提下接入钉钉。每名在场 Rovai 队员可发布为一个独立内部应用机器人；已连接账号对应的
Owner 可在私聊或群聊显式 `@Bot` 后复用现有 Quick Chat、项目选择、原子 admission、Camp Membership、执行控制台
和永久输出。设置页以飞书既有信息层级增加 Provider Tab，同时保持各 Provider 的账号、Bot、秘密和诊断隔离。

## 交付范围

- Migration 122 增加 DingTalk account、Owner identity、publication intent、member Bot 与 per-App Owner identity，并建立
  provider-neutral Bot/Owner directory view；Migration 123 把旧 helper 发布模式无损迁移为 `direct_open_platform`，将 Data
  Contract 升到 `v1.36 / projection schema 77`；Migration 124 增加共享 `channel_credentials` 与
  `channel_developer_sessions`，切换到 `v1.37 / projection schema 78`；
- 账号连接使用预注册 Rovai OAuth Client，经 Main 的浏览器 loopback 或显式设备授权进入临时 Profile。新身份与 Token/Cookie
  通过 Core 原子 `account.commitConnection` 一次写入 `rovai.sqlite`；失败只丢弃临时 Profile，旧账号与 Session 不变；
- 飞书/钉钉 Bot credential 与 Developer Session 明文存入既有 SQLite，由 Core/Main 独占；Renderer/日志/诊断不接收 raw
  payload。启动一次批量加载所有 published Bot，旧 `.bin` 不读取、不解密，系统安全存储与 Keychain 命名空间已移除；
- Main 直接调用钉钉固定 OAuth 与官方 developer service endpoint，只允许封闭 operation/argument 集，并限制 redirect、
  response size、timeout 与取消；Token/Secret 不进入 URL、Core、Renderer、日志或命令行。包体不含 DWS binary/压缩载荷，
  不再需要版本/SHA、重签排除、物化目录、subprocess 生命周期和 stdout/stderr 解析；
- 每个 Agent 只有一个 immutable `unifiedAppId + appKey + robotCode`。发布状态机冻结远端身份后读取 credential、上传队员
  头像、配置 Stream robot、消息/群 roster/AI 卡片最小权限、事件、版本和审批，最后分别验证 Stream 与 AI 卡片；创建结果不明且
  没有 App ID 时锁住自动重试，已冻结 App 的失败只能在原 App 恢复；
- `SELECT_APPROVER` 必须由 Owner 在 Rovai 发布 Dialog 中显式选择审批人；等待审批不是失败，也不伪造已发布；
- 每个 App 一个 `dingtalk-stream` Client，注册 Robot 与 Card callback topic。回调先 ACK，再进入异步 Main/Core 处理；
- 入站仅支持私聊和普通群。只有 Owner 私聊或 Owner 在群内显式 `@Bot` 才进入 Core；精确 `/new` 只支持私聊。话题字段
  一律 fail closed；非 Owner 群消息静默忽略，非 Owner 私聊提示按人/App 24 小时限流；
- 普通群首次消息在原群发送项目卡；项目绑定后不可换绑。第一条有效请求及后续根请求复用 provider-neutral
  ExternalPrincipal、ExternalQuote、ChannelTurnRequest、单根 FIFO 和统一原子 admission；
- 群 roster 从钉钉当前群机器人列表读取并与已发布 Rovai Bot 交集后同步到既有 Camp Membership；运行中 Run 不被修改；
- AI 卡片固定模板 `382e4302-551d-4880-bf29-a30acfab2e71.schema`、`callbackType=STREAM` 且禁止转发。执行控制台只展示
  Core 公开安全投影，不传 command stdout/stderr、工具 JSON 或推理；正式结果使用 Markdown；
- 设置页增加飞书/钉钉 Tab、OAuth/设备授权、队员发布、审批人选择、官方应用管理链接和 Provider-local 绑定诊断。

## 保守能力边界

- 同一钉钉消息直接 `@` 多个 Bot 的完整 canonical mapping 尚无真实租户证据；普通群只在 `isInAtList` 且 bounded canonical
  `atUsers` 恰好证明一个直接目标时进入 3 秒观察窗。缺失、歧义、多个条目或多个 receiving App 均整条 fail closed，不启动
  先到的部分 Agent。单 Bot 后续协作通过 Rovai Core A2A；不得把它宣称为多 Bot 直接 admission；
- 钉钉话题/独立话题群均未接入；任何 topic/thread identity 出现都拒绝，不降级为普通群；
- 入站附件只形成名称/媒体类型摘要。出站附件尚无已验证的 app-only 官方投递路径，当前明确失败为
  `dingtalk_attachment_delivery_not_supported`，不得伪造发送成功；
- 本地 `card_verified` 只证明官方模板实例创建 API 成功；卡片投递、callback 和翻页仍属于真实租户验收；
- 生产 OAuth Client 需要 public-client/device-flow 或服务端 token broker 决策。当前开发入口仅接受
  `ROVAI_DINGTALK_OAUTH_CLIENT_ID` 与 `ROVAI_DINGTALK_OAUTH_CLIENT_SECRET` 的显式安全注入。

## 验收

仓库内门槛包括 Migration 122/123/124、状态机不可换绑、credential/intent 与 account/Session 原子提交、批量启动、create unknown、审批选择、OAuth/Developer API Token 与参数边界、staged 账号切换、
Stream fast ACK、入站 normalize/topic 拒绝、Owner gate、统一 admission、roster、卡片参数、Provider UI、Rust/TypeScript、
文档和 Desktop 构建。外部门槛包括真实 OAuth、连接不创建应用、连续发布不重复 OAuth、应用审批/发布、头像、Stream、
私聊、群聊、项目卡 callback、执行卡翻页和重启恢复。外部证据完成前本版本保持 `in_progress`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)共同切换 `current_version`，v1.30 冻结为 historical。 |
| Decisions | 已更新 | [v1.31 决定](decisions.md)记录 Main 直接拥有 OAuth/Developer API、provider-neutral Core 复用和未实测能力 fail-closed 的高成本取舍。 |
| Contracts | 已更新 | [DingTalk Channel v2](../../contracts/dingtalk-channel-v2.md)接管直接 OAuth/Developer API；[Channel Storage v1](../../contracts/channel-storage-v1.md)接管共享 SQLite credential/Session 与 Migration 124；DingTalk v1 冻结为历史合同。 |
| Architecture | 已更新 | 新增[钉钉渠道架构](../../architecture/dingtalk-channel.md)，并更新架构索引。 |
| UI | 已更新 | [渠道设置](../../ui/components/channel-settings.md)增加 Provider Tab、钉钉 OAuth/审批/发布与 Provider-local 诊断合同。 |
| Runtime Activity | 确认无需更新 | 钉钉继续消费既有公开 AgentRun Evidence 和 CampMessage，不新增 Runtime activity kind 或 Adapter mapping。 |
| Runtime compatibility | 确认无需更新 | 不改变 Product Runtime command、Session、模型、权限、平台准入或实测支持矩阵。 |
| Documentation routing | 已更新 | 文档总入口、Architecture、Contracts、Decisions、UI、Development 与版本索引加入钉钉任务入口。 |
| Root README | 确认无需更新 | 钉钉是可选外部渠道，不改变 Rovai-ai 常青定位或 Runtime 支持声明；外部验收未完成也不应写入根能力宣称。 |
