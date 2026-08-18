---
document_type: adr-current
authority: current-cross-version-adr-navigation
last_updated: 2026-08-18
---

# 当前跨版本架构决策

本文件是人工审阅的主题导航，不是新的规范真源，也不代表代码已经实现。机器 primary 区精确覆盖
全部 `accepted + cross-version + superseded_by:null` ADR；完整历史见
[HISTORY.md](HISTORY.md)，生命周期和准入规则见 [README.md](README.md)。

每个 ADR 只有一个 primary 主题；跨领域关系写在机器区之外，不参与唯一性计数。主题归属服务阅读，
不改变 ADR、Contract、Architecture、Version 或实现证据的权威边界。

## Core data 与 read side

- **何时阅读：** 修改领域真源、Managed Content、Blob 或 read side 时阅读。
- **当前架构：** [Notification Episode](../architecture/notification-episodes.md)
- **当前合同：** [Notification Episode v4](../contracts/notification-episode-v4.md)

<!-- adr-current-primary:begin topic=core-data -->
| ADR | Decision |
| --- | --- |
| [ADR-0001](0001-core-transaction.md) | Core Transaction |
| [ADR-0013](0013-managed-content-and-read-side-v2.md) | Managed Content and Read Side v2 |
| [ADR-0087](0087-core-owned-durable-in-app-notification-inbox.md) | Core-Owned Durable In-App Notification Inbox |
| [ADR-0175](0175-core-owned-notification-occurrence-episode-and-change-journal.md) | Core-Owned Notification Occurrence, Episode and Change Journal |
<!-- adr-current-primary:end -->

Related: Camp content、Evidence 与 Renderer 可分别回到其 primary 主题。

## Camp 与 workspace

- **何时阅读：** 修改首次安装 admission、Camp 生命周期、Workspace、附件、Draft 或激活事务时阅读。
- **当前架构：** [First-run Onboarding](../architecture/first-run-onboarding.md)、[Camp Activation Lifecycle](../architecture/camp-activation-lifecycle.md)、[Camp Composer Draft](../architecture/camp-composer-draft.md)
- **当前合同：** [First-run Onboarding v1](../contracts/first-run-onboarding-v1.md)、[Pending Camp Activation v1](../contracts/pending-camp-activation-v1.md)、[Camp Composer Draft v2](../contracts/camp-composer-draft-v2.md)

<!-- adr-current-primary:begin topic=camp-workspace -->
| ADR | Decision |
| --- | --- |
| [ADR-0071](0071-configured-camp-creation-and-lazy-conversations.md) | Configured Camp Creation and Lazy Conversations |
| [ADR-0072](0072-directory-workspace-and-dynamic-git-capability.md) | Directory Workspace Identity and Dynamic Git Capability |
| [ADR-0074](0074-quick-chat-ubiquitous-language-and-binding-identity.md) | Quick Chat Ubiquitous Language and Binding Identity |
| [ADR-0080](0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md) | Durable Camp Composer Draft and Atomic Attachment Consumption |
| [ADR-0081](0081-camp-public-attachment-paths-and-frozen-discovery.md) | Camp-Public Attachment Paths and Frozen Discovery |
| [ADR-0128](0128-structured-draft-only-user-message-submission.md) | Structured Draft-Only User Camp Message Submission |
| [ADR-0145](0145-core-owned-pending-camp-draft-activation.md) | Core-Owned Pending Camp Draft Activation |
| [ADR-0169](0169-core-owned-directory-attachment-snapshots.md) | Core-Owned Directory Attachment Snapshots |
| [ADR-0173](0173-leading-structured-mentions-excluded-from-generated-camp-names.md) | Leading Structured Mentions Excluded from Generated Camp Names |
| [ADR-0185](0185-durable-composer-reply-intent-and-explicit-recipient-resolution.md) | Durable Composer Reply Intent and Explicit Recipient Resolution |
| [ADR-0187](0187-durable-composer-recipient-continuation.md) | Durable Composer Recipient Continuation |
| [ADR-0202](0202-desktop-owned-first-run-admission-and-checkpointed-provisioning.md) | Desktop-Owned Pre-Core First-Run Admission and Checkpointed Product Provisioning |
| [ADR-0206](0206-user-confirmed-force-camp-deletion.md) | User-Confirmed Force Camp Deletion |
<!-- adr-current-primary:end -->

Related: Session bootstrap、public delivery 与 product surface 仍从各自 primary 主题进入。

## Member identity

- **何时阅读：** 修改队员身份、Presence、移除、头像、routing identity 或 Self/Peer 投影时阅读。
- **当前架构：** [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)、[Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)
- **当前合同：** [Collaboration State v2](../contracts/collaboration-state-v2.md)

<!-- adr-current-primary:begin topic=member-identity -->
| ADR | Decision |
| --- | --- |
| [ADR-0056](0056-controlled-member-avatar-assets.md) | Controlled Member Avatar References and Application-Managed Local Assets |
| [ADR-0057](0057-member-presence-and-retained-removal.md) | Member Presence and Retained Permanent Removal |
| [ADR-0060](0060-opaque-member-routing-identity.md) | Opaque Member Routing Identity and Globally Unique Names |
| [ADR-0086](0086-single-current-built-in-member-appearance-set.md) | Single Current Built-In Member Appearance Set |
| [ADR-0110](0110-internal-agent-uuid-and-monotonic-short-agent-id.md) | Internal Agent UUID and Monotonic Short Agent ID |
| [ADR-0146](0146-sole-native-session-self-identity-and-peer-routing-projection.md) | Sole Native-Session Self Identity and Peer Routing Projection |
<!-- adr-current-primary:end -->

Related: ADR-0100 的 Session identity delivery 位于 session-context-bootstrap。

## Collaboration、Task 与 Message

- **何时阅读：** 修改 A2A、Task、Message、Delivery、协作责任或公共输出时阅读。
- **当前架构：** [Camp Identity](../architecture/camp-identity.md)、[Public A2A Message 与 Message Delivery](../architecture/public-a2a-message-delivery.md)、[Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)
- **当前合同：** [Camp Identity v1](../contracts/camp-identity-v1.md)、[Durable Task v3](../contracts/durable-task-v3.md)、[Camp Message Send v10](../contracts/camp-message-send-v10.md)、[Camp History Retrieval v3](../contracts/camp-history-v3.md)、[Current User Attention v4](../contracts/current-user-attention-v4.md)、[Gather v3](../contracts/gather-v3.md)、[Message Delivery v4](../contracts/message-delivery-v4.md)、[Missing-Send Recovery Publication v1](../contracts/missing-send-recovery-publication-v1.md)

<!-- adr-current-primary:begin topic=collaboration-task-message -->
| ADR | Decision |
| --- | --- |
| [ADR-0058](0058-collaboration-v4-presence-aware-admission.md) | Collaboration v4: Presence-Aware Routing and Execution Admission |
| [ADR-0076](0076-message-first-agent-run-dispatch-boundary.md) | Message-First AgentRun Dispatch Boundary |
| [ADR-0077](0077-responsive-camp-turn-cancellation-boundary.md) | Responsive CampTurn Cancellation Boundary |
| [ADR-0093](0093-core-owned-atomic-campturn-execution-budgets.md) | Core-Owned Atomic CampTurn Execution Budgets |
| [ADR-0106](0106-agent-bounded-cross-camp-public-history-retrieval.md) | Agent-Bounded Cross-Camp Public History Retrieval |
| [ADR-0108](0108-discovery-only-camp-message-search-and-sequence-paged-reads.md) | Discovery-Only Camp Message Search and Sequence-Paged Reads |
| [ADR-0130](0130-public-a2a-message-and-unified-delivery.md) | Public A2A Messages and Unified Message Delivery |
| [ADR-0131](0131-recipient-scoped-event-driven-delivery-recovery.md) | Recipient-Scoped Event-Driven Delivery Dispatch and Interrupted Recovery |
| [ADR-0134](0134-runtime-public-output-boundary.md) | Explicit Runtime Public Output Boundary |
| [ADR-0136](0136-durable-task-v2-responsibility-and-coordination-authority.md) | Durable Task v2 Responsibility and Coordination Authority |
| [ADR-0137](0137-one-time-task-linked-responsibility-admission.md) | One-Time Task-Linked Responsibility Admission |
| [ADR-0157](0157-message-owned-agentrun-instruction-without-expected-output.md) | Message-Owned AgentRun Instruction Without Expected Output Metadata |
| [ADR-0162](0162-missing-send-recovery-publication.md) | Missing-Send Recovery Publication at Successful AgentRun Termination |
| [ADR-0163](0163-explicit-caller-return-and-core-managed-reply-reference.md) | Explicit Caller Return and Core-Managed Reply Reference |
| [ADR-0165](0165-core-owned-current-user-message-attention.md) | Core-Owned Current-User Message Attention |
| [ADR-0170](0170-current-run-committed-self-write-exact-read.md) | Current-Run Committed Self-Write Exact Read |
| [ADR-0182](0182-core-resolved-current-camp-display-name-inline-addressing-alias.md) | Core-Resolved Current-Camp Display-Name Inline Addressing Alias |
| [ADR-0184](0184-line-leading-display-name-inline-addressing-alias.md) | Line-Leading Display-Name Inline Addressing Alias |
| [ADR-0193](0193-durable-gather-barrier-over-unified-message-delivery.md) | Durable Gather Barrier over Unified Message Delivery |
| [ADR-0195](0195-generation-scoped-last-gather-return.md) | Generation-Scoped Last Gather Return with Independent Bound |
| [ADR-0215](0215-unified-single-camp-history-target-and-publication-boundary.md) | Unified Single-Camp History Target and Public Message Publication Boundary |
| [ADR-0216](0216-explicit-agent-addressing-intent-as-delivery-gate.md) | Explicit Agent Addressing Intent as the Delivery Gate |
| [ADR-0219](0219-single-namespaced-camp-identity.md) | Single Namespaced Camp Identity Separate from Native Sessions |
<!-- adr-current-primary:end -->

Related: Context selection、Self/Peer identity 与 Runtime admission 从相应 primary 主题进入。

## Runtime execution 与 security

- **何时阅读：** 修改 Runtime ownership、权限、安全、Fleet、执行恢复或诊断读写边界时阅读。
- **当前架构：** [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)、[Windows Desktop Platform](../architecture/windows-desktop-platform.md)、[Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)、[Diagnostics Center](../architecture/diagnostics-center.md)、[AgentRun Recovery](../architecture/agent-run-recovery.md)、[Planned Shutdown](../architecture/planned-shutdown.md)
- **当前合同：** [Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)、[Managed Runtime Process v1](../contracts/managed-runtime-process-v1.md)、[Windows Private Storage v1](../contracts/windows-private-storage-v1.md)、[Runtime Launch and Verification v9](../contracts/runtime-launch-and-verification-v9.md)、[Diagnostics Center v1](../contracts/diagnostics-center-v1.md)、[Accepted Input Recovery v1](../contracts/accepted-input-recovery-v1.md)、[Planned Shutdown v2](../contracts/planned-shutdown-v2.md)

<!-- adr-current-primary:begin topic=runtime-execution-security -->
| ADR | Decision |
| --- | --- |
| [ADR-0059](0059-runtime-owned-resource-permissions.md) | Runtime-Owned Resource Permissions and Path-Only Run Workspace |
| [ADR-0062](0062-interruptible-runs-and-unsettled-external-effects.md) | Interruptible Run Trees and Unsettled External Effects |
| [ADR-0065](0065-verified-runtime-catalog-and-documentation-only-compatibility.md) | Verified Runtime Catalog and Documentation-Only Compatibility Evaluation |
| [ADR-0066](0066-managed-product-runtime-resolution.md) | Managed Product Runtime Discovery, Resolution, and Relocation |
| [ADR-0075](0075-runtime-integrity-at-change-and-execution-boundaries.md) | Runtime Integrity at Change and Execution Boundaries |
| [ADR-0079](0079-two-phase-cancellation-projection-and-bounded-runtime-interrupt.md) | Two-Phase Cancellation Projection and Bounded Runtime Interrupt |
| [ADR-0083](0083-background-runtime-checks-and-actionable-status.md) | Background Runtime Checks and Actionable User Status |
| [ADR-0123](0123-exclusive-agentrun-runtime-fleet.md) | Exclusive AgentRun Runtime Processes and Resident Fleet Reuse |
| [ADR-0126](0126-codex-native-home-and-external-session-ownership.md) | Codex Native Home and External Session Ownership |
| [ADR-0127](0127-atomic-member-runtime-configuration.md) | Atomic Member Runtime Configuration and Internal Resolved Binding |
| [ADR-0148](0148-read-only-diagnostics-and-data-minimized-export.md) | Read-Only Diagnostics and Data-Minimized Export |
| [ADR-0156](0156-logical-runtime-identity-and-bounded-installation-rebind.md) | Frozen Logical Runtime Identity and Bounded Installation Rebind |
| [ADR-0164](0164-accepted-input-recovery-requires-proven-native-turn-reconciliation.md) | Accepted Input Recovery Requires Proven Native Turn Reconciliation |
| [ADR-0168](0168-planned-shutdown-preserves-runtime-terminal-authority.md) | Planned Shutdown Preserves Runtime Terminal Authority |
| [ADR-0177](0177-controlled-shutdown-fences-product-execution.md) | Controlled Shutdown Fences Product Execution Without Claiming Runtime Outcome |
| [ADR-0189](0189-settings-only-runtime-preview-outside-product-catalog.md) | Settings-Only Runtime Preview Outside the Product Catalog |
| [ADR-0192](0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md) | Purpose-Scoped Runtime Launch and Execution-Deferred Verification |
| [ADR-0204](0204-on-demand-runtime-deep-verification.md) | On-Demand Runtime Deep Verification with Manager-Owned Attempts |
| [ADR-0207](0207-explicit-maximum-authority-member-runtime-defaults.md) | Explicit Maximum-Authority Member Runtime Defaults |
| [ADR-0208](0208-user-authorized-trae-light-and-availability-verification.md) | User-Authorized TRAE Light and Availability Verification |
| [ADR-0209](0209-bounded-trae-cold-session-history-restore.md) | Bounded TRAE Cold Session History Restore |
| [ADR-0210](0210-platform-qualified-product-runtime-admission.md) | Platform-Qualified Product Runtime Admission |
| [ADR-0211](0211-atomic-windows-managed-process-launch.md) | Atomic Windows Managed Process Launch |
| [ADR-0213](0213-windows-local-private-storage.md) | Windows Local Private Storage and Filesystem Admission |
| [ADR-0220](0220-runtime-model-catalog-stale-while-revalidate.md) | Runtime Model Catalog Stale-While-Revalidate and Execution-Time Validation |
<!-- adr-current-primary:end -->

Related: Session redelivery、Skill/MCP projection 与 Qualification 分别保留独立 primary。

## Session、Context 与 Bootstrap

- **何时阅读：** 修改 Native Session、Bootstrap、Dynamic Context、Profile、redelivery 或 accepted-input ACK 时阅读。
- **当前架构：** [Camp Identity](../architecture/camp-identity.md)、[Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)、[Structured Current Input Skill Links](../architecture/structured-current-input-skill-links.md)、[Native Session Bootstrap Redelivery](../architecture/native-session-bootstrap-redelivery.md)、[Public A2A Message 与 Message Delivery](../architecture/public-a2a-message-delivery.md)
- **当前合同：** [Context Delivery Profile v3](../contracts/context-delivery-profile-v3.md)、[Current Input Skill Links v1](../contracts/current-input-skill-links-v1.md)、[ContextManifest Evidence v18](../contracts/context-manifest-evidence-v18.md)、[Run Facts v1](../contracts/run-facts-v1.md)、[Collaboration State v2](../contracts/collaboration-state-v2.md)

<!-- adr-current-primary:begin topic=session-context-bootstrap -->
| ADR | Decision |
| --- | --- |
| [ADR-0007](0007-portable-conversation-handoff.md) | Portable Conversation Handoff |
| [ADR-0051](0051-boundary-capped-context-retrieval.md) | Boundary-Capped Context Retrieval |
| [ADR-0067](0067-native-session-bootstrap-and-agentrun-context-v3.md) | Native Session Bootstrap and AgentRun Context v3 |
| [ADR-0100](0100-latest-member-identity-native-session-bootstrap.md) | Latest Member Identity in Native Session Bootstrap |
| [ADR-0129](0129-deterministic-bounded-raw-public-context-delivery.md) | Deterministic Bounded Raw Public Context Delivery |
| [ADR-0132](0132-public-reference-context-closure-profile-v2.md) | Bounded Public Reference Context Closure and Profile v2 |
| [ADR-0138](0138-durable-bootstrap-redelivery-requirement.md) | Durable Bootstrap Redelivery Requirement and Accepted-Input Acknowledgement |
| [ADR-0139](0139-version-owned-bootstrap-redelivery-runtime-policy.md) | Version-Owned Bootstrap Redelivery Runtime Policy and Enablement Transition |
| [ADR-0140](0140-runtime-specific-compaction-signal-admission-point.md) | Runtime-Specific Compaction Signal Admission Point and Prepared-Input Cutoff |
| [ADR-0141](0141-atomic-bootstrap-redelivery-input-overlay.md) | Atomic Bootstrap Redelivery Input Overlay and Transient Identity Boundary |
| [ADR-0142](0142-native-session-scoped-compaction-observer-lease.md) | Native-Session-Scoped Compaction Observer Lease and Uncertain-Submission Boundary |
| [ADR-0143](0143-best-effort-non-blocking-compaction-detector-capability.md) | Best-Effort Non-Blocking Compaction Detector Capability |
| [ADR-0147](0147-lossless-model-context-projection-and-layered-delivery-evidence.md) | Lossless Model Context Projection and Layered Delivery Evidence |
| [ADR-0149](0149-bounded-whole-history-omission-evidence.md) | Bounded Whole-History Omission Evidence |
| [ADR-0152](0152-lead-owned-task-responsibility-and-self-active-task-awareness.md) | Lead-Owned Task Responsibility and Self-Active Task Awareness |
| [ADR-0153](0153-explicit-empty-self-active-task-snapshot.md) | Explicit Empty Self-Active Task Snapshot |
| [ADR-0194](0194-mandatory-typed-gather-completion-current-input.md) | Mandatory Typed Gather Completion Current Input |
| [ADR-0196](0196-self-contained-gather-completion-request.md) | Self-Contained Gather Request in Mandatory Completion Input |
| [ADR-0200](0200-compact-context-projection-and-structured-run-facts.md) | Compact AgentRun Context Projection and Structured Run Facts |
| [ADR-0203](0203-structured-current-input-skill-links.md) | Structured Current Input Skill Links |
| [ADR-0218](0218-audience-specific-principal-message-projection.md) | Audience-Specific Principal Message Projection |
<!-- adr-current-primary:end -->

Related: Member identity、Message delivery、Memory entrypoint 与 Evidence 仍从各自 primary 主题进入。

## Memory

- **何时阅读：** 修改 Memory authority、scope、revision、forgetting、retrieval、mutation 或 storage 时阅读。
- **当前架构：** [Online Memory Capture](../architecture/online-memory-capture.md)
- **当前合同：** [Memory Capture v3](../contracts/memory-capture-v3.md)

<!-- adr-current-primary:begin topic=memory -->
| ADR | Decision |
| --- | --- |
| [ADR-0019](0019-application-global-memory-ownership.md) | Application-Global Memory Ownership |
| [ADR-0022](0022-immutable-memory-scope.md) | Immutable Memory Scope |
| [ADR-0026](0026-explicit-memory-supersession.md) | Explicit Memory Supersession |
| [ADR-0027](0027-memory-domain-forgetting.md) | Memory-Domain Forgetting |
| [ADR-0029](0029-bounded-memory-reactivation.md) | Bounded Memory Reactivation |
| [ADR-0047](0047-user-initiated-memory-export-boundary.md) | User-Initiated Memory Export Boundary |
| [ADR-0068](0068-brokered-memory-retrieval-and-session-entrypoint.md) | Brokered Memory Retrieval and Session Entrypoint |
| [ADR-0178](0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md) | Best-Effort Online Memory Capture and Actor-Bounded Agent Mutation |
| [ADR-0179](0179-normalized-memory-store-v3-with-isolated-hearth-review.md) | Normalized Memory Store v3 with Isolated Hearth Review |
| [ADR-0186](0186-complete-exact-scope-memory-view-and-copyable-target.md) | Complete Exact-Scope Memory View and Copyable Revision Target |
<!-- adr-current-primary:end -->

Related: Session entrypoint 与 Built-in operation 只作为交叉导航，不改变 Memory authority。

## Skills、MCP 与 built-ins

- **何时阅读：** 修改 Skill/MCP projection、Built-in transport、CLI、catalog 或 Agent output 时阅读。
- **当前架构：** [Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)、[Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)、[Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- **当前合同：** [Built-in Tool Transport v16](../contracts/builtin-tool-transport-v16.md)、[Built-in Tool Agent Output Projection v1](../contracts/builtin-tool-agent-output-projection-v1.md)、[Windows Skill Projection v1](../contracts/windows-skill-projection-v1.md)

<!-- adr-current-primary:begin topic=skills-mcp-builtins -->
| ADR | Decision |
| --- | --- |
| [ADR-0014](0014-stable-team-tool-gateway-v2.md) | Stable Team Tool Gateway v2 |
| [ADR-0018](0018-file-backed-mcp-library-runtime-projection.md) | File-Backed MCP Library and Per-Run Runtime Projection |
| [ADR-0088](0088-attested-native-team-gateway-attachment.md) | Attested Native Team Gateway Attachment |
| [ADR-0089](0089-attested-built-in-mcp-tool-parity.md) | Attested Built-in MCP Tool Parity |
| [ADR-0103](0103-canonical-mcp-json-and-stable-assignment-identity.md) | Canonical MCP JSON and Stable Assignment Identity |
| [ADR-0105](0105-runtime-group-assigned-skill-delivery.md) | Runtime-Group Assigned Rovai Skill Delivery |
| [ADR-0124](0124-cli-only-transport-for-rovai-built-in-operations.md) | CLI-Only Transport for Rovai Built-in Operations |
| [ADR-0125](0125-runtime-native-additive-external-mcp-projection.md) | Runtime-Native Additive External MCP Projection |
| [ADR-0135](0135-compact-agent-output-over-canonical-built-in-tool-envelope.md) | Compact Agent Output over Canonical Built-in Tool Envelope |
| [ADR-0158](0158-default-all-runtime-delivery-for-managed-skills.md) | Default-All Runtime Delivery for Managed Skills |
| [ADR-0161](0161-event-driven-root-scoped-skill-projection-reconciliation.md) | Event-Driven Root-Scoped Skill Projection Reconciliation |
| [ADR-0166](0166-progressive-built-in-cli-teaching.md) | Progressive Built-In CLI Teaching |
| [ADR-0180](0180-single-agent-memory-write-command.md) | Single Agent Memory Write Command with Outcome-Discriminated Output |
| [ADR-0188](0188-bundled-skill-bootstrap-fast-path-and-execution-integrity.md) | Bundled Skill Bootstrap Fast Path and Execution-Time Integrity |
| [ADR-0191](0191-agent-mediated-member-creation-and-thirteen-skill-inventory.md) | Agent-Mediated Member Creation and Thirteen-Skill Official Inventory |
| [ADR-0197](0197-empty-user-owned-mcp-library.md) | Empty User-Owned MCP Library Without Product Presets |
| [ADR-0198](0198-bounded-open-round-grill-duo-skills.md) | Bounded Open-Round Protocol for Self-Contained Grill Duo Skills |
| [ADR-0199](0199-session-semantic-four-message-review-duo.md) | Session-Semantic Four-Message Review Duo |
| [ADR-0212](0212-cross-platform-local-ipc-transport-v14.md) | Cross-Platform Local IPC for Built-in Tool Transport v14 |
| [ADR-0214](0214-crash-recoverable-windows-skill-projection.md) | Crash-Recoverable Windows Skill Projection |
| [ADR-0217](0217-transport-v15-inherits-cross-platform-v14.md) | Built-in Tool Transport v15 Inherits the Cross-Platform v14 Wire |
<!-- adr-current-primary:end -->

Related: [ADR-0203](0203-structured-current-input-skill-links.md)在 Session/Context 主题拥有 primary，细化用户
选择 Skill 与原生投影文件指针的交叉边界；具体 Skill 名称或版本不是治理例外，长期边界仍按本主题的一般
ADR 准入规则判断。

## Evidence、Runtime Activity 与 Usage

- **何时阅读：** 修改 Execution Evidence、Canonical Activity、classifier、Runtime Usage 或 observation coverage 时阅读。
- **当前架构：** [Runtime Monitoring](../architecture/runtime-monitoring.md)
- **当前合同：** [Runtime Usage Monitoring v3](../contracts/runtime-usage-monitoring-v3.md)

<!-- adr-current-primary:begin topic=evidence-activity -->
| ADR | Decision |
| --- | --- |
| [ADR-0061](0061-durable-agent-inaccessible-execution-evidence.md) | Durable User-Visible and Agent-Inaccessible Execution Evidence |
| [ADR-0111](0111-core-owned-canonical-runtime-activity.md) | Core-Owned Canonical Runtime Activity and Observation-Honest Lifecycle Projection |
| [ADR-0112](0112-immutable-execution-evidence-and-rebuildable-canonical-activity-projection.md) | Immutable Execution Evidence and Rebuildable Versioned Canonical Activity Projection |
| [ADR-0113](0113-core-scoped-operation-identity-and-evidence-deduplication-boundary.md) | Core-Scoped Operation Identity and Evidence Deduplication Boundary |
| [ADR-0114](0114-stable-activity-domain-and-evidence-bounded-semantic-kind.md) | Stable Activity Domain and Evidence-Bounded Semantic Kind |
| [ADR-0115](0115-evidence-bounded-activity-phase-and-outcome-resolution.md) | Evidence-Bounded Activity Phase and Outcome Resolution |
| [ADR-0116](0116-projection-pinned-classifier-version-and-explicit-historical-reprojection.md) | Projection-Pinned Classifier Version and Explicit Historical Reprojection |
| [ADR-0117](0117-observation-capability-coverage-levels-across-runtime-adapters.md) | Observation-Capability Coverage Levels Across Runtime Adapters |
| [ADR-0122](0122-current-canonical-activity-projection-and-deferred-identity-replay.md) | Current Canonical Activity Projection and Deferred Identity Replay |
| [ADR-0205](0205-minimal-runtime-usage-metering.md) | Minimal Runtime Usage Metering |
<!-- adr-current-primary:end -->

Related: Diagnostics、Qualification 与 ContextManifest Evidence 不因此合并为同一 authority。

## Qualification

- **何时阅读：** 修改评测准入、试验隔离、判定、报告或可复现证据时阅读。
- **当前架构：** [Benchmark Protocol](../architecture/benchmark-protocol.md)
- **当前合同：** [Benchmark Protocol v3](../contracts/benchmark-protocol-v3.md)、[Semantic Judge Views v1](../contracts/semantic-judge-views-v1.md)、[Tool Interaction Measurement v2](../contracts/tool-interaction-measurement-v2.md)、[Paired Collaboration Experiment v1](../contracts/paired-collaboration-experiment-v1.md)

<!-- adr-current-primary:begin topic=qualification -->
| ADR | Decision |
| --- | --- |
| [ADR-0090](0090-team-delivery-qualification-evidence-boundary.md) | Team Delivery Qualification Evidence Boundary |
| [ADR-0092](0092-recoverable-qualification-evaluation-integrity.md) | Recoverable Qualification Evaluation Integrity |
| [ADR-0094](0094-formal-qualification-isolation-and-effect-coverage.md) | Formal Qualification Isolation and External Effect Coverage |
| [ADR-0095](0095-layered-qualification-authority-and-semantic-review.md) | Layered Qualification Authority and Advisory Semantic Review |
| [ADR-0097](0097-authority-preserving-benchmark-evidence-ledgers.md) | Authority-Preserving Benchmark Evidence Ledgers |
| [ADR-0098](0098-dual-replica-evidence-bound-semantic-judge.md) | Dual-Replica Evidence-Bound Semantic Judge Protocol |
| [ADR-0101](0101-outcome-only-collaboration-value-qualification-cases.md) | Outcome-Only Collaboration-Value Qualification Cases |
| [ADR-0102](0102-immutable-diagnostic-portfolio-authority.md) | Immutable Diagnostic Portfolio Authority and Two-Repeat Stability |
| [ADR-0151](0151-versioned-benchmark-protocol-and-axis-comparability.md) | Versioned Benchmark Protocol and Axis-Scoped Comparability |
| [ADR-0155](0155-treatment-blind-outcome-and-process-judge-views.md) | Treatment-Blind Outcome and Process Judge Views |
| [ADR-0171](0171-opportunity-based-tool-interaction-measurement.md) | Opportunity-Based Tool Interaction Measurement and Independent Tool-Use Judge |
| [ADR-0172](0172-paired-collaboration-value-and-outcome-conditioned-efficiency.md) | Paired Collaboration Value and Outcome-Conditioned Efficiency |
<!-- adr-current-primary:end -->

Related: Runtime Activity 与 Execution Evidence 作为输入，不替代 Qualification 的判定边界。

## Product 与 Renderer

- **何时阅读：** 修改产品身份、Renderer surface、Run detail 或稳定 UI/UX 合同时阅读。
- **当前架构：** [Diagnostics Center](../architecture/diagnostics-center.md)；其他主题 architecture summary pending
- **当前合同：** [Run Process Detail Surface v9](../contracts/run-process-detail-surface-v9.md)

<!-- adr-current-primary:begin topic=product-renderer -->
| ADR | Decision |
| --- | --- |
| [ADR-0048](0048-rovai-product-identity-and-legacy-namespace.md) | Rovai-ai Product Identity and Controlled Legacy Namespace Migration |
| [ADR-0078](0078-navigation-projection-and-sidebar-wordmark-boundary.md) | Navigation Projection and Sidebar Wordmark Boundary |
| [ADR-0084](0084-conversation-surface-controls-and-stop-outcome-projection.md) | Conversation Surface Controls and Stop Outcome Projection |
| [ADR-0154](0154-agent-level-execution-process-surface.md) | Agent-Level Continuous Execution Process Surface |
| [ADR-0160](0160-focused-camp-inspector-and-single-approval-surface.md) | Focused Camp Inspector and Single Approval Surface |
| [ADR-0190](0190-user-placeable-agent-execution-console.md) | User-Placeable Agent Execution Console |
<!-- adr-current-primary:end -->

Related: 具体 UI 交互继续以 docs/ui/ 为权威；ADR 只记录长期高成本边界。
