---
document_type: protocol-contract
contract: thread-archive-v1
authority: thread-archive
status: accepted
version: 1
source_version: v1.72
last_updated: 2026-11-19
---

# Thread Archive v1

用户可归档任何 Active Thread。存在 Mission 关联的 Thread 按使命管理，其余按会话管理。归档保留
Thread 与 Mission 的身份、成员、消息、附件、项目和执行状态。使命业务状态沿用 [Mission 合同](mission-v14.md)。

## 持久状态与公开消息

Migration 227 从 schema 176 升级至 177，在 `camp` 新增三列。

| 列 | 语义 |
| --- | --- |
| `archived_at` | Core 生成的归档时间，空值表示在普通列表展示 |
| `archived_through_global_sequence` | 归档之前已提交的全局水位，与归档时间同时赋值及清空 |
| `archive_revision` | 从 0 开始，手动或自动实际转换时加一 |

归档和取消归档在 Command Gateway 的写事务中比较归档版本、更新归档列、追加事件和保存回执。
真实公开发布复用现有全局分配器。迁移以现有分配水位和事件最大序列的较大值对齐水位，显式写入序列也在事务中推进分配器。
消息可见、Thread 未进入删除流程且消息首次公开发布序列超过归档边界时，同一发布事务清空归档列并递增版本。
`camp_message.sent` 和 `camp_message.public_a2a_sent` 按消息 ID 取首次发布序列，覆盖显式序列插入与插入后分配。
纯执行状态、审批、任务进度、草稿、正文更新、重复发布和撤回均保留当前归档状态。

## 用户端命令

Desktop 与认证 Web 使用 `threads.archive` 和 `threads.unarchive`。
归档接口位于用户端 Host 路由，Agent 工具目录和分发沿用原有工具集合。

```ts
type ArchiveCommandEnvelope = {
  commandId: string
  command: { threadId: string; expectedArchiveRevision: number }
}
type ArchiveCommandPayload = {
  threadId: string
  archivedAt: string | null
  archiveRevision: number
  changed: boolean
}
```

成功结果使用 `StoredCommandResult.payload`。同版本且处于目标状态返回 `changed: false`。
归档状态冲突返回 `camp.archive_conflict`，Pending 返回 `camp.archive_requires_active`。
删除途中的 Thread 由现有删除守卫拒绝。普通回执沿用 Thread 生命周期，提交或对账恢复后读回当前状态。
Web 自动重连只查回执。显式恢复使用原命令 ID 与参数，Desktop 同窗口对同一操作重试时也使用原命令 ID。
目标物理删除后，明确的 `camp.not_found` 业务拒绝结束等待，提示目标已移除并重新读取归档列表。
归档提示中的撤销直接向取消归档命令传入本次归档回执提供的版本。

## 发现和详情

普通导航前缀、普通完整 ID 搜索、使命板、会话与使命引用候选排除已归档记录。
按已知 ID 的导航摘要、已打开详情和已有引用按既有授权读取。置顶偏好保留 ID 和顺序，恢复时按原 ID 补读摘要。
导航快照与分页升级至 schema 4，Thread Open 升级至 schema 10，Thread Snapshot 升级至 schema 37。
这些摘要和用户侧使命摘要提供 `archivedAt`、`archiveRevision`。使命详情按 `missions.get` 独立读取。
归档及恢复沿用原排序和已读水位。归档状态变更在提交后失效相应视图，使命同步显式失效使命板。

## 归档查询

`threads.archive.list` 接收 `{ kind: 'chat' | 'mission', query?, projectKeys?, limit? }`。
Core 在一个读事务中取得 schema 1 前缀、未筛选类型总数、筛选后两类型计数、项目候选、各项目完整匹配数、
`hasMore` 和 `throughGlobalSequence`。默认前 50 条，展开以 50 条递增，每次整体替换前缀。
改变类型、搜索或项目条件后从 50 条开始。后台失效刷新保留已展开数量、筛选与可见行滚动锚点。
合并归档、删除受理、改名、项目或最后可见消息等失效，范围覆盖结果当前前缀之外的记录。

搜索按首尾裁剪、NFKC 和逐 Unicode 字符小写后对子串匹配，字段为当前标题与 Thread ID。
项目候选覆盖两种类型的全部归档项目及已选项目。项目候选计数为当前类型的项目全量计数，
类型标签与组标题计数应用搜索和项目条件。目录项目以 `directory:<projectPath>` 标识，
快速对话使用 `quick-chat`，无法归属的记录进入不可用组。客户端使用既有导航偏好显示别名。

项目按该组最新匹配消息时间排序，行按最后可见公开消息时间倒序，项目键和 Thread ID 稳定处理同值。
确认无可见消息时返回空时间。未初始化的历史摘要走同一可见消息口径的只读查找。
仅查询必要摘要，读取接入现有有界读队列。

## 删除受理

归档页仍使用 [永久删除合同](camp-permanent-deletion-v4.md) 的 `threads.delete`。
确认框打开时冻结 Thread 版本和归档版本，提交可选 `archiveGuard: { expectedArchiveRevision }`。
回放与已有删除操作优先返回。首次受理检查 Thread 仍归档、两种版本一致及原删除权限。
使命默认保留工作树和本地分支，显式清理沿用现有选项。用户看到“已提交删除”，后续清理由原工作流处理。
