---
document_type: contract
contract: managed-runtime-process-v1
status: accepted
source_version: v1.05
last_updated: 2026-08-25
---

# Managed Runtime Process v1

本合同拥有 Core-managed Runtime/Probe 进程的跨平台启动接口与 Windows 原子 Job 语义。决策理由见
[ADR-0211](../versions/v1.05/decisions.md#adr-0211)。Runtime terminal 与领域终态仍由既有 AgentRun、
Fleet 与 Planned Shutdown 合同拥有；进程退出不是 Provider outcome。macOS User Automation credential 隔离的
修正理由见[V1.21-D03](../versions/v1.21/decisions.md#v1-21-d03)。Windows command shim 扩展见
[V1.28-D11](../versions/v1.28/decisions.md#v1-28-d11)。

## 1. Module interface

调用方只提交不可变 `ManagedProcessLaunchSpec`：

```text
purpose
absolute application path
argv[]
working directory
explicit environment snapshot
stdin/stdout/stderr policy
runtime compatibility / execution ownership identity
```

接口返回 `ManagedProcess`，其可观察能力限于 stdio、PID/OS identity、wait、graceful request、bounded tree
termination 与 reap result。调用方不接触 Job/process-group handle，也不自行 attach、break away 或枚举后代。

Core 初始化时可以向 Managed Process 配置实例级 protected local trees。该配置在任意 Runtime spec capture 前
冻结，路径必须是规范化绝对路径，且不会作为普通 Runtime environment 字段暴露。所有 purpose 和 Adapter 共享
同一保护集，调用方不能选择性关闭。

Windows launch policy 只允许以下封闭 entrypoint：

- 经 Runtime Platform Admission 的 native `.exe`；
- 已知 npm/pnpm Codex `.cmd` locator，经验证后解析到 platform package 内真实 native `codex.exe`；
- bounded regular `.cmd` / `.bat` `CommandShim`，以明确的 `windows_command_shim` identity 启动。

`.com`、`.ps1`、PowerShell fallback、PATHEXT 全量扩展和调用方自行拼装的通用 Shell command 不属于 v1。
用户 prompt 仍只能经 stdin 投递；command shim argv 只承载 Adapter 声明的控制参数。

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

macOS 上每个 Core-managed Runtime/Probe 进程树必须继承对当前实例 `automation-v1` protected tree 的 OS 级
`file-read*` 与 `file-write*` deny，同时保持其他正常工作区、Runtime binary 与用户文件按既有 permission policy
可见。该保护覆盖 Runtime 自身、shell/CLI 和所有后代；不能依赖 `0600`、PATH、环境变量或应用层命令检查。
系统 sandbox facility 不存在、profile 无法构造或路径无法规范化时，Runtime spawn 必须在用户输入投递前 fail
closed，不能无 sandbox 降级启动。普通非 Runtime 用户终端不经过该 deny。

稳定错误：

```text
managed_process.invalid_application
managed_process.invalid_argument
managed_process.handle_policy_failed
managed_process.job_create_failed
managed_process.atomic_assignment_failed
managed_process.invalid_user_automation_denial_root
managed_process.runtime_sandbox_unavailable
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
- macOS process-group 启动、终止和 Fleet 回归保持；
- macOS 受管 shell 及其后代不能读取或写入 `automation-v1` credential/context，但仍能读取保护树外的 fixture。

## References

- [ADR-0211](../versions/v1.05/decisions.md#adr-0211)
- [V1.28-D11](../versions/v1.28/decisions.md#v1-28-d11)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [Planned Shutdown](../architecture/planned-shutdown.md)
