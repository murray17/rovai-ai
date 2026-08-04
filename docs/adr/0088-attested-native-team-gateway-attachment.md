---
document_type: adr
id: ADR-0088
title: "Attested Native Team Gateway Attachment"
status: accepted
date: 2026-08-01
decision_scope: cross-version
source_version: v0.30
supersedes: []
superseded_by: null
---

# ADR-0088: Attested Native Team Gateway Attachment

> 后续局部规范：[ADR-0104](0104-rovai-preferred-mcp-projection-and-external-degradation.md)
> 将“存在已分配外部 MCP 且 Adapter Unsupported 时拒绝发送”改为外部 MCP 空投影并允许
> 基础 AgentRun 继续；本文的 Team Gateway 进程证明、权限、fencing 与正交能力轴继续有效。

## Context

部分 Product Runtime 能启动原生 MCP Server，却不能在一次 AgentRun 中严格替换或锁定
最终 MCP 集合。Antigravity 的 `agy` companion 属于当前已知案例：它可以从原生配置加载
MCP，但没有经验证的逐 Run strict/override 入口；用户级、工作区和 Plugin 配置还可能共同
影响最终工具集合。

因此，“能够启动 Rovai MCP”与“Rovai 精确控制全部 MCP”不是同一能力。若继续用一个
`mcp.exact_per_run` 布尔值同时代表外部 MCP 投影、内部 Team Gateway 挂接和 ambient MCP
隔离，就只能在两种错误之间选择：拒绝一个本可安全提供窄 Team Tool 的 Runtime，或把原生
ambient MCP 错报成 Rovai 已隔离的逐 Run 集合。

把 Native Binding 凭据写进全局 MCP 配置、命令参数或环境变量也不可接受。全局配置会被
普通用户启动的 Runtime 复用，持久凭据还会跨 Run、跨进程和跨配置备份扩散。另一方面，
只检查父 PID 不能防止 PID 重用、错误二进制、旧 Run 或重复领取。

本决策为这类 Runtime 定义一个窄的、由 OS 进程身份证明的内部 Team Gateway 挂接方式。
它不建立通用 MCP Proxy，也不降低用户管理的外部 MCP 的精确投影要求。

本决策局部替代 ADR-0014 中“所有 Connector 都必须携带 Native Binding 凭据”以及
Antigravity Team Tool 保持 Unsupported 的条款；局部替代 ADR-0018 中“内部 Team MCP 必须
与外部 MCP 进入同一份精确逐 Run 投影”的条款；并落实 ADR-0065 已预留的“注入 Rovai MCP
但保留原生 MCP”准入路径。上述 ADR 的 Gateway、领域授权、外部 MCP 真源、冻结、恢复和
审计边界继续有效。

## Decision

### 三个能力轴独立冻结

Adapter 的 Capability Snapshot 和 AgentRun 冻结结果必须分别表达以下能力，不能再用
一个“支持 MCP”或 `mcp.exact_per_run` 值推导其余两项：

| 能力轴 | 值 | 规范含义 |
|---|---|---|
| `ExternalMcpProjection` | `ExactPerRun` / `Unsupported` | 是否能把该队员当前分配的外部 MCP 精确冻结并投影到本 Run |
| `TeamGatewayAttachment` | `InjectedCredential` / `AttestedNativeBridge` / `Unsupported` | 内部 Team Gateway 如何附着到 Runtime |
| `AmbientMcpIsolation` | `Exact` / `PreservedUncontrolled` | Rovai 是否能保证最终集合不含用户、工作区、Plugin 或其他原生 MCP |

`AttestedNativeBridge` 只改变内部 Team Gateway 的连接身份，不把
`ExternalMcpProjection::Unsupported` 提升为 `ExactPerRun`，也不把
`AmbientMcpIsolation::PreservedUncontrolled` 提升为 `Exact`。

当一个 Run 存在已启用、已分配的外部 MCP，而其 Runtime 的
`ExternalMcpProjection` 为 `Unsupported` 时，发送准入必须给出可操作的结构化拒绝；不得
静默忽略 Assignment，也不得拿碰巧存在的 ambient MCP 冒充 Rovai 投影。没有外部 MCP
Assignment 的 Run 可以在明确披露 `PreservedUncontrolled` 后继续执行。

### 只挂接一个无凭据的内部 Bridge

受证明路径只管理一个原生 MCP Server：

```text
server id       = rovai_team
runtime tool    = post_message
permission      = mcp(rovai_team/post_message)
Core operation  = team.post_message
```

原生配置只包含受信 Bridge 可执行文件的绝对路径和不含秘密的固定参数。不得包含 Native
Binding、AgentRun、Execution Epoch、Session token、Socket capability 或其他 bearer
credential；这些值也不得通过 `argv`、环境变量、工作区文件或模型上下文传递。

受证明 Bridge 必须使用与现有 credentialed Connector 明确区分的打包 entrypoint 和
handshake。它不能根据“环境里刚好没有 credential”自动从旧模式降级到 attestation，也不能
在受证明入口接受旧 Binding secret；模式混淆必须在协议解析前失败。

首个实现阶段只暴露 `post_message`。Bridge 在协议边界把它映射到 Core 的规范操作
`team.post_message`；不得把点号工具名交给 Antigravity，也不得顺带暴露 Task、Memory、
Context 或其他 Team Gateway 工具。以后增加工具必须分别验证工具发现、Schema、权限规则和
真实模型调用，不能因为共用 Gateway 自动开放。

Alias 只存在于 Runtime MCP/permission 边界。Core command identity、幂等 digest、Capability、
审计和 completion receipt 都继续使用规范操作 `team.post_message`；不能让模型传入 canonical
name 或伪造 alias 映射。当前 attested lease generation 只用于连接 fencing 和授权，不替换
稳定的 Runtime tool-call identity，也不能让一次合法 reconnect 后的重放产生重复命令。

Team Gateway 始终是 ADR-0014 定义的 Core-owned 授权和事务边界。Bridge 仍然只是 MCP
stdio 与本机 IPC 的无状态翻译器，不读取 SQLite、不自行决定 Capability，也不成为消息队列。

### 原生配置采用保留 ambient 的受管合并

Rovai 不声明这类 Runtime 的严格 MCP 隔离。其有效集合只能描述为：

```text
Runtime effective MCP
= ambient native MCP preserved outside Rovai control
+ one Rovai-managed credentialless rovai_team bridge
```

优先使用 Runtime 官方支持的独立全局 Plugin/Extension，把 `rovai_team` 放在 Rovai 专属的
`mcp_config.json` 中，从而避免重写用户主配置。只有当前安装版本已经验证该机制不可用时，
才允许在官方用户级 MCP 文件中执行结构保留合并。不得为此写入用户工作区 MCP 文件。

配置管理必须遵守以下所有权规则：

- Core-owned、Agent 不可访问的私有受管记录保存目标来源、安装实例、Bridge 身份和 Rovai
  最后写入条目的 canonical digest；它位于当前用户专用 App data，不进入工作区、原生 MCP
  文档或模型上下文。名称、namespace、命令路径或“看起来像 Rovai”都不能单独证明所有权。
- 当前 `rovai_team` 条目的 canonical digest 与私有 `last_written_entry_digest` 完全一致时，
  Rovai 才能更新或删除它。任何差异都视为用户接管或冲突，立即放弃管理且不覆盖、不删除。
- 首次安装时若任一已知配置来源已有同名条目，按用户配置处理并报告冲突；不得静默抢占。
- 更新共享 JSON 前必须获取进程间锁、保留输入字节的全文 digest、在替换前执行 CAS、使用
  同目录临时文件和原子 replace，并写入可恢复的 crash journal。解析失败、锁失败、CAS
  失败或回读不一致均失败关闭。
- journal 只保存恢复所需的目标 identity、阶段和 before/after digest，不复制 MCP 原文或
  secret，并使用当前用户专用权限；临时文件在 replace 前也不得比目标文件权限更宽。
- 合并必须完整保留未知顶层字段、未知 Server 字段、顺序无关的对象内容和所有非 Rovai
  条目。卸载也只移除 digest 仍精确匹配的受管条目；不匹配时保留文件并报告人工处理。

Runtime 官方文档没有定义所有用户级、工作区和 Plugin 来源出现同名 Server 时的稳定优先
级。因此单个 JSON 对象中的唯一键不等于最终有效集合唯一。启动前必须检查所有当前可发现
来源中的 `rovai_team` 冲突；发现冲突、来源不可解析或专属 Plugin 被禁用时，
`TeamGatewayAttachment` 对该次检查保持不可用。即使检查通过，产品仍只声明
`PreservedUncontrolled`，不能声称已穷举所有 ambient MCP。

### Core 以 OS 进程身份建立连接绑定

现有 `InjectedCredential` Adapter 继续使用原来的私有临时 endpoint 和 bearer credential，
不得因本决策迁移到较弱身份或改变恢复语义。Core 为 `AttestedNativeBridge` 另设一个协议和
监听边界分离的稳定、每用户私有、权限受限 rendezvous；稳定 endpoint 只接受进程证明，
不能把“有 credential”和“父进程看起来正确”混成可互换的降级链。两条入口通过授权后才汇聚
到同一个 Team Gateway command path。

受证明 rendezvous 不能使用包含 Core PID 且只能由逐 Run 参数告知 Bridge 的临时路径。
Socket 文件和父目录必须限制为当前用户；Core 重启要安全接管或清理自己可证明拥有的 stale
endpoint，而不能信任路径存在本身。
Bridge 也必须从内核 peer 信息验证服务端进程属于受信 Rovai Core build，并核对 endpoint
owner/type/mode；仅凭固定路径或同一用户 UID 不能接受一个冒充 Core 的监听者。

Rovai 启动一次候选 Runtime 进程时，先建立有界 launch barrier，并在允许 Runtime 执行前
登记一次性 Run Claim：

```text
AgentRun ID
Native Binding ID + Generation
Execution Epoch
Runtime PID + process start time
frozen Runtime executable identity
eligible Team capability
short bootstrap expiry
claim / lease generation
```

Bridge 连接 Core 时不提交可伪造的 PID 字段。Core 必须从内核连接信息取得真实 peer PID，
并验证：

1. peer 可执行文件是当前受信 Bridge build，且 fingerprint 或平台 code signature 符合安装记录；
2. peer 的直接父进程是已登记 Runtime PID；若 Runtime 的真实 MCP 启动链不是直接父子关系，
   该 Runtime 不能使用本路径；
3. Runtime PID、启动时间和可执行文件 identity 与冻结记录完全一致，防止 PID 重用和安装漂移；
4. Bridge 进程启动时间晚于对应 Run Claim，Claim 未过期，Binding Generation、Execution
   Epoch 和 Team Capability 仍有效；
5. 同一 Claim 当前没有另一条活跃 Bridge lease。

验证成功后，Core 只在内存中建立 connection-bound 短期 lease。lease 不是可复制到另一个
Socket 的通用 bearer credential。一个 Claim 同时最多有一个活跃 Bridge；同一个已证明的
Bridge process instance 可以为后续请求重新连接并领取新 generation，旧 generation 立即
失效。只有 Runtime 经过独立证据证明会以可约束方式重启 MCP 子进程时，Adapter 才能另行开放
有次数、时间和速率上限的新 Bridge process 重领。`agy 1.1.9` 的 Spike 证明其不会这样重启，
所以 Antigravity 的 Bridge process crash 对当前 Run 失败关闭。Runtime 退出、Run 终止/取消、
Binding 换代、Epoch 变化、Core 重启或能力撤销都会失效 lease。

每次 `tools/list` 和 `tools/call` 都必须重新验证 peer/lease generation、Runtime 进程身份、
当前唯一活跃 Run、Binding、Epoch 和 Team Capability；`tools/call` 还要重新验证
CampMember、目标、A2A Capability 和既有配额。不能把连接建立时的授权缓存成整段 Session
权力。Tool-call identity 继续参与 Core 的幂等命令身份。

未由 Rovai 登记的普通 Runtime 即使读取同一全局配置并启动正版 Bridge，`tools/list` 也只
返回空列表；Core 不存在或身份不可信时也采用同一关闭状态。直接或竞态 `tools/call` 返回
稳定的 `run_not_bound`。拒绝路径不得创建领域命令、消息、AgentRun、Inbox、审计事件或
其他 SQLite 写入。

### 原生权限必须窄授权且单独同意

Bridge 可连接不代表 Runtime 会执行工具。适配器只有在当前 Runtime 版本已经实测以下任一
路径后才能报告 Team Tool ready：

- 用户明确同意并由 Rovai 安全管理的精确规则 `mcp(rovai_team/post_message)`；或
- 用户自己明确选择的 Runtime 全局自动批准模式。

Rovai 不得为了 Team Tool 自动开启 `--dangerously-skip-permissions` 或等价全局绕过。精确
规则的管理也必须使用可证明所有权和冲突检测；用户的 deny/ask 或更高优先级规则不能被覆盖。
在无交互执行中，如果 Ask 会被 Runtime soft-deny，健康状态必须显示权限受阻，不能把工具
已发现误报成工具可调用。

### Attachment 与工具合同按 Session/Run 冻结

`TeamGatewayAttachment` 策略、Runtime-facing 工具集合、Schema、Bridge protocol/build 和
对应 Charter 内容必须进入 Native Session compatibility identity（稳定 key 或 digest）。`Unsupported` 与
`AttestedNativeBridge` 之间的变化，或 `post_message` 合同的语义变化，必须换绑兼容 Session；
不能把一个原本没有该工具说明的旧 Session 热升级成发送者。

AgentRun 冻结启动时已经证明的 attachment 与配置策略，运行中不得改用 credentialed、SDK
或其他 fallback。配置 ownership divergence、用户撤回 permission、Bridge/Core/Runtime
identity 变化或其他安全失效会撤销当前 lease 并使后续调用失败；恢复有效配置只影响重新探测
后的新 Run/Binding，不复活旧 generation。普通 Run 可以继续完成，但不得再声称发送侧工具
可用。

### 以真实证据准入，不按 Runtime 名称猜测

`AttestedNativeBridge` 是可复用的 Adapter 策略，不是 Antigravity 特判。一个 Runtime 只有
同时证明固定无凭据 MCP 启动、真实 peer/父进程身份、受管配置、非交互权限、`tools/list`、
真实模型 `tools/call`、取消/退出失效和普通非 Rovai 启动拒绝后，才能冻结该能力。

远程 MCP Host、共享守护进程、无法验证直接启动链、不能安全管理配置或不能形成窄权限的
Runtime 保持 `TeamGatewayAttachment::Unsupported`。Capability 不能仅由 CLI 版本白名单、
配置文件写入成功、MCP initialize 或 Bridge 自报身份产生。

该保证的威胁边界是阻止普通独立 Runtime、复制的全局配置、stale PID、错误二进制和旧 Run
获得 Team 权力。拥有当前用户任意进程注入/调试能力、root 权限或能替换受信安装和 Core 的
攻击者不在此本机进程证明边界内；产品不得把该机制描述成抵抗已完全控制本机账户的沙箱。

## Consequences

- Antigravity 及相似 Runtime 可以在不持久化 Run 凭据的前提下获得一个窄的 A2A 发送工具。
- 现有 exact Adapter 的 credentialed endpoint 和语义保持不变；Core 需要维护两种明确分离的
  Connector authentication ingress，并让它们汇聚到同一领域命令边界。
- 外部 MCP Assignment、内部 Team Gateway 与 ambient MCP 隔离不再互相冒充，运行状态和
  审计必须明确展示各自保证。
- 全局原生配置仍会影响普通 Runtime；安全性来自 Core 的进程证明与逐调用授权，而不是
  Bridge 命令的隐蔽性。
- Core 需要稳定 rendezvous、OS 进程检查、launch barrier、Claim/lease generation、配置
  所有权记录、Bridge 对 Core 的反向身份检查和新的兼容性 Smoke，平台实现与打包签名成本
  明显增加。
- 专属 Plugin 能降低配置冲突，但不能提供完整 ambient MCP 隔离；共享 JSON fallback 还
  存在不遵守 Rovai 锁协议的第三方写入者，必须以 CAS、journal、回读和显式冲突降低风险，
  不能宣传为无条件原子协作。
- 首阶段只有 `post_message`，所以具备该能力的 Runtime 可以发送 A2A，但不会因此获得 Task、
  Memory 或外部 MCP 能力。
- Attachment 或工具合同变化会换绑 Native Session；用户撤回、配置 divergence 和进程
  identity 变化则优先撤销活跃 lease，接受窄能力可用性降低以换取明确的撤回边界。

## Rejected Alternatives

- **Antigravity SDK 直接替代 CLI。** 在 SDK 尚未证明能复用 `agy` Keyring、Google Sign-In、
  订阅模型目录、Claude 等非 Gemini 模型、原生 Session/取消和同一额度结算前，不能假定它与
  已接入 CLI 等价。以后完成独立证据可以另建 Adapter，不阻塞本决策。
- **把用户原生 MCP 和所有 Rovai MCP 统一写入全局配置。** 这会绕过每队员 Assignment，
  扩大凭据和工具暴露，并把“成功合并”误当成“精确隔离”。
- **在全局配置中写 Native Binding 或 Run token。** 普通 Runtime、备份、日志和后续 Run
  都可能重用持久凭据。
- **只验证父 PID。** 不能处理伪造 peer 信息、PID 重用、错误可执行文件、旧 Claim 或被抢占
  的 lease。
- **允许任意新 Bridge 进程重领 Claim。** 未经 Runtime 重启行为实证会扩大可冒领窗口；当前
  Antigravity 只允许同一已证明 Bridge process 重建连接，Bridge process crash 失败关闭。
- **自动打开全局 permission bypass。** 为一个内部工具扩大所有工具权限，违反最小授权和
  用户原生权限所有权。
- **使用 `team.post_message` 作为 Antigravity MCP 工具名。** Server/tool 二元地址已经表达
  namespace；点号还会触发 Runtime 命名兼容问题。
- **仅凭写入配置或 MCP initialize 宣告支持。** 这些证据没有证明实际模型能发现、获准并
  完成一次 Core-authorized Tool Call。

## References

- [v0.30 Attested Native Team Bridge](../versions/v0.30/README.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0018: File-Backed MCP Library and Per-Run Runtime Projection](0018-file-backed-mcp-library-runtime-projection.md)
- [ADR-0059: Runtime-Owned Resource Permissions](0059-runtime-owned-resource-permissions.md)
- [ADR-0065: Verified Runtime Catalog](0065-verified-runtime-catalog-and-documentation-only-compatibility.md)
- [ADR-0075: Runtime Integrity at Change and Execution Boundaries](0075-runtime-integrity-at-change-and-execution-boundaries.md)
- [Antigravity MCP Servers](https://antigravity.google/docs/mcp)
- [Antigravity Plugins](https://antigravity.google/docs/plugins)
- [Antigravity CLI Permissions](https://antigravity.google/docs/cli/permissions)
