---
document_type: version-decisions
version: v0.49
lifecycle: historical
last_updated: 2026-08-18
---

# v0.49 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0144](#adr-0144) | Self-Contained Duo Grilling Bundled Skills | `superseded` |
| [ADR-0145](#adr-0145) | Core-Owned Pending Camp Draft Activation | `accepted` |

<!-- legacy-adr:begin id=ADR-0144 source-file-sha256=fd3db852672a963faa8dbfdaa26224d2a901082d9c81f5c7cd23d6e1abfa359e -->
<a id="adr-0144"></a>

## ADR-0144: Self-Contained Duo Grilling Bundled Skills

迁移时原路径：`docs/adr/0144-self-contained-duo-grilling-bundled-skills.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0144
title: Self-Contained Duo Grilling Bundled Skills
status: superseded
date: 2026-08-09
decision_scope: cross-version
source_version: v0.49
supersedes:
  - ADR-0109
superseded_by: ADR-0150
```

<!-- legacy-adr-body:begin id=ADR-0144 -->
<a id="adr-0144-context"></a>
### Context

Rovai's official Skill sources are project-visible packaging inputs whose immutable revisions are delivered through
explicit Runtime-group assignments. The existing official set covers memory stewardship and Task-scoped worktrees,
but it does not provide a product-owned workflow for stress-testing a plan with a second Camp member.

The proposed duo workflows were derived from `grill-me`, `grill-with-docs`, `grilling`, and `domain-modeling`.
Publishing those generic Skills as independent runtime dependencies would couple success to multiple enablement and
assignment choices. A Runtime could receive the duo entry without one of its dependencies, and generic names would
unnecessarily occupy the official namespace. Camp collaboration is also asynchronous: `camp.message.send` creates a
public Message and recipient Delivery, not a synchronous response or automatic closure.

<a id="adr-0144-decision"></a>
### Decision

Rovai ships four official Skills:

- `rovai-memory-stewardship` (“共同记忆维护”);
- `rovai-worktree` (“隔离 Worktree”);
- `rovai-grill-duo` (“双人追问”);
- `rovai-grill-duo-with-docs` (“双人追问与文档”).

Every official Skill remains installed enabled and without a default Skill Group Assignment. Official names retain
the `rovai-` prefix, and availability never grants filesystem, Git, documentation, collaboration, or implementation
authority.

The complete source of every official Skill remains under `skills/<skill-name>/`, with `SKILL.md`, matching
`agents/openai.yaml`, and all required references. Core embeds that exact manifest and publishes it through the
existing immutable SkillRevision installation path. Repository source is not a Runtime discovery root.

Both duo Skills are runtime-self-contained:

- `rovai-grill-duo` embeds the full one-question-at-a-time grilling procedure and fixed-partner workflow;
- `rovai-grill-duo-with-docs` carries its own duo protocol, domain-modeling discipline, glossary format, and ADR
  judgment reference;
- `grill-me`, `grill-with-docs`, `grilling`, and `domain-modeling` remain design inputs, not official runtime
  dependencies and not separately bundled Rovai Skills.

For each decision point, the current member sends one explicit public A2A request to the fixed partner without
including its own recommendation. The request contains enough instructions for a partner that does not have the duo
Skill assigned. The partner explicitly replies to the questioner with plain-language trade-offs and an independent
recommendation; the questioner then asks the user exactly one question. Neither Skill treats send acceptance as
completion, polls for a response, invents a second opinion, or assumes a protocol-level reply obligation. When no
eligible partner exists, the Skill discloses a single-member fallback.

This ADR replaces ADR-0109 while retaining its project-visible source, synchronized manifest/test updates, and safe
managed-delivery rules. ADR-0105 continues to own enablement, assignment, projection, conflict, and exposure semantics.

<a id="adr-0144-consequences"></a>
### Consequences

- Either duo variant works when assigned alone; users do not need to discover or align hidden dependency assignments.
- Documentation behavior remains portable because repository-specific documentation rules override bundled defaults.
- The async public collaboration chain is visible and auditable, but the second opinion can require multiple AgentRuns.
- Shared duo instructions are intentionally duplicated between immutable Skill revisions and must be kept aligned by
  source review and bundled installation tests.
- Adding or removing an official Skill still requires synchronized source, Core manifest, terminology, UI copy, and
  smoke/acceptance updates.

<a id="adr-0144-rejected-alternatives"></a>
### Rejected Alternatives

- Bundle every generic dependency: rejected because it expands the official namespace and still requires coordinated
  Runtime-group assignments.
- Let `rovai-grill-duo-with-docs` invoke the other duo Skill by name: rejected because assigning only the documentation
  variant would leave a runtime dependency missing.
- Inject duo instructions into every AgentRun prompt: rejected because it bypasses user-controlled Skill assignment and
  native progressive discovery.
- Treat `rovai send` success as a synchronous teammate result: rejected because Message Delivery owns asynchronous
  dispatch and the success projection does not prove work started or completed.

<a id="adr-0144-references"></a>
### References

- [ADR-0105: Runtime-Group Assigned Rovai Skill Delivery](../v0.37/decisions.md#adr-0105)
- [ADR-0130: Public A2A Messages and Unified Message Delivery](../v0.45/decisions.md#adr-0130)
- [Camp Message Send v2](../../contracts/camp-message-send-v2.md)
- [v0.49 overview](README.md)
- [Skill settings UI strategy](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [Domain terminology](../../../CONTEXT.md)
<!-- legacy-adr-body:end id=ADR-0144 -->
<!-- legacy-adr:end id=ADR-0144 -->

<!-- legacy-adr:begin id=ADR-0145 source-file-sha256=4a6063060849f6c34f7889d6bcc4447e6b8301bab8992b2ef6af9348de0dbf42 -->
<a id="adr-0145"></a>

## ADR-0145: Core-Owned Pending Camp Draft Activation

迁移时原路径：`docs/adr/0145-core-owned-pending-camp-draft-activation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0145
title: Core-Owned Pending Camp Draft Activation
status: accepted
date: 2026-08-09
decision_scope: cross-version
source_version: v0.49
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0145 -->
<a id="adr-0145-context"></a>
### Context

ADR-0071 makes an explicitly created empty Camp a durable collaboration aggregate. ADR-0080 and ADR-0128 make the
Camp Composer Draft Core-owned and require an exact stored Draft Revision for user message submission. Those rules
remain correct for the explicit creation Dialog, but a one-click entry should behave like a new-conversation draft:
opening it must not immediately add an empty formal Camp to navigation or replace the last stable restore target.

A Renderer-only draft cannot satisfy this behavior. It would have no stable Camp identity for the existing Composer
Draft and attachment stores, and sequential “create Camp, then save draft, then send” would reintroduce partial states
at the first-message boundary.

<a id="adr-0145-decision"></a>
### Decision

Camp has a Core-owned `pending | active` activation state. Existing Camps, omitted creation-state inputs, and the
explicit creation Dialog use `active`; only confirmed one-click creation requests `pending`.

A Pending Camp is a private new-conversation aggregate with its selected workspace, members, Lead and Composer Draft:

- creating it does not emit `camp.created` and an empty Pending Camp is absent from Navigation and Camp history lists;
- a Pending Camp whose authoritative Composer Draft has non-whitespace content or prepared attachments appears in
  Navigation with activation state `pending`, and Renderer labels it “草稿”;
- only Composer Draft/attachment mutation, guarded discard, and the first user-message submission are admitted before
  activation; ordinary Camp configuration and Task mutation require an Active Camp;
- a Pending Camp becomes Active in the same SQLite transaction that accepts and persists its first user message.
  That transaction emits `camp.activated` before the normal message event. Any validation, version, addressing,
  Runtime preflight, or persistence rejection leaves both the Pending state and exact Draft unchanged;
- discard is idempotent and can delete only a Pending Camp with no meaningful Draft, public message, execution,
  Task, Conversation, or other domain fact. It can never delete an Active Camp. Startup performs the same guarded
  cleanup for abandoned empty Pending Camps;
- a meaningful Pending Draft is a restorable Camp location. An empty Pending Camp is not a stable Restorable Location;
  leaving it discards it, while process interruption is repaired by startup cleanup.

Activation does not pre-create Agent Conversations. ADR-0071's lazy per-target Conversation allocation and
ADR-0128's exact Core-owned Draft Revision submission remain unchanged. The explicit creation Dialog also keeps the
ADR-0071 behavior that a user-confirmed zero-message Active Camp is durable until explicit deletion.

<a id="adr-0145-consequences"></a>
### Consequences

- One-click entry can open a fully functional Composer immediately without creating visible empty Camp history.
- Non-empty unsent content and attachments survive Renderer reload and application restart under Core authority.
- First-message activation, generated title, message persistence, attachment consumption, CampTurn creation, and
  AgentRun admission share one transaction and cannot expose a half-activated Camp.
- Navigation and Camp Snapshot contracts expose activation state, and SQLite Migration 67 defaults all existing rows
  to `active`.
- Pending cleanup requires a narrow Core command and startup reconciliation; Renderer disappearance alone is never
  treated as proof that deletion is safe.

<a id="adr-0145-rejected-alternatives"></a>
### Rejected Alternatives

- Keep the entire draft only in Renderer memory: rejected because it loses restart durability and duplicates the
  authoritative Composer Draft.
- Create an ordinary Active Camp and merely hide it until input: rejected because the formal Camp and restore/audit
  facts would already exist despite the product promise.
- Create the Camp only when Send is clicked: rejected because attachments and autosaved structured content already
  require a stable Core Camp identity.
- Activate when the first character is typed: rejected because unsent content must remain distinguishable and
  discardable as a draft.

<a id="adr-0145-references"></a>
### References

- [ADR-0071: Configured Camp Creation and Lazy Conversations](../v0.22/decisions.md#adr-0071)
- [ADR-0080: Durable Camp Composer Draft and Atomic Attachment Consumption](../v0.25/decisions.md#adr-0080)
- [ADR-0128: Structured Draft-Only User Camp Message Submission](../v0.43/decisions.md#adr-0128)
- [v0.49 production design](production-design.md)
<!-- legacy-adr-body:end id=ADR-0145 -->
<!-- legacy-adr:end id=ADR-0145 -->
