---
document_type: version-overview
version: v1.30
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: true
last_updated: 2026-08-29
---

# Rovai-ai v1.30：飞书队员 Bot 与 Camp 渠道

> 当前状态：Core、Migration、Electron Host、Renderer 与本地自动化已完成账号/发布生命周期纠偏。连接只建立
> Developer Web Session；发布经同一 Session 以 template-first、App-ID durable freeze 和 activation-first 顺序直连
> 开放平台 console API，不显示二维码或飞书创建确认页；旧
> application registration 协议及其 API/交互已经退役。飞书消息入口已收敛为 Owner-only：私聊自动 Quick Chat，群/
> 话题首次有效 mention 通过原群或原 Topic 中的一张 Owner-only 卡冻结项目，成功后异步撤回。公开执行过程按 AgentRun 显示临时控制台，正式正文保持无标题
> Markdown，已发布图片/文件按原生附件独立投递。真实飞书租户的“连接不增 App、发布不弹确认页”仍是发布
> 环境验收项，不由本地自动化代替。

前置版本：[v1.29 Camp 动态队员管理](../v1.29/README.md)已按完成事实转为 historical。

## 版本目标

把每名 Rovai 队员发布为独立飞书 Bot，并让已验证 Owner 的私聊、普通群和话题群显式消息进入现有 Camp/Agent 执行链。
私聊自动创建 Quick Chat；群/话题从 Rovai 既有项目中首次选择一次并冻结到 Camp，外部成员不触发。多 Bot 入站先完整聚合，同一 Camp 的根
请求严格串行，公开结果通过可靠 Outbox 返回原会话。

## 交付范围

- Migration 113 建立基础渠道与 Context 22；Migration 114 新增真实 Developer Identity 与持久 publication intent，
  Migration 115 收紧队员 App 唯一状态机；Migration 116 把当前合同推进到
  `Data Contract v1.28 / projection schema 69`，新增 Owner identity/per-App mapping、Project Catalog、generation-aware
  conversation binding、PendingCampBinding/FIFO message 与 project-selection delivery；Migration 117/118 继续
  推进 Developer Session 与 Owner-only binding，Migration 119 升到 `Data Contract v1.32 / projection schema 73`，新增
  execution console identity、delivery priority 和原生附件 outbox。原会话 picker 复用既有 delivery kind 与 additive
  `send | update | recall` payload，无需新增 Migration。Migration 113 早期新增
  ProjectBinding、ExternalPrincipal、
  channel conversation/binding、Feishu account/member Bot、group roster、inbound aggregate、ChannelTurnRequest 和
  ChannelDelivery，并允许 ExternalPrincipal CampMessage author 与 ContextManifest/Formatter 22；
- 只有已连接开发者身份对应的 Owner 能触发；per-App identity 无法证明时 fail closed。Owner 消息仍是
  ExternalPrincipal，不获得 `local_user` 权限；Developer Session `tenantId` 与 event `tenant_key` 分属不同命名空间，
  发布/同 App reconciliation 在复核同一 Developer Identity 后，用各 App credential 读取自身不可变 `creator_id` 的
  App-scoped `open_id`，作为 `ownerOpenId` 随 Bot binding 原子冻结；入站只以本地 `(app_id, open_id)` 判断。个人版事件缺少
  `user_id` 不影响判断；解析未完成或映射冲突显示连接异常，不把首个发送者绑为 Owner，也不误报
  non-owner。首条 Owner 事件再冻结 event tenant key；后续身份或 tenant key 漂移 fail closed；non-owner 在 observation 前结束且不留下业务事实；
- 删除 Channel 人工 ProjectBinding/会话绑定。Core 从既有 directory Camp 投影 active Project Catalog；卡片只携带 opaque
  ID/显示名，canonical path 只在 Core，并在 Camp 创建时冻结；
- Owner 私聊第一条消息自动创建 Quick Chat generation/Camp；精确 `/new` 只支持私聊、保留旧 Camp、创建新 Camp，
  不产生 CampMessage/Turn/Run，活动根请求期间拒绝；
- 普通群一个长期 Camp、每个话题一个 Camp。首次 Owner mention finalize 后建立 PendingCampBinding 并冻结原消息；
  canonical mention 顺序第一个受管 Bot 在原群/原 Topic 发送一张项目卡。只有 callback envelope 证明为 Owner 且 App、
  external message ID、version 与 nonce 全部匹配时才能消费；选择后按 FIFO 通过统一 admission 自动处理并异步撤回，不能换绑；
- Feishu Host 用独立 Web Session 登录并展示真实 user/tenant；普通队员发布从同一 Electron Session 取得 console
  bootstrap，经 `OpenPlatformApiClient` 优先从固定模板创建应用，只有明确 non-creation rejection 才 fallback 一次
  self-build；App ID 在读取 Secret 或任何后续 mutation 前持久冻结。随后读取 Secret、启用 Bot 并先发布 `1.0.0`
  activation；Scope/Event/Callback/Manifest 初始状态并行读取，所需 mutation 按确定顺序一次提交，Manifest 最多读写一次；
  三类在线状态在一个 120 秒 deadline 中逐轮并行回读，配置有变化才发布下一 patch。Manifest 不再自证运行时 readiness；
  同次 final verify 复用 convergence evidence，并继续在线核验 Bot/version/头像，恢复时无可信 state 则完整回读。
  `card.action.trigger` 和 callback mode 4 是必需发布条件。之后保存 credential、Core
  upsert 与建立 WebSocket。旧 registration/确认/poll 实现及其 typed API/IPC/Renderer 入口已删除。Session Cookie 与独立 App credential
  分开加密；账号切换使用临时隔离 Session，成功前保留当前登录态，取消或失败不让当前账号失效。切换/断开不迁移、
  关闭或删除已发布 Bot，单连接故障隔离，重启恢复 published Bot 与 publication
  intent；release 错误后继续以 version detail 收敛。每名队员的首个 App ID 由 Core 状态机永久冻结；只有无可信 App
  ID 的 create outcome unknown 锁住重建，冻结后的 Event/Scope/Version/credential/连接失败均可恢复同一 App。完成、历史 disabled 恢复、凭据
  丢失和历史 unknown recovery 都只核对并恢复同一 App，不存在换绑或第二次创建；初始版本头像错误时在同一 App 发布幂等
  `1.0.1` 修复版本；已冻结 App 的在线接收配置不完整时只在原 App 发布下一 patch 修复版本；
- 私聊按 receiving App 隔离；普通群一个 Camp；话题按 canonical topic 一个 Camp。群/话题只有显式 mention
  published managed Bot 才进入 Core；
- 同一 external message 的第一条 observation 只进入 collecting；canonical mentions 完整或全部预期 App 到齐后
  才能独立 finalize，payload mismatch/timeout fail closed；
- 已绑定或 p2p finalize 创建持久 ChannelTurnRequest；未绑定 group/topic 只冻结 pending message。每个 Binding 只有一个
  admitted root，queued 请求不进入 Timeline、History、SHARED_CONVERSATION 或 AgentRun。提升复用本地用户路径的同一
  原子 admission；
- 任意飞书 reply 统一冻结为当前触发 CampMessage 的 Structured Content `ExternalQuote`，`replyTo=null`；不维护
  external-message reply projection，不提供 prompt override；
- Owner ExternalPrincipal 归并多 App identity，只投影 provider/displayName；原始飞书 ID 不进入 Agent。结构化
  CurrentUserMention 在群/话题输出为原生 mention；
- 父群 Bot roster 使用完整 `isInChat` 快照。普通群复用 v1.29 `camp.member.add/remove` 全量同步；话题只按 mention
  和 A2A exact need 加入，不污染历史话题；
- ChannelDelivery Outbox 为每个 AgentRun 提供可更新/召回的临时执行控制台；queue ack 只在真实排队时出现并在 admission
  后召回。实际作者 Bot 把正式 CampMessage 作为新的无标题 Markdown 永久发送，Managed Attachment v2 图片/文件按正文后
  ordinal 原生投递且各自重试；attention、lease、终态和重启恢复保持 durable。飞书失败不回滚已提交 CampMessage；
- Main 记录脱敏的 Bot 长连接、SDK policy、message normalized 与 handler accepted/rejected 分层诊断；不记录消息正文、
  Secret、Cookie 或完整外部 identity，当前 SDK 无 raw hook 时不虚构 raw-event 层；发布链路另记录成功/失败阶段与总耗时，
  App 只用 digest，Secret/Cookie/CSRF/Owner OpenID 不进入 timing；
- 设置页按 Rovai 现有 Porcelain/Steel 视觉只保留连接、队员 Bot、账号二维码、绑定诊断和错误状态；Owner identity
  只作为入站内部安全边界，首条可靠消息自动建立 App-scoped 映射，不展示需要 Owner 处理的核验状态；
  删除项目目录与会话绑定操作。已发布 Bot 只提供按绑定 brand 生成的官方应用详情链接，不再提供 Rovai 管理/停用入口；
  Renderer 不接触 Secret、路径或 Host-only transport facts。

## 非目标与诚实边界

- 不接入钉钉、Telegram 等其他渠道；
- 不让同一 Camp 多个根 CampTurn 并行，不从自由文本/普通 reply 推断 continuation；
- 不同步未 mention 群历史，不让 Bot 回推触发 A2A；
- 不在 Rovai 内提供远端应用关闭、停用或删除；Owner 通过官方开放平台应用详情页治理；
- 不把开放平台 console API 声称为公开稳定合同；页面 bootstrap 或 endpoint 变化必须在隔离 client 中 fail closed，
  不得静默回退到确认页或第二条创建路径；
- 普通发布上传 `AgentProfile.avatarRef` 对应的受控 icon rendition；只有无头像引用时使用 Rovai App icon。非空引用无法
  安全读取时 fail closed，不把路径交给 Renderer 或飞书；
- 入站消息附件仍只冻结名称/类型摘要，不下载为 Camp Attachment；只有已通过 Managed Attachment v2 正式发布并被公开
  CampMessage 引用的出站图片/文件可以回传，Runtime 临时路径不能直接发送；
- Core 没有权威公开 delta 时，飞书只显示处理中与最终已提交 CampMessage，不转发 Runtime 原始 stdout/推理。

## 模型上下文

[模型上下文变更说明](model-context-change-feishu-external-principal.md) revision 1 已由开发者确认。AgentRun Context
Formatter 与 ContextManifest 升到 22：Direct source 新增 ExternalPrincipal，Structured Content 新增
ExternalQuote 的确定性 agent projection。Bootstrap、Session Charter、section order、Profile 4、Run Facts 2、
预算、选择、A2A、Gather、附件和 accepted ACK 不变。

## 验收

实施与证据由[实施计划](implementation-plan.md)维护。仓库内完成门槛包括 v112→v119 与 v118→v119 升级、Developer Identity/
publication intent、template-first fallback 分类、App-ID durable barrier、activation-first、队员 App 身份冻结/历史 disabled
同 App 恢复、连接不注册 App、发布不产生 QR/飞书确认页、在线 Scope/Event/Callback 配置与回读、Manifest 假阳性回归、
identity drift/create outcome unknown fail-closed、frozen Event timeout recoverable、发布期 App-scoped Owner prebinding、owner/non-owner gate、DM `/new`、
PendingCampBinding authoritative picker/replay/CAS、原会话投递与 durable recall、旧 private picker 恢复、多 Bot 单卡与 fail-closed、FIFO promotion、普通群/话题 roster、ExternalQuote/Context bytes、safeStorage/Renderer
秘密隔离、execution console 更新/召回、永久 Markdown、原生附件顺序/独立失败、Host 恢复、双主题和完整
Rust/TypeScript/文档/构建门禁。真实飞书租户登录、应用创建、无平台确认发布
和收发仍需要拥有可用企业权限的 Owner 在发布环境执行，自动化不伪造外部成功。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)共同切换 `current_version`。 |
| Decisions | 已更新 | [v1.30 决定](decisions.md#v1-30-d12)冻结 Owner-only Camp、Quick Chat、原会话项目卡/异步撤回、聚合/统一 admission、ExternalQuote、roster、template/activation-first Provisioner、App-scoped Owner prebinding，以及临时执行控制台/永久输出/原生附件边界。 |
| Contracts | 已更新 | [Feishu Channel v2](../../contracts/feishu-channel-v2.md)成为当前渠道入口，v1 转为历史；[ContextManifest Evidence v22](../../contracts/context-manifest-evidence-v22.md)继续拥有 AgentRun 输入。 |
| Architecture | 已更新 | 新增[飞书渠道架构](../../architecture/feishu-channel.md)，连接 Renderer、Main Host、Core admission、Camp membership 与 Outbox 权威。 |
| UI | 已更新 | 新增[渠道设置](../../ui/components/channel-settings.md)，并更新 UI/component 索引；视觉继续使用现有 Porcelain Day / Steel Night。 |
| Runtime Activity | 确认无需更新 | 渠道只消费既有 AgentRun/Delivery/CampMessage 终态，不新增 Runtime activity kind 或 Adapter mapping。 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime command、Session、模型、权限、平台准入或实测支持矩阵。 |
| Documentation routing | 已更新 | 文档总入口、Architecture、Contracts、Decisions、UI 与版本索引都加入飞书渠道任务路由。 |
| Root README | 确认无需更新 | 飞书是当前版本的可选外部 surface，不改变 Rovai-ai 的常青项目定位或 Runtime 支持声明。 |
