# Rovai-ai

Rovai-ai is a local multi-Agent workbench in which long-lived Agent identities collaborate inside Camps while retaining independent conversational continuity.

## Language

**Camp**:
A long-lived shared collaboration context containing participants, public discussion, private Agent continuities, resources, and outcomes. A Camp becomes durable when its configured creation is accepted and may validly contain no public messages until the user submits one. A Camp created without a user-configured name starts as `未命名对话`; its first accepted user message generates the name only while the user has never explicitly named or renamed that Camp. The product may present a Camp as a conversation, but domain code must not call it a Conversation. User deletion permanently removes the Camp aggregate; Rovai-ai does not model Camp archive or trash.
_Avoid_: Public Conversation, Task, Project, Archived Camp

**Camp Name**:
The user-facing title of one Camp. Core trims outer whitespace and collapses internal whitespace runs before enforcing a maximum of 80 Unicode scalar values. Blank optional creation input becomes `未命名对话`; over-limit user input is rejected without truncation. First-message generation applies the same normalization to the accepted first user message and deterministically takes its first 80 Unicode scalar values. It is a synchronous Core rule in the message transaction and never invokes an Agent, Product Runtime, or language model.
_Avoid_: unbounded message body, Renderer-only validation, Project name, Conversation name, model-generated title, asynchronous naming job

**Camp Name Origin**:
The internal persisted state `default | generated | user` that controls one-time automatic Camp naming. Blank creation stores `default`; the first accepted user message changes it to `generated` while deriving the Camp name; a name supplied during creation or any later user rename stores `user`, even when the text is exactly `未命名对话`. It is never shown as a product-facing status, badge, summary, or label.
_Avoid_: title-text inference, user-visible naming mode, rename audit log

**New Conversation Draft**:
A transient user preparation for Camp creation. It has no durable collaboration identity and is neither a Camp nor a domain Conversation. The user may optionally configure its Camp name; an omitted name becomes `未命名对话`. The `创建` action submits this configuration to Core; an accepted creation establishes the durable Camp before any public message exists, consumes the Draft, and enters the new Camp workspace with its message composer focused. There is no intermediate post-creation Draft page. Failed creation retains the Draft and its configuration for correction. Renderer snapshots are advisory: Core revalidates the exact Initial Camp Membership, Default Lead, supported Camp Collaboration Mode, and optional selected Workspace Directory at creation admission. A stale member or unsafe directory rejects creation atomically for user reconfirmation; Core never silently rewrites membership, changes the Lead, initializes Git, or falls back to Quick Chat.
_Avoid_: Draft Camp, Conversation, first-message creation

**Camp Creation**:
The user-only, idempotent Core action that atomically turns a valid New Conversation Draft into one Camp row and its selected CampMember relationships, including Camp name and origin, Camp Workspace Binding, Camp Collaboration Mode, and Default Lead. It validates collaboration structure but performs no Runtime Resolution or execution Readiness admission, so a Camp may be created when none of its members can currently execute. The disabled `lead_coordinated` option is rejected by Core as unsupported rather than guarded only by Renderer state. Camp Creation creates no Conversation, CampMessage, CampTurn, AgentRun, Native Session, or Native Session Bootstrap; those records begin only when later behavior requires them.
_Avoid_: first-message creation, Renderer-only state transition, eager Conversation allocation

**Quick Chat**:
The product-facing and domain name for Rovai-ai's application-managed workspace group for Camps that are not bound to a user-selected directory, displayed in Chinese as `快速对话`. It uses one managed workspace directory but is neither a Camp nor a Project; each contained Camp keeps its own identity and lifecycle.
_Avoid_: Lobby, 大厅, Project, Quick Chat entity

**Project**:
A product-facing read-time group of `directory` Camps whose canonical `projectPath` strings are equal. It has no independent identity, repository identity, table, or lifetime apart from those Camps. Its stable read key is `directory:<canonical-project-path>`; Git metadata never affects grouping.
_Avoid_: Project entity, Project aggregate, standalone project record

**Camp Workspace Binding**:
The durable `projectBindingKind: quick_chat | directory` and canonical absolute `projectPath` carried by every Camp. `quick_chat` uses Rovai-ai's managed Quick Chat directory and remains Quick Chat even if Git metadata appears there. `directory` uses the exact safe directory explicitly selected by the user. The directory is the persistent workspace identity; no Repository Binding or Repository Scope is stored.
_Avoid_: Repository Binding, Repository Scope, Project foreign key, Git identity

**New Conversation Workspace Selection**:
The optional, transient selection of one safe local directory in a New Conversation Draft. The selector offers managed Quick Chat, shortcuts for known canonical Project paths, and `选择工作目录…`. Selecting or browsing has no durable effect until Camp Creation succeeds; cancelling creates no record. Ordinary directories, empty directories, empty Git repositories, normal repositories, and Git worktrees are valid. Core canonicalizes and revalidates the exact directory; it never runs `git init`.
_Avoid_: Project creation, Repository Binding, Git-only picker, picker-side persistence

**Git Capability Observation**:
A runtime observation of whether one currently valid workspace directory is `not_git`, `git_valid`, or `git_invalid`, with optional repository root, Git common directory, object format, HEAD commit, branch, dirty flag, and observation time. Core probes at Camp creation, AgentRun start, before Git-specific operations, and AgentRun end. Start and end observations are immutable AgentRun audit facts, not a Camp binding; ordinary reads and status display never persist them.
_Avoid_: Repository identity, Repository Binding, reconciliation, Camp Git status, automatic `git init`

**Member**:
The product-facing English name for an application-global AgentProfile that a user can configure and invite into one or more Camps, displayed in Chinese as `队员`. It is not a separate domain object or a Camp-scoped identity; CampMember represents its relationship with one Camp.
_Avoid_: Teammate, 成员 or 伙伴 as the formal product name for Member, Member entity, member record

**Member Name**:
The globally unique, user-configurable `AgentProfile.displayName` shown as `队员名称` in Chinese member settings, mentions, messages, Camp titles, and other ordinary product surfaces. It is the only user-facing member identity label; duplicate names are rejected on create or edit.
_Avoid_: Handle, slug, routing key, parenthesized disambiguator

**Member Mention**:
An explicit structured reference from one user-authored Camp message to one current Member, created only through mention discovery or preservation of an existing structured reference. It is the sole source of explicit member addressing; lookalike text and implicit Default Lead addressing are not Member Mentions, and target mentionability is independent of Runtime readiness.
_Avoid_: parsed `@` text, textual mention, Handle mention

**Agent Addressing Token**:
A reserved `@agent_<positive integer>` token in an Agent-authored `camp.message.send` body. Only an exact Agent ID valid in the current Camp and located in a parseable body region participates in recipient resolution; escaped tokens, inline or fenced code, URLs, and ordinary `agent_id` text remain literal.
_Avoid_: Member Mention, natural-language mention, display-name match, handle parsing

**Effective Recipients**:
The deduplicated recipient set resolved for one Camp Message Send from explicit `--to` Agent IDs, valid Agent Addressing Tokens, and any `Reply-to Default Target`, then frozen in normalized Agent ID UTF-8/ASCII byte order. Any unresolved or invalid recipient fails the whole send before persistence; only this canonical set is the sole input from which Message Deliveries, Envelopes, idempotency digests, audit facts, and retries are created, and no recipient source starts a separate dispatch path.
_Avoid_: delivery list assembled by the Renderer, recipient text, repeated fan-out, implicit Lead target

**Recipient Presentation Metadata**:
The non-authoritative positions and display-name snapshots retained for an Agent Addressing Token and optional recipient footer. It may preserve source-text order for rendering, but never changes the canonical Effective Recipients set, Delivery identity, Envelope order, idempotency digest, or scheduling.
_Avoid_: routing order, recipient priority, canonical identity, mutable name lookup

**Delivery Scheduling Order**:
The Scheduler-owned order in which independently accepted Message Deliveries become eligible for dispatch. It is a separate policy from canonical recipient ordering, `--to` order, and inline token position; recipient identity sorting never implies execution priority.
_Avoid_: Agent ID sort as priority, author intent order, Renderer arrival order, FIFO across recipients

**Recipient Identity Eligibility**:
The admission-time identity condition for one Effective Recipient: its Agent ID resolves to a present, current Camp Member, is not the sending Agent, and satisfies the structural fan-out and lineage limits. It says nothing about that Member's Runtime readiness or current capacity; those are Delivery scheduling facts.
_Avoid_: Runtime online status, process availability, execution guarantee, Default Lead fallback

**Message Fanout Limit**:
The atomic upper bound on one addressed Camp Message Send: its Effective Recipients may consume no more than the current CampTurn's remaining accepted-A2A budget and never more than the product ceiling of sixteen. A public-only send consumes no A2A slot; exceeding the bound rejects the entire send without a Public A2A Message or Delivery.
_Avoid_: per-recipient partial acceptance, independent hidden cap, Runtime concurrency limit, public-message count

**Addressing Resolution Failure**:
The fail-closed result of a Camp Message Send whose explicit target, Agent Addressing Token, or reply-to default cannot resolve to a Recipient Identity Eligible Camp Member. Core persists no Public A2A Message or Message Delivery and returns one structured error envelope containing the complete set of offending sources, their original values, stable reasons, and the instruction to use a new `requestId` after correction; it never leaks Camp-external roster candidates. Runtime readiness is not an addressing failure and is represented by Delivery scheduling state instead.
_Avoid_: partial fan-out, public message with a dropped target, silent literal fallback, Runtime execution failure

**Reply-to Default Target**:
The one Agent author of a replied-to Public A2A Message, added to Effective Recipients when no explicit target rule excludes it. A replied-to user message or system event contributes no Delivery; the original message's other recipients are never expanded, and a self target remains invalid.
_Avoid_: reply obligation, recipient fan-in, original recipient broadcast, automatic result route

**All Members Mention**:
The single explicit structured `@所有队员` reference in one user-authored Camp message. At accepted send it expands to and freezes the exact set of present CampMembers addressed by that message, while remaining one atomic token in the Composer and history; later membership or Presence changes never rewrite its historical recipient set.
_Avoid_: `@所有成员`, dynamic broadcast, future-member subscription, expanded Member Mention list, unaddressed message

**Mention Fanout**:
The one accepted-send boundary that deduplicates all structured Mention targets and atomically creates one queued direct AgentRun for each exact recipient. Every Run in that fanout shares the message and creation boundary; the scheduler performs their independent pre-launch checks concurrently so one recipient never waits for a previous recipient's Runtime to finish, while exact operating-system process start timestamps are not claimed to be identical.
_Avoid_: sequential mention handling, Lead-first dispatch, identical wall-clock process start, one shared AgentRun

**Member Personality Traits**:
The ordered set of zero to six user-authored labels shown as `性格底色` for one AgentProfile, summarizing stable expression, judgment, and collaboration tendencies. Traits are descriptive identity context, not Memory, an ability score, a Capability, a Team Role, or a behavioral instruction.
_Avoid_: persona label string, personality rating, Memory, Working Principles, free-form personality paragraph

**Member Team Role**:
The optional short `团队角色` label describing a Member's primary contribution type within a team. It is identity context, not authority, Member Order, a Capability, a Camp role, or a current Task assignment.
_Avoid_: role title, permission level, rank, Task Assignee, Default Lead

**Member Professional Responsibilities**:
The optional `专业职责` statement describing what a Member is expected to handle over the long term and the results it usually delivers. It is not a current objective, Task, Run instruction, Capability, or claim that work has been completed.
_Avoid_: role title, current Task, Work Brief, Capability, delivery evidence

**Member Working Principles**:
The optional `工作准则` statement describing stable working methods, quality expectations, and collaboration boundaries for later eligible Native Session Bootstrap deliveries. It cannot grant permission, satisfy Approval, override current user input, rewrite an already delivered Bootstrap, or change a running Runtime.
_Avoid_: member instructions, Runtime permission, Capability, current user request, mutable Run prompt, live Runtime update

**Member Growth Topic**:
The optional `成长课题` statement naming a direction a Member currently intends to practise or improve through future collaboration. It is private Member Identity Bootstrap context, not a personality or ability rating, Memory, automatic write trigger, or requirement to fabricate progress; replacing it never revises, retires, or forgets existing Memory.
_Avoid_: performance score, current Task, AgentRun Dynamic Context, Memory body, automatic Memory trigger, permanent trait

**Member Identity Bootstrap Projection**:
The required private `MEMBER_IDENTITY` section transiently formatted from one AgentProfile's latest committed six identity fields at an eligible Native Session Bootstrap delivery. It is neither persisted as a Snapshot nor frozen into an AgentRun; Claude Code and Codex receive it at new Session and Resume, while other Runtimes receive it only at new Session under their existing delivery modes.
_Avoid_: Member Identity Snapshot, AgentRun identity context, Session identity revision, avatar, Runtime configuration, Capability bundle, live Runtime update

**Member Identity Update**:
The versioned atomic user command that saves exactly one AgentProfile's six identity fields. Avatar, Runtime configuration, permissions, Presence, Memory state, and other Profile concerns have independent mutation boundaries and cannot partially join or roll back an Identity Update.
_Avoid_: whole-profile save, avatar update, Runtime update, Memory update, multi-section transaction

**Peer Member Identity Projection**:
The collaboration-facing subset of another Camp Member's identity containing only stable routing identity, Name, Team Role, and Professional Responsibilities. Personality Traits, Working Principles, Growth Topic, availability, busy state, and execution reason remain outside this projection.
_Avoid_: complete Member Identity Bootstrap Projection, personality profile, peer instruction, availability projection, Capability projection

**Agent UUID**:
The immutable, opaque persistence identity of one AgentProfile, visible only inside Core storage and never exposed to users, Agent Runtimes, model context, or tools.
_Avoid_: Agent ID, Member Name, routing key, model-visible identifier

**Agent ID**:
The stable model-and-tool routing identity `agent_<positive integer>` allocated monotonically to one AgentProfile. Users never see or edit it, and an allocated value is never reused after Member removal. It is an opaque identity for comparison: canonical ordering uses its normalized UTF-8/ASCII byte sequence, never numeric interpretation.
_Avoid_: Agent UUID, AgentProfile ID, Member Name, role label, reusable sequence number, handle

**Legacy Member Handle**:
A retained opaque storage value attached only to pre-Agent-ID history. It is absent from current Member and CampMember contracts, is not used to parse or rewrite plain `@文字`, is not user-editable, and is never allocated or accepted for current routing decisions.
_Avoid_: Agent ID, user handle, current mention identity, display name

**Member Presence**:
The user-controlled lifecycle of one AgentProfile: `present`, `away`, or terminal `removed`. Presence is independent from Runtime configuration, Runtime Readiness, CampMember relationships, and Memory Lifecycle; a present Member may have no configured Runtime.
_Avoid_: Runtime readiness, online status, Camp membership status, active Agent

**Permanent Member Removal**:
The irreversible transition of one AgentProfile to `removed`, excluding it from the member directory and every future execution, routing, assignment, and active projection surface while retaining historical identity and records. It is rejected while that Profile owns any `queued`, `running`, or `waiting` AgentRun; otherwise one managed transaction ends all of its Current CampMemberships through the ordinary membership-ending domain path, releases every non-terminal Task assignment, reconciles affected Default Leads, and only then marks the Profile removed. Any failure rolls back the entire cascade. Historical identity remains renderable but not navigable, and the retained Agent ID is never reused.
_Avoid_: data deletion, manual per-Camp removal, partial removal cascade, Memory Forget, profile erasure, reversible archive

**Member Order**:
The user-controlled global ordering of manageable AgentProfiles used for presentation, new-Camp initial Lead selection, and future repair of an invalid existing Default Lead. Reordering never replaces a currently valid Lead and does not express authority or capability.
_Avoid_: Role priority, capability rank, Camp-specific order, circular succession cursor

**AgentProfile**:
The application-global persistent domain object behind one Member, containing its Agent UUID, Agent ID, Member Presence, identity configuration, and optional Member Runtime Configuration independently of any Camp. Its current routing identity is Agent ID rather than a separate AgentProfile ID; a removed AgentProfile remains an internal historical identity but is no longer a manageable Member.
_Avoid_: Member in domain code, Teammate, AgentInstance

**Memory Library**:
Rovai-ai's application-global, user-governed collection of durable memories, independent of every Camp, Project, Conversation, Native Session, Runtime, and repository. References to collaboration or repository records may explain a memory's origin but do not change its ownership or visibility.
_Avoid_: Camp memory, Project memory, Runtime memory, conversation history, task state

**Memory Store**:
The normalized Memory-domain state inside Rovai-ai's existing authoritative SQLite database: Memory, immutable Revision, Hearth Memory Proposal, Supersession, and reconstructible retrieval indexes. It is neither one JSON aggregate nor an event-replayed or file-backed database.
_Avoid_: memory.json, Markdown database, event-sourced Memory, FTS as authority, separate database

**Memory**:
One atomic durable recognition with a stable identity and one selected current MemoryRevision. It is independently governed and is not a paragraph position or a whole scope document.
_Avoid_: memory file, prompt fragment, conversation summary, mutable text row

**MemoryRevision**:
An immutable version of one Memory's canonical body and Retrieval Keys, created by an authorized user write, direct Agent Memory Write, or accepted Hearth Memory Proposal. A Memory selects one current Revision while older Revisions remain distinct audit history; active Revisions have no provisional/confirmed authority tier.
_Avoid_: in-place edit, pending proposal, Markdown version, authority state, whole-library snapshot

**Memory Origin**:
The immutable audit provenance of a Memory's formation and each Revision's actor. Formation origin distinguishes user-created, direct Agent-formed, and user-accepted Hearth Proposal Memory for UI transparency; only direct Agent formation enters Agent-origin capacity. Origin never changes applicability, priority, Lifecycle, or permission.
_Avoid_: Memory authority, confidence, approval state, model priority

**Memory Scope**:
The immutable application-level ownership and maximum visibility boundary selected when a Memory is created: Hearth, one Companion, or one unordered Relationship pair. Moving content to another scope creates a new Memory rather than changing the existing Memory's boundary.
_Avoid_: mutable label, folder path, Camp visibility, revision field

**Memory Kind**:
The immutable semantic classification selected when a Memory is created: Preference, Agreement, or Lesson. Reclassification creates a new Memory; Kind is not a tag or Revision field.
_Avoid_: mutable category, generic fact type, personality label

**Memory Lifecycle**:
The applicability state of one Memory: `active`, `retired`, or `forgotten`. A manually retired Memory may be explicitly reactivated, a superseded predecessor may not, and forgotten is terminal; Supersession remains a separate relationship to a successor Memory.
_Avoid_: Revision history, review schedule, superseded status

**Memory Supersession**:
An explicit user-authorized predecessor-to-successor relationship between two Memories. It retires the predecessor while preserving which new Memory replaced it; publishing a new Revision of the same Memory is not Supersession.
_Avoid_: ordinary revision, implicit duplicate, targetless status

**Memory Forget**:
An irreversible user action that removes a Memory's readable content from the Memory Library and all future supported memory reads while retaining only the minimum tombstone and command facts needed for safety. It does not erase the Memory's original source objects, completed AgentRun inputs, Native Session history, external Runtime history, or user-controlled backups.
_Avoid_: retire, reversible archive, global content erasure

**Memory Export Boundary**:
The user-initiated extraction of Memory data directly from authoritative SQLite state. v0.10 adds no Memory-specific automatic backup or cloud sync, and exported copies leave Rovai-ai's Forget control; format and selected history are implementation-protocol details.
_Avoid_: Projection backup, automatic replication, recoverable Forget, Rovai-ai-controlled external copy

**Memory Review**:
An advisory user-governance reminder scheduled by `reviewAfter`; becoming due does not change a Memory's active state or content. Review may lead the user to continue, reschedule, revise, retire, or forget through separate explicit commands.
_Avoid_: automatic expiry, validity window, lifecycle transition

**Memory Projection**:
A deterministic, read-only rendering of authoritative SQLite Memory state in Rovai-ai-private user data for internal diagnostics, export compatibility, or debugging. It is disposable, rebuildable, never authoritative, and no longer a supported Agent read surface.
_Avoid_: Agent Memory API, Memory source of truth, editable memory file, project document, Git-tracked state

**Projection File Safety Limit**:
The 256 KiB maximum for one fully rendered Memory Projection Markdown file, including formatter-owned structure and entries. Each Relationship child file is checked independently; overflow prevents publication and emits diagnostics without changing SQLite.
_Avoid_: Scope body capacity, Relationship directory aggregate quota, truncation target, database limit

**Unavailable Memory Projection**:
A body-free Markdown sentinel atomically published when an internal projection is known stale, corrupt, oversized or unrenderable. It prevents diagnostics or compatibility consumers from treating last-good content as current until reconciliation succeeds; supported Agent reads use Memory Search and Memory Read instead.
_Avoid_: stale projection cache, empty valid Memory set, partial rendering, SQLite rollback

**Memory Entrypoint**:
A bounded, body-free discovery cache of currently applicable active Memory injected once into a Native Session Bootstrap. It exposes stable Memory IDs, Kinds, Retrieval Keys and Relationship counterparties, but is never refreshed in place and every later search or read remains live-authorized.
_Avoid_: current Memory truth, Memory Guide, projection path list, Memory body injection, immutable Memory snapshot, permission grant

**Memory Retrieval Key**:
A short, Revision-bound discovery phrase that helps an Agent find one Memory without changing its Scope, Kind, applicability, priority, or Lifecycle. Retrieval Keys are immutable with their MemoryRevision and are not tags on the stable Memory.
_Avoid_: Memory authority, mutable tag, task fact, permission label

**Memory Search**:
An authorized search over the current Agent's applicable active current MemoryRevisions, including entries omitted from its bounded Memory Entrypoint. Search returns discovery metadata and snippets rather than granting access or returning complete bodies.
_Avoid_: complete Memory Library search, historical Revision search, authorization by ID possession

**Memory Read**:
An authorized, bounded read of the latest current Revision for stable Memory IDs. Every call revalidates the active AgentRun, Memory applicability and Lifecycle, and reports whether the Entrypoint cache is current, revised, inactive, deleted, access-changed or unavailable; a stale reference never returns an old or unauthorized body.
_Avoid_: frozen Entrypoint body, historical Revision read, Session rotation, capability by reference

**Preference Memory**:
A stable choice about how Rovai-ai or a Companion should communicate, present information, or work with the user.
_Avoid_: inferred personality, temporary request, project fact

**Agreement Memory**:
A prospective collaboration rule for the members in its Memory Scope. It remains supplemental long-term context and cannot grant permission, satisfy approval, or override current task truth.
_Avoid_: prediction, current task instruction, hidden policy

**Lesson Memory**:
A reusable course of action distilled from a real experience, without turning that experience into a personality judgment or capability score.
_Avoid_: observation profile, performance rating, conversation summary

**Hearth Memory**:
A durable memory whose scope includes every AgentProfile in the local Rovai-ai home across Camps. Users may write it directly; an Agent-authored candidate becomes active only after an explicit per-Proposal user decision.
_Avoid_: Camp-wide memory, global prompt, shared chat history

**Companion Memory**:
A durable memory scoped to the user and one AgentProfile across that AgentProfile's Camps and Runtime changes.
_Avoid_: Conversation memory, Native Session memory, Agent observation profile

**Relationship Memory**:
A durable, user-governed memory for one unordered pair of AgentProfiles across Camps in which they collaborate. The user can manage the complete pair, while each Agent's supported read view contains only mutual content and directed content for which that Agent is the actor.
_Avoid_: Agent-shared archive, Camp membership, Agent ranking

**Relationship Direction**:
The immutable Agent-facing applicability of one Relationship Memory: `mutual` enters both pair members' supported read views, while `directed` enters only the actor's view when collaborating with the counterparty. The user can always manage the complete pair.
_Avoid_: directional Relationship Scope, user-hidden note, mutable revision field

**Agent Memory Write**:
A direct, immediately effective `memory.write` add or revise from a current fenced AgentRun into Companion(current Agent) or an applicable Relationship. Every eligible Member may invoke it; Core derives the actor and Scope, enforces current membership, direction, capacity, secret and concurrency rules, and never treats the write as user confirmation.
_Avoid_: Memory proposal, automatic confirmation, Hearth write, lifecycle request

**Hearth Memory Proposal**:
A durable but non-effective `memory.propose_hearth` add or revise candidate submitted by a current fenced AgentRun. Only an explicit user decision can create the active Hearth Memory or Revision; the Proposal itself never enters Memory Search, Memory Read, Memory Entrypoint or Agent-origin capacity.
_Avoid_: active Memory, general MemoryProposal, direct Agent Hearth write, user draft

**Stale Hearth Memory Proposal**:
A pending Hearth revise Proposal whose base Revision is no longer current. Stale is derived rather than a status, and the Proposal cannot be accepted or rebased in place.
_Avoid_: stale Memory, automatic rebase, disputed Revision

**Agent Memory Mutation Receipt**:
The idempotent result of an Agent memory mutation: either an effective Companion/Relationship Memory write or a pending Hearth Memory Proposal. It identifies the persisted outcome without echoing the full candidate body or implying a user decision.
_Avoid_: confirmation receipt, inferred authority, transient tool acknowledgement

**Hearth Memory Proposal Decision**:
The per-Proposal user action to accept the displayed final content, edit then accept, or reject one Hearth Memory Proposal. Acceptance creates an ordinary active Memory or Revision with no higher authority tier; stale revise Proposals cannot be accepted or edited into acceptance.
_Avoid_: Memory confirmation, bulk learning, Agent approval, stale rebase

**Rovai Skill**:
A stable Skill identity in the Rovai Skill Library whose Name is globally unique. It is either supplied officially by Rovai-ai or explicitly imported by the user; Runtime-native Skills are outside this identity and may use the same Name.
_Avoid_: Runtime-native Skill, Agent-wide Skill toggle, imported source directory

**Skill Revision**:
An immutable complete content snapshot of one Rovai Skill, published by an official application release or a user-confirmed import or update. Importing the same Name from another source updates the existing non-official Rovai Skill by creating a new Revision rather than creating a second Skill.
_Avoid_: mutable Skill directory, source checkout, parallel same-name Rovai Skill

**Skill Enablement**:
The application-global delivery pause state of one Rovai Skill. A new official or imported Skill starts enabled; disabling it suspends all Rovai-managed delivery without deleting or changing its Skill Group Assignments, those Assignments remain editable while disabled, and re-enabling restores delivery from the saved Assignments.
_Avoid_: Skill Group Assignment, permission grant, deleted assignment, per-Member enablement

**Runtime-native Skill**:
A Skill independently owned and discovered by an Agent Runtime outside the Rovai Skill Library. Rovai-ai neither imports nor takes ownership of it, and a same-named Rovai Skill may remain visible alongside it without implying which one the Runtime will use.
_Avoid_: Rovai Skill, imported Skill, Rovai-managed conflict winner

**Duplicate-visible Skill**:
A positive, best-effort observation that an exact same-name entry exists in a known unmanaged discovery location for an Agent Runtime that can also receive the Rovai Skill. Rovai-ai may check that exact path while planning an assigned delivery, but it does not enumerate, parse, index, import, modify, or choose between Runtime-native Skills; absence of the observation is not proof that no duplicate is visible.
_Avoid_: Runtime winner, native Skill inventory, exhaustive scan result, resolved name conflict

**Shadowed Skill Delivery**:
A Rovai Skill delivery whose exact intended projection path is already occupied by a directory, file, or symbolic link that Rovai-ai does not own. The existing entry is left unchanged, and the blocked Delivery Group is not silently replaced by an unselected Group.
_Avoid_: overwritten native Skill, duplicate-visible Skill, implicit fallback delivery

**Skill Delivery Group**:
An application-defined Skill delivery channel associated with a Runtime-native project Skill entry and the Agent Runtimes known to discover it. Delivery Groups may overlap, so one Runtime's effective Rovai Skill set is the union of every Group it can discover. Group definitions are fixed by verified Adapter behavior rather than created or edited by the user, and Rovai-managed delivery never uses the shared `.agents/skills` channel.
_Avoid_: mutually exclusive Runtime partition, Member Skill scope, Project Skill scope, user-defined Runtime group

**Skill Group Assignment**:
The application-global relationship that selects one current Skill Revision for one Skill Delivery Group across all applicable Run Workspaces. Its existence is the complete assignment state, multiple explicit Assignments are retained when Delivery Groups overlap, and publishing a newly confirmed Revision advances every existing Assignment to that Revision. An Assignment records user intent rather than requiring a distinct physical projection when another selected Delivery Group already makes the same Revision visible.
_Avoid_: physical link identity, global all-Runtime toggle, Member Assignment, Project Assignment, disabled Assignment

**Effective Skill Delivery**:
The minimal derived set of Rovai-managed projections that satisfies the explicit Skill Group Assignments for one Run Workspace without making the same Rovai Skill Revision redundantly visible to an Agent Runtime. An overlapping Assignment may be satisfied through another selected Delivery Group and becomes directly projected again if that shared coverage is later removed. A blocked Delivery Group may use another explicitly assigned Group where that still satisfies the saved intent, but delivery never invents an unselected Assignment as a fallback.
_Avoid_: Skill Group Assignment, persisted user intent, implicit fallback Assignment, duplicate physical projection, Runtime-native Skill

**Skill Delivery Group Member View**:
The transient list of current Agent Profiles whose currently selected Agent Runtime can discover one Skill Delivery Group. It is derived whenever displayed rather than assigned or persisted, and an empty Member View does not remove or hide its Delivery Group.
_Avoid_: Skill Assignment, persisted Group membership, Camp membership, historical Member snapshot

**Memory Stewardship Skill**:
The official Rovai Skill `rovai-memory-stewardship` (“共同记忆维护”) that teaches durable-memory judgment, authorized search/read, atomic wording, Retrieval Keys, duplicate and secret checks, direct non-Hearth writes, and the Hearth Proposal boundary. It is present in the Skill Library by default but has no default Skill Group Assignment, and it grants no Capability or fallback prompt injection.
_Avoid_: default Group Assignment, per-Scope Skill, Memory authority, mandatory System Prompt, unsupported-Runtime emulation

**Worktree Skill**:
The official Rovai Skill `rovai-worktree` (“隔离 Worktree”) that makes one isolated Git worktree durable to a Task, reuses it across AgentRuns, and keeps implementation changes out of the primary checkout. It is present in the Skill Library by default but has no default Skill Group Assignment, does not create a worktree until invoked in an authorized implementation task, and never grants filesystem or Git authority.
_Avoid_: per-AgentRun worktree, Camp-wide worktree, implicit implementation permission, automatic cleanup, primary-checkout mutation

**Agent Memory Mutation Run Quota**:
The hard limit of four successfully persisted direct writes and Hearth Memory Proposals per source AgentRun. Idempotent replays and failed calls do not consume another slot, while a later Hearth Proposal decision does not restore one.
_Avoid_: token budget, pending-only count, rolling window, user management limit

**No-op Agent Memory Mutation**:
An add candidate exactly equal to an active Memory's Scope, Kind, Direction, canonical body and Retrieval Keys, or a revise candidate equal to the target's current Revision. Core rejects it without persisting a write/Proposal or consuming Run quota; semantic similarity is never inferred.
_Avoid_: fuzzy duplicate, accepted no-change Revision, semantic merge

**Duplicate Pending Hearth Memory Proposal**:
A Hearth candidate exactly equal to the earliest pending add Proposal or pending revise Proposal for the same target/base/body/Retrieval Keys. Core preserves the earliest Proposal and rejects the duplicate without recording another proposer or consuming Run quota.
_Avoid_: semantic duplicate, merged proposer list, replacement Proposal, idempotent replay

**Pending Hearth Proposal Retention**:
The rule that a pending Hearth Memory Proposal has no automatic expiry and remains user-governed until explicit acceptance or rejection. Elapsed time and a derived stale condition do not delete it or change its status.
_Avoid_: Proposal TTL, ignored status, automatic rejection, stale cleanup

**Terminal Hearth Proposal Retention**:
The asymmetric terminal-body rule for Hearth Memory Proposal: accepted may retain its original candidate for audit until the linked Memory is forgotten, while rejection clears candidate text in the rejecting transaction. Both retain non-body proposer/source metadata and terminal status without time-based expiry.
_Avoid_: terminal Proposal TTL, retained rejected body, Proposal metadata deletion

**Unavailable Hearth Proposal Source**:
A derived management condition where a Hearth Memory Proposal's weak source Camp/AgentRun reference can no longer be resolved or read. The frozen IDs and Proposal remain, navigation is disabled, and the user decision stays valid without copying or restoring source content.
_Avoid_: Proposal invalidation, cascade deletion, cached source transcript, restored source authority

**Non-Participating AgentProfile Memory**:
An otherwise active Companion or Relationship Memory involving an away or removed AgentProfile. Member Presence does not mutate Memory Lifecycle, Revision, Hearth Proposal, Origin, or Supersession data; no Agent Memory Entrypoint, search/read result, or direct write target is produced while ineligible. Returning from away restores applicability without a new Revision, while removed is permanently ineligible.
_Avoid_: automatically retired Memory, removed Memory scope, deleted Hearth Proposal, removal-driven Forget

**Memory Body Limit**:
The invariant that every direct write, Hearth Proposal candidate and user-authored MemoryRevision body is non-blank UTF-8 text of at most 2,048 stored bytes. Oversized content is rejected without truncation or automatic splitting.
_Avoid_: token limit, Markdown file size, automatic summary, multi-Memory expansion

**Memory Body**:
The plain UTF-8 text of one atomic MemoryRevision or Hearth Proposal candidate. Line breaks may be meaningful text, but Markdown/HTML characters carry no stored rich-text semantics; every model-facing formatter owns and escapes its surrounding structure.
_Avoid_: Markdown document, HTML fragment, projection fields, executable prompt template

**Canonical Memory Body**:
The sole stored form of Memory Body after converting CRLF/CR to LF, trimming outer whitespace, and rejecting C0 controls other than LF and TAB. Internal whitespace and Unicode code points are otherwise preserved; validation, byte limits, hashing and exact comparison use these stored bytes.
_Avoid_: raw submitted body, Unicode compatibility fold, display-only normalization, pre-normalization hash

**Memory Secret Filter**:
The non-overridable Core validation that rejects credentials and authentication secrets before any direct write, Hearth Proposal candidate or MemoryRevision body is persisted. It never logs matched text and does not create a generic personal-information score, label, kind or lifecycle.
_Avoid_: user override, post-persistence scanner, sensitive-personality profile, secret audit snippet

**Active Memory Scope Capacity**:
The hard entry-count limit for one active Hearth set, one AgentProfile's active Companion set, one unordered pair's active Relationship set, or one AgentProfile's applicable Relationship set. Hearth Proposals, retired Memories and historical Revisions do not reserve it; every command that would expand the active set revalidates it without automatic eviction, while body size is governed independently by Memory Body Limit.
_Avoid_: aggregate byte quota, database storage quota, Proposal queue capacity, revision-history limit, automatic retention policy

**Agent-Origin Memory Capacity**:
The additional count bound on active Memories formed directly by an Agent, applied per Companion, Relationship pair and each Agent's applicable Relationship set. A user revision does not change formation origin or release the slot; a user-accepted Hearth Proposal is not a direct Agent-origin Memory. Reaching the bound rejects new Agent-origin entries rather than creating pending non-Hearth work.
_Avoid_: provisional capacity, authority quota, user Memory capacity, automatic eviction

**CampMember**:
The persistent membership relationship that associates an AgentProfile with one Camp and carries Camp-specific permissions. It does not duplicate Member Presence; away and removed identities remain historically related to their Camps while being ineligible for current participation. Membership may still change through the existing recoverable join, leave, and rejoin lifecycle, but adding or reactivating a CampMember never eagerly creates a Conversation; an existing Conversation remains available for that AgentProfile's continuity, while a missing one is created only at a later admitted execution targeting that member.
_Avoid_: AgentProfile, Member, Member Presence, eager Conversation allocation

**Current CampMember**:
A CampMember whose membership in one Camp is currently effective. It is independent of Member Presence: an away AgentProfile may remain a Current CampMember, while ending the membership removes that Camp-scoped participation relationship.
_Avoid_: active CampMember, present Member, Executable Assignee

**Executable Assignee**:
A Task Assignee who is both a Current CampMember and has `present` Member Presence. It is an identity eligibility condition for admitting new Task-linked execution, not a claim about Runtime Readiness or immediate process availability.
_Avoid_: active assignee, Runtime-ready assignee, Current CampMember

**Initial Camp Membership**:
The non-empty, user-selected set of present AgentProfiles that become CampMembers when a New Conversation Draft's creation is accepted. An unselected Member is outside that Camp rather than merely omitted from its first execution. The creation UI prevents removing the final selected member and explains that at least one Member must remain, preserving a valid Default Lead candidate. v0.22 configures this initial set but does not add a post-creation Camp membership editor or promise one in the creation interface.
_Avoid_: First-message recipients, all present Members, Project team, post-creation membership UI

**Camp Collaboration Mode**:
The durable, user-changeable Camp policy persisted as the closed value `peer | lead_coordinated`, determining which CampMembers participate directly in the user's conversation. An explicit mode change affects only later direct conversation and routing; it never rewrites historical messages, membership, or Conversations. The mode is distinct from per-message explicit addressing. During v0.22 Camp creation, the available Peer Collaboration option appears on the left; the unavailable Lead-Coordinated Collaboration option remains visible on the right and is labeled `暂未开放`, with no mode-change surface exposed yet.
_Avoid_: immutable Camp identity, Renderer preference, first-message routing option, AgentRun mode

**Peer Collaboration**:
The currently available Camp Collaboration Mode in which the Camp retains a Default Lead and unaddressed user requests go to that Lead. Selecting this mode never turns every CampMember into a default recipient.
_Avoid_: broadcast-by-default collaboration, temporary fan-out, Lead-Coordinated Collaboration

**Lead-Coordinated Collaboration**:
A reserved Camp Collaboration Mode in which only one Default Lead converses directly with the user. The mode is not currently available for creating a Camp.
_Avoid_: Peer Collaboration, multiple user-facing Leads, Runtime fallback

**Default Lead**:
The present CampMember persisted as the destination for unaddressed execution requests, the Camp-wide coordination reader, and the holder of Task Coordination Authority. Runtime configuration and Readiness do not determine Lead validity; failed execution never silently falls back to another member, the role grants no general administrative authority outside its explicit Camp responsibilities, and an invalid Lead is repaired idempotently when entering the Camp using the latest Member Order.
_Avoid_: Task Assignee, universal administrator, Native Session owner, Runtime fallback target

**Task Coordination Authority**:
The Camp-scoped authority held by the User and Default Lead to update any non-terminal Task, including ending the responsibility through cancellation. It neither grants authority outside the Task domain nor changes the uniform availability of Built-in Task operations to eligible Members.
_Avoid_: universal administrator, Task ownership, Member Capability, operation allowlist

**Initial Default Lead Selection**:
The required selection of one Initial Camp Membership member as the Camp's Default Lead. The creation UI initially selects the first Runtime Ready member in stable Member Order, or the first selected member when none is Ready. Every selected member remains eligible regardless of Runtime Readiness; Readiness affects later execution admission rather than Lead identity. A manually selected Lead remains selected while included in Initial Camp Membership; removing that member automatically selects the first remaining member in stable Member Order as the replacement Lead.
_Avoid_: Runtime-determined Lead validity, Runtime fallback target, automatic recipient

**Conversation**:
One AgentProfile's long-lived private logical continuity inside one Camp, independent of whichever external Runtime currently serves it. Its privacy boundary is Rovai-owned routing and context, not physical isolation of an external Runtime's files or state. Camp creation does not preallocate empty Conversations for Initial Camp Membership; an admitted execution submission creates a missing Conversation only for each exact target.
_Avoid_: Camp, Native Session, AgentRun, public chat transcript, external Runtime state container, physical filesystem isolation

**Task**:
An optional durable responsibility item inside one Camp, used when work must remain visible across messages, AgentRuns, or member coordination. Its closed lifecycle is `pending | in_progress | blocked | completed | cancelled`; `completed` records an authorized actor's declaration of completion, not verification by Rovai-ai Core. Tasks do not form a dependency DAG or a Core-enforced workflow. An addressed send may explicitly link one `pending` or `in_progress` Task assigned to its Executable Assignee at acceptance, but the frozen historical link neither transfers responsibility nor proves completion. Later Task blocking, completion, cancellation, or reassignment never cancels, fails, retargets, or wakes that accepted Message Delivery; its Run may observe the latest collaboration state and act accordingly. An A2A target Run never inherits the source Run's Task association. A Task may describe a filesystem path as ordinary semantic content, but it does not own or structurally transfer an AgentRun working directory.
_Avoid_: Camp, Conversation, chat thread, internal plan, one-off A2A request, workflow node

**Task Acceptance Criteria**:
The ordered textual conditions stored with one Task to make its expected outcome explicit. They have no individual completion state, dependency semantics, or Core verification effect; completing the Task remains an authorized actor's declaration about the responsibility as a whole.
_Avoid_: checklist progress, test evidence, workflow gate, completion proof

**Task Closure Metadata**:
The actor-derived identity and Core timestamp frozen when a non-terminal Task enters `completed` or `cancelled`. It is never caller input, is absent from non-terminal snapshots, and records who closed the responsibility rather than who verified its result or stopped related execution.
_Avoid_: completion evidence, AgentRun outcome, caller-authored audit fields, execution cancellation

**Task-linked Responsibility Admission**:
The one-time boundary at which Core accepts either a Direct linked queued AgentRun or an A2A linked Message Delivery against a `pending` or `in_progress` Task and its Executable Assignee. It freezes the admitted Task version and Assignee identity as audit facts, while later Task state or content changes neither requalify nor revoke that accepted responsibility.
_Avoid_: continuous Task execution fence, dispatch-time Task revalidation, Task snapshot

**Task Related Execution Projection**:
The read-only Renderer summary derived from CampSnapshot relationships between one Task and its current or historical Message Deliveries and AgentRuns. It explains execution facts beside responsibility state without becoming TaskRecord content, changing Task status, or collapsing the two lifecycles.
_Avoid_: Task execution state, TaskRecord relation cache, automatic Task transition, execution control

**Task Cancellation**:
The terminal declaration by a User or Default Lead that a durable Task responsibility no longer exists. It does not cancel, redirect, or revoke a previously accepted Message Delivery or AgentRun; execution cancellation uses its own explicit lifecycle boundary.
_Avoid_: AgentRun cancellation, Message Delivery cancellation, CampTurn cancellation, execution rollback

**Team Delivery Qualification**:
A bounded evaluation of whether a frozen Camp team, after receiving one software-delivery request through its Default Lead, can reach a terminal AgentRun tree and produce a workspace outcome accepted by an external verifier within a fixed budget and without human intervention after dispatch. It is evidence about end-to-end delivery for the evaluated cases, not a Task completion declaration, a general capability claim, a comparison with a solo Agent, or attribution to a Member Team Role.
_Avoid_: Task completion status, general Agent capability, solo comparison, role attribution

**Qualification Team Configuration**:
The exact four-Member production setup evaluated by one Team Delivery Qualification, including Camp membership, Default Lead, Member Identity Bootstrap Projection contract, Runtime and model settings, permissions, Capabilities, and recorded product versions. Every configured Member belongs to the evaluation subject, while only Members that receive an AgentRun participate in a particular case.
_Avoid_: arbitrary Agent Team, mandatory four-Agent execution, mutable personal setup

**Collaboration Path Calibration**:
A non-scoring prerequisite run whose user input prescribes necessary independent Message Deliveries so that Built-in CLI discovery, context transfer, and Lead integration can be distinguished from autonomous coordination. Its explicit collaboration contract may determine Calibration success, but never becomes a response protocol or Hard Outcome gate for an Autonomous Qualification Trial.
_Avoid_: Team Delivery Qualification result, autonomous collaboration score, production task pass

**Autonomous Qualification Trial**:
The scored execution of one Team Delivery Qualification case whose user input states the delivery outcome and constraints without naming Members or prescribing collaboration steps. After dispatch to the Default Lead, Member selection, handoffs, implementation, verification, and convergence proceed without human intervention.
_Avoid_: guided collaboration, scripted role sequence, user-directed delegation

**Formal Qualification Trial**:
An Autonomous Qualification Trial driven through public Core commands against one recorded packaged Release Core, fresh Core data, real frozen Product Runtime installations, and an admitted Intervention Isolation Profile with no competing Rovai Core process. Debug Core, shared-user execution, Renderer automation, direct SQLite mutation, public demo fixtures, and reused production collaboration state cannot produce formal qualification evidence.
_Avoid_: Smoke Test, demo run, shared-user diagnostic, Debug Core result, desktop UI automation

**Qualification Environment Manifest**:
The immutable evidence identifying the exact Rovai build, Runner, host, Qualification Team Configuration, Product Runtime executables and capability snapshots, models, permissions, Built-in CLI contract/catalog digest, admitted Intervention Isolation Profile, external-effect policy, case seals, and relevant toolchains shared by a comparable set of Formal Qualification Trials. Material pre-dispatch drift ends that set and requires a new Manifest rather than extending prior results.
_Avoid_: permanent compatibility claim, mutable machine description, incomplete version label

**Qualification Case**:
A versioned software-delivery evaluation unit containing one starting workspace, outcome-focused user request, external verification contract, fixed Trial budgets, and explicit allowed or forbidden change boundaries. Correctness is determined from required behavior and constraints rather than similarity to a reference patch.
_Avoid_: production Task, target commit diff, prompt alone, hidden test alone

**Collaboration-Value Qualification Case**:
An Autonomous Qualification Trial case whose disclosed outcome is materially difficult for the Default Lead to deliver alone because independent verification or specialised work must be integrated across the team. Every Delivery Requirement and material prerequisite is disclosed to the evaluated team; public handoffs may carry derived work products but never the unique fact needed to discover a hidden correct answer. Verified Delivery remains outcome-only: Member activation, Message Delivery counts, role labels, and prescribed handoff sequences are never Hard Gates.
_Avoid_: mandatory-Agent-count case, scripted delegation case, collaboration score, private-answer case, hidden delivery obligation, solo comparison

**Outcome-Only Collaboration Contract**:
The schema-v3 rule that a Collaboration-Value Qualification Case freezes a four-Member execution environment but rejects every mechanical collaboration gate, including required Member activation, minimum Message Deliveries, minimum completed Tasks, polling rules, or prescribed closure. Collaboration, routing, feedback absorption, and integration remain Layer 3 evidence or Semantic Review only; schema-v2 collaboration contracts remain readable solely under their historical semantics.
_Avoid_: zero-valued legacy contract, ignored collaboration field, Member-count gate, Task-count gate, Judge proxy rule

**Qualification Workstream**:
One independently actionable strand of disclosed engineering work inside a Collaboration-Value Qualification Case. A Case contains at least three Workstreams, but no Workstream is preassigned to a Member or mechanically requires a separate AgentRun.
_Avoid_: mandatory role assignment, prescribed handoff, AgentRun quota, hidden subtask

**Case Integration Invariant**:
A disclosed Delivery Requirement that can pass only when the results of multiple Qualification Workstreams coexist correctly in the delivered workspace. It verifies integrated behavior rather than Member participation or the existence of intermediate work products.
_Avoid_: handoff count, file-ownership rule, weighted collaboration criterion, Task completion status

**Diagnostic Case Portfolio**:
A fixed, versioned set of four non-public sealed Collaboration-Value Qualification Cases used to challenge Case quality and exercise the complete evidence pipeline before a Formal Qualification Suite is admitted. Each Trial discloses its outcome, prerequisites, and public tests to the evaluated team without exposing the private Pack; each Case receives exactly two Independent Qualification Repeats for stability diagnosis. The Portfolio produces per-Trial evidence only and never a Pass Rate, ranking, Pass@k result, or claim of team superiority.
_Avoid_: Formal Qualification Suite, leaderboard, completed-subset rate, case collection without seals

**Diagnostic Portfolio Definition**:
The immutable pre-dispatch authority that binds one Portfolio ID and version to four Case IDs, versions, and Seals; eight fixed repeat slots; the frozen team, budgets, toolchain, Judge policy, and configuration digest. It contains no private Case locator and cannot acquire Trial results after sealing.
_Avoid_: mutable run manifest, Case path registry, partial definition, result-bearing configuration

**Diagnostic Portfolio Ledger**:
The private append-only hash-chained sequence of Portfolio state events, including preflight, dispatch, evaluation pending, replacement linkage, leakage checks, and terminal Trial outcomes. Every original attempt remains addressable, while `portfolio-status.json` is only a disposable projection rebuilt from the Definition, Ledger, and retained Trial Bundles.
_Avoid_: overwritten slot, mutable authority row, deleted Invalid attempt, status-file recovery

**Diagnostic Portfolio Completion Attestation**:
The one-time immutable terminal artifact binding the Portfolio Definition digest, final Ledger head, all eight authoritative Evidence Bundles and Hard Outcome Fingerprints, and the four derived Diagnostic Case Stability states. Only its allowlisted projection may become a public report; any correction requires a new Portfolio version rather than rewriting the attestation.
_Avoid_: current-status snapshot, partial completion, mutable summary, private locator export

**Diagnostic Case Stability**:
The finding that two Independent Qualification Repeats of one unchanged Diagnostic Portfolio Case produced byte-identical canonical Hard Outcome Fingerprints without evidence-integrity drift. Equality yields `stable_pass` or `stable_fail`; a valid mismatch yields `investigation_required`, while an unresolved Invalid, Evaluation-Pending, or irrecoverable evidence state yields `incomplete`. Agreement is not statistical significance or evidence that either outcome is desirable.
_Avoid_: Pass@k, majority result, selected best Trial, statistical claim, Case correctness

**Hard Outcome Fingerprint**:
A versioned canonical digest over every Layer 1 authority field and subfield, all six Requirement verdicts, and the build, regression, and change-boundary category verdicts for one Trial. Case Seal, Portfolio configuration, schema, or execution-configuration drift prevents comparison; non-Hard details such as failure stage, Run Graph, message content, Tool counts, latency, and Semantic Review remain explicit observed variation outside the digest.
_Avoid_: Overall-only comparison, full-bundle byte comparison, Judge result, tool-count stability, hidden normalization

**Frozen Diagnostic Team Configuration**:
The exact four-Member evaluation configuration bound to every Trial in one Diagnostic Case Portfolio, including AgentProfile identities, Runtime adapters, declared model IDs and options, reasoning parameters, and Runtime permission settings. A missing or observably substituted component fails pre-dispatch admission or invalidates post-dispatch evidence; the Runner cannot silently fall back to another Member, Runtime, model, or permission profile.
_Avoid_: best-available model, transparent fallback, between-repeat upgrade, equivalent-team claim

**Diagnostic Execution Fingerprint**:
The recorded identities and digests of the locally observable Core, Runner, Runtime binaries, Node/toolchain, frozen team configuration, and Portfolio configuration used for a Trial. It demonstrates equality of observable inputs without claiming that an opaque remote provider kept unversioned model weights unchanged; such vendor-side drift remains an explicit limitation.
_Avoid_: environment label, model-weight attestation, mutable latest binary, unrecorded toolchain

**Hermetic Verification Profile**:
The schema-v3 execution contract for public Checks, withheld verification, and Challenge Mutant admission: the frozen Node executable runs directly without a shell under an allowlisted UTC/C environment and isolated HOME/TMP, with read-only access to the delivered workspace, write access only to a per-Check temporary directory, and no network, child process, addon, FFI, WASI, or inspector permission. Public Checks run serially with fixed timeout and output caps, and the delivered tree must remain byte-and-metadata identical before and after verification.
_Avoid_: inherited environment, shell command, verifier network, writable delivered workspace, ambient clock or randomness

**Case Outcome Neutrality**:
The rule that Qualification Case admission and Diagnostic Portfolio retention depend on sealed Case integrity and reproducible evaluation, never on whether the current team passes. Stable Hard failures remain evidence; invalid, Evaluation-Pending, or unstable repetitions trigger investigation without authorizing replacement by an easier Case.
_Avoid_: pass-tuned Case selection, failed-Case deletion, favorable-result replacement, target Pass Rate

**Diagnostic Portfolio Completion**:
The state reached when all four sealed Cases passed admission and all eight fixed Trial slots contain valid, bundle-verified, non-leaking final evidence. `stable_pass`, `stable_fail`, and `investigation_required` are all honest completed diagnostic findings; an `incomplete` Case, irrecoverable evidence gap, execution-configuration drift, or private-material leak blocks completion. Team passing and a currently available real Semantic Judge are not completion requirements.
_Avoid_: pass-required release, stable-only case selection, partial-slot completion, fixture Judge substitution

**Formal Case Promotion Eligibility**:
The stricter status required before a Diagnostic Portfolio Case may be proposed for a later Formal Qualification Suite. Only a Case with intact evidence and matching valid repeat fingerprints may advance; `investigation_required` remains retained diagnostic evidence but requires a newly sealed Case and Portfolio version after root-cause correction rather than a deciding third run.
_Avoid_: automatic promotion, third-vote promotion, silent Case repair, unstable formal case

**Delivery Requirement**:
One stable-ID, sealed behavior or constraint disclosed in the user request or its public Case Contract that every delivered workspace must satisfy for Verified Delivery. All Delivery Requirements are Hard Gates; a priority label may order failure diagnosis but never make a failed requirement non-gating.
_Avoid_: hidden obligation, optional requirement, weighted criterion, Semantic Judge item, diagnostic suggestion

**Hard Check**:
A stable-ID, sealed deterministic check whose failure prevents Verified Delivery and whose exact expected cardinality belongs to the Verification Catalog. Every Hard Check maps to one or more disclosed Delivery Requirements or to an explicitly disclosed build, regression, or change-boundary category; its implementation details may be withheld, but its obligation may not be hidden.
_Avoid_: Diagnostic Check, Judge checklist item, verifier summary Boolean, hidden obligation

**Withheld Verification Check**:
A non-public test implementation, input, or assertion detail that verifies one or more disclosed Delivery Requirements without adding an obligation or expanding their reasonable interpretation. Every such Check has a sealed mapping to public Requirement IDs; a Check without that mapping makes the Qualification Case inadmissible.
_Avoid_: hidden requirement, reference implementation, secret scoring dimension, Judge rubric item

**Requirement Verification Pair**:
The combination of at least one disclosed public test and one distinct Withheld Verification Check for the same behavioral Delivery Requirement. The public side establishes comprehensibility and the initial failure, while the withheld side tests different inputs, boundaries, or properties without adding another obligation; Runner-owned change-boundary Requirements do not require this pair.
_Avoid_: duplicated public test, hidden obligation, reference-patch comparison, Runner boundary check

**Target Public Check**:
A disclosed public test command mapped to a behavioral Delivery Requirement and declared with `initialExpectation: fail` in a schema-v3 Qualification Case. It must fail on every clean materialization of the initial fixture and pass on the admitted reference workspace; its failure demonstrates that delivery work is genuinely required rather than introducing a hidden obligation.
_Avoid_: flaky initial failure, withheld test, new requirement, reference-only assertion

**Baseline Public Check**:
A disclosed regression or build test command declared with `initialExpectation: pass` in a schema-v3 Qualification Case. It must pass on both the clean initial fixture and the admitted reference workspace, proving that the starting point is usable and the reference delivery preserves the stated baseline.
_Avoid_: target behavior check, tolerated initial failure, optional regression, hidden build command

**Case Verification Topology**:
The fixed verification shape of every schema-v3 Collaboration-Value Qualification Case: Requirements R1 through R4 each map one-to-one to a Target Public Check and to at least one distinct Withheld Verification Check; R5 maps to one Baseline Public Check for build and regression behavior; and Runner-owned workspace comparison exclusively verifies the R6 change boundary. A Case therefore exposes exactly five public Check entries while private Checks may add coverage only within the already disclosed R1-through-R4 obligations.
_Avoid_: variable public-check count, private requirement, duplicated public/withheld assertion, Case-authored boundary verdict

**Diagnostic Delivered Change Boundary**:
The uniform Runner-owned R6 rule that permits final changes only beneath `src/` and `tests/agent/` and requires every other starting or delivered path, including public tests, fixtures, package metadata, and README content, to remain byte-and-metadata identical. The Runner compares independent trees including path, file type, mode, content, and symlink target rather than trusting Git metadata; DC-004 additionally forbids any observed out-of-root write during execution, not merely in the final snapshot.
_Avoid_: Git-diff-only boundary, mutable public test, package install, README noise, final-state-only escape check

**Agent-Authored Test Area**:
The only Case path where the evaluated team may add or modify tests: `tests/agent/`. The immutable R5 command discovers and executes these tests together with protected public regression tests, so a failing Agent-authored test fails delivery while the existence or count of added tests remains Semantic Review evidence rather than a Hard requirement.
_Avoid_: mandatory test count, mutable public test, ignored failing test, test-based bonus score

**Diagnostic Check**:
A stable-ID, non-gating observation that helps explain engineering behavior without participating in Verified Delivery or Overall qualification. It remains explicitly separate from every Delivery Requirement and cannot compensate for or create a Hard Outcome.
_Avoid_: non-critical requirement, bonus point, weighted score, hidden Hard Gate

**Final Response Evidence**:
The Lead's final user-facing response together with separately authoritative facts about delivered files, executed tests, verification outcomes, and remaining failures. It supplies comparison material but never declares whether the free-text response is accurate, complete, or honest; that verdict belongs only to Semantic Engineering Review.
_Avoid_: deterministic honesty score, Agent completion proof, Delivery Requirement result, Hard Outcome

**Qualification Case Seal**:
The immutable content identity established only after a Qualification Case's clean starting workspace, expected initial failure, reference success, deterministic verifier, user request, budgets, and change boundaries have all been validated. Any later correction creates a new case version and invalidates affected results rather than rewriting the sealed case in place.
_Avoid_: case name, fixture-only hash, mutable hidden test, repaired result history

**Case Challenge Mutant**:
One admission-only workspace variant containing a plausible but materially incorrect implementation of disclosed Delivery Requirements. Every Qualification Case must reject at least three independently motivated Challenge Mutants before sealing; their content and expected failures never enter a Trial workspace, Judge Evidence Pack, or published result.
_Avoid_: hidden requirement, reference solution, Agent hint, Trial attempt, post-seal verifier patch

**Challenge Mutant Admission Profile**:
The exact, twice-reproduced Hard Check outcome required from a valid Case Challenge Mutant. The first three Mutants must independently represent public-test overfitting, a domain-specific edge omission, and a regression-or-boundary violation; every Mutant must build far enough for the verifier to complete normally, must fail exactly its declared Check IDs while all other Hard Checks pass, and cannot gain weight from additional Mutants. At least one Mutant must pass all five public Checks and fail only withheld verification, while the regression-or-boundary Mutant must pass R1 through R4 and fail only R5 or R6.
_Avoid_: compile-error mutant, broad fixture corruption, nondeterministic failure, undeclared extra failure, mutant-count score

**Sealed Material Canary**:
A high-entropy admission-only marker unique to a private reference, verifier, Challenge Manifest, or Challenge Mutant and excluded from every permitted Trial projection. Its appearance in a delivered workspace, retained Trial artifact, public report, or Judge Evidence Pack proves an observable private-material leak; its absence does not prove that a danger-full Runtime lacked filesystem read capability.
_Avoid_: credential, shared canary, public fixture marker, isolation attestation

**Observable Non-Leakage Gate**:
The fail-closed post-Trial scan for Sealed Material Canaries, private Pack paths and basenames, forbidden fields, credentials, and non-allowlisted private content across the delivered workspace and every retained or exported artifact. A match is an irrecoverable retained evidence finding that leaves the Portfolio incomplete and cannot be erased by cleanup or replacement execution.
_Avoid_: best-effort warning, scan-after-redaction only, delete-and-rerun, Formal Isolation claim

**Verification Catalog**:
The complete sealed directory of stable Delivery Requirement, Hard Check, and Diagnostic Check identities, categories, ownership, and result cardinality expected for one Qualification Case. It is the completeness authority against which Runner validates observations; it does not itself contain verifier implementation or a reference solution.
_Avoid_: verifier output list, mutable report schema, weighted rubric, Judge checklist

**Verifier Observation**:
A process-successful, Case- and delivered-workspace-bound set of per-check facts produced by a Withheld Verifier. It has no authority to declare Verified Delivery; Runner accepts it only after exact Verification Catalog and schema validation, then derives Hard Outcome facts.
_Avoid_: verifier verdict, self-reported delivery boolean, partial check list, Semantic Review

**Failure Fact**:
One authoritative, evidence-referenced Hard Check or lifecycle failure observed at a named evaluation stage. Qualification reports retain every Failure Fact and may identify the earliest observed Hard Failure by frozen pipeline order, but do not infer one cross-stage root cause when the evidence does not establish it.
_Avoid_: weighted deduction, guessed primary cause, Semantic Judge opinion, single mandatory failure stage

**Delivered Workspace Freeze Barrier**:
The post-execution boundary that fences new work and mutation, proves all Trial workspace writers have exited, and separates Runner-managed projections before a delivered snapshot is captured. Any writer, observation gap, or content instability prevents the barrier from completing.
_Avoid_: live tree scan, Core shutdown cleanup, final Git status, best-effort copy

**Delivered Workspace Snapshot**:
The immutable, content-identified workspace captured after the Delivered Workspace Freeze Barrier. Its exact digest is the single workspace identity used by diff calculation, Withheld Verification, Qualification Evidence, and any recoverable evaluation attempt.
_Avoid_: live Run Workspace, reference implementation, mutable verifier copy, Git commit identity

**Trial Budget**:
The Qualification Case-specific projection of elapsed-time, AgentRun, and accepted A2A ceilings into one frozen CampTurn Execution Budget. Inconsistently observable token or account costs remain evidence rather than a hard budget.
_Avoid_: Runner polling threshold, Core default maximum, model context window, token-only allowance, advisory target

**CampTurn Execution Budget**:
An immutable elapsed-time, AgentRun, and accepted-A2A resource ceiling frozen by Core when a CampTurn is admitted and checked atomically before Core accepts or reserves further execution responsibility. Its absolute deadline survives Core restart, and the contract is general execution safety that a Qualification Case may configure rather than Benchmark state inferred from Runner snapshots.
_Avoid_: Trial result, Runner-owned counter, post-acceptance cancellation threshold, mutable quota

**Budget Exhaustion**:
The terminal CampTurn condition recorded when an otherwise authorized, non-replayed request would exceed its frozen CampTurn Execution Budget, or when its elapsed-time deadline is reached. Core rejects the new responsibility without partial side effects and fences the Turn; invalid requests, authorization denials, and idempotent receipt replays neither consume nor exhaust the budget.
_Avoid_: accepted over-limit call, recoverable Tool denial, ordinary quota rejection, Runner-observed overrun

**Sealed Qualification Pack**:
A versioned, non-public collection of scored Qualification Cases kept outside the open-source repository, from which only one case's starting workspace and user request are released into a Trial. Its verifier, reference material, and complete scoring contract remain withheld from the Run Workspace and from published reports.
_Avoid_: public fixture suite, in-workspace hidden tests, committed answer patch, Runner demo fixture

**Withheld Verifier**:
An external Qualification Case verifier omitted from the Run Workspace, model-facing context, and open-source repository until every Trial Runtime process has terminated. It produces non-authoritative Verifier Observations for Runner validation, provides non-adversarial evaluation integrity, and is not an operating-system security boundary against a same-user process that deliberately searches for it.
_Avoid_: Runtime sandbox, adversarial secret, in-workspace hidden test, public check

**Verified Delivery**:
The result that an Autonomous Qualification Trial's final workspace outcome satisfies every Delivery Requirement and every external build, public, hidden, regression, and forbidden-change Hard Check defined by its Case. Diagnostic Checks, Agent statements, Task status, and Semantic Review never establish or override it.
_Avoid_: Agent completion claim, completed Task, target-diff similarity, reviewer opinion

**Hard Outcome**:
The sole qualification result for a scorable Formal Qualification Trial: pass only when Verified Delivery and Orchestration Convergence pass and Post-Dispatch Human Intervention is absent. Invalid or Evaluation-Pending Trials have no Hard Outcome, while Collaboration, Tool, Diagnostic, and Semantic evidence can explain but never change it.
_Avoid_: composite score, verifier verdict, collaboration audit, Judge score, provisional result

**Orchestration Convergence**:
The result that all execution responsibilities and Runtime processes belonging to an Autonomous Qualification Trial settle within its fixed time, AgentRun, and A2A budgets, with no unfinished Run, Message Delivery, approval, or unsettled external effect. A failed or cancelled Run may still be mechanically converged after every resulting responsibility settles; Post-Dispatch Human Intervention is a separate Hard Outcome fact.
_Avoid_: every Run succeeded, autonomy result, Human Intervention, correct code alone, Lead final message, unlimited delegation

**Collaboration Evidence Matrix**:
A non-composite diagnostic projection of one Autonomous Qualification Trial's actual participation, independent Message Delivery lifecycles, feedback integration evidence, overlapping work, loops, and budget use. It keeps unavailable or semantically ambiguous attribution explicit and never turns a later delivery to the source into required closure or changes Verified Delivery, Orchestration Convergence, or Overall qualification.
_Avoid_: formal Trial collaboration gate, collaboration score, leaderboard, Agent self-assessment, delivery verdict

**Message Delivery Lifecycle**:
The objective chain linking one accepted Message Delivery to its queued, materialized, failed, cancelled, or settled state, any recipient Run created from it, and the terminal failure or completion facts of that execution responsibility. A recipient Run's later Public A2A Message is a separate send and never acts as a privileged response edge.
_Avoid_: message count, semantic Handoff result, Task completion, inferred feedback absorption

**Message Delivery Settlement**:
The state `settled | unsettled | indeterminate` derived only from whether one accepted Message Delivery and any recipient AgentRun reached terminal states under complete evidence coverage. Settlement does not imply usefulness, integration, a response, or a need for another send.
_Avoid_: successful handoff, response closure, feedback absorption, useful delegation

**Exact Duplicate Delivery Acceptance**:
Two Message Deliveries from separately accepted sends by the same source Run with different canonical identities but the same recipient, Task link, and canonical content digest. An idempotent replay is one acceptance and is never a duplicate; this is qualification evidence, not a Core time-window suppression rule, and semantic similarity remains a Judge question.
_Avoid_: repeated route, idempotent replay, similar request, repeated reviewer use

**Forward Delivery Cycle**:
A Message Delivery whose target is already on its forward-delivery ancestor lineage. A later delivery back to the original sender is therefore another forward edge and a cycle, not a privileged return path.
_Avoid_: repeated direction without ancestry, source Resume, multi-stage review

**A2A Lineage Guard**:
The Core admission invariant for a new Message Delivery: the source AgentRun's root depth is `0`, each delivered target Run increments depth by one, and no accepted Delivery may exceed product maximum depth `5` or target an Agent already present on the source's ancestor lineage. Self-send, depth overflow, and any remaining CampTurn A2A/Run budget failure are rejected atomically before the Public A2A Message or Delivery is persisted; there is no additional per-Run send-count or time-window quota.
_Avoid_: semantic loop classifier, privileged return edge, automatic depth reset, Renderer recursion check

**Delivery Semantic Disposition**:
The Semantic Engineering Review finding that work or information associated with an independent Message Delivery was integrated, rejected, superseded, abandoned, or remains indeterminate. It is never inferred by Core from matching code, Task state, a later send, or message timing and never changes Hard Outcome.
_Avoid_: Message Delivery Settlement, later send, objective lifecycle state

**Delivery Necessity**:
The Semantic Engineering Review finding that, when an independent Message Delivery was accepted, its target needed the authored information to continue acting or decide and had a clear next action or was waiting for that necessary result. Acknowledgement, courtesy, non-blocking progress, and repeated-information sends are unnecessary; incomplete evidence yields indeterminate rather than an objective Core fact.
_Avoid_: acceptance authorization, Message Delivery Settlement, response requirement, automatic content classifier

**Qualification Evidence Bundle**:
The private, user-owned result package for one Formal Qualification Trial, containing its manifests, case identities, authoritative snapshots, normalized execution and collaboration evidence, Delivered Workspace Snapshot identity and change, verifier results, and outcome. Runtime-private logs, credentials, hidden reasoning, environment-variable values, Withheld Verifiers, and reference answers are excluded by construction; any publication requires a separate explicit redacted export.
_Avoid_: public report, raw Runtime log archive, sealed case pack, automatic Git artifact

**Evidence Reference**:
A stable, opaque, digest-bound identifier for one normalized fact that a report or Semantic Review may cite without exposing its private source locator. A reference is valid only when it resolves inside the exact Evidence Bundle or Judge Evidence Pack identity declared by its consumer.
_Avoid_: filesystem path, raw database ID, Sealed Pack locator, unsupported citation

**Evidence Coverage**:
The declared state `complete | partial | unavailable | not_applicable` describing whether one evidence source or normalized field can support the claims assigned to it over the required interval. Missing observations never imply a negative fact; a Hard Outcome claim that requires incomplete coverage makes evaluation pending, while an optional diagnostic becomes indeterminate.
_Avoid_: empty array, false default, best-effort completeness, source authority

**Tool Call Ledger**:
The normalized, append-only evaluation projection of observed Core-mediated and Runtime-reported Tool calls, retaining each source's authority and coverage alongside identity, lifecycle, authorization, retry, receipt, effect, latency, and verification facts. A common schema never upgrades partial Runtime telemetry into Core-authoritative evidence; unavailable fields remain explicit.
_Avoid_: raw Runtime log, command transcript, complete-observation claim, tool success score

**Workspace Mutation Ledger**:
The ordered evidence of content-identified filesystem mutations and writer provenance captured under an admitted Intervention Isolation Profile. It can establish multi-Agent path overlap, overwrite, and exact rollback only within declared complete coverage; otherwise those findings remain indeterminate.
_Avoid_: final tree diff, Tool Call Ledger entry, inferred Agent ownership, Git status

**Judge Evidence Pack**:
The content-identified, allowlist-built and redacted projection of public Case obligations, Delivered Workspace facts, collaboration, Tool, mutation, and Final Response Evidence supplied to a Semantic Judge. It treats participant text as untrusted data, hides participant model identity and the computed Hard Outcome, and excludes hidden reasoning, credentials, Runtime-private logs, complete Withheld Verifier details, reference implementations, and every Sealed Pack locator by construction.
_Avoid_: Qualification Evidence Bundle, raw transcript, verifier archive, prompt with private locators, Hard Outcome label

**Semantic Engineering Review**:
The advisory, checklist-based LLM review of engineering and collaboration quality using only one Judge Evidence Pack. Every item carries a categorical verdict, evidence references, confidence, and an explicit applicability or abstention state; the Review has no aggregate score, may be unavailable or disputed, and never creates, removes, or changes a Hard Outcome.
_Avoid_: qualification verdict, composite score, hidden-test review, Agent self-assessment

**Judge Replica**:
One independently invoked, tool-disabled Semantic Judge evaluation bound to the same Judge Evidence Pack and frozen Semantic Judge Configuration as its peer. A valid verdict is never retried for selection, averaged with its peer, or preferred because it is more favorable.
_Avoid_: voting member, Judge retry, fallback model, Hard Outcome verifier

**Semantic Review State**:
The result `complete | disagreement | unavailable` for one Semantic Engineering Review. `complete` requires every frozen Judge Replica and output to validate with matching categorical verdicts, `disagreement` preserves any differing per-item verdicts from valid replicas, and `unavailable` means at least one required replica or schema result is missing or invalid; none affects Hard Outcome.
_Avoid_: Trial Evaluation Pending, majority vote, provisional Judge score, qualification result

**Invalid Qualification Trial**:
A retained, non-scoring attempt that either failed a fixture, Runner, verifier, or required Runtime precondition before task dispatch, or whose accepted execution cannot be evaluated without changing its Case Seal or reconstructing missing authoritative evidence. A post-dispatch Runtime, permission, tool, timeout, delivery, or coordination failure remains a valid failure rather than an invalid Trial.
_Avoid_: Evaluation-Pending Trial, post-dispatch product failure, excluded inconvenient result, erased attempt

**Evaluation-Pending Qualification Trial**:
An accepted execution whose Hard Outcome cannot yet be trusted because its freeze barrier, sealed verifier invocation, Hard Outcome coverage, Runner evaluation, or evidence-integrity check did not complete successfully. It is neither a pass nor a failure and enters no Pass Rate denominator; only evaluation of the same fenced execution identity may resume, and an irrecoverable need to reconstruct evidence or change its Seal transitions the retained Trial to Invalid.
_Avoid_: Team retry, valid failure, Invalid Qualification Trial, provisional pass

**Post-Dispatch Human Intervention**:
The three-state finding `absent | present | indeterminate` for any human message, approval decision, workspace mutation, command, configuration change, Runtime control, or continuation prompt after an Autonomous Qualification Trial's task is accepted. Product-owned automatic recovery is not human intervention; `present` independently prevents Overall qualification, while incomplete Intervention Coverage yields `indeterminate` and Evaluation Pending rather than a guessed absence or team failure.
_Avoid_: Boolean default, preflight setup, passive observation, automatic evidence capture, Core-owned recovery

**Intervention Coverage**:
The evidence that every required human-interaction and mutation channel remained observable for the complete post-dispatch interval of one Qualification Trial. Only complete coverage with no intervention fact can establish `Post-Dispatch Human Intervention = absent`; an observation gap establishes `indeterminate`.
_Avoid_: operator promise, no recorded Core message, best-effort watcher, inferred absence

**Intervention Isolation Profile**:
The versioned formal-environment contract that identifies how one Qualification Trial exclusively controls Core user commands, approvals, configuration, Runtime lifecycle, workspace mutation provenance, network writes, Git remotes, and external Tool effects for its entire post-dispatch interval. A Profile based only on shared-user conventions, final tree comparison, best-effort watching, Tool-event correlation, or operator attestation cannot establish complete Intervention or External Effect Coverage.
_Avoid_: Environment Manifest alone, honor-system promise, file diff, Runtime Evidence list, informal test procedure

**External Effect Settlement**:
The three-state finding `settled | unsettled | indeterminate` for mutations outside the Delivered Workspace Snapshot. `settled` requires every potential mutation channel to be disabled or every accepted effect to have a correlated terminal receipt; an observed non-terminal effect fails Orchestration Convergence, while incomplete channel coverage makes evaluation pending.
_Avoid_: successful shell exit, local workspace cleanliness, assumed idempotency, unobserved network safety

**Independent Qualification Repeat**:
A fresh execution of one unchanged Qualification Case and Qualification Team Configuration using a new Run Workspace, Core data directory, Camp, Conversations, and Native Sessions. Runtime installations and their external account authentication may be shared host prerequisites, but no collaboration, Memory, Task, or execution continuity carries between repeats.
_Avoid_: AgentRun retry, reused Camp, resumed Conversation, changed case variant

**Qualification Suite**:
A sealed Calibration plus a fixed ordered set of planned Formal Trial slots, Case identities, repeats, team configuration, and environment compatibility contract. It may report progress while incomplete, but publishes Pass Rate only after every planned slot has one scorable Hard Outcome; only a pre-dispatch Invalid attempt under unchanged identities may be replacement-linked, while an irrecoverable accepted execution leaves that Suite permanently without a Pass Rate.
_Avoid_: completed subset, dynamic denominator, Pass@k batch, Judge completion set

**Semantic Judge Configuration**:
The immutable identity of the Judge model snapshot, prompts, checklist rubric, decoding parameters, result schema, Judge Evidence Pack schema and redaction policy, and required replica/disagreement protocol. Any change creates a new digest and non-comparable Semantic Review configuration without changing Hard Outcome.
_Avoid_: model alias alone, mutable system prompt, ad hoc retry settings, Hard Outcome policy

**Judge Disagreement**:
The per-checklist state produced when the frozen independent Judge replicas return different categorical verdicts for the same Judge Evidence Pack and Configuration. It preserves each result without tolerance merging, averaging, selecting a favorable answer, or affecting Hard Outcome; confidence differences alone remain diagnostic rather than disagreement.
_Avoid_: Hard Outcome conflict, low confidence, unavailable Judge, composite variance score

**Native Session**:
A replaceable external Runtime handle currently bound to a Conversation. Rovai-ai owns only the binding reference and portable context, not the Runtime's persisted Session files, retention, deletion, or physical isolation; deleting the Camp removes the binding without proving deletion of external Runtime state.
_Avoid_: Conversation, Session Chain, Rovai-owned Session files, Camp deletion guarantee

**Native Session Compatibility Key**:
Adapter-derived evidence describing the Session-level semantics under which a Native Session is known reusable across a Runtime change. Path, fingerprint, or version changes require renewed probing but are not incompatibility by themselves; unknown compatibility permits one fenced Resume attempt before the binding is replaced.
_Avoid_: executable fingerprint, version lock, unconditional Resume, Conversation identity

**Controlled Native Session Resume**:
The single fenced, pre-input attempt to load an existing Native Session when compatibility is unknown for the current Installation generation. It cannot deliver Run input, invoke tools, or advance the Accepted Public Context Boundary; success installs a verifiable binding, while failure or ambiguity fences the attempt before a replacement Session is created.
_Avoid_: AgentRun retry, blind Resume, duplicate input delivery, Conversation replacement

**Native Session Bootstrap**:
The complete model-facing Session startup configuration transiently formatted in the fixed order Session Charter, latest Member Identity Bootstrap Projection, then Memory Entrypoint. Every Runtime receives it for a new Native Session; Claude Code and Codex also receive it on Resume, using the original stable components and latest committed identity. Stable Charter and Entrypoint evidence persists, but the complete Bootstrap bytes and identity do not.
_Avoid_: AgentRun context, immutable complete prompt, Member Identity Snapshot, Runtime hot update, complete Bootstrap evidence

**Native Session Bootstrap Evidence**:
The immutable Core evidence for one Native Binding generation's stable Session Charter, Memory Entrypoint, observed Memory revisions, authorization basis and delivery mode. Its component digest excludes Member Identity and cannot prove or reconstruct the complete Native Session Bootstrap or combined first payload.
_Avoid_: complete Bootstrap snapshot, Member Identity history, Runtime prompt digest, proof of model adoption

**Bootstrap Redelivery Requirement**:
The durable, Native-Binding-generation-scoped requirement that a later Rovai-controlled Runtime input restore Bootstrap after an eligible Runtime observation indicates that ordinary Session context may have been compacted. Product state derives `clean` or `pending_redelivery` from monotonic requested and accepted-input-acknowledged revisions: a Delivery Gate freezes the requested revision it carries, and only that Runtime Input Delivery's accepted acknowledgement advances the acknowledged revision. Failure, unknown delivery, Core restart, or acknowledgement of an older revision cannot consume a newer requirement. It is neither a user task, Camp Message, new Native Session, nor Adapter-local Boolean.
_Avoid_: context compaction job, token-count inference, send-time success, process-memory flag, user-visible Runtime setting

**Bootstrap Redelivery Runtime Policy**:
The process-start snapshot of Rovai-version-owned, internal per-Runtime policy `disabled | best_effort`. `disabled` establishes no detector; `best_effort` establishes Hook/Observer/ACP routes asynchronously without participating in Runtime Readiness or AgentRun admission. It is not frozen to a Native Binding generation: a persisted per-Runtime policy epoch reconciles version transitions, and the first `disabled -> best_effort` transition advances one Requirement for each already reusable affected Binding without replacing its Native Session. Later detector recovery within the same epoch starts observing only future signals and creates no retrospective Requirement. Disabling or losing the detector does not erase or bypass an existing Requirement. Claude Code and Codex have no such policy because their Bootstrap is delivered through a compaction-protected instruction layer.
_Avoid_: customer preference, Renderer setting, readiness capability, AgentRun admission fence, live hot reload, Binding capability, pending cancellation, gap inference

**Compaction Signal Admission Point**:
The single version-qualified Runtime lifecycle point whose correctly routed observation may advance a Bootstrap Redelivery Requirement. An admitted observation is a one-shot requirement-producing edge, never a sticky compaction-in-progress state: one occurrence advances requested revision once, one accepted redelivery may consume it without waiting for a later completed event, and only a new occurrence may create another Requirement. Rovai chooses the latest reliable point that still preserves useful next-input recovery: Copilot admits `preCompact`; OpenCode admits `session.compacted`; Kiro admits only its nested completed status; Qoder and Qwen Code admit only `PostCompact`; CodeBuddy `2.133.1` admits only `SessionStart(source=compact)` after emergency automatic compaction. That CodeBuddy version's separate pre-message compaction path emits none of its advertised compaction lifecycle Hooks, so the `best_effort` detector has an explicit coverage gap and Rovai does not infer the missing edge from token usage. The immutable-current-input cutoff is the serialized Core critical section that persists `RuntimeInputDelivery.prepared`, not the later transport call.
_Avoid_: universal pre-event policy, sticky in-progress flag, completed-event consumption fence, token delta, guessed terminal state, socket-send cutoff, cross-version event-name alias

**Bootstrap Redelivery Input Overlay**:
The transient, non-ContextManifest prefix selected atomically with one Runtime Input Delivery when that Binding generation has a pending Bootstrap Redelivery Requirement. Its versioned envelope encloses a clear `【补发】` notice and the existing complete Bootstrap assembled from the Binding's original Session Charter, latest committed Member Identity, and original Memory Entrypoint, followed by the immutable AgentRun Dynamic Context. ContextManifest remains dynamic-only; Delivery evidence retains the selected Requirement revision, stable Bootstrap Evidence reference, and envelope/formatter versions but never the complete Bootstrap, an identity-bearing digest, or a reconstructable Member Identity snapshot.
_Avoid_: second Bootstrap model, ContextManifest section, persisted combined prompt, identity history, truncatable Bootstrap, unbudgeted prefix

**Native Session Compaction Observer Lease**:
A narrow, non-AgentRun authority binding one verified Runtime Host/Session route to the current Native Binding generation and detector policy epoch. It may outlive individual AgentRuns and submit only version-qualified Session-scoped compaction observations; it grants no prompt, Built-in Tool, collaboration, Memory, Task, or Runtime-control authority. Binding or Host replacement, Session invalidation, or detector policy epoch change fences it; resuming the same external Session on a new Host creates a new Observer identity. Host/relay interruption alone is not compaction evidence: only an already-known observation whose Core submission outcome is uncertain may conservatively advance one deduplicated Requirement. Runtime Hook relays stage that known observation in a private metadata-only durable outbox before submission; Core ACK removes it, while Core restart or matching Host exit replays it before fencing.
_Avoid_: AgentRun lease extension, session ID alone, ambient Hook trust, ordinary-host-exit inference, broad Runtime credential

**Session Charter**:
The stable Core Contract persisted as one Native Session Bootstrap Evidence component. It defines context authority, collaboration rules, and the stable Built-in Tool Transport discovery/invocation contract without containing editable Member identity, current Tasks, members, messages, Runtime state, Memory entries, Skills, complete operation schemas, or permissions.
_Avoid_: System Prompt replacement, Member Identity Bootstrap Projection, dynamic Run context, embedded tool catalog, security enforcement

**AgentRun Dynamic Context**:
The immutable model-facing payload for exactly one AgentRun, composed from complete Current Input plus conditional Collaboration State, Shared Conversation and Run Notices. It contains no Member Identity Bootstrap Projection and no independently synthesized objective, responsibility, deliverable or Task snapshot.
_Avoid_: Native Session Bootstrap, Member Identity Context, mutable live prompt, Work Brief, Task Context

**ContextManifest**:
The immutable Core evidence that freezes one AgentRun's previous and current public-message boundaries, Cross-Camp History Fence, selected raw source references, context-delivery profile version and resolved profile evidence, stable Bootstrap Evidence reference, formatter version, exact rendered AgentRun Dynamic Context and delivery target. Public boundaries are internal evidence and are not rendered to the model. Recovery reuses the dynamic payload byte-for-byte; the Manifest neither stores nor proves the transient Member Identity Bootstrap Projection, complete Bootstrap, or combined first payload.
_Avoid_: complete Runtime prompt evidence, Member Identity Snapshot, prompt template, live context query, proof the model understood input

**Collaboration State**:
A bounded model-facing directory of Peer Member Identity Projections plus the optional Default Lead, emitted for a new Native Session or a material stable team-structure change. It contains no availability, busy reason, changes hint, or current-Turn collaboration inference. `camp.message.send` and Core-owned admission recheck the latest membership, Presence, Runtime, Capability, quota, and fencing state for every addressed send.
_Avoid_: routing authority, availability promise, Capability list, raw presence/readiness state, current task, current Turn participant state

**Shared Conversation**:
The deterministic bounded model-facing representation of public Camp history newly eligible for the current Native Session. It contains the latest ordered raw public messages after per-message prefix truncation, any required Public Reference Context Closure for the current trigger, an optional Core-derived Originating Public User Message for an A2A delivery lineage, and an omission notice only when whole eligible messages were excluded. Current Input is excluded, while Public A2A Messages participate as ordinary public history; the previous/current public boundaries remain internal.
_Avoid_: Context Briefing, Task state, private Conversation, Execution Evidence, current trigger

**Run Notice**:
A fixed-template model-facing statement of an exceptional Run fact already determined by authoritative Core state and directly relevant to the current action. It never exposes counters, internal IDs, mutable guesses or raw Runtime errors, and is omitted when no closed notice applies.
_Avoid_: Control Signal, Work Brief, warning inferred from natural language, execution policy

**Current Input**:
The complete, never-truncated user message or Public A2A Message content that triggered one AgentRun, with trusted source type and stable Camp Attachment Paths when applicable. A2A source metadata contains only the Core-derived `senderAgentId` and `senderName`; internal Run, Task, Delivery, lineage, and correlation IDs remain outside model input. For a Message Delivery, Core must first prove that complete Current Input, the direct Public Reference Context parent, and mandatory structure fit the frozen target Runtime limit before materializing an AgentRun; otherwise the already accepted Delivery fails terminally with `context_payload_too_large`, while its Public Message and sibling Deliveries remain unchanged.
_Avoid_: Shared Conversation duplicate, Work Brief, model-generated source metadata, source reply alias

**Accepted Public Context Boundary**:
The one monotonic public CampMessage sequence boundary maintained for each Native Session. It records the current public boundary frozen by the most recent AgentRun whose input the Runtime accepted and ACKed; a new Native Session starts at zero. A new Run considers untombstoned public messages in `(previousAcceptedBoundary, currentManifestBoundary]`, and successful acceptance advances directly to the full current boundary even when whole messages were omitted from automatic context. Failure before ACK does not advance it. It is neither per-message read state nor a lower bound for `camp.read` or `camp.search`.
_Avoid_: proof of reading, unread-message set, retrieval cursor, model-visible boundary

**Bounded Raw Public Messages**:
The latest fixed-count base subset of eligible public CampMessages, rendered in ascending sequence order after each body is reduced to an exact Unicode-scalar prefix. If the resulting bodies exceed the public-history character budget, whole base messages are removed oldest-first; a separately required Public Reference Context Closure may add only the current trigger's direct ancestors under the closure budget and de-duplicates by message ID. No Mention, attachment relation, keyword, importance, or unrelated reply graph changes the base selection.
_Avoid_: summarized history, relevance window, blanket reply-tree expansion, token budget bypass

**Originating Public User Message**:
The Core-derived first public user CampMessage in the current A2A delivery lineage, inherited unchanged by nested deliveries. It is a separate Shared Conversation item, does not consume the recent-message count, follows the normal body-prefix and history-budget rules, and is deduplicated when already present among recent messages or a Public Reference Context Closure. `replyToMessageId` is a direct public CampMessage relation that may also contribute the current trigger's bounded closure.
_Avoid_: Agent-authored origin, A2A body, reply alias, duplicated history item

**Public Reference Context Closure**:
The Core-derived, bounded ancestor chain for the current AgentRun trigger: starting from its canonical `replyToCampMessageId`, Core follows direct public-parent edges toward the root and selects at most three ancestor messages under Context Delivery Profile v2, prioritizing the direct parent and then nearer ancestors. It stops at a missing/tombstoned/inaccessible parent, lineage boundary, cycle, or the three-message limit, de-duplicates every message by stable ID, consumes the ordinary public-history character/body budgets, and displaces the oldest base recent messages first. Closure members are public-context inputs rather than new Current Inputs, Deliveries, or routing targets; recent-history selection never recursively expands the references of unrelated messages.
_Avoid_: Renderer quote parsing, full Camp reply graph, sibling expansion, Delivery copy, implicit private context

**Omitted Public Messages Notice**:
A fixed retrieval hint emitted only when one or more whole eligible public messages do not enter Shared Conversation. It reports the omitted count and minimum/maximum sequence without asserting their contents; body truncation on an included message is represented only by that message's `bodyTruncated`, `bodyLength`, and `nextBodyOffset` fields.
_Avoid_: truncation warning, inferred missing content, automatic retrieval request

**Context Delivery Profile**:
An immutable application-owned versioned configuration that defines deterministic public-context limits independently from formatter wording. Profile v1 fixes `maxPublicMessages = 15`, `maxPublicHistoryChars = 24000`, and `maxMessageBodyChars = 2000` and performs no reply-ancestor completion; Profile v2 retains those limits and adds `maxPublicReferenceChainMessages = 3` plus Public Reference Context Closure selection. It has no Member UI, IPC, or user-persisted setting, and each ContextManifest records the exact version plus resolved snapshot or digest used by the Run; v2 never rewrites a frozen v1 Manifest.
_Avoid_: formatter constants, Member Runtime Parameters, mutable user preference, summary model configuration

**Cross-Camp History Search**:
An explicit, on-demand lookup by a running Agent within its Cross-Camp History Fence across public CampMessages of other surviving Camps in which the same AgentProfile remains a currently eligible CampMember. It is transient source retrieval rather than Memory; former membership, private Conversation or A2A content, and deleted Camps are outside it.
_Avoid_: global Camp history, Archived Camp search, former-membership history, Memory recall, private Conversation search

**Camp History Retrieval**:
The model-facing discovery and raw-read surface for original public CampMessages. Camp and relevance discovery return bounded Top-K anchors without pagination; stable Camp/message IDs locate evidence; only reply-tree and original-timeline collections continue with Camp sequence cursors. Attachment content remains outside the surface, and every call rederives authority from its current AgentRun rather than from an ID or cursor. `camp.read` and `camp.search` may return any currently authorized raw message at or below the ContextManifest boundary, including messages already delivered automatically; they do not filter for “unread” content, and they cannot reveal later messages above that frozen boundary.
_Avoid_: Summary retrieval, unread-only retrieval, relevance-result traversal, attachment file access, bearer cursor, Memory recall

**Cross-Camp History Fence**:
The immutable maximum scope of one AgentRun's Cross-Camp History Search, pairing the exact set of eligible Camp Discovery Snapshots with one global public-message boundary. Live membership, Member Presence, Camp deletion and tombstones may only narrow it; later joins, renames and messages cannot expand or rewrite it.
_Avoid_: live Camp directory, bearer cursor, previous-Run authorization, current-Camp message boundary

**Camp Discovery Snapshot**:
The immutable discovery identity of one other Camp inside a Cross-Camp History Fence, containing its Camp ID, Camp Name and last visible public activity at the Fence boundary, with Camp creation as the fallback for an empty Camp. Camp discovery matches and orders this snapshot; later renames or activity do not rewrite it, while live authorization may remove it from results.
_Avoid_: live Camp list item, Camp updated time, Archived Camp, cross-Run discovery cache

**Product Runtime Catalog**:
The closed set of Agent Runtime products that Rovai-ai has integrated and can use to create AgentRuns. Catalog membership is independent of local discovery, installation, authentication, and current readiness; compatibility-evaluation candidates remain outside it.
_Avoid_: installed Runtime list, compatibility candidate list, marketplace

**Runtime Search Environment**:
An application-owned, ordered snapshot of executable search locations used consistently to discover, inspect, and launch Product Runtime binaries. Rebuilding it does not mutate the process environment, rebind an AdapterInstallation, or rewrite a frozen Run Runtime Configuration.
_Avoid_: process-global PATH, shell environment, AdapterInstallation

**Runtime Discovery Observation**:
A transient, reconstructible observation of where one Product Runtime can or cannot currently be found in a Runtime Search Environment, including candidate provenance and optional version evidence. It neither creates or rebinds an AdapterInstallation nor proves authentication, capabilities, readiness, or execution admission.
_Avoid_: AdapterInstallation, capability snapshot, Runtime Readiness, installed-product authority

**AdapterInstallation**:
A shared, durable local launch identity and configuration scope for one Agent Runtime Adapter. Multiple AgentProfiles may reference it, while its verified executable path, observed binary version, and capabilities may change through upgrade or relocation. A removed AgentProfile may retain an inert historical reference, but that reference is not an active launch, health, projection, or deletion blocker.
_Avoid_: Adapter version, immutable binary, immutable executable path

**Managed Default Installation**:
The single Rovai-ai-managed AdapterInstallation that internally resolves an ordinary Member Runtime Configuration for one Product Runtime and authentication scope. Discovery priority, upgrades, and verified relocation update its launch evidence in place; advanced custom launch entries remain separate unless explicitly promoted.
_Avoid_: dynamically best Installation, per-Member Installation, custom wrapper

**Verified Installation Relocation**:
The automatic in-place replacement of a missing AdapterInstallation launch path after an ordered same-Adapter candidate passes full deep probing. It preserves the Installation identity and its Member references while replacing the current path and capability snapshot; frozen AgentRuns remain unchanged.
_Avoid_: name-only rebinding, new Installation, rewriting frozen Run Runtime Configuration

**Adapter Capability Snapshot**:
The latest successful persisted deep-probe evidence for one AdapterInstallation, covering its observed executable identity, authentication, models, permissions, protocols, and capabilities. It is authoritative input for which model identifiers and model-option values a Runtime-specific Member editor may offer, while the Core Adapter remains authoritative for recognized native permission fields, values, defaults, and schema version. Unknown fields are never automatically rendered or passed through. The snapshot informs configuration and Runtime Readiness but remains advisory until the Execution Dispatch Check independently verifies the launch target.
_Avoid_: Runtime Discovery Observation, permanent compatibility claim, generic arbitrary-option form, execution admission

**Adapter Probe Attempt**:
One bounded deep inspection of an AdapterInstallation whose outcome may replace its successful Adapter Capability Snapshot or record a failed attempt and retry schedule without erasing that snapshot. Retaining prior evidence does not make it usable after the Installation becomes stale.
_Avoid_: Adapter Capability Snapshot, Runtime Discovery Observation, readiness proof

**Adapter Capability Snapshot Freshness**:
The distinction between a time-aged snapshot that is due for background refresh but remains usable while its launch identity still matches, and a stale snapshot whose launch target, configuration, or confirmed admission evidence no longer matches and blocks new AgentRuns.
_Avoid_: treating age alone as staleness, permanent Ready, refresh due as a Run blocker

**Product Runtime Selection**:
A Member editor draft's choice of one Product Runtime. It is one component of Member Runtime Configuration and is never persisted as a standalone preference. Rovai-ai resolves a successfully saved complete configuration through an internally managed AdapterInstallation; ordinary Member configuration never exposes executable paths, discovery provenance, fingerprints, or Installation identity.
_Avoid_: durable adapter-only preference, executable-path selection, AdapterInstallation selection, automatic execution

**Product Runtime Availability**:
The application-level read state formed from Product Runtime Catalog membership, the latest Runtime Discovery Observation, and any Managed Default Installation, probe attempt, capability snapshot, and in-flight background check. It describes product availability independently of any Member's selection or Runtime Readiness Projection. Internal states such as `found_uninspected`, Discovery status, Probe Attempt status, and Snapshot freshness remain diagnostic facts; ordinary UI maps them to one actionable Runtime User Status.
_Avoid_: Member readiness, persisted display label, direct rendering of internal discovery stages, execution admission

**Runtime Resolution Job**:
Deduplicated background work that resolves or refreshes a Product Runtime through discovery, verified Installation creation or relocation, and deep probing. Core schedules it after startup discovery, later discovery, Runtime installation or update, executable identity change, member Runtime switching, cache expiry, or an explicit user check. It owns no Renderer draft or Run input and is never a configuration-save or ordinary message-send gate; AgentRun dispatch independently checks the current Installation and frozen Run Runtime Configuration.
_Avoid_: AgentRun, form-submit preflight, message-send preflight, synchronous page check, Runtime fallback, mutable Run configuration

**Pending Execution Intent**:
A legacy durable request created by older versions while a message waited for Runtime Resolution. Ordinary sends no longer create it; upgrade recovery may dispatch its message and queued AgentRun through the current message-first path and then retire it as consumed.
_Avoid_: current message-send state, Renderer draft, CampMessage, queued AgentRun

**Agent Runtime (product term)**:
The product-facing name `Agent 运行时` for the Product Runtime component of a Member Runtime Configuration and for the application settings/catalog surface. The Member editor section is `运行配置`; its selector, ordinary status, empty states, Toasts, and user guidance use `Agent 运行时`. Product Runtime, Runtime, Adapter, and AdapterInstallation remain domain or protocol vocabulary, while specific products such as Codex CLI keep their names.
_Avoid_: 执行引擎, displaying Adapter Installation, bare Runtime, or English `Ready` as generic end-user labels

**Runtime User Status**:
The single actionable status shown for one Product Runtime or Member Runtime configuration: `正在检查…`, `可用`, `需要登录`, `未安装`, `版本不支持`, `不可用`, or `暂时无法确认`; no selection is `未配置 Agent 运行时`. It may include a secondary reason or repair link, but never exposes `found_uninspected`, “已找到”, “尚未检查”, or “已检查”. A still-usable cached success remains `可用` while Core refreshes it in the background.
_Avoid_: Runtime Discovery status, Probe Attempt status, Snapshot lifecycle label, stacked primary statuses

**Runtime Readiness Projection**:
The advisory AgentProfile read state derived from its optional complete Member Runtime Configuration, Core-internal resolved Runtime binding, and the latest successful Adapter Capability Snapshot. No configuration yields `runtime_not_configured`; a saved fixed model, model option, or permission value that the latest snapshot no longer supports makes the Member unavailable and blocks new AgentRuns. Core never silently creates or rewrites configuration, while already frozen AgentRuns remain unchanged. Member configuration pages read cached evidence immediately and only signal Core to ensure or refresh it in the background. Opening the page, switching the local draft, saving, ordinary member lists, Quick Chat rendering, Camp opening, and message admission perform no deep probe, executable content read, or fingerprint calculation. The actual Runtime launch boundary compares persisted file identity and performs a full fingerprint only after change or missing evidence; a failure blocks execution, schedules background repair, and preserves the user message.
_Avoid_: authoritative execution admission, synchronous deep probing or executable hashing during page reads and saves, UI-derived launch safety

**Adapter Permission Configuration**:
The Adapter-specific Runtime permission settings selected for an AgentProfile, using the upstream agent's own concepts and values from a verified capability schema. It exists only inside a complete Member Runtime Configuration. When the user explicitly saves a ready configuration, Core may materialize the Adapter's explicitly defined least-restrictive member defaults after validating them against the latest capability snapshot; background resolution and capability refresh never materialize or rewrite those values. The configuration remains distinct from Rovai-ai business Capabilities.
_Avoid_: Rovai-ai permission level, Capability, arbitrary CLI arguments, enum-order defaults, background permission expansion

**Runtime Default Model Selection**:
A Member model policy that follows the Product Runtime's current default model together with that model's default options. It persists neither a model identifier nor model options; selecting and configuring model-specific options requires an Explicit Model Selection.
_Avoid_: current default model snapshot, implicit fixed model, Runtime default model with overridden options

**Explicit Model Selection**:
A Member model policy that persists one model identifier and only the model-specific options reported for that model by the current Adapter Capability Snapshot.
_Avoid_: arbitrary model string, Runtime Default Model Selection with overrides, cross-Runtime model options

**Member Runtime Configuration**:
The atomically saved Product Runtime, model policy, and Adapter Permission Configuration for one AgentProfile. Changing the Runtime in an editor replaces only the draft until one version-checked save validates and replaces the whole persisted configuration against a ready Managed Default Installation and current capability snapshot. If validation cannot complete, nothing is persisted and the AgentProfile remains unconfigured; background discovery never synthesizes a partial or complete configuration.
_Avoid_: adapter-only persisted selection, independent Runtime and parameter saves, cross-Runtime parameter retention, live form state, silently materialized configuration

**Run Runtime Configuration**:
The immutable Adapter, model, and Adapter Permission Configuration snapshot selected from the recipient AgentProfile when an AgentRun is created. Later profile edits affect only new Runs, while native Session-scoped decisions remain owned by the Runtime.
_Avoid_: live AgentProfile settings, sender Runtime configuration, Core permission policy

**Runtime-Managed Permission**:
A permission boundary in which an Agent's Adapter Permission Configuration and native Runtime decide filesystem, Shell, and network access. Rovai-ai persists and relays native permission requests and user decisions but adds no Workspace-derived authorization policy.
_Avoid_: Core permission, unrestricted mode, Agent self-authorization

**Permission Semantics**:
The immutable authorization interpretation frozen for one AgentRun. Existing non-terminal Runs may retain legacy Core-enforced semantics solely for recovery, while every newly created Run uses Runtime-Managed Permission; this is not a user-selectable product setting.
_Avoid_: permission preference, application mode switch, permanent dual-policy system

**Runtime Permission Request**:
A native Runtime request asking the user to authorize a specific operation or resource scope. Rovai-ai persists its complete fenced native identity and exact options, presents the safe actionable view, records the user's selected native decision, and returns that decision to the same Runtime binding.
_Avoid_: Core policy decision, Workspace upgrade, silent permission grant

**Runtime Permission Attention Episode**:
A Camp-scoped period that begins when its eligible pending Runtime Permission Requests change from none to one or more and ends only when none remain. It represents one continuous need for user attention even when multiple AgentRuns or CampTurns contribute requests.
_Avoid_: per-Approval alert, AgentRun approval batch, CampTurn approval batch

**In-App Notification**:
A Core-owned durable user-attention projection created in the same SQLite transaction as its qualifying source fact and retained in Rovai-ai's Notification Center after its optional transient heads-up disappears. It has its own stable identity and read/clear lifecycle, but never authorizes, completes, reopens, or otherwise becomes authority for its linked Approval, CampTurn, or Camp.
_Avoid_: macOS notification, ephemeral-only toast, replayed domain event, Electron Main preference file, business-state authority

**In-App Dynamic Approval**:
An Adapter capability that lets a native Runtime pause an operation, send its exact permission options to Rovai-ai, and resume from the user's recorded decision. Its absence is an explicit Runtime limitation and never causes Rovai-ai to synthesize a request or reinstate Core resource authorization.
_Avoid_: universal Runtime feature, synthetic Approval, Core permission fallback

**Runtime Permission Decision**:
The user's selection among the exact options supplied by a Runtime Permission Request. Its scope and lifetime retain the native Runtime meaning; it never silently rewrites an AgentProfile's Adapter Permission Configuration.
_Avoid_: Core-created grant scope, automatic permanent permission, AgentProfile configuration update

**Runtime Action Record**:
A durable account of a resource operation that a native Runtime actually requested or reported, correlated to its AgentRun and native identity. It preserves request, decision, occurrence, and outcome facts without becoming an independent Core authorization policy.
_Avoid_: synthetic permission request, Core Action policy, proof of an unreported operation

**Runtime Evidence**:
A provider-reported or Core-intervened fact about one AgentRun operation, including its source identity and observed phase or result. It never asserts behavior that the Runtime did not report or Core did not perform.
_Avoid_: inferred operation, reconstructed workspace change, UI event

**Source Evidence Key**:
The source-scoped identity used to recognize and deduplicate one incoming Runtime Evidence event.
It may include the event phase and is not an operation identity; equal-looking keys from different
AgentRuns or native sessions never authorize a merge.
_Avoid_: operationId, lifecycle correlation key, fuzzy title/command match

**Operation Identity (`operationId`)**:
The Core-owned identity of one observed Runtime operation across its started, progress and terminal
Evidence. It is separate from Source Evidence Key, is namespaced by the AgentRun/execution epoch and
verified native or Core identity, and is the only key that permits Canonical Runtime Activity
aggregation. It does not contain or own `classifierVersion`; that version belongs to the operation's
default Canonical Projection. Without a stable identity, Core creates an isolated unknown operation
rather than guessing a correlation.
_Avoid_: source event dedupe key, command string, title, cwd, timestamp window, workspace diff

**Current Canonical Activity Projection**:
The Core-owned, rebuildable current row for one observed operation and classifier version. It records
the strict `operationId`, current semantic/lifecycle fields, source Evidence IDs, first/last sequence,
and revision. Activity Evidence and its insert/update commit in one SQLite transaction. It is mutable
derived state over append-only Evidence, not an immutable fact source or a historical Binding Set.
_Avoid_: Binding Ledger, sealed Manifest, identity replay, immutable Evidence replacement

**Canonical Projection Classifier Version**:
The classifier/contract version fixed when an operation's default Canonical Runtime Activity
Projection is first established. It remains stable for that operation's lifecycle and for default
historical reads. New classifiers apply to new operations; any future historical re-projection requires
an explicit design rather than changing the operationId or silently replacing historical display.
_Avoid_: operationId component, mutable live label, silent history migration

**Canonical Runtime Activity**:
The versioned Core-owned semantic record for one observed Runtime operation. It is a persisted but
rebuildable Projection derived from immutable Execution Evidence: it classifies the observed
activity domain (`activityDomain`) and optional intent, correlates its lifecycle, points to source
Runtime Evidence, records the classifier/contract version, and preserves the boundary of what is
actually known. The current Projection may advance as new Evidence for the same operation arrives;
it never mutates Evidence. Historical identity regrouping and parallel Binding Sets are intentionally
deferred beyond v0.41.
_Avoid_: Renderer label, permission policy, provider event, inferred action

**Canonical Activity Phase**:
The position of a Canonical Runtime Activity in its observed lifecycle: started, progress, or
terminal. Phase does not assert the result of the operation; a terminal phase must carry a separate
evidence-bounded outcome.
_Avoid_: succeeded, failed, cancelled, Run status, UI animation state

**Canonical Activity Outcome**:
The evidence-bounded result of a terminal or currently observed Runtime Activity, such as succeeded,
failed, denied, cancelled/not-executed, unsettled, or unknown. `unsettled` means dispatch may have
started but no authoritative terminal receipt establishes the effect; it is not a synonym for
failure or ordinary user cancellation. Conflicting terminal facts remain preserved and project to
an explicit unknown/unsettled state rather than last-write-wins.
_Avoid_: inferred success, final AgentRun status, optimistic cancellation, workspace-diff result

**Activity Domain**:
The stable top-level observation domain carried by Canonical Runtime Activity's `activityDomain`
field. The initial domains are `shell`, `file`, `git`, `network`, `tool`, `permission`, `runtime`,
`plan`, and `unknown`. A domain may describe a control or meta activity (for example permission or
plan), not a resource mutation or completed effect. Domain assignment belongs to Core and is bounded
by observed Evidence.
_Avoid_: execution result, authorization grant, localized title, semantic intent

**Semantic Activity Kind**:
An optional, namespaced refinement of an Activity Domain, such as `file.write`, `git.mutate`, or
`tool.camp.message.send`. It may be assigned only from validated Core Catalog evidence or a bound
Runtime structured event; command-text guesses cannot promote it to canonical meaning.
_Avoid_: arbitrary command classifier, permission policy, provider label

**Presentation Hint**:
A non-authoritative display refinement, such as a command-looking string suggesting `test.run` or
`build.run`. It may improve localized detail but cannot set Activity Domain, Semantic Activity Kind,
operationId, outcome, or lifecycle state.
_Avoid_: Canonical classification, execution proof, historical semantic rewrite

**Lifecycle Projection**:
The deterministic Read Side projection that merges one Canonical Runtime Activity's started, progress, and terminal facts into one user-visible operation, producing the same result for live and recovery reads.
_Avoid_: transient UI deduplication, event deletion, mutable provider state

**Activity Presentation**:
The localized Renderer projection of a Canonical Runtime Activity's title, details, outcome, and disclosure state. It cannot reclassify the activity from command text, provider title, Runtime name, or untrusted fields.
_Avoid_: activity authority, execution proof, Runtime adapter mapping

**Runtime Observation Boundary**:
The rule that only a Runtime-reported or Core-proven operation may enter Runtime Evidence or Canonical Runtime Activity; absence of a record is not proof that an operation did not occur.
_Avoid_: sandbox boundary, permission boundary, workspace-diff inference

**Runtime Public Output Mode**:
The immutable Adapter capability that determines whether an AgentRun's ordinary final assistant output can become a Public Message. `explicit_send_only` publishes only accepted `camp.message.send` calls; `assistant_final_visible` may publish one reliable Adapter-delimited final as a recipient-free Public Message at Run completion. The mode is not a user or model setting and never changes the addressing or Delivery contract.
_Avoid_: Renderer heuristic, per-message toggle, inferred final, private A2A mode

**Adapter Final Boundary**:
The Runtime-native evidence boundary that authorizes Core to treat one assistant output as the completed final for `assistant_final_visible`. Without a reliable boundary Core does not guess from prose, logs, or process exit; a final is never routed to recipients merely because the Run sent an addressed message.
_Avoid_: last stdout chunk, process exit alone, semantic classifier, Delivery completion

**Exact Final Suppression**:
The narrow duplicate rule for `assistant_final_visible`: Core suppresses only a recipient-free final whose normalized body exactly equals an earlier recipient-free Public Message from the same AgentRun. It performs no semantic similarity comparison and never suppresses an addressed send or a distinct conclusion.
_Avoid_: time-window dedupe, semantic dedupe, recipient-based suppression, Renderer filtering

**Runtime Activity Coverage Level**:
The Mapping Registry's description of how much activity a Runtime protocol actually exposes to Core:
`fine_grained`, `run_level`, or `unknown`. It describes observation capability, not product support,
quality, or permission; a lower level must not be upgraded by inferring hidden steps.
_Avoid_: Runtime support tier, feature promise, inferred internal event coverage

**v0.41 Local Data Clean Break**:
The v0.41 persistence boundary that accepts only the v0.41 data contract. Rovai-ai does not migrate or
backfill incompatible v0.40-or-earlier local application data; when the Rovai-owned store cannot meet
the v0.41 contract, it is reset only within the confirmed closed allowlist: `rovai.sqlite` and its
SQLite sidecars (including incompatible legacy `lumen.sqlite` remnants), `managed-blobs/**`,
`camp-attachments/**`, the registered Runtime projection roots, `runtime-private/**`,
`codex-homes/**`, `quick-chat/**`, and reset-manifest-registered app-owned staging/lock/temp paths.
The Core may clean its exact process-owned Built-in CLI IPC socket separately, but may not sweep `/tmp`.
User workspaces, user files, external Runtime configuration and credentials, Native Runtime Homes, and
project `.codex`/native Runtime state are outside this reset. Allowlist additions require a new manifest,
tests, and an explicit architectural decision.
_Avoid_: workspace deletion, Runtime reinstall, silent partial migration, historical Projection replay

**AgentRun Execution Evidence**:
A durable, append-only, user-visible record of provider-reported reasoning summaries, Agent progress narration, plans, steps, and structured tool/command/file lifecycle for exactly one AgentRun. It is authoritative SQLite state readable through the Camp Read Side until Camp deletion, while remaining absent by construction from CampMessage, ConversationMessage, FTS, public-message context composition, ContextManifest payloads, later AgentRun input, A2A context, and Memory sources. It contains only normalized Runtime-public information, never hidden raw reasoning or invented progress.
_Avoid_: chain of thought, Camp message, Renderer-only live cache, searchable Agent context, raw provider packet, Task completion evidence

**Execution Evidence Content**:
The bounded normalized text or structured payload of one AgentRun Execution Evidence record. SQLite stores an explicit preview, byte count, content digest and truncation flag; larger content uses an authorized Managed Blob reference whose lifetime is rooted by the Evidence record.
_Avoid_: silent truncation, local Blob path, raw protocol log, Markdown execution of tool output

**CampTurn Stop**:
The user-requested, idempotent cancellation of an active CampTurn's complete collaboration execution scope, including AgentRuns and unmaterialized Message Deliveries. Core atomically fences the Turn, cancels pending deliveries, closes new message/evidence/built-in-operation/descendant writes, and attempts native Runtime interruption before marking execution cancelled; Public A2A Messages, Message Deliveries, and Audit facts remain durable, while cancellation never creates a message to another member. The Composer's send position is the sole ordinary stop control while a CampTurn is active; Run Pulse, Header, Inspector, and Execution Drawer may project state or navigate but cannot cancel one Run or the Turn.
_Avoid_: stop current UI row only, external transaction rollback, Task cancellation, process signal without fencing

**Execution Drawer**:
The Scheme C bottom-docked, user-selected projection of one AgentRun's current and historical execution state, activities, evidence links, waits, failures, and Public Messages. It derives from Core Read Side facts, can switch which Run is inspected, and owns no stop, approval, dispatch, retry, or message authority; v0.45 introduces no single-Run cancellation action.
_Avoid_: terminal emulator, independent activity store, Run controller, public timeline item, per-Run stop panel

**Run Process Detail Surface**:
The single v0.45 user-facing route for inspecting an AgentRun's process, replacing the Inspector `活动` page. Run Pulse, Header Run counts, Public Message Run-origin links, and Audit/notification deep links select or open the same Execution Drawer; Canonical Runtime Activity and Execution Evidence remain backend authority rather than parallel UI state.
_Avoid_: duplicate Activity tab, message-embedded execution log, Renderer-owned lifecycle, independent Run monitor

**Conversation Surface Prototype Scope**:
The v0.45 HTML prototype's limited design authority: it demonstrates only Scheme C's Camp conversation-area composition—Run Pulse, public timeline separation, Run-origin navigation, and the bottom Execution Drawer. It does not replace Arctic Dawn navigation, Composer, Inspector, Approval Dock, tokens, copy, accessibility, responsive breakpoints, or stop authority; implementation must project those surfaces through their existing contracts and discard prototype-only content and styling.
_Avoid_: prototype as product spec, copied demo data, parallel design system, HTML-driven domain state

**Approval Dock**:
The existing Composer-adjacent projection of the authoritative pending Runtime Permission Request queue. It stays immediately above Composer whenever eligible requests exist, remains visible above an open Execution Drawer, and shares its object and decision command with Inspector `审批`; Drawer links may navigate to it but cannot duplicate or own approval controls.
_Avoid_: timeline message, Drawer approval copy, Renderer-only modal, approval completion event

**Run Pulse**:
The compact conversation-area projection of currently active or attention-relevant AgentRuns. It updates from Core Read Side state without entering the public message sequence, can open or select an Execution Drawer on explicit user action, and never auto-opens, steals focus, or switches the user's selected Run because of background activity. A selected Run's terminal state may remain inspectable in the open Drawer until the user dismisses it.
_Avoid_: live log, public status message, automatic Drawer trigger, Scheduler authority, per-Run stop control

**Unsettled External Effect**:
A Runtime delivery, Action, command, tool, file, or network effect whose occurrence or outcome remains unknown after its AgentRun has been fenced and cancelled. It remains an independently recoverable authoritative record and produces the user-facing warning “已停止 · 结果待确认” without blocking Composer reuse or automatically retrying the effect.
_Avoid_: running AgentRun, proof of non-execution, forced failure, automatic retry, cancellation blocker

**Structured Timeline Event**:
An immutable Camp system message presentation for a Task state change, carrying closed event-time display fields plus a safe textual fallback. It is ordered by authoritative CampMessage sequence and can navigate to the current Task Inspector without rewriting its historical title, status, assignee, or time.
_Avoid_: A2A message, mutable current-state card, parsed English system body, Execution Evidence, synthetic message ordering

**Public A2A Message**:
An immutable Agent-authored public Camp message that may address zero or more Camp Members. It is visible to the user and every eligible Camp Member, participates in public history, search, and Shared Conversation, and appears only once regardless of recipient count; delivery and target execution remain separate facts.
_Avoid_: private handoff, per-recipient message copy, delivery status message, user-only projection

**Message Delivery**:
The recipient-specific A2A execution responsibility created by one accepted Public A2A Message. Each Delivery owns its recipient identity snapshot, recipient-local queue position, frozen execution basis, and `pending | running | failed | cancelled | settled | interrupted_before_dispatch` lifecycle; `pending` distinguishes an initial no-attempt state from a post-attempt temporary wait condition, while `interrupted_before_dispatch` is a manual-intervention state because no dispatch attempt was established before a Core crash.
_Avoid_: per-recipient message, passive read receipt, AgentRun, public timeline item

**Delivery Wait Condition**:
The recipient-scoped temporary reason that keeps a Message Delivery pending after a real dispatch attempt, such as `target_busy`, `runtime_unavailable`, or `capacity_unavailable`. Only the corresponding recipient/Camp execution event may invoke another Dispatch Pump; a wait condition is not a terminal failure or proof that a Run started.
_Avoid_: generic pending flag, timer deadline, global retry reason, Runtime completion

**Delivery Dispatch Attempt**:
The durable boundary proving that Core actually began a recipient-scoped Dispatch Pump for one Message Delivery. A Delivery with no established Attempt after its acceptance transaction and a Core crash becomes `interrupted_before_dispatch`; once an Attempt exists, temporary blocking is represented by a Delivery Wait Condition. An explicit retry appends another Attempt to the same frozen Delivery and never reparses or broadens its recipients.
_Avoid_: message acceptance, queued row existence, process start proof, inferred Runtime work

**Interrupted Before Dispatch**:
The explicit manual-intervention Delivery state when the Message and Delivery commit but no Delivery Dispatch Attempt is established before Core failure. It is not revived by Core/App startup, Camp opening, a new message, or unrelated capacity changes; the user sees that the collaboration never started and may retry or cancel only that Delivery explicitly, while the containing CampTurn remains unsettled until that decision.
_Avoid_: ordinary Runtime wait, automatic recovery, partial send, failed AgentRun

**Delivery Manual Intervention**:
The user-controlled resolution required for an `interrupted_before_dispatch` Delivery. Until the user retries or cancels that specific Delivery, its CampTurn remains unsettled; the intervention never resumes every pending Delivery in the Camp or creates a replacement public message.
_Avoid_: Camp-level resume, automatic restart, Agent-authored retry, duplicate fan-out

**Message Delivery Queue**:
The durable recipient-scoped FIFO of Message Deliveries for one Camp/Agent target, ordered by a Core-assigned local queue position rather than canonical multi-recipient order, timestamps, or `--to` order. A recipient is busy while its target Run is active; only a direct recipient event may let the pump claim the eligible head and materialize exactly one AgentRun, without skipping or batching deliveries.
_Avoid_: Inbox, global priority queue, queued AgentRun, reply batch, timer window

**Message Delivery Dispatch Pump**:
A recipient-scoped, one-shot attempt to materialize the FIFO head of a Message Delivery Queue. Delivery acceptance and the exact event named by its current Delivery Wait Condition may invoke a Pump; Core/App startup restores durable state but does not scan or automatically dispatch historical Camps, and an `interrupted_before_dispatch` Delivery enters the Pump only through explicit Delivery Manual Intervention.
_Avoid_: periodic sweep, startup replay, global pending scan, timer polling, in-memory queue authority

**Delivery Context Materialization Gate**:
The recipient-scoped pre-Run boundary inside a Delivery Dispatch Attempt that assembles and freezes the Context Delivery Profile v2 payload against the Delivery's frozen execution basis and target Runtime limit. Success permits exactly one AgentRun to be materialized; if complete Current Input, the direct reference parent, and mandatory structure still cannot fit after optional recent history is removed, the Delivery becomes terminal `failed/context_payload_too_large` with no AgentRun or Runtime start. The Public Message and sibling Deliveries remain committed, and this deterministic failure is neither a wait condition nor an automatic-retry trigger.
_Avoid_: send-transaction preflight, ghost AgentRun, Runtime capacity wait, whole-message rollback

**Camp Message Send**:
The authenticated current-AgentRun action exposed as `camp.message.send` and `rovai send`, and the sole path for an Agent to publish into its Camp. Its Camp scope is derived only from the authenticated current Run, never selected or overridden by Agent input; Core resolves and deduplicates Effective Recipients from explicit targets, valid inline Agent Addressing Tokens, and reply-to defaults, with no private A2A path.
_Avoid_: Member Call, `team.call_member`, private message, per-recipient public copy, compatibility alias

**Camp Message Send Idempotency**:
The exact replay rule keyed by the canonical Camp Message Send input and one invocation identity. The accepted command records its Camp, source AgentRun, and execution epoch; durable Replay reuses those recorded identities rather than the currently active identity, returns the original Envelope and effects, and treats a changed input under the same identity as a conflict. Equal body/recipient content without the same identity remains a new intentional send.
_Avoid_: time-window dedupe, semantic similarity suppression, retry by body digest, Renderer duplicate filter

**Delivery Retry Identity**:
The explicit user-issued identity for one new Dispatch Attempt on an existing interrupted Message Delivery. Replaying the same retry identity is idempotent, and a retry cannot alter the frozen Public Message, recipient, or Delivery payload.
_Avoid_: new Public A2A Message, new recipient fan-out, automatic retry token, content-based retry

**A2A Delivery Slot Reservation**:
The acceptance-time accounting unit that preserves the per-CampTurn maximum of sixteen accepted A2A target AgentRuns even while Message Deliveries remain pending. Every accepted Message Delivery allocates exactly one slot for its recipient Run, including a later delivery back to an earlier member; allocated slots are never recycled within the Turn.
_Avoid_: post-Run counting, response reservation, unbounded pending queue, reusable concurrency permit, Runtime worker slot

**A2A Target AgentRun**:
A new AgentRun for one eligible CampMember inside the same CampTurn, created by exactly one Message Delivery after the recipient-scoped dispatch and Context gate succeed. Every forward Delivery enters one logical A2A depth deeper, including a delivery back to an earlier member; there is no special return path, reply batching, new CampTurn, or Runtime retry.
_Avoid_: Lead Turn, new CampTurn, reopened CampTurn, Native Session resume, Lead-only continuation, reply batch

**CampTurn Collaboration Settlement**:
The authoritative aggregation that keeps a CampTurn non-terminal while any Message Delivery is pending, `interrupted_before_dispatch`, or any AgentRun is `queued`, `running`, or `waiting`. Once those accepted execution responsibilities settle through normal completion, failure, cancellation, or Delivery Manual Intervention, Core determines the terminal result without requiring the original sender or Default Lead to run again; missing integration may be a semantic-review finding but never a response obligation or settlement blocker.
_Avoid_: AgentRun-only aggregation, early completion, Outcome-as-recovery, business-result verification

**Application-Managed File Safety**:
The path, symlink, ownership, permission, size, and atomic-write protections applied when Rovai-ai manages its own blobs, projections, private configurations, sockets, logs, or temporary files. It is independent of Runtime-Managed Permission and remains Core-enforced.
_Avoid_: Agent filesystem permission, Run Workspace boundary, Runtime sandbox

**Prepared Attachment**:
A Core-owned file resource inside one Camp Composer Draft that is ready to be consumed by one accepted message send. It has no original local path in product-facing state, remains distinct from a Message Attachment, and may survive Camp navigation or application restart until it is sent, explicitly discarded, or automatically expired.
_Avoid_: Message Attachment, Renderer file path, uploaded message, permanent draft

**Camp Composer Draft**:
The private, durable user preparation for one future CampMessage, containing Structured Camp Message Content and ordered Prepared Attachments. It may survive Camp navigation or application restart, is invisible to Agents and public history, and is consumed only by an accepted send.
_Avoid_: CampMessage, New Conversation Draft, Agent context, public draft

**Camp Composer Draft Revision**:
The opaque, monotonically advancing identity of one exact Camp Composer Draft state. A send can consume only the referenced current Revision, so a newer Draft remains a distinct unsent preparation.
_Avoid_: updated timestamp, Renderer counter, CampMessage version, best-effort autosave marker

**Structured Camp Message Content**:
The authoritative ordered content of one user-authored Camp Composer Draft and its accepted CampMessage, using only `Text`, `MemberMention(agentId)`, and `AllMembersMention` segments. Plain-text display and recipient projections derive from it; a legacy message remains one Text segment while its existing recipient identities remain separate historical facts.
_Avoid_: generic rich-text document, HTML, Markdown AST, mention character offsets, parallel body and routing truth

**Message Attachment**:
An immutable managed-content resource belonging to one accepted public CampMessage and created by consuming a ready Prepared Attachment with that message. Its single authoritative file has a stable Camp Attachment Path, and its content and metadata share the CampMessage's public visibility for every currently eligible CampMember regardless of message addressing; it supplements a required non-blank message body and can never constitute a body-free message by itself.
_Avoid_: Prepared Attachment, addressed-recipient attachment, pure attachment message, local file path, mutable upload

**Camp Attachment Path**:
The stable, read-only application-managed filesystem path of one Message Attachment inside its Camp Attachment Directory. Every currently eligible CampMember may discover and read the same path when the owning public message is inside that AgentRun's frozen message boundary; the file is neither copied into a Run nor placed in a user-selected Project workspace.
_Avoid_: Run Attachment Projection, original local path, Managed Blob path, Project file

**Camp Attachment Directory**:
The Rovai-ai-managed directory that owns the authoritative Message Attachment files for one Camp. It follows the Camp lifecycle and never becomes part of the Camp Workspace Binding or a Git worktree; its existence does not create a live directory feed or let an AgentRun discover attachments beyond its frozen public-message boundary.
_Avoid_: Run projection root, live attachment feed, Project attachment folder, user-selected workspace, cross-Camp library

**Run Workspace**:
The immutable absolute, existing startup and recovery working directory of one AgentRun. It carries no filesystem authority and is not a model-controlled built-in operation field. An A2A target Run receives the source Run Workspace path by deterministic Core rule, while the recipient continues to use its own Adapter Permission Configuration. A sender may instead describe another filesystem path in ordinary message or Task content; the recipient interprets that instruction and accesses or switches to the path through its own Runtime without changing the frozen Run Workspace.
_Avoid_: permission boundary, sandbox root, inherited sender permission, project ownership

**A2A Parent Run**:
The authenticated source AgentRun from which Core accepts a Message Delivery and later creates its consuming AgentRun. Core derives and freezes the parent, root, and depth identities from the current Runtime binding; no LLM input may supply or override them.
_Avoid_: built-in operation argument, model-generated Run ID, Task ownership, permission inheritance

**A2A Context Transfer**:
The bounded collaboration handoff in which the sending LLM supplies only the necessary `content`, recipient and optional historical Task link. Core deterministically assembles the target AgentRun input from that handoff, the recipient's own Conversation continuity, authorized Camp context, and frozen context boundaries; it never copies the sender's complete prompt, private Conversation, hidden reasoning, or generic model-supplied references.
_Avoid_: serialized sender prompt, LLM-generated context blob, private Conversation inheritance, Task ownership transfer

**Execution Admission**:
The authoritative SQLite transaction that resolves exact Camp targets, validates Member Presence, frozen Runtime configuration, Rovai-ai business Capabilities, Task state and domain invariants, then atomically persists each required Conversation, CampMessage, CampTurn and queued AgentRun. It performs no Workspace filesystem check, Git observation, Runtime discovery, executable read or fingerprint calculation. The first accepted user submission also changes a `default` Camp Name Origin to `generated` in the same transaction.
_Avoid_: execution preflight, Runtime permission policy, disabled Composer, Renderer readiness guess, partial delivery, automatic Lead fallback

**Execution Dispatch Check**:
The scheduler-owned pre-launch boundary for one queued AgentRun. It performs a lightweight canonical Workspace safety check, validates the current Runtime state and executable identity against the frozen Run Runtime Configuration, then records the starting Git observation before claiming and starting the Run. Failure marks the queued Run failed and lets its CampTurn fail or wait for repair/retry without removing the trigger message or writing a false start observation.
_Avoid_: message-send preflight, CampMessage admission, Git permission policy, Renderer readiness guess

**Capability**:
A Core-enforced business authorization atom that allows an Agent to request a class of Rovai-ai domain mutation outside the uniform Built-in Tool Catalog contract. It is distinct from record visibility, operation-specific invariants, and Adapter filesystem/Shell/network permissions; it cannot vary which canonical built-in operations an eligible Member may invoke.
_Avoid_: Built-in Tool availability, visibility scope, Adapter permission, universal administrator role

**Skill**:
A reusable directory package of instructions and optional supporting resources that an Agent Runtime can discover and load when relevant.
_Avoid_: System Prompt, Built-in CLI operation, MCP Server, AgentProfile

**Skill Library**:
Rovai-ai's application-global collection of managed Skills, independent of their import source and of every Runtime's personal Skill directories.
_Avoid_: Runtime personal Skill store, Project Skill directory, source folder

**SkillRevision**:
An immutable snapshot of one Skill's complete managed content. A Skill selects one current revision while older revisions remain distinct for as long as that Skill is retained.
_Avoid_: Mutable Skill folder, in-place update, Runtime cache

**SkillProjection**:
A reconstructible Rovai-ai-managed filesystem entry that exposes one SkillRevision through a Runtime's native project-level discovery path for an execution root.
_Avoid_: Skill source of truth, Runtime personal installation, proof that a model loaded the Skill

**MCP Library**:
Rovai-ai's application-global collection of user-visible external MCP Server definitions. It is an independent source of truth and never includes Rovai built-in operations.
_Avoid_: Runtime personal MCP configuration, remote marketplace, Built-in CLI catalog

**MCP Import**:
A user-confirmed, one-time copy of portable MCP Server definitions from known local Agent configuration sources into the MCP Library. It does not establish ongoing synchronization, mutate the source configuration, or copy credentials and OAuth tokens. Environment references may be copied, but every literal `env` or `headers` source value is omitted from the normalized candidate and represented only as a rebind requirement; it must be re-entered, converted to a reference, or removed before import.
_Avoid_: MCP sync, configuration mirroring, credential migration

**MCP Import Candidate**:
A read-only, transient discovery result from a known Runtime user-level configuration. It is not an MCP Server Definition until the user confirms import. Recognized syntax and structure may be normalized losslessly; known non-authority operational options may be listed and dropped, while unrecognized fields or unrepresentable authority semantics make the candidate ineligible for automatic import.
_Avoid_: Imported Server, synchronized record, project configuration

**MCP Tool Policy**:
A future cross-Runtime policy that would define tool visibility, execution denial, and approval semantics independently of one Runtime's native configuration dialect. Rovai-ai currently has no such portable policy, so source tool filters, auto-approval, trust, OAuth, sandbox, or approval fields cannot be claimed as equivalent or migrated automatically.
_Avoid_: MCP Assignment, Server enablement, ignored Runtime-specific tool rules

**MCP Server Definition**:
A named external MCP Server connection definition in the MCP Library, expressed to users as standard `mcpServers` JSON and translated by each AgentRuntimeAdapter into Runtime-native configuration. It contains neither Member allocation nor an MCP Assignment; Rovai-ai management metadata is not part of the user-authored connection definition.
_Avoid_: MCP Assignment, split connection form, Runtime-specific configuration blob, running MCP process

**MCP Server ID**:
The immutable opaque identity of one MCP Server in the MCP Library. MCP Assignments reference this identity so editing the MCP Server Definition or MCP Server Name cannot retarget authority to a different Server.
_Avoid_: MCP Server Name, configuration digest, Runtime-native alias

**MCP Server Name**:
The unique, user-editable object key of one entry in `mcpServers`, used as its ordinary product label and preferred Runtime-facing name. It is a 1-64 character portable ASCII identifier matching `[A-Za-z0-9][A-Za-z0-9_-]{0,63}` and is unique under ASCII case folding. No name, including the retired `rovai_team`, grants or impersonates Rovai built-in behavior; the name is not duplicated as a `serverName` field, is not the Server's identity, and MCP Assignments never reference it.
_Avoid_: MCP Server ID, immutable identity, Assignment key

**MCP Runtime Name**:
The canonical MCP Server Name presented to the target Runtime for one requested Projection entry. Current Adapters do not create private aliases; the separately recorded field exists only so Exposure can state the actual Runtime-facing name without treating it as Server identity.
_Avoid_: MCP Server ID, persistent alias, user-visible rename, collision workaround

**MCP Same-Name Policy**:
The Adapter-declared rule for resolving a collision between a requested Rovai MCP Server and a Runtime-native Server with the same canonical MCP Server Name. `NativeWinsSkip` preserves the native Server and records the Rovai request as skipped; `RovaiWins` is valid only where the Adapter proves whole-definition precedence, never field-level merging. The policy and actual disposition are frozen into the AgentRun's MCP Exposure Snapshot.
_Avoid_: universal Rovai precedence, universal native precedence, field merge, unrecorded collision

**MCP Configuration File**:
The application-global `~/.rovai/mcp.json` file that is the sole source of truth for external MCP Server definitions, enablement, immutable Server identities, and MCP Assignments. Its public `mcpServers` object contains only connection definitions, while one hidden sibling `_rovai` object contains schema version, identity, enablement, provenance, and Assignment state. Production code neither falls back to old brand paths nor migrates or accepts an old MCP schema; SQLite does not duplicate MCP Assignment truth. Parsing rejects duplicate JSON object keys rather than accepting last-key-wins behavior.
_Avoid_: MCP database truth, generated Runtime projection, synchronized source config

**Reviewed MCP Default**:
One of the Context7 and Playwright Server definitions atomically materialized only when a new MCP Configuration File is created. It starts disabled and unassigned, becomes an ordinary editable or deletable definition after creation, is never restored automatically, and is not overwritten by an application upgrade. Playwright retains high-permission risk provenance and uses an exact reviewed package version with isolated state.
_Avoid_: enabled-by-default Server, managed subscription, floating dependency, auto-restored preset

**MCP Environment Reference**:
A strict `${NAME}` placeholder resolved by Core from the Agent Host environment while materializing an AgentRun projection. References may occupy all or part of an `env` or `headers` string value, `$${NAME}` escapes a literal placeholder, and no Shell syntax or interpolation in `command`, `args`, `url`, or `cwd` is supported. Runtime Adapters receive resolved values rather than interpreting references independently.
_Avoid_: Shell expansion, Runtime-specific variable syntax, persisted resolved credential

**MCP Assignment**:
The explicit relationship from an immutable MCP Server ID to one AgentProfile that requests best-effort addition of that Server to the AgentProfile's future Runtime exposure. It is desired projection intent rather than an availability guarantee or AgentRun startup dependency: every omission or collision outcome is disclosed in the MCP Exposure Snapshot while the base Run may continue. Assignment configuration remains available independently of the AgentProfile's selected Runtime capability; Presence changes do not delete the Assignment, while away and removed Profiles cannot produce a new MCP Exposure Snapshot.
_Avoid_: required Runtime dependency, guaranteed Server availability, Runtime-filtered configuration, Camp MCP scope, Project MCP scope, automatic all-Agent exposure

**Additive MCP Projection**:
An Adapter capability that preserves Runtime-native MCP Servers while attempting to add the ready Rovai MCP Servers requested for one AgentRun. Same-name handling is governed separately by MCP Same-Name Policy; once an Adapter finalizes an entry as ready, Runtime rejection fails startup rather than silently removing the entry, retrying empty, or switching to replacement semantics.
_Avoid_: exact ambient isolation, replacement projection, empty-set fallback, best-effort transport claim

**MCP Projection Input**:
The immutable Definition, enablement, Assignment, resolved environment, and configuration-digest input captured when an AgentRun is created. Every startup attempt for that Run derives from this same input and never rereads the live MCP Configuration File.
_Avoid_: final effective tool set, mutable settings view, retry-time config reload

**MCP Exposure Snapshot**:
The final immutable effective MCP result sealed after an AgentRun successfully establishes its Runtime Session, including requested and projected Servers, the Adapter's MCP Same-Name Policy, every collision disposition, any canonical-to-Runtime name mapping, and non-sensitive reason codes for Servers that were not projected. Recovery reuses it without retrying omitted Servers; changes affect only later AgentRuns without changing the Conversation identity.
_Avoid_: Native Session configuration identity, live mutable tool list, MCP Assignment

**MCP Readiness Status**:
A non-probing view derived from canonical configuration validity, environment and path readiness, Adapter capability, and the latest frozen AgentRun projection result. It does not start a Stdio Server, contact a remote endpoint, or claim that a configuration-ready Server is currently online.
_Avoid_: live health check, connectivity guarantee, implicit third-party execution

**MCP Projection Diagnostic**:
The diagnostics-only read model of one Adapter's dynamic projection capability and one AgentRun's actual MCP Exposure Snapshot. An unsupported Runtime or skipped Server is disclosed here without hiding MCP configuration, preventing Assignment, changing Member eligibility, or adding warnings to the ordinary MCP configuration surface.
_Avoid_: MCP configuration gate, Member capability restriction, ordinary settings warning, Assignment validation

**External MCP Runtime Minimum**:
The earliest Runtime version for which development-time acceptance proves an Adapter's declared additive dynamic channel and Same-Name Policy. Versions below the minimum are unsupported; versions at or above it continue to use the proven mechanism without an upper version cap or a user-machine capability Smoke. A newer Runtime is not disabled merely because Rovai-ai has not pinned that exact version.
_Avoid_: tested-version ceiling, exact-version allowlist, user-machine preflight Smoke

**Real MCP Smoke**:
A development-time acceptance run that launches an actual Runtime CLI against actual MCP protocol processes or reviewed remote endpoints. Same-name Smokes use distinguishable native and Rovai Server results to prove the Adapter-specific Same-Name Policy while separately proving that non-conflicting native Servers remain available; default Smokes exercise Context7 and isolated Playwright. Missing prerequisites produce an explicit unverified result and can never be replaced by a mock success.
_Avoid_: user-machine startup probe, rendered-config snapshot, mocked protocol success

**MCP Runtime Projection**:
The Adapter-native realization of one Additive MCP Projection when Rovai launches or resumes an Agent Runtime. It preserves Runtime-native configuration, applies the Adapter's Same-Name Policy without field merging, and never mutates user or project Runtime files; process arguments, Session configuration or Rovai-owned `0600` temporary files carry only the requested additions. An Unsupported Adapter performs no dynamic injection while the base Run continues. Rovai built-in operations never enter this projection, and a successful Runtime Session seals the final facts into its MCP Exposure Snapshot.
_Avoid_: replacement config, Runtime personal MCP source of truth, central MCP proxy, empty-set retry

**Built-in Tool Transport**:
The sole model-facing path from an Agent Runtime through the `rovai` CLI and local Core IPC to Rovai-owned canonical Team, Task, Camp History, and Memory operations. It is a required AgentRun execution facility and remains separate from user-configured external MCP Runtime Projection.
_Avoid_: external MCP proxy, Runtime-native tool alias, optional degraded capability, duplicated domain handler

**Built-in Tool Catalog**:
The complete versioned semantic surface of canonical Rovai built-in operations exposed identically to every eligible Agent through CLI list and describe. It is fixed by the currently running App build; installing another App version requires an App restart, and no active process hot-adds or hot-reloads operations. Every eligible Member may invoke every listed operation; Core applies current membership, record visibility, context fences, versions, quotas, and operation-specific invariants, but no per-Member Capability or allowlist changes operation availability.
_Avoid_: per-Member tool list, Capability snapshot, operation allowlist, Runtime-specific alias catalog, in-process catalog hot reload

**Built-in Tool Discovery**:
The Core-internal and qualification-only retrieval of the Built-in Tool Catalog, operation schemas, Agent output projections, error contracts, and Envelope contract. It is not an Agent-facing CLI protocol; an Agent learns fixed business commands and their bounded `--help` text instead.
_Avoid_: Agent-facing `tool list`, Agent-facing `tool describe`, schema-filled Bootstrap, duplicated tool documentation, Runtime-native tool discovery, dynamic alias instructions

**Agent Command Help**:
The concise, command-specific usage surface for one fixed Built-in Tool CLI Command. It gives the flags, mutually exclusive input sources, essential constraints, and a short example without exposing the complete catalog, business Schema, Agent output contract, Envelope, receipt, or internal error table.
_Avoid_: Tool Discovery, full JSON Schema, Envelope documentation, generic invoke help, hidden discovery command

**Built-in Tool CLI Command**:
The stable, domain-grouped shell spelling that maps one-to-one to a Canonical Operation, such as `rovai send` for `camp.message.send` or `rovai memory propose-hearth` for `memory.propose_hearth`. The command is the fixed Agent-facing presentation with bounded Agent Command Help, while the canonical dotted operation remains the identity used internally by Core, receipts, replay, audit, Dynamic Context, and Canonical Runtime Activity.
_Avoid_: canonical operation rename, Runtime-specific alias, `rovai tool call`, MCP tool name

**Built-in Tool CLI Input**:
The canonical JSON input assembled by one invocation from exactly one supported source: schema-derived direct flags, JSON read from stdin (including a shell heredoc), or JSON read from `--input-file`. Every source normalizes to the same canonical input and receives the same Core validation and authority checks; input files are recommended for long bodies, not required as a security boundary.
_Avoid_: input-source precedence merge, different semantics by input mode, file-only contract, claim of transcript secrecy

**Built-in Tool Runtime Parity**:
The release-gated state in which Codex CLI, Claude Code, OpenCode, GitHub Copilot CLI, Kiro CLI, Qoder CLI, CodeBuddy, Qwen Code, and Antigravity all pass the same real-model CLI discovery, read, mutation, replay, fencing, and negative-path contract. Shell availability is a prerequisite, not acceptance evidence; no listed Runtime may ship with partial, legacy, or degraded built-in transport.
_Avoid_: eight-of-nine completion, fixture-only support, Bash presence as proof, per-Runtime legacy fallback

**Legacy Built-in MCP Transport**:
The retired mechanism that exposed Rovai-owned canonical operations through the injected `rovai_team` MCP Server, Runtime aliases, schema dialects, or attested attachments. It is neither a supported fallback nor a compatibility mode after the CLI-only migration.
_Avoid_: Built-in Tool Transport, external MCP, `mcp_legacy`, silent fallback

**Built-in Tool Clean-Slate Cutover**:
The development-only switch to CLI transport after the current local application data has been discarded. Product code removes the Legacy Built-in MCP Transport outright and contains no installed-data migration, compatibility detection, legacy configuration cleanup, or fallback behavior.
_Avoid_: production upgrade path, automatic legacy cleanup, dual transport, compatibility shim

**Canonical Operation Result**:
The transport-independent business result of one canonical Rovai built-in operation. It retains the operation's existing flat business fields and excludes invocation status, operation identity, request identity, receipt, and MCP-specific fields.
_Avoid_: Built-in Tool Invocation Envelope, MCP structured content, CLI response, nested `result.task`

**Agent Result Projection**:
The explicit operation-specific JSON view emitted by the `rovai` CLI after Core validates a complete Built-in Tool Invocation Envelope. Successful output is the Canonical Operation Result; business failure is an `error` object containing the business-required `code`, safe `message`, `recovery`, and any contract-approved details. At the Envelope-to-Agent boundary, the projection never passes through Envelope-owned `contractVersion`, `ok`, `operation`, `requestId`, or `receipt`, and never retains the Envelope's `result` wrapper. That boundary rule does not prohibit a future business result from legitimately using one of those names. Each operation has a closed, explicit `agentOutputSchema` and golden fixture that constrains actual output; there is no global recursive forbidden-field scan. Transport and audit identity remains outside the Agent's ordinary output and cannot be re-enabled by a Runtime environment variable or hidden CLI switch. Output reduction is measured and reported as an observation, not a release gate.
_Avoid_: compact Envelope, reduced Envelope, transport response, debug Envelope, generic recursive field stripping

**Built-in Tool Invocation Envelope**:
The versioned Core-owned response wrapper for one Rovai built-in operation invocation, carrying `ok`, canonical `operation`, `requestId`, `receipt`, and exactly one of `result` or `error`. Core IPC, Evidence, Qualification, and host-controlled debug may retain it; the Agent-facing CLI must validate it and emit only the operation's Agent Result Projection. No transport may create its receipt or reshape its Canonical Operation Result before validation.
_Avoid_: Canonical Operation Result, MCP structured content, Runtime Adapter response contract

**Built-in Tool Recovery Guidance**:
The Core-owned, machine-readable handling rule attached to a rejected built-in invocation. A stable error code, concise safe message, recovery class, and optional whitelisted business details tell the Agent whether to correct input, reread and decide, retry the same request, stop, or report an indeterminate outcome; callers never infer retry safety from prose alone.
_Avoid_: raw exception, stack trace, blind mutation retry, transport-authored advice, `retryable` without a recovery rule

**Built-in Tool Invocation Replay**:
Core's recognition of a repeated delivery of the same built-in invocation and semantic request. It returns the original committed result and receipt without repeating the operation's effects; reuse of that invocation identity with different content is a conflict, not a new call.
_Avoid_: new model-requested invocation, duplicate Task, duplicate Message Delivery, payload-based deduplication

**Built-in Tool Activity**:
The single user-facing Canonical Runtime Activity for one Core-verified built-in operation invoked through the CLI. A positively correlated Runtime shell execution remains immutable supporting transport Evidence inside its details rather than a second top-level activity; without a verified correlation, Core preserves separate activities instead of merging by command text or timing.
_Avoid_: duplicate shell row, deleted Runtime Evidence, command-text classification, temporal correlation

**Indeterminate Built-in Tool Outcome**:
The explicit result when a built-in invocation may have reached Core but bounded replay cannot establish either its committed receipt or authoritative rejection. Its Agent Result Projection contains only the stable `builtin_tool.outcome_indeterminate` error, safe message, and `confirm_outcome` recovery; it never exposes the hidden request identity or authorizes blind re-invocation.
_Avoid_: ordinary operation error, confirmed rejection, automatic duplicate invocation

**Built-in Tool Process Identity**:
The stable identity of one Core-managed Agent Runtime process across compatible sequential AgentRuns. It proves process ownership but never grants authority to act for whichever AgentRun happens to use that process now.
_Avoid_: AgentRun identity, Built-in Tool Lease, reusable execution authority

**Built-in Tool Lease**:
The short-lived, Core-owned authority that binds one managed Runtime process to exactly one current AgentRun and execution epoch. It is replaced for every Fleet acquire and fenced before process reuse, so a late invocation from an earlier Run cannot act for a later Run; its internal identity and secret are never model input.
_Avoid_: stable process credential, Native Session identity, model-supplied AgentRun identity

**Built-in Tool Execution Authority Boundary**:
The accepted Shell-transport boundary in which a valid invocation from the current Runtime process or any subprocess it launches is attributed to the same AgentRun and Member. Core can prove the active lease and enforce domain rules but cannot reliably prove whether the model typed the invocation directly or project code triggered it indirectly; every accepted invocation remains independently audited and the authority ends when the lease is fenced.
_Avoid_: model-intent attestation, separately trusted project subprocess, parent-process heuristic, post-Run authority
