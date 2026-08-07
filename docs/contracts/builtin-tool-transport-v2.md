---
document_type: protocol-contract
contract: builtin-tool-transport-v2
authority: builtin-tool-wire-contract
status: accepted
last_updated: 2026-08-07
---

# Built-in Tool Transport v2 Contract

v0.45 对 Rovai-owned built-in operation 做 clean break。Envelope、receipt、错误 recovery、
active lease、Unix IPC 和 CLI 输入来源沿用
[Built-in Tool Transport v1](builtin-tool-transport-v1.md) 的字段级规则；本合同把 catalog
major version 提升到 `2`，并明确移除旧的私有 Member Call operation。任何未在本合同列出的
旧 operation/alias 都必须 fail closed。

## 1. 版本与 catalog

```yaml
contractVersion: 2
ipcProtocolVersion: 1
envelopeContractVersion: 1
receiptVersion: 1
cliCommandVersion: 2
```

`catalogDigest` 重新覆盖以上常量、v2 operation definitions、参数 schema、错误和 Envelope
合同。Canonical operation 的名称、参数含义、授权身份或互斥规则发生变化时不得继续声称
v1 catalog 兼容。

## 2. v0.45 operation 变更

| CLI command | Canonical Operation | 说明 |
| --- | --- | --- |
| `rovai send` | `camp.message.send` | 提交一条公共 A2A Message，并原子创建 `0..N` Deliveries |
| `rovai task create` | `team.create_task` | 沿用 v1 |
| `rovai task list` | `team.list_tasks` | 沿用 v1 |
| `rovai task update` | `team.update_task` | 沿用 v1 |
| `rovai camp list/search/read` | `camp.list` / `camp.search` / `camp.read` | 沿用 v1 |
| `rovai history search` | `history.search` | 沿用 v1 |
| `rovai memory search/read/write/propose-hearth` | 对应 v1 canonical operation | 沿用 v1 |

以下名称在 v2 catalog 中不存在，不提供 alias 或 silent translation：

```text
rovai member call
team.call_member
private A2A send
```

`camp.message.send` 的业务字段、recipient resolution、fanout、lineage、错误和 retry 规则以
[Camp Message Send v1](camp-message-send-v1.md) 为准；它不是 Renderer 或 Adapter 的私有 API。

## 3. 继承的运输边界

- CLI 仍只负责 direct flag/stdin/file 的 canonical JSON 解析、IPC、输出和有界运输重试；
- Core Router 仍是 lease 解析、Envelope、receipt、replay、错误和 Activity 的唯一生成者；
- `requestId` 由 transport 为每次业务意图生成，传输重试复用相同 requestId 与 canonical input；
- v1 的 `ok=true`/`ok=false` 互斥结构、error recovery 闭集、receipt preimage 和 secret
  redaction 继续有效；
- v2 catalog 不进入 Runtime-native MCP，也不允许 Adapter 维护别名表。

## 4. 发现与失败

`rovai tool list` 返回 `contractVersion: 2` 与 v2 `catalogDigest`；
`rovai tool describe camp.message.send` 返回业务 schema。Agent 收到未知 operation 或旧
command 错误时必须停止该调用、阅读错误并使用当前 catalog 重新决定，不能自动换成旧私有
路径。
