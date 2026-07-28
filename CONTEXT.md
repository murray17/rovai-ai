# Rovai-ai

Rovai-ai is a local multi-Agent workbench in which long-lived Agent identities collaborate inside Camps while retaining independent conversational continuity.

## Language

**Camp**:
A long-lived shared collaboration context containing participants, public discussion, private Agent continuities, resources, and outcomes. The product may present a Camp as a conversation, but domain code must not call it a Conversation. User deletion permanently removes the Camp aggregate; Rovai-ai does not model Camp archive or trash.
_Avoid_: Public Conversation, Task, Project, Archived Camp

**Project**:
A product-facing view of Camps that share the same local codebase binding. It has no independent identity or lifetime apart from those Camps.
_Avoid_: Project entity, Project aggregate, standalone project record

**Project Binding**:
An optional stable local codebase identity carried by a Camp. Camps sharing its Repository Scope appear under one Project, while paths describe current locations rather than identity; a Camp without a binding appears in the Lobby.
_Avoid_: Project foreign key, Workspace entity

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
The normalized Memory-domain table family inside Rovai-ai's existing authoritative SQLite database: Memory, immutable Revision, Proposal, Supersession, and projection observation. It reuses Core commands/events and is neither one JSON aggregate nor an event-replayed or file-backed database.
_Avoid_: memory.json, Markdown database, event-sourced Memory, FTS index, separate database

**Memory**:
One atomic durable recognition with a stable identity and one selected current MemoryRevision. It is independently governed and is not a paragraph position or a whole scope document.
_Avoid_: memory file, prompt fragment, conversation summary, mutable text row

**MemoryRevision**:
An immutable, user-authorized version of one Memory's content. A Memory selects one current Revision while older Revisions remain distinct audit history.
_Avoid_: in-place edit, proposal, Markdown version, whole-library snapshot

**Memory Revision Authority**:
The endorsement level of one MemoryRevision: `provisional` is immediately effective lower-priority guidance formed under an enabled user policy, while `user_confirmed` records explicit user endorsement and wins conflicts between otherwise applicable Memories.
_Avoid_: Memory Lifecycle, activation state, permission, capability

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
An irreversible user action that removes a Memory's readable content from the Memory Library and all future memory use while retaining only the minimum tombstone and command facts needed for safety. It does not erase the Memory's original source objects, completed AgentRun inputs, external Runtime history, or user-controlled backups.
_Avoid_: retire, reversible archive, global content erasure

**Memory Export Boundary**:
The user-initiated extraction of Memory data directly from authoritative SQLite state. v0.10 adds no Memory-specific automatic backup or cloud sync, and exported copies leave Rovai-ai's Forget control; format and selected history are implementation-protocol details.
_Avoid_: Projection backup, automatic replication, recoverable Forget, Rovai-ai-controlled external copy

**Memory Review**:
An advisory user-governance reminder scheduled by `reviewAfter`; becoming due does not change a Memory's active state or content. Review may lead the user to continue, reschedule, revise, retire, or forget through separate explicit commands.
_Avoid_: automatic expiry, validity window, lifecycle transition

**Memory Projection**:
A deterministic, read-only Markdown rendering of authoritative SQLite Memory state in Rovai-ai-private user data. It is disposable and rebuildable, and may be exposed by an exact file or directory path for a Runtime's native file tools to read on demand, but it is never a write source.
_Avoid_: Memory source of truth, editable memory file, project document, Git-tracked state

**Projection File Safety Limit**:
The 256 KiB maximum for one fully rendered Memory Projection Markdown file, including formatter-owned structure and entries. Each Relationship child file is checked independently; overflow prevents publication and emits diagnostics without changing SQLite.
_Avoid_: Scope body capacity, Relationship directory aggregate quota, truncation target, database limit

**Unavailable Memory Projection**:
A body-free Markdown sentinel atomically published when an exposed projection is known stale, corrupt, oversized or unrenderable. It tells the Agent not to rely on long-term memory at that path until reconciliation succeeds; known-stale last-good content is never an intentional fallback.
_Avoid_: stale projection cache, empty valid Memory set, partial rendering, SQLite rollback

**Projected Memory Entry**:
The minimal Agent-readable rendering of one active Memory: `memoryId`, current `revisionId`, Memory Kind, Relationship Direction when applicable, and body. Its containing file conveys Scope, and `revisionId` is the exact base for a revise proposal.
_Avoid_: full database row, audit record, Proposal provenance, mutable Markdown paragraph

**Memory Guide**:
A small AgentRun input section that explains long-term memory's lower authority and exposes exact authorized Memory Projection file or directory paths for optional native file-tool reads. It freezes the instructions and exposed roots, not a Relationship directory's child-file list or live contents, and does not prove that the Agent read them.
_Avoid_: injected memory body, immutable Memory snapshot, System Prompt, authority grant

**Preference Memory**:
A stable choice about how Rovai-ai or a Companion should communicate, present information, or work with the user. A provisional Preference is immediately applicable lower-priority guidance but remains unendorsed until optional user confirmation.
_Avoid_: inferred personality, temporary request, project fact

**Agreement Memory**:
A prospective collaboration rule for the members in its Memory Scope. A provisional Agreement is immediately applicable lower-priority guidance rather than a user-endorsed rule; optional user confirmation promotes it to the formal rule those members are expected to follow.
_Avoid_: prediction, current task instruction, hidden policy

**Lesson Memory**:
A reusable course of action distilled from a real experience, without turning that experience into a personality judgment or capability score.
_Avoid_: observation profile, performance rating, conversation summary

**Hearth Memory**:
A durable memory whose scope includes every AgentProfile in the local Rovai-ai home across Camps.
_Avoid_: Camp-wide memory, global prompt, shared chat history

**Companion Memory**:
A durable memory scoped to the user and one AgentProfile across that AgentProfile's Camps and Runtime changes.
_Avoid_: Conversation memory, Native Session memory, Agent observation profile

**Relationship Memory**:
A durable, user-governed memory for one unordered pair of AgentProfiles across Camps in which they collaborate. The user can manage the complete pair, while each Agent's supported read view contains only mutual content and directed content for which that Agent is the actor.
_Avoid_: Agent-shared archive, Camp membership, Agent ranking

**Relationship Projection Directory**:
A live, Camp-and-AgentProfile-specific read view of applicable Relationship Memories. For current Agent A, each other present Camp member B is represented only by active `mutual(A, B)` and `directed(A → B)` content; `directed(B → A)` is available only in the user's complete-pair management view. Memory Guide exposes the directory root instead of enumerating its child files.
_Avoid_: complete pair archive, per-Run snapshot, reverse-direction instruction

**Relationship Direction**:
The immutable Agent-facing applicability of one Relationship Memory: `mutual` enters both pair members' supported read views, while `directed` enters only the actor's view when collaborating with the counterparty. The user can always manage the complete pair.
_Avoid_: directional Relationship Scope, user-hidden note, mutable revision field

**MemoryProposal**:
A durable but non-authoritative `add` or `revise` suggestion from a current fenced AgentRun. Agent A may target Hearth, Companion(A), or Relationship(A, B) for another present Camp member B; a Relationship add may be `mutual` or `directed(A → B)`. Add input contains candidate Scope/Kind/body plus Relationship counterparty/direction; revise input contains `memoryId`, `baseRevisionId`, and complete replacement body. Gateway derives identity, actor, source, time, and idempotency.
_Avoid_: effective memory, cross-Agent proposal, cross-Camp relationship proposal, lifecycle request, automatic learning, user draft

**Automatic Memory Formation**:
The default-enabled, user-controllable policy path that turns at most one eligible Agent-authored Companion add or mutual/directed Relationship add MemoryProposal of any Kind legal in that Scope per AgentRun into an immediately effective provisional Memory; no later confirmation is required, and a directed Relationship always runs from the proposing Agent to its counterparty. Each Companion scope and each unordered Relationship pair may hold at most eight such active Memories; excess eligible proposals remain pending, disabling the policy only stops future formation without changing existing Memories, and Hearth proposals, revise proposals, and lifecycle operations always remain explicitly user-governed.
_Avoid_: automatic revision, automatic replacement, automatic learning, Agent-confirmed Memory

**Stale MemoryProposal**:
A pending revise Proposal whose `baseRevisionId` was current when the Proposal was saved but no longer matches the Memory's current Revision. Stale is a derived condition, not a Proposal status, and the Proposal cannot be accepted or rebased in place.
_Avoid_: stale status, disputed Memory, automatic rebase, immediately stale saved Proposal

**Memory Proposal Receipt**:
The idempotent result of `memory.propose_change`: it either identifies a pending Proposal with `effective: false` or the immediately effective provisional Memory formed from it with `effective: true`. It proves the persisted outcome but never claims explicit user confirmation.
_Avoid_: user-confirmation receipt, echoed candidate body, inferred authority

**Memory Confirmation**:
The optional user action that promotes the current provisional MemoryRevision to a user-confirmed Revision without serving as an activation step. It releases provisional capacity and records explicit endorsement while preserving the prior Revision as audit history.
_Avoid_: Proposal acceptance, required review, Memory activation, automatic confirmation

**Memory Proposal Confirmation**:
The per-Proposal user decision to accept the displayed final content, edit then accept, or reject. Acceptance is never batched; batch handling is rejection-only, session ignore has no domain effect, and stale Proposals cannot be accepted or edited into acceptance.
_Avoid_: bulk learning, Agent approval, ignored status, stale rebase

**Memory Proposal Capability**:
The `memory.propose_change` business Capability frozen into an AgentRun's effective configuration. It authorizes only saving bounded add/revise Proposals, is enabled in the default configuration of a new AgentProfile, may be revoked by profile or CampMember configuration for future Runs, and never authorizes acceptance. Presence and Runtime configuration do not rewrite the stored Capability; execution admission determines whether a future Run can exist.
_Avoid_: tool visibility, Memory write authority, user permission, automatic learning

**Memory Stewardship Skill**:
The single default-enabled Bundled Skill `memory-stewardship` (“共同记忆维护”) that teaches durable-memory judgment, applicable projection reads, atomic wording, duplicate and secret checks, and Proposal submission. It uses the existing Runtime-native SkillProjection and grants no Capability or fallback prompt injection.
_Avoid_: per-Scope Skill, Memory authority, mandatory System Prompt, unsupported-Runtime emulation

**Memory Proposal Run Quota**:
The hard limit of four successfully persisted MemoryProposals per source AgentRun across add and revise. Idempotent replays and failed calls do not consume another slot, while later Proposal acceptance or rejection does not restore one.
_Avoid_: token budget, pending-only count, rolling window, user management limit

**No-op Memory Proposal**:
An add candidate exactly equal to an active Memory's Scope/Kind/Direction/canonical body, or a revise candidate whose canonical body equals the target's current body. Gateway rejects it without persisting a Proposal or consuming Run quota; similarity is never inferred.
_Avoid_: semantic duplicate, pending duplicate Proposal, accepted no-change Revision, fuzzy match

**Duplicate Pending MemoryProposal**:
A candidate exactly equal to the earliest pending add Proposal's Scope/Kind/Direction/body or pending revise Proposal's target/base/body. Gateway preserves the earliest Proposal and rejects later duplicates without recording another proposer or consuming Run quota.
_Avoid_: semantic duplicate, merged proposer list, replacement Proposal, idempotent replay

**Pending Proposal Retention**:
The rule that a pending MemoryProposal has no automatic expiry and remains user-governed until explicit acceptance or rejection. Session-level ignore, elapsed time and a derived stale condition do not delete it or change its status.
_Avoid_: Proposal TTL, ignored status, automatic rejection, stale cleanup

**Terminal Proposal Retention**:
The asymmetric terminal-body rule for MemoryProposal: accepted keeps its original candidate for audit until the linked Memory is forgotten, while rejection clears candidate text in the rejecting transaction. Both retain non-body proposer/source metadata and terminal status without time-based expiry.
_Avoid_: terminal Proposal TTL, retained rejected body, Acceptance object, Proposal metadata deletion

**Unavailable Proposal Source**:
A derived management condition where a MemoryProposal's weak source Camp/AgentRun reference can no longer be resolved or read. The frozen IDs and Proposal remain, navigation is disabled, and user acceptance/rejection stays valid without copying or restoring source content.
_Avoid_: Proposal invalidation, cascade deletion, cached source transcript, restored source authority

**Non-Participating AgentProfile Memory**:
An otherwise active Companion or Relationship Memory involving an away or removed AgentProfile. Member Presence does not mutate Memory Lifecycle, Revision, Proposal, or Supersession data; no active Agent projection or proposal target is produced while ineligible. Returning from away restores applicability without a new Revision, while removed is permanently ineligible.
_Avoid_: automatically retired Memory, removed Memory scope, deleted Proposal, removal-driven Forget

**Memory Body Limit**:
The invariant that every Proposal candidate body and every user-authored MemoryRevision body is non-blank UTF-8 text of at most 2,048 stored bytes. Oversized content is rejected without truncation or automatic splitting.
_Avoid_: token limit, Markdown file size, automatic summary, multi-Memory expansion

**Memory Body**:
The plain UTF-8 text of one atomic MemoryRevision or Proposal candidate. Line breaks may be meaningful text, but Markdown/HTML characters carry no stored rich-text semantics; projector owns and escapes all Markdown structure.
_Avoid_: Markdown document, HTML fragment, projection fields, executable prompt template

**Canonical Memory Body**:
The sole stored form of Memory Body after converting CRLF/CR to LF, trimming outer whitespace, and rejecting C0 controls other than LF and TAB. Internal whitespace and Unicode code points are otherwise preserved; validation, byte limits, hashing and exact comparison use these stored bytes.
_Avoid_: raw submitted body, Unicode compatibility fold, display-only normalization, pre-normalization hash

**Memory Secret Filter**:
The non-overridable Core validation that rejects credentials and authentication secrets before any Proposal candidate or MemoryRevision body is persisted. It never logs matched text and does not create a generic personal-information score, label, kind or lifecycle.
_Avoid_: user override, post-persistence scanner, sensitive-personality profile, secret audit snippet

**Active Memory Scope Capacity**:
The count-and-current-body budget for one active Hearth set, one AgentProfile's active Companion set, or one unordered pair's active Relationship set. Pending Proposals, retired Memories and historical Revisions do not reserve it; every command that would expand the active set revalidates it without automatic eviction.
_Avoid_: database storage quota, Proposal queue capacity, revision-history limit, automatic retention policy

**CampMember**:
The persistent membership relationship that associates an AgentProfile with one Camp and carries Camp-specific permissions. It does not duplicate Member Presence; away and removed identities remain historically related to their Camps while being ineligible for current participation.
_Avoid_: AgentProfile, Member, Member Presence

**Default Lead**:
The present CampMember persisted as the destination for unaddressed execution requests and as the Camp-wide coordination reader. Runtime configuration and Readiness do not determine Lead validity; failed execution never silently falls back to another member. An invalid Lead is repaired idempotently when entering the Camp using the latest Member Order.
_Avoid_: Task Assignee, universal administrator, Native Session owner, Runtime fallback target

**Conversation**:
One AgentProfile's long-lived private continuity inside one Camp, independent of whichever external Runtime currently serves it.
_Avoid_: Camp, Native Session, AgentRun, public chat transcript

**Task**:
An optional durable responsibility item inside one Camp, used when work must remain visible across messages, AgentRuns, or member coordination. `completed` records an authorized actor's declaration of completion, not verification by Rovai-ai Core. Tasks do not form a dependency DAG or a Core-enforced workflow. An A2A target Run does not inherit its source Run's optional Task association; ordinary message content and explicit references carry collaboration context without transferring responsibility. A Task may describe a filesystem path as ordinary semantic content, but it does not own or structurally transfer an AgentRun working directory.
_Avoid_: Camp, Conversation, chat thread, internal plan, one-off A2A request, workflow node

**Native Session**:
A replaceable external Runtime handle currently bound to a Conversation. It does not define the Conversation's identity or own Rovai-ai's portable context.
_Avoid_: Conversation, Session Chain

**Context Read Marker**:
The per-Native-Binding monotonic upper bound of public Camp message sequence covered for the current Native Session — by accepted verbatim input, by an accepted summary body, by being that Session's own current-generation output, or by lying behind a declared Coverage Baseline. Advancement proves delivery acceptance only — not that the model read or understood the content — and is independent of any retrieval-tool reads the Agent performs.
_Avoid_: proof of reading, retrieval position

**Coverage Baseline**:
The sequence position an accepted Bootstrap or over-budget input may declare, behind which older public Camp history is not injected but is declared present — with its summary catalog and retrieval entry — in that input's Context Briefing. History behind the baseline counts as covered for the Context Read Marker while remaining reachable only through retrieval.
_Avoid_: silent history skip, summary substitute, third summary level

**Segment Summary**:
A Camp-owned, immutable, shared summary covering one contiguous range of public Camp messages, generated only from untombstoned CampMessage bodies and attachment metadata, and reused by every CampMember. Content unfit for summarization must never enter CampMessage in the first place.
_Avoid_: per-Conversation summary, bootstrap summary, unread summary, private context

**Epoch Summary**:
A Camp-owned second-level summary covering one contiguous run of Segment Summaries. The summary hierarchy stops at two levels; older Epochs are loaded on demand through search rather than compressed further.
_Avoid_: third-level summary, rolling global summary, whole-Camp digest

**Context Briefing**:
A system-derived, non-LLM structured orientation section injected only into Bootstrap and over-budget AgentRun inputs: unread range with covering summaries, sender activity, the Agent's open Tasks and pending ActionRequests, aggregated reference identifiers, and unread messages involving the Agent. It is derived read state, never a CampMessage, and never enters summaries.
_Avoid_: CampMessage, summary content, Memory, recentEvents side channel

**AdapterInstallation**:
A shared, stable local launch target and configuration scope for one Agent Runtime Adapter. Multiple AgentProfiles may reference it, while its observed binary version and capabilities may change as the installed CLI is upgraded. A removed AgentProfile may retain an inert historical reference, but that reference is not an active launch, health, projection, or deletion blocker.
_Avoid_: Adapter version, immutable binary

**Execution Engine (product term)**:
The product-facing name for a Member's selectable Agent Runtime and its AdapterInstallation. The Member settings section is titled `Agent运行时`; its selectable engine field, ordinary status, empty states, Toasts, and user guidance say `执行引擎`. Runtime, Adapter, and AdapterInstallation remain implementation and protocol vocabulary, and specific products such as Codex CLI keep their names.
_Avoid_: displaying Adapter Installation, Agent Runtime, or bare Runtime as generic end-user labels

**Runtime Readiness Projection**:
The advisory AgentProfile read state derived from the latest persisted AdapterInstallation capability snapshot. Ordinary member lists, lobby rendering, and Camp opening perform no executable content read or fingerprint calculation. Runtime discovery and installation refresh are explicit or view-driven diagnostics that run outside the interactive Core request queue; immediately before a new AgentRun is admitted, Core independently verifies the current executable fingerprint and rejects stale snapshots.
_Avoid_: authoritative execution admission, startup-wide Runtime probing, synchronous executable hashing during profile or Camp reads, UI-derived launch safety

**Adapter Permission Configuration**:
The Adapter-specific Runtime permission settings selected for an AgentProfile, using the upstream agent's own concepts and values. It is distinct from Rovai-ai business Capabilities and has no implied equivalence across Adapter kinds.
_Avoid_: Rovai-ai permission level, Capability, arbitrary CLI arguments

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

**Minimal A2A Turn Envelope**:
The model-facing source instruction emitted only for an A2A-triggered AgentRun: `[TURN_ENVELOPE] From {senderName} ({senderId}); return results or follow-ups to the same agent. [/TURN_ENVELOPE]`. Ordinary user Runs omit the section entirely, and internal Camp, Run, Task, trigger, lineage, epoch, reply, and Inbox correlation identifiers remain outside model input.
_Avoid_: JSON execution metadata, empty user Turn Envelope, source InboxMessage ID, model-owned control identity

**A2A Reply Correlation**:
The trusted Core-side linkage from an A2A target AgentRun back to its source InboxMessage. When that Run explicitly calls `team.post_message` to the same source Agent and omits `inReplyToMessageId`, Core may atomically infer this linkage; it never exposes the correlation ID to the model, auto-sends a final response, auto-wakes the source Agent, or merges Runs.
_Avoid_: automatic reply, automatic wake, model-visible Inbox ID, third-party inferred linkage, Run merging

**Application-Managed File Safety**:
The path, symlink, ownership, permission, size, and atomic-write protections applied when Rovai-ai manages its own blobs, projections, private configurations, sockets, logs, or temporary files. It is independent of Runtime-Managed Permission and remains Core-enforced.
_Avoid_: Agent filesystem permission, Run Workspace boundary, Runtime sandbox

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
The authoritative per-submission Core check that resolves exact Camp targets and validates Member Presence, Runtime configuration and Readiness, Run Workspace launchability, Rovai-ai business Capabilities, serialization, and execution fencing before any message, CampTurn, AgentRun, or new Camp is persisted. It does not authorize filesystem, Shell, or network access; every collaboration target must pass, and rejection is zero-side-effect and never changes the recipient.
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
