---
document_type: architecture
architecture: camp-open-read-path
authority: desktop-camp-enter-and-progressive-read-boundaries
status: accepted
last_updated: 2026-09-27
---

# Camp Open Read Path 架构

字段与窗口见 [Camp Open Projection v24](../contracts/camp-open-projection-v24.md)与
[Camp Conversation Find v1](../contracts/camp-conversation-find-v1.md)。本架构把“进入会话”、
“继续阅读”、“查找完整当前会话”和“检查运行详情”分成用途明确的接口，同时保持 SQLite Read Side
为唯一权威。

## Component authority

| Component | Responsibility |
| --- | --- |
| Main Window Session | 只冻结并返回本地恢复目标与设置位置；不等待 Core，也不保证目标领域数据已经加载 |
| Renderer startup controller | 快照返回后立即显示候选目标的一级页面框架；候选 Camp 与 committed Camp 分离，只有 enter 成功才提交权威 Camp 内容 |
| Renderer enter controller | 生成 trace/command ID、selection generation 与 high-water fence；应用内缓存未命中时保留当前 surface，投影到达后原子 commit 目标 Camp/项目并完成 meaningful paint，再确认可见来源并仅更新目标导航行 |
| Electron Main bridge | allowlist typed method、记录不含内容的 IPC roundtrip/response bytes；不组装或缓存领域投影 |
| Core request ingress | 持续接收请求；有顺序要求的命令与混合操作交给单一 FIFO worker，执行窗口 page/changes 复用既有独立派发任务，不建立优先级调度器或第二套 RPC |
| Core Camp enter module | 在一次有序 request 中先读 activation state；Pending 直接读取投影，Active 先按原 Envelope 查 receipt 并校验 Lead，有效新 User enter 只读，需要修复时 reconcile 后再读；缺失或 rejected 时 fail closed；不执行取消或文本维护 |
| Core Camp open read model | 在单一 SQLite transaction 中组装业务首屏投影、空 Execution Evidence、有界业务 coverage 与 high-water；保留已返回 Run 的定向原始 Evidence 计数和独立 change watermark，不计算 Camp-wide Evidence 总数；不读取 event_log 或 Context Manifest/Action history，不执行业务 SQL 或 Blob/文件写入 |
| Camp message history read | 以 stable sequence cursor 读取 earlier page；不回放 event 构造第二真源 |
| Camp conversation find read | 扫描当前 Camp 公开 user/agent 正文投影，返回 exact total 与一个选中命中；不改变 Agent-facing discovery search，也不返回完整结果集 |
| Run detail read | 可见展开的 Run 使用逻辑操作窗口与相邻页预取，单条展开复用 content 接口；大 Evidence 正文继续按需读取，不随普通 Camp open 挂载 |
| Full Camp snapshot | 兼容、诊断与定向测试面；保持纯读，但不服务普通 open/refresh |

## Enter and refresh flow

service 在读取投影前不再执行取消修复或文本定稿。退役两阶段取消协议留下的持久中间态在 Full Core 启动时、
通用 execution/input/delivery recovery 之前一次性使用统一 settlement 收口；它只匹配精确取消意图和未完成关联状态，
重复启动不再次结算。ReadModel 另对 #153 已写入的精确取消失败形状做只读兼容：有 cancel intent、无 Runtime terminal source 的
`failed/accepted_input_outcome_unknown` 公开为 cancelled 且无外部效果提示。它不更新原行或底层 evidence，
也不匹配普通 Recovery Blocker resolution。

Open 仅读取当前 Camp 的业务表。它及其嵌套 loader、CTE、view 不得访问 `event_log`；消息专用
`load_open_messages()` 复用正文、附件和 presentation hydration，但不查询 publication event sequence。
附件 hydration 对 source refs、Managed v2 和 legacy rows 统一返回无路径 View 与
`availability = unknown`；Open、earlier、around、thread 和 timeline 不为可用性访问文件系统。
`throughGlobalSequence` 仍从 `event_sequence` singleton 读取，不通过事件表求最大值。移除 timeline 与其
exact count 后，打开成本不随其他 Camp 的事件历史增长；执行详情改由独立窗口读取，完整历史仍可按需访问。

Open schema 8 也不再精确计算或公开 Camp-wide 原始 Evidence coverage。最多 96 个返回
Run 仍包含各自的 `executionEvidenceCount` 和 `executionEvidenceChangeSequence`，两者从 `agent_run_id`
定向获得；前者是原始行数，后者是新 Evidence INSERT/UPDATE 的单调水位。Renderer 只用后者失效增量窗口；
原位更新时行数可以不变，因而计数不得再充当 revision。
历史 Run 水位保持 0 且不回填，初始 page 与旧 refresh-ID 兼容读取仍可用；原始计数不是全 Camp 合计，
也不被最多 96 个 Run 的局部求和代替。因此打开 Camp A 的 SQL
VM 工作量不得随 Camp B 的 Evidence 历史规模增长。

Run 标题由 ReadModel 按所返回 Run 的首条输入或历史触发关系定向取得，作为有界 `inputSummary`
随 Run 返回。它复用当前消息正文渲染与附件 metadata，不依赖首屏 20 条聊天消息、不扩大历史窗口、
不回填持久副本。Renderer 直接使用该摘要，因此重启、缓存淘汰和聊天分页不会让旧 Run 丢失标题。

此边界只约束投影读取，不撤销已执行 Active reconciliation 的 command receipt，也不修改完整
`camp_snapshot()`、显式 History/Find、Navigation 或 `events.subscribe` 的审计与 invalidation 语义。
Migration 168 只增加新水位字段并保留历史默认值；无需清理旧数据、回填历史 Evidence 或给旧 event 查询补索引。

取消、成功与失败的普通终态继续由 Domain Command Gateway 在业务事务提交后收尾文本；受控关闭和
planned-shutdown 的直提交流程在自己的提交后调用同一入口，不在 Adapter 回调重复实现。若业务与回执已提交、
文本定稿失败，原 block 保留单调到期时间，由既有 `process_agent_run_maintenance` tick 到期尝试一次；无失败或
尚未到期时只读内存，不扫描 Run/Camp。成功复用 block event 更新执行台，失败有界退避；重试绝不重放业务。
该进程内状态不承诺跨重启恢复尚未持久化的正文。

```text
app click / notification target
  -> Renderer camps.enter(traceId, commandId, campId)
  -> cache miss keeps the current surface; no target route is committed yet
  -> Core reads authoritative activation state
       -> Pending: skip reconciliation
       -> Active: replay prior receipt or validate current Lead; reconcile only when needed
  -> Core read transaction + bounded business collections + per-returned-Run evidence count/change water + throughGlobalSequence
  -> Main parses typed response
  -> Renderer atomically commits target Camp ID + project + recent Camp surface
  -> next meaningful paint
  -> background target row read / observed campViewed / authoritative row update

cold startup
  -> Main Window Session returns a frozen local target
  -> Renderer paints the target route shell; the shared startup canvas appears only after the 400ms threshold
  -> Renderer queues camps.enter ahead of Overview/preferences/runtime health
  -> Core activation-aware enter + bounded business collections + per-returned-Run evidence count/change water
  -> Renderer commits Active Camp or meaningful Pending Camp Draft + meaningful content, then fades the canvas
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
按同一规则继续到安静点；Camp 切换与 high-water fence 仍负责拒绝旧 Camp 或倒退投影。发送消息、重命名
Camp 和更换 Default Lead 后的纯视图刷新也进入这个 coordinator，不再绕过它并行提交重复 `camps.open`；
未知命令结果所需的定向确认读取不在该合并规则内。

当前 Camp 的 `camps.open` coordinator 与全局 Navigation coordinator 是两个用途不同的 seam：前者维护已打开
会话的完整内容和 high-water，后者按 Core post-commit invalidation 的范围重读目标行或分组。终态事件可以同时
使二者失效，但不得让当前 Camp refresh 代替后台 Camp marker 收敛，也不得为每个 Camp 建立 Navigation timer。
全局合并、失败退避、可见性与 20 秒安全刷新见
[Desktop Navigation Refresh](desktop-navigation-refresh.md)。

Navigation 从 camp 的活动/完成摘要读取，正常刷新不再聚合历史事件。活动摘要在发布/终态事务中更新，
仅升级时一次回填。普通 enter/open 不全局失效、不触发侧栏完整读取或使命/技能目录查询；初次启动、未知
范围和完整性恢复仍可读取摘要完整快照。已读只确认已正式展示水位以内的新完成内容，回执返回目标行；
重复确认不写入。可见通知来源确认仍遵守 [Notification Episode v8](../contracts/notification-episode-v8.md)。

缓存只保存最近的 Camp 业务投影；collection 保持有界，执行详情将实测高度虚拟列表与跨 Camp 保留的有界数据缓存分开。cache hit 可立即
恢复阅读面，但仍由 high-water refresh 验证；cache miss 不把
当前 Snapshot 清空，也不提前切换 route。普通请求在 400 ms 内不呈现 loading，超过预算只在目标导航行
显示非阻塞进度。schema mismatch、Core restart、Camp mismatch 或 sequence regression 使缓存失效。
Renderer 不通过 event replay 补齐权威对象。

## Execution window flow

可见展开的 Run 在首屏后读取一页 `agentRunExecution.page`，按详情高度估算页大小，并预取相邻更早一页。
用户滚到边界或主动点击才继续加载；预取不挂载 DOM，也不递归读完整 Run。操作开始/完成按稳定身份合并，
较早但仍运行的操作由最新页补充，不影响历史 cursor。完整输出和文件 Diff 在单条展开后读取。

`agentRunExecution.page/changes` 不等待无关的有序 Core request 返回，也不以前一轮 `camps.enter/open` 响应
作为前置条件。Core 的输入读取与有序 FIFO worker 分离，执行窗口沿既有独立派发路径直接进入读取；Camp
投影和执行窗口都在离开数据库临界区后再序列化响应。因此，无需数据库事务的慢准备或响应组装不能把冷展开
压在队尾。该边界不伪造数据库并发：运行中活动文本仍由原 `Database` 对象叠加，page/changes 与写入、Camp
投影继续竞争同一个数据库 mutex；只有测量证明这里仍是主要等待时，才另行评估终态只读连接。

Renderer 保留连续已加载区间，用实测高度占位虚拟化视口外内容；长工具组内部同样虚拟化。首屏 12–48 项，
历史页 64 项；只有用户接近未加载边界才读下一批。正文在可见行中读取，命中缓存或在途请求则复用。
运行中通过 `agentRunExecution.changes` 按独立 `changeSequence` 水位追加/更新逻辑项，同时刷新任何原地变化的
生命周期记录；固定展示 `sequence`、Evidence 行数和 `executionEvidenceCount` 都不能充当更新游标。
增量合并不改变历史 cursor，不把可见内容裁回最新一页。Camp 切换只卸载订阅与 DOM，保留有界 session 缓存；
切回先显示最新缓存，再补齐变化。虚拟高度调整与翻页保留锚点，初始跟随意图等异步内容到达后完成。
预算、淘汰后按需恢复和字段由 Camp Open v24 拥有。

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
Memory 仍分别拥有读取与错误状态，但冷启动可见反馈共用不透明整窗品牌画布：不足 400ms 无提示，超时后只显示品牌标记，
真实目标提交后淡出。Main Window Session、Camp、Members 或 Memory 的冷启动读取失败进入独立整窗恢复面；该呈现变化
不授予权威查询、route commit、已读或恢复位置写入能力。应用已就绪后的普通切换继续使用各自的局部反馈。

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
- [Camp Open Projection v24](../contracts/camp-open-projection-v24.md)
- [Camp Conversation Find v1](../contracts/camp-conversation-find-v1.md)
- [Desktop Navigation Refresh](desktop-navigation-refresh.md)
