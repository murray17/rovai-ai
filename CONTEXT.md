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
The product-facing name for an AgentProfile that a user can configure and invite into one or more Camps. It is not a separate domain object.
_Avoid_: Teammate, Member entity, member record

**Member Name**:
The globally unique, user-configurable `AgentProfile.displayName` shown in member settings, mentions, messages, Camp titles, and other ordinary product surfaces. It is the only user-facing member identity label; duplicate names are rejected on create or edit.
_Avoid_: Handle, slug, routing key, parenthesized disambiguator

**Member Mention**:
An explicit structured reference from one user-authored Camp message to one current Member, created only through mention discovery or preservation of an existing structured reference. It is the sole source of explicit member addressing; lookalike text and implicit Default Lead addressing are not Member Mentions, and target mentionability is independent of Runtime readiness.
_Avoid_: parsed `@` text, textual mention, Handle mention

**All Members Mention**:
The single explicit structured `@所有成员` reference in one user-authored Camp message. At accepted send it expands to and freezes the exact set of present CampMembers addressed by that message, while remaining one atomic token in the Composer and history; later membership or Presence changes never rewrite its historical recipient set.
_Avoid_: dynamic broadcast, future-member subscription, expanded Member Mention list, unaddressed message

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
The optional `工作准则` statement describing stable working methods, quality expectations, and collaboration boundaries for later-created AgentRuns. It cannot grant permission, satisfy Approval, override current user input, or change an already frozen AgentRun.
_Avoid_: member instructions, Runtime permission, Capability, current user request, mutable Run prompt

**Member Growth Topic**:
The optional `成长课题` statement naming a direction a Member currently intends to practise or improve through future collaboration. It is personal AgentRun context, not a personality or ability rating, Memory, automatic write trigger, or requirement to fabricate progress; replacing it never revises, retires, or forgets existing Memory.
_Avoid_: performance score, current Task, Memory body, automatic Memory trigger, permanent trait

**Member Identity Snapshot**:
The immutable six-field identity selected from one AgentProfile when an AgentRun is created. A later Profile edit affects only later-created Runs and never changes a queued, waiting, running, recovering, or completed Run.
_Avoid_: live Profile read, Session identity, avatar, Runtime configuration, Capability bundle

**Member Identity Update**:
The versioned atomic user command that saves exactly one AgentProfile's six identity fields. Avatar, Runtime configuration, permissions, Presence, Memory Capability, and other Profile concerns have independent mutation boundaries and cannot partially join or roll back an Identity Update.
_Avoid_: whole-profile save, avatar update, Runtime update, Memory Capability update, multi-section transaction

**Member Identity Context**:
The required `MEMBER_IDENTITY` personal-information section that delivers exactly one AgentRun's frozen Member Identity Snapshot. It can update identity inside an existing Native Session but never rotates that Session, rewrites another Run, reads live Profile state, or grants authority.
_Avoid_: Session Charter identity, live Profile prompt, Native Session replacement, permission update

**Peer Member Identity Projection**:
The collaboration-facing subset of another Camp Member's identity containing only stable routing identity, Name, Team Role, Professional Responsibilities, and advisory availability. Personality Traits, Working Principles, and Growth Topic remain private to that Member's own Identity Context.
_Avoid_: complete Member Identity Snapshot, personality profile, peer instruction, Capability projection

**Member Routing ID**:
The stable, opaque 12-character Base58 value stored in the legacy `AgentProfile.handle` field for internal compatibility. Core generates it for new Members, users cannot view or edit it, and changing a Member Name never changes it. Existing historical handles remain valid without migration.
_Avoid_: User handle, username, display name, editable slug

**Member Presence**:
The user-controlled lifecycle of one AgentProfile: `present`, `away`, or terminal `removed`. Presence is independent from Runtime configuration, Runtime Readiness, CampMember relationships, and Memory Lifecycle; a present Member may have no configured Runtime.
_Avoid_: Runtime readiness, online status, Camp membership status, active Agent

**Permanent Member Removal**:
The irreversible transition of one AgentProfile to `removed`, excluding it from the member directory and every future execution, routing, assignment, and projection surface while retaining its identity, opaque routing ID, avatar, Runtime configuration, Memory, Camp relationships, Tasks, Runs, and history. Historical identity remains renderable but not navigable.
_Avoid_: data deletion, Memory Forget, profile erasure, reversible archive

**Member Order**:
The user-controlled global ordering of manageable AgentProfiles used for presentation, new-Camp initial Lead selection, and future repair of an invalid existing Default Lead. Reordering never replaces a currently valid Lead and does not express authority or capability.
_Avoid_: Role priority, capability rank, Camp-specific order, circular succession cursor

**AgentProfile**:
An Agent's stable identity, Member Presence, role, and optional character presentation, with optional user-selected default Runtime preferences, independent of any particular Camp. A removed AgentProfile remains an internal historical identity but is no longer a manageable Member.
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
A direct, immediately effective `memory.write` add or revise from a current fenced AgentRun into Companion(current Agent) or an applicable Relationship. Core derives the actor and Scope, enforces Capability, current membership, direction, capacity, secret and concurrency rules, and never treats the write as user confirmation.
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

**Memory Write Capability**:
The business Capability frozen into an AgentRun that permits bounded direct Companion/Relationship writes and Hearth Memory Proposal submission. It never authorizes a Hearth Proposal decision, Lifecycle operation, cross-Agent Companion write, reverse-direction Relationship write, or access outside the current Run.
_Avoid_: tool visibility, user permission, Hearth write authority, Memory management role

**Agent Memory Write Policy**:
The application-global, user-controlled switch that enables future direct Agent Memory Writes and Hearth Memory Proposal submissions. It defaults on, is rechecked transactionally for every Agent mutation, and never changes or removes existing Memory when disabled.
_Avoid_: Memory Write Capability, per-Memory confirmation, retroactive retirement, Agent preference

**Memory Stewardship Skill**:
The single default-enabled Bundled Skill `memory-stewardship` (“共同记忆维护”) that teaches durable-memory judgment, authorized search/read, atomic wording, Retrieval Keys, duplicate and secret checks, direct non-Hearth writes, and the Hearth Proposal boundary. It uses Runtime-native SkillProjection and grants no Capability or fallback prompt injection.
_Avoid_: per-Scope Skill, Memory authority, mandatory System Prompt, unsupported-Runtime emulation

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
The present CampMember persisted as the destination for unaddressed execution requests and as the Camp-wide coordination reader. Runtime configuration and Readiness do not determine Lead validity; failed execution never silently falls back to another member. An invalid Lead is repaired idempotently when entering the Camp using the latest Member Order.
_Avoid_: Task Assignee, universal administrator, Native Session owner, Runtime fallback target

**Initial Default Lead Selection**:
The required selection of one Initial Camp Membership member as the Camp's Default Lead. The creation UI initially selects the first Runtime Ready member in stable Member Order, or the first selected member when none is Ready. Every selected member remains eligible regardless of Runtime Readiness; Readiness affects later execution admission rather than Lead identity. A manually selected Lead remains selected while included in Initial Camp Membership; removing that member automatically selects the first remaining member in stable Member Order as the replacement Lead.
_Avoid_: Runtime-determined Lead validity, Runtime fallback target, automatic recipient

**Conversation**:
One AgentProfile's long-lived private continuity inside one Camp, independent of whichever external Runtime currently serves it. Camp creation does not preallocate empty Conversations for Initial Camp Membership. An admitted execution submission atomically creates a missing Conversation only for each exact target alongside its CampMessage, CampTurn, and AgentRun; non-target members remain without Conversations until later targeted.
_Avoid_: Camp, Native Session, AgentRun, public chat transcript

**Task**:
An optional durable responsibility item inside one Camp, used when work must remain visible across messages, AgentRuns, or member coordination. `completed` records an authorized actor's declaration of completion, not verification by Rovai-ai Core. Tasks do not form a dependency DAG or a Core-enforced workflow. A Member Call may explicitly link one non-terminal Task assigned to its recipient at acceptance, but the frozen historical link neither transfers responsibility nor proves completion. Later Task completion, cancellation, or reassignment never cancels, fails, retargets, or wakes that accepted Conversation Input; its Run may observe the latest collaboration state and act accordingly. An A2A target Run never inherits the source Run's Task association. A Task may describe a filesystem path as ordinary semantic content, but it does not own or structurally transfer an AgentRun working directory.
_Avoid_: Camp, Conversation, chat thread, internal plan, one-off A2A request, workflow node

**Team Delivery Qualification**:
A bounded evaluation of whether a frozen Camp team, after receiving one software-delivery request through its Default Lead, can reach a terminal AgentRun tree and produce a workspace outcome accepted by an external verifier within a fixed budget and without human intervention after dispatch. It is evidence about end-to-end delivery for the evaluated cases, not a Task completion declaration, a general capability claim, a comparison with a solo Agent, or attribution to a Member Team Role.
_Avoid_: Task completion status, general Agent capability, solo comparison, role attribution

**Qualification Team Configuration**:
The exact four-Member production setup evaluated by one Team Delivery Qualification, including Camp membership, Default Lead, Member identity context, Runtime and model settings, permissions, Capabilities, and recorded product versions. Every configured Member belongs to the evaluation subject, while only Members that receive an AgentRun participate in a particular case.
_Avoid_: arbitrary Agent Team, mandatory four-Agent execution, mutable personal setup

**Collaboration Path Calibration**:
A non-scoring prerequisite run whose user input prescribes necessary independent Member Calls so that Team Tool discovery, context transfer, and Lead integration can be distinguished from autonomous coordination. Its explicit collaboration contract may determine Calibration success, but never becomes a response protocol or Hard Outcome gate for an Autonomous Qualification Trial.
_Avoid_: Team Delivery Qualification result, autonomous collaboration score, production task pass

**Autonomous Qualification Trial**:
The scored execution of one Team Delivery Qualification case whose user input states the delivery outcome and constraints without naming Members or prescribing collaboration steps. After dispatch to the Default Lead, Member selection, handoffs, implementation, verification, and convergence proceed without human intervention.
_Avoid_: guided collaboration, scripted role sequence, user-directed delegation

**Formal Qualification Trial**:
An Autonomous Qualification Trial driven through public Core commands against one recorded packaged Release Core, fresh Core data, real frozen Product Runtime installations, and an admitted Intervention Isolation Profile with no competing Rovai Core process. Debug Core, shared-user execution, Renderer automation, direct SQLite mutation, public demo fixtures, and reused production collaboration state cannot produce formal qualification evidence.
_Avoid_: Smoke Test, demo run, shared-user diagnostic, Debug Core result, desktop UI automation

**Qualification Environment Manifest**:
The immutable evidence identifying the exact Rovai build, Runner, host, Qualification Team Configuration, Product Runtime executables and capability snapshots, models, permissions, Team Gateway, admitted Intervention Isolation Profile, external-effect policy, case seals, and relevant toolchains shared by a comparable set of Formal Qualification Trials. Material pre-dispatch drift ends that set and requires a new Manifest rather than extending prior results.
_Avoid_: permanent compatibility claim, mutable machine description, incomplete version label

**Qualification Case**:
A versioned software-delivery evaluation unit containing one starting workspace, outcome-focused user request, external verification contract, fixed Trial budgets, and explicit allowed or forbidden change boundaries. Correctness is determined from required behavior and constraints rather than similarity to a reference patch.
_Avoid_: production Task, target commit diff, prompt alone, hidden test alone

**Delivery Requirement**:
One stable-ID, sealed behavior or constraint disclosed in the user request or its public Case Contract that every delivered workspace must satisfy for Verified Delivery. All Delivery Requirements are Hard Gates; a priority label may order failure diagnosis but never make a failed requirement non-gating.
_Avoid_: hidden obligation, optional requirement, weighted criterion, Semantic Judge item, diagnostic suggestion

**Hard Check**:
A stable-ID, sealed deterministic check whose failure prevents Verified Delivery and whose exact expected cardinality belongs to the Verification Catalog. Every Hard Check maps to one or more disclosed Delivery Requirements or to an explicitly disclosed build, regression, or change-boundary category; its implementation details may be withheld, but its obligation may not be hidden.
_Avoid_: Diagnostic Check, Judge checklist item, verifier summary Boolean, hidden obligation

**Withheld Verification Check**:
A non-public test implementation, input, or assertion detail that verifies one or more disclosed Delivery Requirements without adding an obligation or expanding their reasonable interpretation. Every such Check has a sealed mapping to public Requirement IDs; a Check without that mapping makes the Qualification Case inadmissible.
_Avoid_: hidden requirement, reference implementation, secret scoring dimension, Judge rubric item

**Diagnostic Check**:
A stable-ID, non-gating observation that helps explain engineering behavior without participating in Verified Delivery or Overall qualification. It remains explicitly separate from every Delivery Requirement and cannot compensate for or create a Hard Outcome.
_Avoid_: non-critical requirement, bonus point, weighted score, hidden Hard Gate

**Final Response Evidence**:
The Lead's final user-facing response together with separately authoritative facts about delivered files, executed tests, verification outcomes, and remaining failures. It supplies comparison material but never declares whether the free-text response is accurate, complete, or honest; that verdict belongs only to Semantic Engineering Review.
_Avoid_: deterministic honesty score, Agent completion proof, Delivery Requirement result, Hard Outcome

**Qualification Case Seal**:
The immutable content identity established only after a Qualification Case's clean starting workspace, expected initial failure, reference success, deterministic verifier, user request, budgets, and change boundaries have all been validated. Any later correction creates a new case version and invalidates affected results rather than rewriting the sealed case in place.
_Avoid_: case name, fixture-only hash, mutable hidden test, repaired result history

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
The result that all execution responsibilities and Runtime processes belonging to an Autonomous Qualification Trial settle within its fixed time, AgentRun, and A2A budgets, with no unfinished Run, Input, approval, or unsettled external effect. A failed or cancelled Run may still be mechanically converged after every resulting responsibility settles; Post-Dispatch Human Intervention is a separate Hard Outcome fact.
_Avoid_: every Run succeeded, autonomy result, Human Intervention, correct code alone, Lead final message, unlimited delegation

**Collaboration Evidence Matrix**:
A non-composite diagnostic projection of one Autonomous Qualification Trial's actual participation, independent Member Call lifecycles, feedback integration evidence, overlapping work, loops, and budget use. It keeps unavailable or semantically ambiguous attribution explicit and never turns a later call to the source into required closure or changes Verified Delivery, Orchestration Convergence, or Overall qualification.
_Avoid_: formal Trial collaboration gate, collaboration score, leaderboard, Agent self-assessment, delivery verdict

**Member Call Lifecycle**:
The objective chain linking one accepted Member Call receipt to its durable Conversation Input, any recipient Run created from it, and the terminal failure or completion facts of that execution responsibility. A recipient Run's ordinary user-facing CampMessage is not a response edge and never wakes the original sender; any later Member Call begins a separate lifecycle.
_Avoid_: message count, semantic Handoff result, Task completion, inferred feedback absorption

**Member Call Settlement**:
The state `settled | unsettled | indeterminate` derived only from whether one accepted Member Call's Conversation Input and any recipient AgentRun reached terminal states under complete evidence coverage. Settlement does not imply usefulness, integration, a response, or a need for another Call.
_Avoid_: successful handoff, response closure, feedback absorption, useful delegation

**Exact Duplicate Call Acceptance**:
Two separately accepted Member Calls from the same source Run with different canonical identities but the same recipient, Task link, and canonical content digest. An idempotent replay is one acceptance and is never a duplicate; semantic similarity remains a Judge question.
_Avoid_: repeated route, idempotent replay, similar request, repeated reviewer use

**Forward Call Cycle**:
A Member Call whose target is already on its forward-call ancestor lineage. A call back to the original sender is therefore another forward edge and a cycle, not a privileged return path.
_Avoid_: repeated direction without ancestry, source Resume, multi-stage review

**Call Semantic Disposition**:
The Semantic Engineering Review finding that work or information associated with an independent Member Call was integrated, rejected, superseded, abandoned, or remains indeterminate. It is never inferred by Core from matching code, Task state, a later Call, or message timing and never changes Hard Outcome.
_Avoid_: Member Call Settlement, later Member Call, objective lifecycle state

**Call Necessity**:
The Semantic Engineering Review finding that, when an independent Member Call was accepted, its target needed the authored information to continue acting or decide and had a clear next action or was waiting for that necessary result. Acknowledgement, courtesy, non-blocking progress, and repeated-information Calls are unnecessary; incomplete evidence yields indeterminate rather than an objective Core fact.
_Avoid_: acceptance authorization, Member Call Settlement, response requirement, automatic content classifier

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
A replaceable external Runtime handle currently bound to a Conversation. It does not define the Conversation's identity or own Rovai-ai's portable context.
_Avoid_: Conversation, Session Chain

**Native Session Compatibility Key**:
Adapter-derived evidence describing the Session-level semantics under which a Native Session is known reusable across a Runtime change. Path, fingerprint, or version changes require renewed probing but are not incompatibility by themselves; unknown compatibility permits one fenced Resume attempt before the binding is replaced.
_Avoid_: executable fingerprint, version lock, unconditional Resume, Conversation identity

**Controlled Native Session Resume**:
The single fenced, pre-input attempt to load an existing Native Session when compatibility is unknown for the current Installation generation. It cannot deliver Run input, invoke tools, or advance the Context Read Marker; success installs a verifiable binding, while failure or ambiguity fences the attempt before a replacement Session is created.
_Avoid_: AgentRun retry, blind Resume, duplicate input delivery, Conversation replacement

**Native Session Bootstrap**:
The immutable model-facing context delivered once for one Native Binding generation, consisting of its Session Charter and Memory Entrypoint. Runtime transport may append it natively or place it before the first AgentRun input, but recovery always reuses the same frozen Bootstrap evidence.
_Avoid_: AgentRun context, mutable Session profile, repeated prompt preamble

**Session Charter**:
The stable Core Contract frozen into a Native Session Bootstrap. It defines context authority and collaboration rules without containing editable Member identity, current Tasks, members, messages, Runtime state, Memory entries, Skills, tools or permissions.
_Avoid_: System Prompt replacement, Member Identity Context, dynamic Run context, security enforcement

**AgentRun Dynamic Context**:
The immutable model-facing payload for exactly one AgentRun, composed from required Member Identity Context and Current Input plus conditional Collaboration State, Shared Conversation and Run Notices. It contains no independently synthesized objective, responsibility, deliverable or Task snapshot.
_Avoid_: Native Session Bootstrap, mutable live prompt, Work Brief, Task Context

**ContextManifest**:
The immutable Core evidence that freezes one AgentRun's dynamic input boundaries, selected source references, Bootstrap evidence reference, formatter version, exact rendered payload and delivery target. Recovery reuses it byte-for-byte rather than assembling semantically similar input from newer state.
_Avoid_: prompt template, live context query, proof the model understood input

**Collaboration State**:
A bounded model-facing read state of Peer Member Identity Projections, emitted for a new Native Session or a material structured change. It informs coordination but never replaces live execution admission or exposes another Member's Personality Traits, Working Principles, Growth Topic, tools, permissions or Runtime internals.
_Avoid_: routing authority, Capability list, raw presence/readiness state, current task

**Shared Conversation**:
The bounded model-facing representation of public Camp history not already covered for the current Native Session, combining explicitly ranged summary bodies, ordered new messages and necessary retrieval guidance. Each message retains its source authority, summaries never outrank their sources, and Current Input is excluded to prevent duplication.
_Avoid_: Context Briefing, Task state, private Conversation, Execution Evidence, current trigger

**Run Notice**:
A fixed-template model-facing statement of an exceptional Run fact already determined by authoritative Core state and directly relevant to the current action. It never exposes counters, internal IDs, mutable guesses or raw Runtime errors, and is omitted when no closed notice applies.
_Avoid_: Control Signal, Work Brief, warning inferred from natural language, execution policy

**Current Input**:
The complete user or Member Call content that triggered one AgentRun, with trusted source type and stable Camp Attachment Paths when applicable. Member Call source metadata contains only the Core-derived `senderMemberId` and `senderName`; internal Run, Task, Inbox, lineage, and correlation IDs remain outside model input.
_Avoid_: Shared Conversation duplicate, Work Brief, model-generated source metadata, source reply alias

**Context Read Marker**:
The per-Native-Binding monotonic upper bound of public Camp message sequence covered for the current Native Session — by accepted verbatim input, by an accepted summary body, by being that Session's own current-generation output, or by lying behind a declared Coverage Baseline. Advancement proves delivery acceptance only — not that the model read or understood the content — and is independent of any retrieval-tool reads the Agent performs.
_Avoid_: proof of reading, retrieval position

**Coverage Baseline**:
The sequence position an accepted AgentRun Dynamic Context may declare, behind which older public Camp history is not injected verbatim but is explicitly represented as retrievable in Shared Conversation. History behind the baseline counts as covered for the Context Read Marker while remaining reachable only through boundary-capped retrieval.
_Avoid_: silent history skip, summary substitute, third summary level

**Segment Summary**:
A Camp-owned, immutable, shared summary covering one contiguous range of public Camp messages, generated only from untombstoned CampMessage bodies and attachment metadata, and reused by every CampMember. Content unfit for summarization must never enter CampMessage in the first place.
_Avoid_: per-Conversation summary, bootstrap summary, unread summary, private context

**Epoch Summary**:
A Camp-owned second-level summary covering one contiguous run of Segment Summaries. The summary hierarchy stops at two levels; older Epochs are loaded on demand through search rather than compressed further.
_Avoid_: third-level summary, rolling global summary, whole-Camp digest

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
The single Rovai-ai-managed AdapterInstallation that resolves ordinary Product Runtime Selections for one Product Runtime and authentication scope. Discovery priority, upgrades, and verified relocation update its launch evidence in place; advanced custom launch entries remain separate unless explicitly promoted.
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
A Member's durable choice of one Product Runtime, resolved by Rovai-ai through an internally managed AdapterInstallation before execution. The choice may remain unresolved while no verified Installation or capability snapshot exists, which blocks execution without falling back to another Runtime. Later resolution does not silently materialize model or permission parameters: the Member remains in need of attention until a complete Member Runtime Configuration is explicitly saved. Ordinary Member configuration never exposes executable paths, discovery provenance, fingerprints, or Installation identity.
_Avoid_: executable-path selection, AdapterInstallation selection, automatic execution

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
The product-facing name `Agent 运行时` for a Member's Product Runtime Selection and for the application settings/catalog surface. The Member editor section is `运行配置`; its selector, ordinary status, empty states, Toasts, and user guidance use `Agent 运行时`. Product Runtime, Runtime, Adapter, and AdapterInstallation remain domain or protocol vocabulary, while specific products such as Codex CLI keep their names.
_Avoid_: 执行引擎, displaying Adapter Installation, bare Runtime, or English `Ready` as generic end-user labels

**Runtime User Status**:
The single actionable status shown for one Product Runtime or Member Runtime configuration: `正在检查…`, `可用`, `需要登录`, `未安装`, `版本不支持`, `不可用`, or `暂时无法确认`; no selection is `未配置 Agent 运行时`. It may include a secondary reason or repair link, but never exposes `found_uninspected`, “已找到”, “尚未检查”, or “已检查”. A still-usable cached success remains `可用` while Core refreshes it in the background.
_Avoid_: Runtime Discovery status, Probe Attempt status, Snapshot lifecycle label, stacked primary statuses

**Runtime Readiness Projection**:
The advisory AgentProfile read state derived from its Product Runtime Selection, saved model and Adapter Permission Configuration, and the latest successful Adapter Capability Snapshot of the resolved AdapterInstallation. A saved fixed model, model option, or permission value that the latest snapshot no longer supports makes the Member unavailable and blocks new AgentRuns; Core never silently rewrites it to a new Runtime default, while already frozen AgentRuns remain unchanged. Member configuration pages read cached evidence immediately and only signal Core to ensure or refresh it in the background. Opening the page, switching the local draft, saving, ordinary member lists, Quick Chat rendering, Camp opening, and message admission perform no deep probe, executable content read, or fingerprint calculation. The actual Runtime launch boundary compares persisted file identity and performs a full fingerprint only after change or missing evidence; a failure blocks execution, schedules background repair, and preserves the user message.
_Avoid_: authoritative execution admission, synchronous deep probing or executable hashing during page reads and saves, UI-derived launch safety

**Adapter Permission Configuration**:
The Adapter-specific Runtime permission settings selected for an AgentProfile, using the upstream agent's own concepts and values from a verified capability schema. An unresolved selection has no permission configuration. When the user explicitly saves a ready Member Runtime Configuration, Core may materialize the Adapter's explicitly defined least-restrictive member defaults after validating them against the latest capability snapshot; background resolution and capability refresh never materialize or rewrite those values. The configuration remains distinct from Rovai-ai business Capabilities.
_Avoid_: Rovai-ai permission level, Capability, arbitrary CLI arguments, enum-order defaults, background permission expansion

**Runtime Default Model Selection**:
A Member model policy that follows the Product Runtime's current default model together with that model's default options. It persists neither a model identifier nor model options; selecting and configuring model-specific options requires an Explicit Model Selection.
_Avoid_: current default model snapshot, implicit fixed model, Runtime default model with overridden options

**Explicit Model Selection**:
A Member model policy that persists one model identifier and only the model-specific options reported for that model by the current Adapter Capability Snapshot.
_Avoid_: arbitrary model string, Runtime Default Model Selection with overrides, cross-Runtime model options

**Member Runtime Configuration**:
The atomically saved Product Runtime Selection, model policy, and Adapter Permission Configuration for one AgentProfile. Changing the Runtime in an editor replaces only the draft until one version-checked save validates and replaces the whole persisted configuration. A Product Runtime Selection may be saved alone only while its managed Installation or capability snapshot is unresolved; becoming resolved does not complete the configuration without a later explicit save.
_Avoid_: independent Runtime and parameter saves after resolution, cross-Runtime parameter retention, live form state, silently materialized configuration

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

**AgentRun Execution Evidence**:
A durable, append-only, user-visible record of provider-reported reasoning summaries, Agent progress narration, plans, steps, and structured tool/command/file lifecycle for exactly one AgentRun. It is authoritative SQLite state readable through the Camp Read Side until Camp deletion, while remaining absent by construction from CampMessage, ConversationMessage, FTS, summaries, ContextManifest payloads, later AgentRun input, A2A context, and Memory sources. It contains only normalized Runtime-public information, never hidden raw reasoning or invented progress.
_Avoid_: chain of thought, Camp message, Renderer-only live cache, searchable Agent context, raw provider packet, Task completion evidence

**Execution Evidence Content**:
The bounded normalized text or structured payload of one AgentRun Execution Evidence record. SQLite stores an explicit preview, byte count, content digest and truncation flag; larger content uses an authorized Managed Blob reference whose lifetime is rooted by the Evidence record.
_Avoid_: silent truncation, local Blob path, raw protocol log, Markdown execution of tool output

**CampTurn Stop**:
The user-requested, idempotent cancellation of an active CampTurn's complete collaboration execution scope, including AgentRuns and unmaterialized Conversation Input Queue entries. Core atomically fences the Turn, cancels pending inputs, closes new message/evidence/Team Tool/descendant writes, and attempts native Runtime interruption before marking execution cancelled; InboxMessages and Audit facts remain durable, while cancelling a member Run never creates a message to another member.
_Avoid_: stop current UI row only, external transaction rollback, Task cancellation, process signal without fencing

**Unsettled External Effect**:
A Runtime delivery, Action, command, tool, file, or network effect whose occurrence or outcome remains unknown after its AgentRun has been fenced and cancelled. It remains an independently recoverable authoritative record and produces the user-facing warning “已停止 · 结果待确认” without blocking Composer reuse or automatically retrying the effect.
_Avoid_: running AgentRun, proof of non-execution, forced failure, automatic retry, cancellation blocker

**Structured Timeline Event**:
An immutable Camp system message presentation for a Task state change, carrying closed event-time display fields plus a safe textual fallback. It is ordered by authoritative CampMessage sequence and can navigate to the current Task Inspector without rewriting its historical title, status, assignee, or time.
_Avoid_: A2A message, mutable current-state card, parsed English system body, Execution Evidence, synthetic message ordering

**A2A Conversation Message**:
The user-visible projection of one successfully delivered InboxMessage in the Camp conversation, rendered as the actual sender followed by `→ @recipient` and the authored body. It remains private A2A authority rather than CampMessage, so it does not enter public FTS, summaries, Shared Conversation, or unrelated Agent context. Delivery and target execution states remain Activity/Audit facts and are never synthesized as “delivered”, “executing”, or “returned” conversation messages.
_Avoid_: system message, lifecycle status card, copied CampMessage, public Agent context, synthetic result receipt

**Conversation Input**:
The durable per-Conversation execution unit accepted before its consuming AgentRun exists, with lifecycle `pending`, `materialized`, `failed`, or `cancelled`. Every Member Call atomically creates its authored InboxMessage and one Conversation Input; the frozen execution basis and recipient-local sequence make later single-slot materialization crash-safe without a type discriminator, response obligation, or Core-authored follow-up input.
_Avoid_: queued AgentRun, InboxMessage state, best-effort notification, unread message, delayed admission, implicit retry, model prompt payload

**Conversation Input Queue**:
The durable per-Conversation FIFO of pending Member Call Conversation Inputs, ordered by a Core-assigned recipient-local sequence rather than timestamps. A Conversation is busy while it has a `queued`, `running`, or `waiting` AgentRun; only when idle may Core atomically claim and materialize the queue head into exactly one new AgentRun, without skipping or batching entries.
_Avoid_: Inbox, priority queue, queued AgentRun, reply batch, timer window

**Conversation Input Reconciliation**:
The event-accelerated, SQLite-authoritative scheduler path that materializes eligible Conversation Inputs without depending on an in-memory wake-up. Member Call acceptance, Run terminalization, and capacity release request immediate reconciliation, while Core startup and a bounded periodic sweep recover missed hints; an atomic queue-head claim prevents duplicate AgentRuns.
_Avoid_: callback-only wake-up, in-memory queue authority, best-effort resume, non-atomic claim, duplicate materialization

**Member Call**:
The authenticated A2A execution request made through `team.call_member` to exactly one eligible CampMember, with model-controlled `recipient`, `content`, and optional `taskId`. Each accepted call is an independent forward execution edge that creates one authored InboxMessage and one Conversation Input; it carries no response requirement, special return edge, or Core-authored fallback message.
_Avoid_: post message, send message, passive notification, reply edge, response obligation, polling wait, automatic completion, telephone call

**A2A Run Slot Reservation**:
The acceptance-time accounting unit that preserves the per-CampTurn maximum of sixteen A2A Resume Runs even while execution inputs remain pending. Every accepted Member Call allocates exactly one slot for its recipient Run, including a later call back to an earlier member; allocated slots are never recycled within the Turn.
_Avoid_: post-Run counting, response reservation, unbounded pending queue, reusable concurrency permit, Runtime worker slot

**A2A Resume Run**:
A new AgentRun for any CampMember inside the same still-active CampTurn, created when that Member's Conversation is idle to consume exactly one Conversation Input after an earlier Run has ended. Every Member Call enters one logical A2A depth deeper, including a call back to an earlier member; there is no special return path, reply batching, new CampTurn, or Runtime retry.
_Avoid_: Lead Turn, new CampTurn, reopened CampTurn, Runtime resume, Lead-only continuation, reply batch

**CampTurn Collaboration Settlement**:
The authoritative aggregation that keeps a CampTurn non-terminal while any Conversation Input is pending or any AgentRun is `queued`, `running`, or `waiting`. Once those accepted execution responsibilities settle, Core determines the terminal result without requiring the original caller or Default Lead to run again; missing integration may be a semantic-review finding but never a response obligation or settlement blocker.
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
The authoritative ordered content of one user-authored Camp Composer Draft and its accepted CampMessage, using only `Text`, `MemberMention(agentProfileId)`, and `AllMembersMention` segments. Plain-text display and recipient projections derive from it; a legacy message remains one Text segment while its existing recipient identities remain separate historical facts.
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
The immutable absolute, existing startup and recovery working directory of one AgentRun. It carries no filesystem authority and is not a model-controlled Team Tool field. An A2A target Run receives the source Run Workspace path by deterministic Core rule, while the recipient continues to use its own Adapter Permission Configuration. A sender may instead describe another filesystem path in ordinary message or Task content; the recipient interprets that instruction and accesses or switches to the path through its own Runtime without changing the frozen Run Workspace.
_Avoid_: permission boundary, sandbox root, inherited sender permission, project ownership

**A2A Parent Run**:
The authenticated source AgentRun from which Core accepts an A2A Conversation Input and later creates its consuming AgentRun. Core derives and freezes the parent, root, and depth identities from the current Runtime binding; no LLM input may supply or override them.
_Avoid_: Team Tool argument, model-generated Run ID, Task ownership, permission inheritance

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
A Core-enforced business authorization atom that allows an Agent to request a class of Rovai-ai domain mutation. It is distinct from an exposed Team Tool, the scope of records visible to that Agent, and Adapter filesystem/Shell/network permissions.
_Avoid_: Tool, visibility scope, Adapter permission, universal administrator role

**Skill**:
A reusable directory package of instructions and optional supporting resources that an Agent Runtime can discover and load when relevant.
_Avoid_: System Prompt, Team Tool, MCP Server, AgentProfile

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
Rovai-ai's application-global collection of user-visible external MCP Server definitions. It is an independent source of truth and does not include Rovai-ai's internal Team MCP gateway.
_Avoid_: Runtime personal MCP configuration, remote marketplace, Team MCP

**MCP Import**:
A user-confirmed, one-time copy of portable MCP Server definitions from known local Agent configuration sources into the MCP Library. It does not establish ongoing synchronization, mutate the source configuration, or copy credentials and OAuth tokens.
_Avoid_: MCP sync, configuration mirroring, credential migration

**MCP Import Candidate**:
A read-only, transient discovery result from a known Runtime user-level configuration. It is not an MCP Server Definition until the user confirms import.
_Avoid_: Imported Server, synchronized record, project configuration

**MCP Server Definition**:
A stable external MCP Server configuration in the MCP Library, represented by Rovai-ai's typed Stdio or Streamable HTTP model and translated by each AgentRuntimeAdapter into Runtime-native configuration.
_Avoid_: Raw Cursor JSON, Runtime-specific configuration blob, running MCP process, legacy SSE definition

**MCP Configuration File**:
The application-global MCP configuration file that is the sole source of truth for external MCP Server definitions, enablement, and Member assignments. New installations use `~/.rovai/mcp.json`; an existing `~/.horizonward/mcp.json` or `~/.lumen/mcp.json` remains authoritative only when every newer preferred path is absent. The files are never merged or dual-written. The MCP settings page is the graphical editor for the selected path.
_Avoid_: MCP database table, generated Runtime projection, synchronized source config

**MCP Assignment**:
The explicit relationship that makes one enabled MCP Server Definition eligible for an AgentProfile's future Runtime projection. Availability is application-global but authority is per Member; it is not inferred from Camp membership. Presence changes do not delete the Assignment, while away and removed Profiles cannot produce a new MCP Exposure Snapshot.
_Avoid_: Camp MCP scope, Project MCP scope, automatic all-Agent exposure

**MCP Exposure Snapshot**:
The immutable set of enabled, assigned, Adapter-compatible external MCP Server definitions resolved for one AgentRun. Changes affect later AgentRuns without changing the Conversation or Native Session identity.
_Avoid_: Native Session configuration identity, live mutable tool list, MCP Assignment

**MCP Runtime Projection**:
An ephemeral, Adapter-native configuration generated from one MCP Exposure Snapshot and injected when Rovai-ai launches or resumes an Agent CLI. It contains only the selected external Servers plus the fixed Team MCP.
_Avoid_: Runtime personal MCP config, MCP source of truth, central MCP proxy

**Built-in MCP Tool Parity**:
A Runtime attachment state in which an active AgentRun can discover and invoke the same canonical Team, Context Retrieval, and Memory operations as exact-injection Runtimes, using Adapter-safe visible names while retaining identical schemas, receipts, live authorization, Capability, quota, and fencing semantics. It does not grant equal business authority to every Member or imply equal external and ambient MCP isolation.
_Avoid_: identical native tool spelling, universal Capability grant, external MCP parity, ambient MCP isolation
