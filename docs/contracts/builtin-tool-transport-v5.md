---
document_type: contract
contract: builtin-tool-transport-v5
status: accepted
target_version: v0.54
last_updated: 2026-08-10
---

# Built-in Tool Transport v5

v5 是 v0.54 当前 CLI/Core Transport 合同。它保留 v4 的十三项固定业务命令、Unix IPC、完整 Core
Envelope、receipt、Replay、Agent Output v2、process-scoped lease 与单 JSON stdout 边界，并以
[Durable Task v3](durable-task-v3.md) 替换全部 Task authority、schema 与 help。v4 及更早版本不作为
当前 parser 或恢复入口。

## 固定命令

```text
rovai send
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory search|read|write|propose-hearth
```

不存在 Agent discovery API、通用 invoke、`--full` 或可切换旧合同的 flag。`<command> --help` 是唯一
命令发现入口；catalog 继续服务 Core 校验、Qualification 和开发证据，不授予调用 authority。

## Task v3 transport

- `task create` 必须提供 `--assignee-agent-id`；help 明确只有 User/Default Lead 定义责任，并完整承载
  creation restraint。静态 catalog 可以向普通 Agent 描述命令，但 Core 最终返回
  `task.create_forbidden`。
- `task get` 对当前 Camp 全量可读，返回完整 `TaskDetail` 与 version。
- `task list` 对当前 Camp 全量可读，每项严格为
  `taskId/title/status/assigneeAgentId/availableActions`。
- `task update` 使用 `expectedVersion`。`assigneeAgentId` 不接受 `null`；release 使用显式
  `clearAssignee`。list 的 unassigned filter 使用显式 `unassignedOnly`。
- `availableActions` 只允许 `update`，并且只是 advisory metadata。Core authorization 和字段级
  mutation rules 才是权威。

Task mutation Agent Output 保持显式 projection：Create/Update 返回 compact identity、状态、Assignee、
version、changed（Update）和 actions；Get 返回完整 detail；List 返回 compact page。CLI 不在 commit
后二次读取 live Task，也不从 `availableActions` 推导授权。

## 版本与错误

`BUILTIN_TOOL_CONTRACT_VERSION = 5`，`BUILTIN_TOOL_CLI_COMMAND_VERSION = 5`。Envelope/receipt/IPC 与
Agent Output envelope 轴保持各自现有版本。业务拒绝继续通过成功 Transport Envelope 中的 domain
result 表达；malformed input、credential/lease/fence、IPC 与 envelope failure 使用 transport error
channel。Retry 只适用于 v5 定义的安全运输窗口，不能绕过 Domain Gateway 幂等与版本栅栏。
