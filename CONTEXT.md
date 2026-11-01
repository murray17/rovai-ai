# Rovai AI

Rovai AI is a local workspace where long-lived Agent identities collaborate in Threads through external coding-agent Runtimes.

## Domain Glossary

Use this glossary for shared vocabulary. Read only the relevant topic's linked Architecture or Contract for behavior, fields and limits; [documentation routing](docs/README.md) owns the reading order.

### People and membership

Details: [member identity](docs/ui/components/member-identity.md), [membership](docs/architecture/dynamic-camp-membership.md), [channel identity](docs/architecture/feishu-channel.md).

**User**:
The human who owns the collaboration objective and makes user-only decisions. A request for User attention is not approval.

**Agent (product UI term)**:
The selectable coding-agent product, displayed as `智能体`. It is distinct from the persistent teammate identity displayed as `队员`.

**AgentProfile**:
The application-global identity behind one Member, with its identity configuration, Presence and Runtime configuration. It exists independently of any Thread or Runtime session.

**Member**:
The product-facing name for an AgentProfile, displayed as `队员`.
_Avoid_: a separate domain entity, a Thread-scoped identity

**Agent ID**:
The stable routing identity of an AgentProfile used by models and tools. It is distinct from the user-editable Member Name and Core's private storage identity.

**Member Presence**:
The user-controlled availability of an AgentProfile: present, away or permanently removed. It is independent of Thread membership and Runtime readiness.

**ThreadMember**:
The persistent relationship between an AgentProfile and one Thread. Ending membership preserves history; re-adding the Member does not revive earlier work.

**Default Lead**:
The ThreadMember who receives unaddressed user requests and holds the Thread's explicit Task coordination authority. The role does not imply Runtime readiness or general administrative power.

**ExternalPrincipal**:
A provider-scoped human identity established by the channel bridge. It remains distinct from a Member, a Bot account and the local User identity.

### Work organization

Details: [Thread identity](docs/architecture/camp-identity.md), [Team](docs/architecture/team-management.md), [Mission](docs/architecture/missions.md), [Task](docs/contracts/durable-task-v6.md).

**Thread**:
The shared collaboration aggregate owning membership, public messages, private Conversations and related resources. An empty roster preserves its history; Thread deletion is permanent.
_Avoid_: Conversation, Project, Task

**Thread ID**:
The durable Core identity used throughout Thread records and references. Naming changes do not rewrite it; it cannot identify or resume a Native Session.

**Team**:
A user-owned template of Members, Default Lead and optional guidelines copied at Thread creation. It does not own or synchronize an existing Thread's membership.

**Project**:
A read-time grouping of Threads bound to the same canonical directory. It has no independent domain identity or lifecycle.

**Quick Chat**:
The application-managed workspace group for Threads without a user-selected directory, displayed as `快速对话`. Each Thread keeps its own identity.

**Thread Workspace Binding**:
The Thread's durable association with a user-selected directory or the managed Quick Chat directory. Git metadata does not define that association.

**Mission**:
A durable purpose and business status associated with exactly one public Thread. Mission status and AgentRun completion are independent.

**Task**:
An optional durable responsibility item inside one Thread, independent of message delivery and execution. Its status records an authorized declaration rather than verified completion.

**Run Workspace**:
The execution directory frozen for one AgentRun; a Mission may supply its own worktree. A workspace path is not a permission grant.

### Creation, messages and delivery

Details: [Thread creation](docs/architecture/camp-activation-lifecycle.md), [Composer](docs/architecture/camp-composer-draft.md), [public delivery](docs/architecture/public-a2a-message-delivery.md), [mentions](docs/ui/components/structured-mentions.md), [attachments](docs/architecture/camp-published-attachment-view.md).

**New Conversation Draft**:
The transient configuration in the creation dialog, before a Thread exists. Failed creation preserves the draft for correction.

**Pending Thread Draft**:
A durable Thread shell awaiting its first accepted user message. It already has Thread identity and membership but does not own the unsent Composer content.

**Thread Composer Draft**:
The client-local content being prepared for a public Thread message. Publication clears the sent snapshot; failure preserves it.

**Local Attachment Source Ref**:
A reference to an actual user- or Agent-provided file or directory whose content and availability may change. Publication transfers neither ownership nor filesystem permission.

**ThreadMessage**:
One public message in a Thread, with an author, structured content and publication identity. Addressing and processing responsibility are separate from the public message itself.

**Public A2A Message**:
An Agent-authored Thread message addressing zero or more Members. It is published once, independently of how many recipients process it.

**Member Mention**:
A structured Member reference selected in user-authored content. Lookalike plain text is not an addressing reference.

**Effective Recipients**:
The deduplicated recipient set resolved and frozen when a message is accepted. Recipient identity eligibility is separate from Runtime readiness and scheduling order.

**Message Anchor**:
The message reference used to present a reply relationship. It neither selects recipients nor represents every cause of a multi-input Run.

**Current User Attention**:
A message-local request for a user decision, action or explicitly requested notification. It does not make the User an Agent recipient or carry approval authority.

**Message Delivery**:
One recipient's processing responsibility for a published message. Waiting Deliveries are queued work; they do not imply that an AgentRun exists.

**Delivery Claim**:
The atomic selection of waiting messages for one recipient that creates a multi-input AgentRun and freezes its input. Publication and Runtime launch are separate boundaries.

**Recallable User Message**:
A local user message whose deliveries remain unclaimed and whose content has entered no frozen Runtime input. Withdrawal removes its readable application content; it does not promise forensic erasure of external copies.

### Execution and continuity

Details: [execution lifecycle](docs/architecture/public-a2a-message-delivery.md), [Single Chat](docs/architecture/single-chat.md), [recovery](docs/architecture/agent-run-recovery.md).

**Conversation**:
One AgentProfile's private logical continuity inside a Thread, independent of the Runtime serving it. Ordinary Member continuity and Single Chat are separate Conversation kinds.
_Avoid_: Thread, AgentRun, Native Session

**Single Chat**:
The User's private Conversation with one Member inside a Thread. Its messages and final response stay private in Rovai; workspace and external Runtime side effects are not promised private.

**AgentRun**:
One durable execution instance for an AgentProfile within a Conversation. A public Run can process several claimed messages; its lifecycle is distinct from Task or Mission status.

**Native Session**:
The external Runtime's conversational continuity referenced by Rovai. Replacing its binding does not replace the Conversation, and deleting a Thread does not prove deletion of external Runtime state.

**Native Binding**:
Rovai's association between a Conversation and a Native Session. Its generation separates current execution authority from stale Runtime activity.

**Native Turn**:
One provider-owned model execution within a Native Session. Session resume alone does not establish that a prior Turn can be recovered.

**Unsettled External Effect**:
An operation whose occurrence or outcome remains unknown after an abortive failure. A Run's terminal state does not prove that the external effect did or did not happen.

**Planned Shutdown**:
The controlled settlement of running work and Runtime cleanup during an intentional quit, restart or update. It is distinct from crash recovery and business completion.

### Model context

Details: [Bootstrap](docs/architecture/foundational-invariants.md#context-session-bootstrap), [ContextManifest](docs/architecture/foundational-invariants.md#context-manifest-run-facts), [history](docs/architecture/foundational-invariants.md#context-public-history).

**Native Session Bootstrap**:
Core-provided startup instructions, Member identity and applicable guidance for a Native Session. Delivery and redelivery follow the target Runtime's contract.

**AgentRun Dynamic Context**:
The frozen model-facing context for one Runtime input delivery. It contains the applicable current facts and input, not the sender's complete prompt or private continuity.

**Run Input**:
The complete ordered messages establishing a public input delivery's processing responsibility. Single Chat uses its separate single-message Current Input contract.

**ContextManifest**:
Immutable evidence of an input's selected sources and frozen model-facing content. It supports exact recovery but does not prove Runtime acceptance or model understanding.

**Runtime Input Delivery**:
The delivery-attempt evidence connecting a ContextManifest to its Run and Native Binding. Only the matching accepted acknowledgement advances accepted-input state.

**Accepted Public Context Boundary**:
The acknowledged public-message watermark used for later context hints. It neither injects automatic public history nor limits otherwise authorized live reads.

**Thread History Retrieval**:
An explicit authorized read of public messages. It does not claim work, expose private Conversations or advance accepted-input state.

### Skills and tools

Details: [Skills](docs/architecture/skills.md), [Built-in tools and MCP](docs/architecture/builtin-tool-runtime.md).

**Skill**:
A file-based guide with optional resources that a Runtime can read when relevant. It grants no tool, mutation or approval authority.

**Rovai Platform Skills**:
The fixed platform guides indexed in Bootstrap. Being indexed does not prove that the model read their files.

**Rovai Toolbox Skills**:
The optional Rovai guides selected for a Member or a particular input. A message-local selection does not change the Member's saved configuration.

**Runtime-native Skill**:
A user- or project-level Skill owned by its Runtime at its original path. Rovai discovers it without importing or taking ownership of the file.

**Skill Mention**:
A structured reference to a selected Skill's source identity. A name or plain slash token alone does not identify or load a Skill.

**Canonical Operation**:
The Core-owned business action underlying one Rovai built-in command. Its authorization and result semantics are independent of command presentation.

**Built-in Tool Transport**:
The Rovai CLI and local Core path through which an authenticated AgentRun invokes canonical operations. It is separate from external MCP servers.

**MCP Server Definition**:
A user-managed connection definition for an external tool server. It does not itself assign the server to a Member or prove availability.

**MCP Assignment**:
The request to add an external MCP server to one Member's future Runtime exposure. The actual projection records availability and collision outcomes; assignment is not an execution guarantee.

### Runtime and authority

Details: [Runtime boundaries](docs/architecture/runtime-catalog-boundaries.md), [permissions](docs/architecture/foundational-invariants.md#runtime-platform-security), [database admission](docs/architecture/availability-first-runtime.md#database-authority-state-machine).

**Runtime**:
An external coding-agent product that executes work and owns its native sessions, configuration and permissions. Product integration, local installation and current execution readiness are different facts.

**AdapterInstallation**:
The selected local launch identity for a Runtime. It records where and how to launch, not whether the next Run will succeed.

**Adapter Capability Snapshot**:
Recorded diagnostic evidence of a Runtime installation's observed capabilities. It is not a substitute for validating the actual execution Host.

**Member Runtime Configuration**:
The Member's saved Runtime, model policy and native permission choices. It is independent of the Member's identity and Thread membership.

**Run Runtime Configuration**:
The execution configuration frozen for an AgentRun. Later Member edits apply to new Runs.

**Runtime-Managed Permission**:
The native Runtime's authority over filesystem, shell and network operations. Rovai relays native approval decisions without turning the Run Workspace into a separate permission boundary.

**Runtime Permission Request**:
A native Runtime's request for a decision on a specific operation or resource scope. The available choices and their meaning come from that Runtime.

**Database Admission**:
Core's determination that an existing data store may open or migrate, or that absence permits initialization. Unknown, damaged or ambiguous data is preserved and blocked rather than replaced with an empty store.

### Memory

Details: [Memory governance and Agent reads/writes](docs/architecture/online-memory-capture.md).

**Memory Library**:
The application-global, user-governed collection of durable memories. It is independent of Threads, Projects and Runtime session history.

**Memory**:
One durable recognition with a stable identity and a selected current Revision. It is not current task truth or a source of permission.

**MemoryRevision**:
An immutable version of a Memory's content and retrieval keys. A pending review candidate is not a Revision.

**Memory Scope**:
The immutable ownership and visibility boundary: Hearth for the local home, Companion for one AgentProfile, or Relationship for an AgentProfile pair. Relationship direction further limits each Agent's applicable view.

**Memory Kind**:
The content's immutable classification as a Preference, Agreement or Lesson. It is distinct from Scope and lifecycle.

**Memory Lifecycle**:
Whether a Memory is active, retired or forgotten. Forgetting is terminal; changing Member Presence does not change Memory lifecycle.

**Memory Entrypoint**:
Bootstrap's body-free discovery guide to applicable memories. Later reads still resolve current content and authorization.

**Memory View**:
A complete authorized view of one exact effective Memory scope used to judge an add or revision. It is distinct from ranked search results.

**Hearth Review Item**:
An Agent-proposed shared-memory change awaiting an explicit user decision. Its content is not effective Memory before acceptance.

**Memory Forget**:
The irreversible removal of a Memory's readable content from supported Memory reads. It does not erase prior Run inputs, external Runtime history or user-controlled copies.

### Evidence and attention

Details: [activity evidence](docs/runtime-activity/README.md), [usage](docs/architecture/runtime-monitoring.md), [notifications](docs/architecture/notification-episodes.md).

**Runtime Evidence**:
A Runtime-reported or Core-observed fact about execution. Missing observations do not prove that an action did not happen.

**Canonical Runtime Activity**:
The Core's semantic projection of an observed operation and its lifecycle. It derives from evidence without rewriting the source facts.

**Runtime Usage Observation**:
A source-qualified observation of tokens, cache, context or cost. Missing values stay unknown, and estimates remain distinct from provider-reported billing.

**Notification Episode**:
The user-visible aggregation of related attention occurrences. Acknowledging it does not change the underlying business state.

### Automation and evaluation

Details: [Automation](docs/architecture/scheduled-automation.md), [evaluation](docs/development/evaluation.md), [qualification](docs/architecture/benchmark-protocol.md).

**Automation**:
A durable scheduled instruction for one Member, displayed as `定时任务`. It is not a persistent background Conversation.

**Automation Occurrence**:
One scheduled or explicitly requested trigger, admitted to start or skipped because prior work overlaps. It is not a delayed or queued retry.

**AutomationRun**:
The outcome record of one started Automation Occurrence. It is distinct from its AgentRun and from delivery of the result notification.

**Formal Qualification Trial**:
An autonomous evaluation under the qualification protocol's recorded release, Runtime and isolation requirements. Diagnostic runs and shared-user fixtures do not establish formal qualification.

**Hard Outcome**:
The protocol-determined pass or fail result of a scorable formal Trial. Diagnostic and semantic assessments can explain it but cannot change it.

**Semantic Engineering Review**:
An advisory, evidence-based assessment of engineering output or process. It is not a qualification verdict or verified business completion.
