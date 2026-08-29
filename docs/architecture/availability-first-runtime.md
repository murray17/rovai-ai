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
| Core data-directory lease | canonical data directory 的 OS 排他所有权与稳定对象身份 | 数据合同分类或迁移 |
| DatabaseAdmission | exact Rovai/Lumen artifact 观察、SQLite 只读探测、一次性票据、typed blocker | schema 写入、自动 quarantine、UI 文案 |
| Database open/init | 票据消费后的 exact open，或 confirmed absence 上的 staging initialization | 目录扫描式猜测、覆盖竞态 target |
| AuthorityMigrationRunner | 一致副本、旧数据保留、验证、manifest、原子切换与中断恢复 | 原库原地 migration、失败后创建空 authority |
| Renderer bootstrap gate | 订阅 Supervisor、展示壳层状态、主题、重试与诊断 | 挂载权威 hooks、合成业务空集合 |

## Startup sequence

```text
Electron ready
  -> install in-memory local defaults
  -> create BrowserWindow and mount Bootstrap Shell
  -> load local preference files (failure => warning, original retained)
  -> spawn Full Core generation
       -> acquire CoreDataDirLease
       -> DatabaseAdmission::assess
          -> Existing ticket -> exact open
          -> Initializable ticket -> staged create-if-absent publish
          -> Migration ticket -> backup/migrate/validate/switch/reassess
          -> Blocked -> structured refusal and clean exit
       -> ready(authority origin)
  -> Supervisor enables authoritativeWorkspace/coreRequests
  -> Renderer mounts the normal App tree
```

Runtime attachment storage admission发生在数据库已经分类且 lease 仍持有之后；任何失败都不能反向创建另一个 SQLite
authority。Full Core ready 之前，Renderer 不调用 `navigation.snapshot`、Camp、Member、Memory 或 Onboarding 的
Core-backed read path。

## Database authority state machine

准入观察 `rovai.sqlite` 与 `lumen.sqlite` 的 main/WAL/journal/SHM。main、WAL 与 rollback journal 是决定恢复边界的
authority artifacts；SHM 是可丢弃协调缓存，但只能在 main 不存在、票据仍有效且 identity 未变化时清理。

两个 main 同时出现、孤立 WAL/journal、未知合同、损坏/不可读、权限拒绝、SQLite busy 或对象 identity 改变都产生
typed blocker。现有 main 只以 READ_ONLY/NOFOLLOW 探测，探测本身不创建文件。支持的旧合同拿 migration ticket；
current 合同拿 existing ticket；确定没有两个 namespace 的 authority artifacts 才拿 initialization ticket。

票据将“检查结果”与“允许执行的下一步”绑定。打开前再次核对 main/WAL/journal；初始化发布前再次确认 absence，并
通过 no-replace commit 消除最后窗口的覆盖风险。SHM 不参与 existing/migration ticket 的绝对字节稳定要求。

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
重新构造本地 Error，Renderer 对外仍只见 `Promise<T>`。

## Local fail-open boundary

Appearance、General、Navigation、Onboarding 和 Restorable Location 是 Desktop-local 状态，不是 Core authority。
missing 使用默认；损坏或不可读使用内存默认/规范化结果、显示警告并保留原文件。用户之后明确修改该项时才产生新文件。
这些故障不会关闭 Full Core。反过来，Full Core 阻断时只有本机壳层能力可用，不暴露任何看似正常的业务内容。

## References

- [Desktop Runtime Availability v1](../contracts/desktop-runtime-availability-v1.md)
- [First-run Onboarding](first-run-onboarding.md)
- [Bootstrap Shell UI](../ui/components/bootstrap-shell.md)
- [V1.31 Decisions](../versions/v1.31/decisions.md)
