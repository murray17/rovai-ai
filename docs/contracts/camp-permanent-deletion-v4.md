---
document_type: protocol-contract
contract: camp-permanent-deletion-v4
authority: camp-deletion-asynchronous-acceptance-and-handoff
status: accepted
version: 4
source_version: v1.65
last_updated: 2026-10-29
---

# Camp Permanent Deletion v4

本合同替代 [v3](camp-permanent-deletion-v3.md)。继承 User-only、exact-version、受管目录 identity、外部文件保护、
幂等 Domain Command 与聚合删除原子性；把所有 Runtime 状态统一为可靠的异步删除，并以 Camp marker 到既有 cleanup
journal 的阶段交接完成崩溃恢复，不新增删除任务表或用户任务中心。

## 1. 接口与受理 receipt

`camps.delete` 保留现有 payload：

```ts
{
  commandId: string
  command: {
    campId: string
    expectedVersion: number
    force?: boolean
    workspaceDisposition?: 'retain' | 'cleanup'
  }
}
```

`force` 为兼容字段，不再选择同步/异步 Runtime 路径。用户确认永久删除即授权 Core 终结当前业务执行并在后台完成
停机、删库和受管资源清理。首次受理必须在一个短事务及同一 Fleet admission gate 内完成：

1. 检查同 command replay 或该 Camp 已存在的删除意图；
2. 验证 User 与 exact Camp version；
3. 复用 abortive settlement 终结当前 Turn、Run 和 Delivery，并保存现有 Run 的精确 cleanup 身份；
4. 记录 Mission Workspace retain/cleanup 处置；
5. 在 Camp 写入不可取消的 Deletion Intent、首个 command ID 和 retry checkpoint；
6. 在释放 acquire/Starting gate 前安装该 Camp 的进程内 tombstone。

受理成功返回 `StoredCommandResult`：

```ts
{
  status: 'accepted'
  code: 'camp.delete_accepted'
  payload: {
    campId: string
    operationId: string
    acceptedAt: string
    workspaceCleanupScheduled: boolean
  }
}
```

`operationId` 等于首个 accepted `commandId`。它是 receipt、Camp marker 和 cleanup journal 的稳定关联，不是独立任务
aggregate。请求在该事务后立即返回，不等待 Runtime、SQLite 聚合删除、预览释放、Mission Git 或文件系统。

同 command ID 重放原 receipt；不同 command ID 对同一 Camp 的重复删除也返回首个 operation，即使 Camp 聚合已经删除。
已有 operation 的查找早于 version/not-found 判断。首个 accepted `command.result` 必须排除于 Camp event 清理，且不得承载
可变阶段 checkpoint。

## 2. 删除准入 fence

Deletion Intent 接受后不可取消，只能自动继续或重试。持久 marker 是唯一权威，Fleet tombstone 是当前进程派生。
下列路径必须共用删除判定或其权威投影：

- Camp mutation、用户消息、A2A、Task/Delivery/Automation 派生与渠道输入；
- Delivery claim、dispatch preflight、Fleet acquire 与 Starting commit；
- Runtime tool 业务写入和 terminal callback；
- Camp open、导航、搜索、History、Mission 与文件预览读取。

除删除 retry 与 Runtime/资源 cleanup 控制通道外，删除中的 Camp 不再接受业务写入；scoped Domain Command 返回
`camp.deletion_in_progress`。在途 Starting 必须取消或迟到即 reap，旧 lease/callback 不得更新业务状态或重新驻留。
正常 read side 排除该 Camp，不能在重启、旧 snapshot 或迟到导航响应中重新显示。

## 3. 后台状态与安全顺序

内部恢复顺序固定为：

```text
Deletion Intent accepted
  -> runtime stop/isolation confirmed
  -> Cleanup Handoff + Camp aggregate delete + camp.deleted
  -> managed attachment/output/View cleanup
  -> optional Mission Worktree/branch cleanup confirmed
  -> journal completed + camp.deletion_completed
```

协调器以通知快路和固定恢复 tick 扫描小批量到期对象。所有 Runtime 状态共用同一路径。停止目标和提交前检查
均只包含现有内存中本次 Core 持有的精确 Run/epoch；前代缺 ACK、缺进程回执或未知身份不是当前占用，
不能单独阻止删除，也不得伪造 ACK。当前目标不存在仍须得到真实的隔离结论，不能绕过 identity 核验；
当前目标停止超时、隔离不明或 Fleet 残留 Starting 时记录可恢复失败，不能继续删库。

业务删除事务必须同时：

- 准备或复用 `camp_attachment_view_operation(kind='camp_delete_cleanup')`；
- 原子删除 Camp 业务聚合；
- 保留首个 accepted receipt；
- 产生唯一 `camp.deleted` 并把 operation checkpoint 交给 journal。

Automation 产生的 Camp 同样适用：业务聚合删除必须先删除 `camp_id` 指向该 Camp 的 occurrence，再删除它引用的
消息和 Delivery；对应 `automation_notification_delivery` 同事务级联清除。删除失败必须回滚 occurrence、通知记录和
业务聚合，并允许原 operation 重试到 `camp.deletion_completed`。Automation 定义、其他 occurrence/Camp、启用状态和
`nextRunAt` 保持不变；删除历史不重跑任务，也不承诺撤回外部渠道已经收到的消息。历史列表和 `lastRun` 从剩余记录推导，
与删除 Automation 定义时保留历史的规则分开适用。

Camp 不需要存活到所有文件清理结束。Camp 删除后，journal 幂等清理 Camp Authority 附件根、默认输出目录和 legacy
Published View；`workspaceDisposition='cleanup'` 时既有 Mission cleanup owner 继续 Worktree/受管分支双检查点，journal
等待其完成。retain 时 Worktree、分支和项目目录不属于删除范围。

删除受理不能等待在途 Mission Git 准备，但准备流程的任何迟到数据库写回必须同时满足：Camp 行仍存在、
`deletion_operation_id IS NULL`，且 Workspace 的 `state + generation + preparation_token` 与读取时一致。Runtime 隔离后的
聚合删除以及破坏性 Mission cleanup 必须在后台等待同一 Workspace 生命周期 gate；迟到准备不得恢复 `ready`、清除
`cleanup_command_id` 或返回可运行 Workspace。

若 accepted receipt 的 `workspaceCleanupScheduled` 为 `true`，删除 owner 行必须保留到 Worktree 与受管分支双检查点完成，
再由 cleanup journal 的最终事务删除。未完成 journal 看到空 owner 集合属于可恢复错误
`mission_workspace_cleanup_owner_missing`，不得产生 `camp.deletion_completed`。没有该 receipt 的旧式 cleanup journal
只有在不存在异步 `camp.deleted` handoff 证据时才按旧流程恢复；已有异步 handoff 却缺 receipt 必须 fail closed。

全部承诺资源完成后才产生 `camp.deletion_completed`。外部 Source Ref、任意用户项目目录、Runtime 原生 Home、Provider
历史和其他 Camp 引用的外部文件始终不在删除范围。完成后必须清除 journal 的路径 identity、错误、retry 诊断及完成
不再需要的 Mission cleanup 记录。

## 4. 自动恢复与用户重试

失败按对象独立退避；当前自动尝试间隔为 1、2、5、15 秒，达到第五次失败后设置 attention checkpoint。失败项不能
阻塞其他 Camp，进程重启后由以下持久事实继续：

- `camp.deletion_operation_id IS NOT NULL`：恢复 Runtime 核验、停机和业务删除；
- 未完成 `camp_delete_cleanup` journal：恢复受管资源与 Mission cleanup。

`camps.deletionIssues` 只返回需要用户介入的 `{ operationId, attentionRevision }[]`。`attentionRevision` 仅在一次自动恢复
周期首次进入 attention 时递增，使每个窗口会话只提醒一次而不丢失重启后提醒。

`camps.retryDeletion` 接受新的 Domain Command ID 和原 `operationId`，User-only 地清除同一 Camp marker 或 cleanup
journal 的 attention/retry 状态，并把 deletion-owned `mission_workspace.cleanup_failed` 恢复为 pending；它不创建新
operation。未知 operation 拒绝 `camp.deletion_not_found`，已完成 operation 幂等返回完成事实。

## 5. Renderer 与 Host

正常产品流只有：确认删除 → “正在删除…”短提交态 → accepted 后关闭 Dialog、离开当前 Camp、从正常列表移除。
Renderer 为本窗口保存派生 tombstone，所有 Navigation snapshot 提交都先过滤它；旧响应不得让 Camp 复现。Core read side
仍是重启后的权威过滤。

Desktop Main 与 Web Host 必须先取得 Core 非 rejected 结果，再 best-effort 释放文件预览；预览失败和导航刷新失败不能
改变 accepted 结果。正常成功不显示阶段、进度或“永久删除完成”，也不建立删除任务区。

自动恢复耗尽时只显示局部、持久且可操作的通知：`删除未完成，请重试。`。重试继续原 operation；不使用全局错误横幅，
不暴露内部阶段、错误码或残留资源明细，不把 Camp 放回正常列表。

## 6. SQL、Migration 与观测

Migration 169 从精确 `Data Contract v1.64 / projection schema 118` 升级到 `v1.65 / schema 119`。它只给 Camp 和既有
attachment cleanup journal 增加删除意图、retry 与 attention 字段，并增加 due-scan 与 `agent_run(camp_id, id)` 部分索引；
不创建删除 operation 表。

Run 归属必须使用互斥 `UNION ALL`：`invocation_kind='batch'` 直接按 `agent_run.camp_id`，其余 Run 按
`camp_turn.camp_id`。不得假设全部 Run 都有 `agent_run.camp_id`，不得以 `COALESCE + LEFT JOIN` 重复推导归属。删除表序
保持外键安全和单事务，不并行删表、不关闭外键。

每个 operation 的结构化日志至少记录 `accept_ms`、`queue_delay_ms`、`runtime_stop_ms`、`database_ms`、`cleanup_ms` 和
内部失败阶段。性能验收必须把点击确认到本地移除／请求受理与后台完成分开报告；副本测试使用 SQLite Backup API 或
完全隔离的合成数据，禁止在日常库试删。代表性本地打包 App 的前台门槛是至少 8 个样本中，从点击确认到 Dialog 关闭且
Camp 行消失的 p95 不超过 250ms；后台完成时长不计入该门槛，但必须单独留证且最终可达。

## 7. 必需验收

- absent、Warm、Starting、Running、Stopping 与异常 Runtime 均快速 accepted；
- 同 command replay、不同 command 重复点击和响应丢失返回同一 operation；
- accepted receipt 在 Camp 聚合删除后仍可 replay；
- 已完成的定时 Automation Camp 删除失败进入 attention 后，retry 继续同一 operation 至清理完成；自身 occurrence 与
  通知记录清除，其他运行与定义的未来计划保留，业务删除事务失败不提前丢失历史；
- Starting 竞争、旧 lease/callback、渠道输入和所有统一准入入口不能恢复业务写入；
- Runtime 停止失败不能进入数据库阶段；各 checkpoint 崩溃重启可幂等续跑；
- cleanup 与 Mission Git 失败自动恢复，耗尽后一次提醒，用户 retry 继续原 operation；
- 在途 Mission 准备与删除竞争时，迟到写回不能清除 cleanup owner，破坏性 cleanup 等待生命周期 gate，承诺过 Mission
  cleanup 的 journal 不以空 owner 集合完成；
- 预览释放／导航刷新失败不改变 accepted，旧 Navigation 响应不能复现 Camp；
- completed 清除敏感路径/identity/错误快照，仅保留最小幂等 receipt；
- SQL 前后执行计划与代表性基准、前台 p50/p95、后台各阶段耗时分别留证。
