---
document_type: contract
name: ACP Client Terminal
version: v1
status: accepted
source_version: v1.27
last_updated: 2026-08-24
---

# ACP Client Terminal v1

本合同定义 Rovai ACP Host 向 Runtime 提供标准 Client Terminal 时的 capability、wire、进程与生命周期边界。
它不改变 Runtime 自带 Shell，也不建立云端或 Kimi 私有 Shell transport。

## Runtime capability policy

每种 ACP Runtime 由 Adapter compatibility registry 返回以下 closed mode：

- `disabled`：`initialize.clientCapabilities.terminal = false`，Host 不建立 Client Terminal Bridge；
- `local_bridged`：`initialize.clientCapabilities.terminal = true`，且同一 Host 必须安装本合同完整 callbacks。

当前只有 `kimi-code-cli` 为 `local_bridged`。其他 ACP Runtime 全部保持 `disabled` 和原有 Runtime 内部 Shell
路径。不得用全局开关把所有 Runtime 改为 `terminal=true`，也不得在 Bridge 中加入 Kimi wire 分支。

## ACP wire

Bridge 只处理带 JSON-RPC `id` 的以下标准 Client request；所有 request 都必须携带当前绑定的 `sessionId`：

| Method | 必要参数 | 可选参数 | 成功结果 |
| --- | --- | --- | --- |
| `terminal/create` | `sessionId`, `command` | `args: string[]`, `env: {name,value}[]`, absolute `cwd`, `outputByteLimit` | `{terminalId}` |
| `terminal/output` | `sessionId`, `terminalId` | — | `{output, truncated, exitStatus?}` |
| `terminal/wait_for_exit` | `sessionId`, `terminalId` | — | `{exitCode, signal}` |
| `terminal/kill` | `sessionId`, `terminalId` | — | `{}` |
| `terminal/release` | `sessionId`, `terminalId` | — | `{}` |

`exitStatus` 与 wait 结果均使用 `{exitCode: uint | null, signal: string | null}`。Unix signal 使用名称；无法映射的
signal 使用稳定 `SIG<number>`。`terminal/output` 返回合并后的 stdout/stderr 保留窗口；流之间不承诺全局字节顺序。

未知、格式错误、越权或生命周期不合法的 Terminal request 返回 JSON-RPC error。错误和命令输出均为
ACP Host 与 Runtime 之间的私有协议数据，不投影为 Camp message、Host diagnostic、公开 command output 或
durable Evidence。

## Create admission and process ownership

`terminal/create` 仅在 `sessionId` 属于当前 `AgentRun owner + execution_epoch` 且 Session 处于 Active Prompt 时
准入。Host 最多同时拥有 16 个 Terminal。

`command` 必须是绝对可执行文件，或是能从该 Runtime Host 已冻结 `PATH` 解析的单个命令名；shell command string
和带目录的相对路径拒绝。`cwd` 缺省为当前 AgentRun workspace root；显式值必须是已存在的绝对目录，经过
canonical/symlink 解析后仍位于该 root 内。`args` 与 `env` 只接受标准数组 shape，并拒绝 NUL、非法环境名和
无界数量。

实际进程由本地 Core Host 通过 Managed Runtime Process 派生的 `RuntimeOneShot` 启动：

- 继承 Runtime Host 捕获后的精确环境，包括 provider、Built-in CLI、PATH 与平台保护配置，再应用 request env；
- 使用当前 workspace 内已验证 cwd、null stdin、独立 Unix process group 或 Windows Job；
- 继续继承 macOS User Automation protected-tree deny，不创建新的执行后端或云端路径；
- Terminal identity 同时绑定 Host、Session、AgentRun owner 与 execution epoch，不允许跨 Run 复用。

## Output and lifecycle

默认 output 保留窗口为 1 MiB，Host hard cap 为 8 MiB；超出时从最旧字节开始丢弃并永久返回
`truncated=true`。读取采用固定 chunk，不允许按进程总输出无限增长内存。`wait_for_exit` 等待进程终态以及已打开
stdout/stderr reader 收敛；`output` 在终态后包含 `exitStatus`。

`terminal/kill` 对已退出进程安全成功；`terminal/release` 删除 handle、终止仍运行的进程并等待回收，对已经
release 的同一 ID 幂等成功。Run cancellation、Runtime detach、Session replacement、Host EOF、Host shutdown
和 fleet reap 都必须回收其范围内遗留 Terminal；Host 只有在 Terminal map 为空时才可判定 quiescent 并进入
warm reuse。

## Acceptance

- Kimi 0.38 compatibility fixture 初始化必须观测 `terminal=true`；普通 ACP Runtime 必须观测 `false` 且没有 Bridge；
- create → output → wait → release 覆盖 cwd、Host env、request env、stdout/stderr 和非零 exit；
- kill、重复 kill、重复 release、Run cancellation 与 Host cleanup 不遗留进程；
- absolute workspace escape 与 symlink escape fail closed；
- 输出窗口有界并报告 truncation；Terminal wire/output/error 不进入 Camp incoming route；
- session/load、session/resume、History Restore、Prompt ACK 和现有 `terminal=false` Runtime 行为保持原合同。

当前 macOS arm64 产品证据还包含 Kimi Code 0.38.0 的隔离开发 App/Camp AgentRun：App Deep Probe 为
authenticated/ready，两次 Bash 分别返回 canonical workspace cwd 与 `ROVAI_KIMI_038_TERMINAL_OK`，Run 成功，
终态后没有遗留 Kimi/Terminal 子进程。该证据不外推为其他平台的独立资格运行。

## References

- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Managed Runtime Process v1](managed-runtime-process-v1.md)
- [Runtime Launch and Verification v26](runtime-launch-and-verification-v26.md)
- [V1.27-D12](../versions/v1.27/decisions.md#v1-27-d12)
