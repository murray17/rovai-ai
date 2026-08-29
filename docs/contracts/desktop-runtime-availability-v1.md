---
document_type: protocol-contract
contract: desktop-runtime-availability-v1
authority: desktop-bootstrap-supervisor-authority-admission-and-request-transport
status: accepted
version: 1
last_updated: 2026-08-30
---

# Desktop Runtime Availability v1 Contract

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
  lastError: StructuredError | null
  migrationProgress: unknown | null
}
```

同一 Desktop 进程内 `revision` 严格递增；每次 Full Core spawn 递增 `generation`。Renderer 必须先订阅再读取，
并且只接受大于当前 revision 的快照。只有 `authoritativeWorkspace && coreRequests` 为真时，Renderer 才能挂载
Camp、成员、Memory、Navigation 或其他权威查询树；阻断期间不得发起这些查询，也不得用合成空集合替代。

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
}
```

`ready` 是唯一允许 Supervisor 进入 `full_core/ready` 的输入。旧 generation 的 stdout、stderr、response、event、
error 或 exit 都不能修改当前 generation，也不能失败当前 generation 的 pending request。确定性的租约占用、准入阻断、
未知数据合同或迁移失败进入 `blocked`，不消耗意外崩溃重启预算；只有当前 child 的意外退出使用有界重启预算。

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

只有完整确认两个 namespace 都没有 main/WAL/journal 后才能初始化。初始化在私有 staging 数据库中完成 schema、
seed、checkpoint 和校验，发布前再次确认 absence，并用原子 create-if-absent 提交 `rovai.sqlite`；竞态出现的
canonical target 永不被覆盖。

## 4. Migration and recovery

受支持的旧 Data Contract 使用 SQLite Backup API 创建一致副本，在副本上执行现有 migration chain、seed、
`quick_check`、`foreign_key_check`、checkpoint 与 journal 收敛。原 main/WAL/journal/SHM 复制到操作级私有备份目录；
同目录 manifest 记录 original 与 migrated main 的对象身份和切换阶段。

切换先分离已核对的旧 sidecar，再原子替换 exact source filename。进程中断后：

- 当前 main 匹配 original identity：恢复旧 sidecar，丢弃仍匹配的 staging，再重新评估；
- 当前 main 匹配 migrated identity：保留新 main，并把仍匹配的旧 sidecar 留作备份；
- 两者都不匹配：阻断自动恢复，不覆盖未知对象。

迁移失败不得创建空 authority、删除原 authority 或关闭 Desktop 壳层。Bundled SQLite 必须使用包含上游修复的
`>= 3.51.3` 版本；当前构建由 `rusqlite` bundled SQLite 提供。

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
领域拒绝与基础设施失败；Preload 用带上述字段的本地 `Error` 拒绝 Promise。只有显式 Desktop shutdown 可以失败
所有 generation；普通 child error/exit 只能失败其自己的 pending request。

## 6. Local preference degradation

Desktop 本机偏好不属于 SQLite authority。文件 missing 使用内存默认且不告警；文件损坏、不可读或需要清理时，
使用内存默认/规范化结果、发布 `localDegradations`，并保留原文件。只有后续明确的用户设置操作才可写新快照。
偏好故障不能禁止 Full Core；反过来，Full Core 阻断也不能禁止主题、Supervisor 或 bootstrap diagnostics。

## References

- [Availability-first Runtime Architecture](../architecture/availability-first-runtime.md)
- [First-run Onboarding v3](first-run-onboarding-v3.md)
- [Bootstrap Shell UI](../ui/components/bootstrap-shell.md)
- [V1.31 Decisions](../versions/v1.31/decisions.md)
