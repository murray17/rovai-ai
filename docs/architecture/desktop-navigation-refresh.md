---
document_type: architecture
architecture: desktop-navigation-refresh
authority: desktop-navigation-invalidation-and-refresh-boundaries
status: accepted
last_updated: 2026-08-28
---

# Desktop Navigation Refresh 架构

本架构规定 Desktop 侧栏 Navigation Snapshot 的失效、刷新、失败恢复与前后台边界。字段与排序继续由
Core Navigation Read Model 拥有；本架构只决定何时重读权威 Snapshot，以及多个信号如何合并。

## Component authority

| Component | Responsibility |
| --- | --- |
| Core Navigation Read Model | 在一个 SQLite 读事务中投影 Project/Camp、顺序、标题、Lead、运行标记与完成未读标记；它是唯一状态真源 |
| Core mutation boundary | 影响 Navigation 投影的请求型写操作在权威事务提交后发 `navigation.invalidated`；异步 AgentRun 生命周期在对应事务成功后发同一提示 |
| Electron Main | 原样转发 Core event；不缓存、合并或推导 Navigation 状态 |
| Renderer `NavigationRefreshCoordinator` | 全局唯一地合并失效信号、串行 `navigation.snapshot`、处理 trailing generation、退避重试与可见性 |
| Foreground safety refresh | 前台可见时约 20 秒低频重读；App 隐藏时停止，窗口重新获得焦点时立即重读 |
| Overview loader | 并行加载 Navigation、Members、Runtime Installation、Memory Review 与本机 Navigation preference；各模块失败不关闭 Navigation 协调器 |

## Post-commit invalidation flow

```text
authoritative mutation transaction commits
  -> Core handler / async lifecycle confirms non-rejected result
  -> Core emits navigation.invalidated { reason, campId? }
  -> Main forwards the hint
  -> Renderer requests one global refresh generation
  -> Coordinator reads navigation.snapshot
  -> Renderer commits the complete Snapshot atomically
```

`navigation.invalidated` 只说明已有权威投影可能过期。`reason` 用于诊断，`campId` 只用于观察范围；Renderer
不得从 payload 增量修改标题、顺序、marker 或 unread。通知顺序必须是**先提交，后通知**。普通请求型
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

## References

- [Core Snapshot 与 API 边界](foundational-invariants.md#core-read-side)
- [产品与导航不变量](foundational-invariants.md#product-navigation)
- [Camp Open Read Path](camp-open-read-path.md)
- [App Shell 与统一侧栏](../ui/components/app-shell-navigation.md)
