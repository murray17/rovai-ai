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

**Member Order**:
The user-controlled global ordering of AgentProfiles used for presentation and new-Camp initialization. It does not express authority, capability, or an existing Camp's Default Lead.
_Avoid_: Role priority, capability rank, automatic Lead reassignment

**AgentProfile**:
An Agent's stable identity, role, and optional character presentation, with optional user-selected default runtime preferences, independent of any particular Camp.
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
A user-confirmed stable choice about how Rovai-ai or a Companion should communicate, present information, or work with the user.
_Avoid_: inferred personality, temporary request, project fact

**Agreement Memory**:
A user-confirmed prospective collaboration rule that the members in its Memory Scope are expected to follow.
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
A live, Camp-and-AgentProfile-specific read view of applicable Relationship Memories. For current Agent A, each other current Camp member B is represented only by active `mutual(A, B)` and `directed(A → B)` content; `directed(B → A)` is available only in the user's complete-pair management view. Memory Guide exposes the directory root instead of enumerating its child files.
_Avoid_: complete pair archive, per-Run snapshot, reverse-direction instruction

**Relationship Direction**:
The immutable Agent-facing applicability of one Relationship Memory: `mutual` enters both pair members' supported read views, while `directed` enters only the actor's view when collaborating with the counterparty. The user can always manage the complete pair.
_Avoid_: directional Relationship Scope, user-hidden note, mutable revision field

**MemoryProposal**:
A durable but non-authoritative `add` or `revise` suggestion from a current fenced AgentRun. Agent A may target Hearth, Companion(A), or Relationship(A, B) for another current member B; a Relationship add may be `mutual` or `directed(A → B)`. Add input contains candidate Scope/Kind/body plus Relationship counterparty/direction; revise input contains `memoryId`, `baseRevisionId`, and complete replacement body. Gateway derives identity, actor, source, time, and idempotency.
_Avoid_: effective memory, cross-Agent proposal, cross-Camp relationship proposal, lifecycle request, automatic learning, user draft

**Stale MemoryProposal**:
A pending revise Proposal whose `baseRevisionId` was current when the Proposal was saved but no longer matches the Memory's current Revision. Stale is a derived condition, not a Proposal status, and the Proposal cannot be accepted or rebased in place.
_Avoid_: stale status, disputed Memory, automatic rebase, immediately stale saved Proposal

**Memory Proposal Receipt**:
The idempotent success result of `memory.propose_change`, identifying one pending `proposalId` while explicitly reporting `effective: false`. It proves the Proposal was saved, not that a Memory or MemoryRevision changed.
_Avoid_: acceptance receipt, Memory ID, echoed candidate body, proof of effective memory

**Memory Proposal Confirmation**:
The per-Proposal user decision to accept the displayed final content, edit then accept, or reject. Acceptance is never batched; batch handling is rejection-only, session ignore has no domain effect, and stale Proposals cannot be accepted or edited into acceptance.
_Avoid_: bulk learning, Agent approval, ignored status, stale rebase

**Memory Proposal Capability**:
The `memory.propose_change` business Capability frozen into an AgentRun's effective configuration. It authorizes only saving bounded add/revise Proposals, defaults on for active AgentProfiles, may be revoked by profile or CampMember configuration for future Runs, and never authorizes acceptance.
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

**Inactive AgentProfile Memory**:
An otherwise active Companion or Relationship Memory whose AgentProfile is disabled or archived. Profile status does not mutate Memory Lifecycle or Proposal history; no AgentRun projection is produced while ineligible, and reactivation makes the same Memory eligible again without a new Revision.
_Avoid_: automatically retired Memory, archived Memory scope, deleted Proposal, reactivation Revision

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
The membership relationship that lets an AgentProfile participate in one Camp with Camp-specific permissions.
_Avoid_: AgentProfile, Member

**Default Lead**:
The CampMember that receives unaddressed execution requests and coordinates Camp-wide work. It may read every Task in its Camp, but the role alone grants no Task mutation capability.
_Avoid_: Task Assignee, universal administrator, Native Session owner

**Conversation**:
One AgentProfile's long-lived private continuity inside one Camp, independent of whichever external Runtime currently serves it.
_Avoid_: Camp, Native Session, AgentRun, public chat transcript

**Task**:
An optional durable responsibility item inside one Camp, used when work must remain visible across messages, AgentRuns, or member coordination. `completed` records an authorized actor's declaration of completion, not verification by Rovai-ai Core. Tasks do not form a dependency DAG or a Core-enforced workflow.
_Avoid_: Camp, Conversation, chat thread, internal plan, one-off A2A request, workflow node

**Native Session**:
A replaceable external Runtime handle currently bound to a Conversation. It does not define the Conversation's identity or own Rovai-ai's portable context.
_Avoid_: Conversation, Session Chain

**AdapterInstallation**:
A shared, stable local launch target and configuration scope for one Agent Runtime Adapter. Multiple AgentProfiles may reference it, while its observed binary version and capabilities may change as the installed CLI is upgraded.
_Avoid_: Adapter version, immutable binary

**Adapter Permission Configuration**:
The Adapter-specific Runtime permission settings selected for an AgentProfile, using the upstream agent's own concepts and values. It is distinct from Rovai-ai business Capabilities and has no implied equivalence across Adapter kinds.
_Avoid_: Rovai-ai permission level, Capability, arbitrary CLI arguments

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
The explicit relationship that exposes one enabled MCP Server Definition to one AgentProfile. Availability is application-global but authority is per Member; it is not inferred from Camp membership.
_Avoid_: Camp MCP scope, Project MCP scope, automatic all-Agent exposure

**MCP Exposure Snapshot**:
The immutable set of enabled, assigned, Adapter-compatible external MCP Server definitions resolved for one AgentRun. Changes affect later AgentRuns without changing the Conversation or Native Session identity.
_Avoid_: Native Session configuration identity, live mutable tool list, MCP Assignment

**MCP Runtime Projection**:
An ephemeral, Adapter-native configuration generated from one MCP Exposure Snapshot and injected when Rovai-ai launches or resumes an Agent CLI. It contains only the selected external Servers plus the fixed Team MCP.
_Avoid_: Runtime personal MCP config, MCP source of truth, central MCP proxy
