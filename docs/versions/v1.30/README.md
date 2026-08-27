---
document_type: version-overview
version: v1.30
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: true
last_updated: 2026-08-27
---

# Rovai-ai v1.30：飞书队员 Bot 与 Camp 渠道

> 当前状态：Core、Migration、Electron Host、Renderer、自动化和隔离 Desktop 视觉验收均已完成。当前采用飞书
> 官方 SDK 的单应用设备注册，因此连接与每名队员发布分别需要一次二维码确认；未实现、不伪装未公开的开放
> 平台后台 Cookie 自动化。

前置版本：[v1.29 Camp 动态队员管理](../v1.29/README.md)已按完成事实转为 historical。

## 版本目标

把每名 Rovai 队员发布为独立飞书 Bot，并让私聊、普通群和话题群的显式消息进入现有 Camp/Agent 执行链。只有
主人能在本机维护项目路径和会话绑定；外部成员只作为消息 Principal。多 Bot 入站先完整聚合，同一 Camp 的根
请求严格串行，公开结果通过可靠 Outbox 返回原会话。

## 交付范围

- Migration 113 建立 `Data Contract v1.26 / projection schema 67`，新增 ProjectBinding、ExternalPrincipal、
  channel conversation/binding、Feishu account/member Bot、group roster、inbound aggregate、ChannelTurnRequest 和
  ChannelDelivery，并允许 ExternalPrincipal CampMessage author 与 ContextManifest/Formatter 22；
- ProjectBinding 使用 opaque ID、显示名、kind、canonical path、status/version，只有 `local_user` 能维护或绑定；
  Camp 创建时解析并冻结既有 workspace kind/path；
- 未绑定消息只记录本地待绑定会话与 TTL transport facts，不建立 Principal、CampMessage、CampTurn 或 Run；绑定
  不回放旧消息，发送者必须重新发送；
- Feishu Host 使用官方注册二维码、安全存储、独立 App credential 与多 WebSocket registry；账号切换不迁移或
  停用已发布 Bot，单连接故障隔离，重启恢复 published Bot；
- 私聊按 receiving App 隔离；普通群一个 Camp；话题按 canonical topic 一个 Camp。群/话题只有显式 mention
  published managed Bot 才进入 Core；
- 同一 external message 的第一条 observation 只进入 collecting；canonical mentions 完整或全部预期 App 到齐后
  才能独立 finalize，payload mismatch/timeout fail closed；
- Finalize 创建持久 ChannelTurnRequest；每个 Binding 只有一个 admitted root，queued 请求不进入 Timeline、
  History、SHARED_CONVERSATION 或 AgentRun。提升复用本地用户路径的同一原子 admission；
- 任意飞书 reply 统一冻结为当前触发 CampMessage 的 Structured Content `ExternalQuote`，`replyTo=null`；不维护
  external-message reply projection，不提供 prompt override；
- ExternalPrincipal 归并多 App identity，只投影 provider/displayName；原始飞书 ID 不进入 Agent。结构化
  CurrentUserMention 在群/话题输出为原生 mention；
- 父群 Bot roster 使用完整 `isInChat` 快照。普通群复用 v1.29 `camp.member.add/remove` 全量同步；话题只按 mention
  和 A2A exact need 加入，不污染历史话题；
- ChannelDelivery Outbox 提供唯一状态卡、admitted 原位更新、实际作者 Bot 输出、attention、lease、retry、终态和
  重启恢复。飞书失败不回滚已提交 CampMessage；
- 设置页按 Rovai 现有 Porcelain/Steel 视觉实现连接、队员 Bot、项目绑定、待绑定/已绑定会话、二维码、管理和错误
  状态；Renderer 不接触 Secret 或 Host-only transport facts。

## 非目标与诚实边界

- 不接入钉钉、Telegram 等其他渠道；
- 不让同一 Camp 多个根 CampTurn 并行，不从自由文本/普通 reply 推断 continuation；
- 不同步未 mention 群历史，不让 Bot 回推触发 A2A；
- 不自动删除飞书开放平台应用；停用只关闭 Rovai 绑定与本地 credential；
- 不使用未公开的开放平台后台 Cookie/CSRF 接口模拟“一次扫码创建多个应用”；
- 官方设备注册只预填 Bot 名称和描述；Rovai 本地受控头像不上传到公网，实际头像由主人在飞书确认页确认；
- 当前消息附件一期只冻结名称/类型摘要，不下载为 Camp Attachment；公开输出附件也不回传图片/文件，Outbox
  只发送状态卡、文本和卡片；
- Core 没有权威公开 delta 时，飞书只显示处理中与最终已提交 CampMessage，不转发 Runtime 原始 stdout/推理。

## 模型上下文

[模型上下文变更说明](model-context-change-feishu-external-principal.md) revision 1 已由开发者确认。AgentRun Context
Formatter 与 ContextManifest 升到 22：Direct source 新增 ExternalPrincipal，Structured Content 新增
ExternalQuote 的确定性 agent projection。Bootstrap、Session Charter、section order、Profile 4、Run Facts 2、
预算、选择、A2A、Gather、附件和 accepted ACK 不变。

## 验收

实施与证据由[实施计划](implementation-plan.md)维护。仓库内完成门槛已通过，包括 v112→v113 升级、owner-only/未绑定负向、
multi-Bot fail-closed、FIFO promotion、普通群/话题 roster、ExternalQuote/Context bytes、safeStorage/Renderer
秘密隔离、Host 恢复、双主题和完整 Rust/TypeScript/文档/构建门禁。真实飞书租户扫码、应用创建和收发仍需要拥有
可用企业权限的主人在发布环境执行，自动化不伪造外部成功。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)共同切换 `current_version`。 |
| Decisions | 已更新 | [v1.30 决定](decisions.md)冻结 owner-only Binding、聚合/统一 admission、ExternalQuote、roster 复用及 Main/Outbox/官方注册边界。 |
| Contracts | 已更新 | 新增 [Feishu Channel v1](../../contracts/feishu-channel-v1.md)，并把 [ContextManifest Evidence v22](../../contracts/context-manifest-evidence-v22.md)设为新 AgentRun 当前入口。 |
| Architecture | 已更新 | 新增[飞书渠道架构](../../architecture/feishu-channel.md)，连接 Renderer、Main Host、Core admission、Camp membership 与 Outbox 权威。 |
| UI | 已更新 | 新增[渠道设置](../../ui/components/channel-settings.md)，并更新 UI/component 索引；视觉继续使用现有 Porcelain Day / Steel Night。 |
| Runtime Activity | 确认无需更新 | 渠道只消费既有 AgentRun/Delivery/CampMessage 终态，不新增 Runtime activity kind 或 Adapter mapping。 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime command、Session、模型、权限、平台准入或实测支持矩阵。 |
| Documentation routing | 已更新 | 文档总入口、Architecture、Contracts、Decisions、UI 与版本索引都加入飞书渠道任务路由。 |
| Root README | 确认无需更新 | 飞书是当前版本的可选外部 surface，不改变 Rovai-ai 的常青项目定位或 Runtime 支持声明。 |
