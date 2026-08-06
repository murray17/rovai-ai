---
document_type: adr
id: ADR-0126
title: Codex Native Home and External Session Ownership
status: accepted
date: 2026-08-06
decision_scope: cross-version
source_version: v0.43
supersedes:
  - ADR-0107
superseded_by: null
---

# ADR-0126: Codex Native Home and External Session Ownership

> 本决策替代 [ADR-0107](0107-camp-member-isolated-codex-home-and-agentrun-app-server.md)
> 的 `(campId, agentProfileId)` Isolated Codex Home、配置复制、Camp cleanup、orphan GC 和
> 物理 Session 隔离；局部替代 [ADR-0123](0123-exclusive-agentrun-runtime-fleet.md) 的 Codex
> Home compatibility identity。ADR-0123 的 AgentRun 独占 lease、Resident 配额、quiescence、
> fencing 和 Core restart 语义继续有效。

## Context

Isolated Codex Home 最初用于阻止 user MCP 与 Rovai MCP 在同名 key 上深度合并，同时保存按
Camp/AgentProfile 隔离的 Codex rollout。它要求复制用户配置、删除原生 `mcp_servers`、禁用
Project `.codex`、共享认证和插件状态、维护 Home marker/lock/cleanup，并把外部 MCP 摘要纳入
Codex process compatibility。

在 ADR-0125 的 additive 模型下，Rovai 不再承诺清除 ambient MCP。Codex 可以先读取实际有效
配置，跳过同名 Rovai Server，再通过 thread config 只追加不存在的 key。继续维护独立 Home
只会保留一套不再需要的配置所有权和 Session 生命周期。

## Decision

### 所有 Codex 进程使用 Codex 自己解析的 Home

Rovai 启动任何 Codex app-server 时都不设置或覆盖 `CODEX_HOME`，不删除 `CODEX_SQLITE_HOME`，
不创建 `<Rovai data>/codex-homes/<camp>/<agentProfile>`。用户、Project、managed、plugin、hook、
memory 和其他 Codex 原生配置按目标 executable、process environment 与 cwd 的原生规则生效。

Rovai 不再拥有 Codex Home marker、config generation、Home lock、Camp cleanup record、72 小时
orphan GC 或 Home rebuild 路径。Camp 删除不触碰 Codex 原生文件。

v0.43 以 managed local-data clean break 删除旧版本遗留的 Rovai-owned `codex-homes`；这只清理
Rovai 先前创建的隔离副本，不解析、迁移或删除 Codex 原生 Home。Camp 公共历史摘要等内部
Codex Job 也继承同一个 Native Home；它们通过私有 cwd、ephemeral thread、tool-disabled config
和工具事件 fail-closed 约束副作用，不再建立临时 Home 例外。

### Rovai 只拥有 Native Binding

Rovai 在 Conversation 中只持久保存 Codex `thread.id` 及现有 Native Binding evidence。Resume
直接对当前原生 Home 执行 `thread/resume`；成功则继续，失败或找不到 rollout 时按现有 fenced
replacement 语义创建新 thread。

Conversation 的“私有连续性”是 Rovai 路由和 portable context 的逻辑边界，不承诺 Codex 文件按
Camp/AgentProfile 物理隔离。删除 Camp 只删除 Rovai 数据和 Binding，不能宣称删除了外部 Runtime
thread、日志、memory、插件状态或其他本地数据。

### Codex MCP 使用 config discovery 与 thread-scoped addition

app-server 初始化后、`thread/start` 或 `thread/resume` 前，Adapter 通过
`config/read(includeLayers=true, cwd=executionRoot)` 收集所有有效层的 native top-level MCP
名称。Same-name 比较完成后，只把不同名的 Rovai Server 作为 `config.mcp_servers` 传给
`thread/start` / `thread/resume`；配置对象不得包含已发现的同名 key。

`config/read` 是 discovery evidence，不再验证 user layer 必须来自 Rovai Home、不再拒绝有效
Project/managed MCP，也不要求 effective MCP 集合精确等于 Rovai Assignment。

### Fleet compatibility 不包含 Conversation Home 或 thread MCP

Codex app-server 可以在独占 lease 和 quiescence 证明下，继续服务 Fleet compatibility 相同但
Assignment 不同的后续 Run。process compatibility 只包含 executable/config、cwd、permission、
Built-in CLI、attachment root 等真正的 process-scoped 输入；thread-scoped external MCP 不进入
digest。

每次 Fleet acquire 都重新读取当前 native MCP 名称、finalise 本 Run 的 additive projection，
再创建或恢复 thread。旧 Run lease 和迟到调用继续 fail closed。

## Consequences

- Codex 原生配置、Project `.codex`、plugins 和 Session rollout 不再复制或与用户环境漂移。
- Rovai 删除大量 Home、cleanup、GC、config validation 和 rebuild replacement 代码。
- Camp 公共历史摘要与普通 AgentRun 使用一致的 Native Home ownership；摘要 Job 不建立持久
  Native Binding，并继续在任何工具事件发生时失败。
- Codex 原生状态可以被用户的其他 Codex surface 看见和管理；Rovai 不提供物理隔离或删除保证。
- 一个 warm app-server 可以在既有 Fleet compatibility 边界内串行复用，外部 MCP 在 thread 层
  每 Run finalise。
- 原生配置变化可能影响后续 Run；MCP Projection Input 仍冻结 Rovai 请求，而 native collision
  discovery 反映该次启动实际环境并进入最终 Exposure。

## Rejected Alternatives

- 继续保留 Isolated Home 但不写 MCP：仍需承担配置 snapshot、认证/plugin link、Session cleanup
  和跨 Home process identity，没有对应产品收益。
- 只删除 Home 中的 `rovai_team`：v0.42 已删除 built-in MCP，且 ADR-0107 的持久 Home 原本只保存
  external MCP。
- 继续用 whole-table override：Codex 对同名 nested table 深度合并，可能重新产生混合 transport。
- 删除 Camp 时调用 Codex 删除 thread：Rovai 不拥有原生 Session 文件，也不能把外部删除结果纳入
  Camp 事务。

## References

- [v0.43 Runtime-native additive MCP](../versions/v0.43/README.md)
- [Codex MCP Configuration Collision postmortem](../postmortems/2026-08-05-codex-mcp-configuration-collision.md)
- [ADR-0123: Exclusive AgentRun Runtime Processes and Resident Fleet Reuse](0123-exclusive-agentrun-runtime-fleet.md)
- [ADR-0125: Runtime-Native Additive External MCP Projection](0125-runtime-native-additive-external-mcp-projection.md)
