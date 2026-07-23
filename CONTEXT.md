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
