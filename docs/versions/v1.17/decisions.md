---
document_type: version-decisions
version: v1.17
lifecycle: historical
last_updated: 2026-08-20
---

# v1.17 决策记录

本文件只解释 v1.17 的重要取舍；当前字段与行为规范由 Architecture、Contracts 与 UI 直接拥有。

<a id="v1-17-d01"></a>

## V1.17-D01：公共附件语义先提交，Runtime 可用性由持久投影解析

### 背景

既有 Composer 发送在公共消息事务前同步复制并发布整个 Runtime View；Agent `rovai send` 又没有文件入口。
若直接把同一同步路径放入 AgentRun，来源 Run 会持有 Camp read admission，而 publication 等待 write admission，
形成稳定自阻塞；同时文件复制和全量 View 哈希占用全局数据库锁，Camp 增长后会阻塞无关 Core 操作。

先返回成功、之后才创建 CampMessage/Delivery 会使 accepted receipt 没有真实公共身份，并让调用者无法可靠
重放。相反，先创建 Published Attachment 但允许失败项从 Runtime catalog 静默消失，又会破坏“公共消息附件
等于 Runtime Desired View”的旧集合定义。因此必须把公共语义、物理可用性与失败解析显式建模。

### 决定

Composer 与 Agent Authority ingress 共享一个 `CampAttachmentPublicationCoordinator`。它在短事务中原子创建
CampMessage、ordered `message_attachment`、semantic revision、quota reservation、publication operation、
writer intent 和必要的 `projection_blocked` Delivery；accepted Agent send 立即返回这些真实 ID。

`CampAttachmentProjectionWorker` 按 Camp semantic revision FIFO 取得 write admission，在数据库锁外复制、读取、
哈希和 fsync，只在计划/CAS/完成阶段持有短数据库锁。`pending | recovery_required` 保留 writer intent 并阻止
Scheduler Claim 新 Run；`available` 才属于 Runtime Desired Catalog 和路径解析；`failed` 保留公共/UI 附件事实，
但以稳定 tombstone 加入 resolution digest 并从 Runtime Desired Catalog 排除。成功和 terminal failure 都推进
contiguous `resolvedRevision`；failed 项不得在无新 operation/revision 的情况下重新出现。

Message Delivery 的 `projection_blocked` 状态占据 recipient FIFO，且没有 dispatch attempt。成功 projection 在
同一完成事务把 gate CAS 到 `never_attempted`；terminal failure 使用既有终态 settlement 结算为
`attachment_projection_failed`。Runtime admission、startup recovery、full verification、controlled rebuild、
authorization 与 path resolution 必须消费同一 available-set 定义和 resolution digest。

### 后果

- 公共消息身份与 accepted receipt 真实且可重放，物理复制失败不会撤销历史公共事实；
- terminal-failed 附件对用户诚实可见，但任何模型/Runtime 都不能获得虚假或缺失路径；
- persistent writer intent 与 Scheduler Claim 在数据库临界区串行化，使重启恢复也不能越过 pending publication；
- 一个 AgentRun 只获取一次 Camp read admission，文件 ingress 与 View materialization 不嵌套于来源 Run 锁；
- 普通发送不重哈希历史 View，单次 Runtime dispatch 只生成并复用一份 verified authorization；
- 需要 Migration、Delivery 新状态、Camp open 新字段和 Host contract fence，但不改变模型输入 bytes。

### 被拒绝方案

- accepted 后再创建消息和 Delivery：receipt 没有真实 ID，重放和调用者后续动作不成立；
- 保持同步 View-before-message：AgentRun read admission 与 publication write admission 自阻塞，复制仍扩大临界区；
- `accepted_pending` 或临时 ID：创造第二种非真实成功语义并污染 Agent output；
- 只写 `runtime_projection_state=failed` 后从 View 忽略：缺少集合定义和 tombstone，恢复/重建可静默复活；
- 为此另建一套自定义内存 gate：持久 intent 与现有 per-Camp RwLock 已能在线性化的数据库检查下闭合竞态。

### 当前权威影响

- [Camp Attachment v3](../../contracts/camp-attachment-v3.md)
- [Camp Published Attachment View v3](../../contracts/camp-published-attachment-view-v3.md)
- [Camp Message Send v11](../../contracts/camp-message-send-v11.md)
- [Message Delivery v5](../../contracts/message-delivery-v5.md)
- [Camp Published Attachment View 架构](../../architecture/camp-published-attachment-view.md)
- [Public A2A Message Delivery](../../architecture/public-a2a-message-delivery.md)
