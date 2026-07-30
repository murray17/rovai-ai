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
A transient user preparation for Camp creation. It has no durable collaboration identity and is neither a Camp nor a domain Conversation. The user may optionally configure its Camp name; an omitted name becomes `未命名对话`. The `创建` action submits this configuration to Core; an accepted creation establishes the durable Camp before any public message exists, consumes the Draft, and enters the new Camp workspace with its message composer focused. There is no intermediate post-creation Draft page. Failed creation retains the Draft and its configuration for correction. Renderer snapshots are advisory: Core revalidates the exact Initial Camp Membership, Default Lead, supported Camp Collaboration Mode, and optional selected Workspace Directory at creation admission. A stale member or unsafe directory rejects creation atomically for user reconfirmation; Core never silently rewrites membership, changes the Lead, initializes Git, or falls back to the Lobby.
_Avoid_: Draft Camp, Conversation, first-message creation

**Camp Creation**:
The user-only, idempotent Core action that atomically turns a valid New Conversation Draft into one Camp row and its selected CampMember relationships, including Camp name and origin, Camp Workspace Binding, Camp Collaboration Mode, and Default Lead. It validates collaboration structure but performs no Runtime Resolution or execution Readiness admission, so a Camp may be created when none of its members can currently execute. The disabled `lead_coordinated` option is rejected by Core as unsupported rather than guarded only by Renderer state. Camp Creation creates no Conversation, CampMessage, CampTurn, AgentRun, Native Session, or Native Session Bootstrap; those records begin only when later behavior requires them.
_Avoid_: first-message creation, Renderer-only state transition, eager Conversation allocation

**Project**:
A product-facing read-time group of `directory` Camps whose canonical `projectPath` strings are equal. It has no independent identity, repository identity, table, or lifetime apart from those Camps. Its stable read key is `directory:<canonical-project-path>`; Git metadata never affects grouping.
_Avoid_: Project entity, Project aggregate, standalone project record

**Camp Workspace Binding**:
The durable `projectBindingKind: lobby | directory` and canonical absolute `projectPath` carried by every Camp. `lobby` uses Rovai-ai's managed lobby directory and remains Lobby even if Git metadata appears there. `directory` uses the exact safe directory explicitly selected by the user. The directory is the persistent workspace identity; no Repository Binding or Repository Scope is stored.
_Avoid_: Repository Binding, Repository Scope, Project foreign key, Git identity

**New Conversation Workspace Selection**:
The optional, transient selection of one safe local directory in a New Conversation Draft. The selector offers the managed Lobby, shortcuts for known canonical Project paths, and `选择工作目录…`. Selecting or browsing has no durable effect until Camp Creation succeeds; cancelling creates no record. Ordinary directories, empty directories, empty Git repositories, normal repositories, and Git worktrees are valid. Core canonicalizes and revalidates the exact directory; it never runs `git init`.
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
An optional durable responsibility item inside one Camp, used when work must remain visible across messages, AgentRuns, or member coordination. `completed` records an authorized actor's declaration of completion, not verification by Rovai-ai Core. Tasks do not form a dependency DAG or a Core-enforced workflow. An A2A target Run does not inherit its source Run's optional Task association; ordinary message content and explicit references carry collaboration context without transferring responsibility. A Task may describe a filesystem path as ordinary semantic content, but it does not own or structurally transfer an AgentRun working directory.
_Avoid_: Camp, Conversation, chat thread, internal plan, one-off A2A request, workflow node

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
The stable Core Contract and Companion Profile frozen into a Native Session Bootstrap. It defines identity, context authority and collaboration rules without containing current Tasks, members, messages, Runtime state, Memory entries, Skills, tools or permissions.
_Avoid_: System Prompt replacement, dynamic Run context, security enforcement, Agent instructions update

**AgentRun Dynamic Context**:
The immutable model-facing payload for exactly one AgentRun, composed from conditional Collaboration State, Shared Conversation and Run Notices plus required Current Input. It contains no independently synthesized objective, responsibility, deliverable or Task snapshot.
_Avoid_: Native Session Bootstrap, mutable live prompt, Work Brief, Task Context

**ContextManifest**:
The immutable Core evidence that freezes one AgentRun's dynamic input boundaries, selected source references, Bootstrap evidence reference, formatter version, exact rendered payload and delivery target. Recovery reuses it byte-for-byte rather than assembling semantically similar input from newer state.
_Avoid_: prompt template, live context query, proof the model understood input

**Collaboration State**:
A bounded model-facing read state of Camp members, roles and advisory availability, emitted for a new Native Session or a material structured change. It informs coordination but never replaces live execution admission or exposes another Agent's tools, permissions or Runtime internals.
_Avoid_: routing authority, Capability list, raw presence/readiness state, current task

**Shared Conversation**:
The bounded model-facing representation of public Camp history not already covered for the current Native Session, combining explicitly ranged summary bodies, ordered new messages and necessary retrieval guidance. Each message retains its source authority, summaries never outrank their sources, and Current Input is excluded to prevent duplication.
_Avoid_: Context Briefing, Task state, private Conversation, Execution Evidence, current trigger

**Run Notice**:
A fixed-template model-facing statement of an exceptional Run fact already determined by authoritative Core state and directly relevant to the current action. It never exposes counters, internal IDs, mutable guesses or raw Runtime errors, and is omitted when no closed notice applies.
_Avoid_: Control Signal, Work Brief, warning inferred from natural language, execution policy

**Current Input**:
The complete user or A2A content that triggered one AgentRun, with trusted source type and authorized Run Attachment Projection paths when applicable. A2A source metadata may provide the `source` reply alias, while internal Run, Task, Inbox, lineage and correlation IDs remain outside model input.
_Avoid_: Shared Conversation duplicate, Work Brief, model-generated source metadata

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
The latest successful persisted deep-probe evidence for one AdapterInstallation, covering its observed executable identity, authentication, models, permissions, protocols, and capabilities. It informs configuration and Runtime Readiness but remains advisory until execution admission independently verifies the launch target.
_Avoid_: Runtime Discovery Observation, permanent compatibility claim, execution admission

**Adapter Probe Attempt**:
One bounded deep inspection of an AdapterInstallation whose outcome may replace its successful Adapter Capability Snapshot or record a failed attempt and retry schedule without erasing that snapshot. Retaining prior evidence does not make it usable after the Installation becomes stale.
_Avoid_: Adapter Capability Snapshot, Runtime Discovery Observation, readiness proof

**Adapter Capability Snapshot Freshness**:
The distinction between a time-aged snapshot that is due for background refresh but remains usable while its launch identity still matches, and a stale snapshot whose launch target, configuration, or confirmed admission evidence no longer matches and blocks new AgentRuns.
_Avoid_: treating age alone as staleness, permanent Ready, refresh due as a Run blocker

**Product Runtime Selection**:
A Member's durable choice of one Product Runtime, resolved by Rovai-ai through an internally managed AdapterInstallation before execution. The choice may remain unresolved while no verified Installation exists, which blocks execution without falling back to another Runtime; ordinary Member configuration never exposes executable paths, discovery provenance, fingerprints, or Installation identity.
_Avoid_: executable-path selection, AdapterInstallation selection, automatic execution

**Product Runtime Availability**:
The application-level read state formed from Product Runtime Catalog membership, the latest Runtime Discovery Observation, and any Managed Default Installation, probe attempt, and capability snapshot. It describes product availability independently of any Member's selection or Runtime Readiness Projection.
_Avoid_: Member readiness, persisted display label, execution admission

**Runtime Resolution Job**:
Deduplicated pre-admission work that resolves an explicit Product Runtime Selection or execution intent through discovery, verified Installation creation or relocation, and deep probing. It owns no Run input and creates no CampMessage, CampTurn, or AgentRun; only success allows the original request to proceed with a newly frozen Run Runtime Configuration.
_Avoid_: AgentRun, health check, Runtime fallback, mutable Run configuration

**Pending Execution Intent**:
A durable, user-submitted execution request waiting for a Runtime Resolution Job before normal admission. It survives Core restart and remains explicitly cancellable, but creates no CampMessage, CampTurn, AgentRun, or external Runtime input until resolution succeeds.
_Avoid_: Renderer draft, CampMessage, queued AgentRun, automatic background execution

**Execution Engine (product term)**:
The product-facing name for a Member's Product Runtime Selection. The Member settings section is titled `Agent运行时`; its selectable engine field, ordinary status, empty states, Toasts, and user guidance say `执行引擎`. Runtime, Adapter, and AdapterInstallation remain implementation and protocol vocabulary, and specific products such as Codex CLI keep their names.
_Avoid_: displaying Adapter Installation, Agent Runtime, bare Runtime, or English `Ready` as generic end-user labels

**Runtime Readiness Projection**:
The advisory AgentProfile read state derived from its Product Runtime Selection and the latest successful Adapter Capability Snapshot of the resolved AdapterInstallation. Ordinary member lists, lobby rendering, and Camp opening perform no executable content read or fingerprint calculation; startup discovery and conditional background refresh run outside the interactive Core request queue, while execution admission independently verifies the current executable identity and rejects stale evidence.
_Avoid_: authoritative execution admission, startup-wide deep probing, synchronous executable hashing during profile or Camp reads, UI-derived launch safety

**Adapter Permission Configuration**:
The Adapter-specific Runtime permission settings selected for an AgentProfile, using the upstream agent's own concepts and values from a verified capability schema. An unresolved selection has no permission configuration; resolution may materialize only Rovai-reviewed safe defaults, never inferred dangerous values, and the configuration remains distinct from Rovai-ai business Capabilities.
_Avoid_: Rovai-ai permission level, Capability, arbitrary CLI arguments, fabricated defaults

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
A native Runtime request asking the user to authorize a specific operation or resource scope. Rovai-ai presents and records the request and returns the user's selected native decision to the same fenced Runtime binding.
_Avoid_: Core policy decision, Workspace upgrade, silent permission grant

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
The user-requested, idempotent cancellation of an active CampTurn's complete AgentRun tree, including A2A descendants. Core fences every affected Run, closes new message/evidence/Team Tool/descendant writes, and attempts native Runtime interruption before marking execution cancelled; it does not roll back Task state or external effects.
_Avoid_: stop current UI row only, external transaction rollback, Task cancellation, process signal without fencing

**Unsettled External Effect**:
A Runtime delivery, Action, command, tool, file, or network effect whose occurrence or outcome remains unknown after its AgentRun has been fenced and cancelled. It remains an independently recoverable authoritative record and produces the user-facing warning “已停止 · 结果待确认” without blocking Composer reuse or automatically retrying the effect.
_Avoid_: running AgentRun, proof of non-execution, forced failure, automatic retry, cancellation blocker

**Structured Timeline Event**:
An immutable Camp system message presentation for a Task state change or A2A request/result boundary, carrying closed event-time display fields plus a safe textual fallback. It is ordered by authoritative CampMessage sequence; a Task event can navigate to the current Task Inspector without rewriting its historical title, status, assignee, or time.
_Avoid_: mutable current-state card, parsed English system body, Execution Evidence, private A2A body, synthetic message ordering

**A2A Source Alias**:
The trusted model-facing `source` recipient available only when Current Input came from an A2A request. Core resolves it from the current Run's authenticated source correlation, allowing an explicit reply without exposing sender IDs, Inbox IDs or Run lineage.
_Avoid_: Turn Envelope, model-supplied sender identity, automatic reply, third-party alias

**A2A Reply Correlation**:
The trusted Core-side linkage from an A2A target AgentRun back to its source InboxMessage. When that Run explicitly sends to the A2A Source Alias and omits a reply ID, Core may atomically infer this linkage; it never exposes the correlation ID to the model, auto-sends a final response, auto-wakes the source Agent, or merges Runs.
_Avoid_: automatic reply, automatic wake, model-visible Inbox ID, third-party inferred linkage, Run merging

**Application-Managed File Safety**:
The path, symlink, ownership, permission, size, and atomic-write protections applied when Rovai-ai manages its own blobs, projections, private configurations, sockets, logs, or temporary files. It is independent of Runtime-Managed Permission and remains Core-enforced.
_Avoid_: Agent filesystem permission, Run Workspace boundary, Runtime sandbox

**Run Attachment Projection**:
A reconstructible, read-only, application-managed file view of one authorized message attachment at a stable path available to one frozen AgentRun. Managed Blob remains the content truth; the model sees only the projection path, while recovery preserves its digest and never exposes the original storage or host path.
_Avoid_: attachment source of truth, managed-blob URI, original local path, inline attachment body

**Run Workspace**:
The immutable absolute, existing startup and recovery working directory of one AgentRun. It carries no filesystem authority and is not a model-controlled Team Tool field. An A2A target Run receives the source Run Workspace path by deterministic Core rule, while the recipient continues to use its own Adapter Permission Configuration. A sender may instead describe another filesystem path in ordinary message or Task content; the recipient interprets that instruction and accesses or switches to the path through its own Runtime without changing the frozen Run Workspace.
_Avoid_: permission boundary, sandbox root, inherited sender permission, project ownership

**A2A Parent Run**:
The authenticated source AgentRun from which Core creates one A2A target AgentRun. Core derives and freezes the parent, root, and depth identities from the current Runtime binding; no LLM input may supply or override them.
_Avoid_: Team Tool argument, model-generated Run ID, Task ownership, permission inheritance

**A2A Context Transfer**:
The bounded collaboration handoff in which the sending LLM supplies only the necessary message body and explicit references. Core deterministically assembles the target AgentRun input from that handoff, the recipient's own Conversation continuity, authorized Camp context, and frozen context boundaries; it never copies the sender's complete prompt, private Conversation, or hidden reasoning.
_Avoid_: serialized sender prompt, LLM-generated context blob, private Conversation inheritance, Task ownership transfer

**Execution Admission**:
The authoritative per-submission Core check that resolves exact Camp targets and validates Member Presence, Runtime configuration and Readiness, Run Workspace launchability, Rovai-ai business Capabilities, serialization, and execution fencing before any target Conversation, CampMessage, CampTurn, or AgentRun is persisted. Camp Creation is a separate collaboration-structure admission and never depends on execution Readiness. Every execution target must pass; rejection leaves the existing Camp intact but creates none of the submission's business records and never changes its recipient. The first accepted user submission also changes a `default` Camp Name Origin to `generated` in the same transaction.
_Avoid_: Runtime permission policy, disabled Composer, Renderer readiness guess, partial delivery, automatic Lead fallback

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
