# ADR-0005: Evidence & Read Side

- Status: Accepted
- Scope: IP-05
- Date: 2026-07-20

## Context

v0.01 Renderer 主要从 Task 事件流投影 Conversation、Activity、Approval 和 Diff。v0.02 的权威状态分布在 Camp、Task、Run、Inbox、Action 与 Evidence 关系中；如果 Renderer 仅靠增量事件重建状态，断线、重复事件和 Schema 变化会形成第二套不可靠真源。同时，独立文件与长期代码证据需要明确的内容保留边界。

## Decision

IP-05 包含两个独立接口和一个读侧边界：

- `EvidenceValidator`：校验证据类型、Camp/Repository Scope、可见性、稳定性、对象状态与保留资格；不理解自然语言 Criterion。
- `ManagedBlobStore`：不可变内容寻址、完整性、去重、流式读写和 GC；不包装成 Artifact Service。
- Query/Subscription：从同一 SQLite 权威快照生成 DTO，并用全局事件序列提供失效通知和时间线。

## Evidence

Task 完成保存不可变的 Criterion—Evidence 映射：每个 Criterion 必须有稳定 ID、至少一个合格引用、完成时 Task 版本、Actor 与 `semanticAttestation=true`。Core 检查引用资格，Actor 对自然语言是否满足负责。

允许的完成证据限于公开、稳定对象：CampMessage、终态 AgentRun、合格 ActionExecution、Repository-scoped full Git Commit OID 和 MessageAttachment。私有 ConversationMessage、InboxMessage、Workspace 路径、普通 Patch 和未提交工作区不能直接完成公共 Task。

Git Commit 身份是 `repositoryScope + objectFormat + fullOid`；作为长期证据前必须通过内部 Ref 或等价机制保持可达。普通 Patch 只用于协作，不是完整 Revision。

## Managed blobs

MessageAttachment 是消息与 Blob 的领域关系；ManagedBlob 是内容寻址存储资源。写入采用：

```text
流式写临时文件并计算 SHA-256
→ fsync / 原子落到内容地址
→ SQLite 事务创建或复用 Blob 元数据与 Attachment/结果引用
→ 无引用孤儿由 GC 清理
```

MessageAttachment、ActionExecution 结果和 Task Evidence Binding 都是 GC Root。文件名规范化、大小限制、媒体类型嗅探、路径逃逸防护和秘密处理属于强制安全边界。

## Read model

- 查询直接从权威表和确定性派生规则生成，不创建持久 Projection 表或第二套运行状态缓存。
- 每个快照在一个读事务中捕获 `throughGlobalSequence`。
- Renderer 先取得快照，再从该序列订阅增量；增量主要用于失效通知和时间线追加。
- 断线、序列缺口、未知 Schema 或缓存不确定时，Renderer 丢弃派生缓存并重新获取快照。
- TaskReadiness、Run Activity、blockers、unresolved effects 和 Camp 时间线必须来自同一一致快照。

## API boundary

v0.02 Renderer 的主要入口围绕 Camp，而不是 legacy Project/Task：

```text
camps.list / camps.get / camps.create / camps.archive
camps.messages.list / camps.messages.send
camps.members.*
tasks.* / campTurns.* / agentRuns.*
inbox.* / approvals.* / actions.*
camps.snapshot
events.subscribe(fromGlobalSequence)
attachments.open/read metadata
```

实际 Method 名称在 Contract 中保持封闭枚举，并由 Electron Main Allowlist 与 Rust Handler 同步。Renderer 不获得文件系统、Git、Shell 或数据库访问权。

## Migration

- legacy Task/Event/Approval 查询在 Renderer 完成切换前保留兼容 API，但不得成为新领域状态的写入口。
- legacy `artifact` 表只读保留，确认无历史数据或完成显式迁移后再删除；新附件不写入该表。
- 新 DTO 必须包含 Schema Version；旧 Renderer 遇到不兼容版本失败关闭并刷新，而不是猜测字段。

## Acceptance

- 快照与订阅交界模拟并发写入时不丢事件，重复事件不重复改变 UI。
- 断线后从旧游标检测缺口并完整刷新。
- Task 完成后逐条 Criterion 可以还原证据、Actor、声明和内容完整性。
- Blob 去重、损坏检测、孤儿清理和 GC Root 保留均有测试。
- Tombstone/清理普通消息、动作或 Camp 时不会破坏已完成 Task 的证据。
- Renderer 的 Camp 时间线、Agent 泳道、等待原因、Approval、Action、Diff 与审计来自一致读模型。

## Rejected

- 通用 Artifact 实体或成果库。
- Renderer 通过重放事件成为业务状态真源。
- 持久 Projection 表作为 v0.02 默认架构。
- 用颜色、自然语言或 Agent 自述替代结构化状态和证据。
