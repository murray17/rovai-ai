---
document_type: contract
contract: managed-runtime-process-v1
status: accepted
source_version: v1.05
last_updated: 2026-08-21
---

# Managed Runtime Process v1

本合同拥有 Core-managed Runtime/Probe 进程的跨平台启动接口与 Windows 原子 Job 语义。决策理由见
[ADR-0211](../versions/v1.05/decisions.md#adr-0211)。Runtime terminal 与领域终态仍由既有 AgentRun、
Fleet 与 Planned Shutdown 合同拥有；进程退出不是 Provider outcome。macOS User Automation credential 隔离的
修正理由见[V1.21-D03](../versions/v1.21/decisions.md#v1-21-d03)。

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

Windows 第一版的 launch policy 只允许：

- 经 Runtime Platform Admission 的 native `.exe`；
- Adapter 明确声明的 `ValidatedNodeShim`，验证受支持 shim 形状后解析到绝对 `node.exe + entry script` 并直接启动。

任意 `.com`、`.cmd`、`.bat`、`.ps1` 和通用 `cmd.exe /s /c` 不属于 v1。无法解析的 shim 保持 Runtime
`not_qualified`。用户 prompt 只能经 stdin 投递。

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

`lpApplicationName` 必须是已打开并验证身份的绝对 native executable path。mutable command line 由 argv
serializer 生成；serializer 必须匹配目标 Runtime 的 Windows 参数解析器，不能宣称存在适用于所有程序的通用
quoting。每个已准入 policy 至少测试空参数、空格、引号、尾部反斜杠、Unicode 和长参数。

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
- macOS process-group 启动、终止和 Fleet 回归保持；
- macOS 受管 shell 及其后代不能读取或写入 `automation-v1` credential/context，但仍能读取保护树外的 fixture。

## References

- [ADR-0211](../versions/v1.05/decisions.md#adr-0211)
- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [Planned Shutdown](../architecture/planned-shutdown.md)
