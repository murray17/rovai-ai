---
document_type: contract
contract: builtin-tool-transport-v11
status: accepted
target_version: v0.78
last_updated: 2026-08-14
---

# Built-in Tool Transport v11

v11 完整替代 [Built-in Tool Transport v10](builtin-tool-transport-v10.md)。Unix IPC、Core Envelope、receipt、
Replay、Agent Output v2、process lease、single-JSON stdout、Task v3、Camp Message Send v7、progressive help 和
既有十二项 command 语义保持。v11 新增第十三项 `memory.view`，并把 Read/Revise 的 Memory identity 收敛为
一个 copyable target。

## Fixed commands and versions

```text
rovai send
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory view|search|read|write
```

固定集合为十三项；没有 generic discovery、`memory.propose_hearth` 或 family help alias。

```text
BUILTIN_TOOL_CONTRACT_VERSION = 11
BUILTIN_TOOL_CLI_COMMAND_VERSION = 11
Runtime capability = builtin_cli.transport.v11
IPC protocol = 1
Envelope = 1
receipt = 1
Agent Output = 2
```

v10 或更早 capability 不能满足 v11 Binding compatibility。Catalog digest 继续覆盖 descriptions、closed
input/output schema、CLI mapping、error contract 与 Agent projection。所有 Adapter 从同一常量生成 context 和
capability，不允许同一 App process 暴露 mixed v10/v11 surface。

## `memory.view`

CLI mapping：

```text
memory.view -> rovai memory view
```

精确 help 至少展示 `--scope hearth|companion|relationship`；Relationship input 还要求
`--counterparty-agent-id`，也可使用 stdin 或 `--input-file` 的 closed JSON。输入来源继续互斥。

Canonical result 与 Agent projection identity 都是 `canonical-result-v1`，即去除 Envelope wrapper 后保留
完整 typed result：

```json
{
  "scope": "companion",
  "complete": true,
  "itemCount": 1,
  "totalBodyBytes": 42,
  "items": [
    {
      "target": {
        "memoryId": "memory_123",
        "revisionId": "revision_456",
        "scope": "companion"
      },
      "kind": "lesson",
      "retrievalKeys": ["恢复边界"],
      "body": "恢复前验证冻结输入。",
      "agentCanRevise": true
    }
  ]
}
```

成功 schema 不允许 cursor、truncated、partial 或 Envelope-owned fields。Domain error
`memory.view_unavailable` 的 recovery 为 `stop`；transport invalid input 仍使用
`builtin_tool.invalid_input/fix_input`。

## Memory Read and Write

Authorized body-bearing `memory.read` member 必须包含 `target` 与 `agentCanRevise`；body-free stale/unavailable
member 只含 `memoryId + cacheState`。Search 保留 v10 flat Scope discovery metadata。

Revise closed shape 为三个 target variants：

```text
Companion/Hearth:
  action + target(memoryId, revisionId, scope) + body + retrievalKeys

Relationship:
  action + target(memoryId, revisionId, scope=relationship,
                  counterpartyAgentId, direction=directed)
  + body + retrievalKeys
```

Revise 禁止旧 top-level `scope/counterpartyAgentId/direction/memoryId/baseRevisionId`。Add shape 和成功 closed
union 不变：

```json
{"outcome":"effective","memoryId":"memory_123","revisionId":"revision_456"}
```

```json
{"outcome":"review_pending","reviewItemId":"review_789"}
```

精确 Memory 语义、64 KiB View limit、body quota、anti-oracle 与 evidence 顺序由
[Memory Capture v3](memory-capture-v3.md)拥有。

## Help, Skill and rollout

Root help 与 Charter 列出十三项具体命令。`memory.view --help` 说明 complete exact-Scope、Relationship
counterparty 和 copy-target；`memory.write --help` 说明 revise 原样复制 View/Read target。官方
`memory-stewardship` 默认在线路径是 View → Write，Search → Read 只用于跨 Scope 广泛发现。

新 Native Session 收到 v11 Charter。旧 Bootstrap Evidence 不回写；旧 Session/Resident process 必须在
compatibility preflight 失败后替换或拒绝，不能继续使用 v10 catalog。

## Qualification

确定性 gates 至少覆盖：

- v11 constants/capability/catalog digest 与十三项唯一 CLI mapping；
- View 三种 closed input、完整 output、排序、Relationship actor-relative selection 与 no-partial schema；
- View/Read target golden projection 与旧 flat revise shape 拒绝；
- target copy revise、mutual non-revisability、guessed/mismatched target anti-oracle；
- production serializer legal extreme、oversized/corrupt fail-closed 与 evidence-after-size-check；
- Memory-domain clean break、body aggregate capacity 的所有净增长路径和 durable replay；
- v10 context/capability compatibility fence。

真实 Runtime smoke 在执行 Search/Read/Write 之外还必须成功执行 View，并证明十三项 terminal Evidence 集合。

## Unchanged v10 rules

Camp/History/Task/Send、Current User Attention、input-source mutual exclusion、CLI local errors、Core Envelope、
receipt、Replay、`confirm_outcome`、host evidence、process lease、current Camp derivation、line-leading display-name
alias 和 external MCP boundary 原样继承。

## References

- [ADR-0186: Complete Exact-Scope Memory View](../versions/v0.78/decisions.md#adr-0186)
- [Memory Capture v3](memory-capture-v3.md)
- [Built-in Tool Transport v10 (historical)](builtin-tool-transport-v10.md)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
