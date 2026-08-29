---
document_type: version-decisions
version: v1.29
lifecycle: historical
last_updated: 2026-08-29
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
进入关闭状态后不再发起页面投影刷新，取消结算产生的晚到请求拒绝不作为新的操作错误展示。

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

<a id="v1-29-d08"></a>
## V1.29-D08：Command Diff 与 Run 文件变化共享 Evidence，但使用独立投影

### 背景

Runtime 可能对一个 Operation 报告文件变化，也可能在 Run/Turn 终态提供覆盖整次运行的 diff snapshot。用户既要在
执行过程看到“修改 xxx”，也要在会话中查看本次 Run 已报告的文件变化。两者都应以 Runtime Evidence 为来源，但
Operation identity 与 Run summary 的归约、排序和降级规则不同。

### 决定

1. `Command Diff` 是具体 Canonical Activity 的 typed projection；`AgentRun File Changes` 是
   `agentRunId + executionEpoch` 的 read projection；
2. 两者都只读取 append-only Execution Evidence。Command projector 不依赖 Run projector，Run projector 也不依赖
   Command Diff merge 的结果；
3. Command Diff 不创建 `OperationDiffActivity`，不复制 `phase`、`outcome` 或 Activity identity。Run projection
   不是 Activity，也不修改已有 Activity 的排序或计数；
4. Evidence 必须保留 `FullBeforeAfter | UnifiedDiffSnapshot | ExactMutation | OperationOnly` 的源语义与完整 bytes；
   Renderer 所需 diff 是确定性派生结果；
5. 只有 Adapter 能证明的成功终态数据可进入。局部 mutation 不包装成完整文件差异，仅路径不获得计数，shell
   命令、当前文件和语义不明字段不补猜；
6. 旧 Evidence 不做无法证明正确的回填；v1 presentation 由 [V1.29-D10](#v1-29-d10)冻结。

当前规范见 [Runtime File Change Observation](../../architecture/runtime-file-change-observation.md)与
[Runtime File Change Observation v2](../../contracts/runtime-file-change-observation-v2.md)。

### 后果

- Operation 与 Run 两种读取仍从 append-only Evidence 确定性重建，不增加可独立写入的 Activity；
- failed/cancelled Run 可以展示终态前已确认成功的文件操作，而 failed/cancelled Operation 不进入；
- 每个 Adapter/version 必须先完成 public normalizer、Registry、fixture 和语义证明，接入成本高于字段名猜测；
- Command Diff 不自动证明整次 Run 的净结果，Run projection 也不改变单个 Tool 的 identity。

### 被拒绝方案

- **为 diff 新建第二类活动：** 会复制现有 Tool/Command 的 phase、outcome 与排序权威；
- **按字段名自动识别 `diff` / `patch`：** 无法区分局部片段、增量事件与完整快照；
- **读取当前文件补全 Runtime 片段：** 会扩大文件读取授权，并把晚到工作区状态伪装成 Operation 证据；
- **让 Run card 读取 Command Diff projection：** 会把 Activity merge 策略错误变成 Run Evidence 权威，并丢失
  operation-only 与权威 Run snapshot 语义。

<a id="v1-29-d09"></a>
## V1.29-D09：放弃 Workspace capture，文件变化完全由每个 Run 的 Runtime Evidence 决定

### 背景

Git baseline/final capture 试图观察 Runtime 没有报告的工作区净变化，但必须扫描文件、写 synthetic tree/ref、
协调重叠 Run 并处理稳定性、超时与恢复。它仍无法证明某个 Agent 的因果归属，还会让附加观察阻塞正常 Run，并把
未跟踪内容写进用户 Git object database。这个版本尚未发布，不需要保留该模型的 wire 或数据兼容。

### 决定

1. 删除 `WorkspaceChangeWindow`、participant、coordinator、baseline/final manifest/OID、cleanup ledger、
   synthetic tree、`refs/rovai/w/*`、tree-to-tree diff、Window Evidence/RPC/Read Model 与旧 Workspace Window Review；
2. 每个 `agentRunId + executionEpoch` 只从该 Run 的 append-only Runtime Evidence 归约一份文件变化 projection；
   不同 Run 即使同 Camp、同 execution root 或时间重叠，也不共享或等待；
3. Git 与非 Git execution root 使用同一逻辑。Core 不做 repository discovery、workspace scan、当前文件读取或
   shell inference；
4. Run terminal ingress flush 后立即投影。成功、失败或取消 Run 都可包含先前成功文件操作；没有可靠 Evidence
   则写内部 `no_changes` checkpoint，不显示卡片。Codex/ACP cancellation 必须以 Host ingress fence 串行化最后一次
   route/enqueue 与 unbind 后的 queue barrier；barrier 未确认时允许 Run 生命周期继续终结，但不得提前写
   `no_changes`，缺失 projection 由 startup recovery 重放；
5. 最新 Runtime Run snapshot 对 display root 内文件是权威来源；不存在时使用 terminal operation Evidence。除
   当前精确 `ROVAI_RUN_TMP` 临时交付区外，Runtime 明确报告的 root 外文件不属于该 snapshot 的覆盖范围，仍以
   规范化绝对路径补入同一张卡。完整状态链可以得到净差异，roundtrip 消失；不连续链只让该文件降级为
   operation history；
6. 当前 Data Contract 直接升级，旧未发布 Window schema 不提供 dual read、alias 或数据迁移。

当前规范见 [Runtime File Change Observation](../../architecture/runtime-file-change-observation.md)与
[Runtime File Change Observation v2](../../contracts/runtime-file-change-observation-v2.md)。

### 后果

- 文件变化观察不会启动 Git 子进程、扫描大目录、写用户 object database 或阻塞其他 Run；
- 非 Git Camp 与 Git Camp 能力一致，并行 Run 获得清晰的逐 Run卡片；
- 覆盖率明确受 Runtime 协议限制：shell、用户编辑器、其他进程以及 Runtime 未报告的写入不会出现；
- 删除 Window schema 是 clean break，本地使用过未发布中间构建的数据需要按当前 Data Contract 重新初始化。

### 被拒绝方案

- **继续修补 Window coordinator 和 Git runner：** 只能降低阻塞风险，不能消除扫描、ref/object 污染或因果歧义；
- **Run 开始/结束读取整个 filesystem：** 成本与一致性更差，并扩大 Core 文件读取面；
- **解析 shell 命令推断文件：** 命令语义、子进程和条件执行无法可靠还原实际效果；
- **把同 workspace 的重叠 Run 合并：** 会失去用户要求的每 Runtime/Run 独立结果，并混淆 Evidence 来源。

<a id="v1-29-d10"></a>
## V1.29-D10：Command 文件行扁平呈现，Run 卡片进入独立 Files Changed Review

### 背景

把 `apply_patch`、文件数汇总和逐文件 diff 嵌套成三层，会重复 Runtime 实现名并制造第二个 Activity 层级。
Command 层仍应就地快速检查单次操作；但 Run 归约可能包含多个文件、root 外绝对路径、无行号 exact mutation、
不连续 history 和 operation-only。把这些内容继续塞进窄会话卡片会破坏代码阅读面，也无法提供稳定的文件间导航。
因此必须区分“成功文件操作与 path”“可审查内容”“整次 Run 归约”，而不是按 Tool 显示名统一，也不能把
Run Review 误建成第二套权威 Activity。

### 决定

1. Command View 的每个可靠单文件 change 直接成为同级 `修改 <basename>` presentation row；删除 `apply_patch`
   父行和“编辑了 N 个文件”外层，不创建逐文件权威 Activity；
2. 只有可靠内容存在时显示 `+A −D` 并允许在当前 Tool 行展开。operation-only 仍显示文件行但没有 disclosure；
   exact mutation 只显示 `−/+` 片段，不生成 `@@` 或推测行号；
3. 每个 terminal `agentRunId + executionEpoch` 最多产生一张会话卡片，标题固定 `Files Changed`。并行 Run
   分别显示，failed/cancelled Run 可显示此前成功变化；
4. 卡片文件行顶格且无分隔。`runtime_diff_no_changes` 不参与投影；同文件的 operation-only 保留在时序与计数中，
   但不参与 Diff 统计，剩余可靠 Diff 继续归约逐文件 `+A −D`。只有每个文件都有可靠统计时显示卡片总
   `+A −D`；任一文件只有 operation-only 时回退为 `N 个文件 · M 次修改`；
5. 卡片默认显示三行，更多文件原位展开/收起。header 显示无箭头、浅边框、非品牌色的 `View`；点击 header、
   `View` 或任一文件行进入同一个 Run 的独立 `Files Changed` Review，文件行进入时预选对应路径；
6. Review 左侧列文件、右侧读不可变 Evidence detail：full diff 显示可靠 hunk/行号，exact mutation 不显示行号，
   history 按 sequence 分块，operation-only 显示诚实空态；不读取当前 workspace、不执行 Git、不补造内容；
7. 卡片不显示时间、已保存、Git、参与运行或底部 metadata。执行台不增加共享 workspace observation，不改变
   会话 rail、底部/右侧 placement、Tool list 整行宽度或其他既有样式。

### 后果

- Kimi Code、Qoder 等只提供成功 Edit/Write 与可靠 path 的 ACP Runtime 也能显示 `修改 xxx` 和 operation-only
  Run card 行；同文件后续存在可靠 Diff 时，path-only 只保留操作计数，可靠 Diff 仍可显示内容与增删统计；
- Git 与非 Git 项目使用相同 Command View 和 Run card；
- Claude 同一文件连续 Edit 保留各自 Tool identity 和片段 Diff，不被错误归并成最终净变化；
- 一个 Runtime 没有可靠 terminal file content 时仍可显示已证明的单文件操作，但不显示占位 Diff；
- 后续 Run 不覆盖旧卡片，当前 workspace 不参与历史读取；
- Renderer 对 Command rows 消费 Canonical typed projection，对 Run card/Review 消费同一 AgentRun typed read
  projection 与 detail blob；不维护 Runtime-specific 分支或第二套 Activity；
- 会话卡保持快速扫描密度，长 diff 与多文件时序获得稳定、可键盘操作的 Evidence 阅读面。

### 被拒绝方案

- **展示 `apply_patch → 编辑了 N 个文件 → files`：** 重复层级且把 Runtime 实现名误当产品语义；
- **只展示“编辑了 N 个文件”文字：** 无法直接定位和独立展开单文件变化；
- **继续在卡片内展开所有 diff：** 多文件、长 diff、history 和 operation-only 混在窄会话轨道中，阅读与定位成本高；
- **为每个文件打开系统编辑器或独立文件 Review：** 会读取可变工作区、丢失同一 Run 上下文，并混淆历史 Evidence；
- **在执行台再展示 Run summary：** 与会话卡片重复，并破坏现有执行布局；
- **把可靠路径当成 diff：** 路径只足以命名成功文件操作，不能证明 old/new、增删计数或 inline 内容；
- **从 Tool 显示名、未获 Adapter 准入的 raw input、output 或 shell 命令猜文件操作/diff：** 无法证明完整性，
  异常退出时尤其会产生伪结果。

<a id="v1-29-d11"></a>
## V1.29-D11：ACP Client FS/Terminal 仅作执行代理，文件与 Shell 权限由 Runtime 单独拥有

### 背景

ACP Runtime 已经通过自己的 sandbox、permission/approval mode 与原生用户交互决定文件和 Shell 权限，但 Core 曾在
`fs/write_text_file` 上再维护一份 `authorized_file_writes`：只有 matching permission response 生成的一次性路径
token 才能写，并且 read/write 都通过 `scoped_path()` 限制在 execution root。Qwen Code、CodeBuddy、Kimi 和
Grok 等全自动模式可以合法地不发送 permission request，却仍使用 ACP Client FS 完成写入，于是第二层 token
无法产生，Runtime 已允许的操作反而被 Core 以 `file write has no matching one-time Rovai-ai authorization`
拒绝。Client Terminal 的显式 cwd 还继续调用相同 `scoped_path()`，使 Runtime 已允许的 root 外目录无法作为
Shell 工作目录。两种机制都不能代表 Runtime 的真实权限，并把 execution root 错当成 sandbox。

### 决定

1. 文件、Shell、网络权限只由冻结的 Adapter Permission Configuration、原生 Runtime sandbox/permission mode
   与操作系统拥有。Core 不建立可与它们分歧的通用文件权限层；
2. `fs/read_text_file` / `fs/write_text_file` 成为 fenced ACP Client Filesystem Proxy：绝对路径按 Runtime 请求
   执行，相对路径以 execution root 为解析基准，但不 containment；不读取 Workspace access，不调用
   `scoped_path()`，不 canonicalize 后拒绝 root escape；
3. `terminal/create` 省略 cwd 时仍使用 execution root；显式 cwd 仍必须为已存在的绝对目录，但不调用
   `scoped_path()`、不做 execution-root containment。Core 只代理创建受管进程，不把 cwd admission 变成 Shell
   权限判断；
4. 删除 `authorized_file_writes`、`authorize_file_write()`、one-time matching error，以及 Runtime Delivery 把
   Approval 映射为文件 token/scope validation 的桥；同一 Run 可以连续多次写同一或不同路径；
5. `session/request_permission` 继续校验 current Run/epoch/Session/Prompt、request identity 和 native option。
   冻结配置处于 Adapter 已验证的全自动/绕过交互模式时，Core 直接选择 native non-persistent allow 作为 ACP
   兼容响应，不创建 Approval/Action；交互模式继续保存 exact native request、用户决定和 response delivery；
6. permission response 与 Client FS/Terminal 执行资格完全解耦。它不 mint、consume 或 revoke 文件或 Shell
   权限；stale
   Session、cancel/detach、非法参数、未知 method 和 OS I/O failure 仍由 Core 正常 fail closed；
7. Rovai 自有 blob、附件 Authority、私有配置、凭据、IPC、Built-in Tool lease 与领域命令继续按自然产品边界
   保护；Terminal 的进程树、输出上限、kill/release、cleanup 和 Run/epoch/Session/Prompt fence 也保持。它们不是
   Runtime 已知任意路径的第二份 filesystem/Shell allowlist。

当前字段级规范见 [Runtime Launch and Verification v28](../../contracts/runtime-launch-and-verification-v28.md)与
[ACP Client Terminal v2](../../contracts/acp-client-terminal-v2.md)。

### 后果

- ACP Runtime 的权限配置成为单一文件与 Shell 权限解释；execution root 继续是默认工作目录和相对路径基准，
  不再冒充 sandbox；
- 全自动 Runtime 无需先制造虚假的 permission request，连续 Client FS 写入不再因 token 被消费而失败；
- 选择较窄模式的用户仍可收到 Runtime 原生 Approval；该 UI/审计事实不承诺 Core 拦截 Runtime 的每种文件 I/O；
- 与 Runtime 同 UID 且知道某个路径时，Core Client FS/Terminal 不提供额外隔离保证；隔离必须由 Runtime
  sandbox、permission mode 或操作系统承担；
- 旧 `CoreEnforcedV1` 只为既有非终态 Run 的非 FS Action recovery 保留，不再参与 Client FS read/write。

### 被拒绝方案

- **修补 one-time token 的数量或有效期：** 仍要求 Runtime 权限事件和 FS callback 一一对应，无法覆盖自动模式、
  多次写入或 Runtime 内部授权；
- **把 execution root 改成可申请扩展的 Core sandbox：** 建立第二套路径 capability、symlink/canonicalization 与
  生命周期模型，继续可能和 Runtime 决策冲突；
- **解析 shell/tool input 预授权路径：** 无法证明实际副作用，且会把启发式猜测升级成安全权威；
- **所有 permission request 都静默 allow：** 会覆盖用户选择的交互式 Runtime 模式；只有已冻结的全自动/绕过模式
  使用兼容 allow，其余仍走原生 Approval。
<a id="v1-29-d12"></a>
## V1.29-D12：Navigation 采用提交后失效与全局 generation drain

### 背景

Desktop 原先每 1.8 秒读取一次完整 Navigation Snapshot，并以 Overview 的全局 `ready` 状态作为轮询门禁。
单次读取在途时，后续 `loadNavigation()` 只复用旧 Promise，不保证读取开始后提交的终态会有 trailing read。
因此附属模块一次失败可以永久关闭轮询，Run 终态又只刷新当前打开 Camp，后台 Camp 的侧栏 spinner 可能一直
保留到 Renderer 重载。继续提高轮询频率会增加 SQLite 读取，却不能消除完成边界竞态。

### 决定

Core 在影响 Navigation 投影的权威事务完成后统一发 `navigation.invalidated`；事件只作提示，Renderer 仍读取
完整 Snapshot。Renderer 使用一个 App-global generation coordinator：普通事件 80ms debounce，同一时刻只允许
一个读取，读取期间新增 generation 由共享 Promise 继续 trailing drain 到安静点。失败保留 generation，并按
1/2/5/10 秒上限退避；普通事件不抢跑，focus 与用户显式重试可以立即尝试。

前台安全刷新降为约 20 秒并在每次完成后重新调度，App 隐藏时暂停、focus 后立即刷新。Navigation 的状态和
恢复不再依赖 Members、Runtime Installation、Memory Review 或本机 Navigation preference 的共同 Overview
结果。当前规范见 [Desktop Navigation Refresh](../../architecture/desktop-navigation-refresh.md) 和
[App Shell 与统一侧栏](../../ui/components/app-shell-navigation.md)。

### 后果

- 多个 Camp 同时终态通常合并为一次读取，必要时只补 trailing read；
- `refresh()` resolve 表示调用期间的失效已 drain 到一个安静点，trailing failure 不会变成无人观察的 Promise；
- 后台 Camp 的 spinner 由提交后事件快速清除，20 秒读取只承担漏事件恢复；
- 空闲期完整 Navigation Snapshot 频率显著下降，且不存在 per-Camp timer；
- Core 暂时不可用时按上限退避，不形成无间隔热循环。

### 被拒绝方案

- **继续 1.8 秒全局轮询：** 空闲读取成本高，仍受 Overview error 门禁和读取完成边界影响；
- **每个 Camp 单独轮询：** 任务数与 Camp 数量一起增长，并重复读取同一全局投影；
- **只在 `.finally()` 里无人等待地补一次刷新：** 原调用者提前 resolve，trailing rejection 可能无人观察；
- **从 terminal event payload 局部改 marker：** 事件缺失、乱序或 payload 不完整时会建立第二状态真源。

<a id="v1-29-d13"></a>
## V1.29-D13：`ROVAI_RUN_TMP` 是临时交付区，不进入文件变化 presentation

### 背景

Built-in Tool Process 为 Runtime 注入精确 `ROVAI_RUN_TMP`，供 Agent 先生成 HTML、图片等文件，再通过
`rovai send --file` 交给 Core ingest。该目录会在 lease 绑定前重置，并可随 unbind 或进程回收删除；真正的
Published/Managed Attachment 已由独立合同持久化。Runtime File Change v1 又会诚实接纳 execution root 外的绝对
路径，于是临时源文件也可能形成 `修改 report.html` 和 `Files Changed`，用户点击后看到的是 Rovai 内部临时路径，
甚至文件已经不存在。这不是用户工作区变化，也不是附件的稳定读取入口。

### 决定

1. 当前 Built-in Tool Process 配置拥有的 exact `run_tmp` 是文件变化 normalizer 的 typed negative root；Core 不从
   路径前缀、产品 data dir 或 Runtime 文本猜测它；
2. Runtime-reported path 仍先按 execution root 纯词法解析。解析结果等于该 root 或位于其下时，不准入
   RuntimeFileOperation、Command Diff entry 或 Run snapshot section；普通 workspace 文件和其他 root 外绝对路径
   继续沿用 v1；
3. containment 按 path component 判断。Unix 大小写敏感；Windows 兼容平台分隔符与 ASCII 大小写，且
   `run-tmp-copy` 不命中。该判断只拥有 presentation admission，不建立新的文件权限或 filesystem sandbox；
4. mixed Diff/snapshot 只移除 managed entries。全部被移除时写安全 unavailable 或权威空 snapshot，不能让
   AgentRun fallback 重新引入临时路径；过滤发生在 append-only Evidence ingress，normal terminal 与 startup
   recovery 使用同一结果；
5. 通过临时路径成功 ingest 的附件继续由 Camp Attachment 拥有。普通 Tool Activity 可以保留，但不显示
   `修改 <basename>`、inline diff 或 `Files Changed`；
6. 不迁移、不重写、不重新投影 v1 历史 Evidence 与卡片。新逻辑只约束部署后新进入 Core 的 Evidence；read wire、
   schema 与数据库保持不变。

当前规范见 [Runtime File Change Observation v2](../../contracts/runtime-file-change-observation-v2.md)、
[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md)与
[Camp 会话工作区](../../ui/components/conversation-workspace.md)。

### 后果

- Files Changed 只保留 Runtime 报告的稳定用户文件事实，不再把 Rovai 临时交付路径伪装成可审查文件；
- macOS、Linux 与 Windows 共用 typed root + component containment，不维护平台路径字符串名单；
- 不会误伤整个应用 data dir、Quick Chat workspace、其他进程目录或普通 root 外文件；
- 历史 UI 可以继续保留旧卡片，这是明确的数据兼容选择，而不是 migration 漏洞。

### 被拒绝方案

- **只在 Renderer 隐藏路径：** Evidence、Canonical classification 和 recovery 仍会保留错误文件事实，其他 reader
  也可能重新展示；
- **排除整个 Rovai data dir：** Quick Chat 或其他合法 execution root 可能位于应用管理目录，会扩大产品边界；
- **按字符串前缀或统一 lowercase 比较：** 会误伤 `run-tmp-copy`，也不符合 Windows path component 语义；
- **禁止所有 execution-root-external 路径：** 会丢失 Runtime 明确报告的合法用户文件，与 v1 的 display contract
  冲突；
- **迁移或重投影旧数据：** 需要改写已持久 Evidence/卡片且无法恢复当时 exact process root，收益不足以支持风险。
