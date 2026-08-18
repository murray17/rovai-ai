---
document_type: architecture
architecture: online-memory-capture
authority: memory-capture-component-boundaries
status: accepted
last_updated: 2026-08-18
---

# Online Memory Capture Architecture

本文组合在线 Skill discovery、Agent Memory Facade、direct mutation、Hearth review、formal Memory Store、
live-authorized retrieval 与用户审核面。长期决策见
[ADR-0178](../adr/0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md)、
[ADR-0179](../adr/0179-normalized-memory-store-v3-with-isolated-hearth-review.md)和
[ADR-0180](../adr/0180-single-agent-memory-write-command.md)和
[ADR-0186](../adr/0186-complete-exact-scope-memory-view-and-copyable-target.md)；精确字段与状态见
[Memory Capture v3](../contracts/memory-capture-v3.md)，CLI transport 见
[Built-in Tool Transport v15](../contracts/builtin-tool-transport-v15.md)。

Architecture/Contract `accepted` 不表示代码已实现；当前完成度只从
[v0.78 实施计划](../versions/v0.78/implementation-plan.md)判断。

## 总体路径

```text
current input / A2A handoff / explicit long-term commitment / verified result
                              |
                              v
            Runtime-native memory-stewardship discovery
                    (best-effort, no Core state)
                              |
             exact-Scope complete view -> decide
                              |
                              v
                    rovai memory write
                              |
          CLI v12 + Core BuiltinToolRouter + active lease
                              |
                              v
                 Agent Memory Capture Facade
                       /                 \
                      v                   v
          Direct Memory Mutation     Hearth Review
          Companion / directed       pending Review Item
          Relationship                   |
                      \                  | user accept
                       \                 v
                        -> Formal Memory Publication
                                   |
                   Memory Store + active-only FTS
                                   |
             memory.view / memory.search / memory.read
```

在线捕获的默认路径是 `view -> write`。`search -> read` 保留为跨 Scope 的广泛发现路径，不承担完整查重。

Skill discovery 是 Runtime-native 行为，没有 durable Opportunity object、命中 event、未命中 ledger 或
“本 Run 已检查”Boolean。Core 只观察实际 operation invocation；没有调用时不能声称 Agent 已完成 Memory
判断。

## 模块与接口

| Module | Narrow interface | Owns | Does not own |
| --- | --- | --- | --- |
| `memory-stewardship` Skill | Runtime-native discovery + progressive references | durable-value、Scope、atomicity、view/add/revise judgment；search/read broad recall | authorization、persistence、deterministic per-turn loading |
| Built-in Tool Runtime | `memory.view/search/read/write` | CLI parsing、active lease、Envelope/projection/replay transport、v12 schema/capability fencing | Memory semantics、review lifecycle、candidate visibility |
| Agent Memory Capture Facade | one validated add/revise request | actor resolution、common canonicalization、安全/配额 admission、Scope target assertion、route selection | semantic similarity、user review decision |
| Direct Memory Mutation | Companion / directed Relationship add/revise | formal publication、Revision CAS、capacity、body-free result | Hearth pending content、mutual mutation |
| Hearth Review | submit/read/accept/reject/invalidate | isolated candidate、Review CAS、stale derivation、terminal clearing | formal Memory before accept、Agent read API |
| Formal Memory Publication | create/revise current formal Revision | active duplicate、origin/provenance、FTS maintenance、pending-add reconciliation | candidate retention、semantic merge |
| Memory Retrieval Service | view/search/read | complete exact-Scope set、live applicable search/read、copyable target、cache state、anti-oracle、access evidence | pending Review candidates、historical body fallback |
| User Memory Governance | typed user commands | all Scope writes、mutual、review decision、lifecycle、Forget、cross-identity Supersession | model-inferred intent or optimistic Renderer truth |

The Facade is deep because its small add/revise interface hides actor resolution, two outcome paths, exact admission and
transaction composition. `memory.write` being one command is not itself evidence of depth; domain modules stay
separate and can evolve independently behind the seam.

## Actor and Scope routing

Core derives A, Camp C, Run and epoch from active lease/Binding. Model fields never establish authority.

```text
add companion
  -> require Companion(A)
  -> Direct Memory Mutation

add relationship
  -> require B present/current in C
  -> freeze directed actor A, counterparty B
  -> Direct Memory Mutation

add hearth
  -> Hearth Review submit

revise copied target(memoryId + revisionId + complete Scope identity)
  -> load formal target
  -> verify Hearth or actor-bounded mutation authorization
  -> verify copied target identity before CAS/no-change
  -> Companion(A) or directed actor A: Direct Memory Mutation
  -> Hearth: Hearth Review submit
  -> mutual, reverse directed, another Companion or identity mismatch: unavailable
```

User governance enters a separate user-actor command seam and does not reuse Agent lease identity. It can create or
revise mutual Relationship and directly publish Hearth content without a Review Item.

View item and authorized current/revised Read result carry one indivisible `target`. Hearth and Companion target 包含
`memoryId + revisionId + scope`；Relationship 还包含当前 Agent 的 `counterpartyAgentId` 与 immutable
`direction`。Body-free stale/unavailable Read 不返回 target。Revise 原样复制 target，不能重组或把其中字段当作
请求修改的新状态。Search 继续返回 flat Scope discovery metadata，不提供 copyable target。

## Complete exact-Scope View

Hearth View 是 local Rovai home application-global effective Hearth 集合；Companion View 是认证 AgentProfile
的完整有效集合；Relationship View 是 current Agent 对 exact unordered pair 的 complete applicable set：只含
`mutual(A,B)` 与 `directed(A -> B)`，不含反向 directed Memory。Mutual item 明确
`agentCanRevise=false`。

View 在一个 SQLite immediate transaction 内完成认证、Presence 校验、权威查询、确定性排序、production
serializer 检查和逐 Revision access evidence。成功一定返回整个集合以及 `complete=true`、`itemCount`、
`totalBodyBytes` 和 `items`；没有 cursor、分页、截断或 partial success。最终 minified canonical JSON Agent
projection 超过 64 KiB、Scope count/body invariant 损坏或序列化失败时，在写 evidence 之前 fail closed。

完整返回由条数与 active-current-body 双层容量闭合：Hearth application-global 与 Companion per AgentProfile
各为 32 条/16 KiB，Relationship unordered pair 为 12 条/12 KiB；单条 Body 上限仍是 2,048 bytes。Create、
active revise、reactivate、Review accept 和 Supersession Create 都按事务最终状态检查净增长，Retire/Forget
释放配额。配额是领域容量，不是 transport 截断策略。

## Durable rejection seam

The Memory module classifies predictable rule violations separately from infrastructure failure. Canonical input,
Scope/Kind/direction, Presence, quota, capacity, duplicate, lifecycle and concurrency failures become
`CommandHandlerResult::rejected` inside `DomainCommandGateway`, so the same command identity permanently replays its
first result. SQLite/serialization errors and broken internal invariants remain `Err` and roll the transaction back.

Normalization that succeeds still determines the canonical request digest. If normalization itself yields a known
Memory rule violation, Gateway records that rejection against the raw closed command; malformed JSON that never forms
a typed command remains a transport input error.

## Supersession transaction ordering

User Supersession prepares every predecessor and the complete successor before any write. Existing successor mode
validates version, lifecycle, self-reference and cycle. Create mode canonicalizes/validates the candidate and computes
final capacity after excluding only predecessors that occupy the candidate's target capacity. It then inserts the
successor, retires predecessors and creates edges in one transaction.

Supersession may change immutable Scope, Kind or direction: ADR-0022 requires a new Memory for those changes and
ADR-0026 makes the explicit edge their history. There is no same-Scope/Kind post-insert rejection. A rejected command
therefore cannot leave a successor Revision, keys, FTS row, Review invalidation, retired predecessor or edge.

## Hearth Review aggregate

Hearth Review has its own identity and optimistic version. A pending candidate is user-review-only managed content;
it is absent from:

```text
memory
memory_revision
memory_revision_retrieval_key
memory_fts
MEMORY_ENTRYPOINT
memory.search
memory.read
Agent-facing event/result/evidence bodies
```

The Review read model joins current target state to derive `stale`. It never persists stale fan-out when a formal
Revision changes. Review accept checks both Review version and target base Revision in one transaction. Reject works
for a fresh or stale pending item and performs terminal content clearing.

The Renderer may close a drawer without changing domain state. An explicit user “reject” is the only negative review
decision in v1; there is no ignored/dismissed status.

## Formal publication and candidate reconciliation

Formal Hearth publication is one shared internal interface used by direct user create/revise and accepted Review. Its
transaction owns:

1. current user authorization and expected version/base checks;
2. canonicalization, Secret Filter, duplicate/no-change and capacity;
3. immutable formal Revision and current pointer;
4. active-only FTS maintenance;
5. invalidation and body clearing of every other exact matching pending add;
6. body-free event and durable idempotent result.

The matching add digest uses Hearth Kind + canonical body, not Retrieval Keys. This aligns publication reconciliation
with formal active duplicate identity and prevents different keys from keeping a targetless recreation candidate
alive.

Review accept additionally resolves its own row to body-free `accepted`. The formal publisher receives final content
only; it never parses Review storage directly. That seam keeps Memory publication reusable and Review implementation
local.

## Forget closure

Forget calls the same pending-add reconciliation for every non-cleared formal Revision body of the target before
clearing any of them, then clears formal Revision bodies/keys, FTS and every target/accepted-linked Review candidate in
one transaction. Comparing all target Revisions closes legacy v2 candidates that match a formerly current body rather
than only the final current body. Targeted pending revise
items become `invalidated(target_forgotten)`; exact targetless pending adds become
`invalidated(exact_candidate_published)`. Terminal rows retain only body-free provenance.

This ordering closes both paths:

```text
pending revise -> target forgotten -> later accept       (blocked by target invalidation)
pending add -> same formal content -> formal forgotten    (blocked at publication/Forget reconciliation)
```

## Read, evidence and failure boundaries

Memory View/Search/Read only query formal active current Revisions. View 读取权威 exact-Scope 集合；Search 在
derived FTS 不可信时 fail closed；Read 从权威行重新授权。Authorized View/Read body-bearing results 带完整
copyable target；body-free results 不带。Pending candidate existence 不可通过 View、ranking、snippet、result
count、target 或 guessed ID 发现。

Events, durable command results, CLI stdout, Runtime Activity and diagnostic exports store identities, outcome,
authorization basis and versions without Memory or candidate body. Complete Core Envelope/receipt remains host-only.
`review_pending` is a committed outcome but not an effective Memory; presentation and model smoke must preserve that
distinction.

## Migration composition

v0.78 使用 pre-release Memory-domain clean break，不迁移或 grandfather 旧 Memory。Migration 清空 formal
Memory、Revision、keys、Hearth Review Item、Supersession、Memory access evidence/FTS、Memory domain events 与
Memory command results，重建支持 `view` kind 的 evidence schema，同时保留 Camp、Task、Message、AgentProfile、
Runtime/Skill/MCP 和其他应用状态。测试从真实旧 schema fixture 证明清理边界与非 Memory 状态保留。

## Explicit non-components

v1 intentionally has no Explicit Memory Intent Router, capture checkpoint, offline reflector, Opportunity table,
semantic relation/reconciliation table, second LLM comparison, mutual acknowledgement protocol or generic proposal
framework. If later evidence justifies one, it must integrate through a new narrow seam rather than being hidden in
Skill prose or FTS.

## References

- [Memory Capture v3](../contracts/memory-capture-v3.md)
- [Built-in Tool Transport v15](../contracts/builtin-tool-transport-v15.md)
- [Built-in Tool Runtime](builtin-tool-runtime.md)
- [ADR-0068: Brokered Memory Retrieval](../adr/0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [ADR-0186: Complete Exact-Scope Memory View](../adr/0186-complete-exact-scope-memory-view-and-copyable-target.md)
- [v0.78 implementation plan](../versions/v0.78/implementation-plan.md)
