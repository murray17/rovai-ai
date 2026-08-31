---
document_type: protocol-contract
contract: desktop-runtime-availability-v2
authority: desktop-bootstrap-supervisor-authority-admission-and-request-transport
status: accepted
version: 2
last_updated: 2026-08-31
---

# Desktop Runtime Availability v2 Contract

本合同规定 Desktop 壳层、Full Core Supervisor、SQLite 权威准入、启动迁移与 Renderer 请求错误的当前边界。
“可用性优先”只允许非权威壳层 fail open；权威数据库不能用空库、空列表或另一个目录继续伪装正常 Rovai。

## 1. Runtime modes and capability gate

Desktop 只有两个运行模式：

- `bootstrap_only`：窗口、主题、本机偏好、Supervisor 状态、重试与诊断导出可用；
- `full_core`：只有 Core 已取得租约、完成数据库准入并发出 ready 后才成立。

`SupervisorSnapshot` 是完整快照而不是 patch：

```ts
interface SupervisorSnapshot {
  schemaVersion: 1
  revision: number
  generation: number
  runtimeMode: 'bootstrap_only' | 'full_core'
  fullCoreState: 'idle' | 'starting' | 'ready' | 'blocked' | 'crashed' | 'shutting_down'
  authorityState: AuthorityState
  startupPhase: StartupPhase | null
  restartAttempt: number
  capabilities: {
    authoritativeWorkspace: boolean
    coreRequests: boolean
    localPreferences: boolean
    supervisorStatus: boolean
    diagnosticsExport: boolean
    fullCoreRetry: boolean
  }
  localDegradations: StructuredError[]
  coreSubsystems: CoreSubsystemSnapshot[]
  lastError: StructuredError | null
  migrationProgress: unknown | null
}
```

同一 Desktop 进程内 `revision` 严格递增；每次 Full Core spawn 递增 `generation`。Renderer 必须先订阅再读取，
并且只接受大于当前 revision 的快照。只有 `authoritativeWorkspace && coreRequests` 为真时，Renderer 才能挂载
Camp、成员、Memory、Navigation 或其他权威查询树；阻断期间不得发起这些查询，也不得用合成空集合替代。

这里的门禁约束权威查询/操作，不禁止只包含既有导航 chrome、候选目标标题和局部 loading 的非权威页面框架。
本机 Main Window Session snapshot 不依赖 Core ready；框架不代表 Camp 已存在、已进入或已读，也不能提交下次恢复位置。
正常启动的 400ms 反馈与明确阻断后的恢复面由 [App Shell 冷启动反馈](../ui/components/app-shell-navigation.md#冷启动反馈)
和 [Bootstrap Shell](../ui/components/bootstrap-shell.md)规定；本段不改变 capability、请求或数据库准入语义。

## 2. Core startup frames

Core stdout 使用独立于普通 request/response 的 NDJSON 启动帧：

```ts
type CoreStartupFrame = {
  kind: 'core_startup'
  schemaVersion: 1
  status: 'phase' | 'ready' | 'blocked' | 'failed'
  phase?: StartupPhase
  authorityState?: AuthorityState
  error?: StructuredError
  progress?: unknown
  subsystems?: CoreSubsystemSnapshot[]
}
```

`ready` 是唯一允许 Supervisor 进入 `full_core/ready` 的输入。旧 generation 的 stdout、stderr、response、event、
error 或 exit 都不能修改当前 generation，也不能失败当前 generation 的 pending request。确定性的租约占用、准入阻断、
未知数据合同或迁移 SQL 失败进入 `blocked`；准入/打开/迁移阶段明确瞬时失败使用第 9 节的独立 startup retry。
两者均不消耗意外崩溃重启预算；只有当前 child 的意外退出使用有界 crash budget。

## 3. Lease and database admission

Core 在任何 SQLite 打开、初始化、迁移、隔离或 Runtime storage admission 前，先取得 data directory 的 OS 排他
租约。租约绑定 canonical directory 与稳定文件系统对象身份；锁文件保留，释放 handle 即释放租约。另一个活动
Core 持有租约时返回 `owned_by_active_core`，不能执行 SQLite recovery 或创建替代数据库。

`DatabaseAdmission::assess(lease)` 只返回以下封闭结果：

- `AdmittedExisting(ExistingAuthorityTicket)`；
- `Initializable(NewAuthorityTicket)`；
- `RequiresMigration(MigrationAuthorityTicket)`；
- `Blocked(AuthorityBlock)`。

票据是绑定租约、不可复制、一次消费的能力。消费时重新核对 data directory、main、WAL 与 rollback journal 的
对象身份、长度和状态；SHM 不要求跨检查字节稳定。没有 main 且存在 WAL/journal 必须阻断；只有孤立 SHM 时，
可在票据消费时再次核对 exact identity 后删除。`rovai.sqlite` 与 `lumen.sqlite` 同时存在是歧义；只有
`lumen.sqlite` 时必须精确打开或迁移它，不能顺带创建 `rovai.sqlite`。

合同探测优先使用 READ_ONLY/NOFOLLOW，禁止 CREATE。干净 WAL 模式下，SQLite 可能新建零字节 WAL 与 SHM；只有
main/journal 的完整 identity 未变且 WAL 从缺失变为零字节普通文件时，才接受该探测副作用。新出现的非空 WAL、
已有 WAL 的改变或 main/journal 改变必须拒绝。票据保存刷新后的 WAL identity，后续消费严格复核，不延续该例外。

精确的 `SQLITE_READONLY_ROLLBACK`（776）与 `SQLITE_READONLY_RECOVERY`（264）不能直接归类为权限拒绝。在 lease
仍有效、两个 namespace 的 authority artifacts 与观察相符且对应 journal/WAL 存在时，Admission 可以对 exact target
执行一次 READ_WRITE/NOFOLLOW、无 CREATE、`query_only=ON` 的合同探测，让 SQLite 自己完成正常 journal recovery。
这只允许引擎恢复，不允许应用写入、schema migration、手动删除 journal、改权限或另建 authority。恢复后复核 main
对象和仍存在的 sidecar 对象没有被替换、另一 namespace 未变，再完整重新评估并签发新票据。若再次需要恢复，返回
可重试 busy；未知合同、损坏和真正权限故障仍按重新评估结果处理。

只有完整确认两个 namespace 都没有 main/WAL/journal 后才能初始化。初始化在私有 staging 数据库中完成 schema、
seed、checkpoint 和校验，发布前再次确认 absence，并用原子 create-if-absent 提交 `rovai.sqlite`；竞态出现的
canonical target 永不被覆盖。

所有正式连接（existing、initialized、migrated）都必须配置 `journal_mode=WAL`、`synchronous=NORMAL`、
`foreign_keys=ON` 与 `busy_timeout=5000`。只读探测保持短超时；首次初始化 staging 为安全发布收敛到 DELETE，
不改变该运行合同，也不意味着旧库升级仍可生成 staging。

## 4. Migration and recovery

普通 `SupportedMigrationSource` 只在 ticket 指向的原 authority 上运行既有逐版本 SQLite migration chain。
不增加 planner、strategy/descriptor registry、第二套渠道 migrator 或横跨所有版本的大事务。

执行入口只接受租约绑定的 migration capability，不接受调用方额外拼接的数据库路径。消费前后复核 data-dir/main/
WAL/journal identity 与另一 namespace 的缺席；使用 `READ_WRITE | NOFOLLOW | NO_MUTEX` 打开，绝不包含 CREATE。
在 WAL 配置或任何应用写入前，以同一只读事务再次执行 `classify_database_contract` 并核对 ticket 保存的
contract/schema/classifier、schema cookie 与完整 migration receipts（含 applied_at）。源状态或 identity 漂移返回
`authority_contract_changed`，不可自动重试，不解释为 corruption、不回退复制、不创建或隔离 authority。

每个 migration 的 DDL/DML、contract marker 与 receipt 在该步骤自己的 IMMEDIATE 事务内提交。当前步骤失败只回滚
当前步骤；先前提交的 receipt 保留。重启先完整 admission，再从缺失 receipt 继续。编号冲突仍按
[Channel/Main Schema Join v2](channel-main-schema-join-v2.md)的精确 fingerprint 在原事务中映射，不改变业务 ID。

普通升级不创建 migration manifest、完整 staging/backup，不分离 sidecar、不替换主文件、不默认运行全库
`quick_check` 或无表范围的 `foreign_key_check`。新增表/列/索引/trigger 以 schema metadata 核对；必须关闭外键以重建的
历史步骤，只在各自提交前验证显式受影响表及其入向依赖的外键，失败仍回滚该步骤。已有不可变历史快照/receipt 的必要转换保留在
对应事务；通用历史派生投影重算应放在 ready 后，用户主动备份、完整诊断和 corruption recovery 独立于正常升级。

完成后关闭连接、再次 `DatabaseAdmission::assess`；原 main 对象必须仍相同，允许本轮已提交写入与 SQLite 自有 WAL
变化，不允许替换主文件或出现另一 authority。`AdmittedExisting` 才能精确重新打开；`RequiresMigration` 继续同一链；
`Blocked` 或 `Initializable` 都停止启动，不创建空库。租约保持到当前 Core 生命周期结束。

### Legacy snapshot recovery

此前版本留下的 `.rovai-authority-migration-v1.json`、staging 与 backup 仍由既有恢复代码处理；
生产 Upgrade 不再生成新的 snapshot。路径、backup 边界与记录的文件身份仍严格验证：

- 当前 main 匹配 original identity：恢复已核对的旧 sidecar，删除仅属于该 manifest 且 identity 匹配的 staging，再重新准入；
- 当前 main 匹配 migrated identity：保留新 main，把匹配的旧 sidecar 留在原备份位置，再重新准入；
- 两者均不匹配，或遇到未知 sidecar：拒绝恢复，不覆盖未知对象。

只有这条旧 rename 恢复路径可以解释 Unix rename 导致的 ctime 变化：对象、长度与 mtime 必须仍匹配。
普通 admission/ticket 的完整 identity 比较不适用此例外；替换、内容变化和未知状态仍 fail closed。
恢复失败保留现场和 Desktop 壳层，不建立替代 authority。Bundled SQLite 仍须使用包含上游修复的 `>= 3.51.3`。

## 5. Request transport and shutdown

Preload 对 Renderer 保持 `request<T>(): Promise<T>`。Main 与 Preload 内部使用显式 transport：

```ts
type RovaiRequestTransport<T> =
  | { kind: 'value'; value: T }
  | { kind: 'failure'; failure: RovaiRequestFailure }

type RovaiRequestFailureKind =
  | 'domain_rejection'
  | 'infrastructure_failure'
  | 'full_core_unavailable'
  | 'shutdown'
```

失败还必须保留 `code/message/retryable/generation/details`。Main 不依赖 Electron 对 remote Error 的字符串化来区分
领域拒绝与基础设施失败；Preload 用普通 `RovaiRequestFailure` 对象拒绝 Promise，不让带自定义字段的 `Error` 跨
`contextBridge`。需要 Error 实例时只能在 Renderer 收到对象后构造；统一错误读取函数必须同时识别本地 Error 和普通
failure 的字符串 `message`。真实 Electron 隔离世界测试必须验证所有字段保留，成功值与公开 `Promise<T>` 不变。
只有显式 Desktop shutdown 可以失败所有 generation；普通 child error/exit 只能失败其自己的 pending request。

## 6. Local preference degradation

Desktop 本机偏好不属于 SQLite authority。文件 missing 使用内存默认且不告警；文件损坏、不可读或需要清理时，
使用内存默认/规范化结果、发布 `localDegradations`，并保留原文件。只有后续明确的用户设置操作才可写新快照。
偏好故障不能禁止 Full Core；反过来，Full Core 阻断也不能禁止主题、Supervisor 或 bootstrap diagnostics。

## 7. Authority ready and optional subsystem gates

Core ready 必须先完成 controlled-shutdown、accepted-input / execution 与 delivery 的领域恢复。此类恢复失败发布
`failed / recovering_authority / authority_recovery_failed`，保留原 authority、正常退出并允许用户重试，不计作意外崩溃。
这里的 `retryable=true` 表示显式用户重试，不进入 admission/migration 的瞬时自动重试。
既有 compaction policy/outbox/observer 启动协调仍是 best effort，保持 replay-before-fence 和启动一次的顺序，不能在
功能重试中重新 fence 已启动的新 Observer，也不能把 detector 故障提升为 Runtime Readiness。

Skill Library、MCP config、Runtime adapter 私有存储、Built-in Tool IPC、attachment reconciliation 和非关键维护在
ready 后初始化；服务对象构造本身不做这些 I/O。每个功能只拥有当前进程内的能力状态，不增加数据库准入类别或替代 authority：

```ts
interface CoreSubsystemSnapshot {
  id: string // skills, mcp, attachments, maintenance, builtin-tools, runtime.<AdapterKind>
  state: 'initializing' | 'ready' | 'degraded'
  error: StructuredError | null
}
```

ready 帧携带初始完整 `subsystems`；普通 `runtime.subsystemsChanged` event 携带更新后的完整数组。Supervisor 只接受
当前 ready child 的 event，并在离开 `full_core` 时清空 `coreSubsystems`；旧 generation 不能恢复旧功能状态。
`runtime.subsystems.get` 返回完整数组；`runtime.subsystems.retry` 串行重试未就绪功能，已健康服务不重建、不重复清理
活动 Runtime。它不重启 Core、不重新数据库准入、不消耗 crash budget。

Core 对依赖的功能执行门禁，不仅是 Renderer 隐藏控件：`skills.*`、MCP 操作（显式 permissions repair 除外）与
`camp.attachments.*` 在对应功能未就绪时返回 `infrastructure_failure / subsystem_unavailable`，带
`retryable=true`、`details.subsystem/state` 与 Main 注入的当前 generation。AgentRun dispatch/launch 在 Skills、MCP、
Attachments、Built-in Tools 及该 Runtime adapter 未就绪时不执行；已排队工作保留，功能恢复后由现有 dispatcher 重试。
`maintenance` 失败不阻断领域读写或 Runtime admission。成员、Camp/Task/消息记录和导航仍读取同一 authority，不能用空数据
替代失败的功能结果。原有 per-Camp 附件权限与 Runtime 平台准入继续独立生效。

pending Camp cleanup 只接受 ready 前捕获的候选 ID；实际删除在同一事务中复核空草稿条件。重试不重扫本次启动后新建的
Camp；已完成领域删除但尚未成功清理的 exact 目录在当前进程内保留为 retry targets，不把目录清理失败传播到 Full Core。
候选快照读取失败时记录诊断并跳过本次启动的 pending cleanup，不阻断 ready，也不在稍后改为全量重扫。

## 8. Windows pre-ready Bootstrap assessment

Windows 先使用已打包的 `rovai.exe --prepare-windows-bootstrap-root <instance-key>` 建立独立私有壳层布局；该入口
不启动 Core、不打开 SQLite、不运行 Runtime。它用 OS LocalAppData Known Folder 与稳定 key，创建时即设置 protected
DACL，输出只有 Electron User Data / Session Data、Logs、CrashDumps 的封闭布局，绝无 Core path。

绑定壳层路径后取得 single-instance lock；只有 primary 才解析 Core binary / 正式 root，并调用完整 data-root preparer。
成功时在 ready 前绑定正式 Electron 路径并把正式 `<root>\Core` 传给 Core。正式 root 解析、binary 缺失、preparer
启动/超时/退出/输出或路径绑定失败都收敛为 `blocked / preparing_windows_data_root` assessment：恢复全部壳层路径，
打开 Bootstrap Shell，保留具体原因和 local degradation，Core data path 为 null，不能 spawn，也不创建 fallback SQLite。
每次启动均先用同一个壳层 profile 取锁；正式路径绑定成功与否不改变下一实例的锁 identity。

由于 `sessionData` 必须在 Electron ready 前绑定，Windows 此类“重新打开”仍使用原命令行 relaunch Desktop，
不尝试 ready 后重绑路径；产品文案与其他启动失败统一。壳层偏好与正式偏好不隐式复制或覆盖。若连独立私有壳层存储也无法准入，使用可在 ready 前调用的
原生错误对话框结束启动；不能降到未验证 ACL 的默认 profile。此宿主安全边界不伪装为 Full Core crash 或数据库故障。

这些约束补充 [Windows Private Storage v2](windows-private-storage-v2.md)，不改变正式 Core / Runtime Files Root 布局。

## 9. Startup retry, presentation and diagnostics

Main 只对数据库 admission/open/migration 的 `SQLITE_BUSY`、`SQLITE_LOCKED`、明确瞬时 I/O
（如 `SQLITE_IOERR_BLOCKED`、Interrupted/WouldBlock、Windows sharing/lock violation）进行最多三次自动重试：
250ms → 750ms → 1500ms。必须收到结构化 refusal，并等待原 child 退出后才 spawn 下一 generation；
等待期间保持 `bootstrap_only/starting` 和既有页面框架，权威 hooks 不挂载。成功 ready 或用户显式重新打开时重置
startup retry 次数；不会递增 crash restartAttempt。shutdown 取消待执行重试，旧 generation 不能再调度。

`owned_by_active_core`、Unknown/Newer Contract、Ambiguous Authority、Unsafe Path、Identity Changed、schema fingerprint
不匹配和确定性 SQL/约束失败均不自动重试。不能只凭任意 `retryable=true` 或错误文字启动无限重试。

Main 在 Runtime storage 准备之前就接收准确的 admitted/migration_required/confirmed_absent assessment；
已见 existing/migration authority，或一次瞬时准入失败无法安全确认 absence 时，在同一 Desktop 生命周期的后续启动附带
`--require-existing-authority`。该限制只能禁止初始化，不授予路径或创建权限；新 generation 仍完整 admission。
若原 authority 消失，返回非重试 `authority_required_existing_missing`，不得把自动/手动重试或 crash restart 变成空库初始化。
首次已确认 absence 的非瞬时 Runtime preparation 失败不伪装成 existing authority，显式修复后仍能正常首次初始化。

产品保持同一个 400ms 截止时间与既有 rail/顶行/内容区：不足 400ms 不显示启动提示，超过后统一“正在打开会话”。
Renderer 不按 migration/internal phase 切换文案，不显示 SQLite、数据库、合同、备份、原库、schema、staging、页数或阶段。
ready 后进入真实会话；最终失败显示“暂时无法打开会话”，提供“重新打开”与“导出诊断”。
原始技术错误只保留于 Supervisor、日志和诊断；产品恢复面不直接渲染 error.message、路径或错误码。

本地 trace 记录 `authority_assessment`、`authority_open`、`migration_reconciliation`、实际执行的 `migration_N`、
`authority_reassessment`、`authority_reopen`、`core_ready`，字段为 `stage/elapsedMs/sourceContract/targetContract`。
没有源合同可用时 sourceContract 为 null。trace 不记录 SQL、业务行、渠道 Session/credential 或 Cookie。

## References

- [Availability-first Runtime Architecture](../architecture/availability-first-runtime.md)
- [First-run Onboarding v3](first-run-onboarding-v3.md)
- [Bootstrap Shell UI](../ui/components/bootstrap-shell.md)
- [V1.31 Decisions](../versions/v1.31/decisions.md)
- [V1.36-D07](../versions/v1.36/decisions.md#v1-36-d07)
