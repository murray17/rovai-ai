---
document_type: research-evidence
status: observed_windows_x64
observed_at: 2026-10-09
---

# Windows DSH 取消与 Job 回收验收

修复同时覆盖取消时的 Host 回收和工具启动时的 Job 归属。下面保留修复前及仅修 Core 时的失败
证据，并分别记录最终默认入口与显式非 Store PowerShell 的验收。本文只记录本机 Windows x64、
DSH 0.2.0-rc.2 的证据，不改变其他平台准入或会话规则；未测环境不视为通过。

## 基线与实际缺口

- 修改前构建基线：`7429216d`（后来由 PR #677 合入主线）；当前分支基线：
  `e1d6f3e9641187baca04ec5b5f0d24a641950cbf`。
- 运行环境：Windows x64、Core 0.4.6、DSH 0.2.0-rc.2、Store PowerShell 7.6.6。
- 基线诊断 Core SHA-256：`94b894f9d009823b9c7311cf51f9a4060762bbe6ce9d6fa936a82ea9e4af17b3`。
  该构建只补诊断链，没有行为修复；诊断补丁与原始报告保留在本次 Thread 附件。
- 受控模型使用本机 Responses fixture；真实模型试次使用既有 Sub2API 路由上的 `gpt-6`。
  两类试次均运行真实 DSH、PowerShell、Node 写入进程和 64 个短命子进程。

修改前的三个失败取消试次中，取消 RPC 为 14、15、24 ms，cleanup ACK 为 42、43、59 ms；
旧命令仍写入约 24.7–24.9 秒并生成自然完成标记。后继都成功，因此仅检查队列或 Run 终态会误判。
补诊断后的独立基线重复得到 RPC 30 ms、ACK 65 ms、取消后继续写入 24,854 ms。

该基线在同一个 Run/epoch、Host、具名 Job 上记录到真实 `TerminateJobObject` 成功和
`ActiveProcesses == 0`，但取消前写入进程的 `IsProcessInJob` 已是 false。
受控祖先链为：Core → cmd shim → DSH Node → 原生 runner Node → Store PowerShell → 写入 Node。
cmd、DSH、runner 属于目标 Job，PowerShell 和写入 Node 不属于。没有发现回收错误 Job 的证据。

这同时确认两种独立问题：普通 Windows ACP 曾直接返回清理成功，且实际工具的启动归属存在缺口。
替换成功返回值只能修复前者。用 Store 完整路径、改变测试 Core 的启动父进程、父进程桌面策略
的对照均未恢复归属；独立 Win32 探针创建时强制附加父 Job 返回错误 5。OS 内部机制仍未完全定位。
非 Store PowerShell 7 的隔离对照通过，之后内置 Windows PowerShell 5.1 对照也通过。
最终修复使用 DSH 本身已支持的普通 PowerShell / Windows PowerShell 入口，没有新增运行时下载依赖。

此前 7 对、14 个 Run 的正常/取消后继试次没有复现正常完成后的长期排队；这不证明用户报告的
“全部 DSH 模型一直排队”已经解决。本次不扩大修改正常完成、配置摘要、提示词、权限或恢复规则。

## 修复

- 取消事务与 Fleet 的短 admission gate 同步设置目标 Run/epoch 的淘汰意图；立即返回前端，
  进程收尾交给已有 worker。正常完成回调不能重新标记该 Host 为可复用。
- 对正常释放与终态写入之间的竞争，保留每个空闲 Host 的最近一次 lease；只用于精确匹配取消，
  不追溯已被后继占用的 Host，也不是进程历史追踪系统。
- Windows ACP 实际回收调用通用 Job 判定。终止与查询共用调用方的 5 秒截止时间，10 ms 轮询；
  查询到零立即完成，查询失败不当作零，失败保留 owner 和 Job handle 以供局部重试。
- 私有临时配置目录的删除放到独立 best-effort 工作中，不延长已经满足 Job 条件的放行。
- 沿用现有 cleanup worker 成功通知、Delivery 唤醒和超过 5 秒的“清理未确认，正在重试”提示。
- 有限诊断日志只在 `extended-tests` 构建且设置专用环境变量时开启。进程归属查询仅存在于隔离
  smoke；生产清理不枚举成员、不等待后代句柄、不核验历史通知或累计计数。
- Windows DSH 在 ACP ready 前通过原生 Cordis config/noSave seam 确定 PowerShell 入口。
  自动选择保留普通 PowerShell 7、PATH、Windows PowerShell 的顺序，跳过 Store 激活入口；显式
  普通路径保留，显式 Store 路径报 `rovai_dsh_store_powershell_not_job_managed`，不执行失管工具。
  原始 profile 保持不变；Bootstrap revision 只用于沿用已有机制淘汰旧 Host。
  本机只有 Store PowerShell 7，因此默认选中内置 5.1。7 专有语法仍需非 Store PowerShell 7，
  没有把 5.1 宣称为 7 的完整语法替代品。

## 复现命令与判据

```powershell
cargo build -p rovai-core --features extended-tests --bin rovai-core --bin rovai
$env:ROVAI_REPRO_CORE_EXE = (Resolve-Path target/debug/rovai-core.exe).Path
$env:ROVAI_REPRO_CASES = 'normal,normal,cancel-stop-only,cancel,cancel'
node scripts/smoke-dsh-windows-cancel.mjs <absolute-report-path.json>
```

真实模型在相同命令前设置 `ROVAI_REPRO_REMOTE=1` 和 `ROVAI_REPRO_MODEL=gpt-6`；凭证通过既有
环境变量读取，报告不记录密钥。脚本从本机 DSH 安装读取已有 provider 路由，仅写隔离 profile。
`ROVAI_REPRO_PWSH` 可指定隔离对照的 PowerShell 路径，报告明确记录该覆盖，不可冒充默认环境。

脚本逐次创建独立 Thread；Core、SQLite、DSH Home、MCP 配置、Skill Library、工作区和产物均在
独立临时根。验证停止 RPC、目标 Job 终止/归零、cleanup ACK、最后一次旧写入和后继启动时间。
Stop-only 没有后继；带后继的取消必须旧写入停止且新 Host 自动执行。正常完成必须复用相同 Host。
观察持续到旧命令本应自然完成之后；任何新的写入或自然完成标记都会导致非零退出。
`cancel-query-fault` / `cancel-terminate-fault` 仅在诊断构建向精确 Job 注入错误，保持 6.2 秒后解除；
检查首次 5 秒预算到期明确报错、至少两次局部回收尝试、ACK 未提交及后继仍 waiting，再检查自动恢复。
`cancel-parallel` 同时运行另一成员、另一 Host 的自然完成写入；`cancel-race` 在工具自然完成后，
同一事件循环发送取消 RPC 并放行最终模型响应，检查已提交的取消不能被完成覆盖。该竞争试次允许
工具在取消前生成自然完成标记，不能代替 Stop-only 的停写验证。

## 回归与未覆盖项

优先扩展既有 Rust owner：

- `managed_process::tests::windows_job_contains_an_immediate_grandchild_after_leader_exit`：真实 Windows
  Job、根进程已退出、后代迟到创建；以受限 Job handle 分别复现终止拒绝和查询拒绝，恢复原 handle
  后局部重试成功。无 completion port，历史累计数非零不阻碍活跃数归零。
- `runtime_fleet::tests::failure_retirement_cannot_be_reversed_by_late_success_or_touch_a_successor`：
  扩展 Windows DSH，覆盖停止意图优先、空闲释放窗口、错误 epoch、并行 Host 不受影响、正常复用。
- 已有 Fleet cleanup owner 继续覆盖未确认时保留 lease、局部重试及后继准入。
- 新增 `acp::windows_cleanup_tests::acp_callers_confirm_the_owned_windows_job_before_releasing`：
  既有 ACP 进程 owner 为 Unix-only，不能验证本次 Windows 调用 seam。最低成本 fixture 使用真实
  Windows Job，无模型、数据库或网络；分别以 DSH、Kimi、Qwen、ZCode 身份验证确认返回前 Job 已空。
  修复前普通 ACP 的直接 true 分支会让该断言失败。故障/后代矩阵仍只由 ManagedProcess owner 负责。
  最小命令：`cargo test -p rovai-core --features extended-tests --lib acp::windows_cleanup_tests::`。
- Node 入口选择 owner 覆盖普通安装、PATH、内置后备、显式路径、Store 别名、指向 Store 的间接路径
  及没有可用入口；原有身份绑定和 readiness owner 保留。命令：`node --test scripts/lib/dsh-host.test.mjs`。

本机命令结果：`cargo test --workspace` 通过；`cargo test -p rovai-core --features extended-tests --lib`
分别过滤 `managed_process::`（17 passed / 7 subprocess helpers ignored）、`runtime_fleet::tests::`
（23 passed）、`acp::`（9 passed）均通过。ACP 的 Unix 进程 fixture 没有在 Windows 运行；9 项是
路由和路径回归。新增 Windows ACP seam owner 通过（1 test，4 种 Adapter 身份），DSH Rust 5 项、
Node 3 项通过；不把该 seam fixture 宣称为其他 Adapter 的真实模型验收。

## 中间构建：仅修 Core 的失败与 Portable 对照

Core 二进制 SHA-256：`585bff465b60e96b3be29b0dd47263549ac0a122e425a5dcf31e63a7408bfb51`。
完整 Run/epoch → Host → Job 关联、终止调用、归零、ACK、最后写入及后继启动 UTC 时间，见
[脱敏证据](windows-cancel-2026-10-09.json)。日志时间是测试端接收时间，毫秒数是本次观察值。

| PowerShell / 模型 | 场景 | 停止响应 ms | cleanup ACK ms | 旧写入 / 后继 | 验收 |
| --- | --- | ---: | ---: | --- | --- |
| Store / fixture | Stop-only | 34 | 46 | 继续 23,393 ms，产生自然完成标记 | 失败 |
| Store / fixture | waiting 后继，第 1 次 | 26 | 42 | 继续 23,421 ms，后继成功且与旧写入重叠 | 失败 |
| Store / fixture | waiting 后继，第 2 次 | 27 | 46 | 继续 24,044 ms，后继成功且与旧写入重叠 | 失败 |
| Store / gpt-6 | 真实模型工具 + waiting 后继 | 26 | 45 | 继续 24,181 ms，后继成功且与旧写入重叠 | 失败 |
| Portable / fixture | Stop-only | 26 | 40 | ACK 后无写入，无自然完成标记 | 隔离对照通过 |
| Portable / fixture | waiting 后继 | 26 | 43 | 旧工具属于 Job、停止，后继自动成功，无重叠 | 隔离对照通过 |
| Portable / gpt-6 | 真实模型工具 + waiting 后继 | 28 | 44 | 旧工具属于 Job、停止，后继自动成功，无重叠 | 隔离对照通过 |

正常完成连续接任务另测 Store 两轮、Portable 一轮，每轮两个 Run 均成功，且每轮复用相同 Host。
这些中间构建试次尚未接入最终 PowerShell 选择，不能代替最终验收；其 Core SHA 与原始报告均保留。

Portable 对照来自 [Microsoft PowerShell 7.6.6 官方 ZIP](https://github.com/PowerShell/PowerShell/releases/tag/v7.6.6)，
下载后核对官方 SHA-256 `02FE458BE20493FBDF43F61EA20610B811EE6C738AB1676C61B9CFCD1A33C860`，
只在隔离目录解压并覆盖该测试的 `pwshPath`。没有修改用户的 DSH Home、系统 PATH 或安装配置。
这一对照用于定位启动入口。最终产品不捆绑该 ZIP，也不修改用户的系统 PATH。

## 最终验收范围

最终构建 SHA-256：`0f579d9d3e5ac7fde2460618f6c1fd6b5cb186e036c179788e26d888c3442ae0`。
同目录 JSON 的 `finalBuildSources` 绑定构建时各源码文件 SHA-256；`finalReports` 保留最终三份
原始报告的 SHA-256。默认入口 7 项、真实模型 1 项、显式 Portable 2 项共 10 项均通过。

| 入口 / 模型 | 场景 | 停止响应 ms | cleanup ACK ms | 结果 |
| --- | --- | ---: | ---: | --- |
| 默认内置 5.1 / fixture | Stop-only | 33 | 48 | 旧写入停止，无自然完成标记 |
| 默认内置 5.1 / fixture | waiting 后继 | 21 | 37 | 旧 Job 归零，新 Host 自动执行，无重叠 |
| 默认内置 5.1 / fixture | 完成响应与停止竞争 | 24 | 43 | Run 保持 cancelled，目标 Host 退役 |
| 默认内置 5.1 / fixture | 查询故障、解除后重试 | 19 | 6,243 | 错误期间 ACK 未提交、后继 waiting；解除后自动完成 |
| 默认内置 5.1 / fixture | 终止故障、解除后重试 | 19 | 6,248 | 同上，确认至少两次局部回收尝试 |
| 默认内置 5.1 / fixture | 并行成员 / Host | 20 | 35 | 目标停止，另一 Host 继续写入并自然成功 |
| 默认内置 5.1 / gpt-6 | 真实模型工具 + waiting | 23 | 40 | 旧工具属于 Job、停止，后继自动完成，无重叠 |
| 显式 Portable 7.6.6 / fixture | waiting 后继 | 22 | 39 | 保留显式路径，旧工具停止，后继自动完成 |

故障试次主动保持故障 6.2 秒，表中的 ACK 因而包含故障解除时间，不是固定清理等待；第一次
回收仍在 5 秒预算到期后明确报错。默认与 Portable 各有一项正常完成连续任务，均复用同一 Host。
三份最终报告都验证原生 profile patch 的字节未变化。无故障取消的 ACK 为 35–48 ms，所有停止
RPC 为 19–33 ms。此前独立重复还覆盖默认入口两轮正常完成、两轮 waiting 取消和相同故障/竞争矩阵。

最终验收覆盖默认入口和显式 Portable 7.6.6；真实模型为既有 Sub2API 路由的 `gpt-6`。
所有运行使用独立 Core/DSH Home/Skill Library/MCP 配置/工作区。故障解除与后继恢复期间没有重启 Core。
精确构建 SHA、Run/epoch → Host → Job、终止/归零/ACK、最后写入和后继启动时间见同目录 JSON。
原始报告只保留于本次 Thread 附件，仓库 JSON 不含密钥或用户本地绝对路径。

未覆盖其他模型、MSI 版 PowerShell、Windows ARM64、其他 OS 或其他 ACP Adapter 的真实模型。
DSH 0.1.5-rc.2 所用 Cordis 1.0.3 的 config/noSave/await 接口已源码核对，但本轮没有将旧 DSH 版本
写成实机通过。正常完成长期排队仍未复现；用户“全部模型一直排队”的宽泛报告不因此被宣称全部修复。
