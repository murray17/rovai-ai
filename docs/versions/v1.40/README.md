---
document_type: version-overview
version: v1.40
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-04
---

# Rovai-ai v1.40：用户附件路径引用与 Pending 原生携带

前置：[v1.39](../v1.39/README.md)。本版本基于
`main@d2a4967a60900f658d420430e50013f31eee8bd5` 删除 Desktop 新用户附件的资产管理链路，并让
Composer、Pending、Pending Edit 与正式 Message 原生保存同一组本地 source path refs。

## 范围与当前状态

- 新用户文件/目录直接引用 native absolute path；只有没有路径的 bytes/Blob 由 Main 写一次 OS Temp。
- 四个 owner 只在自身 JSON 中持久化 refs；新路径不写 Prepared、Managed、Message Attachment 或 ref 表，
  不创建长期附件副本、digest、ingest intent、staging/promote、catalog 或后台 availability 状态。
- Composer 可以直接发送或把正文、source refs、Reply/Continuation 与 Execution Request 原子入队；Pending
  原生展示附件，Pending Edit 支持添加、粘贴、拖放、删除、排序、保存、取消和整条删除。
- Message 继续保存 source refs。历史读取只投影无路径展示信息与 `availability = unknown`，不批量访问文件系统；
  preview/open/reveal 才检查并只更新当前 Renderer 卡片。
- Runtime Core resolver 对 executionRoot 内的 canonical source 返回原路径；其他来源普通复制到当前
  `ROVAI_RUN_TMP/source-attachments`。Adapters 和 `CURRENT_INPUT.attachments: string[]` wire 不变。
- 升级前 Prepared Draft 不迁移，保持互斥 legacy 模式直到直接发送、删除附件或丢弃；Managed v2 继续服务旧数据
  和 Agent 产物。

本版本明确接受 source path 的弱持久性：来源可以被修改、移动、删除、改权限或被 OS 清理；后续 Run 可以读取
新内容或失败。Rovai 不恢复同名文件、不在发布时冻结、不把失败路径升级为 Managed。

## 复杂度预算

允许新增的核心概念仅为 `LocalAttachmentSourceRef`、owner `source_attachments_json`、Pending working refs、
owner locator 和 Run-local resolver。不得新增附件实体/关系表、用户长期附件目录、Managed v2 用户写路径、内容
digest、ingest intent、staging/promote、附件 catalog、availability monitor、Runtime policy、copy budget/quota 或新的
横向路径脱敏框架。

## 数据合同

Migration 137 只接受 `Data Contract v1.46 / Projection Schema 87`，原子升级为
`Data Contract v1.47 / Projection Schema 88`。它只给 `camp_composer_draft`、`pending_camp_input`、
`pending_input_edit_session` 与 `camp_message` 增加带 JSON-array CHECK 的字段并更新 marker；不读取、转换或删除
任何 Prepared/Managed/legacy 行或物理文件。失败整体回滚，重开不会重复应用。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.39 按原 `in_progress` 事实冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.40 |
| Decisions | 已更新 | [V1.40-D01](decisions.md#v1-40-d01)记录 source-ref 弱持久性、Pending 原生携带、Run-local resolver、旧 Prepared 自然耗尽与复杂度预算；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Camp Attachment v8](../../contracts/camp-attachment-v8.md)、[Composer Draft v7](../../contracts/camp-composer-draft-v7.md)、[Pending Input v2](../../contracts/pending-camp-input-v2.md)、[Camp Open Projection v15](../../contracts/camp-open-projection-v15.md)和[File Preview v5](../../contracts/file-preview-v5.md)拥有真实 wire change；Context/Camp Message Send/History 的既有 public shape 不变，未升版 |
| Architecture | 已更新 | [Camp Attachments](../../architecture/camp-published-attachment-view.md)、[Composer Draft](../../architecture/camp-composer-draft.md)与[基础不变量](../../architecture/foundational-invariants.md)改为 source-ref 用户路径，并保留 Agent/legacy Managed 边界 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)和[会话区拖放](../../ui/components/conversation-drop-zone.md)记录排队附件、Pending Edit 与按动作 availability；Renderer 继续使用统一 storage-blind View |
| Runtime Activity | 确认无需更新 | resolver 不增加 Activity 类型、Adapter 事件或展示映射，失败沿用既有 AgentRun failure 路径 |
| Runtime compatibility | 确认无需更新 | 所有 Adapter 仍只接收 `CURRENT_INPUT.attachments: string[]`，没有 Runtime-specific capability 或已验证版本结论变化 |
| Documentation routing | 已更新 | 文档总导航、Contracts/Architecture 索引和 CURRENT 决定导航指向本版 current contracts 与 source-ref 边界 |
| Root README | 确认无需更新 | 本次改变内部用户附件生命周期与 Pending 能力，不改变项目定位、安装方法或 Runtime 支持清单 |

## References

- 下一版本：[v1.41](../v1.41/README.md)
- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Camp Attachment v8](../../contracts/camp-attachment-v8.md)
- [Pending Camp Input v2](../../contracts/pending-camp-input-v2.md)
- [Camp Composer Draft v7](../../contracts/camp-composer-draft-v7.md)
- [Camp Open Projection v15](../../contracts/camp-open-projection-v15.md)
- [File Preview v5](../../contracts/file-preview-v5.md)
