---
document_type: architecture
authority: desktop-availability-and-authority-startup-boundary
status: accepted
last_updated: 2026-10-30
---

# Availability-first Runtime

Rovai Desktop 把“窗口可用”与“权威工作区可用”拆成两个明确层级。Desktop 壳层可以在偏好损坏、Core 迁移或
SQLite 阻断时继续工作；SQLite authority 仍然 fail closed。这个拆分不建立第二套业务状态，也不允许空库或空列表
冒充原工作区。

## Component authority

| Component | Owns | Does not own |
| --- | --- | --- |
| Electron bootstrap | 窗口、主题、本机偏好默认、诊断保存、Supervisor IPC | SQLite 选择、数据库修复推断、业务投影 |
| CoreClient Supervisor | child generation、完整 revision snapshot、能力门禁、请求 fencing、独立启动重试与意外退出预算 | 领域状态、SQLite recovery 决策 |
| CoreSubsystems | 当前进程的可选功能初始化、错误、执行门禁与串行重试 | 数据库准入、替代 authority、Runtime qualification |
| Core data-directory lease | canonical data directory 的 OS 排他所有权与稳定对象身份 | 数据合同分类或迁移 |
| DatabaseAdmission | exact Rovai/Lumen 路径选择、单次读写打开与版本分类、typed blocker | schema 写入、自动 quarantine、UI 文案 |
| Database open/init | 已打开连接的运行配置，或 confirmed absence 上的 staging initialization | 目录扫描式猜测、覆盖竞态 target |
| AuthorityMigrationRunner | 同一连接上的逐版本事务、receipt 续跑、旧 manifest 中断恢复 | 常规整库副本、替换主文件、失败后创建空 authority |
| Renderer startup boundary | 订阅 Supervisor、读取本机恢复目标、首帧以不透明整窗品牌画布遮住页面框架；明确阻断时展示恢复壳层 | 未准入时挂载权威 hooks、合成业务空集合 |

## Startup sequence

```text
Windows only: prepare usable Bootstrap profile -> single-instance lock
  -> assess formal root (failure => bound Bootstrap Shell, no Core path)
Electron ready
  -> install in-memory local defaults
  -> create BrowserWindow and cover ordinary page chrome with the startup canvas from the first Renderer frame (no Core hooks)
  -> load local preference files (failure => warning, original retained)
  -> freeze Main Window Session from loaded local preferences, render its target frame
  -> spawn Full Core generation
       -> acquire CoreDataDirLease
       -> DatabaseAdmission::assess
          -> select exact path -> open SQLite READ_WRITE (no CREATE) -> version/receipt check
          -> Current -> configure the same connection
          -> Confirmed absent -> staged create-if-absent publish
          -> Older supported version -> transactions on the same connection
             (existing legacy manifest only -> recover old switch/reassess)
          -> Blocked -> structured refusal and clean exit
       -> exact legacy cancellation settlement
       -> remaining mandatory execution/input/delivery recovery (failure => typed refusal)
       -> ready(authority origin, initializing subsystems)
       -> independently start Runtime discovery and optional services
       -> bounded one-shot historical maintenance (independent of discovery and feature retries)
  -> Supervisor enables authoritativeWorkspace/coreRequests
  -> Renderer mounts authority-backed hooks inside the restored route
       -> initialize optional services -> ready or feature-scoped degraded
```

Runtime 附件根只在数据库分类且 lease 仍持有后核对实例路径派生；旧标记、物理身份变化、坏条目与不可读子目录不参加启动准入。
具体文件在读写或删除时检查本次目标，任何失败都不能反向创建另一个 SQLite authority。Full Core ready 之前，
Renderer 不调用 `navigation.snapshot`、Thread、Member、Memory 或 Onboarding 的
Core-backed read path。

页面框架不是权威查询树。Root 从首次挂载起就用不透明整窗品牌画布遮住框架；正常检查、迁移和自动重启都保留既有
rail/顶行 DOM 与画布，只向辅助技术统一呈现“正在打开会话”，不根据内部 phase 展示数据库术语。画布不挂载
权威 hook，不用模糊背景、骨架或可见阶段信息伪装进度；ready 后读取 Onboarding、偏好和目标投影时持续显示同一品牌画布，
最终内容可用后以 180ms 退出，不插入第二个 gate。
只有 `blocked` / `crashed` 才切换到带重试、主题与诊断的 Bootstrap Shell。数据未返回前不展示业务空态、不确认已读、
不提交恢复位置。精确呈现由 [冷启动反馈](../ui/components/app-shell-navigation.md#冷启动反馈)拥有。

BrowserWindow 可以先于本机文件读取创建，但 Main Window Session 不能用尚未加载的默认偏好冻结恢复目标。首次窗口的
snapshot IPC 等待本机 preference/restorable-location 加载，不等待 Core；关闭窗口使迟到读取失效。之后新建窗口仍从
当前偏好创建新的、冻结的 session snapshot。

## Optional startup boundary

Skill/MCP/adapter 对象先无 I/O 构造。ready 后独立初始化当前所需存储与迁移、Builtin IPC；历史维护另行调度，一个失败
不会从 `run_core()` 传播到进程退出。Core 持有功能门禁，拒绝依赖功能的请求并暂缓相关执行；数据库记录查询不依赖这些
初始化结果。状态由 startup frame + generation-fenced event 合并到 Supervisor 完整快照，Renderer 显示原因与原进程重试，
不卸载健康的权威工作区。重试跳过已健康服务，不能清理或替换已活动的 Runtime/IPC。

Runtime discovery 与可选服务、历史维护分别启动，不等待目录扫描或批量回收。附件树不做启动 reconcile；旧视图在确需访问时按目标重建。Adapter 初始化不遍历旧 MCP 配置、Grok plugin 或 Claude 输入文件；当前任务仍精确释放自己创建的文件。目录年龄、名称前缀或缺少 Run 本身不构成旧文件可删除证据。

Antigravity 初始化不访问或删除旧 `runtime-private/agy`；该目录不可清理不影响新任务或后继任务。当前 `runtime-private/antigravity` 的初始化、遗留日志处理及当前 Run 日志释放保持原有行为。

普通任务只等待内置工具、当前 Skill 准备和对应 Adapter；外部 MCP 读取、迁移、初始化错误进入现有 Exposure 的 `invalid/warnings`，不成为共享执行门槛。原文件保留，既有冻结 Run 的快照与失败语义不改变。管理操作仍显示本功能错误，不能把加载失败标成正常空配置。

外部 MCP 临时投递复用 `runtime-private/external-mcp` 时不修改已有目录权限。Unix 新目录在创建时请求 `0700`，新配置文件继续以 `0600`、不可覆盖方式创建；Grok 本次 UUID 子目录保持独占创建。真实创建、写入和 flush 错误仍中止本次投递，不能丢弃已选 MCP 后继续启动；失败与句柄释放只清理本次拥有的资源。

`mcp.config.get` 管理读取不经过 MCP 健康门槛，返回现有文件路径与 `fileIssue`，使设置页能够展示并定位坏配置；写操作的门槛不变。

设置读取、直接导入和提交共用同一按需初始化规则；配置尚不存在时，导入读取的版本与提交检查的版本一致，不因自己创建空配置产生冲突。只读诊断 `inspect` 继续不创建文件，损坏现有文件不被空配置替换。

历史文件维护只在 ready 后启动一次，功能重试不重复启动它。实际枚举、递归、逐条处理均消耗条数和时间预算，诊断有数量及长度上限；遇到单条错误继续，耗尽后保留剩余项。目录枚举、批量删除和等待在全局数据库锁外；单条引用复核、状态提交和唯一临时路径的原子交接可持短锁。周期 GC 同样有界，不重新全盘恢复。Blob 已重新挂接则取消回收；无提交元数据、坏 JSON、未知归属或无法确认安全删除的内容原样保留。删除失败不反向影响会话读取或其他任务。

终态文件变化补投影按进程内游标分批前进，每个实际尝试（包括失败）推进位置，到末尾再轮转。预算或锁竞争中断不能跳过未处理项；失败项保留后续重试资格，不建立持久游标或新恢复队列。

Runtime 程序设置逐项加载，缺失与损坏明确区分；损坏项保留错误和原始值，不落入默认程序或账号。设置页可读取错误及版本，通过既有 CAS 显式替换，再复用现有刷新恢复该项，无需重启 Core。具体接口见 [Runtime Launch v74](../contracts/runtime-launch-and-verification-v74.md#本机配置的局部故障)。

`runtime.<AdapterKind>` 只表示 Adapter 自有私有存储与进程内初始化是否可用，不表示第三方 executable 已安装。
安装缺失、路径失效、版本、认证、capability 和平台资格继续由 Runtime discovery、Availability、Readiness 与 dispatch
preflight 分层拥有；其中任何结果都不反向污染 optional subsystem health。Adapter 私有存储真实初始化失败仍可只降级
对应 Runtime，并由原进程内重试修复。

历史进程清理属于一次后台维护，不属于可选功能健康状态或启动准入。Core ready 后唯一启动调用在阻塞工作线程
遍历 macOS ownership ledger、退役 Cline ledger 和 Fleet 历史记录，共享有限总预算与有限诊断；每条失败继续，
预算耗尽保留余项。它不持有会话读取的数据库锁，不进入可重试 maintenance、Adapter 初始化或任务停止路径。
当前 Core 的生命周期身份或 Fleet generation 排除本次启动的新进程。历史异常、缺 ACK、身份未知均不阻断新任务，
也不伪造已退出或批量补写 ACK。工作区准备、消息领取、共享执行目录检查与任务 dispatch 共用当前精确执行所有权判断；
仅当前 Core 持有的 Run/epoch 且清理未确认时保留对应任务的冲突门禁。业务恢复与旧输入不可自动重投规则保持。
规范与取舍见 [Managed Process](../contracts/managed-runtime-process-v2.md#macos-acp-descendants) 和
[V1.72-D69](../versions/v1.72/decisions.md#v1-72-d69)。

退役两阶段取消协议的持久中间态在数据库 open/migration 后先按精确 cancel intent 与未完成关联状态查询，并复用统一
settlement；它先于通用 execution/input/delivery recovery，避免旧取消工作被重新准入。重复启动不再次结算，失败与其他
执行安全恢复一样通过结构化 refusal 阻断 ready。既有 compaction 启动协调保留 best-effort 语义与
replay-before-fence 顺序，在新 Runtime 启动前运行一次；它不进入可重试 cleanup 集合。controlled-shutdown、
accepted-input 和 delivery recovery 仍在 ready 前，不能用 optional failure 策略掩盖未收敛的权威状态。

## Windows shell storage boundary

完整 Core preparer 不再是窗口前置条件。独立壳层 profile 由已经打包的 Agent CLI 的 Desktop-only 原生入口创建，只有
Electron 本机状态，不包含 Core path；继续使用原有 protected-DACL 原语，没有 PowerShell、普通 mkdir fallback 或静默修权。
所有实例先绑定同一个 profile 再判定 single-instance，只有 primary 才准备正式 data root。现有目录以实际访问为准，不要求 ACL 模板或 WRITE_DAC；新目录保留适当的创建权限。成功后仍在 ready 前使用原正式
布局；失败回到已准入的壳层路径并展示 assessment，CoreClient 持有 null data path 而不是临时数据库目录。

Windows 重新检查该 assessment 会保留原参数 relaunch Desktop，避免 ready 后重绑 Chromium sessionData。若壳层
存储本身也不可用，只能原生提示并结束启动；这与正式 root 失败时仍显示 Electron Shell 是两条不同边界。
协议细节见 [Windows Bootstrap assessment](../contracts/desktop-runtime-availability-v3.md#数据库启动与有界重试)。

## Database authority state machine

Core 先取得数据目录实例锁，再选择 `rovai.sqlite` 或历史 `lumen.sqlite`。main、WAL 与 rollback journal
决定是否存在待保护数据：两个 main、没有 main 但存在 WAL/journal、另一 namespace 的孤立日志均进入恢复面，
不猜测目标、不删除日志、不建空库。孤立 SHM 是可重建缓存，仅在确认首次初始化时清理。

现有库只以 READ_WRITE/NOFOLLOW/NO_MUTEX、无 CREATE 打开一次，立即设置 `busy_timeout=5000`。
SQLite 自行恢复 WAL/hot journal；不预先以只读方式打开，不切换连接做恢复，不读取来源标记，不比较 main/WAL/journal
的时间戳、长度或内容快照。系统元数据变化、有效 WAL 提交和正常 checkpoint 不构成拒绝理由。

在同一连接的读事务中分类版本。当前版本仅检查 marker/classifier、最终迁移完成记录、没有未来 receipt 与核心表存在；
不重验全部历史 receipt 或功能 SQL。支持的旧版本才进入其完整来源分类、编号冲突识别与逐版本迁移。
缺失当前完成记录、未来版本、未知合同或实际 SQLite 损坏/权限/I/O 错误保留原库，返回可诊断结果。
深度完整性检查由恢复/诊断或特定迁移的验证拥有，不进入健康启动。

操作接口携带已打开的连接与目录租约，只区分现有库、初始化与升级。保留主文件的稳定对象身份检查，防止
路径被替换/移走后向失联对象继续写入；这不保存文件状态或比较日志变化。首次初始化仍先构造 staging 库，
发布前确认两个 namespace 无主库/日志，通过 no-replace 原子发布保护并发出现的已有文件。

运行连接沿用 WAL、`synchronous=NORMAL`、foreign keys 与 5 秒 busy timeout。首次 staging 使用 DELETE 模式
只为单文件安全发布；失败不覆盖目标，也不把已有库错误转换为初始化机会。Desktop、Agent CLI、Web、Server
均经共享 `run_core` 消费这些接口，没有宿主专用的跳过准入分支。

## Migration switch

历史锚点继续保留，普通升级直接使用已打开连接。每版本的 IMMEDIATE 事务同时提交 DDL/DML、marker 和 receipt；
失败仅回滚当前步骤，重启按已提交记录继续。升级前后只守住目录租约与选定主文件，结束时在同一连接核对当前版本
完成记录；不重复打开、不生成票据、不重新准入、不执行全库快照复制。

编号冲突、旧 Lumen 合同、未完成升级与历史结构辨识只在对应升级路径执行。关闭外键重建的步骤继续在提交前核对
受影响表及入向引用。普通升级不创建备份/manifest、不替换主文件，也不默认全库 quick_check/foreign_key_check。

已存在的旧 Snapshot manifest 继续由兼容恢复代码处理：根据 actual main 与 original/migrated identity 恢复旧切换，
而非凭 stage 猜测。仅此历史格式保留其 identity/length/state 字段和 Unix rename 的 ctime 解释；它们不参与普通打开。
恢复之后允许重新选择已存在库，但禁止转为首次初始化。真实强杀覆盖旧切换两侧与原位事务已提交的中断。

主线 Pending/Fast/Fast 生命周期与渠道的 117/118/119 编号冲突按 [Channel/Main Schema Join v2](../contracts/channel-main-schema-join-v2.md)
汇合：保留渠道顺序，把精确识别的主线 receipt 在同一原库事务内映射到 126/127/130。128/129 分别保留历史
`v1.39/schema 80` 与 `v1.40/schema 81` marker；130 只记录已应用的Fast修复，131在完整chain和精确schema检查后
发布 `v1.41/schema 82`，避免已映射130导致跳过最终封口。旧飞书 marker collision 同样复用原链。
后续 [Feishu Channel v8](../contracts/feishu-channel-v8.md) 的132只重建项目选择 pending 表，支持无项目的Quick Chat完成态，
以同一事务保存全部原有行、引用和receipt，推进当前 `v1.42/schema 83`；仍使用上述逐步恢复，不重放131或已映射的130。
不能仅凭版本字符串准入，也不能为了消除编号冲突清空凭据、队列、Fast 选择或改变业务 ID。

工具一致性分支曾以 141 发布 `v1.52/schema 92/activity-v3`，与主线图片来源 141 冲突。
保留主线 141 的已发布含义，classifier cutover 使用 142。对工具分支来源，只有完整 receipt 链、
精确旧图片 schema 和下层合同均通过时，才在同一事务把原 141 映射为 142（保留 applied-at），
增加缺失的图片来源列与 141 receipt，并发布 `v1.53/schema 93/activity-v3`。任一步失败整体回滚，
不降级 classifier，不重算 Canonical/Evidence。主线 `v1.53/schema 92/activity-v2` 则只执行 142；
参见 [Runtime File Change Observation v3](../contracts/runtime-file-change-observation-v3.md#canonical-与读取兼容)。
两条路径随后都以 schema 93 作为 Migration 143 的唯一来源，原子压缩可证明冗余的历史 Evidence、修复
Canonical 引用并发布 `v1.53/schema 94/activity-v3`。Migration 144 再以该精确来源原子发布
`v1.53/schema 95/activity-v3`，只登记 `command.result` 专用列正文编码的 reader/writer 兼容边界，不改写
任何历史事件。Migration 145 以这一精确来源建立 Scheduled Automation schema，并发布 current
`v1.54/schema 96/activity-v3`；未知、部分或带未来 receipt 的状态仍拒绝准入。字段和回退要求见
[Domain Command Result v1](../contracts/domain-command-result-v1.md)与
[Scheduled Automation v1](../contracts/scheduled-automation-v1.md)。

内部 trace 记录 authority_open_and_version、authority_configuration、reconciliation、每个实际 migration 与 core_ready 的耗时和
source/target contract；不记录 SQL、业务行或渠道秘密，不把技术阶段转为产品页面文案。

## Supervisor and request fencing

每个 spawn 获得单调 generation 和不可复用 child token。所有 pending request、stdout line、event、process error 与
exit 都绑定二者；旧 child 的迟到消息被丢弃。Snapshot 每次发布完整状态并推进 revision，Renderer 只接受更新 revision。

确定性 authority refusal 不属于 crash，也不触发自动重试。仅 admission/open/migration 的明确 busy/locked、短暂文件占用
与已分类瞬时 I/O 最多使用一次 250ms startup retry；必须等原 child 退出，期间保持 starting 和 capability gate。
SQLite 每次锁争用先等待最多 5 秒，Core 不增加内部重试循环；CLI/Web/Server 不另设自动重启层。
预算耗尽再展示“暂时无法打开会话”；显式用户重试和 ready 重置 startup budget。领域恢复的可重试标志不自动进入该路径。
一旦在本 Desktop 生命周期见过 authority，后续自动/手动/崩溃重启附带 `--require-existing-authority`，原库消失就拒绝
初始化；这不是路径授权。只有当前 child 意外退出使用 crash budget。关闭取消待执行重试并是唯一可跨 generation
失败全部 pending request 的路径。

请求在 Core 内保留领域拒绝与基础设施失败的结构化类别，经 Main 的 value/failure envelope 穿过 Electron IPC；Preload
以普通 failure 对象拒绝 Promise，保留 `kind/code/message/retryable/generation/details`。`contextBridge` 会丢弃 Error
的自定义字段；如需 Error 实例只能在 Renderer 收到对象后构造。统一错误读取函数同时接受本地 Error 和 failure 对象，
Renderer 对外仍只见 `Promise<T>`。

## Local fail-open boundary

Appearance、General、Navigation、Onboarding 和 Restorable Location 是 Desktop-local 状态，不是 Core authority。
missing 使用默认；损坏或不可读使用内存默认/规范化结果、显示警告并保留原文件。用户之后明确修改该项时才产生新文件。
这些故障不会关闭 Full Core。反过来，Full Core 阻断时只有本机壳层能力可用，不暴露任何看似正常的业务内容。

## References

- [Desktop Runtime Availability v3](../contracts/desktop-runtime-availability-v3.md)
- [First-run Onboarding](first-run-onboarding.md)
- [Bootstrap Shell UI](../ui/components/bootstrap-shell.md)
- [V1.31 Decisions](../versions/v1.31/decisions.md)


### DeepSeek Harness 闭集迁移

Migration 157 只接受精确 v1.59/schema 106 和完整旧 receipt/schema，扩充 Runtime 与 Skill group 闭集后发布
schema 107。重建保留原行、索引与跨表 trigger，检查受影响表及入向外键；receipt/schema 与数据在同一事务提交。
新闭集的 metadata 与 receipt 共同参与准入，失败回滚到可重试的旧来源，不重新分配既有自定义 Skills。
