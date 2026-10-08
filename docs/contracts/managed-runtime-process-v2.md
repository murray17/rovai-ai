---
document_type: contract
contract: managed-runtime-process-v2
status: accepted
source_version: v1.58
last_updated: 2026-10-07
---

# Managed Runtime Process v2

本合同拥有 Core-managed Runtime/Probe 进程的跨平台启动接口与 Windows 原子 Job 语义。决策理由见
[ADR-0211](../versions/v1.05/decisions.md#adr-0211)。Runtime terminal 与领域终态仍由既有 AgentRun、
Fleet 与 Planned Shutdown 合同拥有；进程退出不是 Provider outcome。macOS User Automation 改为 CLI 防误调用、移除外层沙箱的
理由见[V1.58-D05](../versions/v1.58/decisions.md#v1-58-d05)。Windows command shim 扩展见
[V1.28-D11](../versions/v1.28/decisions.md#v1-28-d11)。ACP Terminal derived child 的最终请求上下文解析理由见
[V1.39-D08](../versions/v1.39/decisions.md#v1-39-d08)；旧 Pi MCP bridge 对普通 capture 的 portable command 扩展已由
[V1.39-D09](../versions/v1.39/decisions.md#v1-39-d09)撤销。

## 1. Module interface

调用方只提交不可变 `ManagedProcessLaunchSpec`：

```text
purpose
absolute application file
argv[]
working directory
explicit environment snapshot
stdin/stdout/stderr policy
runtime compatibility / execution ownership identity
```

接口返回 `ManagedProcess`，其可观察能力限于 stdio、PID/OS identity、wait、graceful request、bounded tree
termination 与 reap result。调用方不接触 Job/process-group handle，也不自行 attach、break away 或枚举后代。

Managed Process 直接启动捕获的 application 与结构化 argv，不配置 User Automation protected tree，
不增加 Rovai 自有文件访问沙箱。Runtime 原生权限与沙箱由对应 Runtime 控制。

capture 先验证 application 是已存在的绝对文件，再冻结工作目录与显式环境。普通 capture 不按 PATH 或 cwd 解析 bare/
relative application；调用方必须先完成自身已有的 Runtime discovery 与 entrypoint qualification。argv 始终保持结构化
字段，不经 Shell 拼接。

从已准入 Host 派生 `RuntimeOneShot` 时，调用方必须把原始 application、结构化 argv、请求 cwd 与环境覆盖一起交给
`derive_runtime_one_shot_command`。Managed Process 先验证最终 cwd、在 Host 环境快照上应用覆盖，再按最终
cwd/environment 处理 application；调用方不得先按 Host 模板 cwd/PATH 解析再套用请求覆盖。Unix bare command 保持
bare 到 launch，relative path 以最终 cwd 锚定并验证；Windows 使用最终 cwd/PATH 解析后重新进入完整
`NativeExecutable | CommandShim` capture、identity 与原子 Job 链路。

Windows launch policy 只允许以下封闭 entrypoint：

- 经 Runtime Platform Admission 的 native `.exe`；
- 已知 npm/pnpm Codex `.cmd` locator，经验证后解析到 platform package 内真实 native `codex.exe`；
- bounded regular `.cmd` / `.bat` `CommandShim`，以明确的 `windows_command_shim` identity 启动。

只有 `derive_runtime_one_shot_command` 的普通命令名与 cwd-relative 输入会在最终 Runtime `PATH`/cwd 中处理；Windows
按 `.exe → .cmd → .bat` 的封闭顺序解析，然后进入上述相同 entrypoint、identity 与 Job 流程；不读取 PATHEXT，也不把
命令交给通用 Shell。

`.com`、`.ps1`、PowerShell fallback、PATHEXT 全量扩展和调用方自行拼装的通用 Shell command 不属于本合同。
用户 prompt 仍只能经 stdin 投递；command shim argv 只承载 Adapter 声明的控制参数。

Claude Adapter 的完整 Session Bootstrap 通过官方 `--append-system-prompt-file` 引用私有临时 UTF-8 文件；
非空设置同样通过 `--settings` 文件路径传递，避免多行正文和 JSON 字面引号进入 command shim argv。
spawn 前失败可以立即删除文件；spawn 后由 Claude Adapter 登记的轮次对象同时持有受管进程和文件，
调用方取消或 Future 被丢弃不转移清理责任。正常结束、输入或输出失败、取消和 Core 关闭均有界等待根进程退出；
Windows 还须通过所属 Job 的 `tree_is_empty()` 确认后代全部退出，才删除文件并撤销登记。
终止请求成功或根进程退出均不能单独证明进程树已空；超时、状态未知或删除失败时保留剩余文件和登记并记录诊断。
新建与精确恢复 Session 使用相同交付方式，用户消息继续经 stdin 传递。
参数语义见 [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)。

Discovery 可以把已知 npm/pnpm 生成的 Codex `codex.cmd` 作为只读 locator：有界验证精确模板、
`@openai/codex` entrypoint、对应 Windows x64 platform package 与固定 vendor 路径后，只把最终 canonical
`codex.exe` 交给 fingerprint、version probe、Installation 和本接口。此时 `.cmd` 只保留 discovery
diagnostic，不执行 `.cmd`、`node.exe` 或 Node entrypoint；最终 identity 与 executable fingerprint 均属于
`codex.exe`。任一结构、范围或 metadata 校验失败都不能猜测或绑定其他 native executable；它只能保持为明确的
`CommandShim` 候选并接受自身的 Probe 结果。

`CommandShim` capture 必须验证绝对路径、普通非 reparse 文件与 128 KiB 有界内容，冻结 canonical shim path、
content digest、canonical System32 `cmd.exe` path 及 interpreter fingerprint。启动前在打开的 shim/interpreter
identity 下重新计算；任一变化都 fail closed。`lpApplicationName` 固定为已验证的 System32 `cmd.exe`，command
line 只由 Core 的 batch-specific builder 生成，参数为 `/e:on /v:off /d /c`，不读取 AutoRun 或 Shell profile。
builder 拒绝 NUL/CR/LF，不允许调用方提交 raw command fragment，并对空参数、空格、反斜杠、`&|<>^!` 做真实
Windows 执行测试。由于 `cmd.exe` 无法为所有 `%1`/`%*` consumer 无损表示字面引号，且 `%...%` 可能在 batch
内部再次展开，末尾反斜杠也会随 consumer 的 `%1`/`%*` 写法产生歧义；generic `CommandShim` 的 argv 出现 `"`、
`%` 或末尾 `\` 时必须在 CreateProcess 前 fail closed，不能静默改变 argv 或尝试猜测脚本的二次解析方式。路径中的
`%!&^` 仍通过冻结的内部环境变量安全传递；已验证 Codex npm/pnpm shim 则绕过 batch，直接启动 native executable。

## 2. Windows atomic launch

顺序固定：

```text
Create Job Object
→ set JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
→ build STARTUPINFOEXW
→ add PROC_THREAD_ATTRIBUTE_JOB_LIST
→ add PROC_THREAD_ATTRIBUTE_HANDLE_LIST
→ CreateProcessW(absolute lpApplicationName,
                 EXTENDED_STARTUPINFO_PRESENT,
                 bInheritHandles = TRUE)
→ return already-managed process
```

Handle list 只包含本次显式创建为 inheritable 的 stdin/stdout/stderr handles。Job、token、Context、journal、
SQLite、日志和 Core 内部 handles 必须不可继承且不在列表中。不得设置任一 breakaway flag。创建失败、Job
attribute 不可用、嵌套 Job 不兼容或 handle policy 不能证明时，输入投递前 fail closed。

## 3. Application and argv

普通 `ManagedProcessLaunchSpec::capture` 的 application 必须是已存在的绝对文件。只有从已准入 Host 派生的
`RuntimeOneShot` 可以携带普通命令名或 cwd-relative path：Unix 普通命令名使用最终 Runtime `PATH` 交给 OS 启动，
相对 application 先锚定到最终 working directory；Windows 以最终 working directory/PATH 为基准按封闭候选解析。
找不到入口或 spawn 失败时返回稳定 Managed Process error，由拥有语义的调用方决定结果；恢复或新 AgentRun 必须重新
derive，不能复用上一轮解析后的设备路径。

native entrypoint 的 `lpApplicationName` 必须是已打开并验证身份的绝对 Runtime executable path；command shim
的 `lpApplicationName` 必须是上述已验证 System32 `cmd.exe`，shim 同时保持打开并在 CreateProcess 前复核。
mutable command line 由 entrypoint-specific argv serializer 生成；serializer 必须匹配 native Runtime 或 Windows
batch 的参数解析器，不能宣称存在适用于所有程序的通用 quoting。每个已准入 policy 至少测试空参数、空格、
Unicode、长参数、cmd metacharacter 注入和脚本路径含空格，并验证字面引号、`%` 与尾部反斜杠在启动前被拒绝。

compatibility identity 至少包含 entrypoint kind、canonical entrypoint path、reported version 与 executable
fingerprint。native 使用 executable 内容 fingerprint；`windows_command_shim` 使用 domain-separated composite
fingerprint，覆盖 canonical shim path、shim content digest、extension、canonical interpreter path 与 interpreter
fingerprint。已验证 Codex locator 解析成功后，Installation 与正式 launch identity 仍绑定 native target；Core 另外持久化
不公开的 locator identity，覆盖 canonical shim path/content digest、canonical interpreter path/fingerprint 以及 resolved
target path/fingerprint。该 identity 的 domain-separated digest 进入 Session/Host compatibility；即使 `codex.exe` 未变，
shim locator 改写也必须递增 Installation generation、撤销旧 Ready snapshot 并重新 Deep Probe。公开诊断只投影类型与
是否解析成功，不投影用户 Home 下的 locator path。

## 4. Ownership and termination

所有 Probe、Codex/ACP Host、Claude/Antigravity one-shot、Fleet 新进程和后续 Adapter 都必须使用此接口。
Job handle 非 inheritable，并由 Core generation 独占。planned shutdown 先执行既有 graceful protocol；deadline
后关闭/终止 Job 并有界等待 reap。Core crash/force-kill 导致最后 Job handle 关闭时，OS 收口受管后代。

Windows Managed Process 为每次启动创建带随机身份的 `Global\Rovai.Runtime.<UUID>` Job，创建时使用
受保护的当前用户/SYSTEM DACL，拒绝复用已有名字；不设置 breakaway。全局 namespace 使 launch 身份不依赖 Windows
登录 Session；名称不承担退出证明。控制 handle 仍由启动代际拥有、不可继承。
Job 活跃数归零、名称消失、根进程退出均不能单独证明后代已完成异步终止及在途 I/O 取消。
当前 owner 在空 Job 上、启动任何进程前关联私有 IOCP；既有 `tree_is_empty()` 在有界清理期间读取成员通知，
保留不可继承的进程 handle，并确认这些 handle 已 signaled，或通知对应的进程对象已不存在。
去重成员数必须严格等于最后读取的 Job 生命周期 `TotalProcesses`，且 `ActiveProcesses` 为零，才提交回收凭据。
最终计数在所有观察成员退出后读取，防止先前快照遗漏清理期间新建的后代；重复通知不能抵消缺失成员。
每轮通知读取及成员退出核验分别有数量上限，不占用全局调度锁，也不新增后台轮询。通知丢失、Job 内 PID 复用导致少计、
计数异常或无法查询退出时保持未确认；不以等待次数或固定延时补齐证据。

Fleet 只保存内部 Job 身份用于归属定位；跨 Core 无法继承完整成员与退出证明，只接受已有持久化、精确 Run/epoch
的已回收凭据。没有凭据的 scoped 记录，即使 Job 可查询且活跃数为零，也继续阻塞相关后继输入。
恢复不按记录中的 PID 终止进程，不通过轮换 Native Session 或重新登录解除门禁。
本期不增加跨 Core 的 Job handle 保活服务。Codex 当前代际的 bounded reap 使用上述证明，再提交既有回收凭据。

Unix 直接启动目标进程并保留 process group、stdio、环境快照与退出回收语义；Windows 保留原子 Job、
handle list 与受控 entrypoint。所有 Runtime/Probe/derived child 都不经过 Rovai 的 `sandbox-exec` 包装。
Runtime 可以自行创建原生沙箱，其可用性由 Runtime 配置和实际宿主环境决定。

ACP Host 同时观察受管 leader 的退出和协议管道结束。leader 退出后先终止持有管道的后代，给 reader
有界时间消费已到达的权威结果，再精确一次通知 owner；不能仅等待 stdout EOF，也不能丢弃退出前的完成帧。

<a id="macos-acp-descendants"></a>
### macOS ACP 后代与重启回收

macOS ACP 在 Managed Process 内记录同 UID 后代的 kernel unique identity、parent unique identity 和 PID version。
Native shell 可创建独立进程组，回收不能只依赖 `killpg`。Darwin audit-token signal 在内核校验 PID version，
不能退化为按名称、路径或裸 PID 扫描补杀。跨 `exec` 仅刷新同一 unique identity 的版本。

每个 Host 在现有 Runtime 私有目录保存 mode 0600 的原子 ownership ledger，父目录 mode 0700；记录
boot session、Core owner 和已观测祖先，不保存 argv、Prompt、凭据或工具输出。运行时采集与显式清理复用
同一 ledger。确认整棵已捕获树不再运行才移除记录；读写、身份或信号失败保留未确认状态。
Core 在开放 readiness 前处理前代 ledger；仅同次系统启动且原 owner 已消失时回收，失败则关闭启动准入。
旧 boot 的记录只清除文件，不向可能复用 PID 的新进程发信号。

这是既有 Unix 回收的补强，不是 Windows Job/cgroup：未观测且已消失的中间祖先、跨 UID 后代、Core 停止后
直到再次启动前的空窗不受此记录保证。macOS 使用 XNU libproc 的固定结构与 PID-version signal 接口，
字段大小/能力不符即失败；平台与目标版本仍必须分别验收。选择理由见 [V1.72-D21](../versions/v1.72/decisions.md#v1-72-d21)。

Linux ACP Host 在原生 cancel、graceful stop 或强制回收之前，先由 Managed Process 捕获同 UID 后代的
父子关系与启动身份，并持有 pidfd。原生取消使父进程退出或后代重新挂靠后，仍通过已捕获的 pidfd 终止后代；
不得按进程名或裸 PID 补杀。根进程退出不能替代已捕获后代退出的确认，查询失败保持回收未确认。
Linux ZCode 的显式 Host 回收也采用 pidfd 退出确认，包含捕获到的 watcher；无保留后台任务的取消会关闭
该 Host，避免原生 stop 回执先于工具子进程退出。存在后台任务时仍保留既有 Session 作用域取消，不能为取消
一个前台 Run 杀死较早任务。ZCode 的 spawn ledger/EOF watcher 继续处理原生 Host 意外关闭，非 Linux
Unix 显式回收仍等待其组退出报告；不能把两种确认方式混用。
这不是 cgroup/Windows Job 等价的强隔离：捕获前已脱离祖先链的未知进程、跨 UID 后代以及 Core 被强杀后的
自动回收不由 Linux pidfd 捕获承诺。正式 Server 的 systemd unit 另外使用 control-group 终止策略。

User Automation 的 `rovai app` 防误调用由 CLI 入口拥有，见 [User Automation v5](user-automation-v5.md)。
该检查不形成同 UID 恶意进程隔离，不是 Managed Process 的启动前置条件。

稳定错误：

```text
managed_process.invalid_application
managed_process.invalid_argument
managed_process.handle_policy_failed
managed_process.job_create_failed
managed_process.atomic_assignment_failed
managed_process.spawn_failed
managed_process.reap_timeout
```

## 5. Desktop parent-liveness acceptance

Electron Main 启动 Core 的 stdin/stdout RPC 保持独立于 Runtime Job。Runtime children 不得继承 Electron↔Core
pipe handle。Main 被强制终止后，Core 必须在 deadline 内通过 stdin EOF 或显式 parent-process handle watcher
进入关闭并释放 Runtime Jobs；若 EOF acceptance 不稳定，parent watcher 从评估项升级为强制实现。

## 6. Required evidence

- 被启动程序第一条用户指令立即创建孙进程；父进程可立即退出或持续运行；
- Core 正常关闭、Core 强杀、Electron Main 强杀均在 deadline 内清除孙进程；
- 重复压力测试无偶发逃逸，并覆盖外层 CI Job；
- 子进程只继承声明的 stdio，不继承 Job、token 或无关文件 handle；
- `.cmd/.bat` 的内容或 interpreter identity 变化使旧 capture 失效，timeout/cancel 清理完整 shim child tree；
- Windows rescan 的 inherited/HKCU/HKLM/known PATH 快照同时进入 discovery、Probe 与正式 AgentRun；
- 普通 capture 拒绝 bare command 与 cwd-relative application；
- ACP derived child 的 bare/relative command 使用请求最终覆盖后的 PATH/cwd；Windows `.cmd/.bat` 保持
  `CommandShim` identity，不退化为 EXE-only 派生入口；
- macOS process-group 启动、终止和 Fleet 回归保持；
- macOS Core 启动后的受管 Probe 可以创建 Runtime 自身的原生沙箱；`rovai app` 防误调用由独立 CLI 测试拥有。

## References

- [ADR-0211](../versions/v1.05/decisions.md#adr-0211)
- [V1.28-D11](../versions/v1.28/decisions.md#v1-28-d11)
- [V1.39-D08](../versions/v1.39/decisions.md#v1-39-d08)
- [V1.39-D09](../versions/v1.39/decisions.md#v1-39-d09)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [Planned Shutdown](../architecture/planned-shutdown.md)
- [Windows Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)
- [Windows Kernel Object Namespaces](https://learn.microsoft.com/en-us/windows/win32/termserv/kernel-object-namespaces)
- [Windows Job Completion Notifications](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_associate_completion_port)
- [Windows Object Lifecycle](https://learn.microsoft.com/en-us/windows-hardware/drivers/kernel/life-cycle-of-an-object)
- [TerminateProcess](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-terminateprocess)
