---
document_type: version-decisions
version: v0.73
lifecycle: historical
last_updated: 2026-08-18
---

# v0.73 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0178](#adr-0178) | Best-Effort Online Memory Capture and Actor-Bounded Agent Mutation | `accepted` |
| [ADR-0179](#adr-0179) | Normalized Memory Store v3 with Isolated Hearth Review | `accepted` |
| [ADR-0180](#adr-0180) | Single Agent Memory Write Command with Outcome-Discriminated Output | `accepted` |

<!-- legacy-adr:begin id=ADR-0178 source-file-sha256=b20d217a6bebb036e81dfc9379b14d0284d09170d18de0a465d2e8c8a2b1d59d -->
<a id="adr-0178"></a>

## ADR-0178: Best-Effort Online Memory Capture and Actor-Bounded Agent Mutation

迁移时原路径：`docs/adr/0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0178
title: Best-Effort Online Memory Capture and Actor-Bounded Agent Mutation
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.73
supersedes:
  - ADR-0069
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0178 -->
<a id="adr-0178-context"></a>
### Context

ADR-0069 established one effective Memory state, direct Companion/Relationship writes and a separate Hearth
proposal operation. It also allowed one Agent to create or revise a mutual Relationship Memory. The current
product instead needs a purely online capture path in which Runtime-native Skill discovery helps an Agent notice a
possible durable collaboration understanding, while Core keeps the durable authority boundary deterministic.

Skill availability cannot prove that a model loaded the Skill on a particular turn. A free-text Relationship entry
also cannot safely become a bilateral obligation merely because one participant wrote it. Finally, making Hearth
content effective for every Member still requires an explicit user decision even if the Agent-facing command is
later simplified.

<a id="adr-0178-decision"></a>
### Decision

<a id="adr-0178-online-capture-has-a-best-effort-service-level"></a>
#### Online capture has a best-effort service level

Agent-origin Memory capture is an online, `memory-stewardship`-guided workflow:

```text
possible durable information
  -> Runtime-native Skill discovery
  -> Companion / Relationship / Hearth judgment
  -> search, then read when needed
  -> add, revise, or stop
```

The system-required Skill is available to every supported Runtime, but neither an implicit opportunity nor a
natural-language request such as “remember this” receives a deterministic loading guarantee. The product does not
add a capture clause to the Session Charter, an end-of-Run checkpoint, offline reflection, an opportunity database,
or a semantic relation classifier. If deterministic user governance is required, a structured Renderer action
invokes an authenticated user command; an Agent cannot simulate Forget by writing contrary text.

<a id="adr-0178-memory-remains-single-effective-and-provenance-aware"></a>
#### Memory remains single-effective and provenance-aware

Memory Kind remains the closed set `preference | agreement | lesson`. Hearth and Companion allow all three;
Relationship allows only `agreement | lesson`. Every active Memory selects exactly one effective immutable Revision.
Origin and Revision actor provenance remain audit and UI facts, never an authority tier, model priority, Capability,
Approval, or substitute for current user input and current repository or collaboration state.

Formation origin is the immutable closed set `user | agent | accepted_hearth_review`. Only `agent` consumes
Agent-origin capacity; accepting a Hearth Review Item remains a user activation even though its source Agent is
retained. Every Revision separately records user/Agent actor provenance and, for an Agent, Core-derived Camp/Run/Epoch
evidence. Later user or Agent revisions do not rewrite formation origin or change its capacity class, and weak source
deletion never cascade-deletes formal Memory.

An authenticated user may create and revise every legal Scope and direction, including mutual Relationship, and
retains the existing retire, reactivate, forget, review-scheduling and Supersession commands. User content mutations
use Memory version and, when publishing a Revision, the exact base Revision.

<a id="adr-0178-agent-mutation-is-bounded-to-the-actors-own-durable-responsibility"></a>
#### Agent mutation is bounded to the actor's own durable responsibility

For current authenticated Agent A in current Camp C, Agent mutation may only:

```text
add/revise Companion(A)
add/revise directed Relationship(A -> B),
  where B is another present current Member of C
submit Hearth add/revise content for user review
```

An Agent may not add or revise `mutual(A, B)`, `directed(B -> A)`, another Companion, any Memory lifecycle, Review
schedule or Supersession. Existing mutual Relationship Memory remains legal and readable by both participants under
ADR-0068, but only the user may change it. Directed Relationship remains readable and applicable only to its actor;
the counterparty cannot use it as a persistent cross-Agent content channel.

Agent revise uses exact `memoryId + baseRevisionId`, cannot change Scope, Kind, pair or direction, and is allowed only
when the target is active, currently applicable and inside the same actor-bounded mutation set. A Hearth submission
does not create a Memory or MemoryRevision. It creates an independent Hearth Review Item whose candidate content is
visible only to the authenticated user review surface; only acceptance publishes an effective Revision.

<a id="adr-0178-core-keeps-deterministic-safety-and-resource-admission"></a>
#### Core keeps deterministic safety and resource admission

Every Agent mutation revalidates the current unambiguous Native Binding, fenced running AgentRun, execution epoch,
present current Camp membership, Scope/Kind/direction, counterparty, canonical body and Retrieval Keys, Secret
Filter, idempotency, exact duplicate/no-change, Revision concurrency, active capacity, Agent-origin capacity and
per-Run quota in the mutation transaction. Semantic durability and add-versus-revise judgment remain with the Agent;
Core does not infer semantic equivalence.

All current Members retain equal built-in operation eligibility under ADR-0124. There is no Member-varying business
Capability gate and no `agentMemoryWritesEnabled` policy.

The retained bounds are:

```text
successful Agent mutations per AgentRun                 4
canonical body bytes                                 2,048
active Hearth / Companion(A)                         32 / 32
active Relationship per pair / applicable to A      12 / 48
Agent-origin Companion(A)                                 8
Agent-origin Relationship per pair / applicable to A  4 / 16
direct Agent-origin Hearth                                0
```

Creating a pending Hearth Review Item consumes one successful Agent mutation slot but no active Memory capacity.
Revision, Retire and Forget do not add an active slot. Capacity failure never evicts, truncates or creates a fallback
candidate.

Review scheduling remains advisory rather than an effectiveness state: Lesson defaults to review after 90 days
regardless of origin, while Preference and Agreement have no automatic review date. Becoming due never changes
Lifecycle or content and only the user may continue, reschedule, revise, retire or forget it.

All mutations, body-free events and durable command results use the existing Core transaction and idempotency
boundary. Search/read authorization, FTS fail-closed behavior, cache states and guessed-ID anti-oracle behavior remain
owned by ADR-0068.

This decision completely supersedes ADR-0069. ADR-0124's later removal of Capability and global Memory-write policy
continues to apply and is incorporated here rather than restored.

<a id="adr-0178-consequences"></a>
### Consequences

- Runtime-native discovery can improve online capture without becoming a product promise that every natural-language
  intent is processed.
- Agents can maintain their own Companion and directed pair responsibilities, but cannot unilaterally create a
  bilateral obligation or a reverse-direction assertion.
- Hearth keeps a user activation boundary while ordinary Companion and directed Relationship writes remain
  immediately effective.
- The direct mutation path stays small, but Core must preserve live fencing, exact concurrency, capacity, quota,
  Secret Filter and body-free evidence on every call.
- A future Agent-authored mutual workflow would require an explicit same-candidate acknowledgement protocol and a new
  decision; ordinary Message IDs are insufficient evidence.

<a id="adr-0178-rejected-alternatives"></a>
### Rejected Alternatives

- **Claim deterministic handling for explicit natural-language Memory requests.** Skill delivery and discovery do not
  prove per-turn model loading; a structured user command is the deterministic boundary.
- **Add end-of-Run or offline reflection.** It creates another capture lifecycle, persistence surface and source of
  late writes without solving online judgment quality.
- **Allow one Agent to write mutual Relationship after reading ordinary messages.** Message participation does not
  prove acceptance of one exact durable candidate.
- **Let the counterparty read directed free text.** Without structured obligations and acknowledgement, this creates a
  durable cross-Agent content channel.
- **Let Agents write Hearth directly.** One Agent would establish guidance for every Member without user review.
- **Restore Capability or a global write switch.** That conflicts with the equal fixed-operation eligibility adopted
  by ADR-0124 and does not replace request-specific domain admission.

<a id="adr-0178-references"></a>
### References

- [v0.73 在线长期记忆捕获与 Hearth 审核隔离](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0022: Immutable Memory Scope](../v0.10/decisions.md#adr-0022)
- [ADR-0026: Explicit Memory Supersession](../v0.10/decisions.md#adr-0026)
- [ADR-0027: Memory-Domain Forgetting](../v0.10/decisions.md#adr-0027)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](../v0.21/decisions.md#adr-0068)
- [ADR-0069: Single Effective Memory (historical)](../v0.21/decisions.md#adr-0069)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](../v0.42/decisions.md#adr-0124)
- [Memory Capture v1](../../contracts/memory-capture-v1.md)
- [Online Memory Capture architecture](../../architecture/online-memory-capture.md)
<!-- legacy-adr-body:end id=ADR-0178 -->
<!-- legacy-adr:end id=ADR-0178 -->

<!-- legacy-adr:begin id=ADR-0179 source-file-sha256=e0d60139686bd3980381240c506c63db6973f3a4374098a9968c099e0726c22f -->
<a id="adr-0179"></a>

## ADR-0179: Normalized Memory Store v3 with Isolated Hearth Review

迁移时原路径：`docs/adr/0179-normalized-memory-store-v3-with-isolated-hearth-review.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0179
title: Normalized Memory Store v3 with Isolated Hearth Review
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.73
supersedes:
  - ADR-0070
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0179 -->
<a id="adr-0179-context"></a>
### Context

ADR-0070 gives Hearth-only proposals a separate table, but its terminal model can retain accepted candidate text and
its Forget cleanup is centered on candidates linked to an accepted Memory. A pending Hearth add has no target Memory;
if the same content is published directly and later forgotten, that old pending candidate could recreate content the
user already removed. Renaming a pending candidate to a MemoryRevision would instead spread non-effective content
through Revision, retrieval, export and forgetting semantics.

The persistence model therefore needs a review aggregate that is independent from Memory, has its own concurrency and
terminal lifecycle, never enters Agent reads, and closes every path by which candidate content could survive formal
publication or Memory Forget.

<a id="adr-0179-decision"></a>
### Decision

<a id="adr-0179-memory-and-hearth-review-are-separate-authoritative-aggregates"></a>
#### Memory and Hearth review are separate authoritative aggregates

The existing application SQLite database remains the sole authority. Memory Store v3 contains the logical families:

```text
memory
memory_revision
memory_revision_retrieval_key
hearth_review_item
memory_supersession
```

Only `memory` and `memory_revision` represent published Memory. `hearth_review_item` represents an Agent-submitted,
user-review-only candidate and never becomes a pending or rejected Revision. FTS remains a reconstructible index over
active current formal Revisions only; a Review Item candidate never enters FTS, Memory Entrypoint, Memory Search,
Memory Read, export or Agent-visible evidence.

The derived search layer remains SQLite FTS5 trigram over separate Retrieval Key and body columns with BM25 weights
6 and 1. FTS is never authority for Scope, Lifecycle, body, keys or access; integrity failure makes search unavailable
until deterministic rebuild while authorized direct reads continue from formal rows. Search/Read evidence retains only
digests, authorization basis, IDs, Revision/cache states and outcomes, never complete query, snippet, body or candidate.

Review Item persistent status is the closed set `pending | accepted | rejected | invalidated`. Staleness is derived for
a pending revise when its target is absent, non-active, non-Hearth, or no longer selects `baseRevisionId`; it is not a
stored status. A stale item cannot be accepted or rebased, but the user may reject it. There is no separate dismiss or
close state.

<a id="adr-0179-pending-candidate-content-is-isolated-terminal-rows-are-body-free"></a>
#### Pending candidate content is isolated; terminal rows are body-free

A pending item owns its action, candidate Kind where needed, canonical candidate body, complete Retrieval Keys,
target/base identity where needed, opaque canonical digest, source Agent/Camp/Run/Epoch, optimistic version and time.
Source references are weak audit references and never cascade-delete the application-global Review Item.

Acceptance creates one formal Memory or Revision and then clears candidate Kind, body, Retrieval Keys and digest in
the same transaction. Rejection and invalidation clear the same fields. Terminal rows retain only body-free source,
action, target/base, accepted Memory/Revision references, resolver, timestamps, invalidation reason and whether the
user edited before acceptance. The product deliberately gives up a post-accept original-versus-final text diff;
the accepted MemoryRevision is the only long-term body.

The internal digest is never returned through Agent, Renderer, event, command-result or diagnostic contracts. For an
add it identifies exact canonical Hearth Kind and body, matching formal active-Memory duplicate semantics; Retrieval
Keys cannot create a second same-body Memory. For a revise it also binds target, base and the complete key set. An
exact pending duplicate produces only a body-free `duplicate_pending` rejection and preserves the earliest row.

<a id="adr-0179-publication-and-forget-close-targetless-recreation-paths"></a>
#### Publication and Forget close targetless recreation paths

Every direct-user or accepted-review publication of a formal Hearth add or Revision atomically invalidates every
other pending Hearth add with the same final Kind and canonical body, clears its candidate fields and records the
body-free reason `exact_candidate_published`. This applies when edit-and-accept makes the final content equal to a
different pending candidate.

Before Memory Forget clears a Hearth Memory, the same pending-add reconciliation runs for every still-readable formal
Revision body of that target, not only its current Revision. This is a safeguard for candidates and historical
Revisions created before v3 publication reconciliation existed. The Forget transaction then clears every formal
Revision body and Retrieval Key, removes FTS rows,
and clears every Review Item associated by `targetMemoryId` or accepted Memory reference. Pending target items become
`invalidated` with reason `target_forgotten`; all terminal linked rows remain body-free. No event, command result,
Supersession row, index or retained digest can reconstruct the forgotten text.

<a id="adr-0179-review-decisions-have-two-independent-compare-and-swap-boundaries"></a>
#### Review decisions have two independent compare-and-swap boundaries

Every decision checks `expectedReviewItemVersion`. A revise acceptance separately requires the formal target to be an
active Hearth Memory whose `currentRevisionId == baseRevisionId`. Add acceptance revalidates candidate content,
Secret Filter, exact duplicate, capacity and current user authorization. Edit-and-accept changes only the candidate
body and complete key set used for that transaction; it does not change or silently rebase the original target/base.

Formal Memory and Review Item mutations, derived-index maintenance, body-free event and durable idempotent result
commit in one immediate SQLite transaction. Repositories do not commit independently.

<a id="adr-0179-existing-data-is-migrated-without-erasing-formal-memory"></a>
#### Existing data is migrated without erasing formal Memory

The v3 migration preserves formal Memory, Revisions, Retrieval Keys and Supersession. Existing Hearth proposal rows
become Review Items with equivalent source, target/base, decision and accepted references. Pending rows receive the
new digest; pending adds already equal to any retained formal Hearth Revision become body-free `invalidated` rows with
`exact_candidate_published`. Accepted and rejected rows have candidate fields cleared during migration. Existing
Agent-origin mutual Relationship Memory is preserved as formal history and active content, but ADR-0178 prevents
future Agent mutation of it.

This decision completely supersedes ADR-0070. SQLite, immutable formal Revisions, normalized Retrieval Keys,
reconstructible FTS, DomainCommandGateway transactions and non-event-sourced authority remain unchanged.

<a id="adr-0179-consequences"></a>
### Consequences

- User review can persist independently without granting Agent read access or polluting formal Revision history.
- Acceptance, rejection, invalidation and Forget have one body-clearing rule, reducing duplicate secret and retention
  surfaces.
- Stale revise display requires joining the current target state at read time instead of bulk status updates.
- Publication must reconcile matching pending adds in the same transaction; this additional write prevents a later
  targetless candidate from recreating published-and-forgotten content.
- Migrated accepted reviews lose their retained original candidate text by design, while body-free provenance and
  formal accepted Revision remain.

<a id="adr-0179-rejected-alternatives"></a>
### Rejected Alternatives

- **Model pending Hearth content as MemoryRevision.** Non-effective content would leak into formal lifecycle, search,
  export and Forget responsibilities.
- **Persist `stale` as a status.** Every target Revision change would require fan-out writes and race with review reads.
- **Keep accepted candidate text for audit diff.** It creates a second long-term body and expands every Forget path.
- **Invalidate only review items with `targetMemoryId`.** Pending add has no target and can recreate content after
  direct publication and Forget.
- **Retain the digest after terminal resolution.** A body-derived value would outlive its only operational purpose and
  enlarge the Forget surface.
- **Reset all Memory data.** The new model can preserve formal Memory and transform the narrower review rows without a
  destructive clean break.

<a id="adr-0179-references"></a>
### References

- [v0.73 在线长期记忆捕获与 Hearth 审核隔离](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0027: Memory-Domain Forgetting](../v0.10/decisions.md#adr-0027)
- [ADR-0068: Brokered Memory Retrieval and Session Entrypoint](../v0.21/decisions.md#adr-0068)
- [ADR-0070: Normalized SQLite Memory Store v2 (historical)](../v0.21/decisions.md#adr-0070)
- [ADR-0178: Best-Effort Online Memory Capture](decisions.md#adr-0178)
- [Memory Capture v1](../../contracts/memory-capture-v1.md)
- [Online Memory Capture architecture](../../architecture/online-memory-capture.md)
<!-- legacy-adr-body:end id=ADR-0179 -->
<!-- legacy-adr:end id=ADR-0179 -->

<!-- legacy-adr:begin id=ADR-0180 source-file-sha256=751254db96dd196815be65a55adf8e2bf26d475574fa23923704bb5c7a9efec2 -->
<a id="adr-0180"></a>

## ADR-0180: Single Agent Memory Write Command with Outcome-Discriminated Output

迁移时原路径：`docs/adr/0180-single-agent-memory-write-command.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0180
title: Single Agent Memory Write Command with Outcome-Discriminated Output
status: accepted
date: 2026-08-13
decision_scope: cross-version
source_version: v0.73
supersedes: []
intended_supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0180 -->
<a id="adr-0180-context"></a>
### Context

ADR-0124 fixes separate `memory.write` and `memory.propose_hearth` Agent commands, and ADR-0135 currently projects
their different results. The Memory domain now requires the Agent to decide only whether one durable understanding
should be added, revised or not written. Whether a valid submission is immediately effective or enters isolated
Hearth review follows from the authenticated target Scope rather than an additional proposal decision by the model.

Keeping two verbs makes the model translate the same add/revise judgment into a second transport choice and exposes a
historical domain noun that no longer exists. Combining commands is nevertheless a transport decision: it must not
collapse Hearth Review Item into Memory or weaken user activation.

<a id="adr-0180-decision"></a>
### Decision

Built-in Tool Transport v9 exposes exactly three Agent Memory commands:

```text
rovai memory search
rovai memory read
rovai memory write
```

`memory.propose_hearth` and `rovai memory propose-hearth` are removed from the fixed catalog, root help, exact-help
paths, Session Charter, Skills, schemas, fixtures and qualification. `memory.write` accepts only `add | revise`.
Companion and permitted directed Relationship targets commit an effective Memory/Revision; Hearth targets create an
isolated pending Hearth Review Item. The Agent never supplies a proposal flag or chooses a different operation.

Successful Agent stdout is a closed discriminated union:

```json
{"outcome":"effective","memoryId":"memory_123","revisionId":"revision_456"}
```

or:

```json
{"outcome":"review_pending","reviewItemId":"review_789"}
```

No additional fields are allowed. Business failures keep the existing closed error projection with stable code,
safe message and recovery. Ordinary stdout is an operation-specific Agent Result Projection, not a receipt; it never
contains canonical operation, requestId, receipt or the complete Envelope. Full canonical results, Envelope, receipt,
Replay and Evidence remain Core/host-only under ADR-0135.

v9 changes the fixed command set from thirteen to twelve and requires a new contract version, CLI command version,
catalog digest, Runtime capability, exact help, input schema, output schema and golden fixtures. All nine supported
Runtimes must prove correct command choice, effective-versus-review-pending reporting and conflict read-then-decide
behavior before the transport version is complete.

This decision locally replaces only ADR-0124's fixed Memory command list and only ADR-0135's `memory.write` /
`memory.propose_hearth` Agent output clauses. Their CLI-only transport, equal Member eligibility, lease, Envelope,
receipt, Replay, recovery and projection boundaries remain effective. The independent Hearth Review domain remains
effective even if a future transport successor reintroduces separate presentation commands.

<a id="adr-0180-consequences"></a>
### Consequences

- The Agent makes one semantic add/revise decision and learns effectiveness from a typed result instead of choosing a
  proposal verb.
- The catalog and every supported Runtime move together to v9; mixed v8/v9 command exposure is not supported.
- Agent wording can be tested precisely: `review_pending` must never be described as saved or effective.
- The single command does not make Memory and Hearth Review one aggregate; Core still routes to distinct domain
  modules and persistence invariants.

<a id="adr-0180-rejected-alternatives"></a>
### Rejected Alternatives

- **Keep both commands indefinitely.** It preserves an avoidable transport choice and the obsolete Proposal term after
  the domain has moved to Review Item.
- **Return `{effective: boolean}` without a discriminator.** It permits ambiguous field combinations and gives no
  stable identity for a pending review outcome.
- **Call Agent stdout a receipt.** The actual receipt and request identity are intentionally host-only and have
  different replay responsibilities.
- **Return the full Envelope for Memory only.** It would violate the common Agent Result Projection boundary and make
  Memory a transport exception.
- **Treat unified write as proof of a unified domain aggregate.** Command convenience does not justify putting pending
  candidate content into formal MemoryRevision lifecycle.

<a id="adr-0180-references"></a>
### References

- [v0.73 在线长期记忆捕获与 Hearth 审核隔离](README.md)
- [ADR-0124: CLI-Only Transport for Rovai Built-in Operations](../v0.42/decisions.md#adr-0124)
- [ADR-0135: Compact Agent Output](../v0.46/decisions.md#adr-0135)
- [ADR-0178: Best-Effort Online Memory Capture](decisions.md#adr-0178)
- [Built-in Tool Transport v9](../../contracts/builtin-tool-transport-v9.md)
- [Memory Capture v1](../../contracts/memory-capture-v1.md)
<!-- legacy-adr-body:end id=ADR-0180 -->
<!-- legacy-adr:end id=ADR-0180 -->
