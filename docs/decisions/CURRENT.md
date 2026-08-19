---
document_type: current-decision-navigation
authority: current-authority-and-rationale-routing
last_updated: 2026-08-20
---

# 当前规范与决定理由导航

本页先连接当前规范，再连接形成这些边界的重要理由。历史版本决定不证明代码已经实现；实现状态仍需检查代码、Migration、测试和当前版本验收。

完整规范内核迁移对应关系见[当前决策权威覆盖](AUTHORITY-COVERAGE.md)，旧数字 ID 查找见[迁移映射](LEGACY-MAP.md)。

## Core data 与 Read Side

- 当前规范：[基础 Core 不变量](../architecture/foundational-invariants.md#core-command-transaction)、[通知架构](../architecture/notification-episodes.md)、[Notification Episode v4](../contracts/notification-episode-v4.md)。
- 理由来源：[v0.02](../versions/v0.02/decisions.md)、[v0.06](../versions/v0.06/decisions.md)、[v0.28](../versions/v0.28/decisions.md)、[v0.71](../versions/v0.71/decisions.md)。

## Camp、Workspace 与 Published Attachments

- 当前规范：[Camp/Composer 基础不变量](../architecture/foundational-invariants.md#camp-lifecycle)、[Camp Identity](../architecture/camp-identity.md)、[Camp Identity v1](../contracts/camp-identity-v1.md)、[Camp Activation](../architecture/camp-activation-lifecycle.md)、[Composer Draft](../architecture/camp-composer-draft.md)、[Camp Open](../architecture/camp-open-read-path.md)、[Camp Open Projection v5](../contracts/camp-open-projection-v5.md)、[Camp Published Attachment View](../architecture/camp-published-attachment-view.md)、[Camp Attachment v2](../contracts/camp-attachment-v2.md)、[Camp Published Attachment View v1](../contracts/camp-published-attachment-view-v1.md)、[Camp Permanent Deletion v2](../contracts/camp-permanent-deletion-v2.md)、[First-run](../architecture/first-run-onboarding.md)及相应[当前合同](../contracts/README.md)。
- 理由来源：[v0.22](../versions/v0.22/decisions.md)、[v0.23](../versions/v0.23/decisions.md)、[v0.25](../versions/v0.25/decisions.md)、[v0.43](../versions/v0.43/decisions.md)、[v0.77](../versions/v0.77/decisions.md)、[v0.80](../versions/v0.80/decisions.md)、[v0.97](../versions/v0.97/decisions.md)、[v1.00](../versions/v1.00/decisions.md)、[v1.10](../versions/v1.10/decisions.md)、[V1.15-D01](../versions/v1.15/decisions.md#v1-15-d01)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)。

## Member identity

- 当前规范：[成员身份与生命周期](../architecture/foundational-invariants.md#member-identity)、[Collaboration State v2](../contracts/collaboration-state-v2.md)、[`CONTEXT.md`](../../CONTEXT.md)。
- 理由来源：[v0.14](../versions/v0.14/decisions.md)、[v0.15](../versions/v0.15/decisions.md)、[v0.16](../versions/v0.16/decisions.md)、[v0.27](../versions/v0.27/decisions.md)、[v0.50](../versions/v0.50/decisions.md)。

## Collaboration、Task 与 Message Delivery

- 当前规范：[协作与消息基础不变量](../architecture/foundational-invariants.md#collaboration-admission)、[Public A2A Message Delivery](../architecture/public-a2a-message-delivery.md)、[Durable Gather](../architecture/durable-gather-barrier.md)、[Durable Task v3](../contracts/durable-task-v3.md)、[Camp Message Send v10](../contracts/camp-message-send-v10.md)、[Message Delivery v4](../contracts/message-delivery-v4.md)、[Gather v3](../contracts/gather-v3.md)和[Camp History Retrieval v4](../contracts/camp-history-v4.md)。
- 理由来源：[v0.15](../versions/v0.15/decisions.md)、[v0.45](../versions/v0.45/decisions.md)、[v0.47](../versions/v0.47/decisions.md)、[v0.54](../versions/v0.54/decisions.md)、[v0.59](../versions/v0.59/decisions.md)、[v0.62](../versions/v0.62/decisions.md)、[v0.67](../versions/v0.67/decisions.md)、[v0.89](../versions/v0.89/decisions.md)、[v0.90](../versions/v0.90/decisions.md)、[v1.06](../versions/v1.06/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[v1.14](../versions/v1.14/decisions.md)。

## Runtime execution 与 Security

- 当前规范：[Runtime 基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation)、[Runtime Catalog](../architecture/runtime-catalog-boundaries.md)、[AgentRun Recovery](../architecture/agent-run-recovery.md)、[Planned Shutdown](../architecture/planned-shutdown.md)、[Camp Published Attachment View](../architecture/camp-published-attachment-view.md)、[Windows Platform](../architecture/windows-desktop-platform.md)、[Runtime Launch and Verification v10](../contracts/runtime-launch-and-verification-v10.md)、[Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)和[Managed Runtime Process v1](../contracts/managed-runtime-process-v1.md)。
- 理由来源：[v0.16](../versions/v0.16/decisions.md)、[v0.17](../versions/v0.17/decisions.md)、[v0.19](../versions/v0.19/decisions.md)、[v0.20](../versions/v0.20/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.64](../versions/v0.64/decisions.md)、[v0.66](../versions/v0.66/decisions.md)、[v1.01](../versions/v1.01/decisions.md)、[v1.03](../versions/v1.03/decisions.md)、[v1.04](../versions/v1.04/decisions.md)、[v1.05](../versions/v1.05/decisions.md)、[v1.11](../versions/v1.11/decisions.md)、[v1.12](../versions/v1.12/decisions.md)、[v1.13](../versions/v1.13/decisions.md)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)。

## Session、Context 与 Bootstrap

- 当前规范：[Context 基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap)、[Native Session Bootstrap Redelivery](../architecture/native-session-bootstrap-redelivery.md)、[Structured Skill Links](../architecture/structured-current-input-skill-links.md)、[ContextManifest Evidence v20](../contracts/context-manifest-evidence-v20.md)、[Context Delivery Profile v4](../contracts/context-delivery-profile-v4.md)、[Run Facts v2](../contracts/run-facts-v2.md)和[Current Input Skill Links v1](../contracts/current-input-skill-links-v1.md)。
- 理由来源：[v0.21](../versions/v0.21/decisions.md)、[v0.35](../versions/v0.35/decisions.md)、[v0.44](../versions/v0.44/decisions.md)、[v0.48](../versions/v0.48/decisions.md)、[v0.50](../versions/v0.50/decisions.md)、[v0.52](../versions/v0.52/decisions.md)、[v0.54](../versions/v0.54/decisions.md)、[v0.89](../versions/v0.89/decisions.md)、[v0.90](../versions/v0.90/decisions.md)、[v0.94](../versions/v0.94/decisions.md)、[v0.98](../versions/v0.98/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[V1.15-D03](../versions/v1.15/decisions.md#v1-15-d03)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)。

## Memory

- 当前规范：[Memory 基础不变量](../architecture/foundational-invariants.md#memory-lifecycle)、[Online Memory Capture](../architecture/online-memory-capture.md)、[Memory Capture v3](../contracts/memory-capture-v3.md)。
- 理由来源：[v0.10](../versions/v0.10/decisions.md)、[v0.21](../versions/v0.21/decisions.md)、[v0.73](../versions/v0.73/decisions.md)、[v0.78](../versions/v0.78/decisions.md)。

## Skills、MCP 与 Built-ins

- 当前规范：[Skill/MCP 基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport)、[Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)、[Skill Projection](../architecture/skill-projection-reconciliation.md)、[Built-in Tool Transport v17](../contracts/builtin-tool-transport-v17.md)、[Windows Skill Projection v1](../contracts/windows-skill-projection-v1.md)。
- 理由来源：[v0.06](../versions/v0.06/decisions.md)、[v0.09](../versions/v0.09/decisions.md)、[v0.31](../versions/v0.31/decisions.md)、[v0.37](../versions/v0.37/decisions.md)、[v0.42](../versions/v0.42/decisions.md)、[v0.43](../versions/v0.43/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.67](../versions/v0.67/decisions.md)、[v0.82](../versions/v0.82/decisions.md)、[v0.85](../versions/v0.85/decisions.md)、[v0.91](../versions/v0.91/decisions.md)、[v0.92](../versions/v0.92/decisions.md)、[v0.93](../versions/v0.93/decisions.md)、[v1.05](../versions/v1.05/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[v1.14](../versions/v1.14/decisions.md)。

## Evidence、Runtime Activity 与 Usage

- 当前规范：[Evidence/Activity 基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity)、[Runtime Monitoring](../architecture/runtime-monitoring.md)、[Runtime Usage Monitoring v3](../contracts/runtime-usage-monitoring-v3.md)、[Runtime Activity Registry](../runtime-activity/registry.md)。
- 理由来源：[v0.17](../versions/v0.17/decisions.md)、[v0.41](../versions/v0.41/decisions.md)、[v0.96](../versions/v0.96/decisions.md)、[v0.99](../versions/v0.99/decisions.md)。

## Qualification 与 Benchmark

- 当前规范：[Qualification/Benchmark 基础不变量](../architecture/foundational-invariants.md#qualification-evidence)、[Benchmark Protocol](../architecture/benchmark-protocol.md)、[Benchmark Protocol v3](../contracts/benchmark-protocol-v3.md)、[Semantic Judge Views v1](../contracts/semantic-judge-views-v1.md)、[Tool Interaction Measurement v2](../contracts/tool-interaction-measurement-v2.md)、[Paired Collaboration Experiment v1](../contracts/paired-collaboration-experiment-v1.md)。
- 理由来源：[v0.31](../versions/v0.31/decisions.md)、[v0.34](../versions/v0.34/decisions.md)、[v0.36](../versions/v0.36/decisions.md)、[v0.53](../versions/v0.53/decisions.md)、[v0.55](../versions/v0.55/decisions.md)、[v0.68](../versions/v0.68/decisions.md)。

## Product 与 Renderer

- 当前规范：[产品/Renderer 基础不变量](../architecture/foundational-invariants.md#product-navigation)、[UI 规范](../ui/README.md)、[Run Process Detail Surface v13](../contracts/run-process-detail-surface-v13.md)。
- 理由来源：[v0.11](../versions/v0.11/decisions.md)、[v0.24](../versions/v0.24/decisions.md)、[v0.55](../versions/v0.55/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.84](../versions/v0.84/decisions.md)、[v1.12](../versions/v1.12/decisions.md)、[v1.13](../versions/v1.13/decisions.md)、[V1.15-D01](../versions/v1.15/decisions.md#v1-15-d01)、[V1.15-D02](../versions/v1.15/decisions.md#v1-15-d02)。

## 文档治理

- 当前规范：[版本决策治理](README.md)、[文档导航](../README.md)、[版本生命周期](../versions/README.md)。
- 当前决定：[V1.11-D01：当前权威收敛与数字 ADR clean break](../versions/v1.11/decisions.md#v1-11-d01)、[V1.11-D02：局部替代归一与一次性迁移条款退役](../versions/v1.11/decisions.md#v1-11-d02)。
