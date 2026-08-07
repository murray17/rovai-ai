---
document_type: protocol-contract
contract: builtin-tool-transport-v1
authority: builtin-tool-wire-contract
status: accepted
last_updated: 2026-08-07
---

# Built-in Tool Transport v1 Contract

> 历史基线：v0.45 当前 catalog 已升级到
> [Built-in Tool Transport v2](builtin-tool-transport-v2.md)。本文保留 v1 的运输字段和历史
> operation 语义，不构成当前 Agent 可用的 `team.call_member` 或 `rovai member call` 兼容入口。

本文件是 Rovai-owned built-in operations 的唯一字段级协议真源。实现、fixture、CLI `tool
describe`、Bootstrap 示例和版本验收必须引用或由本合同生成，不能各自维护变体。

长期架构见 [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)，决策理由见
[ADR-0124](../adr/0124-cli-only-transport-for-rovai-built-in-operations.md)。

## 1. 版本常量

| 名称 | v1 值 | 参与 `catalogDigest` |
| --- | --- | --- |
| `contractVersion` | `1` | 是 |
| `ipcProtocolVersion` | `1` | 是 |
| `envelopeContractVersion` | `1` | 是 |
| `receiptVersion` | `1` | 是 |
| `cliCommandVersion` | `1` | 是 |

未知 major version 必须 fail closed。增加可选字段且旧消费者可以安全忽略时可以保持 major；
改变字段含义、canonical operation、receipt preimage、授权身份或互斥规则必须提升 major。

`catalogDigest` 是以下 canonical JSON 的 SHA-256：版本常量、按 canonical operation 排序的
operation 定义、CLI command、直接参数定义、`inputSchema`、`resultSchema`、稳定错误合同和
Envelope 合同。摘要格式为 `sha256:<lowercase-hex>`。

## 2. Operation 与 CLI command

Canonical Operation 是 Core、Dynamic Context、request、receipt、审计和 Activity 的唯一语义
身份。CLI command 是稳定的一对一 presentation：

| CLI command | Canonical Operation |
| --- | --- |
| `rovai member call` | `team.call_member` |
| `rovai task create` | `team.create_task` |
| `rovai task list` | `team.list_tasks` |
| `rovai task update` | `team.update_task` |
| `rovai camp list` | `camp.list` |
| `rovai camp search` | `camp.search` |
| `rovai camp read` | `camp.read` |
| `rovai history search` | `history.search` |
| `rovai memory search` | `memory.search` |
| `rovai memory read` | `memory.read` |
| `rovai memory write` | `memory.write` |
| `rovai memory propose-hearth` | `memory.propose_hearth` |

`rovai tool call` 不存在。`rovai tool list` 和 `rovai tool describe <canonical-operation>` 仅用于
发现。每个业务命令另提供由同一 catalog 生成的 `--help`。

## 3. CLI 输入

一次调用从且只从一种来源构造一个 canonical JSON object：

1. 按 catalog 声明的 kebab-case 直接参数；
2. 非交互 stdin 中的一份 JSON object，pipe 与 heredoc 等价；
3. `--input-file <path>` 中的一份 JSON object。

数组参数可重复；布尔参数按 catalog 定义；未知参数、重复单值参数、多个来源、空或非 object
JSON 均在连接 Core 前失败。直接参数只是 canonical schema 的 CLI projection，不是另一套
业务 Schema。长消息、Task 描述和 Memory 正文推荐 `--input-file`；短查询、ID、状态和分页
参数推荐直接传递。

CLI 读取文件后只发送 JSON，IPC 不包含文件路径。输入方式不构成保密边界：argv、heredoc、
文件创建命令和 Runtime stdout 都可能进入 Runtime Evidence。

## 4. Discovery

### 4.1 `rovai tool list`

标准输出：

```json
{
  "contractVersion": 1,
  "catalogDigest": "sha256:…",
  "operations": [
    {
      "name": "team.call_member",
      "command": ["member", "call"],
      "summary": "Request work from another active Camp member"
    }
  ]
}
```

Operations 按 canonical name 排序。所有 eligible Member 收到完全相同的十二项目录。

### 4.2 `rovai tool describe`

标准输出：

```json
{
  "contractVersion": 1,
  "catalogDigest": "sha256:…",
  "name": "team.update_task",
  "command": ["task", "update"],
  "summary": "Update a durable Camp Task",
  "arguments": [],
  "inputSchema": {},
  "resultSchema": {},
  "errors": [],
  "envelopeContract": {
    "version": 1,
    "schema": {}
  }
}
```

`arguments` 明确每个 direct flag、canonical JSON field、value kind、是否可重复和是否必填。
Schema 与错误定义来自同一 catalog；CLI 或 Adapter 不得手写副本。

## 5. Canonical Operation Result

Canonical Operation Result 是运输无关的扁平业务对象。它保留既有业务字段，不包含：

- `rovaiTeamTool`；
- `rovaiTeamReceipt`；
- `ok`、`operation`、`requestId`、`receipt`；
- CLI、IPC、MCP 或 Runtime Adapter 字段。

结果不得新增 `result.task` 等运输驱动的嵌套。业务字段与语义保持兼容，不承诺完整输出字节结构
与旧 MCP `structuredContent` 相同。

## 6. Built-in Tool Invocation Envelope

Core Router 是 Envelope 与 receipt 的唯一生成者。成功：

```json
{
  "contractVersion": 1,
  "ok": true,
  "operation": "team.update_task",
  "requestId": "7b5db24c-4a43-4cab-9217-d982b08f7691",
  "receipt": "sha256:…",
  "result": {
    "taskId": "task-18",
    "version": 4,
    "status": "completed"
  }
}
```

拒绝：

```json
{
  "contractVersion": 1,
  "ok": false,
  "operation": "team.update_task",
  "requestId": "7b5db24c-4a43-4cab-9217-d982b08f7691",
  "receipt": "sha256:…",
  "error": {
    "code": "task.version_conflict",
    "message": "Task changed; read the current Task before deciding whether to update it.",
    "recovery": "refresh_then_decide",
    "details": {
      "currentVersion": 4
    }
  }
}
```

`ok=true` 必须有且只有 `result`；`ok=false` 必须有且只有 `error`。`receipt` 只证明 Core 对本
Envelope 的提交或权威拒绝，不证明 Agent 的工程工作已经完成。

## 7. Error 与 recovery

```text
error.code       stable namespaced identifier
error.message    concise, safe, Agent-readable text
error.recovery   one of the closed values below
error.details    optional allowlisted business fields
```

`recovery` 闭集：

| 值 | Agent 行为 |
| --- | --- |
| `fix_input` | 修正明确字段后使用新的 requestId 调用 |
| `refresh_then_decide` | 重新读取对象、比较变化，再决定是否使用新的 requestId 修改 |
| `retry_same_request` | CLI 可以用相同 requestId 有界重试 |
| `stop` | 不重试该操作 |
| `confirm_outcome` | 显示“结果待确认”，禁止盲目创建新请求 |

乐观锁冲突必须是 `refresh_then_decide`。异常堆栈、SQL、内部路径、socket、token、lease secret
和未经筛选的底层错误不得进入 `message` 或 `details`。CLI 本地解析错误和无法取得 Core 响应的
运输错误不伪装成 Core Envelope；后者单独输出 `outcome=indeterminate` 与“结果待确认”。

## 8. requestId、重放与 receipt

CLI 为每次新的业务意图生成 UUID requestId；模型、输入文件和直接参数不能提供 requestId。
运输重试复用同一 requestId 和完全相同的 canonical input。Core 按以下 identity 识别调用：

```text
(agentRunId, executionEpoch, requestId)
```

相同 identity + 相同 operation/input 返回原 Envelope，不重复副作用；相同 identity + 不同
operation/input 返回 `builtin_tool.idempotency_conflict`。Mutation 还必须使用既有
DomainCommandGateway durable replay；Read 可以在当前 active lease 的有界 replay cache 中重放。
无法用 replay 或权威领域状态证明结果时返回/呈现 `confirm_outcome`，不得自动换 requestId。

Receipt 是以下 canonical JSON 的 SHA-256：

```json
{
  "domain": "rovai.builtin-tool-receipt.v1",
  "contractVersion": 1,
  "operation": "…",
  "requestId": "…",
  "ok": true,
  "resultOrError": {}
}
```

摘要格式为 `sha256:<lowercase-hex>`。Receipt 不是授权 token，不作为下一次请求输入。

## 9. CLI Context 与 active lease

Runtime 根进程只接收以下环境引用：

```text
ROVAI_AGENT_CLI=/absolute/path/to/rovai
ROVAI_CLI_CONTEXT=/private/process/context.json
ROVAI_RUN_TMP=/private/process/run-tmp
PATH=<rovai-directory>:<existing-path>
```

`ROVAI_CLI_CONTEXT` 是 mode `0600` 的 Rovai-owned JSON：

```json
{
  "contractVersion": 1,
  "ipcProtocolVersion": 1,
  "coreSocket": "/private/path/builtin-tool.sock",
  "processId": "runtime-process-id",
  "processToken": "opaque",
  "lease": {
    "leaseId": "opaque",
    "leaseGeneration": 3,
    "leaseToken": "opaque"
  }
}
```

`processId/processToken` 只证明 Core-managed process。每次 Fleet acquire 生成新的 lease；release
先使 lease 失效并把 context 写成 `lease: null`，再进入 IdleWarm。Core 只从当前 lease 解析
AgentRun、execution epoch、Camp、Member、Native Binding 和 Context fence。CLI/模型不得提交
这些领域身份。Core restart 使所有 context 与 lease 失效。

Shell 运输无法证明模型意图：当前 Runtime 及其子进程持有相同 lease，所有有效调用归属于该
AgentRun。Adapter 只有在 Runtime、CLI 和后代调用均 quiescent 时才允许进程复用；不能证明时
必须停止进程。

## 10. IPC

Unix domain socket 使用单行 UTF-8 JSON request/response，单条 request 最大 1 MiB。Invoke：

```json
{
  "ipcProtocolVersion": 1,
  "kind": "invoke",
  "processId": "…",
  "processToken": "…",
  "leaseId": "…",
  "leaseGeneration": 3,
  "leaseToken": "…",
  "requestId": "…",
  "operation": "memory.write",
  "input": {}
}
```

List 与 describe 使用相同 process/lease 证明；`kind` 分别为 `list` 与 `describe`，describe 另带
`operation`。成功 response 为带 `kind` 的 `catalog`、`description` 或 `envelope`。协议解析、
版本、lease、catalog 或大小失败返回稳定 IPC error，绝不进入领域 Router。

CLI 默认对连接/读取中断使用相同 request 最多重试两次。标准输出只写成功 discovery document
或 Core Envelope；诊断写 stderr。业务成功退出码 `0`，Core 拒绝 `1`，CLI 使用错误 `2`，结果
待确认 `3`。

## 11. 删除的合同

v1 不包含 `rovai_team` MCP Server、MCP aliases、MCP schema dialect、Antigravity attachment、
内置 MCP permission bundle 或 `mcp_legacy`。用户外部 MCP 继续使用 Runtime-native Projection，
不进入本协议。
