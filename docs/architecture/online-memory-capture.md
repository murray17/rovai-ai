---
document_type: architecture
architecture: online-memory-capture
authority: memory-capture-component-boundaries
status: accepted
last_updated: 2026-08-13
---

# Online Memory Capture Architecture

本文组合在线 Skill discovery、Agent Memory Facade、direct mutation、Hearth review、formal Memory Store、
live-authorized retrieval 与用户审核面。长期决策见
[ADR-0178](../adr/0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md)、
[ADR-0179](../adr/0179-normalized-memory-store-v3-with-isolated-hearth-review.md)和
[ADR-0180](../adr/0180-single-agent-memory-write-command.md)、
[ADR-0183](../adr/0183-scope-identified-agent-memory-revision-targets.md)；精确字段与状态见
[Memory Capture v2](../contracts/memory-capture-v2.md)，CLI transport 见
[Built-in Tool Transport v10](../contracts/builtin-tool-transport-v10.md)。

Architecture/Contract `accepted` 不表示代码已实现；当前完成度只从
[v0.75 实施计划](../versions/v0.75/implementation-plan.md)判断。

## 总体路径

```text
current input / A2A handoff / explicit long-term commitment / verified result
                              |
                              v
            Runtime-native memory-stewardship discovery
                    (best-effort, no Core state)
                              |
          search -> read Scope identity -> decide
                              |
                              v
                    rovai memory write
                              |
          CLI v10 + Core BuiltinToolRouter + active lease
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
                        memory.search / memory.read
```

Skill discovery 是 Runtime-native 行为，没有 durable Opportunity object、命中 event、未命中 ledger 或
“本 Run 已检查”Boolean。Core 只观察实际 operation invocation；没有调用时不能声称 Agent 已完成 Memory
判断。

## 模块与接口

| Module | Narrow interface | Owns | Does not own |
| --- | --- | --- | --- |
| `memory-stewardship` Skill | Runtime-native discovery + progressive references | durable-value、Scope、atomicity、search/read/add/revise judgment | authorization、persistence、deterministic per-turn loading |
| Built-in Tool Runtime | `memory.search/read/write` | CLI parsing、active lease、Envelope/projection/replay transport、v10 schema/capability fencing | Memory semantics、review lifecycle、candidate visibility |
| Agent Memory Capture Facade | one validated add/revise request | actor resolution、common canonicalization、安全/配额 admission、Scope target assertion、route selection | semantic similarity、user review decision |
| Direct Memory Mutation | Companion / directed Relationship add/revise | formal publication、Revision CAS、capacity、body-free result | Hearth pending content、mutual mutation |
| Hearth Review | submit/read/accept/reject/invalidate | isolated candidate、Review CAS、stale derivation、terminal clearing | formal Memory before accept、Agent read API |
| Formal Memory Publication | create/revise current formal Revision | active duplicate、origin/provenance、FTS maintenance、pending-add reconciliation | candidate retention、semantic merge |
| Memory Retrieval Broker | search/read | live applicable set、current Revision、Agent-relative Scope identity、cache state、anti-oracle | pending Review candidates、historical body fallback |
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

revise memoryId + baseRevisionId + copied Scope identity
  -> load formal target
  -> verify Hearth or actor-bounded mutation authorization
  -> verify copied scope/counterparty/direction before CAS/no-change
  -> Companion(A) or directed actor A: Direct Memory Mutation
  -> Hearth: Hearth Review submit
  -> mutual, reverse directed, another Companion or identity mismatch: unavailable
```

User governance enters a separate user-actor command seam and does not reuse Agent lease identity. It can create or
revise mutual Relationship and directly publish Hearth content without a Review Item.

Search result and authorized current/revised Read result share one Agent-relative Scope identity projection. Hearth
and Companion carry only `scope`; Relationship also carries the current Agent's `counterpartyAgentId` and immutable
`direction`. Body-free stale/unavailable reads omit all three identity fields. The write request repeats them as an
optimistic target assertion, never as requested mutable state.

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

Memory Search/Read continues to query formal active current Revisions only. Search fails closed when derived FTS is
untrusted; direct read continues from authoritative rows with current authorization. Authorized results include the
minimum Scope identity needed for target selection; body-free results do not. Pending candidate existence is not
discoverable through ranking, snippets, result counts, Scope fields or guessed IDs.

Events, durable command results, CLI stdout, Runtime Activity and diagnostic exports store identities, outcome,
authorization basis and versions without Memory or candidate body. Complete Core Envelope/receipt remains host-only.
`review_pending` is a committed outcome but not an effective Memory; presentation and model smoke must preserve that
distinction.

## Migration composition

The schema migration is additive and preserving for formal Memory. It transforms old Hearth proposal rows into Review
Items, clears terminal candidate content, computes pending digests and invalidates pending adds already equal to any
retained formal Hearth Revision. Existing Agent-origin mutual Memory remains formal and readable but exits the Agent
mutation set. Migration
tests use pre-v3 fixtures and prove that no candidate becomes Agent-readable during or after the change.

## Explicit non-components

v1 intentionally has no Explicit Memory Intent Router, capture checkpoint, offline reflector, Opportunity table,
semantic relation/reconciliation table, second LLM comparison, mutual acknowledgement protocol or generic proposal
framework. If later evidence justifies one, it must integrate through a new narrow seam rather than being hidden in
Skill prose or FTS.

## References

- [Memory Capture v2](../contracts/memory-capture-v2.md)
- [Built-in Tool Transport v10](../contracts/builtin-tool-transport-v10.md)
- [Built-in Tool Runtime](builtin-tool-runtime.md)
- [ADR-0068: Brokered Memory Retrieval](../adr/0068-brokered-memory-retrieval-and-session-entrypoint.md)
- [v0.75 implementation plan](../versions/v0.75/implementation-plan.md)
