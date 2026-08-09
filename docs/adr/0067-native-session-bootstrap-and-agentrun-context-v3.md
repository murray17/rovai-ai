---
document_type: adr
id: ADR-0067
title: "Native Session Bootstrap and AgentRun Context v3"
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.21
supersedes: [ADR-0049, ADR-0063]
superseded_by: null
---

# ADR-0067: Native Session Bootstrap and AgentRun Context v3

> [ADR-0100](0100-latest-member-identity-native-session-bootstrap.md) 已替代
> [ADR-0085](0085-run-frozen-six-field-member-identity-context.md)，并局部替代本文的两区段
> Bootstrap、完整 Bootstrap 字节不可变、恢复时不读取当前 Profile，以及 Member Identity
> 所属生命周期条款；Session Charter、Memory Entrypoint 与 AgentRun Dynamic Context 各自的
> 稳定证据仍按 ADR-0100 划分。[ADR-0091](0091-durable-member-calls-and-single-slot-a2a-resume.md)
> 局部替代本文的 A2A `source` alias、reply correlation 和直接 ConversationMessage trigger，
> 改由安全的 Member Call/Outcome ConversationInput 形成 CURRENT_INPUT。本文其余 Bootstrap、
> 动态上下文、恢复与投递合同继续有效。
>
> [ADR-0129](0129-deterministic-bounded-raw-public-context-delivery.md) 局部替代本文的
> SHARED_CONVERSATION 摘要、Coverage、Context Read Marker、ContextManifest 摘要引用和
> Context Compaction 条款；Session Charter、Memory Entrypoint 及其他动态上下文区段继续有效。
>
> [ADR-0146](0146-sole-native-session-self-identity-and-peer-routing-projection.md) 局部替代本文的
> `COLLABORATION_STATE` 条款：当前投影是排除 self、且不含 availability 的 peer routing identity
> v2；本文该区段的旧字段说明不再是当前约束。
>
> [ADR-0147](0147-lossless-model-context-projection-and-layered-delivery-evidence.md) 细化本文的模型字段、
> ContextManifest Evidence 与 Runtime Input Delivery Evidence ownership：当前权威是 Context Source
> State、Model Context Projection、ContextManifest Evidence 与 Runtime Input Delivery Evidence 四层分离。
> 本文的 Bootstrap/Dynamic Context 生命周期、完整 Current Input、Recovery byte reuse 和 accepted-marker
> 语义继续有效。

## Context

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

## Decision

### Two context lifecycles

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

### Immutable Native Session Bootstrap evidence

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

### Session Charter and rotation

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

### Dynamic sections

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

### Trusted A2A reply alias

`team.post_message.recipient` accepts either an explicit authorized Agent routing ID or the
reserved value `source`. `source` is legal only in an A2A-triggered Run and resolves from the
current authenticated Run to its source InboxMessage and sender. If the model omits reply
linkage, Core atomically fills the trusted source linkage only for this resolved recipient.

The alias never causes an automatic response, wake, AgentRun or third-party correlation. All
identity, parent/root/depth, CampTurn, Task, epoch, quota and idempotency facts remain Core-owned.

### ContextManifest, coverage and recovery

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

### Task and attachment boundaries

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

## Consequences

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

## Rejected Alternatives

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

## References

- [v0.21 Native Session Bootstrap 与 AgentRun 动态上下文重构](../versions/v0.21/README.md)
- [ADR-0007: Portable Conversation Handoff](0007-portable-conversation-handoff.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [ADR-0050: Camp-Shared Progressive Summaries](0050-camp-shared-progressive-summaries.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
- [ADR-0058: Collaboration v4](0058-collaboration-v4-presence-aware-admission.md)
- [ADR-0059: Runtime-Owned Resource Permissions](0059-runtime-owned-resource-permissions.md)
- [ADR-0062: Interruptible Runs and Unsettled External Effects](0062-interruptible-runs-and-unsettled-external-effects.md)
- [ADR-0049: Reproducible Context Delivery v2](0049-reproducible-context-delivery-v2.md)
- [ADR-0063: Minimal A2A Turn Envelope](0063-minimal-a2a-turn-envelope-and-reply-correlation.md)
