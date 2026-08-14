---
document_type: contract
contract: memory-capture-v2
status: accepted
target_version: v0.75
last_updated: 2026-08-14
---

# Memory Capture v2

本合同完整替代 [Memory Capture v1](memory-capture-v1.md)。它保留 v1 的 best-effort online discovery、
Actor 边界、Kind/Scope 合法性、正文与 Retrieval Key 限制、Secret Filter、Run quota、容量、Hearth Review
aggregate、双 CAS、candidate isolation/clearing、publication reconciliation、Forget closure 与 migration 语义。
v2 只收口三处正确性边界：Agent-visible Scope identity、revise target assertion，以及所有已进入 Memory
command 的可预期业务拒绝与 Supersession 写入的原子顺序。

## 1. Search Scope identity

`memory.search` 仍只搜索当前 Agent 可访问的 active/current formal Memory，最多返回 6 项，不返回完整正文。
每项 closed result 为：

```json
{
  "memoryId": "memory_123",
  "revisionId": "revision_456",
  "kind": "agreement",
  "scope": "relationship",
  "counterpartyAgentId": "agent_3",
  "direction": "directed",
  "retrievalKeys": ["交接证据"],
  "snippet": "交接时提供…"
}
```

字段规则：

| Scope | 必有身份字段 | 禁止身份字段 |
| --- | --- | --- |
| `hearth` | `scope` | `counterpartyAgentId`、`direction` |
| `companion` | `scope` | `counterpartyAgentId`、`direction` |
| `relationship` | `scope`、`counterpartyAgentId`、`direction` | — |

Relationship counterparty 是相对当前认证 Agent 的另一方，不是 unordered pair 的 low/high 存储字段。Search
成功结果本身已经通过当前 applicable-set 授权；字段不扩大权限。

## 2. Read Scope identity and anti-oracle

`memory.read` 每次最多读取 4 个稳定 ID，继续重新验证 Binding、Run/epoch、Scope applicability、Presence、
Lifecycle 与 current Revision。只有带当前正文的 `current | revision_changed` 成员返回：

```json
{
  "memoryId": "memory_123",
  "cacheState": "current",
  "revisionId": "revision_456",
  "kind": "agreement",
  "scope": "relationship",
  "counterpartyAgentId": "agent_3",
  "direction": "directed",
  "retrievalKeys": ["交接证据"],
  "body": "交接时同时提供测试命令与结果。"
}
```

`inactive | deleted | access_changed | unavailable` 保持 body-free，并且必须同时省略 `revisionId`、`kind`、
`scope`、`counterpartyAgentId`、`direction`、`retrievalKeys` 与 `body`。特定 stale state 仍要求同 Binding
generation 的既有可读证据；未知或未证明可读的目标继续统一为：

```json
{"memoryId":"memory_unknown","cacheState":"unavailable"}
```

## 3. Closed Agent `memory.write` input

### Add

Add shape 与 v1 不变：

```json
{
  "action": "add",
  "scope": "companion | relationship | hearth",
  "kind": "preference | agreement | lesson",
  "body": "one canonical Memory body",
  "retrievalKeys": ["key one"],
  "counterpartyAgentId": "agent_3",
  "direction": "directed"
}
```

Companion/Hearth 禁止 Relationship 两字段；Relationship 要求 present current counterparty、只允许
agreement/lesson 与 `directed(current Agent -> counterparty)`。Add 禁止 `memoryId`、`baseRevisionId`。

### Revise

Revise 现在必须重复 deciding `memory.read` 返回的 immutable Scope identity。Companion/Hearth shape：

```json
{
  "action": "revise",
  "scope": "companion",
  "memoryId": "memory_123",
  "baseRevisionId": "revision_456",
  "body": "replacement canonical Memory body",
  "retrievalKeys": ["complete replacement set"]
}
```

Relationship shape：

```json
{
  "action": "revise",
  "scope": "relationship",
  "counterpartyAgentId": "agent_3",
  "direction": "directed",
  "memoryId": "memory_123",
  "baseRevisionId": "revision_456",
  "body": "replacement canonical Memory body",
  "retrievalKeys": ["complete replacement set"]
}
```

Revise 禁止 `kind`。`scope`、`counterpartyAgentId` 与 `direction` 是 target assertion，不是写入新值；Core
不得用它们移动或重分类目标。Mutual、reverse-directed 与其他 Companion 没有合法 Agent revise shape。

## 4. Revise decision order

对已经通过 closed-shape 解析与 canonical body/key normalization 的 Agent revise，事务内顺序固定为：

```text
validate current AgentRun / epoch / mutation quota
→ load target
→ absent or inactive: memory.unavailable
→ verify Hearth route or actor-bounded mutation authorization
→ verify repeated Scope identity exactly matches target
→ unauthorized or mismatch: memory.unavailable
→ verify baseRevisionId CAS
→ verify exact body/key no-change
→ publish direct Revision or save isolated Hearth Review Item
→ append body-free event + durable command result
→ commit
```

因此 unknown ID、other Companion、mutual、reverse-directed 与错误 Scope/counterparty/direction 在 well-formed
revise 下都不能通过 CAS/no-change 形成 target oracle。统一结果为：

```json
{
  "code": "memory.unavailable",
  "payload": {"message": "Memory is unavailable"}
}
```

只有通过授权和完整目标身份检查后，`memory.revision_conflict` 与 `memory.no_change` 才可见。

## 5. Durable domain rejection

进入 typed Memory command 后，所有可预期领域拒绝都必须返回 `CommandHandlerResult::rejected`，与唯一
`command.result` 在同一 Core transaction 提交。至少包括：

```text
invalid canonical body / Retrieval Keys / Scope / Kind / direction
secret or exact duplicate
capacity or Agent-origin capacity
AgentRun write quota
counterparty not present/current
target unavailable, lifecycle/version/Revision/no-change conflict
Review conflict/stale/version conflict
Supersession input/cycle/capacity conflict
```

相同 command identity 与 digest 永久重放首次拒绝，即使容量、Presence、Lifecycle 或其他领域状态随后改变。
数据库错误、序列化失败、损坏的不变量和其他基础设施异常仍返回 `Err`、回滚且不伪造业务结果。尚未形成
typed command 的 malformed transport JSON 继续属于 Built-in Tool transport input failure。

## 6. Supersession validate-before-mutate

User Supersession 继续遵守 ADR-0026：successor 可以是 existing Memory 或在命令中创建的新 Memory，也可以
使用不同 Scope、Kind 或 direction；这些 immutable identity 变化正是创建新 Memory 的理由。

Create-successor 顺序固定为：

```text
load/version/lifecycle-check every predecessor
→ normalize and validate successor candidate
→ check final capacity after excluding same-scope predecessors retired by this command
→ only then insert successor Revision/keys/Memory/FTS
→ retire predecessors + insert Supersession edges
→ append event/result
→ commit
```

Existing-successor 还要在任何 mutation 前完成 successor version/lifecycle、自引用与 cycle 检查。任何业务
拒绝都不能留下 successor、Revision、Retrieval Key、FTS、Review invalidation、retired predecessor 或 edge。
基础设施失败由 SQLite transaction 整体回滚。

## 7. Outcomes, isolation and unchanged bounds

成功 Agent projection 保持 closed union：

```json
{"outcome":"effective","memoryId":"memory_123","revisionId":"revision_456"}
```

```json
{"outcome":"review_pending","reviewItemId":"review_789"}
```

Pending/terminal Hearth Review Item 继续完全排除于 FTS、Entrypoint、Search、Read、Agent-visible evidence 与
Memory export；terminal resolution 清除 candidate Kind/body/keys/digest。v1 第 4–10 节的 limits、dedup、
retention、publication reconciliation、Forget 与 migration 规则原样继承。

## References

- [ADR-0183: Scope-Identified Agent Memory Revision Targets](../adr/0183-scope-identified-agent-memory-revision-targets.md)
- [ADR-0001: Core Transaction](../adr/0001-core-transaction.md)
- [ADR-0026: Explicit Memory Supersession](../adr/0026-explicit-memory-supersession.md)
- [ADR-0068: Brokered Memory Retrieval](../adr/0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0178: Best-Effort Online Memory Capture](../adr/0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md)
- [Memory Capture v1 (historical)](memory-capture-v1.md)
- [Built-in Tool Transport v10](builtin-tool-transport-v10.md)
