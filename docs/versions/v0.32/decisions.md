---
document_type: version-decisions
version: v0.32
lifecycle: historical
last_updated: 2026-08-18
---

# v0.32 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0091](#adr-0091) | Durable Member Calls and Single-Slot A2A Resume Scheduling | `superseded` |

<!-- legacy-adr:begin id=ADR-0091 source-file-sha256=a9583b3d67e8e7808f84a3b35e9973301e2054767f81602d3512bdf92becfde8 -->
<a id="adr-0091"></a>

## ADR-0091: Durable Member Calls and Single-Slot A2A Resume Scheduling

迁移时原路径：`docs/adr/0091-durable-member-calls-and-single-slot-a2a-resume.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0091
title: Durable Member Calls and Single-Slot A2A Resume Scheduling
status: superseded
date: 2026-08-02
decision_scope: cross-version
source_version: v0.32
supersedes: []
superseded_by: ADR-0099
```

<!-- legacy-adr-body:begin id=ADR-0091 -->
> Superseded by [ADR-0099](../v0.34/decisions.md#adr-0099), which preserves durable
> persist-first scheduling but removes Return Policy, Return Obligation, Call Outcome, and every
> privileged return-edge semantic.

<a id="adr-0091-context"></a>
### Context

`team.post_message` atomically persisted an A2A message and immediately created a queued AgentRun.
When a coordinator delegated work, its only way to wait for results was to keep the current Run
alive and repeatedly call `team.list_tasks`, often with `sleep`. That wastes model turns, makes
collaboration depend on polling, creates multiple queued Runs for one Conversation, and cannot
represent a durable accepted execution request before the recipient is ready to run.

The old reply contract also exposed a `source` alias and optional reply/correlation identifiers.
It did not define whether a requested member must answer, what happens when the callee terminates
without answering, or how an idle caller is resumed exactly once. A timer-based reply batch would
only trade polling for latency and would prematurely encode fan-in behavior that belongs to the
future Rovai Collaborative Execution Graph.

Rovai-ai needs a first-stage protocol in which any Camp member can call any other eligible member,
end the current Run when only waiting remains, and receive later results as new inputs without
polling, batching, forged Agent messages, or concurrent Turns for one Conversation.

<a id="adr-0091-decision"></a>
### Decision

<a id="adr-0091-member-call-contract"></a>
#### Member Call contract

The execution tool is renamed without compatibility aliases:

```text
team.call_member({
  recipient: AgentProfileId,
  content: string,
  returnPolicy: "none" | "required",
  taskId?: TaskId
})
```

`team.post_message`, `post_message`, `source`, `inReplyToMessageId`, generic `references[]`, and
their send-message aliases cease to be accepted tool contracts. `call_member` always requests one
recipient execution opportunity; it is never a passive notification. The caller may complete
independent local cleanup, but must not sleep or poll for the result and should end the Run when
only waiting remains. A future passive notification requires a different tool.

The optional Task is validated only at acceptance: it belongs to the same Camp, is non-terminal,
and is assigned to the recipient. It is a frozen historical link, not a dependency, responsibility
transfer, completion proof, cancellation trigger, or retargeting rule.

<a id="adr-0091-persist-first-conversation-input"></a>
#### Persist-first Conversation Input

Every accepted Member Call first creates one durable `ConversationInput`; an idle recipient does
not take a direct AgentRun fast path. The same transaction creates the authored InboxMessage and,
for `returnPolicy=required`, a Return Obligation. The model-visible receipt says only `accepted` and
does not expose Inbox, ConversationInput, Obligation, AgentRun, lineage, quota, or scheduling IDs.

`ConversationInput` is distinct from InboxMessage, AgentRun, and model-visible Current Input:

```text
kind    = member_call | call_outcome
status  = pending | materialized | failed | cancelled
key     = (conversation_id, sequence)
links   = source InboxMessage?, Return Obligation?, consuming AgentRun?
data    = model-safe payload + frozen execution basis
times   = created, materialized?, terminal?
```

One input is materialized at most once; one AgentRun consumes at most one input. Materialization
atomically claims the smallest pending sequence of an idle Conversation, creates one queued Run,
marks the input materialized, and binds the Run. A Conversation is busy when it owns a queued,
running, or waiting Run. No input type, Agent role, or Return Policy changes FIFO priority. The
first-stage protocol neither batches nor skips replies.

The frozen execution basis is immutable. Materialization performs Core-domain and SQLite
validation, including current Capability coverage and whether the persisted Installation identity
still matches the frozen basis. Live filesystem, process, executable-identity, authentication, and
Runtime-health checks remain at AgentRun dispatch. Transient capacity, contention, or restart
leaves input pending. A deterministic non-retryable Core failure before Run creation marks it failed
rather than pending or cancelled.

In-memory notifications are latency hints only. Acceptance, terminalization, and capacity release
request immediate reconciliation; startup and bounded periodic scans recover missed hints. SQLite
Immediate transactions, Conversation busy predicates, and Input/Run uniqueness constraints provide
exactly-once A2A Input materialization across crashes. Existing directly admitted Runs may remain
queued for the same Conversation; the running/waiting uniqueness boundary still serializes execution.

<a id="adr-0091-return-obligation-and-outcome"></a>
#### Return Obligation and Outcome

Each required call creates exactly one Return Obligation for its single consuming Run. The first
`call_member` from that Run whose recipient equals the original caller atomically satisfies the
old Obligation. The new call's Return Policy independently decides whether it creates a reverse
Obligation. Calls to other members do not satisfy it.

An Obligation leaves `open` at most once:

```text
open -> satisfied_by_member_call
open -> satisfied_by_core_outcome
open -> cancelled_by_turn
```

The explicit-return transaction persists its new InboxMessage/input, consumes the reserved return
slot, creates any requested reverse Obligation, and closes the old Obligation. If the consuming Run
terminalizes first, the same terminal transaction closes the Obligation and creates exactly one
Core-authored `call_outcome` input. A terminal Run with an open Obligation is never a committable
database state. The first competing transaction wins; execution-epoch fencing rejects a late tool
call from an already-terminal Run.

A pre-Run input failure can also satisfy a required Obligation with an Outcome. Model-visible
Outcome facts are limited to the callee Agent ID/name plus:

```text
stage=materialization, status=failed, reason=execution_not_started
stage=run, status=succeeded|failed|cancelled, reason=no_explicit_return
```

The standard message states that no business result was provided or verified. It never creates a
fake InboxMessage, impersonates the callee, copies final output, raw errors, logs, original content,
or internal IDs. UI and Audit retain the real internal links.

<a id="adr-0091-logical-depth-and-bounded-run-slots"></a>
#### Logical depth and bounded Run slots

The existing per-Turn maximum remains sixteen possible A2A Runs, but capacity is allocated at call
acceptance so pending inputs cannot overcommit it. A `none` call allocates the callee slot. A
`required` call additionally reserves one slot on its Obligation for an explicit return or Outcome.
A qualifying return consumes that reservation; a new reverse Obligation must reserve another slot
atomically. Allocated slots are not recycled during the Turn.

A forward call increases logical A2A depth. A return or Outcome closes the call edge and resumes at
the preserved caller depth; it does not add another outward nesting level. The existing maximum
depth of five applies to forward nesting. Total Run-slot allocation bounds repeated ping-pong.

<a id="adr-0091-current-input-settlement-and-stop"></a>
#### Current Input, settlement, and Stop

Member Call Current Input contains only:

```json
{
  "source": {
    "type": "member_call",
    "senderMemberId": "...",
    "senderName": "...",
    "returnPolicy": "required"
  },
  "message": "..."
}
```

Call Outcome uses the safe structure above. There is no reply alias or model-visible correlation.

A CampTurn remains non-terminal while any ConversationInput is pending, any AgentRun is queued,
running, or waiting, or any Return Obligation is open. After settlement, explicit Turn Stop wins;
otherwise an unsuperseded required Run or input failure makes the Turn failed, an independent
required cancellation makes it cancelled, and only the all-successful remainder completes.
Outcome handling offers explanation or recovery but does not erase technical failure.

CampTurn Stop atomically fences the whole collaboration scope, cancels unmaterialized inputs and
open Obligations as `cancelled_by_turn`, and forbids later Resume Runs or Outcomes. InboxMessages
and Audit facts remain. Cancelling only one Run while its Turn remains active still produces the
ordinary cancelled Outcome.

<a id="adr-0091-relationship-to-earlier-adrs"></a>
#### Relationship to earlier ADRs

This ADR locally replaces ADR-0014's immediate A2A AgentRun creation and old post-message contract,
and ADR-0067's A2A `source` alias/reply-correlation Current Input clauses. It preserves ADR-0073's
Agent-authored private InboxMessage projection, while replacing only its old tool name and direct
target-Run timing. It refines ADR-0062/ADR-0077/ADR-0079 by extending CampTurn cancellation to
Conversation Inputs and Return Obligations. Attested gateway and tool-parity transport boundaries
from ADR-0088 and ADR-0089 remain unchanged.

<a id="adr-0091-consequences"></a>
### Consequences

- Coordinators and peers can end a waiting Run and resume automatically from durable A2A input.
- A2A execution is serialized per Conversation without reply batching or polling.
- Accepted calls survive Core restart and cannot disappear between message persistence and Run
  creation.
- Exactly-once return requires new durable entities, terminal-transaction integration, slot
  reservation, recovery scans, and stricter database constraints.
- A callee final output is not treated as a return; Agents must explicitly call the caller or the
  caller receives a safe lifecycle Outcome.
- First-stage recovery remains conservative. Multi-source fan-in, formal supersession, graph-based
  recovery, and reply batching remain deferred to Rovai Collaborative Execution Graph.
- The rename is intentionally breaking. Existing local data may be rebuilt; no tool alias or old
  request-shape compatibility is promised.
- The breaking built-in catalog uses Attested Team Protocol 3 and Antigravity Alias Map 2 so an
  old Bridge/catalog cannot silently claim compatibility with the new call contract.

<a id="adr-0091-rejected-alternatives"></a>
### Rejected Alternatives

<a id="adr-0091-keep-polling-with-sleep--list_tasks"></a>
#### Keep polling with `sleep + list_tasks`

Rejected because it consumes turns, delays completion, and makes model behavior responsible for a
Core scheduling obligation.

<a id="adr-0091-create-a-queued-agentrun-immediately-for-every-member-call"></a>
#### Create a queued AgentRun immediately for every Member Call

Rejected because multiple Input-derived queued Runs can accumulate for one Conversation and because
message acceptance, execution availability, and Run lifecycle remain conflated. This does not remove
the existing ability to queue multiple direct User-triggered Runs for Scheduler serialization.

<a id="adr-0091-timer-based-reply-batching-or-root-fan-in"></a>
#### Timer-based reply batching or root fan-in

Rejected for this stage because short windows do not match heterogeneous Runtime duration, long
windows delay users, and root convergence belongs to the future graph model.

<a id="adr-0091-boolean-requiresreply"></a>
#### Boolean `requiresReply`

Rejected in favor of a required closed enum that has no implicit default and can evolve without
turning a Boolean into multiple meanings.

<a id="adr-0091-reuse-final-output-as-an-implicit-reply"></a>
#### Reuse final output as an implicit reply

Rejected because final output is not necessarily addressed to the caller, may contain unsafe or
unverified claims, and would fabricate a collaboration message the callee did not send.

<a id="adr-0091-put-scheduling-state-on-inboxmessage-or-pre-create-agentrun"></a>
#### Put scheduling state on InboxMessage or pre-create AgentRun

Rejected because Core Outcomes have no InboxMessage and because execution responsibility needs an
independent durable lifecycle before a Run exists.

<a id="adr-0091-references"></a>
### References

- [v0.32 Event-Driven Member Calls](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0062: Interruptible Run Trees and Unsettled External Effects](../v0.17/decisions.md#adr-0062)
- [ADR-0067: Native Session Bootstrap and AgentRun Context v3](../v0.21/decisions.md#adr-0067)
- [ADR-0073: Agent-Authored A2A Conversation Messages](../v0.24/decisions.md#adr-0073)
- [ADR-0088: Attested Native Team Gateway Attachment](../v0.30/decisions.md#adr-0088)
- [ADR-0089: Attested Built-in MCP Tool Parity](../v0.31/decisions.md#adr-0089)
<!-- legacy-adr-body:end id=ADR-0091 -->
<!-- legacy-adr:end id=ADR-0091 -->
