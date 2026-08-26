---
document_type: postmortem
incident_id: INC-2026-08-05-CODEX-MCP-ISOLATION
incident_date: 2026-08-05
status: closed
systems:
  - codex-runtime-adapter
  - mcp-runtime-projection
  - macos-packaged-app
last_updated: 2026-08-26
---

# Codex MCP 配置冲突与 AgentRun 启动失败

> **爱丽丝的小结：** 这次不是用户把 `context7` 的名字起错了，而是 Rovai 把“我想覆盖配置”
> 误当成“Codex 会整表替换”。同名 stdio/HTTP 条目被深度合并，Run 连第一轮都没走到。
> 事故当时靠 Isolated Home 修住；那是历史方案，今天应以 Native Home 与增量 MCP 为准。

> 当前架构说明（2026-08-06）：下文的隔离 Home 修复是本次事故的历史解决方案，
> 不是当前产品合同。v0.43 已用 Codex Native Home、app-server `config/read`、
> `NativeWinsSkip` 和 thread-scoped additive MCP 取代该方案；参见
> [ADR-0125](../versions/v0.43/decisions.md#adr-0125) 与
> [ADR-0126](../versions/v0.43/decisions.md#adr-0126)。

## 摘要

2026-08-05，Rovai 启动的一个 Codex AgentRun 在第一次模型轮次前失败。用户的原生
Codex 配置中有一个名为 `context7` 的 stdio MCP Server，而 Rovai 分配了同一规范名称的
HTTP MCP Server。Rovai 把自己的 MCP 表作为 Runtime override 传入，并假定整张表会替换
低优先级 MCP 配置；Codex 实际上对同名条目进行了深度合并，生成了一个同时包含 stdio
`command` 与 HTTP `url` 字段的无效 Server 定义。Codex 因而拒绝有效配置并报错：

```text
failed to load configuration: url is not supported for stdio in mcp_servers.context7
```

同一架构还会让无关的用户 MCP 定义留在环境中，即使它们没有导致启动失败。用户配置对于
原生 Codex 使用完全有效；冲突来自 Rovai 错误的隔离边界，而不是用户选择的 Server 名称或
transport。

当时的解决方案是：为每个 `(Camp, AgentProfile)` 建立持久 Isolated Codex Home，从隔离副本
中清除用户顶层 MCP 配置，原子写入 Rovai 拥有的完整 MCP 集合，验证 Codex 的有效配置，
并以 AgentRun-scoped 进程替换全局共享的 Codex app-server。用户真实的
`~/.codex/config.toml` 未被修改。随后用全新打包的 macOS 应用重新验证了原始的跨 transport
同名冲突场景。

本复盘不归咎个人。基于 Rovai 当时假定的替换语义，相关决定在局部上都有合理性。本文的
目的，是修正让事故成为可能的系统条件，而不是责怪某位开发者或用户的有效 Codex 配置。

## 事故元数据

| 字段 | 值 |
|---|---|
| 发现方式 | 用户报告本地 Camp 执行失败，并质疑打包应用是否包含最新 Core |
| 受影响路径 | Rovai 管理的 Codex AgentRun 启动 |
| 触发条件 | 用户与 Rovai 的 MCP Server 同名，但使用不兼容的 transport |
| 用户可见症状 | AgentRun 在产生模型输出前失败 |
| 数据完整性 | 未发现 Camp 数据损坏，也未修改用户真实的 Codex 配置 |
| 安全边界 | 环境中的用户 MCP 配置可能进入 Codex 有效配置；本次事故未发现调用或凭据披露 |
| 解决方案 | v0.39 Codex Home 与进程隔离，由 commit [`efc50da`](https://github.com/murray17/rovai-ai/commit/efc50daee7a95a078aaa25b8e5fc6cc1e2fa7cc3) 交付 |
| 事故持续时间 | 未计算；首次失败与恢复时间未作为结构化事故数据保留 |

## 影响

已观察到的 AgentRun 无法启动，因此用户请求的工作没有执行，只能在新构建完成后调查并
重试。直接受影响的是有效配置中存在同名冲突、且该冲突会生成无效合并 MCP 条目的 Codex
AgentRun。其他 Runtime Adapter 不经过这条配置路径。

潜在影响比可见失败更广。旧设计会让用户原生 Codex 配置中名称不同的 MCP Server 继续对
Rovai AgentRun 可用；即使 Codex 接受配置，这也违反了 Rovai 对外部 MCP 集合的预期所有权。
本次事故没有发现非预期 Server 被调用的证据，但仅仅启动成功并不能证明已经隔离。

没有证据表明数据库损坏、Camp 历史丢失、`~/.codex/config.toml` 被修改，或持久化的 Team
Gateway 凭据被披露。

## 发现与响应

事故由用户从失败的会话中发现，而不是由自动化隔离检查发现。错误文本指出了 transport
不一致，但最初的诊断界面无法在一个位置确认以下事实：

- 失败进程实际加载了哪个 `CODEX_HOME`；
- 哪些配置层共同组成了有效 MCP 条目；
- 正在运行的 Core 来自当前源码还是旧版打包应用；
- Rovai 请求的 MCP 表是否与 Codex 有效表精确一致。

调查复现了两个跨 transport 方向：用户 stdio 对 Rovai HTTP，以及用户 HTTP 对 Rovai
stdio。这证明缺陷并不只与 Context7 或某一种 transport 有关。进一步检查进程模型后发现，
即使只修正配置生成，全局 app-server 也无法支持不同成员各自的 Home。

## 时间线

所有时间均为 Asia/Shanghai。由于没有记录准确的发现时间和中间响应时间，时间线有意避免
虚构精度。

| 时间 | 事件 |
|---|---|
| 2026-08-05 之前 | Rovai 使用全局共享的 Codex app-server，继承用户真实的 Codex Home，并以 Runtime override 提供 `mcp_servers`。测试没有依据 Codex 有效配置证明跨 transport 的同名隔离。 |
| 2026-08-05，时间未记录 | 本地 Codex AgentRun 在第一次模型轮次前因同名 stdio/HTTP MCP 配置错误失败。 |
| 2026-08-05，时间未记录 | 调查确认 Codex 深度合并了用户与 Rovai 条目，而非替换低优先级条目。可能正在运行旧版打包 Core，也让最初的构建来源不清晰。 |
| 2026-08-05，时间未记录 | 设计边界被修正：持久状态按 Camp 与 AgentProfile 分键，活跃 app-server 则限定于单个 AgentRun。ADR-0107 与 v0.39 实现合同获接受。 |
| 2026-08-05，时间未记录 | 实现 Isolated Codex Home manager、精确 MCP 替换、有效配置验证、逐 AgentRun 进程生命周期、清理协议与回归覆盖。 |
| 2026-08-05 14:20:01 | 最终打包的 arm64 Core 构建完成，Mach-O UUID 为 `83AA9EBD-065F-3D59-B0C2-08A99E63562B`。 |
| 2026-08-05，打包后 | 使用真实 Codex 0.146.0 的 smoke test 通过：隔离配置、排除 project config、保留 `AGENTS.md`、不同 AgentRun 使用新 PID、同一 Home 恢复 thread，以及 Debug/打包 Core 路径中的 stdio/HTTP 投影。 |
| 2026-08-05 14:28:51 | Commit `efc50da` 记录完整修复与验收证据。 |

## 技术根因

Rovai 把 Runtime `mcp_servers` override 建模为整表替换，而 Codex 的配置语义会跨来源合并
嵌套表。对于同名 Server，两个来源的 transport 专属字段都会保留：

```text
用户 ~/.codex/config.toml            Rovai Runtime override
[mcp_servers.context7]               [mcp_servers.context7]
command = "npx"                      url = "https://..."
                 \                   /
                   有效配置深度合并
                 同一条目同时有 command + url
                              |
                           启动被拒绝
```

这个错误的替换假设是直接配置根因。更深层的架构根因是所有权不匹配：Rovai 承诺任务专属的
MCP 边界，却在用户拥有的配置根中启动 Codex，并让一个进程跨多个 Camp 和成员复用。
`CODEX_HOME` 是进程级的，同时包含原生 Session 状态，因此全局进程和用户 Home 无法提供
所需的隔离与连续性模型。

## 促成因素

### 缺少有效配置不变量

Rovai 验证的是自己打算发送的配置，而不是 Codex 实际加载的完整配置。第一次模型轮次前
没有 `config/read` 断言来证明有效顶层 MCP 集合及每个 transport identity 与冻结的 Rovai
投影精确一致。

### 冲突覆盖不完整

早期 smoke 覆盖没有针对真实 Codex app-server 测试同名 stdio/HTTP 冲突的两个方向。只比较
渲染后的 JSON，或者只使用同一 transport，无法发现深度合并留下的旧 transport 字段。

### 进程与状态生命周期错误耦合

全局 app-server cache 在 Rovai 建立正确的 Home identity 前就优先优化了进程复用。原生 Session
连续性因此被隐式绑定到共享进程，而不是持久的 `(Camp, AgentProfile)` 状态根。

### 打包构建来源不够直观

源码测试与已安装应用可能运行不同的 Core 二进制。最初追问是否已经生成新包很合理，因为
诊断界面没有展示可验证的 Core 构建身份。这没有制造 MCP 冲突，但延长了确认本地复现是否
包含候选修复所需的时间。

### 生命周期术语最初有歧义

“task”可能指领域 Task、CampTurn、AgentRun 或 Camp。这种歧义最初让保留策略更容易被挂到
错误对象上。最终设计明确以 Camp 作为持久 Home 边界，以 AgentRun 作为进程边界。

## 既有防护为何没有阻止事故

- 规范 MCP JSON 与稳定 Assignment identity 定义了 Rovai 想投影什么，却不能证明 Codex 如何
  将投影与环境配置组合。
- 整表 Runtime override 无需修改用户文件，但在 Codex 合并语义下并不是替换原语。
- 启动失败暴露了无效的混合 transport；名称不同的环境 MCP Server 则可能因不报错而继续
  潜伏。
- 源码级验证不能证明测试中的打包应用包含同一个 Core 二进制。

## 不属于根因的事项

- 复用规范 MCP 名称 `context7` 不是错误；Rovai 有责任隔离自己声称拥有的命名空间。
- Rovai 选择 HTTP、原生 Codex 选择 stdio 不是错误；两项定义在各自环境中都有效。
- Context7 服务可用性没有导致失败；Codex 在调用任何 Server 前就拒绝了配置。
- 可能过期的安装包没有制造合并缺陷；在记录打包 Core identity 前，它只让修复验证更不确定。

## 解决与恢复

当时的修正把持久 identity 与进程生命周期分开：

1. Rovai 创建 `<data>/codex-homes/<camp_id>/<agent_profile_id>/`，并供同一 Camp 中同一成员的
   后续 AgentRun 复用。
2. 首次创建时，Rovai 复制用户的非 MCP 配置，移除完整顶层 `mcp_servers` 表，把执行项目标为
   untrusted，写入 Rovai 的完整外部 MCP 集合，并原子发布 owner marker。
3. 认证和 plugin 状态通过窄共享链接继续可用；用户真实配置从不修改。plugin 提供的 MCP 是
   顶层外部 MCP 保证中的明确例外。
4. 每个 AgentRun 使用带隔离 `CODEX_HOME` 的新 Codex app-server。Run 终结时关闭进程，后续
   Run 则用同一 Home 恢复原生 thread。
5. 第一次模型轮次前，Rovai 读取并验证 Codex 有效配置。未知顶层 MCP Server、遗留 transport
   字段或活跃 project `.codex` 层都会 fail closed。
6. 删除 Camp 会进入持久清理队列，并在可能时立即删除其 Home。有效 Camp 保留 Home；未知
   orphan 目录在 72 小时后可清理。
7. 重新构建 macOS 包并记录内嵌 Core identity，再重复原始真实 Runtime 场景。

## 做得好的地方

- 具体的 Codex 错误保留了 MCP 名称和无效 transport 关系，使配置冲突可稳定复现。
- 调查从可见的 `context7` 失败扩展到更广的环境 MCP 隔离破坏，没有采用名称特判补丁。
- 设计审查在发布仅修配置的补丁前发现了进程生命周期缺陷，避免继续跨成员与 Camp 共享状态。
- 最终验证使用真实 Codex app-server 与打包 Core，而不只依赖 mock 或渲染配置快照。
- 整个修复和测试过程中，用户拥有的 `~/.codex/config.toml` 始终未被修改。

## 可以改进的地方

- 从第一次实现 MCP 投影起，就应把有效配置视为启动不变量。
- 跨来源、同名、跨 transport 应成为强制兼容性测试。
- Runtime 诊断应在不暴露秘密的前提下标识 Core 构建和隔离 Home。
- 应把事故里程碑记录为结构化时间戳，以便测量发现和恢复时间，而不是事后重建。
- 通过进程复用进行优化，应晚于明确的所有权模型，而不是早于它。

## 幸运之处

- 冲突的 transport 字段导致硬启动失败；若悄悄合并出有效但非预期的 Server，会更难发现。
- 故障发生在具有可复现用户配置的本地环境，而不是更广泛分发后。
- 所需连续性边界已经与既有 Camp-and-AgentProfile Conversation identity 对齐，避免了对用户
  Session 历史的破坏性迁移。

## 纠正与预防措施

状态反映本复盘发布时可用的证据。任何开放事项开始前，责任角色都必须映射到具体维护者。

| ID | 措施 | 责任角色 | 优先级 | 状态 | 证据或目标 |
|---|---|---|---|---|---|
| PM-01 | 按 Camp 和 AgentProfile 隔离持久 Codex 状态，且不修改用户真实配置 | Codex Runtime | P0 | 已完成 | `CodexHomeManager`；ADR-0107 |
| PM-02 | 用 AgentRun-scoped 进程所有权与有界关闭替换全局 Codex app-server 复用 | Runtime Lifecycle | P0 | 已完成 | 真实测试证明 PID 不同且同一 Home 可恢复 thread |
| PM-03 | 第一次模型轮次前验证有效配置；遇到未知顶层 MCP 或 project config 时 fail closed | Codex Runtime | P0 | 已完成 | `config/read` 验证与回归测试 |
| PM-04 | 使用真实 Codex app-server 增加双向 stdio/HTTP 同名测试 | MCP Integration | P0 | 已完成 | `scripts/smoke-mcp-projection.mjs` |
| PM-05 | 针对原始场景重建并验证打包的 macOS Core | Release Engineering | P0 | 已完成 | UUID `83AA9EBD-065F-3D59-B0C2-08A99E63562B` |
| PM-06 | 在兼容的 macOS runner 上把真实跨 transport 投影 smoke 设为强制发布门禁 | Release Engineering | P1 | 已计划 | 目标：下一次 Codex Runtime 发布 |
| PM-07 | 在导出的启动诊断中加入脱敏 Core 构建 identity、有效配置来源与 Isolated Home identity | Core Observability | P1 | 已计划 | 目标：v0.41 规划 |
| PM-08 | 为阻断发布的本地事故记录结构化的发现、确认、缓解和恢复时间 | Release Engineering | P2 | 已计划 | 目标：更新事故模板与发布清单 |

## 复发判据

若任何 Rovai 管理的 Codex AgentRun 出现以下情况，即视为本事故复发：

- 加载了不在冻结 Rovai 投影中的用户顶层 MCP Server；
- 合并了两个同名 MCP 定义的 transport 字段；
- 在只应保留 `AGENTS.md` 项目指令的工作区启用了 project `.codex` 配置；
- 跨不同 Isolated Codex Home 复用了同一个活跃 Codex 进程；或
- 无法确认一次启动失败由哪个 Core 二进制和 Home 产生。

即使模型轮次成功，任何上述情况也应按隔离失败处理。

## 经验

配置意图不等于配置证据。外部 Runtime 合并分层配置时，隔离必须在来源边界建立，并从
Runtime 的有效视图验证。持久 Session 状态与活跃进程复用是不同的生命周期决定；不能只因
旧实现把二者放在一个全局 client 后面，就让它们共享 identity。最后，打包二进制来源也是
事故响应的一部分：只有测试中的 artifact 能与已验证源码建立对应，修复才算完成运行验证。

## 参考资料

- [ADR-0107：Camp-Member Isolated Codex Home 与 AgentRun-Scoped App Server](../versions/v0.39/decisions.md#adr-0107)
- [v0.39 Codex Isolated Home 实现合同](../versions/v0.39/codex-home-isolation.md)
- [v0.39 实现与验收证据](../versions/v0.39/implementation-plan.md)
- [ADR-0103：Canonical MCP JSON 与 Stable Assignment Identity](../versions/v0.37/decisions.md#adr-0103)
- [ADR-0104：Rovai-Preferred MCP Projection 与 Non-Blocking External Degradation](../versions/v0.37/decisions.md#adr-0104)
- [修复 commit `efc50da`](https://github.com/murray17/rovai-ai/commit/efc50daee7a95a078aaa25b8e5fc6cc1e2fa7cc3)
