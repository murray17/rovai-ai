# Lumen AI

Lumen is a local multi-Agent workbench in which long-lived Agent identities collaborate inside Camps while retaining independent conversational continuity.

## Language

**Member**:
The product-facing name for an AgentProfile that a user can configure and invite into one or more Camps. It is not a separate domain object.
_Avoid_: Teammate, Member entity, member record

**AgentProfile**:
An Agent's stable identity, role, and optional character presentation, with optional user-selected default runtime preferences, independent of any particular Camp.
_Avoid_: Member in domain code, Teammate, AgentInstance

**CampMember**:
The membership relationship that lets an AgentProfile participate in one Camp with Camp-specific permissions.
_Avoid_: AgentProfile, Member

**Conversation**:
One AgentProfile's long-lived private continuity inside one Camp, independent of whichever external Runtime currently serves it.
_Avoid_: Native Session, AgentRun, chat transcript

**Native Session**:
A replaceable external Runtime handle currently bound to a Conversation. It does not define the Conversation's identity or own Lumen's portable context.
_Avoid_: Conversation, Session Chain

**AdapterInstallation**:
A shared, stable local launch target and configuration scope for one Agent Runtime Adapter. Multiple AgentProfiles may reference it, while its observed binary version and capabilities may change as the installed CLI is upgraded.
_Avoid_: Adapter version, immutable binary

**Adapter Permission Configuration**:
The Adapter-specific Runtime permission settings selected for an AgentProfile, using the upstream agent's own concepts and values. It is distinct from Lumen business Capabilities and has no implied equivalence across Adapter kinds.
_Avoid_: Lumen permission level, Capability, arbitrary CLI arguments
