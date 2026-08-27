---
document_type: version-decisions
version: v1.29
lifecycle: current
last_updated: 2026-08-27
---

# v1.29 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-29-d01"></a>
## V1.29-D01：移除采用原子 cutover 与持久 reconciliation 两阶段协议

### 背景

成员移除会同时碰到 Run、Delivery、Gather、Task 和 Default Lead。把全部 Runtime 中断与终态结算塞进一个
SQLite 事务既不真实，也会让长耗时外部效果阻塞权威写入；只做最终一致又会在窗口期继续接受离队成员的业务效果。

### 决定

移除命令以 membership generation/version CAS 原子结束关系、切换必要的 Lead、写取消意图、终结尚未分派的
工作并释放 Task。事务提交即形成 cutover。仍需 Runtime/Delivery terminal settlement 的工作写入持久
reconciliation，由正式终态路径推进，UI 只展示其进度。

当前规范见[动态 Camp 队员关系](../../architecture/dynamic-camp-membership.md)和
[Camp Membership v1](../../contracts/camp-membership-v1.md)。

### 后果

- “已离队”不再依赖外部进程是否已经退出；
- 终态证据可以继续收口，但不能越过 publication fence 产生新公开效果；
- 崩溃重启后 reconciliation 可从持久状态继续，而不是猜测移除是否完成。

### 被拒绝方案

- **一个事务宣称所有取消完成：** SQLite 提交不能证明 Runtime 与外部效果已终止；
- **先后台取消、最后才结束 membership：** 窗口期会继续授权业务写入。

<a id="v1-29-d02"></a>
## V1.29-D02：授权绑定 membership lifetime，不允许离开后再次添加复活旧工作

### 背景

仅检查 `actor_can_write_camp` 或当前 active membership，会让同一个 Agent 在离开后再次添加时重新满足旧
Run/Delivery 的条件。Agent ID 相同不代表旧 membership lifetime 仍有效。

### 决定

Camp 使用单调 membership generation，每段成员关系使用单调 version。AgentRun、每项 Agent 业务工具、
Delivery admission、Gather initiator/completion 与普通 publication 必须匹配冻结的 exact membership version。
普通 outbound Delivery 的 dispatch/retry 还必须匹配 source Run 的 exact membership lifetime；source 离开时，
pending Delivery 在 cutover 中终态化，已 materialized 下游 Run 纳入 reconciliation。终态 evidence 使用独立窄
授权，只能结算既有责任，不能恢复业务工具或公开发布。Active member 的 add 独立于 Member Presence，包括
`away` 在内都只有相同 capability overrides 可以 no-op；不同 overrides 必须 conflict，能力变更不能借 add
绕过 lifetime 收口。受信 source 的 accepted no-op 推进其 reconciliation generation，但不推进 Camp/member
version。

当前规范见 [Camp Membership v1](../../contracts/camp-membership-v1.md)、
[Message Delivery v7](../../contracts/message-delivery-v7.md)、[Gather v4](../../contracts/gather-v4.md)和
[Missing-Send Recovery Publication v2](../../contracts/missing-send-recovery-publication-v2.md)。

### 后果

- 再次添加在产品界面仍按普通“邀请队员”处理，但在授权上是新的 lifetime；
- 所有 Agent 业务工具共用统一 exact-run fence，不依赖各 handler 自行记得补检查；
- 已接受的普通 outbound A2A 不能在 source lifetime 结束后新建或重试下游 Run；
- Missing-Send 和普通公开输出不会成为绕过离队 cutover 的旁路。

### 被拒绝方案

- **只检查当前 active：** 旧工作会在再次添加后复活；
- **只给 send 加 fence：** Task、Memory、History 或其他业务工具仍可越权。

<a id="v1-29-d03"></a>
## V1.29-D03：Collaboration State 保持 v2，只在新 Run 冻结当前 peers

### 背景

动态名册需要让未来 Run 看见新队员，但没有必要把内部 generation、reconciliation 或变更叙事暴露给模型。
原位修改已开始 Run 的 System Context 也不可复现。

### 决定

每个新 AgentRun 在 Context 冻结时读取当前 active CampMember 集合，继续生成 Collaboration State v2。已冻结
Run 不打补丁；不新增 `rosterVersion`、membership delta 或“某成员本轮离队”字段。内部 version 只用于 Core
授权与证据。Send target admission 独立读取当时的当前 active 名册，不受 source Run frozen peer projection 限制；
因此旧 Run 可以联系后来加入的成员，同时仍受自己的 exact source membership lifetime fence 约束。

### 后果

- 后续 Run 自然得到新 peers，当前 Run 维持可复现字节；
- 旧 Run 不需要等待下一 Run 才能寻址后来加入的当前成员；
- 模型上下文没有与业务无关的动态状态噪声；
- 本版本不改变模型上下文选择、Formatter 或 wire；变化仅来自用户在 Run 前更新了既有选择所读取的领域数据。

### 被拒绝方案

- **给旧 Session 广播 roster delta：** 会产生不可重放的中途 System 状态；
- **把 frozen peers 当成 strict target roster：** 会把模型可见快照误作 send admission 权威，并阻止已确认的当前成员寻址；
- **向模型暴露 generation：** 它不是模型决策所需能力，也不是授权 token。

<a id="v1-29-d04"></a>
## V1.29-D04：外部成员事件只作受信提示，Core 命令仍是唯一权威

### 背景

未来 channel 或外部 roster 同步可能乱序、重放或来自错误租户。直接把“加入/离开”事件视为授权会扩大 System
写入面，并使同名来源互相污染。

### 决定

外部提示只有在 System component 位于 allowlist、Camp 已绑定 exact source namespace/binding，且 source
reconciliation generation 恰为上一代加一时才能进入同一正式 add/remove 命令。失败不推进来源水位，也不改变
Camp membership。Renderer/User 路径不携带 source authority。

### 后果

- 重放、跳代、错绑定和未知组件 fail closed；
- 外部同步复用正式 cutover、版本 CAS 与审计，不形成第二套写模型；
- source binding 是内部集成 seam，不是 Agent 或普通 Desktop API。

### 被拒绝方案

- **按事件到达顺序直接写名册：** 网络顺序不能证明领域顺序；
- **只校验一个全局来源名：** 不足以隔离 Camp/租户绑定与 reconciliation generation。

<a id="v1-29-d05"></a>
## V1.29-D05：Message Delivery 允许零 attempt 取消，并以独立后继迁移保持身份唯一

### 背景

带附件的 Agent-to-Agent Send 会先创建 `projection_blocked` Delivery：状态仍为 pending、attempt count 为 0，
但由 attachment projection gate 占据 recipient FIFO。CampTurn Stop 的批量取消随后尝试把该行写为
`cancelled + terminal + attempt=0`；旧 SQLite CHECK 没有允许这一取消终态，导致整个 Stop 事务以 constraint
275 回滚。显式取消和批量取消还分别维护 SQL，清理 wait、attempt 与 projection association 的集合不一致。

Migration 110、Data Contract `v1.23 / schema 64` 和 Message Delivery v6 已由 dynamic Camp membership 使用；
零 attempt 取消不能复用同一迁移或合同身份，否则由 current-main 数据库升级时会跳过 CHECK 重建，并让两种
不同结构宣称同一 Data Contract。

### 决定

Migration 111 从 `v1.23 / schema 64` 升到 `v1.24 / schema 65`，只为 Message Delivery 增加合法分支
`status=cancelled AND dispatch_phase=terminal AND dispatch_attempt_count=0`。取消不得为满足约束而创建虚假 attempt。

`MessageDeliveryService::cancel` 与 CampTurn/Execution Budget 批量取消复用一个底层 Delivery 转换。该转换保留既有
attempt count；若当前 attempting/waiting attempt 存在，则将其终结为 cancelled；随后原子清除 Delivery 的 wait、
active attempt、pre-dispatch gate 和 projection operation association，写入明确 reason、ended time、version 与事件。
入口各自保留授权、membership、Gather 和 CampTurn settlement 规则，不再各自实现第二份 Delivery 状态 SQL。

Projection success/failure 继续只 CAS 仍为 pending、仍绑定同一 operation 的 gate。取消清除 association 后，迟到
completion 可以结算 publication 自身，但不能释放、失败或重新调度已取消 Delivery。Dispatch Pump 与 startup
recovery 同样只推进非终态合格行，重启不改变 cancelled terminal。

### 后果

真实 `projection_blocked` CampTurn Stop 可以提交，pending/interrupted-before-dispatch 的零 attempt 显式取消也合法；
已有 attempt 的取消保持审计 count 并终结对应 attempt。新合同为 Message Delivery v7。升级测试从 current-main
Migration 110 数据库执行 111，并验证重启幂等与终态单调。该 hotfix 不依赖或引入 Managed Attachment v2、legacy
compatibility reconciler、Runtime permission evidence 或其他附件存储重构。

### 被拒绝方案

- 复用 Migration 110、`v1.23 / schema 64` 或 Message Delivery v6：无法区分 dynamic membership 与取消结构；
- 取消时插入虚假 attempt：破坏“attempt 只证明真实 dispatch fence”的审计语义；
- 只给批量 Stop 增加特判：显式取消、attempt cleanup 与 projection cleanup 继续漂移；
- 让迟到 projection completion 重开 Delivery：违反 terminal monotonicity，并可能在用户停止后唤醒 Agent；
- 把本 hotfix 绑定到 Managed Attachment v2：扩大故障恢复时间，并让独立取消正确性依赖未交付 Schema。

<a id="v1-29-d06"></a>
## V1.29-D06：新附件使用独立 Managed v2，Context 保持 DB-only

### 背景

旧附件发送先把语义提交为 legacy publication intent，再等待 Camp Published View write admission。活跃 AgentRun
在整个生命周期持有同 Camp read admission，因此 A 运行中发送附件给 B 会形成 `projection_blocked + attempt=0`，
直到 A 结束才可能复制、释放 gate 并开始 B 的 dispatch。零 attempt cancellation hotfix 只修复取消 CHECK，不能
消除这一等待关系。

### 决定

Migration 112 从 `v1.24 / schema 65` 升到 Data Contract `v1.25 / schema 66`，新增
`managed_attachment`、`camp_message_attachment_ref`、`managed_attachment_ingest_intent` 与简单 Camp attachment
revision。Composer/Agent 的所有新附件在 Send 时经私有 staging 复制一次到既有 Camp Runtime root 的 opaque
`.managed-v2` identity；最终事务原子提交 available resource、Message refs、CampMessage、Deliveries、Draft
消费与 intent。相同 Camp v2 identity 再引用只新增 ref。

Managed v2 永不取得 legacy View write admission、等待 quiescence/活跃 Run、推进 generation、停止/fence Run 或
创建 projection gate。新 Delivery 直接走普通 Dispatch Pump。历史 `message_attachment` 与 Authority/View 不迁移、
不双写，只保留旧读取和未完成 operation 收口。

Context、Camp Open 与 Camp History 对 v2 只读 SQLite metadata 并构造路径，不在每次 materialization 中
`stat/open/read_dir/digest` payload。路径真正不可读时由 Runtime/Tool 原生失败处理；不新增 unavailable
descriptor、伪造正文或 Run Fact，也不因一次 Runtime 权限/读取错误改写附件全局状态。Runtime 继续获得现有
Camp-scoped `attachments` root，不建立 per-Run copy、Inline、Host broker 或通用权限证据平台。

新 Context 只为成功解析的 legacy v1 引用冻结 legacy receipt；无成功 legacy 引用时使用 no-legacy sentinel，
不得读取或验证 `camp_attachment_view`。legacy locator/View 解析失败只产生安全诊断并省略该引用。新 Run 直接验证
稳定 Camp root，使用 `live_append_v1` compatibility；Scheduler 不再取得 legacy read admission、检查 unresolved
writer intent 或在 dispatch 前重建 View。旧 publication gate/generation 仅收口升级前遗留 operation。

当前规范见 [Camp Attachments](../../architecture/camp-published-attachment-view.md)、
[Camp Attachment v6](../../contracts/camp-attachment-v6.md)、
[Camp Composer Draft v5](../../contracts/camp-composer-draft-v5.md)、
[Camp Message Send v13](../../contracts/camp-message-send-v13.md)和
[Message Delivery v8](../../contracts/message-delivery-v8.md)。

### 后果

- A 保持 running 时，其附件可完成 v2 commit，B 的 attempt 可在 A 结束前开始；
- v2 没有第二份 Authority，Runtime 同 UID 强隔离不再是产品保证；
- Context 热路径不会因历史文件缺失增加逐附件磁盘 I/O；
- 坏掉或未完成的 legacy View 不再阻断不引用成功 legacy 路径的 Context、Runtime Input Delivery 或 v2-only Run；
- 0.01/0.02/0.03 等旧库按顺序升级，legacy Camp 无需转换历史附件即可继续对话并写入 v2；
- 显式 preview/open 仍执行动作时完整校验，不把该成本转移到每次 Context。

### 被拒绝方案

- 继续修补 generation fencing 或等待活跃 Run：保留了导致 A2A 延迟的根因；
- per-Run copy、Inline 或 Host broker：建立额外 Authority/权限兼容平台，超出性能修复范围；
- 启动时批量迁移或 v1/v2 双写：扩大升级风险且不解决新写路径锁依赖；
- Context 每次探测本地文件并生成 unavailable descriptor：把文件系统扫描放回热路径，并替 Runtime 猜测失败。

<a id="v1-29-d07"></a>
## V1.29-D07：退出 Rovai 等于取消所有 AgentRun

### 背景

此前主动退出先请求 Runtime 收敛，并优先等待可靠终态。直接退出会把这段等待放在关闭路径中；用户先手动
取消 AgentRun 时，等待已提前发生，因此随后关闭明显更快。两条路径对用户的最终意图一致，却有不同的耗时
与反馈。

冷启动的全局恢复提示也会在目标数据很快就绪时短暂闪现，让正常打开看起来像一次恢复操作。队员页和记忆页
已经有稳定页面结构，不需要为短等待替换整页。

### 决定

主动退出、重启与更新统一表示取消全部非终态 AgentRun。Core 持久化 shutdown cycle、关闭新 launch 并完成
稳定快照后，立即关闭 terminal/route 准入；随后只给 Runtime 600ms best-effort 中断窗口，在同一产品事务中
写入 Run-local 取消请求、`app_shutdown_cancel_all` 原因和确认时间，再把 Run 结算为 `cancelled`。Runtime route
回收最多等待 2 秒，Desktop 保留 10 秒硬 deadline。

Migration 113 保持当前 Data Contract 与 projection schema marker，只把 `planned_shutdown_cycle` 的协议约束从
仅 v2 扩为 v2/v3。已有 row 原样复制，历史 pending v2 cycle 继续可辨识，新退出只持久化 v3。

退出不伪造 Runtime terminal，也不抹除已存在的 unknown-effect 证据。该动作不写 CampTurn 取消意图；依赖被
取消 Run 的 CampTurn 按既有 required-run 规则结算。升级前已持久化的 v2 cycle 继续按历史语义补偿。

冷启动立即开始读取 Main Window Session 与目标数据。前 400ms 不显示加载反馈；超过门槛后只在目标内容区
显示局部反馈，错误仍立即显示。队员页和记忆页保持既有结构。关闭时立即阻止新的界面交互，前 400ms 不显示
反馈；超过门槛后以“正在安全退出”说明本地状态保存与后台服务关闭，并条件说明尚未完成的 AgentRun 会取消。

### 后果

- 直接退出与先手动取消再退出使用同一产品语义，正常活跃 Run 的关闭验收目标为 5 秒内完成；
- 关闭延迟不再由 Runtime 是否及时给出可靠 terminal 决定，迟到 terminal 也不能越过已关闭准入改写产品终态；
- 每个被退出取消的 Run 都有可审计的取消请求、原因和确认时间，未知外部效果仍可单独展示；
- 快速冷启动和快速退出都不再闪现等待提示，慢操作仍提供与当前阶段一致的进度反馈。

### 被拒绝方案

- 保留可靠终态优先等待并只美化弹窗：不消除直接退出与手动取消后退出的耗时差异；
- 在 Renderer 中先逐个发起取消再关闭 Core：增加多入口竞态，且不能提供单一稳定快照与原子结算；
- 启动时立即显示全局恢复页：短加载持续闪现，并遮蔽用户上次使用的位置；
- 退出时立即显示取消全部 AgentRun：零 Run 或快速收口时会闪现与实际工作量不匹配的反馈；
- 完全不显示启动反馈：慢磁盘、迁移或数据错误时缺少可理解的状态。
