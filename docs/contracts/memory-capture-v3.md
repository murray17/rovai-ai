---
document_type: contract
contract: memory-capture-v3
status: accepted
target_version: v0.78
last_updated: 2026-08-14
---

# Memory Capture v3

本合同完整替代 [Memory Capture v2](memory-capture-v2.md)。v2 的 best-effort opportunity、Actor/Scope
authority、Hearth Review isolation、Secret Filter、Run quota、durable rejection、Supersession 原子顺序、
candidate clearing、Forget closure、Search 和 cache-state Read 继续成立。v3 新增 complete exact-Scope View，
把 Revision target 收敛为一个可复制对象，并以 active body aggregate quota 闭合完整输出。

## 1. Exact-Scope `memory.view`

Closed input 只有三种：

```json
{"scope":"hearth"}
```

```json
{"scope":"companion"}
```

```json
{"scope":"relationship","counterpartyAgentId":"agent_3"}
```

Hearth/Companion 禁止 `counterpartyAgentId`。Relationship 要求 counterparty 是当前 Agent 以外、当前 Camp
在场的 AgentProfile；不存在、离场、非成员和其他不可用目标统一失败为：

```json
{
  "code": "memory.view_unavailable",
  "payload": {"message": "Memory View is unavailable"}
}
```

成功结果一次返回完整集合：

```json
{
  "scope": "relationship",
  "counterpartyAgentId": "agent_3",
  "complete": true,
  "itemCount": 2,
  "totalBodyBytes": 132,
  "items": [
    {
      "target": {
        "memoryId": "memory_123",
        "revisionId": "revision_456",
        "scope": "relationship",
        "counterpartyAgentId": "agent_3",
        "direction": "directed"
      },
      "kind": "agreement",
      "retrievalKeys": ["交接证据"],
      "body": "交接时同时提供测试命令、结果与对应提交。",
      "agentCanRevise": true
    }
  ]
}
```

`complete` 永远为 `true`；`itemCount == items.length`；`totalBodyBytes` 是所有 canonical Body 真实 UTF-8
bytes 之和。成功不含 cursor、nextCursor、truncated 或 partial 字段。空集合是合法完整结果。

### Scope selection

| Input | 完整集合 | 排序 |
| --- | --- | --- |
| Hearth | local Rovai home application-global active/current Hearth | agreement、preference、lesson，再按 Memory ID |
| Companion | authenticated AgentProfile 的 active/current Companion | agreement、preference、lesson，再按 Memory ID |
| Relationship(A,B) | `directed(A -> B)` + `mutual(A,B)` | directed 后 mutual；各自 agreement、lesson，再按 Memory ID |

Relationship 不返回 `directed(B -> A)`。Mutual item 的 `agentCanRevise` 必为 `false`；其他 View item 为
`true`，但该 Boolean 只是当前结果的教学字段，Core write authorization 仍是权威。

Pending 或 terminal Hearth Review Item 不进入任何 View，不影响 `itemCount`/`totalBodyBytes`，也不产生
View access evidence。

## 2. Copyable target

`target` 是不可分割对象：

```text
memoryId + revisionId + scope
+ Relationship-only counterpartyAgentId + direction
```

Hearth/Companion target 禁止 Relationship 字段。Relationship View/Read 可以返回 `directed | mutual`；Agent
revise schema 只接受 `directed`。

`memory.read` 的 body-bearing `current | revision_changed` result 改为：

```json
{
  "memoryId": "memory_123",
  "cacheState": "current",
  "target": {
    "memoryId": "memory_123",
    "revisionId": "revision_456",
    "scope": "companion"
  },
  "kind": "lesson",
  "agentCanRevise": true,
  "retrievalKeys": ["恢复边界"],
  "body": "恢复前验证冻结输入。"
}
```

外层 `memoryId` 关联请求顺序；内层 target 可原样复制。`inactive | deleted | access_changed | unavailable`
仍只返回 `memoryId + cacheState`，不得返回 target、Kind、agentCanRevise、keys 或 body。

Search 继续返回 v2 的 flat Agent-relative Scope discovery metadata，不返回 target 或完整正文。

## 3. Agent `memory.write`

Add shape 与 v2 相同，并禁止 `target`。Revise 只接受：

```json
{
  "action": "revise",
  "target": {
    "memoryId": "memory_123",
    "revisionId": "revision_456",
    "scope": "relationship",
    "counterpartyAgentId": "agent_3",
    "direction": "directed"
  },
  "body": "replacement canonical Memory body",
  "retrievalKeys": ["complete replacement set"]
}
```

Revise 禁止 top-level `scope`、`kind`、`counterpartyAgentId`、`direction`、`memoryId` 和 `baseRevisionId`。
`target.revisionId` 是 CAS base。Target 必须从 deciding View item 或 current Read result 原样复制。

事务授权顺序保持：

```text
validate Run/epoch/quota and closed target shape
→ load active target
→ verify Hearth route or actor-bounded mutation set
→ verify complete target Scope identity
→ verify target.revisionId CAS
→ verify exact no-change
→ check final active-body capacity when direct publication can grow
→ publish direct Revision or isolated Hearth Review Item
→ append body-free event + durable result
→ commit
```

因此只有通过 target/authorization 的调用才可观察 `memory.revision_conflict` 或 `memory.no_change`。Closed
schema 中 mutual Relationship target 固定返回 `memory.invalid_input`，且不查询 target；对于结构合法的
directed target，其他 Companion、reverse-directed、unknown/inactive 或 identity mismatch 保持统一
`memory.unavailable`。

## 4. Active capacity

单条 canonical Body 仍为 1–2,048 UTF-8 bytes。Entry count 与 aggregate active current-body bytes 同时受限：

| Capacity identity | Entry max | Active body max |
| --- | ---: | ---: |
| Hearth application-global | 32 | 16 KiB |
| Companion per AgentProfile | 32 | 16 KiB |
| Relationship per unordered pair | 12 | 12 KiB |

Agent-origin 与 per-Run quota 继续独立生效。Aggregate 只计算 active Memory 的 current Revision Body；
historical Revision、retired/forgotten Memory 和 Review candidate 不占用。

以下任何净增长路径都在同一事务内按最终状态检查：create、active revise、reactivate、Hearth Review accept、
Supersession Create。Supersession 只排除本命令将退休且属于 successor capacity identity 的 predecessor。
Retire/Forget 释放 quota；缩短 active Body 可以释放 bytes。超限返回 durable `memory.capacity_exceeded`，不
截断、不自动拆分、不驱逐。

## 5. Serialization, transaction and evidence

View 由现有 Memory Retrieval Service 在一个 SQLite immediate transaction 中完成：

```text
authenticate Binding/Run/epoch
→ validate Scope/Presence
→ query active current formal rows
→ deterministic sort + build typed Agent projection
→ serialize with the production minified canonical JSON path
→ verify byte limit
→ record one access-evidence row per delivered Revision
→ commit
→ return the same typed output
```

`MEMORY_VIEW_OUTPUT_MAX_BYTES = 64 KiB`。长度是最终 minified Agent projection 的真实 UTF-8 bytes，不是
Body 估算。合法极值 fixture 覆盖 Hearth、Companion 与 Relationship 三种 projection 的最大合法 item count、
aggregate Body、最坏合法 JSON escaping、最大 keys、UUID target 与所有字段。若内部损坏仍使 Scope
count/body invariant 或 serialization limit 失效，整个调用
返回 `memory.view_unavailable`，不记录 View evidence，不返回前缀。

View 与后续 Write 不在同一事务。Revise 由 Revision CAS 防止 lost update；并发 add 只进行 exact active
duplicate 检查，不提供 semantic serializability 或 completion token。

## 6. Clean-break migration

v0.78/schema 39/migration 84 是 Memory-domain clean break。它清空：

```text
memory / memory_revision / memory_revision_retrieval_key
hearth_review_item / memory_supersession
memory_access_evidence / memory_fts
memory.* domain events
command.result where command_type is memory.*
```

Search state重置为 ready 并推进 index version；Evidence table 重建以接受 `view` kind。Camp、Task、Message、
AgentRun、AgentProfile、Runtime/Skill/MCP 和其他领域状态保留。没有 grandfather、旧 Scope over-quota、
pending candidate migration、导出或确认步骤。

## 7. Unchanged v2 boundaries

- Opportunity discovery 仍是 best-effort Runtime-native Skill 行为，没有 durable Opportunity/checkpoint；
- direct Agent writes 仍只拥有自己的 Companion 与 `current Agent -> present counterparty` Relationship；
- Hearth Agent add/revise 仍只创建 isolated pending Review Item，成功为 `review_pending`；
- Review terminal clearing、publication reconciliation、Forget closure 与 export isolation 不变；
- predictable typed domain rejection 仍持久化并稳定 replay；infrastructure error 回滚且不伪造业务结果；
- Memory Search/Read/Entrypoint、FTS、events、evidence 和 export 都不暴露 Review candidate body/keys/digest。

## References

- [ADR-0186: Complete Exact-Scope Memory View](../adr/0186-complete-exact-scope-memory-view-and-copyable-target.md)
- [Memory Capture v2 (historical)](memory-capture-v2.md)
- [Built-in Tool Transport v12](builtin-tool-transport-v12.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
