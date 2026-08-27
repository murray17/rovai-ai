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

- 再次添加在产品上仍是普通添加，但在授权上是新的 lifetime；
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
## V1.29-D07：两层 diff 共存，但不建立第二套 Activity 权威

### 背景

Runtime 有时会在一个 Operation 的结构化事件中明确报告 patch 或完整 before/after；另一方面，用户最终关心的
是一组可能重叠的运行期间工作区留下了什么净变化。前者接近 Operation，后者只能观察工作区边界，二者的来源、
完整性和归因能力不同。若把二者合并为一个“Agent 修改”，会让 Runtime 声明、文件系统观察和因果归因互相替代。

### 决定

1. 产品固定保留两层：`Command Diff` 是 Runtime 对具体 Operation 的结构化报告；
   `Workspace Change Window Diff` 是当前 Camp、exact execution root 内一组重叠 Run 的 Git 工作区净变化；
2. Command Diff 继续写 append-only Evidence，并归约到既有 Canonical Activity 的 typed `diffProjection`；
   不创建 `OperationDiffActivity`，也不复制 `phase`、`outcome` 或 Activity identity；
3. projection 保留单调 `revision`、全部 `sourceEvidenceIds` 和明确的 availability/conflict 状态；
4. 只有 Adapter/version 明确声明语义的数据可进入 projection。局部片段、仅路径或语义不明的 `diff` / `patch`
   字段不得包装为完整文件差异；
5. `diffProjection` 不是可独立排序或写入的新 Activity。旧 Evidence 不做无法证明正确的回填；v1 presentation
   由 [V1.29-D09](#v1-29-d09)冻结。

当前规范见 [Workspace Change Observation](../../architecture/workspace-change-observation.md)与
[Workspace Change Observation v1](../../contracts/workspace-change-observation-v1.md)。

### 后果

- Runtime 声明与 Git 观察保留独立来源和不确定性，可由后续 UI 方案分别呈现；
- replay 仍从 append-only Evidence 确定性重建，不增加可独立写入的活动聚合；
- 每个 Adapter/version 必须先完成 public normalizer、Registry、fixture 和语义证明，接入成本高于字段名猜测；
- Command Diff 不自动证明文件最终状态，也不替代 Workspace Window。

### 被拒绝方案

- **为 diff 新建第二类活动：** 会复制现有 Tool/Command 的 phase、outcome 与排序权威；
- **按字段名自动识别 `diff` / `patch`：** 无法区分局部片段、增量事件与完整快照；
- **读取当前文件补全 Runtime 片段：** 会扩大文件读取授权，并把晚到工作区状态伪装成 Operation 证据；
- **把 Git 最终差异附到每个 Run：** 重叠写入下无法证明单 Run 因果归属。

<a id="v1-29-d08"></a>
## V1.29-D08：Camp/exact-root Window 使用受控 Git checkpoint，Coordinator 有界 fail-open

### 背景

临时 index 不能完全隔离用户仓库；Git object 写入本身会进入用户 object database。专用 worktree 或
workspace writer lease 可以强化隔离和归因，但会显著增加 v1 的调度、磁盘与用户工作流成本。与此同时，按 Run
各自拍快照会在重叠运行时产生互相覆盖、重复投影和不真实归因。

### 决定

1. 唯一持久对象是 `WorkspaceChangeWindow`，key 为
   `campId + canonicalExecutionRoot + observedRepositoryWorktreeIdentity`；身份至少冻结
   `repositoryRoot + worktreeGitDir + gitCommonDir + objectFormat`；
2. 同 key 重叠 Run 共享 baseline；最后一个参与 Run 的 lease 已 fence/unbind，且属于它的 Runtime、CLI、Tool
   后代已证明 quiescent 后捕获 final。IdleWarm Host 不参与该判定；
3. Core DB 的 Window row 是 active coordination、OID、恢复与清理权威；完成时追加的不可变
   `WorkspaceDiffCompleted + diffBlobId` 是历史卡片/读取权威。随机 `windowId` 至少含 128-bit 熵；
   `refs/rovai/w/<window-token>/b|f` 只以 CAS 方式临时保护计算材料；
4. snapshot 只写 raw blob/tree，不经过 index、`git add`、clean filter、LFS clean、textconv 或 external diff；
   不修改 staged 状态、普通 branch/ref，也不主动执行 prune；
5. synthetic tree 只覆盖 exact execution root，并遵守 ignored/untracked、symlink、executable bit、sparse-checkout、
   nested repository/submodule 与稳定双捕获边界；
6. 新 Run join 与 `active -> closing` 原子互斥；同一 physical execution root 在 closing 时只允许有严格截止时间的
   bind 等待；任何 baseline/final/ref/身份/限制故障都使观察 `unavailable`，但 Run 和普通文件工作继续；
7. 读取必须以 `campId + windowId` 授权。其他 Camp/scope 的重叠 Rovai Run 只设置布尔观察，不暴露其 Camp、Run
   或文件活动。用户编辑器与任意外部程序始终只通过通用免责声明表达，不能假称被完整探测。

当前规范见 [Workspace Change Observation](../../architecture/workspace-change-observation.md)与
[Workspace Change Observation v1](../../contracts/workspace-change-observation-v1.md)。

### 后果

- v1 不需要改造所有 Runtime 的 workspace 模型，也不承诺单写者或因果归因；
- 用户仓库会收到 Rovai raw objects 和短期专用 refs；删除 ref 后 object bytes 何时消失仍由 Git 自身 GC 决定；
- DB OID 与 ref 一旦不一致就不可用，不允许通过事后扫描掩盖边界丢失；
- 同一 repository 的不同 Camp/execution root 保持授权隔离，但物理写入仍可能互相影响，任何未来 presentation
  必须保留该不确定性；
- 严格上限或持续变化可能牺牲 diff 可用性，以换取 Scheduler 不被 checkpoint 永久阻塞。

### 被拒绝方案

- **临时 index 并声称完全隔离：** 仍可能触发 filter/LFS，且 object database 不是隔离存储；
- **专用 worktree：** v1 的生命周期、磁盘和用户预期成本过高；
- **workspace writer lease：** 会改变并行执行产品语义，超出观察能力的范围；
- **跨 Camp 或跨 execution root 共享 Window：** 破坏授权边界并暴露参与者信息；
- **ref 作为长期权威：** 用户或工具可移动/删除 ref，且无法承载 Camp 授权与生命周期；
- **失败后重新扫描补 final：** 无法恢复原来的时间边界，会把后续用户修改混入结果。

<a id="v1-29-d09"></a>
## V1.29-D09：终态文件变更扁平呈现，完整 Review 只属于 Window Evidence

### 背景

把 `apply_patch`、文件数汇总和逐文件 diff 嵌套成三层，会重复 Runtime 的实现名并制造第二个 Activity 层级；
同时，把 Workspace Window 状态塞进执行台会改变现有会话/执行布局，也会暗示它属于某个 Run。不同 Runtime 的
文件事件名并不一致，必须以协议终态内容而不是 Tool 名称统一。

### 决定

1. Codex 只从 `item/completed + fileChange + completed` 接纳最终 `changes[]`；不消费 started、patchUpdated、
   turn diff 或 `apply_patch` input。Codex add/delete 完整内容在 Core 规范化为 unified diff；
2. 全部 ACP adapter 只从 terminal `tool_call_update` 的标准 `ToolCallContent::Diff` 累计内容接纳完整
   before/after。Claude Code 只从完整 `assistant.tool_use(name=Edit)` 与 matching 非错误 `user.tool_result`
   接纳 `file_path/old_string/new_string` 的 `exact_mutation`；不读文件、不生成 hunk 行号，`replace_all` 与其他 Tool
   保持普通 Tool Activity。Antigravity 没有等价可靠内容，保持普通 Tool Activity；
3. 一条 FileChange Evidence 与一条 Canonical Activity 可以投影多条同级 `修改 <basename> +A −D` 行；每行
   独立展开 inline diff。删除 `apply_patch` 父行和“编辑了 N 个文件”聚合层，不创建逐文件权威 Activity；
4. 完整 Review 只从 `WorkspaceDiffCompleted → diffBlobId` 打开。会话卡片标题固定 `Files Changed`，右侧只放
   中性 `View`；文件行顶格且无分隔，不显示时间、已保存、参与运行或底部 metadata；
5. 执行台不增加共享工作区观察，不改变会话 rail、底部/右侧 placement、Tool list 整行宽度或其他既有样式。

### 后果

- 非 Git 项目仍可显示 Runtime 可靠终态的 `修改 xxx` 行；Workspace 卡片仍只在 Git Window `complete` 时出现；
- Claude 同一文件连续 Edit 保留各自 Tool identity 和片段 Diff，不被错误归并成最终净变化；
- 一个 Runtime 没有可靠 terminal file content 时，UI 不显示占位或推测摘要；
- 后续 Window 不覆盖旧卡片，Git refs/objects 或当前 workspace 不再参与历史读取；
- Renderer 只消费 Canonical typed projection，不维护 Runtime-specific 分支或第二套 Activity。

### 被拒绝方案

- **展示 `apply_patch → 编辑了 N 个文件 → files`：** 重复层级且把 Runtime 实现名误当产品语义；
- **只展示“编辑了 N 个文件”文字：** 无法直接定位和独立展开单文件变化；
- **在执行台展示 Window observation：** 混淆 Operation Evidence 与共享净变化，并破坏现有执行布局；
- **从 Tool 名、路径或 shell 命令猜 diff：** 无法证明完整性，异常退出时尤其会产生伪结果。
