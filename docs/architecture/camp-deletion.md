---
document_type: architecture
authority: camp-permanent-deletion-control-flow
status: accepted
last_updated: 2026-10-29
---

# Thread 永久删除

本文拥有 Thread 永久删除的组件职责、持久权威和恢复交接。字段级命令、receipt、错误与重试语义见
[Camp Permanent Deletion v4](../contracts/camp-permanent-deletion-v4.md)。

## 单一控制流

删除只有一条内部控制流，不因 Runtime 是 absent、Warm、Starting、Running、Stopping 或异常状态而切换同步路径：

```text
accept + durable admission fence
  -> stop / isolate / reap exact Runtime targets
  -> atomically commit cleanup handoff + delete Thread aggregate
  -> remove managed resources
  -> complete cleanup journal
```

`ThreadDeletionService` 在短事务内完成 User/exact-version 校验、abortive settlement、Mission Workspace
处置意图和 Thread Deletion Intent。`AgentRuntimeFleetManager` 的 Thread admission gate 覆盖该事务：事务接受时先安装
进程内 tombstone 再释放 Starting/acquire gate，事务拒绝则不安装。SQLite Thread marker 是唯一持久准入权威，Fleet
tombstone 只是其当前进程派生；启动恢复在普通 scheduler 运行前重新投影全部 marker。

请求路径不停止进程、不遍历文件、不执行聚合删除。它返回 `accepted` 后只唤醒协调器并失效导航；因此
Renderer、Desktop Main 和 Web Host 都不能把受理等待重新扩张为 Runtime 或预览资源等待。

## 阶段交接，而非新删除表

删库前，Thread 行上的删除意图、现有 AgentRun 的 `runId + executionEpoch + adapterKind` 和首个 accepted command
receipt 足以恢复安全停机、去重和重放。协调器按小批量扫描到期 Thread，并以精确 Runtime 身份停止、隔离和回收；
当前所有权按现有内存 Run/epoch 快照筛选：只有本次 Core 持有的目标需要停止与确认；前代缺 ACK、
缺进程回执或未知身份不能单独阻止删除，也不回填 ACK。当前目标未确认隔离时保留 Thread 与 marker，
不能进入业务删除；业务提交前再次核对当前所有权。Fleet 的 Warm/Starting fence 与隔离要求保持。

业务删除事务先准备既有 `camp_attachment_view_operation(kind='camp_delete_cleanup')`，再删除 Thread 聚合并写入唯一
`camp.deleted`。cleanup journal、accepted receipt 和明确选择 cleanup 的 Mission Workspace 记录不随 Thread 级联，
所以事务提交即完成 Thread Cleanup Handoff，不存在“Thread 已删但清理目标尚未保存”的窗口。这里的
`operationId` 只是首个删除 command ID 在 marker、receipt 和 journal 之间的稳定关联，不是独立领域对象，也不需要
`camp_deletion_operation` 表。

删库后，既有 attachment cleanup journal 接管 Thread Authority 附件根、默认输出目录与 legacy Published View；
Mission cleanup owner 继续负责明确选择删除的 Worktree/受管分支。协调器等待其双检查点完成后才提交
`camp.deletion_completed`，但不复制 Git 清理状态或建立第二套 worker。选择 retain 的 Mission Workspace 在聚合删除前
从内部 journal 移除，其目录和分支继续位于 Thread 删除范围之外。

Mission Workspace 准备、Thread 聚合删除和破坏性 Git cleanup 共用同一后台生命周期 gate。受理路径不等待该 gate；
它只在事务内写入删除 fence。已经进入 Git I/O 的准备流程可以自然返回到写回边界，但每次写回都必须正向确认 Thread
仍存在且没有删除 marker，并以 workspace `state + generation + preparation_token` 作 compare-and-set。协调器确认 Runtime
隔离后才在后台等待 gate，再提交 cleanup handoff 与聚合删除；Git cleanup 同样在 gate 内执行。

当首个 accepted receipt 声明 `workspaceCleanupScheduled=true` 时，Mission cleanup 行必须保留删除 operation 的
`cleanup_command_id`，直至 Worktree/分支双检查点与 cleanup journal 在同一完成事务中收口。journal 未完成时，worker
不得提前删除该行；协调器若找不到承诺的 owner，必须失败并进入恢复／注意事项，而不能把空集合解释成清理完成。

## 准入与迟到写回

持久 marker 参与 Domain Command Gateway、Delivery/Automation claim、Runtime dispatch、Fleet acquire/Starting
commit、渠道输入、Thread open、History/Search、Mission 与文件预览读取。除删除 retry 与清理控制通道外，新业务 mutation
拒绝为 `camp.deletion_in_progress`。接受 cutover 时既有 Turn、Run 与 Delivery 先进入终态；迟到 Runtime callback 只可
确认 cleanup，不能重建或更新业务状态。迟到 Mission preparation 即使已经完成 Git 校验，也不能清空删除 owner、恢复
`ready` 或向调度器返回可运行 Workspace。

普通导航和搜索不返回 deleting Thread。Renderer 同时保留当前窗口的派生 tombstone，以过滤受理前已经发出的旧导航
响应；它不是第二份持久真源，重启后仍由 Core 过滤。

## 恢复、退避与注意事项

同一 coordinator 使用通知快路与固定维护 tick，小批量恢复两类记录：

- Thread 仍带 marker：继续 Runtime 停机、隔离和业务删除；
- Thread 已删除且 cleanup journal 未完成：继续资源与 Mission cleanup。

每个失败对象独立退避，不能阻塞后续对象。自动恢复耗尽后只持久 `attentionRequired + attentionRevision`；用户重试清除
同一 marker 或 journal 的退避并继续原 operation，不创建新任务。诊断保留内部阶段和错误码，Renderer 只获得
`operationId + attentionRevision`，不承担阶段编排。

完成后 journal 清除路径 identity、错误与重试诊断；只保留 accepted receipt 和不含资源目标的最小完成记录，用于命令
重放与去重。

## 并发与性能边界

协调器跨不同 Thread 使用有限批次，单 Thread 聚合删除保持一个 SQLite 事务；不并行删表，不关闭外键。Run 归属使用
互斥 `UNION ALL`：batch Run 由 `agent_run.camp_id` 归属，非 batch/历史 Run 由 `camp_turn.camp_id` 归属，避免
`COALESCE + LEFT JOIN` 的全表路径。`agent_run(camp_id, id)` 的部分索引只服务非空 batch 归属。

结构化日志分别记录 `accept_ms`、`queue_delay_ms`、`runtime_stop_ms`、`database_ms` 与 `cleanup_ms`。快速受理不能替代
后台完成证明；Runtime 停机、数据库事务和文件清理都必须独立有界、可观察和可恢复。
