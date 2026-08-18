---
document_type: version-decisions
version: v0.21
lifecycle: historical
last_updated: 2026-08-18
---

# v0.21 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0067](#adr-0067) | Native Session Bootstrap and AgentRun Context v3 | `accepted` |
| [ADR-0068](#adr-0068) | Brokered Memory Retrieval and Session Entrypoint | `accepted` |
| [ADR-0069](#adr-0069) | Single Effective Memory and Scope-Bounded Agent Mutation | `superseded` |
| [ADR-0070](#adr-0070) | Normalized SQLite Memory Store v2 | `superseded` |

<!-- legacy-adr:begin id=ADR-0067 source-file-sha256=788d2c6c1bbbe3e376ce6328811c1cf640ad757901fd7c573b7e9935085869e7 -->
<a id="adr-0067"></a>

## ADR-0067: Native Session Bootstrap and AgentRun Context v3

迁移时原路径：`docs/adr/0067-native-session-bootstrap-and-agentrun-context-v3.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0067
title: "Native Session Bootstrap and AgentRun Context v3"
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.21
supersedes: [ADR-0049, ADR-0063]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0067 -->
> [ADR-0100](../v0.35/decisions.md#adr-0100) 已替代
> [ADR-0085](../v0.27/decisions.md#adr-0085)，并局部替代本文的两区段
> Bootstrap、完整 Bootstrap 字节不可变、恢复时不读取当前 Profile，以及 Member Identity
> 所属生命周期条款；Session Charter、Memory Entrypoint 与 AgentRun Dynamic Context 各自的
> 稳定证据仍按 ADR-0100 划分。[ADR-0091](../v0.32/decisions.md#adr-0091)
> 局部替代本文的 A2A `source` alias、reply correlation 和直接 ConversationMessage trigger，
> 改由安全的 Member Call/Outcome ConversationInput 形成 CURRENT_INPUT。本文其余 Bootstrap、
> 动态上下文、恢复与投递合同继续有效。
>
> [ADR-0129](../v0.44/decisions.md#adr-0129) 局部替代本文的
> SHARED_CONVERSATION 摘要、Coverage、Context Read Marker、ContextManifest 摘要引用和
> Context Compaction 条款；Session Charter、Memory Entrypoint 及其他动态上下文区段继续有效。

<a id="adr-0067-context"></a>
### Context

ADR-0049 freezes a reproducible payload for every AgentRun, but its model-visible contract mixes
Native Session-stable instruction, execution-control metadata, current collaboration state,
derived Work Brief, Task snapshots, history coverage and the current request. ADR-0063 removes
most Turn Envelope data, yet still leaves A2A source identity in a separate per-Run section.

That shape repeats stable instruction, exposes fields the model cannot control and asks Core to
infer objective, responsibility, deliverable and constraints from text that already has an
authoritative source. Memory discovery also changes from a per-Run filesystem guide to a
Session-scoped entrypoint, so the Session and Run lifecycles need an explicit boundary.

Rovai-ai must simplify the model-visible input without weakening immutable ContextManifest
evidence, byte-identical recovery, Context Read Marker coverage, shared summaries, bounded
historical retrieval, trusted A2A correlation or Runtime-owned permissions.

<a id="adr-0067-decision"></a>
### Decision

<a id="adr-0067-two-context-lifecycles"></a>
#### Two context lifecycles

Rovai-ai defines exactly two model-visible context lifecycles:

```text
Native Session Bootstrap
  SESSION_CHARTER
  MEMORY_ENTRYPOINT

AgentRun Dynamic Context
  COLLABORATION_STATE?
  SHARED_CONVERSATION?
  RUN_NOTICES?
  CURRENT_INPUT
```

The Bootstrap is created once for one Native Binding generation. AgentRun Dynamic Context is
created once for each AgentRun. Empty optional sections are omitted rather than emitted as empty
markers.

The following former model sections cease to exist:

```text
TURN_ENVELOPE
CONTROL_SIGNALS
CONTEXT_BRIEFING
WORK_BRIEF
TASK_CONTEXT
per-Run MEMORY_GUIDE
```

Core does not synthesize an objective, responsibility, deliverable or natural-language
constraints. Current input, Task state, shared messages, summaries, collaboration state, Runtime
anomalies and Memory remain separate authorities.

<a id="adr-0067-immutable-native-session-bootstrap-evidence"></a>
#### Immutable Native Session Bootstrap evidence

Before creating a Native Session, Core persists one immutable
`NativeSessionBootstrapEvidence` bound to:

```text
conversation
nativeBindingId + generation
bootstrap formatter version
SESSION_CHARTER bytes + digest
MEMORY_ENTRYPOINT bytes + digest
observed Memory IDs + Revision IDs
authorization basis
delivery mode
creation time
```

Adapters use one of two verified delivery modes:

- `native_append` appends the Bootstrap through a Runtime-native developer/system instruction
  facility while preserving the Provider System Prompt;
- `first_payload` prepends the same logical Bootstrap to the first AgentRun payload for a Runtime
  that has no safe native append facility.

The two modes have identical logical content and authority. A `first_payload` ACK confirms both
the Bootstrap and that Run's dynamic payload. A `native_append` Session must be confirmed or
reconciled before dynamic input is dispatched. Missing evidence, partial preparation or unknown
delivery fails closed. Recovery reuses the frozen Bootstrap bytes; it never rebuilds the same
Binding generation from current Profile, Memory or Camp state.

<a id="adr-0067-session-charter-and-rotation"></a>
#### Session Charter and rotation

`SESSION_CHARTER` contains only:

- the Core-owned platform contract that an AgentProfile cannot override;
- Agent identity, stable role and optional stable style;
- authority boundaries for current input, Task, shared history, summaries, Run Notices, Memory,
  files and tool results;
- the rule that Core reauthorizes every tool/resource operation at call time;
- A2A collaboration rules, including that a source Agent is a peer requester and that empty
  acknowledgements, circular delegation and no-new-information handoffs are invalid.

It contains no current Task, member snapshot, Lead, A2A sender, attachment, quota, recovery state,
Memory ID, Skill/MCP inventory, Provider command or generic execution checklist.

A material Agent identity/role change, Core contract change or incompatible stable Profile
instruction rotates the Native Session. Messages, Tasks, member availability and Memory
add/revise/retire/forget/access changes do not. A stale Memory Entrypoint is handled by the live
Memory Read contract in ADR-0068 rather than by Session rotation.

<a id="adr-0067-dynamic-sections"></a>
#### Dynamic sections

`COLLABORATION_STATE` is a conditional, structured snapshot of facts that can affect collaboration
choice. A member exposes only stable routing identity, name, role and a user-comprehensible
availability projection. Availability is advisory; execution admission always rechecks current
membership, Presence, Runtime readiness, Capability, quota and fencing.

`SHARED_CONVERSATION` contains the public history not already continuously available to the
current Native Session:

```text
Summarized History
  explicit covered ranges and injected summary bodies
  bounded retrieval hint for older, non-injected detail

New Messages
  ordered public messages not covered elsewhere
```

Summary and original-message ranges cannot overlap or contain undeclared gaps. The current
triggering message is excluded and appears exactly once in `CURRENT_INPUT`. Internal Marker,
budget, Run, Turn, summary-generation and evidence fields are never model-visible.

`RUN_NOTICES` is a closed set of Core-rendered exceptional facts that materially alter the current
action:

```text
native_session_continuity_lost
workspace_state_requires_recheck
unsettled_external_effect
a2a_delegation_budget_exhausted
a2a_loop_blocked
a2a_delegation_policy_restricted
```

Notices contain no internal IDs, raw counters, error codes or state-machine dumps. A Notice is
included only when its authoritative condition is known before ContextManifest materialization
and still applies to that Run. Later races are reported by the responsible tool result.

`CURRENT_INPUT` always contains the complete trigger body. A user trigger is labeled `type: user`.
An A2A trigger carries Core-derived source metadata:

```text
source:
  type: a2a
  senderName: <display name>
  replyTarget: source
message: <complete body>
attachments: <authorized Run Attachment Projection paths>
```

Model-visible input excludes sender Agent ID, InboxMessage ID, Run lineage, Task association,
execution epoch and correlation IDs.

<a id="adr-0067-trusted-a2a-reply-alias"></a>
#### Trusted A2A reply alias

`team.post_message.recipient` accepts either an explicit authorized Agent routing ID or the
reserved value `source`. `source` is legal only in an A2A-triggered Run and resolves from the
current authenticated Run to its source InboxMessage and sender. If the model omits reply
linkage, Core atomically fills the trusted source linkage only for this resolved recipient.

The alias never causes an automatic response, wake, AgentRun or third-party correlation. All
identity, parent/root/depth, CampTurn, Task, epoch, quota and idempotency facts remain Core-owned.

<a id="adr-0067-contextmanifest-coverage-and-recovery"></a>
#### ContextManifest, coverage and recovery

Every AgentRun still receives exactly one immutable ContextManifest before first dispatch. It
references the Bootstrap evidence and freezes:

```text
Native Binding generation
Camp/Conversation message boundary
raw-message and injected-summary references
coverage baseline
Collaboration State digest
Run Notice evidence + rendered digest
Current Input source
Run Attachment Projection references + digest
Skill/MCP exposure
formatter version
complete rendered dynamic-payload Blob + digest
```

The Context Read Marker advances monotonically only after the Runtime has accepted the frozen
dynamic input and Core has persisted that ACK. It is an input-acceptance marker, not proof of model
reading or understanding.

Continuous coverage is proved only by an accepted original message, an accepted summary body
covering it, a public output confirmed as produced by the same Binding generation, or a declared
older continuous summary prefix with the bounded `context.search` recovery path. ADR-0050's
Camp-shared summary protocol and ADR-0051's boundary-capped retrieval remain effective.

Before ACK, retry may send only the same frozen bytes. After ACK, recovery may only resume the
same Native Session/turn. Unknown delivery is reconciled before either action; no path rebuilds or
blindly resends current data.

The product is unreleased, so v0.21 provides no active Formatter-v3 or old ContextManifest recovery
branch. Development databases may be rebuilt; a migration that preserves unrelated readable
history must invalidate incompatible Native Bindings and make old non-terminal input
non-resumable rather than translating or reformatting it.

<a id="adr-0067-task-and-attachment-boundaries"></a>
#### Task and attachment boundaries

AgentRun input does not contain a derived Task index. Task remains durable collaboration state;
Agents use `team.list_tasks` for current authorized detail and exact versions. Assignment alone
does not start execution. Immediate responsibility must arrive through a user or A2A current
input.

Managed Blob remains the attachment content authority. Before freezing a Run, Core prepares a
read-only, collision-safe and reconstructible Run Attachment Projection. Context contains only
stable authorized paths and freezes their content digests. The projection need not be inside a
Git worktree and grants no general filesystem authority. An Adapter must make it readable under
the recipient Runtime's own permission model; inability to prove readability rejects admission
instead of injecting the body or exposing a `managed-blob://` pseudo-path.

This ADR replaces ADR-0049 and ADR-0063 in full. It also replaces only ADR-0014's assumption that
an A2A target receives an authorized Task Context and ADR-0058's “Dynamic Task context”
model-injection clause; the Team Tool, Collaboration and Task domain models in those ADRs remain
effective.

<a id="adr-0067-consequences"></a>
### Consequences

- Stable Session instruction is no longer repeated on every Run, while every Run keeps immutable,
  explainable input evidence.
- Model input becomes smaller and contains fewer Core-owned control details, but Bootstrap
  delivery and recovery now require first-class evidence and Adapter conformance tests.
- Memory changes do not churn Native Sessions; live Memory reads bear the responsibility for
  stale, deleted and newly inaccessible entries.
- Task freshness comes from an authenticated tool instead of a frozen prompt snapshot.
- Attachments become real readable Run resources and require deterministic projection lifecycle,
  integrity checks and Adapter-specific access validation.
- Formatter, ContextManifest, Team Tool and Runtime contracts must switch atomically; old
  unfrozen input cannot be reconstructed under the new format.
- Existing development Runs/Bindings are not a compatibility target; retaining readable history
  cannot make an old payload executable under v0.21.

<a id="adr-0067-rejected-alternatives"></a>
### Rejected Alternatives

- Keep every old section but shorten its fields: retains duplicate authorities and derived
  instruction.
- Rebuild Bootstrap on every Run: destroys Session-stable evidence and repeats tokens.
- Rotate the Session for every Memory mutation or access change: converts ordinary Memory
  lifecycle into expensive Runtime churn and still cannot erase already-read content.
- Let each Adapter invent its own Bootstrap semantics: makes cross-Runtime behavior and recovery
  unauditable.
- Put Task state back into the prompt “for convenience”: creates a stale second read surface and
  makes Task look like the current instruction.
- Expose internal A2A correlation IDs to the model: transfers trusted routing bookkeeping to
  untrusted text.
- Inject attachment bodies when projection fails: creates an unbounded alternate prompt channel.

<a id="adr-0067-references"></a>
### References

- [v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](README.md)
- [ADR-0007: Portable Conversation Handoff](../v0.03/decisions.md#adr-0007)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0050: Camp-Shared Progressive Summaries](../v0.12/decisions.md#adr-0050)
- [ADR-0051: Boundary-Capped Context Retrieval](../v0.12/decisions.md#adr-0051)
- [ADR-0058: Collaboration v4](../v0.15/decisions.md#adr-0058)
- [ADR-0059: Runtime-Owned Resource Permissions](../v0.16/decisions.md#adr-0059)
- [ADR-0062: Interruptible Runs and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
- [ADR-0049: Reproducible Context Delivery v2](../v0.12/decisions.md#adr-0049)
- [ADR-0063: Minimal A2A Turn Envelope](../v0.17/decisions.md#adr-0063)
<!-- legacy-adr-body:end id=ADR-0067 -->
<!-- legacy-adr:end id=ADR-0067 -->

<!-- legacy-adr:begin id=ADR-0068 source-file-sha256=aa96d8f25753c3f9d389cb90ec83b7dd609abb69623262c56fcb8036c7f0bc37 -->
<a id="adr-0068"></a>

## ADR-0068: Brokered Memory Retrieval and Session Entrypoint

迁移时原路径：`docs/adr/0068-brokered-memory-retrieval-and-session-entrypoint.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0068
title: "Brokered Memory Retrieval and Session Entrypoint"
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.21
supersedes: [ADR-0035, ADR-0042]
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0068 -->
<a id="adr-0068-context"></a>
### Context

The current Agent Memory read contract exposes a deterministic Markdown Projection through native
filesystem tools. This keeps Memory bodies out of prompts, but it also exposes storage layout,
depends on every Runtime having reliable path access and cannot retract a path or text that a
long-lived Native Session already observed.

v0.21 moves discovery into a Native Session Bootstrap. That index is necessarily a snapshot:
Memories can be revised, retired, forgotten or become inapplicable while the Session continues.
Rotating the Native Session for every such change would be expensive and would still not erase
model history. The supported read boundary therefore needs current authorization and explicit
cache-state reporting at the time of use.

<a id="adr-0068-decision"></a>
### Decision

<a id="adr-0068-core-brokered-read-boundary"></a>
#### Core-brokered read boundary

SQLite remains the sole Memory content authority. Agents read Memory only through the stable Team
Tool Gateway:

```text
memory.search
memory.read
```

Agents receive no supported Memory Projection root, Markdown path, SQLite location or physical
storage identifier. An internal diagnostic projection may exist, but it is neither an Agent API
nor a fallback. User export continues to be generated from authoritative SQLite state.

Every call resolves the current Native Binding, exactly one current AgentRun, execution epoch,
AgentProfile, Camp membership and Presence. Tool visibility, a cached ID or earlier authorization
does not grant current read authority.

<a id="adr-0068-relationship-direction-and-applicable-set"></a>
#### Relationship direction and applicable set

Relationship Memory has one immutable direction:

```text
mutual(A, B)
directed(actor → counterparty)
```

The pair identity is normalized and unordered; direction is a separate immutable attribute. The
authenticated user can manage and inspect every legal direction without the UI hiding reverse
entries.

For current Agent A in Camp C, the Agent-readable active set is:

```text
all Hearth Memory
Companion(A)
for each other present current Camp member B:
  mutual(A, B)
  directed(A → B)
```

`directed(B → A)`, retired Memory, forgotten Memory and historical Revisions are not readable.
Runtime availability does not change Relationship applicability. Removing B from the current
applicable member set removes the pair from A's current read authority even if A saw it earlier.

<a id="adr-0068-revision-retrieval-keys"></a>
#### Revision retrieval keys

Every readable MemoryRevision stores one to three immutable Retrieval Keys alongside its canonical
body. A new Revision supplies a complete new key set. Keys are discovery metadata, not a substitute
for the body and not an instruction.

Validation is:

```text
one key          2–24 UTF-8 bytes
all keys         no more than 48 UTF-8 bytes
normalization    trim, collapse whitespace, ASCII case-fold, deduplicate
rejected         control characters, newlines, table separators, closed generic stop-terms
```

Agent writes submit body and keys in one call; no second model call is required. User create/revise
surfaces may suggest editable keys but must support manual entry without an LLM.

<a id="adr-0068-session-memory-entrypoint"></a>
#### Session Memory Entrypoint

`MEMORY_ENTRYPOINT` is a bounded discovery snapshot in the immutable Native Session Bootstrap. It
uses stable Memory IDs and lists only:

```text
Hearth          Memory ID | Kind | Retrieval Keys
Companion       Memory ID | Kind | Retrieval Keys
Relationships   Counterparty | Memory ID | Kind | Retrieval Keys
```

The fixed bounds are:

```text
Hearth rows          16
Companion rows       32
Relationship rows    24
total rows           72
per Relationship pair 12
```

Hearth, Companion and each pair sort by Agreement, Preference, Lesson, then Memory ID. Relationship
counterparties use only structured relevance: current A2A source, structured current-Task
participants, current-turn participants, Default Lead and Member Order. Core does not infer
relevance from message prose. Deterministic allocation prevents one counterparty from consuming
all Relationship rows.

An omitted Memory remains discoverable through `memory.search`. A listed ID grants no future
access. The Charter states that Entrypoint is a cache and that the Agent must call `memory.read`
before relying on a listed item.

<a id="adr-0068-search"></a>
#### Search

`memory.search` filters by the current applicable set before querying active current Revisions.
Its derived search layer uses SQLite FTS5 trigram tokenization and BM25, weighting Retrieval Keys
6 and body 1.

```text
query                    no more than 512 UTF-8 bytes
limit                    no more than 6 results
snippet per result       no more than 256 UTF-8 bytes
all returned snippets    no more than 2 KiB
```

Results contain Memory ID, Kind, Retrieval Keys and a short snippet. They never contain a complete
body merely because the result is short; the Agent uses `memory.read` for full current content.

<a id="adr-0068-read-and-cache-state"></a>
#### Read and cache state

`memory.read` accepts at most four stable Memory IDs and returns at most 8 KiB of complete body
text per call. It rechecks Binding, Run, epoch, Scope, Camp membership, Presence, Lifecycle and
current Revision in the read transaction.

An ID that is currently active and authorized returns the current body. If current Session
evidence recorded an older Revision, the response marks that change:

```text
active, no older evidence      current + current body
active, same known Revision    current + current body
active, newer Revision         revision_changed + latest Revision/body
retired                        inactive, no body
forgotten                      deleted, no body
no longer applicable           access_changed, no body
```

The three specific non-body stale states require proof that the ID was previously readable.
Previous-read evidence can come from this Binding generation's immutable Entrypoint or an earlier
successful `memory.search`/`memory.read` result recorded for the same generation. An unknown ID,
or an ID that is currently unreadable and was never proven readable to this generation, returns
the indistinguishable state `unavailable`. This prevents guessed IDs from becoming an existence
oracle without denying a currently authorized direct read.

`memory.read` never returns a retired, forgotten, superseded or formerly authorized body from
Bootstrap evidence, a ContextManifest, audit data, projection artifacts or an earlier Revision.
The warning is the cache-invalidation mechanism; it does not rotate or rewrite the Native Session.

<a id="adr-0068-evidence-and-failure"></a>
#### Evidence and failure

Search/Read evidence records request digest, authorization basis, requested/returned IDs,
Revision IDs, cache states and outcome. It does not duplicate complete queries, snippets or
Memory bodies. The derived FTS index is reconstructible; when it cannot be trusted, search is
temporarily unavailable rather than broadened or answered from stale data. Direct reads continue
from authoritative rows subject to all checks.

This ADR replaces ADR-0035 and ADR-0042 in full, including their supported Agent filesystem
Projection contract. It retains user-transparent Relationship direction while moving Agent
applicability enforcement to the brokered read boundary. It extends ADR-0014's stable Team Tool
Gateway with the two read tools; it does not create a second socket, connector or credential
boundary.

<a id="adr-0068-consequences"></a>
### Consequences

- Every supported Memory read has live authorization and an auditable Revision result independent
  of Runtime filesystem behavior.
- Entrypoint remains useful across a long Session without pretending to be current; stale,
  deleted and inaccessible entries produce explicit non-body results.
- Newly created Memory is available through search without Session rotation.
- The Gateway and SQLite search layer become availability dependencies for Agent Memory reads.
- Stable Memory IDs may remain in model history, but they cannot retrieve content after lifecycle
  or access changes.
- Retrieval Keys add authoring and validation work but provide deterministic, low-token discovery.

<a id="adr-0068-rejected-alternatives"></a>
### Rejected Alternatives

- Keep Markdown Projection as the supported read API: leaks storage layout and cannot enforce
  current authorization at read time.
- Rotate Native Session on every Memory change: causes excessive churn and cannot erase prior
  model context.
- Trust Entrypoint rows until Session end: returns retired, deleted or no-longer-authorized data.
- Return an old body together with a stale warning: the warning does not undo the disclosure.
- Return `deleted` for every nonexistent or guessed ID: creates a Memory existence side channel.
- Inject all applicable Memory bodies in Bootstrap or every Run: creates an unbounded,
  high-priority prompt channel.
- Search before applying Scope and Presence filters: can leak snippets through ranking and result
  counts.

<a id="adr-0068-references"></a>
### References

- [v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0022: Immutable Memory Scope](../v0.10/decisions.md#adr-0022)
- [ADR-0027: Memory-Domain Forgetting](../v0.10/decisions.md#adr-0027)
- [ADR-0047: User-Initiated Memory Export Boundary](../v0.10/decisions.md#adr-0047)
- [ADR-0057: Member Presence](../v0.15/decisions.md#adr-0057)
- [ADR-0035: User-Transparent, Agent-Applicable Relationship Memory](../v0.10/decisions.md#adr-0035)
- [ADR-0042: Fail-Closed Memory Projection](../v0.10/decisions.md#adr-0042)
<!-- legacy-adr-body:end id=ADR-0068 -->
<!-- legacy-adr:end id=ADR-0068 -->

<!-- legacy-adr:begin id=ADR-0069 source-file-sha256=739e705e5acf60427952588743c543ad8059384a3d9f644c668a4194278938a3 -->
<a id="adr-0069"></a>

## ADR-0069: Single Effective Memory and Scope-Bounded Agent Mutation

迁移时原路径：`docs/adr/0069-single-effective-memory-and-scope-bounded-agent-mutation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0069
title: "Single Effective Memory and Scope-Bounded Agent Mutation"
status: superseded
date: 2026-07-29
decision_scope: cross-version
source_version: v0.21
supersedes: [ADR-0024, ADR-0025, ADR-0036, ADR-0037, ADR-0038, ADR-0039, ADR-0040, ADR-0052, ADR-0064]
superseded_by: ADR-0178
```

<!-- legacy-adr-body:begin id=ADR-0069 -->
<a id="adr-0069-context"></a>
### Context

The current Memory model distinguishes `user_confirmed` and `provisional` Revisions. Agent
submissions may become pending Proposals, automatically formed lower-authority Memory or later
same-body confirmed Revisions. This creates three product concepts for one question—whether an
active Memory is usable—and requires a confirmation queue even for bounded Companion and
Relationship learning.

The desired product contract is simpler: every active Memory has the same state-machine effect,
while authorship remains visible for audit and UI. Hearth is the exception because one Agent's
suggestion would affect every AgentProfile; it still requires a user decision before becoming
active.

<a id="adr-0069-decision"></a>
### Decision

<a id="adr-0069-closed-memory-meaning-without-authority-tiers"></a>
#### Closed Memory meaning without authority tiers

Memory Kind remains a closed immutable identity:

```text
preference
agreement
lesson
```

Its legal Scope matrix is:

```text
Hearth         Preference | Agreement | Lesson
Companion      Preference | Agreement | Lesson
Relationship   Agreement | Lesson
```

Preference means a stable collaboration choice, Agreement means a prospective collaboration rule,
and Lesson means a reusable action pattern grounded in experience. None of those terms implies
that the user personally authored or endorsed the text. Authorship is shown through provenance.
Relationship Preference remains illegal, as do generic facts, personality/ability ratings,
secrets, credentials, transient Task/Run state and repository facts that have another authority.

An active current Memory has one effective state. `MemoryRevisionAuthority`,
`user_confirmed`, `provisional`, confirmation transitions and authority-based conflict ordering do
not exist. Current user input, current authorization and current repository/collaboration state
always outrank Memory, regardless of origin. Memory cannot grant a Capability, satisfy an Approval
or override a current tool result.

<a id="adr-0069-immutable-revisions-and-provenance"></a>
#### Immutable revisions and provenance

Each Memory keeps a stable ID, immutable Scope/Kind/Relationship Direction, Lifecycle, current
Revision pointer and optimistic version. Every Revision stores one immutable canonical body,
complete Retrieval Keys, creation time and actor provenance. Publication never mutates a prior
Revision; only the established irreversible Forget protocol may clear readable content.

Memory stores an immutable creation origin:

```text
user
agent
accepted_hearth_proposal
```

Each Revision separately records whether its actor was the user or an authenticated Agent and, for
an Agent, the Core-derived source AgentRun/Epoch/Camp evidence. Origin and revision actor are
audit/UI facts only. They do not change effectiveness, read priority, lifecycle, capacity class or
authorization. A user revision does not rewrite creation origin; an Agent revision does not turn a
user-created Memory into Agent-origin capacity.

<a id="adr-0069-user-authority"></a>
#### User authority

An authenticated user can directly create and revise every legal Scope, including Hearth, and
continues to own retire, reactivate, forget, review scheduling and explicit Supersession. User
commands use expected versions and the DomainCommandGateway but do not depend on Agent Capability
or the Agent-write policy.

There is no “confirm Agent Memory” command or pending management action for Companion or
Relationship Memory. UI may label origin and last revision actor, but an origin label is not an
activation control.

<a id="adr-0069-direct-agent-write"></a>
#### Direct Agent write

One Team Tool command, `memory.write`, directly creates an active Memory or publishes a new current
Revision in the same transaction. For current authenticated Agent A in Camp C it can target only:

```text
Companion(A)
Relationship(A, B), where B is another present current Camp member of C
```

For Relationship add, A may choose `mutual(A, B)` or `directed(A → B)`, never
`directed(B → A)`. Revise cannot change Scope, Kind or Direction and is legal only for a current
Memory that ADR-0068 allows A to read. It requires exact `memoryId + baseRevisionId`; stale,
inactive, inaccessible or no-op writes fail without persistence.

Agent writes cannot create Hearth Memory, change Lifecycle, reactivate, forget, schedule Review,
create Supersession or mutate another Companion. Identity, Camp, counterparty, Direction actor,
Run and Epoch come from the trusted Binding and current domain state rather than model-supplied
authority fields.

<a id="adr-0069-hearth-proposal-exception"></a>
#### Hearth proposal exception

`memory.propose_hearth` is the only Agent proposal tool and Hearth is its only Scope. It may
propose add or revise content, but a pending Hearth Memory Proposal is not a Memory, is not
searchable/readable by Agents and has no effect.

The user decides each pending proposal by accept, edit-and-accept or reject:

- accept revalidates body, Retrieval Keys, duplicates, capacity and current authorization, then
  creates the active Hearth Memory/Revision in the same transaction;
- revise acceptance additionally requires the proposal's immutable
  `baseRevisionId == currentRevisionId`;
- a stale revise proposal remains visible as stale but cannot be accepted or rebased in place;
- rejection clears candidate body and Retrieval Keys while retaining body-free attribution;
- acceptance retains the original candidate for comparison with an edited final Revision;
- forgetting the linked Memory clears any retained accepted candidate body.

Pending proposals do not expire automatically. An exact duplicate of an earlier pending
add/revise candidate is rejected while preserving the earliest row and without consuming another
Run quota slot; Core never infers semantic equivalence. Source Camp/Run/Epoch values are weak,
Core-derived audit references: source deletion disables navigation but does not cascade-delete or
invalidate the proposal.

The user may bypass this queue by directly creating or revising Hearth Memory. An accepted Hearth
Memory has the same effect as every other active Memory; its provenance records only that an Agent
suggested and the user adopted it. Because the user decision is the activation boundary, it
consumes ordinary Hearth capacity but is not a direct Agent-origin Memory.

<a id="adr-0069-capability-live-policy-and-bounds"></a>
#### Capability, live policy and bounds

Both Agent mutation tools require:

- a current unambiguous Native Binding and fenced running AgentRun;
- present current Camp membership;
- frozen effective business Capability `memory.write`;
- the live application policy `agentMemoryWritesEnabled = true`;
- Scope/Kind/Direction authorization;
- deterministic Secret Filter, canonicalization, duplicate and no-op checks;
- optimistic Revision/Memory concurrency checks;
- all active and Agent-origin capacity checks.

New AgentProfiles receive the Capability by default; Profile defaults and CampMember overrides
may revoke it for future Runs. The application policy defaults to true and is read inside every
write transaction, so turning it off immediately blocks both tools even for an older Run.
Disabling it does not retire, forget, revise or otherwise change existing Memory or Hearth
proposals.

The two tools share a hard quota of four successful persistent mutations per source AgentRun.
Rejected calls and read-only Memory calls do not consume the quota.

All active capacity is count-based:

```text
Hearth                                      32
Companion per Agent                         32
unordered Relationship pair                12
all Relationship Memory applicable to A     48
```

The Agent-origin subset is additionally bounded:

```text
Hearth                                       0
Companion(A)                                 8
unordered Relationship pair                 4
all Agent-origin Relationship applicable A  16
```

Pair counts include mutual and both directions. A's applicable total includes mutual and
`directed(A → B)`, not `directed(B → A)`. A mutual entry is checked against both members'
applicable totals; a directed entry is checked only against its actor's applicable total. The
same rule applies to the Agent-origin subset. Add and Reactivate consume count capacity; Revision,
Retire and Forget do not add a slot. There is no aggregate Scope byte quota. Each canonical body
remains limited to 2,048 UTF-8 bytes.

Capacity failure never creates a fallback Proposal, evicts existing Memory, truncates content or
silently succeeds. Review remains advisory and has no authority transition; all Lessons use the
same 90-day default regardless of origin, while Preference and Agreement have no automatic review
date.

<a id="adr-0069-atomicity-and-receipts"></a>
#### Atomicity and receipts

All successful Memory writes, Hearth proposal decisions, idempotent command results and body-free
events commit through ADR-0001 in one SQLite transaction. Agent tool receipts state the exact
result:

```text
memory.write            effective active Memory/Revision
memory.propose_hearth   pending, not effective
```

Receipts, events, diagnostics and permanent command results never copy candidate or Memory body
text. Tool discovery, Skill prose, model confidence, repetition and another Agent's agreement do
not substitute for Capability, policy or a required Hearth user decision.

This ADR replaces the general Proposal, provisional/confirmed authority, old automatic-formation
matrix and confirmation semantics of its superseded ADRs in full. It also replaces only
ADR-0057's retained default `memory.propose_change` Capability clause with the default
`memory.write` Capability above; ADR-0057's Member Presence and removal semantics remain effective.
The two mutation tools extend ADR-0014's existing stable Team Tool Gateway and do not introduce a
separate Memory connector or credential.

<a id="adr-0069-consequences"></a>
### Consequences

- The Memory state machine answers effectiveness with Lifecycle alone; provenance remains visible
  without changing model priority.
- Companion and applicable Relationship learning no longer creates a human confirmation queue and
  can revise current content immediately.
- Hearth keeps an explicit user activation boundary because its blast radius spans all
  AgentProfiles.
- Direct Agent revision has meaningful power, so live fencing, strict Scope checks, CAS, Secret
  Filter, count bounds, per-Run quota and the global off switch are mandatory.
- Removing authority tiers deletes same-body confirmation Revisions and provisional capacity, UI,
  export and projection concepts.
- Exact origin and revision actor evidence must survive source Camp/Run deletion without retaining
  source message bodies.

<a id="adr-0069-rejected-alternatives"></a>
### Rejected Alternatives

- Keep `provisional` as an effective lower-priority state: preserves a second authority machine
  and optional confirmation workflow the product no longer needs.
- Make every Agent submission pending: prevents ordinary partner learning and creates review
  work.
- Let Agents write Hearth directly: one Agent could establish guidance for every partner without
  user review.
- Require user confirmation for Agent revisions but not adds: creates inconsistent effectiveness
  and encourages duplicate Memories instead of correction.
- Let an Agent write another Companion or `directed(B → A)`: permits durable assertions outside
  its own bounded identity.
- Turn policy-off into bulk removal: makes a future-facing control unexpectedly destructive.
- Evict old Memory when capacity is full: makes durable behavior disappear without an explicit
  lifecycle command.
- Treat origin as conflict priority: recreates authority tiers under a different field name.

<a id="adr-0069-references"></a>
### References

- [v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0022: Immutable Memory Scope](../v0.10/decisions.md#adr-0022)
- [ADR-0026: Explicit Memory Supersession](../v0.10/decisions.md#adr-0026)
- [ADR-0027: Memory-Domain Forgetting](../v0.10/decisions.md#adr-0027)
- [ADR-0029: Bounded Memory Reactivation](../v0.10/decisions.md#adr-0029)
- [ADR-0057: Member Presence](../v0.15/decisions.md#adr-0057)
- [ADR-0068: Brokered Memory Retrieval](decisions.md#adr-0068)
- [ADR-0024: Closed Memory Kinds](../v0.10/decisions.md#adr-0024)
- [ADR-0025: Proposal-Scoped Memory Provenance](../v0.10/decisions.md#adr-0025)
- [ADR-0036: Agent-Bounded Memory Proposal Scope](../v0.10/decisions.md#adr-0036)
- [ADR-0037: Actor-Bounded Relationship Proposal Direction](../v0.10/decisions.md#adr-0037)
- [ADR-0038: Memory Proposal Staleness](../v0.10/decisions.md#adr-0038)
- [ADR-0039: Memory Proposal Capability](../v0.10/decisions.md#adr-0039)
- [ADR-0040: Terminal Memory Proposal Retention](../v0.10/decisions.md#adr-0040)
- [ADR-0052: Explicit Memory Revision Authority](../v0.13/decisions.md#adr-0052)
- [ADR-0064: Automatic Partner Memory Formation](../v0.18/decisions.md#adr-0064)
<!-- legacy-adr-body:end id=ADR-0069 -->
<!-- legacy-adr:end id=ADR-0069 -->

<!-- legacy-adr:begin id=ADR-0070 source-file-sha256=b8ff8d1476bfcfa5990bd2912abfdb9db720227b15cb12793f740599a24de515 -->
<a id="adr-0070"></a>

## ADR-0070: Normalized SQLite Memory Store v2

迁移时原路径：`docs/adr/0070-normalized-sqlite-memory-store-v2.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0070
title: "Normalized SQLite Memory Store v2"
status: superseded
date: 2026-07-29
decision_scope: cross-version
source_version: v0.21
supersedes: [ADR-0045]
superseded_by: ADR-0179
```

<!-- legacy-adr-body:begin id=ADR-0070 -->
<a id="adr-0070-context"></a>
### Context

ADR-0045 established normalized SQLite authority for Memory, but its table family is centered on a
general `memory_proposal`, Agent-readable Markdown projection observations and no full-text index.
v0.21 removes general Proposals and Agent projection reads, adds immutable Retrieval Keys,
Core-brokered search/read evidence, direct Agent revisions and one Hearth-only proposal boundary.

The application has not shipped, so preserving unreleased Memory rows or a dual schema would add
compatibility code without protecting user data. The new domain contract can replace the
development schema directly while keeping the established SQLite, transaction and immutable
Revision architecture.

<a id="adr-0070-decision"></a>
### Decision

<a id="adr-0070-authoritative-normalized-tables"></a>
#### Authoritative normalized tables

The existing application SQLite database remains the sole Memory authority. Its logical Memory
table families are:

```text
memory
memory_revision
memory_revision_retrieval_key
hearth_memory_proposal
memory_supersession
```

`memory` owns stable identity, immutable Scope/Kind/Relationship Direction, immutable creation
origin, Lifecycle, selected current Revision, Review scheduling, optimistic version and
timestamps.

`memory_revision` owns immutable canonical body text, its Memory ID, creation time and actor
provenance. `memory_revision_retrieval_key` owns the ordered, normalized immutable key set for one
Revision. Bodies and keys remain bounded SQLite text rather than Managed Blobs.

`hearth_memory_proposal` stores only Hearth add/revise candidates, immutable Agent/source
provenance, target/base Revision where applicable, closed `pending | accepted | rejected` status,
resolution metadata and the accepted Revision link. Its candidate body and keys are nullable only
for rejection and Forget clearing. Source Camp/AgentRun/Epoch references are weak audit
identifiers and never cascade-delete application-global provenance.

`memory_supersession` continues to store immutable predecessor-to-successor relationships
independently from Lifecycle.

There is no general `memory_proposal`, Revision authority column, confirmation link, provisional
capacity column or authoritative Memory JSON document. The old Agent Markdown projection and
`memory_projection_observation` are not part of the supported Agent read architecture.

<a id="adr-0070-derived-search-and-access-evidence"></a>
#### Derived search and access evidence

The store includes a reconstructible SQLite FTS5 trigram index over active current Revisions.
Retrieval Keys and body are separate indexed columns with BM25 weights 6 and 1. Lifecycle/current
Revision changes update the derived layer transactionally where possible; integrity failure marks
search unavailable until deterministic rebuild. FTS rows never become an authority for Lifecycle,
Scope, body, keys or access.

Native Session Bootstrap evidence belongs to the context-delivery domain. Memory Search/Read
evidence may use normalized or existing audit/read-side tables, but it stores only digests,
authorization basis, IDs, Revision IDs, cache states and outcomes. It never duplicates complete
queries, snippets, candidate text or Memory bodies.

<a id="adr-0070-transactions-and-constraints"></a>
#### Transactions and constraints

Every authoritative mutation uses the typed DomainCommandGateway and one SQLite immediate
transaction for:

```text
current Binding/Run/Epoch and Capability checks when Agent-originated
live application policy
Scope/Kind/Direction and Presence authorization
Secret Filter and canonicalization
duplicate/no-op checks
expected Memory version and base Revision CAS
ordinary and Agent-origin count capacity
Memory/Revision/Proposal/Supersession rows
derived FTS maintenance
body-free event
idempotent command result
```

Repository methods do not commit independently. Events are audit and idempotency records, not an
event-sourced Memory store. Read models, exports and any diagnostic files are rebuilt from
authoritative rows and cannot be parsed as a write path.

<a id="adr-0070-direct-development-schema-replacement"></a>
#### Direct development-schema replacement

v0.21 replaces the unreleased Memory schema directly. Migration may drop and recreate all old
Memory, Revision, Proposal, projection-observation and Memory-search structures. It does not
backfill, reinterpret or preserve old development Memory rows, infer Memory from conversations or
files, or maintain compatibility views and dual read/write paths.

Non-Memory application data remains outside this reset. Fresh schema seeds
`agentMemoryWritesEnabled = true` and the target capability defaults; it does not synthesize
Memory or Hearth proposals.

This ADR replaces ADR-0045 in full.

<a id="adr-0070-consequences"></a>
### Consequences

- Memory identity, immutable revisions, Hearth proposals and Supersession keep relational
  constraints without a whole-library write conflict.
- The schema directly represents the single-effective-state model and no longer carries dormant
  provisional/general-proposal concepts.
- FTS becomes disposable acceleration rather than a second content or authorization truth.
- Search availability now depends on index integrity and rebuild diagnostics, while direct
  authorized reads remain possible from authoritative rows.
- Development databases lose old Memory data during the v0.21 schema switch; no production
  compatibility machinery is created.
- Forget and rejection must clear every controlled candidate/body location transactionally,
  including linked accepted Hearth proposal text.

<a id="adr-0070-rejected-alternatives"></a>
### Rejected Alternatives

- Evolve the old schema additively and retain compatibility columns: preserves contradictory
  authority and Proposal concepts before launch.
- Keep a general Proposal table with a Scope discriminator: makes unsupported
  Companion/Relationship pending states structurally possible.
- Use Markdown or FTS as the content truth: weakens transaction, Lifecycle and Forget guarantees.
- Put the whole Memory Library in one JSON row: creates coarse conflicts and weak relational
  constraints.
- Add a separate Memory database or event-sourced store: fragments Core transactions and
  introduces a second persistence architecture.
- Backfill durable Memory from chat history or projection files: infers long-term state without a
  valid domain mutation.
- Persist complete search queries or returned bodies as evidence: creates another secret and
  Forget surface.

<a id="adr-0070-references"></a>
### References

- [v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0019: Application-Global Memory Ownership](../v0.10/decisions.md#adr-0019)
- [ADR-0026: Explicit Memory Supersession](../v0.10/decisions.md#adr-0026)
- [ADR-0027: Memory-Domain Forgetting](../v0.10/decisions.md#adr-0027)
- [ADR-0047: User-Initiated Memory Export Boundary](../v0.10/decisions.md#adr-0047)
- [ADR-0068: Brokered Memory Retrieval](decisions.md#adr-0068)
- [ADR-0069: Single Effective Memory](decisions.md#adr-0069)
- [ADR-0045: Normalized SQLite Memory Store](../v0.10/decisions.md#adr-0045)
<!-- legacy-adr-body:end id=ADR-0070 -->
<!-- legacy-adr:end id=ADR-0070 -->
