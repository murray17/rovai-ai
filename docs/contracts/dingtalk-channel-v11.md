---
document_type: protocol-contract
contract: dingtalk-channel-v11
authority: dingtalk-channel-inbound-aggregation-permanent-output-diagnostics
status: accepted
version: 11
source_version: v1.38
last_updated: 2026-09-02
---

# DingTalk Channel v11 Contract

继承 [DingTalk Channel v10](dingtalk-channel-v10.md) 的账号、发布、普通内部群准入、AI Card 双身份、执行卡、
排队卡和真实 Robot recall。本版取消同消息多 Bot 的整条 fail closed，增加 credential-bound callback 的 durable
聚合与重启封口；永久 Markdown 增加直接父消息摘要；Snapshot 增加不含正文、身份或凭据的聚合/卡片诊断计数。
不新增 Migration，Renderer 的“敬请期待” gate 仍须等 packaged 双端真实验收后才能移除。

## 1. 体验宗旨

能力允许处保持与飞书同等体验；平台确有限制时，保持同等清晰、可预期、可恢复，而不伪造一致。

该宗旨约束产品时机和失败语义，不要求复刻飞书组件：同一根请求只能进入一次项目选择、FIFO 和 Camp admission；
临时执行状态必须可更新和真实撤回；永久输出必须可读。钉钉未提供或尚未以真实 schema/租户证明的原生 `@`、
reply、附件或 disclosure，不得用不受支持字段、伪成功或自制控件冒充。

## 2. 多 Bot durable inbound aggregate

普通群中，每个 published App 的 credential-bound Stream callback 与匹配的 `robotCode`、`isInAtList=true` 共同证明
该 receiving Bot；`chatbotUserId`、`atUsers[].dingtalkId` 和普通成员 ID 均不参与目标相等判断。每份有效 callback
必须立即写入 Core，不能只留在 Main 的 3 秒内存窗口。

同一 `(provider, tenantKey, externalMessageId)` 只拥有一个 `channel_inbound_aggregate`：

- 首份 callback 冻结 transport content、Principal、conversation、观察时 binding 和 acknowledgement App；
- 各 callback 以真实 receiving App 合并 `expected/observed`，其 published Agent 按首次持久观察顺序去重追加；
- DingTalk group 的 payload digest 排除目标集合，但仍比较共同正文、引用、附件摘要、conversation、Principal 和
  观察时 binding；共同事实不同必须以 `observation_mismatch` 终止；
- Main 正常存活时，3 秒后按首次 callback 顺序提交一次 canonical-complete replay。该 replay 的 App/Agent 集合必须
  与已观察集合完全相等且无重复；Main 优先使用已确认写入 Core 的 receiving App 承载 replay，使已知但未落库的 App
  形成 durable mismatch，而不是留下可在截止后部分封口的集合；首份 callback 的 App 继续拥有项目卡和请求 acknowledgement；
- Core 只在 finalize 跨过 admission 边界。一个 aggregate 最多产生一个 `ChannelTurnRequest`，目标顺序原样进入
  `CollaborationService`，从而为同一 CampTurn 建立多个初始 AgentRun。

Main 重启导致 canonical replay 丢失时，DingTalk Snapshot 必须同时返回 collecting aggregate 的
`canonicalMentionsComplete/deadlineAt`。截止前 finalize 返回 `channel.inbound.not_ready`；截止后，只要 durable
`expected == observed` 且非空，Core 将该 aggregate 原子封口为 canonical complete 并继续 finalize。Host tick 不得先把
这类 aggregate 标成 `aggregation_timeout`。迟到或重放 callback 只返回已有 terminal aggregate，不建立第二个根请求。
飞书原有 expected-App timeout 语义不变。

## 3. 永久 Markdown 的父消息摘要

新建 DingTalk `agent_output` delivery 使用 `presentationVersion=2`，保留完整 `body`，并冻结可选 `reply`：

- 没有语义父消息时为 `null`；
- 父消息必须来自同一 Camp、sequence 更早、未 tombstone；否则为 `status=unavailable`；
- available projection 只读取直接父消息自己的结构化正文，排除递归 ExternalQuote 和 CurrentUserMention，作者名最多
  120 个 Unicode scalar，摘要最多 3 行、240 个 scalar；
- Main 将 available/unavailable projection 呈现为 Markdown blockquote，再发送完整正文。该文案明确是“回复摘要”，
  不声称钉钉 native reply，也不制造原生 A2A `@`。

既有无 `presentationVersion` 的未发送/重试 delivery 保持原正文，不回写历史消息。超长正文的多消息 durable 分片只有在
每片拥有独立 Outbox/顺序/重试身份后才能开放；不得在 Main 内一次 delivery 内发送多片并承受部分成功后的重复。

## 4. 安全诊断投影

`channels.dingtalk.snapshot` 保持 `schemaVersion=1`，新增只读 `diagnostics`：

- `inboundCollectingCount / inboundReadyCount / inboundOverdueCount`；
- `cardCreatePendingCount / cardUpdatePendingCount / cardRecallPendingCount / cardFailedCount`。

这些计数来自 SQLite aggregate、Outbox、execution console 和项目卡当前状态，只用于判断 callback 聚合及 Card
create/update/recall 所处阶段。字段不得包含消息正文、附件内容、tenant/chat/App/Agent/Owner identity、credential、
Cookie、URL、access token 或远端响应正文。业务恢复仍以原表和 delivery lease 为真源，诊断计数不能驱动 admission。

## 5. 保留平台限制与重新开放门槛

- 私聊文件/语音/视频 callback 当前只形成名称/媒体类型摘要；普通群 Bot 平台本身不接收这些消息类型。没有 Managed
  Attachment ingress 合同前，不下载 `downloadCode` 到临时目录或把摘要冒充真实附件。
- 出站附件保持 unsupported；只有 enterprise Internal App Robot 的 app-only 原生图片/文件 schema、消息身份、重试和
  撤回均经真实租户验证后才可开放，不借用 custom webhook schema。
- 原生 A2A `@` 与超长正文 durable 分片保持未开放；正文中的 `@你` 只是公开文本。
- Renderer 继续禁用钉钉管理入口，直到桌面端与手机端完成私聊、单 Bot 群、多 Bot 群、连续排队、停止、最近输出、
  Web 执行台、终态和下一轮真实撤回的 packaged App 验收。

## 6. 验证边界

自动测试必须覆盖 callback 按 App 保序去重、两个 callback 合并为同一 aggregate、canonical 集合校验、一个请求与多个
有序 AgentRun、重复/迟到不新增根请求、截止前 not-ready、Main 重启后从 SQLite 截止封口、飞书 timeout 不漂移、
永久父消息摘要的同 Camp/顺序/tombstone/长度边界，以及安全诊断的 collecting/ready/create/recall 计数。

自动测试和 OpenAPI fixture 不替代真实租户验收。多 Bot callback、Card carrier recall、手机动作布局和平台不支持的
附件类型都必须在隔离 packaged App 中留存脱敏证据。

## References

- [DingTalk Channel v10](dingtalk-channel-v10.md)
- [钉钉渠道架构](../architecture/dingtalk-channel.md)
- [渠道设置](../ui/components/channel-settings.md)
- [V1.38-D01](../versions/v1.38/decisions.md#v1-38-d01)
- [Feishu Channel v15](feishu-channel-v15.md)
