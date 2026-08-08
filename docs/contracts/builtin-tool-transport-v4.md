---
document_type: protocol-contract
contract: builtin-tool-transport-v4
authority: builtin-tool-wire-contract
status: accepted
version: 4
last_updated: 2026-08-08
---

# Built-in Tool Transport v4 Contract

v0.47 keeps the Core-owned Envelope、IPC、receipt 与显式 Agent Result Projection 架构，并以
clean break 引入 Durable Task v2、`team.get_task` 和第十三项固定业务命令。v0.46 的
[Transport v3](builtin-tool-transport-v3.md) 是 historical 合同；v4 不接受 v3 catalog、CLI、
Runtime capability、Agent output schema 或 Task shape，也不提供翻译层。

[Camp Message Send v2](camp-message-send-v2.md) 的 Camp identity、A2A 与 replay 业务语义继续
成立；其中指向 Transport v3 的历史 transport 说明由本合同在 v0.47 当前入口局部替代。

## 1. 版本身份

v0.47 使用以下精确矩阵：

```yaml
dataContractVersion: v0.47
contractVersion: 4
cliCommandVersion: 4
agentOutputContractVersion: 2
runtimeCapability: builtin_cli.transport.v4
ipcProtocolVersion: 1
envelopeContractVersion: 1
receiptVersion: 1
campSnapshotSchemaVersion: 25
builtinOperationCount: 13
```

`contractVersion` 标识 catalog/CLI 合同。`ipcProtocolVersion`、`envelopeContractVersion` 和
`receiptVersion` 保持 v1，因为 Core IPC Envelope 与 receipt preimage 形状不变。Task 的
canonical result 改变且 Agent stdout projection 扩展，所以 Agent output contract 升为 v2。
CampSnapshot 随 Task v2 Read Side 升为 schema version 25；Related execution 只从 Snapshot
已经拥有的 AgentRun/Delivery identity 关系派生，不向 TaskRecord 增加执行关系字段。

`catalogDigest` 必须覆盖上述全部常量、十三项 operation 的 canonical name、CLI mapping、
input schema、canonical result schema、`agentOutputSchema`、projection identity、Tool
Description 与 error contract。App 接受 Agent input 前必须把 Runtime、process、lease、CLI
context 和 catalog 绑定到同一 v4 identity。

## 2. 权威与处理路径

| 层 | 权威 |
| --- | --- |
| Core IPC | 完整 `BuiltinToolInvocationEnvelope`，返回 client 前先校验 |
| Core catalog | operation、input/result schema、`agentOutputSchema`、projection、errors、CLI mapping、digest 的唯一真源 |
| Domain service | Task/Message/Memory/Camp 的可见性、授权、状态、容量、事务和 canonical result |
| CLI | 解析单一输入来源、发送认证 IPC、校验完整 Envelope、应用指定 projection、打印一个 JSON 文档 |
| Agent Runtime | 只看到固定业务命令、简短 help、projected result 与 projected error |
| Evidence / Qualification / host debug | 可通过 host-controlled 路径保留完整 Envelope、request identity、receipt 与 canonical result |

唯一正常 Agent success path 是：

```text
canonical domain result
  → complete Core Invocation Envelope
  → envelope.validate()
  → explicit operation Agent Result Projection
  → one JSON document on stdout
```

Projection 不参与授权、receipt、command result 持久化或 Replay 决策。CLI 不是领域 handler，
不得在本地修补 Task final state、重算 availableActions 或以第二次 live read 拼接 mutation 结果。

## 3. Core IPC Envelope

Core IPC 延续 Envelope v1。Success 示例：

```json
{
  "contractVersion": 1,
  "ok": true,
  "operation": "team.update_task",
  "requestId": "uuid",
  "receipt": "sha256:…",
  "result": {
    "taskId": "task_123",
    "campId": "camp_1",
    "title": "完成发布说明",
    "description": "汇总本版本改动",
    "acceptanceCriteria": ["列出兼容性变化"],
    "status": "in_progress",
    "assigneeAgentId": "agent_27",
    "blockedReason": null,
    "completionSummary": null,
    "cancelReason": null,
    "createdByType": "user",
    "createdById": "user_local",
    "sourceAgentRunId": null,
    "closedByType": null,
    "closedById": null,
    "closedByAgentRunId": null,
    "version": 3,
    "createdAt": "2026-08-08T10:00:00Z",
    "updatedAt": "2026-08-08T10:05:00Z",
    "closedAt": null,
    "availableActions": ["update"],
    "changed": true
  }
}
```

Business rejection 使用 `ok: false` 且以 `error` 替代 `result`。完整 Envelope 必须先校验
operation、UUID request identity、result/error 互斥、对应 canonical result/error shape 和
receipt preimage，再进入 projection。

Catalog materialization、完整描述和 Envelope 诊断只允许 Qualification、contract tooling 与
host-controlled debug 使用，不构成 Agent-facing discovery，也不能经隐藏 executable alias 访问。

## 4. 十三项固定业务命令

| Agent command | Canonical operation |
| --- | --- |
| `rovai send` | `camp.message.send` |
| `rovai task create` | `team.create_task` |
| `rovai task get` | `team.get_task` |
| `rovai task update` | `team.update_task` |
| `rovai task list` | `team.list_tasks` |
| `rovai camp list` | `camp.list` |
| `rovai camp search` | `camp.search` |
| `rovai camp read` | `camp.read` |
| `rovai history search` | `history.search` |
| `rovai memory search` | `memory.search` |
| `rovai memory read` | `memory.read` |
| `rovai memory write` | `memory.write` |
| `rovai memory propose-hearth` | `memory.propose_hearth` |

不增加 `task complete/claim/block/cancel/delete`。这些 Task 状态变化和原子 claim 都通过
`rovai task update` + `expectedVersion` 完成。

CLI 没有 Agent-facing `rovai tool list`、`tool describe`、隐藏 discovery、`tool invoke` 或
`tool call`。Dotted operation 是 Core identity，不是 generic command。`<command> --help` 只列
必要 flags、输入来源互斥、关键限制和短示例，不输出完整 JSON Schema、Envelope、receipt、
catalog digest 或错误全集。

每次调用只能选择一个输入来源：direct flags、stdin/heredoc 中一个 JSON object，或
`--input-file <path>`；CLI 不合并来源。Task operation 的字段和约束以
[Durable Task v2](durable-task-v2.md)为唯一领域合同。

## 5. Agent Result Projection v2

### 5.1 边界规则

Agent success 是直接业务对象，不是缩小版 Envelope。Agent business failure 保持：

```json
{
  "error": {
    "code": "task.version_conflict",
    "message": "Task changed; read the current Task before deciding whether to update it.",
    "recovery": "refresh_then_decide",
    "details": {"currentVersion": 4}
  }
}
```

Envelope → Agent 边界不得透传 Envelope-owned `contractVersion`、`ok`、`operation`、
`requestId`、`receipt` 或 `result` wrapper。该规则只约束 Envelope 字段，不是递归业务字段
黑名单。

每项 operation 都必须有闭合的显式 `agentOutputSchema`，合同覆盖的 object boundary 使用
`additionalProperties: false`，并具有 Envelope → Agent success golden fixture。CLI 在输出前
校验 projection。不得用 generic recursive deletion、同名字段扫描或“压缩率”猜测字段。

业务上有意义的 `false`、`null`、`[]`、cursor、truncation 与 incompleteness 标记必须按
operation schema 保留。

### 5.2 Task projection

Core canonical result 始终保留 Durable Task v2 完整精确快照；Task create/update 的 Agent
stdout 有意缩小：

```ts
type TaskCreateAgentOutput = {
  taskId: string;
  title: string;
  status: TaskStatus;
  assigneeAgentId: string | null;
  version: number;
  availableActions: TaskAction[];
};

type TaskUpdateAgentOutput = TaskCreateAgentOutput & {
  changed: boolean;
};
```

`team.get_task` 返回完整 `TaskDetail`；`team.list_tasks` 返回完整紧凑 `TaskListPage`。Create /
update stdout 不回显 description、Acceptance Criteria、状态说明、creator、source Run 或
Closure Metadata，但 Core Envelope、command result、receipt 和 Replay 仍使用完整 canonical
result。

### 5.3 Operation projection matrix

| Operation | Agent success projection | Rule |
| --- | --- | --- |
| `camp.message.send` | `{messageId, effectiveRecipients}` | 延续 Send v2 的显式 projection，保留实际冻结 recipient 集合，包括 `[]`。 |
| `team.create_task` | `{taskId, title, status, assigneeAgentId, version, availableActions}` | 从本次提交的完整 `TaskDetail` 显式选择。 |
| `team.get_task` | 完整 `TaskDetail` | 已知 Task 的全量内容与最新 version。 |
| `team.update_task` | `{taskId, title, status, assigneeAgentId, version, changed, availableActions}` | 从同一事务持久的 canonical result 显式选择；保留 no-op 的 `changed: false`。 |
| `team.list_tasks` | 完整 `TaskListPage` | 保留 preview、count、cursor、truncated、nullable fields 与 actions。 |
| `camp.list` | v3 canonical result | 业务 shape 未改变。 |
| `camp.search` | v3 canonical result | 业务 shape 未改变。 |
| `camp.read` | v3 canonical result | 业务 shape 未改变。 |
| `history.search` | v3 canonical result | 业务 shape 未改变。 |
| `memory.search` | v3 canonical result | 业务 shape 未改变。 |
| `memory.read` | v3 canonical result | 业务 shape 未改变。 |
| `memory.write` | `{memoryId, revisionId}` | 延续显式 v3 projection。 |
| `memory.propose_hearth` | v3 canonical result | 业务 shape 未改变。 |

Matrix 是规范规则，不是 heuristic。任何 projection 变化都必须更新 catalog 的
`agentOutputSchema`、projection identity、golden fixture 与本合同的新版本。

### 5.4 Error projection

Business errors 保留合同要求的 `code`、safe `message`、`recovery`，只在对应 operation error
schema 明确允许时保留安全 `details`。Recovery vocabulary 仍闭合为：

```text
fix_input
refresh_then_decide
retry_same_request
stop
confirm_outcome
```

Durable Task v2 第 10 节定义 Task error boundary。`task.not_found` 必须合并 missing、cross-Camp
和 invisible；`task.version_conflict` 只能在调用者已经通过 visibility 后返回。Task v2
projected-state validation 不得把当前隐藏状态塞进 error details。

## 6. stdout、stderr 与 exit code

| 情况 | stdout | exit |
| --- | --- | ---: |
| Projected business success | 一个直接 operation result JSON | `0` |
| Authoritative business rejection | `{"error":{"code","message","recovery",…}}` | `1` |
| `builtin_tool.outcome_indeterminate` | 稳定脱敏 error；无 operation/request identity | `3` |
| CLI 参数、来源或 schema 无效 | `builtin_tool.invalid_input` + `fix_input` | `2` |
| 可预期 context/IPC/protocol failure | 安全通用 structured error | `2` |
| 非结构化 process-level failure | 不承诺 JSON；stderr 可含脱敏诊断 | process-specific nonzero |

Indeterminate projection 精确为：

```json
{"error":{"code":"builtin_tool.outcome_indeterminate","message":"Confirm current state before acting again.","recovery":"confirm_outcome"}}
```

它不暴露 `requestId`。Stderr 不得包含 socket/context path、process/lease token、binding
credential、SQL 或未过滤 error chain。

## 7. Receipt、Replay 与 mutation snapshot

Core 对完整 canonical outcome 计算 receipt。Transport retry 与 durable Replay 在内部返回相同
完整 Envelope；只有 Envelope 通过校验后才重新应用 projection。Projection 不能创建第二次
副作用，也不能改变 idempotency identity。

Task create/update 的完整 `TaskDetail` 必须在领域 mutation 事务内形成并作为 command result
持久化。Replay 返回原版本和原 `availableActions`/`changed` 事实，不重新读取 live Task。完整
Envelope 只保留在 Core IPC、Evidence、Qualification 与 host-controlled debug；不存在
Agent-controlled `--full`、output mode 或环境变量。

## 8. Bootstrap、Runtime capability 与 preflight

Session Charter / Bootstrap 只说明：

- 使用 bundled `rovai` 和十三项固定命令；
- 以 `<command> --help` 查看必要参数；
- `rovai send` 的 Camp 来自当前 Run，不能输入 Camp ID；
- Task mutation 不通知、不启动，Task list/get 不等待、不轮询；
- Dynamic Context 可能截断，应遵循 canonical `retrieveWith`。

Bootstrap 不含完整 schema、Envelope、receipt、digest、socket、lease、AgentRun ID、epoch、
Camp ID 或 Native Binding ID。

Fleet 在接收 Agent input 前必须证明 bundled CLI 报告 `contract-v4 ipc-v1`，Runtime capability
精确为 `builtin_cli.transport.v4`，catalog digest 与 Core 一致，十三项 command preflight 全部
通过。v3 process、stale lease 或旧 CLI context 必须 fail closed，不能在同一 Runtime session
内升级或降级。

## 9. Clean break 与兼容性

v0.47 不接受或翻译：

- v3 `contractVersion`、`cliCommandVersion`、`agentOutputContractVersion` 或 Runtime capability；
- 十二项 catalog 与缺少 `rovai task get` 的 Bootstrap/help；
- v0.46 四态 Task input/result/list shape、动态 `claim:<agentId>` action 或旧 replay；
- 混用 v4 CLI 与 v3 Core，或 v3 CLI 与 v4 Core；
- Agent-facing discovery、generic invoke alias、Envelope output mode 或旧 send Camp input。

Rovai-owned App data 按
[ADR-0118](../adr/0118-v041-local-data-clean-break-and-managed-reset-boundary.md)执行一次受管
clean reset；用户 workspace、外部 Runtime Home/config/credentials 与外部 MCP state 不在
清理范围。

Envelope v1、receipt v1、IPC v1 与 Camp Message Send v2 的业务语义保持不变，不表示允许
v3/v4 混跑。外部 MCP 继续经 Runtime-native Projection，永不进入 Built-in catalog。

## 10. 验收边界

发布必须证明：

1. catalog 恰好 13 项，所有版本常量、digest、help 和 Runtime capability 一致；
2. 十三项 closed input/result/Agent output schema 与 golden fixture 通过；
3. Task create/update 的 Core Envelope 保留完整 snapshot，stdout 只含本合同字段；
4. Task get 返回完整 `TaskDetail`，list 返回专用 compact page，缺失/越权 get 不可区分；
5. no-op、version conflict、command Replay、response loss 和 stale lease 不产生第二次 mutation；
6. 九种正式 Runtime 通过 v4 command、projection、replay、fence 与 negative-path smoke；
7. 打包 App 只包含 v4 Core/CLI/catalog，不保留 v3 translation 或 dual-mode 分支。

序列化字节缩减比例仍只作为 observability metric，不是发布门槛，也不能驱动业务字段删除。

## References

- [Durable Task v2](durable-task-v2.md)
- [Built-in Tool Transport v3 (historical)](builtin-tool-transport-v3.md)
- [Camp Message Send v2](camp-message-send-v2.md)
- [ADR-0135: Compact Agent Output over Canonical Built-in Tool Envelope](../adr/0135-compact-agent-output-over-canonical-built-in-tool-envelope.md)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](../adr/0124-cli-only-transport-for-rovai-built-in-operations.md)
- [v0.47 version overview](../versions/v0.47/README.md)
