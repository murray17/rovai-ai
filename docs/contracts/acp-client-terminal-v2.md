---
document_type: contract
name: ACP Client Terminal
version: v2
status: accepted
source_version: v1.29
last_updated: 2026-09-04
---

# ACP Client Terminal v2

v2 replaces [v1](acp-client-terminal-v1.md). v1 的 Runtime capability policy、ACP wire、有界输出、进程树所有权
和 Terminal 生命周期保持不变。本版收敛 `terminal/create.cwd` 与派生命令解析上下文：execution root 是缺省工作目录，
不再是 Core 强制的 Shell 权限边界；application 必须在请求最终 cwd/env 生效后解析。

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

未知、格式错误或生命周期不合法的 Terminal request 返回 JSON-RPC error。错误和命令输出均为 ACP Host 与
Runtime 之间的私有协议数据，不投影为 Camp message、Host diagnostic、公开 command output 或 durable Evidence。

## Create admission and cwd ownership

`terminal/create` 仅在 `sessionId` 属于当前 `AgentRun owner + execution_epoch` 且 Session 处于 Active Prompt 时
准入。Host 最多同时拥有 16 个 Terminal。

`command` 必须是单个结构化 application，不接受 Shell command string；允许绝对路径、bare command 与带目录的
相对路径。Core 先确定最终 cwd，在 Host 冻结环境上应用本请求 `env`，随后才解析 application：Unix bare command
保持原值并由 launch 使用最终 `PATH`，相对路径以最终 cwd 锚定；Windows bare/relative command 在最终
PATH/cwd 中按 `.exe → .cmd → .bat` 解析，并进入 Managed Process 的完整 native/CommandShim identity 链。
`cwd` 的解释固定为：

- 省略或传 `null` 时使用当前 AgentRun 的 execution root；
- 显式值必须是 string、绝对路径并且在创建时是已存在的目录；相对路径和不存在/非目录路径拒绝；
- Core 不对显式 cwd 调用 `scoped_path()`，不做 execution-root containment，也不因 `..`、symlink 或目录位于
  execution root 外而拒绝；
- Core 把合格 cwd 交给受管子进程，最终 Shell/文件访问资格由冻结的 Runtime sandbox/permission mode、继承的
  平台启动策略与操作系统决定。

execution root 在这里仅是默认工作目录；在 ACP Client FS 中还是相对路径解析基准。它不形成 ACP FS 或 Client
Terminal 的通用 sandbox。`args` 与 `env` 仍只接受标准数组 shape，并拒绝 NUL、非法环境名和无界数量。

## Process ownership

实际进程由本地 Core Host 通过 Managed Runtime Process 派生的 `RuntimeOneShot` 启动：

- 继承 Runtime Host 捕获后的精确环境，包括 provider、Built-in CLI、PATH 与平台保护配置，再应用 request env；
- application 只在上述最终环境与 cwd 已形成后处理，调用方不得提前使用 Host 模板上下文解析；
- 使用按上节解析的 cwd、null stdin、独立 Unix process group 或 Windows Job；
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
- execution root 外的已存在绝对 cwd 可以 create 并作为实际子进程 cwd；
- 相对 cwd 和不存在/非目录的绝对 cwd 拒绝；省略 cwd 时实际子进程仍使用 execution root；
- bare command 使用 request env 覆盖后的最终 PATH；relative command 使用 request 的最终 cwd；Windows
  `.cmd/.bat` 继续使用受控 CommandShim；
- create → output → wait → release 继续覆盖 Host env、request env、stdout/stderr 和非零 exit；
- kill、重复 kill、重复 release、Run cancellation 与 Host cleanup 不遗留进程；
- 输出窗口有界并报告 truncation；Terminal wire/output/error 不进入 Camp incoming route；
- session/load、session/resume、History Restore、Prompt ACK、ACP Client FS、permission response 和现有
  `terminal=false` Runtime 行为保持原合同。

当前 macOS arm64 产品证据还包含 Kimi Code 0.38.0 的隔离开发 App/Camp AgentRun：App Deep Probe 为
authenticated/ready，两次 Bash 分别返回 execution root cwd 与 `ROVAI_KIMI_038_TERMINAL_OK`，Run 成功，
终态后没有遗留 Kimi/Terminal 子进程。该历史证据证明默认 cwd 与生命周期，不外推为 execution-root containment
或其他平台的独立资格运行。

## References

- [ACP Client Terminal v1](acp-client-terminal-v1.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [Managed Runtime Process v1](managed-runtime-process-v1.md)
- [Runtime Launch and Verification v28](runtime-launch-and-verification-v28.md)
- [V1.29-D10](../versions/v1.29/decisions.md#v1-29-d10)
- [V1.39-D08](../versions/v1.39/decisions.md#v1-39-d08)
