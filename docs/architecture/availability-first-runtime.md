---
document_type: architecture
authority: desktop-availability-and-authority-startup-boundary
status: accepted
last_updated: 2026-08-30
---

# Availability-first Runtime

Rovai Desktop 把“窗口可用”与“权威工作区可用”拆成两个明确层级。Desktop 壳层可以在偏好损坏、Core 迁移或
SQLite 阻断时继续工作；SQLite authority 仍然 fail closed。这个拆分不建立第二套业务状态，也不允许空库或空列表
冒充原工作区。

## Component authority

| Component | Owns | Does not own |
| --- | --- | --- |
| Electron bootstrap | 窗口、主题、本机偏好默认、诊断保存、Supervisor IPC | SQLite 选择、数据库修复推断、业务投影 |
| CoreClient Supervisor | child generation、完整 revision snapshot、能力门禁、请求 fencing、意外退出预算 | 领域状态、SQLite recovery 决策 |
| CoreSubsystems | 当前进程的可选功能初始化、错误、执行门禁与串行重试 | 数据库准入、替代 authority、Runtime qualification |
| Core data-directory lease | canonical data directory 的 OS 排他所有权与稳定对象身份 | 数据合同分类或迁移 |
| DatabaseAdmission | exact Rovai/Lumen artifact 观察、只读优先探测、租约内 SQLite journal recovery、一次性票据、typed blocker | schema 写入、自动 quarantine、UI 文案 |
| Database open/init | 票据消费后的 exact open，或 confirmed absence 上的 staging initialization | 目录扫描式猜测、覆盖竞态 target |
| AuthorityMigrationRunner | 一致副本、旧数据保留、验证、manifest、原子切换与中断恢复 | 原库原地 migration、失败后创建空 authority |
| Renderer startup boundary | 订阅 Supervisor、读取本机恢复目标、立即显示页面框架、400ms 局部反馈；明确阻断时展示恢复壳层 | 未准入时挂载权威 hooks、合成业务空集合 |

## Startup sequence

```text
Windows only: admit private Bootstrap profile -> single-instance lock
  -> assess formal root (failure => bound Bootstrap Shell, no Core path)
Electron ready
  -> install in-memory local defaults
  -> create BrowserWindow and mount ordinary page chrome (no Core hooks)
  -> load local preference files (failure => warning, original retained)
  -> freeze Main Window Session from loaded local preferences, render its target frame
  -> spawn Full Core generation
       -> acquire CoreDataDirLease
       -> DatabaseAdmission::assess
          -> Existing ticket -> exact open
          -> Initializable ticket -> staged create-if-absent publish
          -> Migration ticket -> backup/migrate/validate/switch/reassess
          -> Blocked -> structured refusal and clean exit
       -> mandatory execution/input/delivery recovery (failure => typed refusal)
       -> ready(authority origin, initializing subsystems)
  -> Supervisor enables authoritativeWorkspace/coreRequests
  -> Renderer mounts authority-backed hooks inside the restored route
       -> initialize optional services -> ready or feature-scoped degraded
```

Runtime attachment storage admission发生在数据库已经分类且 lease 仍持有之后；任何失败都不能反向创建另一个 SQLite
authority。Full Core ready 之前，Renderer 不调用 `navigation.snapshot`、Camp、Member、Memory 或 Onboarding 的
Core-backed read path。

页面框架不是权威查询树。Root 从首次挂载起只计一次 400ms；正常检查、迁移和自动重启都保留既有 rail/顶行，超时仅在
目标内容区呈现 loading。ready 后读取 Onboarding、偏好和目标投影时继续使用同一截止时间，不插入第二个全屏 gate。
只有 `blocked` / `crashed` 才切换到带重试、主题与诊断的 Bootstrap Shell。数据未返回前不展示业务空态、不确认已读、
不提交恢复位置。精确呈现由 [冷启动反馈](../ui/components/app-shell-navigation.md#冷启动反馈)拥有。

BrowserWindow 可以先于本机文件读取创建，但 Main Window Session 不能用尚未加载的默认偏好冻结恢复目标。首次窗口的
snapshot IPC 等待本机 preference/restorable-location 加载，不等待 Core；关闭窗口使迟到读取失效。之后新建窗口仍从
当前偏好创建新的、冻结的 session snapshot。

## Optional startup boundary

Skill/MCP/adapter 对象先无 I/O 构造。ready 后独立初始化其存储与迁移、Builtin IPC、附件协调及非关键 cleanup；一个失败
不会从 `run_core()` 传播到进程退出。Core 持有功能门禁，拒绝依赖功能的请求并暂缓相关执行；数据库记录查询不依赖这些
初始化结果。状态由 startup frame + generation-fenced event 合并到 Supervisor 完整快照，Renderer 显示原因与原进程重试，
不卸载健康的权威工作区。重试跳过已健康服务，不能清理或替换已活动的 Runtime/IPC。

既有 compaction 启动协调保留 best-effort 语义与 replay-before-fence 顺序，在新 Runtime 启动前运行一次；它不进入
可重试 cleanup 集合。controlled-shutdown、accepted-input 和 delivery recovery 仍在 ready 前，失败通过结构化 refusal
阻断执行，不能用 optional failure 策略掩盖未收敛的权威状态。

## Windows shell storage boundary

完整 Core preparer 不再是窗口前置条件。独立壳层 profile 由已经打包的 Agent CLI 的 Desktop-only 原生入口创建，只有
Electron 本机状态，不包含 Core path；继续使用原有 protected-DACL 原语，没有 PowerShell、普通 mkdir fallback 或静默修权。
所有实例先绑定同一个 profile 再判定 single-instance，只有 primary 才准备正式 data root。成功后仍在 ready 前使用原正式
布局；失败回到已准入的壳层路径并展示 assessment，CoreClient 持有 null data path 而不是临时数据库目录。

Windows 重新检查该 assessment 会保留原参数 relaunch Desktop，避免 ready 后重绑 Chromium sessionData。若私有壳层
存储本身也不可用，只能原生提示并结束启动；这与正式 root 失败时仍显示 Electron Shell 是两条不同边界。
协议细节见 [Windows Bootstrap assessment](../contracts/desktop-runtime-availability-v1.md#8-windows-pre-ready-bootstrap-assessment)。

## Database authority state machine

准入观察 `rovai.sqlite` 与 `lumen.sqlite` 的 main/WAL/journal/SHM。main、WAL 与 rollback journal 是决定恢复边界的
authority artifacts；SHM 是可丢弃协调缓存，但只能在 main 不存在、票据仍有效且 identity 未变化时清理。

两个 main 同时出现、孤立 WAL/journal、未知合同、损坏/不可读、权限拒绝、SQLite busy 或对象 identity 改变都产生
typed blocker。现有 main 优先以 READ_ONLY/NOFOLLOW 探测，不使用 CREATE。只读连接对干净 WAL 库可能新建空 WAL
和 SHM：只有 main/journal 的对象、长度与状态未变，且原本缺失的 WAL 新建后为零字节，才视为正常探测副作用。
已存在 WAL 的改变、新出现的非空 WAL 与 main/journal 改变仍拒绝；这不改变孤立 WAL 的阻断规则。

`SQLITE_READONLY_ROLLBACK` / `SQLITE_READONLY_RECOVERY` 表示引擎需要正常日志恢复，不等同于目录权限拒绝。
Admission 在仍持有 lease 且复核两个 namespace 后，只对原 exact target 做一次 READ_WRITE/NOFOLLOW、无 CREATE、
`query_only` 的探测，让 SQLite 回滚 hot journal 或恢复 WAL。恢复可以改变物理字节和移除已消费日志，但不执行应用
DML、schema migration 或手动 journal 删除。随后丢弃旧观察并完整重新准入；未知合同、真实权限问题或损坏仍按实际
结果拒绝，重复遇到恢复要求返回可重试 busy，不增加永久 blocked 状态。

支持的旧合同拿 migration ticket；current 合同拿 existing ticket；确定没有两个 namespace 的 authority artifacts
才拿 initialization ticket。

票据将“检查结果”与“允许执行的下一步”绑定。打开前再次核对 main/WAL/journal；初始化发布前再次确认 absence，并
通过 no-replace commit 消除最后窗口的覆盖风险。票据保存探测后的完整 WAL identity，消费时不再放宽空 WAL 转换。
SHM 不参与 existing/migration ticket 的绝对字节稳定要求。

正常打开、新建发布后打开、迁移发布后打开统一配置 WAL、`synchronous=NORMAL` 与 foreign keys；staging 的 DELETE
模式只服务于单文件发布，不得成为正式连接的运行配置。

## Migration switch

Migration 在 staging copy 上运行完整现有 schema chain。验证通过后，先保存原 artifacts 与 identity manifest，再分离
旧 sidecar，最后替换 exact source main。恢复不信任 manifest 的 stage 字段来猜结果，而是比较当前 main 与 original /
migrated identity；未知 identity 永远阻断。真实子进程强杀测试覆盖 sidecar 已分离、main 尚未切换的窗口。

## Supervisor and request fencing

每个 spawn 获得单调 generation 和不可复用 child token。所有 pending request、stdout line、event、process error 与
exit 都绑定二者；旧 child 的迟到消息被丢弃。Snapshot 每次发布完整状态并推进 revision，Renderer 只接受更新 revision。

确定性 authority refusal 不属于 crash，不触发自动重启；用户可从壳层显式重试。只有当前 child 意外退出使用有界 crash
budget。关闭是唯一允许跨 generation 失败全部 pending request 的路径。

请求在 Core 内保留领域拒绝与基础设施失败的结构化类别，经 Main 的 value/failure envelope 穿过 Electron IPC；Preload
以普通 failure 对象拒绝 Promise，保留 `kind/code/message/retryable/generation/details`。`contextBridge` 会丢弃 Error
的自定义字段；如需 Error 实例只能在 Renderer 收到对象后构造。统一错误读取函数同时接受本地 Error 和 failure 对象，
Renderer 对外仍只见 `Promise<T>`。

## Local fail-open boundary

Appearance、General、Navigation、Onboarding 和 Restorable Location 是 Desktop-local 状态，不是 Core authority。
missing 使用默认；损坏或不可读使用内存默认/规范化结果、显示警告并保留原文件。用户之后明确修改该项时才产生新文件。
这些故障不会关闭 Full Core。反过来，Full Core 阻断时只有本机壳层能力可用，不暴露任何看似正常的业务内容。

## References

- [Desktop Runtime Availability v1](../contracts/desktop-runtime-availability-v1.md)
- [First-run Onboarding](first-run-onboarding.md)
- [Bootstrap Shell UI](../ui/components/bootstrap-shell.md)
- [V1.31 Decisions](../versions/v1.31/decisions.md)
