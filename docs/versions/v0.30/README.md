---
document_type: version-overview
version: v0.30
lifecycle: current
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-01
---

# Rovai-ai v0.30 Antigravity 受证明 Team Bridge

> 状态：架构已冻结；Core、Bridge、受管配置、UI 与真实 Antigravity 验收已完成
>
> 前置版本：[v0.29 队员工作台信息架构](../v0.29/README.md)
>
> 跨版本决策：[ADR-0088](../../adr/0088-attested-native-team-gateway-attachment.md)
>
> 实施设计：[architecture.md](architecture.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

## 版本意图

在不把 Run 凭据写入 Antigravity 全局配置、也不虚报严格 MCP 隔离的前提下，让由
Rovai 启动且仍处于有效 AgentRun 的 `agy` 进程可以通过原生 MCP 调用
`team.post_message`。同一份无凭据配置被普通 `agy` 读取时，Bridge 必须保持无工具、无
Team 权力和无领域写入。

这也是第一份可复用于“能启动原生 MCP、但不能逐 Run 完全替换 MCP 集合”的 Runtime
接入模板。复用条件以 OS 进程证明、配置所有权、窄权限和真实模型调用证据为准，不按
Runtime 名称开放。

## 已确认范围

- 把原有单一 MCP 能力拆成 `ExternalMcpProjection`、`TeamGatewayAttachment` 和
  `AmbientMcpIsolation` 三个独立轴，并冻结到 Capability/AgentRun 证据。
- Antigravity 的已实现能力组合为：
  `Unsupported + AttestedNativeBridge + PreservedUncontrolled`。
- 原生配置只增加一个无凭据 Server `rovai_team`；首阶段只暴露工具 `post_message`，
  内部映射到规范操作 `team.post_message`。
- 使用独立的 Rovai Antigravity Plugin；隔离 Spike 已验证该路径，因此没有启用用户级
  `~/.gemini/config/mcp_config.json` 合并 fallback。用户原生 MCP 保持原样。
- 通过私有 ownership record、文件/条目 digest、全文 CAS、进程间锁和原子替换管理 Plugin；
  窄权限写入另有 crash journal 与保留未知字段的全文 CAS。同名用户条目、未知归属或任何
  divergence 都失败关闭。
- 在现有 credentialed Team endpoint 之外新增、且不与其降级混用的每用户稳定 attested
  rendezvous、Run Claim、OS peer PID/父子进程/启动时间/可执行文件 identity 证明，以及
  connection-bound lease generation。
- 未绑定 Bridge 的 `tools/list` 为空，`tools/call` 返回 `run_not_bound`；已绑定 Bridge 的
  每次调用仍重新执行当前 Run、Binding、Epoch、Capability、目标与配额检查。
- Team Tool 权限优先使用用户另行同意的窄规则
  `mcp(rovai_team/post_message)`；Rovai 不自动打开
  `--dangerously-skip-permissions`，也不覆盖用户 deny/ask。
- Runtime 状态和诊断必须披露 ambient MCP 保留、外部 MCP Assignment 不支持、配置冲突、
  权限受阻和证明失败，不能只显示笼统的“支持 MCP”。

## 明确不在范围

- 不把 Antigravity ambient MCP 导入或同步为 Rovai MCP Library。
- 不向 Antigravity 投影队员分配的外部 MCP；存在 Assignment 时必须拒绝而非忽略。
- 不声明 Antigravity 的最终 MCP 集合被 Rovai 隔离、锁定或完整枚举。
- 不增加 `rovai-memory`、`rovai-a2a` 等多个全局 Server，也不在首阶段开放 Task、Memory、
  Context 或其他 Team Gateway 工具。
- 不自动修改用户工作区 `.agents/mcp_config.json`。
- 不实现通用外部 MCP Proxy，不让 Bridge 读取 SQLite 或持有领域状态。
- 不在本版本实现 Antigravity SDK Adapter。SDK 只有在独立证明与 `agy` 的账户、订阅模型、
  Session、取消、额度和打包能力等价后才重新评估。
- 不把一次本机 `agy 1.1.9` 验证变成固定版本白名单。

## 当前实现事实

当前代码已经：

- 将 MCP 能力拆成 external projection、Team attachment 和 ambient isolation 三个 typed 轴；
- 仅在受管 Plugin 与精确权限同时 Ready 时为 Antigravity 冻结发送侧 Team 能力；
- 保留全部 credentialed Adapter 的既有临时 endpoint/credential 语义，并为 Antigravity 新增
  无凭据、每用户稳定的 attested rendezvous；
- 通过 launch barrier、OS peer PID、直接父进程、启动时间、可执行文件 path/fingerprint、
  一次性 Run Claim 和逐调用领域授权建立本机证明；
- 只向已证明的 Bridge 暴露 `post_message`；普通终端 `agy` 看到空工具列表，直接调用返回
  `run_not_bound`；
- 在队员运行配置中显示 preserved ambient MCP、安全冲突与独立用户同意入口。

`agy 1.1.9` 实测不会在 Bridge 子进程崩溃后重启它，所以当前允许同一 Bridge 进程的 Core
连接重建，但 Bridge process crash 会使当前 Run 失败关闭；不通过较弱的新进程重领恢复。

## 设计状态

用户于 2026-08-01 确认采用受证明的原生 MCP Bridge，在文档先行后另行授权实施。生产代码、
合同、Renderer 状态、全量测试、macOS 打包、真实 Antigravity A→B→A 与普通终端负例均已
完成；可复现命令和数量见[实施与验收记录](implementation-plan.md)。
