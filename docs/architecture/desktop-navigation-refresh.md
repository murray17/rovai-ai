---
document_type: architecture
architecture: desktop-navigation-refresh
authority: desktop-navigation-invalidation-and-refresh-boundaries
status: accepted
last_updated: 2026-09-04
---

# Desktop Navigation Refresh 架构

本架构规定 Desktop 侧栏 Navigation Snapshot 的失效、刷新、失败恢复、前后台与 Sidecar Project 顺序边界。
Core Navigation Read Model 拥有 Project 聚合、Camp 活动排序与活动字段；Main-owned Navigation Preferences
拥有当前设备的 Sidecar Project 顺序。Renderer 只组合两份完整快照，不从增量事件猜测位置。

## Component authority

| Component | Responsibility |
| --- | --- |
| Core Navigation Read Model | 在一个 SQLite 读事务中投影 Project 聚合、Project 内 Camp 活动顺序、标题、Lead、活动时间、运行标记与完成未读标记；Project 数组保留旧活动顺序，作为首次冻结和新项发现输入，不是 Sidecar 已保存顺序 |
| Core mutation boundary | 影响 Navigation 投影的请求型写操作在权威事务提交后发 `navigation.invalidated`；异步 AgentRun 生命周期在对应事务成功后发同一提示 |
| Electron Main | 原样转发 Core event；以 schema 3 私有原子 JSON 保存 `projectOrder`，串行完成首次冻结、既有项保序、新项追加与消失项清理，不缓存或改写 Core Snapshot |
| Renderer `NavigationRefreshCoordinator` | 全局唯一地合并失效信号、串行 `navigation.snapshot`、处理 trailing generation、退避重试与可见性；Snapshot 提交后另行触发 Project membership 同步 |
| Foreground safety refresh | 前台可见时约 20 秒低频重读；App 隐藏时停止，窗口重新获得焦点时立即重读 |
| Overview loader | 并行加载 Navigation、Members、Runtime Installation、Memory Review 与本机 Navigation preference；首次用当前可见 Project 顺序初始化 `projectOrder`，各模块失败不关闭 Navigation 协调器 |

## Post-commit invalidation flow

```text
authoritative mutation transaction commits
  -> Core handler / async lifecycle confirms non-rejected result
  -> Core emits navigation.invalidated { reason, campId? }
  -> Main forwards the hint
  -> Renderer requests one global refresh generation
  -> Coordinator reads navigation.snapshot
  -> Renderer commits the complete Snapshot atomically
  -> Renderer submits the visible Project key list to Main
  -> Main synchronizes projectOrder without reordering surviving keys
  -> Renderer projects Sidecar Projects by the saved order
```

`navigation.invalidated` 只说明已有权威投影可能过期。`reason` 用于诊断，`campId` 只用于观察范围；Renderer
不得从 payload 增量修改标题、Camp 顺序、marker 或 unread，也不得用消息活动改写 `projectOrder`。通知顺序必须是
**先提交，后通知**。普通请求型
mutation 在 `Core::handle` 成功返回、数据库 guard 释放后通知；若提交后仍有可能失败的文件清理或投影收尾，
则在事务提交和 guard 释放后、开始该收尾前立即通知，不能因后置清理失败丢失已成立的 mutation。Runtime
start、cancel、recovery blocker resolution 与 terminal 在对应状态写入成功后通知。被拒绝的命令不发失效通知。

Pending Camp 的 Composer Draft 只有在 `activation_state = pending` 时影响 Navigation，因此 Core 在通知前只做
一次窄 activation 查询；Active Camp 的逐字 Draft 保存不产生全局 Snapshot 风暴。Camp create/rename/delete、
Pending Draft/attachment、用户消息 admission、Camp viewed、Run queued/started/cancelled/terminal 与 recovery
blocker resolution 都必须最终进入同一失效入口。

## Coordinator semantics

协调器以 requested/completed generation 表达刷新意图，对调用方只暴露一个按 trigger 请求刷新的 seam：

- 普通 invalidation 使用 80 ms debounce；连续事件只推进 requested generation；
- 同一时刻最多一个 `navigation.snapshot` 在途；
- 读取开始后到达的新 generation 不丢失，当前读取完成后继续 trailing read，直到 completed generation 追上
  requested generation；
- 同一轮所有调用者共享一个 Promise；该 Promise 只在完整 drain 到安静点后 resolve，trailing failure 由同一
  Promise reject，不产生无人观察的异步错误；
- App 中所有事件、显式 mutation follow-up、focus 与安全轮询都经过该协调器，不存在 per-Camp timer 或第二条
  Navigation 读取路径。

Promise 完成只表示新 Snapshot 已提交到 Renderer state，不承诺浏览器已经完成下一帧 paint。

## Sidecar Project order synchronization

`navigation.json` schema 3 的 `projectOrder: string[] | null` 只保存 canonical
`directory:<projectPath>` key。合法 schema 2 以 `null` 读取而不被视为损坏；`null` 与空数组不同，前者表示尚未
首次冻结，后者表示已经在空列表上完成冻结。第一次同步按 Core 当前 Project 数组顺序写入所有未被本机移除的
Project。后续每次同步执行同一确定性规则：

1. 从旧顺序删除本次列表中已不存在的 key；
2. 保留其余 key 的原相对顺序；
3. 把本次列表中尚未保存的 key 按发现顺序追加到末尾。

相同结果不写文件。Project 的消息、Run、时间或未读变化不会改变 key 集合，因此不能移动 Project；Core 仍在每个
Project 内按 `lastActivityAt`、global sequence 和 Camp ID 排列 Camp。刚选择但尚未形成 Core Project 的空目录由
Renderer 作为新项追加到当前列表尾部；形成 Camp 后再进入相同同步规则。

Project 本机移除会同时清理其顺序 key；重新选择或恢复后，它作为新发现项追加。偏好同步由与 pin/移除/恢复相同的
Main 串行队列保护，Renderer 用 generation 忽略迟到返回。同步失败可以显示本机保存错误，但已经提交的 Core
Navigation Snapshot 和协调器 generation 不回滚、不停止后续失效刷新。

## Failure and lifecycle boundaries

一次读取失败时，当前共享 Promise reject，completed generation 不前进，失效意图保留。后台重试使用
`1s -> 2s -> 5s -> 10s` 上限退避；普通事件和安全轮询只合并 generation，不绕过在途退避。窗口 focus 或用户
显式重试可以取消等待并立即尝试；一次成功的 quiet-point drain 重置退避。

App 隐藏时取消 debounce、周期 timer 和后台 retry timer，但保留 requested generation；已经在途的读取可以完成，
隐藏后新增的 trailing generation 等到重新可见。重新可见会恢复保留意图，重新聚焦立即刷新。20 秒刷新只修复
极少数丢失事件，不承担正常终态收敛，也不依赖 Overview 的全局 `ready | error` 状态。

Navigation 拥有独立 loading/ready/error 状态。Members、Runtime Installation、Memory Review 或 Navigation
preference 失败可以报告自己的错误，但不能停止 Navigation retry、事件刷新或安全轮询。Core restart 后的
`runtime.state = ready` 通过同一协调器立即恢复。

## Acceptance

- 多个 Camp 同时终态只形成一个在途读取与必要的 trailing read；
- 后台 Camp 终态无需打开该 Camp 或重载 Renderer 即可清除侧栏 spinner；
- trailing 失败 reject 当前调用者且自动按上限退避恢复，不形成热循环或 unhandled rejection；
- App 隐藏时不做周期 Navigation Snapshot，focus 后立即收敛；
- 即使失效事件丢失，前台 20 秒安全刷新仍能纠正；
- Overview 附属模块失败不禁用侧栏刷新；
- Core 通知只在权威 mutation 已提交后发生。
- schema 2 第一次进入时冻结旧显示顺序，合法升级不产生偏好损坏提示；
- 老 Project 的消息活动不改顺序，新 Project 追加，消失或本机移除的 Project 清理；
- Sidecar Project 稳定顺序不改变 Project 内 Camp 最近活动、时间、marker 或未读更新。

## References

- [Core Snapshot 与 API 边界](foundational-invariants.md#core-read-side)
- [产品与导航不变量](foundational-invariants.md#product-navigation)
- [Camp Open Read Path](camp-open-read-path.md)
- [App Shell 与统一侧栏](../ui/components/app-shell-navigation.md)
