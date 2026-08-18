---
document_type: version-decisions
version: v0.22
lifecycle: historical
last_updated: 2026-08-18
---

# v0.22 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0071](#adr-0071) | Configured Camp Creation and Lazy Conversations | `accepted` |

<!-- legacy-adr:begin id=ADR-0071 source-file-sha256=9adcad9324441044b1899692b4033c43d07c112abec6945bc54a0a8c5f8083d4 -->
<a id="adr-0071"></a>

## ADR-0071: Configured Camp Creation and Lazy Conversations

迁移时原路径：`docs/adr/0071-configured-camp-creation-and-lazy-conversations.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0071
title: Configured Camp Creation and Lazy Conversations
status: accepted
date: 2026-07-29
decision_scope: cross-version
source_version: v0.22
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0071 -->
<a id="adr-0071-context"></a>
### Context

ADR-0058 binds Camp creation to the first non-empty user message. That operation snapshots every
present AgentProfile, chooses the first Runtime-configured member as Default Lead, allocates one
Conversation per member, performs execution admission and then atomically creates the Camp,
message, turn and runs. A later CampMember add or reactivation also eagerly creates its
Conversation.

This makes a user-visible Camp depend on Runtime availability even though Camp membership and Lead
identity are collaboration structure, not executable state. It also makes an empty private
continuity row exist for every member before that member has ever been an execution target.
Renderer cannot persist the user's intended membership, Lead, repository binding or collaboration
mode until a message is sent, so “new conversation” remains a lightweight draft rather than an
explicit durable domain action.

Rovai-ai now needs creation to establish the configured collaboration context first and execution
admission to happen only when the user later submits work. The boundary is costly to reverse
because it changes the Camp aggregate transaction, schema, idempotent command contract, Read Side,
Runtime Resolution flow and the invariant between CampMember and Conversation.

This ADR locally replaces ADR-0058's **New Camp creation**, eager one-Conversation-per-member
allocation, eager Conversation allocation on later CampMember add/reactivation, and “no stored
empty Camp” clauses. ADR-0058's remaining Presence, addressing, execution-admission, Task and
permanent-deletion semantics continue to apply.

<a id="adr-0071-decision"></a>
### Decision

<a id="adr-0071-camp-creation-is-its-own-domain-action"></a>
#### Camp creation is its own domain action

The user-only, idempotent Camp creation command accepts one complete configuration:

```ts
type CreateConfiguredCamp = {
  name: string | null;
  projectPath: string;
  repository: RepositoryBinding | null;
  memberAgentProfileIds: string[];
  defaultLeadAgentProfileId: string;
  collaborationMode: "peer" | "lead_coordinated";
};
```

Core revalidates the exact request at command admission. The member set must be non-empty, contain
only distinct currently `present` AgentProfiles, and include the requested Default Lead. Repository
Binding must still identify the exact selected local Git worktree when present. Core never removes
a stale member, chooses a replacement Lead, changes mode or falls back to the Lobby.

An accepted command atomically creates exactly:

- one Camp, including normalized name, internal name origin, Repository Binding, collaboration
  mode and Default Lead;
- one current CampMember relationship for each requested member.

It creates no Conversation, CampMessage, ConversationMessage, CampTurn, AgentRun, Native Session,
Native Session Bootstrap or execution workspace. Camp creation performs collaboration-structure
validation only. It does not perform Runtime Resolution or Runtime Readiness admission and may
succeed when no selected member can currently execute.

The durable collaboration mode is a closed `peer | lead_coordinated` value. `peer` routes an
unaddressed user execution request only to the persisted Default Lead; it is not broadcast.
`lead_coordinated` reserves the future policy in which only the Default Lead directly converses
with the user. v0.22 accepts only `peer`; requesting `lead_coordinated` is a Core rejection rather
than a Renderer-only guard. A future explicit mode change affects only later routing and never
rewrites history, membership or Conversations.

<a id="adr-0071-camp-name-and-origin-are-durable"></a>
#### Camp name and origin are durable

Core normalizes a name by trimming outer whitespace and collapsing internal whitespace. A name is
limited to 80 Unicode scalar values.

Camp persists an internal origin:

```ts
type CampNameOrigin = "default" | "generated" | "user";
```

- blank creation input stores `未命名对话` with origin `default`;
- non-blank creation input stores the normalized name with origin `user`;
- a later explicit rename always stores origin `user`, including when the value is exactly
  `未命名对话`;
- only the first accepted user execution submission may change a `default` origin to `generated`.

Generated naming is synchronous and deterministic Core behavior: normalize the accepted first user
message and take its first 80 Unicode scalar values. It is not delegated to an Agent, Runtime, LLM
or asynchronous job. A user-origin name is never automatically replaced.

<a id="adr-0071-conversation-is-allocated-only-for-admitted-targets"></a>
#### Conversation is allocated only for admitted targets

Conversation remains one AgentProfile's private continuity inside one Camp, unique by
`(camp_id, agent_profile_id)`, but CampMember no longer implies that a Conversation row already
exists.

For a user execution submission, Core first resolves the exact targets according to the persisted
mode, Default Lead and explicit addressing, then performs all execution admission required by
ADR-0058, ADR-0059 and ADR-0066. A multi-target submission remains all-or-none.

After every target passes final admission, one SQLite transaction:

1. creates a missing Conversation for each exact target, or reuses that target's existing
   Conversation;
2. persists the CampMessage and CampTurn;
3. creates all requested AgentRuns;
4. if the Camp name origin is still `default`, persists the deterministic generated name and
   changes its origin to `generated`;
5. consumes the corresponding resolved Pending Execution Intent when ADR-0066 required one.

Non-target CampMembers remain without Conversations. A rejection creates none of the submission's
Conversation, message, turn or run records and leaves Camp name and origin unchanged. Runtime
Resolution Job and Pending Execution Intent may exist before final admission as orchestration
records under ADR-0066, but they do not authorize partial collaboration or execution artifacts.

Adding or reactivating a CampMember later does not create a Conversation. If that AgentProfile has
an existing Conversation, its private continuity remains available; otherwise the row is created
only when a later admitted execution targets that member.

<a id="adr-0071-durable-empty-camps"></a>
#### Durable empty Camps

A configured Camp is valid with zero public messages and zero Conversations. It remains in the
Lobby or Project navigation until the user explicitly and permanently deletes it. Cancellation of
the transient creation UI persists nothing; cancellation after successful creation is not a
separate lifecycle and does not remove the Camp.

<a id="adr-0071-consequences"></a>
### Consequences

- “Create” becomes a real durable boundary and can fail independently from sending work.
- Camp membership, Default Lead, Project Binding and collaboration mode are inspectable before any
  Runtime is contacted.
- Runtime outages do not block configuration, but the first execution may still fail admission
  while the empty Camp remains durable.
- Read Side and membership code must tolerate CampMembers without Conversations.
- Execution address resolution can no longer use an inner join to Conversation before admission;
  it must resolve member identities first and allocate continuities inside the final transaction.
- Camp snapshots, navigation and deletion must work for zero-message, zero-Conversation Camps.
- Name origin adds internal state but prevents deterministic auto-naming from overwriting explicit
  user intent.
- The v0.22 pre-release migration may directly replace incompatible collaboration schema and data;
  no dual read, backfill or legacy first-message creation path is required.

<a id="adr-0071-rejected-alternatives"></a>
### Rejected Alternatives

<a id="adr-0071-keep-first-message-camp-creation"></a>
#### Keep first-message Camp creation

Rejected because collaboration configuration would remain transient and Runtime admission would
continue to decide whether the user's Camp identity exists.

<a id="adr-0071-create-camp-and-one-empty-conversation-per-member"></a>
#### Create Camp and one empty Conversation per member

Rejected because membership does not prove that a member has execution continuity, and it
unnecessarily couples Camp creation and later member lifecycle to private Runtime-facing state.

<a id="adr-0071-create-a-conversation-for-every-member-on-the-first-message"></a>
#### Create a Conversation for every member on the first message

Rejected because only exact execution targets need continuity. Non-target members must not gain
empty Conversations as a side effect of another member's execution.

<a id="adr-0071-choose-another-ready-lead-or-drop-stale-members-automatically"></a>
#### Choose another ready Lead or drop stale members automatically

Rejected because it silently changes the configuration the user confirmed. Structural staleness
must reject atomically and retain the draft for explicit correction.

<a id="adr-0071-make-peer-broadcast-by-default"></a>
#### Make `peer` broadcast by default

Rejected because the established Default Lead remains the unaddressed recipient. Fan-out requires
explicit addressing and stays subject to all-target admission.

<a id="adr-0071-generate-the-title-asynchronously-with-an-agent-or-llm"></a>
#### Generate the title asynchronously with an Agent or LLM

Rejected because naming would become nondeterministic, create a job/recovery lifecycle, and allow
later automation to overwrite a durable user-facing identity.

<a id="adr-0071-preserve-the-legacy-flow-through-compatibility-branches"></a>
#### Preserve the legacy flow through compatibility branches

Rejected because the product is not released and development data can be rebuilt. Compatibility
would permanently complicate command, schema and Read Side invariants without protecting user data.

<a id="adr-0071-references"></a>
### References

- [v0.22 version scope](README.md)
- [v0.22 architecture](architecture.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0058: Collaboration v4](../v0.15/decisions.md#adr-0058)
- [ADR-0059: Runtime-Owned Resource Permissions](../v0.16/decisions.md#adr-0059)
- [ADR-0066: Managed Product Runtime Resolution](../v0.20/decisions.md#adr-0066)
- [Domain vocabulary](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0071 -->
<!-- legacy-adr:end id=ADR-0071 -->
