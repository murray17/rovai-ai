---
document_type: contract
contract: builtin-tool-transport-v10
status: accepted
target_version: v0.75
last_updated: 2026-08-14
---

# Built-in Tool Transport v10

v10 完整替代 [Built-in Tool Transport v9](builtin-tool-transport-v9.md)。它保留 v9 的 Unix IPC、Core
Envelope、receipt、Replay、Agent Output v2、process-scoped lease、single-JSON stdout、Camp Message Send v6、
Task v3、exact Camp addressing、progressive teaching 与十二项固定命令。v10 只改变 Memory Search/Read 输出和
Memory revise 输入，使 immutable Scope identity 可见且成为 Core-verified target assertion。

## Fixed commands and versions

```text
rovai send
rovai task create|get|update|list
rovai camp list|search|read
rovai history search
rovai memory search|read|write
```

固定集合仍为十二项；`memory.propose_hearth` 不恢复。

```text
BUILTIN_TOOL_CONTRACT_VERSION = 10
BUILTIN_TOOL_CLI_COMMAND_VERSION = 10
Runtime capability = builtin_cli.transport.v10
IPC protocol = 1
Envelope = 1
receipt = 1
Agent Output = 2
```

v9 或更早 capability 不能满足 v10 Binding compatibility。Catalog digest 继续同时覆盖命令描述、closed
input/output schema、CLI mapping 与 Agent projection。

## Memory Search and Read

`memory.search` 每个 authorized result 在 v9 字段上增加必填 `scope`；Relationship 结果还要求
`counterpartyAgentId` 与 `direction`。Hearth/Companion 禁止输出 Relationship 两字段。

`memory.read` 的 `current | revision_changed` result 使用同一 Scope identity。`inactive | deleted |
access_changed | unavailable` 只返回 `memoryId + cacheState`，不得返回 Scope、counterparty 或 direction。
完整 closed shape 与 anti-oracle 由 [Memory Capture v2](memory-capture-v2.md)拥有。

## Memory Write

Add input 与 v9 相同。Revise 从一个 shape 拆成三个 closed shape：

```text
Companion   action + scope=companion + memoryId + baseRevisionId + body + retrievalKeys
Hearth      action + scope=hearth + memoryId + baseRevisionId + body + retrievalKeys
Relationship action + scope=relationship + counterpartyAgentId + direction=directed
             + memoryId + baseRevisionId + body + retrievalKeys
```

这些 Scope 字段必须复制 deciding `memory.read` result，只作为 target assertion。`kind` 仍禁止；mutual 没有
Agent revise member。成功 projection 不变：

```json
{"outcome":"effective","memoryId":"memory_123","revisionId":"revision_456"}
```

```json
{"outcome":"review_pending","reviewItemId":"review_789"}
```

Business failure 继续是 `{"error":{"code","message","recovery"}}`。已经形成 typed Memory command 的
可预期领域拒绝必须由 durable Core command result 投影，不能把 handler `Err` 当作瞬时 CLI failure。

## Help, Skill and rollout

Exact-help 集合与 v9 相同。Catalog descriptions 必须说明：

- Search/Read authorized current results返回 immutable Scope identity；
- Revise 要逐字段复制 deciding read 的 Memory ID、Revision ID 与 Scope identity；
- Scope assertion 不会改变 Memory Scope；
- Hearth 仍只产生 `review_pending`。

`memory-stewardship` 使用同一 read-before-revise 规则，并在 ID、Revision、Scope、counterparty 或 direction
无法完全匹配时 stop。

所有 Runtime Adapter 从常量生成 v10 CLI context/capability。Antigravity Binding compatibility 同时包含
contract version 与 catalog digest；其他 Runtime 每个 acquired Run 继续 preflight current CLI/context/
capability。新 Session 接收当前 Charter，旧 Bootstrap Evidence 不被改写；同一 App process 不暴露 mixed
v9/v10 command surface。

## Qualification

确定性测试至少覆盖：

- v10 constants/capability/catalog digest 与十二项固定 mapping；
- Search/Read 对 Hearth、Companion、多个相似 Relationship 的 Scope identity；
- stale/unavailable read 不含 target identity；
- 三种 revise schema、Relationship exact target mismatch 与 guessed-ID anti-oracle；
- capacity、Run quota 与 counterparty Presence 拒绝的 durable replay；
- Supersession validate-before-mutate 与 cross-Scope successor；
- v9 context/capability 被 v10 compatibility fence 拒绝。

真实 Runtime smoke 必须检查 Search/Read 的 Scope identity，而不能只验证 Memory ID 存在。

## Unchanged v9 rules

Camp Message Send v6、Current User Attention、Task、Camp/History read、input-source mutual exclusion、CLI local
errors、Core Envelope、receipt、Replay、`confirm_outcome`、full host evidence、process lease、current Camp derivation
和 external MCP boundary 原样继承。普通 execution 仍只向 stdout 写一个 JSON document，且不暴露 credential、
socket/context path、request identity 或完整 Envelope。

## References

- [ADR-0183: Scope-Identified Agent Memory Revision Targets](../adr/0183-scope-identified-agent-memory-revision-targets.md)
- [Memory Capture v2](memory-capture-v2.md)
- [Built-in Tool Transport v9 (historical)](builtin-tool-transport-v9.md)
- [Camp Message Send v6](camp-message-send-v6.md)
- [Built-in Tool Runtime architecture](../architecture/builtin-tool-runtime.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
