---
document_type: architecture
architecture: builtin-tool-runtime
authority: builtin-tool-component-boundaries
status: accepted
last_updated: 2026-08-07
---

# Built-in Tool Runtime Architecture

本文件说明 Rovai built-in operations 的长期组件结构。当前 v0.45 精确字段与版本见
[Built-in Tool Transport v2 Contract](../contracts/builtin-tool-transport-v2.md) 和
[Camp Message Send v1](../contracts/camp-message-send-v1.md)；历史 v1 仅用于理解运输继承关系。
决策理由见 [ADR-0124](../adr/0124-cli-only-transport-for-rovai-built-in-operations.md) 与
[ADR-0130](../adr/0130-public-a2a-message-and-unified-delivery.md)。

## 总体路径

```text
Agent Runtime
    │ Shell + process-scoped CLI environment
    ▼
bundled `rovai` CLI
    │ authenticated local Unix IPC
    ▼
Core BuiltinToolRouter
    │ canonical operation + current Run context
    ├── Public Camp Message / Message Delivery service
    ├── Collaboration / Task service
    ├── Camp History service
    └── Memory Retrieval / Mutation service
```

CLI 是运输客户端，不拥有领域逻辑。Router 验证 operation/input、解析 active lease、调用既有
领域服务，并生成 Envelope、receipt、replay 和 Core Activity。Runtime Adapter 不理解十二个
Schema，也不把它们转换成 Runtime-native tools。

## 权威与 projection

| 组件 | 拥有的权威 | 不是 |
| --- | --- | --- |
| Built-in Tool Catalog | canonical names、Schema、CLI mapping、错误与 digest | Runtime alias 表 |
| `rovai` CLI | 参数/stdin/file 解析、IPC、输出与有界运输重试 | 领域 handler、授权者、receipt 生成者 |
| BuiltinToolRouter | current lease 解析、分发、Envelope、receipt、replay、Activity | 第二套 Message/Delivery 服务 |
| Domain Services / Gateway | 可见范围、版本、状态、配额、幂等副作用和业务不变量 | CLI 或 MCP 适配层 |
| Runtime Fleet | process ownership、exclusive Run lease、reuse、fence、quiescence | 领域成员权限目录 |
| Runtime Adapter | 启动/恢复 Runtime、注入 CLI 环境、Bootstrap、外部 MCP Projection | built-in Schema/alias/allowlist |
| Bootstrap | 稳定使用原则与发现入口 | 完整 catalog 或授权凭据 |
| ContextManifest | 当前 Run 的有界工作集与 canonical retrieve hints | CLI 命令副本或 socket/token |
| Canonical Runtime Activity | Core-verified operation projection | Runtime 原始 Evidence 的替代品 |

## Catalog 与命令

Catalog 只有一份，由 Core library 提供并同时服务 Router、CLI parser、`tool list/describe`、
Bootstrap tests 与 catalog digest。Dotted canonical operation 永远是语义身份；领域分组 CLI
command 只是同一项 operation 的 shell presentation。

App build 固定 catalog。App 更新需要重启；没有运行中 catalog hot reload、双版本或兼容路径。

## Runtime process 与 lease

每个受管 Runtime 根进程拥有稳定 process identity 和私有 CLI context path。Fleet acquire
为当前 `(agentRunId, executionEpoch)` 轮换 active lease，Core 在输入投递前完成绑定和 CLI
preflight。release 顺序固定为：

```text
stop accepting new Runtime work
  → fence Built-in Tool Lease
  → wait/verify Runtime + CLI quiescence
  → IdleWarm when reusable, otherwise stop and reap
```

Codex 与六种 ACP Runtime 可以串行复用兼容进程；Claude Code 与 Antigravity 保持 one-shot。
复用不复用旧 lease。Core restart 不接管旧 process context。

### 新 Session

1. Adapter/Fleet 启动或取得独占 Runtime process；
2. Core 绑定新 active lease，并写 process-private context；
3. Adapter 建立 Native Session 并投递 CLI Bootstrap；
4. Core materialize ContextManifest，随后投递 Current Input；
5. Agent 发现并调用 CLI；Router 从 lease 解析当前 Run。

### Resume

Resume 重新投递完整稳定 Bootstrap，但不改变 catalog 真源。若 Native Session 仍兼容，可以在
新 AgentRun 中恢复；它必须获得新的 Built-in Tool Lease。旧 Run 的 requestId 不进入新 Run
identity。Resume 失败导致 Session replacement 时，Router 与领域结果合同保持不变。

### Resident process reuse

兼容 IdleWarm process 被新 Run acquire 后轮换 lease，再绑定新的 Session/Run route。任何旧
lease、迟到 callback 或旧 request 都 fail closed。Adapter 无法证明进程树 quiescent 时不得
保留为 IdleWarm。

## Bootstrap 与 Dynamic Context

Session Charter 只说明：

- 使用 bundled `rovai`；
- `rovai tool list/describe`；
- v0.45 catalog 的领域分组命令和输入模式；
- canonical operation、receipt、Task version、`camp.message.send`、Message Delivery 与 Task
  assignment 的协作语义；
- Dynamic Context 可能截断，应遵循 canonical `retrieveWith`；回复公共 A2A 时遵循 Profile v2
  的 bounded reference closure。

Bootstrap 不含完整 Schema、socket、process token、lease、AgentRun ID、epoch、Camp ID 或
Native Binding ID。Dynamic Context 使用 `retrieveWith.operation` 指向 canonical operation，
不重复 shell command。

## Built-in CLI 与外部 MCP

```text
Rovai-owned operations ── rovai CLI ── Core Router
user-configured MCP    ── Runtime-native MCP Projection
```

两条路径不共享 catalog、授权、receipt、生命周期或代理层。外部 MCP 继续由 Library、Assignment、
Projection 和 Exposure Snapshot 管理；built-in operations 永不进入 `McpProjectionInput`、
Runtime MCP config 或 MCP runtime-name mapping。`rovai_team` 没有保留语义，同名外部 Server
只是普通第三方 MCP。

## Activity 与 Evidence

Core 为每次已验证调用创建 canonical Built-in Tool Activity。若 Runtime Shell Evidence 与
request/receipt 有显式可验证关联，它作为同一 Activity 的 supporting Evidence；否则保留为
独立 Activity。命令文本、时间、cwd 或输出相似度不能建立关联。

Shell 子进程共享当前 Run 身份。系统记录事实与 receipt，但不声称能够证明模型主观意图。

## 故障边界

- CLI/IPC/lease/catalog preflight 失败：输入投递前终止 AgentRun；
- Core 业务拒绝：返回带 receipt 的错误 Envelope 与 recovery；
- 响应丢失：同 requestId 有界重试并重放；
- 无法证明 mutation 结果：`结果待确认`，不换 requestId 重发；
- external MCP 失败：遵循其独立的 non-blocking degradation，不回退为 built-in MCP；
- 任一九 Runtime 未通过真实 discovery/read/mutation/replay/fence/negative-path 验收：整个版本不完成。
