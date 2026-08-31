---
document_type: architecture
authority: desktop-availability-and-authority-startup-boundary
status: accepted
last_updated: 2026-08-31
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
| DatabaseAdmission | exact Rovai/Lumen artifact 观察、只读优先探测、租约内 SQLite journal recovery、一次性票据、typed blocker | schema 写入、自动 quarantine、UI 文案 |
| Database open/init | 票据消费后的 exact open，或 confirmed absence 上的 staging initialization | 目录扫描式猜测、覆盖竞态 target |
| AuthorityMigrationRunner | exact 原位逐版本事务、receipt 续跑、重新准入、旧 manifest 中断恢复 | 常规整库副本、替换主文件、失败后创建空 authority |
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
          -> Migration ticket -> exact in-place transactions/reassess/reopen
             (existing legacy manifest only -> recover old switch/reassess)
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
目标内容区统一呈现“正在打开会话”，不根据内部 phase 展示数据库术语。ready 后读取 Onboarding、偏好和目标投影时
继续使用同一截止时间，不插入第二个全屏 gate。
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
协议细节见 [Windows Bootstrap assessment](../contracts/desktop-runtime-availability-v2.md#8-windows-pre-ready-bootstrap-assessment)。

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

正常打开、新建发布后打开、迁移后重开统一配置 WAL、`synchronous=NORMAL`、foreign keys 与 `busy_timeout=5000`；
首次初始化 staging 的 DELETE 模式只服务于单文件发布，不得成为正式连接的运行配置。

## Migration switch

此历史锚点继续保留，但普通 Upgrade 已改为原位事务。入口只消费 lease-bound ticket，不允许额外传路径；
READ_WRITE/NOFOLLOW/NO_MUTEX 打开且不带 CREATE。任何写入前，在同一只读事务重验 contract/schema/classifier、
完整 receipt（含 applied_at）和 schema cookie，并再次验证文件身份；漂移返回非重试 `authority_contract_changed`。

复用既有逐版本 IMMEDIATE 事务，DDL/DML、marker 和 receipt 一起提交，失败只回滚当前步骤；重启从缺失步骤继续。
正常迁移不创建 staging、backup、manifest，不替换 main，不默认执行全库 quick_check/foreign_key_check。关键对象
检查只读 schema metadata，关闭外键重建的步骤在本事务提交前检查显式受影响表及其入向引用。迁移后复核同一 main、重新 admission
和 exact reopen；Blocked 或 Initializable 都停止，不创建替代 authority。通用历史投影补算、完整诊断与用户备份各自独立。

旧 Snapshot manifest 仍由原恢复代码处理：比较 actual main 与 original/migrated identity，不凭 stage 猜测。
Unix rename 的 ctime 变化只在这条兼容路径解释，对象、长度和 mtime 仍必须匹配；普通票据保持完整严格比较。
真实强杀覆盖切换前后两侧，也覆盖原位 reconciliation 和 126 已提交时的中断；未知对象始终阻断。

主线 Pending/Fast 与渠道的 117/118 编号冲突按 [Channel/Main Schema Join v2](../contracts/channel-main-schema-join-v2.md)
汇合：保留渠道顺序，把精确识别的旧主线 receipt 在同一原库事务内映射到 126/127，128 只在两侧 schema 全部完成后
发布历史 `v1.39/schema 80` marker，129 再推进当前合同。旧飞书 marker collision 同样复用原链。
不能仅凭版本字符串准入，也不能为了消除编号冲突清空凭据、队列、Fast 选择或改变业务 ID。

内部 trace 保留 assessment/open、reconciliation、每个实际 migration、reassessment/reopen、core_ready 的耗时和
source/target contract；不记录 SQL、业务行或渠道秘密，不把技术阶段转为产品页面文案。

## Supervisor and request fencing

每个 spawn 获得单调 generation 和不可复用 child token。所有 pending request、stdout line、event、process error 与
exit 都绑定二者；旧 child 的迟到消息被丢弃。Snapshot 每次发布完整状态并推进 revision，Renderer 只接受更新 revision。

确定性 authority refusal 不属于 crash，也不触发自动重试。仅 admission/open/migration 的明确 busy/locked、短暂文件占用
与已分类瞬时 I/O 使用独立 250/750/1500ms startup retry；必须等原 child 退出，期间保持 starting 和 capability gate。
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

- [Desktop Runtime Availability v2](../contracts/desktop-runtime-availability-v2.md)
- [First-run Onboarding](first-run-onboarding.md)
- [Bootstrap Shell UI](../ui/components/bootstrap-shell.md)
- [V1.31 Decisions](../versions/v1.31/decisions.md)
