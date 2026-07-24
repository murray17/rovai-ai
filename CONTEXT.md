# Lumen AI

Lumen is a local multi-Agent workbench in which long-lived Agent identities collaborate inside Camps while retaining independent conversational continuity.

## Language

**Camp**:
A long-lived shared collaboration context containing participants, public discussion, private Agent continuities, resources, and outcomes. The product may present a Camp as a conversation, but domain code must not call it a Conversation. User deletion permanently removes the Camp aggregate; Lumen does not model Camp archive or trash.
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
An optional durable responsibility item inside one Camp, used when work must remain visible across messages, AgentRuns, or member coordination. `completed` records an authorized actor's declaration of completion, not verification by Lumen Core. Tasks do not form a dependency DAG or a Core-enforced workflow.
_Avoid_: Camp, Conversation, chat thread, internal plan, one-off A2A request, workflow node

**Native Session**:
A replaceable external Runtime handle currently bound to a Conversation. It does not define the Conversation's identity or own Lumen's portable context.
_Avoid_: Conversation, Session Chain

**AdapterInstallation**:
A shared, stable local launch target and configuration scope for one Agent Runtime Adapter. Multiple AgentProfiles may reference it, while its observed binary version and capabilities may change as the installed CLI is upgraded.
_Avoid_: Adapter version, immutable binary

**Adapter Permission Configuration**:
The Adapter-specific Runtime permission settings selected for an AgentProfile, using the upstream agent's own concepts and values. It is distinct from Lumen business Capabilities and has no implied equivalence across Adapter kinds.
_Avoid_: Lumen permission level, Capability, arbitrary CLI arguments

**Capability**:
A Core-enforced business authorization atom that allows an Agent to request a class of Lumen domain mutation. It is distinct from an exposed Team Tool, the scope of records visible to that Agent, and Adapter filesystem/Shell/network permissions.
_Avoid_: Tool, visibility scope, Adapter permission, universal administrator role

**Skill**:
A reusable directory package of instructions and optional supporting resources that an Agent Runtime can discover and load when relevant.
_Avoid_: System Prompt, Team Tool, MCP Server, AgentProfile

**Skill Library**:
Lumen's application-global collection of managed Skills, independent of their import source and of every Runtime's personal Skill directories.
_Avoid_: Runtime personal Skill store, Project Skill directory, source folder

**SkillRevision**:
An immutable snapshot of one Skill's complete managed content. A Skill selects one current revision while older revisions remain distinct for as long as that Skill is retained.
_Avoid_: Mutable Skill folder, in-place update, Runtime cache

**SkillProjection**:
A reconstructible Lumen-managed filesystem entry that exposes one SkillRevision through a Runtime's native project-level discovery path for an execution root.
_Avoid_: Skill source of truth, Runtime personal installation, proof that a model loaded the Skill

**MCP Library**:
Lumen's application-global collection of user-visible external MCP Server definitions. It is an independent source of truth and does not include Lumen's internal Team MCP gateway.
_Avoid_: Runtime personal MCP configuration, remote marketplace, Team MCP

**MCP Import**:
A user-confirmed, one-time copy of portable MCP Server definitions from known local Agent configuration sources into the MCP Library. It does not establish ongoing synchronization, mutate the source configuration, or copy credentials and OAuth tokens.
_Avoid_: MCP sync, configuration mirroring, credential migration

**MCP Import Candidate**:
A read-only, transient discovery result from a known Runtime user-level configuration. It is not an MCP Server Definition until the user confirms import.
_Avoid_: Imported Server, synchronized record, project configuration

**MCP Server Definition**:
A stable external MCP Server configuration in the MCP Library, represented by Lumen's typed Stdio or Streamable HTTP model and translated by each AgentRuntimeAdapter into Runtime-native configuration.
_Avoid_: Raw Cursor JSON, Runtime-specific configuration blob, running MCP process, legacy SSE definition

**MCP Configuration File**:
The application-global `~/.lumen/mcp.json` file that is the sole source of truth for external MCP Server definitions, enablement, and Member assignments. The MCP settings page is its graphical editor.
_Avoid_: MCP database table, generated Runtime projection, synchronized source config

**MCP Assignment**:
The explicit relationship that exposes one enabled MCP Server Definition to one AgentProfile. Availability is application-global but authority is per Member; it is not inferred from Camp membership.
_Avoid_: Camp MCP scope, Project MCP scope, automatic all-Agent exposure

**MCP Exposure Snapshot**:
The immutable set of enabled, assigned, Adapter-compatible external MCP Server definitions resolved for one AgentRun. Changes affect later AgentRuns without changing the Conversation or Native Session identity.
_Avoid_: Native Session configuration identity, live mutable tool list, MCP Assignment

**MCP Runtime Projection**:
An ephemeral, Adapter-native configuration generated from one MCP Exposure Snapshot and injected when Lumen launches or resumes an Agent CLI. It contains only the selected external Servers plus the fixed Team MCP.
_Avoid_: Runtime personal MCP config, MCP source of truth, central MCP proxy
