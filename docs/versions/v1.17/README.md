---
document_type: version-overview
version: v1.17
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: implemented
model_context_change: false
last_updated: 2026-08-20
---

# Rovai-ai v1.17：统一附件发布与 Agent 文件发送

> 当前状态：设计、实施与仓库验收已完成；发布交付按实施计划执行。
>
> 前置版本：[v1.16 Camp 纯附件消息](../v1.16/README.md)。v1.16 已按完成事实冻结为
> historical；其空正文、ready 附件发送和 Timeline 规则继续作为本版基线。
>
> 后续版本：[v1.18 Codex 执行台真实命令预览](../v1.18/README.md)。

## 版本目标

让 Agent 可通过 `rovai send --file` 把当前 Run 工作空间内的文件或目录作为真实 Camp 公共附件发送，
同时把 Composer 与 Agent 两条入口收敛到同一附件发布模块。公共消息先在一个短事务中取得稳定身份，
Runtime View 在事务后异步物化；Delivery 与 AgentRun admission 在物化完成前保持持久阻断，不把复制和
全量哈希放在全局数据库锁或 built-in invocation guard 内。

## 交付范围

- `camp.message.send.files` 与可重复 `rovai send --file`；正文继续必填，每次最多 10 项并复用现有附件限制；
- 文件源只允许来自认证 AgentRun 的 execution workspace 或该进程精确 `ROVAI_RUN_TMP`，先冻结到 Authority；
- `CampAttachmentPublicationCoordinator` 统一 Composer/Agent 语义提交、revision、quota reservation、writer
  intent、operation 与 Delivery gate；`CampAttachmentProjectionWorker` 按 Camp semantic revision FIFO 物化；
- accepted Agent send 仍立即返回真实 `messageId` 和 `deliveryIds`，不向 Agent 输出内部 pending 字段；
- `message_attachment.runtime_projection_state = pending | available | recovery_required | failed`；只有
  `available` 属于 Runtime Desired Catalog，terminal failed 以 tombstone 进入 resolution digest；
- unresolved persistent writer intent 阻止调度器 Claim 新 Run；已获一次 read admission 的 Run 生命周期内
  不重复申请 Camp gate；
- `projection_blocked` Delivery 占据 recipient FIFO，成功后 CAS 释放，terminal failure 以
  `attachment_projection_failed` 结算；
- 完整 View 校验采用短数据库 snapshot、无锁 `spawn_blocking` 文件扫描、短数据库 CAS，单次 Run 只复用一份
  verified authorization；
- Renderer 对 pending/recovery 显示克制的“正在准备供队员读取”，对 failed 显示“队员读取不可用”。

## 数据与 Context 兼容性

本版升级到 Data Contract `v1.17 / projection schema 57 / Migration 102`。既有 `message_attachment` 回填为
`available`；既有 View catalog 作为 append-only Runtime-available catalog 的合法前缀。Migration 安装统一
publication operation、semantic/resolved revision、resolution digest/tombstone、quota reservation 和
Delivery projection gate 所需状态。

`CampAttachmentViewReceiptV2` wire、Formatter 21、ContextManifest 21、Run Facts v2、Profile v4 与 Session
Charter bytes 不变。View contract 升级到 3，Host 兼容性据此 fence；Runtime Launch and Verification 升级到
v12。Receipt 中的 catalog 明确定义为 Runtime-available catalog，failed 公共附件不会获得 Runtime path。

## 明确不做

- 不返回虚构 attachment/message ID 或 `accepted_pending`；
- 不让 Agent 通过任意绝对路径、Authority path 或其他 Run tmp 发送文件；
- 不让 terminal-failed 附件静默重新出现；重新发送必须使用新 operation/revision；
- 不在 Agent output、Session Charter 或模型上下文中暴露 publication 内部状态；
- 不把全量历史附件重哈希放入普通发送或普通 Run 的数据库临界区。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.16 按完成事实冻结；本概览、实施计划与索引建立唯一 current v1.17。 |
| Decisions | 已更新 | [V1.17-D01](decisions.md#v1-17-d01)记录语义先提交、Runtime 可用性投影与失败 tombstone。 |
| Contracts | 已更新 | Send、Attachment/View、Composer、Open、Delivery、Built-in 与 Runtime Launch 合同同步升级。 |
| Architecture | 已更新 | Attachment View、Composer、A2A Delivery、Built-in、Runtime Catalog 与基础不变量统一发布和 admission。 |
| UI | 已更新 | 会话附件卡增加 Runtime pending/recovery/failed 的诚实状态。 |
| Runtime Activity | 确认无需更新 | publication 是 Core 资源状态，不新增 Runtime activity 或 Evidence 类型。 |
| Runtime compatibility | 确认无需更新 | 不改变已实测 Adapter 能力；View contract 3 仅触发现有 Host compatibility fence。 |
| Documentation routing | 已更新 | 文档导航、合同索引和当前决定导航切换到 v1.17 合同。 |
| Root README | 确认无需更新 | 不改变项目定位、平台范围或安装入口。 |

## References

- [v1.17 实施与验收计划](implementation-plan.md)
- [v1.17 决策记录](decisions.md)
- [Camp Attachment v3](../../contracts/camp-attachment-v3.md)
- [Camp Published Attachment View v3](../../contracts/camp-published-attachment-view-v3.md)
- [Camp Message Send v11](../../contracts/camp-message-send-v11.md)
- [Message Delivery v5](../../contracts/message-delivery-v5.md)
