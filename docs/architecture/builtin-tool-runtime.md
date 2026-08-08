---
document_type: architecture
architecture: builtin-tool-runtime
authority: builtin-tool-component-boundaries
status: accepted
last_updated: 2026-08-08
---

# Built-in Tool Runtime Architecture

本文件说明 Rovai built-in operations 的长期组件结构。当前字段与版本以
[Built-in Tool Transport v3](../contracts/builtin-tool-transport-v3.md) 和
[Camp Message Send v2](../contracts/camp-message-send-v2.md) 为准；v0.45 的 v2/send-v1 文档只
保留历史语义。决策理由见 [ADR-0124](../adr/0124-cli-only-transport-for-rovai-built-in-operations.md)
与 [ADR-0135](../adr/0135-compact-agent-output-over-canonical-built-in-tool-envelope.md)。

## 总体路径

```text
Agent Runtime
    │ fixed business command + process-scoped CLI context
    ▼
bundled `rovai` CLI
    │ authenticated local Unix IPC
    ▼
Core BuiltinToolRouter
    │ current Run / lease / Native Binding
    ├── Public Camp Message / Message Delivery service
    ├── Collaboration / Task service
    ├── Camp History service
    └── Memory Retrieval / Mutation service
```

业务调用的响应路径是：

```text
Domain canonical result
  → complete Core Invocation Envelope
  → envelope validation
  → explicit operation Agent Result Projection
  → one JSON document on Agent stdout
```

CLI 是运输与投影客户端，不拥有领域逻辑、授权、receipt 或 Replay 真源。Router 验证输入、解析
active lease、调用既有领域服务，并生成完整 Envelope、receipt、Replay 和 Core Activity。Projection
不能参与 receipt、Replay 或授权决策。

## 权威与边界

| 组件 | 拥有的权威 | 不是 |
| --- | --- | --- |
| Built-in Tool Catalog | canonical names、输入/结果 schema、`agentOutputSchema`、projection identity、错误合同、CLI mapping、digest | Agent-facing discovery API |
| `rovai` CLI | 输入来源解析、IPC、完整 Envelope validation、显式 projection、stdout/exit/stderr 安全边界、有限运输重试 | 领域 handler、授权者、receipt 生成者、通用字段删除器 |
| BuiltinToolRouter | current lease 解析、operation 分发、完整 Envelope、receipt、Replay、Activity | 第二套 Message/Delivery 服务 |
| Domain Services / Gateway | 可见范围、版本、状态、配额、幂等副作用和业务不变量 | CLI 或 MCP 适配层 |
| Runtime Fleet | process ownership、exclusive Run lease、reuse、fence、quiescence | Camp 选择或业务 catalog |
| Runtime Adapter | 启动/恢复 Runtime、注入 CLI 环境、Bootstrap、外部 MCP Projection | built-in schema、alias、Agent discovery |
| Bootstrap / Charter | 固定命令、使用原则、帮助入口和安全恢复原则 | 完整 schema、Envelope、catalog digest、凭据、Camp ID |
| Evidence / Qualification / host debug | 完整 Envelope、receipt、request identity 和诊断证据 | Agent 日常 stdout |

## Catalog 与 Agent command

Core 只维护一份 catalog。它服务 IPC 校验、合同测试、Qualification、Evidence/receipt 验证和
开发诊断；catalog 中的 `agentOutputSchema`、Envelope schema、error contract 和 projection
identity 不构成 Agent discovery 协议。

Agent Runtime 没有 `rovai tool list`、`rovai tool describe`、隐藏 discovery、`tool invoke` 或
`tool call`。Agent 只使用十二个固定业务命令：

```text
rovai send
rovai task create|list|update
rovai camp list|search|read
rovai history search
rovai memory search|read|write|propose-hearth
```

`<command> --help` 是唯一的命令发现入口。Help 只列必要 flags、输入来源互斥规则、关键约束
和短示例，不输出完整 JSON Schema、Envelope、receipt 或 catalog。Dotted canonical operation
仍是 Core 内部语义身份，不能直接变成通用 Agent 命令。

## Agent Result Projection

完整 Envelope 经过验证后，CLI 按 operation 显式选择 projection：

| Operation | Projection |
| --- | --- |
| `camp.message.send` | `{messageId, effectiveRecipients}` |
| `memory.write` | `{memoryId, revisionId}` |
| 其余十项 | 去除 Envelope wrapper 后的 canonical result |

每项 projection 都有闭合的 `agentOutputSchema` 和 golden fixture；对象外字段被拒绝。边界规则
只防止透传 Envelope-owned `contractVersion`、`ok`、`operation`、`requestId`、`receipt` 和
`result` wrapper，不对业务 JSON 做全局递归禁字段扫描。业务结果中的同名字段若由其自身 schema
定义，仍然有效。`false`、`null`、空数组、截断和 cursor 等业务信息不得为了观测压缩率被删除。

完整 Envelope 只保留在 Core IPC、Evidence、Qualification 和 host-controlled debug；不存在
Agent 可控的 envelope output mode、环境变量、隐藏 flag 或 `--full`。

## Runtime process、Lease 与 Camp scope

每个受管 Runtime 根进程拥有稳定 process identity 和私有 CLI context path。Fleet acquire 为
当前 `(agentRunId, executionEpoch)` 轮换 active lease，Core 在输入投递前完成绑定和 CLI preflight。
release 顺序固定为：

```text
stop accepting new Runtime work
  → fence Built-in Tool Lease
  → wait/verify Runtime + CLI quiescence
  → IdleWarm when reusable, otherwise stop and reap
```

Lease/Context 不携带 Agent 可选的 Camp ID。`camp.message.send` 的 Camp 只由

```text
Lease → AgentRun + executionEpoch + NativeBinding
      → resolve_sender_identity()
      → authenticated current Camp
```

推导。首次调用将它写入内部 `CampMessageSendCommand.camp_id`；持久 Replay 读取已记录的
`camp_id + source AgentRun + executionEpoch`，不重新使用当前活跃身份。其他跨 Camp read 工具的
显式 `campId` 仍由各自领域合同控制。

### 新 Session

1. Adapter/Fleet 启动或取得独占 Runtime process；
2. Core 绑定新 active lease，并写 process-private context；
3. Adapter 建立 Native Session 并投递固定命令 Bootstrap；
4. Core materialize ContextManifest，随后投递 Current Input；
5. Agent 使用固定命令和 command-local `--help`；Router 从 lease 解析当前 Run 与 Camp。

### Resume / Resident process reuse

Resume 重新投递稳定 Bootstrap，但不改变 catalog 真源；新 Run 必须获得新 lease。兼容 IdleWarm
process 被新 Run acquire 后轮换 lease，再绑定新的 Session/Run route。任何旧 lease、迟到 callback
或旧 request 都 fail closed。Core restart 不接管旧 process context。

## Bootstrap 与 Dynamic Context

Session Charter 只说明：

- 使用 bundled `rovai`；
- 固定业务命令和 `<command> --help`；
- `camp.message.send` 使用当前 Run Camp，不能传入 Camp ID；
- Task、Public Message、Message Delivery、Memory 和 read 工具的稳定业务原则；
- Dynamic Context 可能截断，应遵循 canonical `retrieveWith`；公共 A2A 遵循 Profile v2 的 bounded
  reference closure。

Bootstrap 不含完整 Schema、Envelope、receipt、catalog digest、socket、process token、lease、
AgentRun ID、epoch、Camp ID 或 Native Binding ID。Dynamic Context 使用 `retrieveWith.operation`
指向 canonical operation，不重复 transport 细节。

## Built-in CLI 与外部 MCP

```text
Rovai-owned operations ── rovai CLI ── Core Router
user-configured MCP    ── Runtime-native MCP Projection
```

两条路径不共享 catalog、授权、receipt、生命周期或代理层。外部 MCP 继续由 Library、Assignment、
Projection 和 Exposure Snapshot 管理；built-in operations 永不进入 `McpProjectionInput`、
Runtime MCP config 或 MCP runtime-name mapping。`rovai_team` 没有保留语义，同名外部 Server 只是
普通第三方 MCP。

## Activity、Evidence 与故障边界

Core 为每次已验证调用创建 canonical Built-in Tool Activity。若 Runtime Shell Evidence 与
request/receipt 有显式可验证关联，它作为同一 Activity 的 supporting Evidence；否则保留为独立
Activity。命令文本、时间、cwd 或输出相似度不能建立关联。Shell 子进程共享当前 Run 身份，但
系统不声称能够证明模型主观意图。

- CLI 参数或输入来源错误：Agent stdout 使用 `builtin_tool.invalid_input` + `fix_input`，退出码
  `2`；其他 IPC/lease/catalog preflight 失败使用安全通用 structured error，退出码 `2`；
- Core 业务拒绝：完整 Envelope 记录在 Core/Evidence，Agent stdout 输出业务 `error`，退出码 `1`；
- 响应丢失：CLI 对同一 request identity 有界重试，Core 执行 Replay；Projection 不暴露 request
  identity；
- 无法证明 mutation 结果：Agent 只收到无 request identity 的 `builtin_tool.outcome_indeterminate`，
  退出码 `3`，必须先确认当前状态；
- `camp.message.send` 的内部 Camp 不变量失败：fail closed，不加入稳定 Agent error contract；
- external MCP 失败：遵循其独立 non-blocking degradation，不回退为 built-in MCP；
- 任一正式 Runtime 未通过 v3 command、projection、replay、fence 和 negative-path 验收：版本不
  得完成。
