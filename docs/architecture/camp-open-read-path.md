---
document_type: architecture
architecture: camp-open-read-path
authority: desktop-camp-enter-and-progressive-read-boundaries
status: accepted
last_updated: 2026-09-04
---

# Camp Open Read Path 架构

字段与窗口见 [Camp Open Projection v15](../contracts/camp-open-projection-v15.md)与
[Camp Conversation Find v1](../contracts/camp-conversation-find-v1.md)。本架构把“进入会话”、
“继续阅读”、“查找完整当前会话”和“检查运行详情”分成用途明确的接口，同时保持 SQLite Read Side
为唯一权威。

## Component authority

| Component | Responsibility |
| --- | --- |
| Main Window Session | 只冻结并返回本地恢复目标与设置位置；不等待 Core，也不保证目标领域数据已经加载 |
| Renderer startup controller | 快照返回后立即显示候选目标的一级页面框架；候选 Camp 与 committed Camp 分离，只有 enter 成功才提交权威 Camp 内容 |
| Renderer enter controller | 生成 trace/command ID、selection generation 与 high-water fence；应用内缓存未命中时保留当前 surface，投影到达后原子 commit 目标 Camp/项目并完成 meaningful paint，再恢复项目导航、确认可见来源和刷新侧栏 |
| Electron Main bridge | allowlist typed method、记录不含内容的 IPC roundtrip/response bytes；不组装或缓存领域投影 |
| Core Camp enter module | 在一次串行 request 中先读 activation state；Pending 直接读取投影，Active 顺序执行 Default Lead reconcile 与 post-reconcile read；缺失或 rejected 时 fail closed |
| Core Camp open read model | 在单一 SQLite transaction 中组装业务首屏投影、完整 non-terminal Execution Evidence、coverage 与 high-water；不读取 event_log 或 Context Manifest/Action history |
| Camp message history read | 以 stable sequence cursor 读取 earlier page；不回放 event 构造第二真源 |
| Camp conversation find read | 扫描当前 Camp 公开 user/agent 正文投影，返回 exact total 与一个选中命中；不改变 Agent-facing discovery search，也不返回完整结果集 |
| Run detail read | terminal Run 在用户展开后复用 Evidence page/content 接口；大 Evidence 正文继续按需读取，不随普通 Camp open 挂载 |
| Full Camp snapshot | 兼容、诊断与定向测试面；保持纯读，但不服务普通 open/refresh |

## Enter and refresh flow

service 在读取投影前只对目标 Camp 做旧半取消存在性检查；命中才使用统一取消事务收口。无命中不写数据，
普通 waiting/recovery 和其他 Camp 不变。该兼容补偿不读取 event_log，不改变 ReadModel 的只读边界。
ReadModel 另对 #153 已写入的精确取消失败形状做只读兼容：有 cancel intent、无 Runtime terminal source 的
`failed/accepted_input_outcome_unknown` 公开为 cancelled 且无外部效果提示。它不更新原行或底层 evidence，
也不匹配普通 Recovery Blocker resolution。

Open 仅读取当前 Camp 的业务表。它及其嵌套 loader、CTE、view 不得访问 `event_log`；消息专用
`load_open_messages()` 复用正文、附件和 presentation hydration，但不查询 publication event sequence。
附件 hydration 对 source refs、Managed v2 和 legacy rows 统一返回无路径 View 与
`availability = unknown`；Open、earlier、around、thread 和 timeline 不为可用性访问文件系统。
`throughGlobalSequence` 仍从 `event_sequence` singleton 读取，不通过事件表求最大值。移除 timeline 与其
exact count 后，打开成本不随其他 Camp 的事件历史增长；当前 Camp 的活动 Evidence 完整性不因此降级。

此边界只约束投影读取，不撤销 Active enter 的 reconciliation/command receipt，也不修改完整
`camp_snapshot()`、显式 History/Find、Navigation 或 `events.subscribe` 的审计与 invalidation 语义。
无需清理旧数据、补历史字段、迁移或给旧 event 查询补索引。

```text
app click / notification target
  -> Renderer camps.enter(traceId, commandId, campId)
  -> cache miss keeps the current surface; no target route is committed yet
  -> Core reads authoritative activation state
       -> Pending: skip reconciliation
       -> Active: serialized Default Lead reconciliation
  -> Core read transaction + complete non-terminal Evidence + bounded other collections + throughGlobalSequence
  -> Main parses typed response
  -> Renderer atomically commits target Camp ID + project + recent Camp surface
  -> next meaningful paint
  -> background project restore / campViewed / navigation refresh

cold startup
  -> Main Window Session returns a frozen local target
  -> Renderer paints the target route shell and removes the global StartupGate
  -> Renderer queues camps.enter ahead of Overview/preferences/runtime health
  -> Core activation-aware enter + complete non-terminal Evidence + bounded other collections
  -> Renderer commits Active Camp or meaningful Pending Camp Draft + meaningful content
  -> background navigation / campViewed / project restore

Core event invalidates active Camp
  -> coalesced Renderer camps.open(traceId, campId)
  -> accept only non-regressing high-water
  -> preserve explicitly loaded earlier message pages
```

Core 在可靠终态持久化后发出的 `agent_run.terminal` 必须使 Renderer 重新读取当前 Camp 的权威投影；
Renderer 不得从通知 payload 推导终态，也不得等待用户重进 Camp 才收敛。当前通知未必携带 `campId`，因此
Renderer 可以对当前 Camp 做一次有界的额外 refresh；通知明确携带其他 Camp ID 时不得刷新当前 Camp。
`agent_run.runtime_model_observed` 与其他 Run projection 变化共用上述 invalidation/refresh 路径，但必须精确匹配
当前 Camp。它只使 `AgentRunView.runtimeModel` 从默认未观察态收敛到首个可信模型，不进入 timeline、
CampMessage 或 Run detail Evidence，也不自动打开执行台或改变当前 selection。

同一 Camp 的 event-driven refresh 只允许一个 `camps.open` 在途；在途期间到达的一个或多个 invalidation
合并为 dirty 状态，并在当前读取完成后至多追加一次 trailing refresh。不能只复用旧 Promise 后丢弃新的
invalidation，因为后一个终态可能在首个 read transaction 开始后才持久化。trailing refresh 期间再次变脏时，
按同一规则继续到安静点；Camp 切换与 high-water fence 仍负责拒绝旧 Camp 或倒退投影。

当前 Camp 的 `camps.open` coordinator 与全局 Navigation coordinator 是两个用途不同的 seam：前者维护已打开
会话的完整内容和 high-water，后者只在 Core post-commit invalidation 后重读侧栏 Snapshot。终态事件可以同时
使二者失效，但不得让当前 Camp refresh 代替后台 Camp marker 收敛，也不得为每个 Camp 建立 Navigation timer。
全局合并、失败退避、可见性与 20 秒安全刷新见
[Desktop Navigation Refresh](desktop-navigation-refresh.md)。

缓存只保存最近的 Camp 投影；除完整 non-terminal Evidence 外，其他 collection 保持有界。cache hit 可立即
恢复阅读面，但仍由 high-water refresh 验证；cache miss 不把
当前 Snapshot 清空，也不提前切换 route。普通请求在 400 ms 内不呈现 loading，超过预算只在目标导航行
显示非阻塞进度。schema mismatch、Core restart、Camp mismatch 或 sequence regression 使缓存失效。
Renderer 不通过 event replay 补齐权威对象。

## Complete conversation find flow

```text
Command/Ctrl+F in mounted CampWorkspace
  -> map view switches to the existing conversation surface
  -> Renderer camp.messages.find(campId, query, selectedIndex?, visibleAnchor?)
  -> Core exact scan in one read transaction
  -> response contains total + one target only
  -> target missing from mounted timeline
       -> Renderer camp.messages.around(campId, messageId)
       -> merge bounded anchored window without changing open coverage
  -> center target, keep find input focused, highlight visible body occurrences
```

Find 不属于 Camp enter meaningful-paint 依赖，也不得预取完整历史。Renderer 的本地高亮只消费已挂载
user/agent 正文节点；exact total、顺序和目标由 Core 响应拥有。查询、Camp 或 request generation 已变化时，
旧 find/around 响应必须丢弃。关闭查找恢复打开前阅读位置与焦点，不修改 Draft、Inspector、Approval、
执行台或领域已读状态。

冷启动 route shell 只证明恢复目标已确定，不证明 Camp 存在；Active Camp 也不保证 Default Lead 已 reconcile。
它不得设置
`activeCampId`、触发 `campViewed`、提交下次恢复位置或启用 Notification navigation。Camp、Members 与
Memory 分别拥有局部 loading/error；全屏 StartupGate 只允许覆盖 Main Window Session 本地快照读取失败。

## Failure boundaries

- Active enter reconcile/read 或 Pending enter read 失败：保留原 surface 并显示非阻塞错误，不展示未取得
  权威投影的新 Camp；
- 冷启动 enter 失败：调用一次 `camps.exists`；只有明确为 false 才回到 Quick Chat，true 或存在性检查失败
  都保留候选 shell 并允许重试，不分页扫描 Navigation groups；
- 首屏后项目导航恢复失败：已打开 Camp 保持可用，在导航 surface 报错，不回退快速对话；
- earlier page 失败：保留已加载消息和滚动位置，原位允许重试；
- detail 失败：只影响对应 Drawer/Inspector，不覆盖会话与 Draft；
- 快速 A→B 切换：旧 generation、旧 Camp 或倒退 high-water 响应一律丢弃。

## References

- [Core 受管内容不变量](foundational-invariants.md#core-managed-content)
- [协作与执行准入不变量](foundational-invariants.md#collaboration-admission)
- [Camp Open Projection v15](../contracts/camp-open-projection-v15.md)
- [Camp Conversation Find v1](../contracts/camp-conversation-find-v1.md)
- [Desktop Navigation Refresh](desktop-navigation-refresh.md)
