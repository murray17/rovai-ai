---
document_type: protocol-contract
contract: thread-archive-v2
authority: thread-archive
status: accepted
version: 2
source_version: v1.72
last_updated: 2026-11-19
---

# Thread Archive v2

用户可归档 Active 会话和使命。Mission 通过关联 Thread 使用其归档状态，同时保留原业务状态。归档保留 Thread ID、项目、置顶顺序、消息、附件和草稿。

## 归档与停止执行

Core 在命令网关的同一写事务内设置 `camp.archived_at`，取消该 Thread 内 queued、running、waiting 的 AgentRun、活动 ThreadTurn 和尚待派发的公开 Delivery，并保存命令回执。运行时按原有停止协议隔离这些执行并确认清理。事务回滚时归档和取消一起回滚。并发到达的写入由 Core 的提交顺序决定。

公开消息、渠道消息、队员之间的消息和运行事件都保留当前归档状态。归档期间工作区关闭，用户发言返回 `camp.archived`。用户手动取消归档后可以发送和开始新的执行。已取消的 Run 保留终态。单聊中尚未发布的用户输入保留在原队列，归档期间暂停派发。

Migration 228 将投影 schema 升至 178。当前归档状态使用一个可空时间字段 `archived_at` 和一个归档列表部分索引。正式消息编辑库和已发布的归档预览库都可升级。预览库保留归档时间、消息及原回执，并按停止执行规则结算仍在运行的工作。

## 命令和恢复

认证的用户界面调用 `threads.archive` 和 `threads.unarchive`，使用现有 `{ commandId, command: { threadId } }` 封装和 `StoredCommandResult`。成功的 payload 包含 `threadId`、`archivedAt`、`changed`。相同命令 ID 重放返回原回执。新命令发现状态已满足时返回 `changed: false`。Pending Thread 返回 `camp.archive_requires_active`。删除中的记录使用原删除守卫。

撤销归档调用 `threads.unarchive`。多个窗口设置相反状态时以最后提交的操作为准。提交后的失效通知驱动视图刷新。Web 自动重连先对账，用户显式重试继续使用原命令。确认目标已删除时释放等待并刷新。Agent 的工具目录、分发和权限沿用原有边界。

## 导航、使命和详情

普通会话、置顶展示、普通搜索、使命板、命令面板和新增引用候选只包含未归档记录。按 ID 仍可取得带 `archivedAt` 的摘要或快照，供置顶恢复和入口检查。使命板和当前展示的使命共用 `missions.list`。

在本窗口归档已打开的记录时，先按现有离开流程保存本机草稿。保存成功后提交归档，会话回到新建页，使命回到使命板。其他窗口归档时，当前窗口在收到正式快照后也走离开流程。通过已有引用、通知、深链或启动恢复进入归档记录时，显示设置入口提示，转到对应落点。手动取消归档后，记录按原项目、置顶顺序或使命状态展示，已读状态和草稿沿用原值。「设置 → 归档」中的取消归档操作让用户停留在列表。

## 归档管理列表

`threads.archive.list({ cursor?, limit? })` 只返回 `{ items, nextCursor }`。每条摘要含 `threadId`、`missionId`、`title`、`projectKey`、`lastMessageAt`、`threadVersion`。Core 从归档且未进入删除流程的记录中按 Thread ID 升序读取游标之后的记录。默认每页 200 条，有效范围 1 至 500。多取一条判定后续页，若有下一页则返回本页最后一个 Thread ID，末页返回 null。查询使用有界读队列和归档部分索引。最后消息时间沿用可见消息摘要和已有的只读回退。

页面依次取齐各页后整体替换。归档状态变化、删除、窗口重新获得焦点时重新读取，期间保留上次完整结果和当前筛选。重复游标使此次读取失败，用户可重试。前端按 `missionId` 区分类型，按裁剪、NFKC 和逐字符小写匹配标题及 Thread ID。标签数量使用搜索和项目条件下的全部匹配记录。项目候选覆盖两种类型及已选项目，候选计数使用当前类型在该项目的全部归档数。

前端按组内最新可见消息时间降序排列项目，再按组内消息时间降序排列记录。同时间分别按项目键和 Thread ID 排序，空时间排最后。项目名称使用本机别名。归档页标题为静态文本，每行操作为取消归档和删除。

## 删除

归档页采用[现有永久删除命令](camp-permanent-deletion-v4.md)，提交确认时使用对话框打开时取得的 Thread 版本。普通删除的权限、幂等、版本检查、工作树处置和后续清理继续适用。使命默认保留工作树与分支。可重试失败在原确认框内显示，保留清理选择。受理成功时显示「已提交删除」。
