---
document_type: current-decision-navigation
authority: current-authority-and-rationale-routing
last_updated: 2026-08-30
---

# 当前规范与决定理由导航

本页先连接当前规范，再连接形成这些边界的重要理由。历史版本决定不证明代码已经实现；实现状态仍需检查代码、Migration、测试和当前版本验收。

完整规范内核迁移对应关系见[当前决策权威覆盖](AUTHORITY-COVERAGE.md)，旧数字 ID 查找见[迁移映射](LEGACY-MAP.md)。

## Core data 与 Read Side

- 启动分层补充规范：[可选功能门禁](../contracts/desktop-runtime-availability-v1.md#7-authority-ready-and-optional-subsystem-gates)、[Windows Bootstrap assessment](../contracts/desktop-runtime-availability-v1.md#8-windows-pre-ready-bootstrap-assessment)；理由：[V1.31-D05](../versions/v1.31/decisions.md#v1-31-d05)、[V1.31-D06](../versions/v1.31/decisions.md#v1-31-d06)。

- 当前规范：[Desktop 可用性与权威准入](../architecture/foundational-invariants.md#desktop-authority-admission)、[Availability-first Runtime](../architecture/availability-first-runtime.md)、[Desktop Runtime Availability v1](../contracts/desktop-runtime-availability-v1.md)、[基础 Core 不变量](../architecture/foundational-invariants.md#core-command-transaction)、[通知架构](../architecture/notification-episodes.md)、[Notification Episode v4](../contracts/notification-episode-v4.md)。
- 理由来源：[v0.02](../versions/v0.02/decisions.md)、[v0.06](../versions/v0.06/decisions.md)、[v0.28](../versions/v0.28/decisions.md)、[v0.71](../versions/v0.71/decisions.md)、[V1.31-D01](../versions/v1.31/decisions.md#v1-31-d01)、[V1.31-D02](../versions/v1.31/decisions.md#v1-31-d02)、[V1.31-D03](../versions/v1.31/decisions.md#v1-31-d03)。

## Camp、Workspace 与 Attachments

- 当前规范：[Camp/Composer 基础不变量](../architecture/foundational-invariants.md#camp-lifecycle)、[Camp Identity](../architecture/camp-identity.md)、[Camp Identity v1](../contracts/camp-identity-v1.md)、[动态 Camp 队员关系](../architecture/dynamic-camp-membership.md)、[Camp Membership v1](../contracts/camp-membership-v1.md)、[Camp Activation](../architecture/camp-activation-lifecycle.md)、[Composer Draft](../architecture/camp-composer-draft.md)、[Camp Composer Draft v5](../contracts/camp-composer-draft-v5.md)、[Camp Open](../architecture/camp-open-read-path.md)、[Camp Open Projection v8](../contracts/camp-open-projection-v8.md)、[Camp Attachments](../architecture/camp-published-attachment-view.md)、[Camp Attachment v7](../contracts/camp-attachment-v7.md)、[Camp Published Attachment View v4（legacy v1）](../contracts/camp-published-attachment-view-v4.md)、[Camp Permanent Deletion v2](../contracts/camp-permanent-deletion-v2.md)、[Runtime File Change Observation](../architecture/runtime-file-change-observation.md)、[Runtime File Change Observation v2](../contracts/runtime-file-change-observation-v2.md)、[First-run](../architecture/first-run-onboarding.md)及[First-run Onboarding v3](../contracts/first-run-onboarding-v3.md)。
- 理由来源：[v0.22](../versions/v0.22/decisions.md)、[v0.23](../versions/v0.23/decisions.md)、[v0.25](../versions/v0.25/decisions.md)、[v0.43](../versions/v0.43/decisions.md)、[v0.77](../versions/v0.77/decisions.md)、[v0.80](../versions/v0.80/decisions.md)、[v0.97](../versions/v0.97/decisions.md)、[v1.00](../versions/v1.00/decisions.md)、[v1.10](../versions/v1.10/decisions.md)、[V1.15-D01](../versions/v1.15/decisions.md#v1-15-d01)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)、[V1.15-D06](../versions/v1.15/decisions.md#v1-15-d06)、[V1.16-D01](../versions/v1.16/decisions.md#v1-16-d01)、[V1.17-D01](../versions/v1.17/decisions.md#v1-17-d01)、[V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)、[V1.19-D02](../versions/v1.19/decisions.md#v1-19-d02)、[V1.20-D01](../versions/v1.20/decisions.md#v1-20-d01)、[V1.27-D08](../versions/v1.27/decisions.md#v1-27-d08)、[V1.28-D10](../versions/v1.28/decisions.md#v1-28-d10)、[V1.29-D01](../versions/v1.29/decisions.md#v1-29-d01)、[V1.29-D04](../versions/v1.29/decisions.md#v1-29-d04)、[V1.29-D06](../versions/v1.29/decisions.md#v1-29-d06)、[V1.29-D08](../versions/v1.29/decisions.md#v1-29-d08)、[V1.29-D09](../versions/v1.29/decisions.md#v1-29-d09)、[V1.31-D04](../versions/v1.31/decisions.md#v1-31-d04)。

## Camp 文件预览

- 当前规范：[File Preview Architecture](../architecture/file-preview.md)、[File Preview v2](../contracts/file-preview-v2.md)、[Camp 文件预览区](../ui/components/file-preview.md)及[Camp 会话工作区](../ui/components/conversation-workspace.md)。
- 理由来源：[V1.30-D01–D06](../versions/v1.30/decisions.md#v1-30-d01)；[D07](../versions/v1.30/decisions.md#v1-30-d07) 的选区方案本期已撤回。

## Channels 与 External Principals

- 当前规范：[Channel Storage v2](../contracts/channel-storage-v2.md)、[飞书渠道架构](../architecture/feishu-channel.md)、[Feishu Channel v6](../contracts/feishu-channel-v6.md)、[钉钉渠道架构](../architecture/dingtalk-channel.md)、[DingTalk Channel v4](../contracts/dingtalk-channel-v4.md)、[Camp Membership v1](../contracts/camp-membership-v1.md)、[ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)和[渠道设置](../ui/components/channel-settings.md)。
- 飞书理由来源：[V1.33-D01（已由 D09 取代）](../versions/v1.33/decisions.md#v1-33-d01)、[V1.33-D02](../versions/v1.33/decisions.md#v1-33-d02)、[V1.33-D03](../versions/v1.33/decisions.md#v1-33-d03)、[V1.33-D04（话题扩张部分已由 D15 取代）](../versions/v1.33/decisions.md#v1-33-d04)、[V1.33-D05](../versions/v1.33/decisions.md#v1-33-d05)、[V1.33-D06](../versions/v1.33/decisions.md#v1-33-d06)、[V1.33-D07](../versions/v1.33/decisions.md#v1-33-d07)、[V1.33-D08](../versions/v1.33/decisions.md#v1-33-d08)、[V1.33-D09（私聊投递部分已由 D12 取代）](../versions/v1.33/decisions.md#v1-33-d09)、[V1.33-D10](../versions/v1.33/decisions.md#v1-33-d10)、[V1.33-D11](../versions/v1.33/decisions.md#v1-33-d11)、[V1.33-D12](../versions/v1.33/decisions.md#v1-33-d12)、[V1.33-D13（终态展示与 view state 已由 D16 取代）](../versions/v1.33/decisions.md#v1-33-d13)、[V1.33-D14（命令展示与 callback 已由 D16 取代）](../versions/v1.33/decisions.md#v1-33-d14)、[V1.33-D15](../versions/v1.33/decisions.md#v1-33-d15)和[V1.33-D16](../versions/v1.33/decisions.md#v1-33-d16)。
- 钉钉与共享渠道存储理由来源：[V1.34-D01（存储由 D04、OAuth 控制面由 D05 取代）](../versions/v1.34/decisions.md#v1-34-d01)、[V1.34-D02](../versions/v1.34/decisions.md#v1-34-d02)、[V1.34-D03](../versions/v1.34/decisions.md#v1-34-d03)、[V1.34-D04](../versions/v1.34/decisions.md#v1-34-d04)和[V1.34-D05](../versions/v1.34/decisions.md#v1-34-d05)。

## Member identity

- 当前规范：[成员身份与生命周期](../architecture/foundational-invariants.md#member-identity)、[动态 Camp 队员关系](../architecture/dynamic-camp-membership.md)、[Camp Membership v1](../contracts/camp-membership-v1.md)、[Collaboration State v2](../contracts/collaboration-state-v2.md)、[`CONTEXT.md`](../../CONTEXT.md)。
- 理由来源：[v0.14](../versions/v0.14/decisions.md)、[v0.15](../versions/v0.15/decisions.md)、[v0.16](../versions/v0.16/decisions.md)、[v0.27](../versions/v0.27/decisions.md)、[v0.50](../versions/v0.50/decisions.md)、[V1.29-D02](../versions/v1.29/decisions.md#v1-29-d02)、[V1.29-D03](../versions/v1.29/decisions.md#v1-29-d03)。

## Collaboration、Task 与 Message Delivery

- 当前规范：[协作与消息基础不变量](../architecture/foundational-invariants.md#collaboration-admission)、[动态 Camp 队员关系](../architecture/dynamic-camp-membership.md)、[Public A2A Message Delivery](../architecture/public-a2a-message-delivery.md)、[Durable Gather](../architecture/durable-gather-barrier.md)、[Durable Task v3](../contracts/durable-task-v3.md)、[Camp Message Send v14](../contracts/camp-message-send-v14.md)、[Message Delivery v8](../contracts/message-delivery-v8.md)、[Gather v4](../contracts/gather-v4.md)和[Camp History Retrieval v4](../contracts/camp-history-v4.md)。
- 理由来源：[v0.15](../versions/v0.15/decisions.md)、[v0.45](../versions/v0.45/decisions.md)、[v0.47](../versions/v0.47/decisions.md)、[v0.54](../versions/v0.54/decisions.md)、[v0.59](../versions/v0.59/decisions.md)、[v0.62](../versions/v0.62/decisions.md)、[v0.67](../versions/v0.67/decisions.md)、[v0.89](../versions/v0.89/decisions.md)、[v0.90](../versions/v0.90/decisions.md)、[v1.06](../versions/v1.06/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[v1.14](../versions/v1.14/decisions.md)、[V1.19-D02](../versions/v1.19/decisions.md#v1-19-d02)、[V1.29-D01](../versions/v1.29/decisions.md#v1-29-d01)、[V1.29-D02](../versions/v1.29/decisions.md#v1-29-d02)、[V1.29-D05](../versions/v1.29/decisions.md#v1-29-d05)、[V1.29-D06](../versions/v1.29/decisions.md#v1-29-d06)。

## Runtime execution 与 Security

- 当前规范：[Runtime 基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation)、[Runtime Catalog](../architecture/runtime-catalog-boundaries.md)、[AgentRun Recovery](../architecture/agent-run-recovery.md)、[Planned Shutdown](../architecture/planned-shutdown.md)、[Planned Shutdown v3](../contracts/planned-shutdown-v3.md)、[Camp Published Attachment View](../architecture/camp-published-attachment-view.md)、[Windows Platform](../architecture/windows-desktop-platform.md)、[ACP Client Terminal v2](../contracts/acp-client-terminal-v2.md)、[Runtime Launch and Verification v28](../contracts/runtime-launch-and-verification-v28.md)、[Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)和[Managed Runtime Process v1](../contracts/managed-runtime-process-v1.md)。
- 当前 Cursor identity、同名 `agent` 碰撞与未准入策略的理由：[V1.26-D01](../versions/v1.26/decisions.md#v1-26-d01)。
- 当前 Kimi provider 凭据隔离理由：[V1.27-D01](../versions/v1.27/decisions.md#v1-27-d01)；Built-in fixture 修正与 macOS arm64 准入理由：[V1.27-D03](../versions/v1.27/decisions.md#v1-27-d03)；warm Host、External MCP 与 async catalog 边界理由：[V1.27-D04](../versions/v1.27/decisions.md#v1-27-d04)；Kimi 原生完成帧的初始 idle ACP 准入理由：[V1.27-D05](../versions/v1.27/decisions.md#v1-27-d05)；正式 AgentRun 继承用户原生 Home、Probe 独立隔离的理由：[V1.27-D06](../versions/v1.27/decisions.md#v1-27-d06)；Active Prompt lifecycle correlation 与 blocked 保留 pending 的当前理由：[V1.27-D07](../versions/v1.27/decisions.md#v1-27-d07)；macOS x64 独立平台验收后的准入理由：[V1.27-D09](../versions/v1.27/decisions.md#v1-27-d09)；ACP error/activity 输入确认与防重放理由：[V1.27-D10](../versions/v1.27/decisions.md#v1-27-d10)；AgentRun 审计时间与预算时间分域理由：[V1.27-D11](../versions/v1.27/decisions.md#v1-27-d11)；Runtime-specific ACP Client Terminal policy 与通用本地 Bridge 的理由：[V1.27-D12](../versions/v1.27/decisions.md#v1-27-d12)。
- 当前 Grok 官方 config/Home/auth 边界理由：[V1.28-D01](../versions/v1.28/decisions.md#v1-28-d01)；Kimi/Grok generic ACP agent-text 与逐平台准入理由：[V1.28-D02](../versions/v1.28/decisions.md#v1-28-d02)；External MCP 私有 Plugin 追加理由：[V1.28-D03](../versions/v1.28/decisions.md#v1-28-d03)；历史 load-only 取舍：[V1.28-D04](../versions/v1.28/decisions.md#v1-28-d04)；Grok native rules 与 structured compaction redelivery 理由：[V1.28-D05](../versions/v1.28/decisions.md#v1-28-d05)；`>= 1.0.0` 与标准 ACP resume clean break 理由：[V1.28-D06](../versions/v1.28/decisions.md#v1-28-d06)。
- 当前 macOS Runtime Files 稳定卷 identity 与 schema-1 私有根 rekey 理由：[V1.28-D07](../versions/v1.28/decisions.md#v1-28-d07)。
- 当前 Published Attachment View startup rebuild failure 的 Camp-local fail-closed 边界理由：[V1.28-D08](../versions/v1.28/decisions.md#v1-28-d08)。
- 当前零附件 Camp 的空集 controlled rebuild completion 与 root receipt 更新理由：[V1.28-D09](../versions/v1.28/decisions.md#v1-28-d09)。
- 当前已成功发布附件的当前可读性局部降级、Camp 继续运行与自动恢复理由：[V1.28-D10](../versions/v1.28/decisions.md#v1-28-d10)。
- 当前 Windows Runtime PATH hydration、entrypoint closed set 与 command-shim identity 理由：[V1.28-D11](../versions/v1.28/decisions.md#v1-28-d11)。
- 当前 ACP Client FS/Terminal 无第二层文件或 Shell 授权、无 execution-root containment，以及自动模式
  permission compatibility allow 的理由：[V1.29-D11](../versions/v1.29/decisions.md#v1-29-d11)。
- 当前退出即取消全部 AgentRun、关闭准入后快速结算与 400ms 冷启动反馈理由：[V1.29-D07](../versions/v1.29/decisions.md#v1-29-d07)。
- 理由来源：[v0.16](../versions/v0.16/decisions.md)、[v0.17](../versions/v0.17/decisions.md)、[v0.19](../versions/v0.19/decisions.md)、[v0.20](../versions/v0.20/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.64](../versions/v0.64/decisions.md)、[v0.66](../versions/v0.66/decisions.md)、[v1.01](../versions/v1.01/decisions.md)、[v1.03](../versions/v1.03/decisions.md)、[v1.04](../versions/v1.04/decisions.md)、[v1.05](../versions/v1.05/decisions.md)、[v1.11](../versions/v1.11/decisions.md)、[v1.12](../versions/v1.12/decisions.md)、[v1.13](../versions/v1.13/decisions.md)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)、[V1.15-D06](../versions/v1.15/decisions.md#v1-15-d06)、[V1.17-D02](../versions/v1.17/decisions.md#v1-17-d02)、[V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)、[V1.20-D02](../versions/v1.20/decisions.md#v1-20-d02)、[V1.21-D03](../versions/v1.21/decisions.md#v1-21-d03)、[V1.22-D01](../versions/v1.22/decisions.md#v1-22-d01)、[V1.24-D01](../versions/v1.24/decisions.md#v1-24-d01)。

## Session、Context 与 Bootstrap

- 当前规范：[Context 基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap)、[Native Session Bootstrap Redelivery](../architecture/native-session-bootstrap-redelivery.md)、[Structured Skill Links](../architecture/structured-current-input-skill-links.md)、[ContextManifest Evidence v22](../contracts/context-manifest-evidence-v22.md)、[Context Delivery Profile v4](../contracts/context-delivery-profile-v4.md)、[Run Facts v2](../contracts/run-facts-v2.md)和[Current Input Skill Links v1](../contracts/current-input-skill-links-v1.md)。
- 理由来源：[v0.21](../versions/v0.21/decisions.md)、[v0.35](../versions/v0.35/decisions.md)、[v0.44](../versions/v0.44/decisions.md)、[v0.48](../versions/v0.48/decisions.md)、[v0.50](../versions/v0.50/decisions.md)、[v0.52](../versions/v0.52/decisions.md)、[v0.54](../versions/v0.54/decisions.md)、[v0.89](../versions/v0.89/decisions.md)、[v0.90](../versions/v0.90/decisions.md)、[v0.94](../versions/v0.94/decisions.md)、[v0.98](../versions/v0.98/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[V1.15-D03](../versions/v1.15/decisions.md#v1-15-d03)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)、[V1.15-D06](../versions/v1.15/decisions.md#v1-15-d06)、[V1.28-D05](../versions/v1.28/decisions.md#v1-28-d05)。

## Memory

- 当前规范：[Memory 基础不变量](../architecture/foundational-invariants.md#memory-lifecycle)、[Online Memory Capture](../architecture/online-memory-capture.md)、[Memory Capture v3](../contracts/memory-capture-v3.md)。
- 理由来源：[v0.10](../versions/v0.10/decisions.md)、[v0.21](../versions/v0.21/decisions.md)、[v0.73](../versions/v0.73/decisions.md)、[v0.78](../versions/v0.78/decisions.md)。

## Skills、MCP 与 Built-ins

- 当前规范：[Skill/MCP 基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport)、[Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)、[Skill Projection](../architecture/skill-projection-reconciliation.md)、[Built-in Tool Transport v21](../contracts/builtin-tool-transport-v21.md)、[Windows Skill Projection v1](../contracts/windows-skill-projection-v1.md)。
- 理由来源：[v0.06](../versions/v0.06/decisions.md)、[v0.09](../versions/v0.09/decisions.md)、[v0.31](../versions/v0.31/decisions.md)、[v0.37](../versions/v0.37/decisions.md)、[v0.42](../versions/v0.42/decisions.md)、[v0.43](../versions/v0.43/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.67](../versions/v0.67/decisions.md)、[v0.82](../versions/v0.82/decisions.md)、[v0.85](../versions/v0.85/decisions.md)、[v0.91](../versions/v0.91/decisions.md)、[v0.92](../versions/v0.92/decisions.md)、[v0.93](../versions/v0.93/decisions.md)、[v1.05](../versions/v1.05/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[v1.14](../versions/v1.14/decisions.md)、[V1.17-D02](../versions/v1.17/decisions.md#v1-17-d02)、[V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)、[V1.19-D02](../versions/v1.19/decisions.md#v1-19-d02)、[V1.21-D01](../versions/v1.21/decisions.md#v1-21-d01)、[V1.27-D04](../versions/v1.27/decisions.md#v1-27-d04)、[V1.28-D03](../versions/v1.28/decisions.md#v1-28-d03)。

## User Automation 与 Diagnostic Trial

- 当前规范：[User Automation 不变量](../architecture/foundational-invariants.md#user-automation-trial)、[User Automation Architecture](../architecture/user-automation.md)和[User Automation v1](../contracts/user-automation-v1.md)。
- 理由来源：[V1.21-D01](../versions/v1.21/decisions.md#v1-21-d01)、[V1.21-D02](../versions/v1.21/decisions.md#v1-21-d02)、[V1.21-D03](../versions/v1.21/decisions.md#v1-21-d03)、[V1.21-D04](../versions/v1.21/decisions.md#v1-21-d04)。

## Evidence、Runtime Activity 与 Usage

- 当前规范：[Evidence/Activity 基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity)、[Runtime File Change Observation](../architecture/runtime-file-change-observation.md)、[Runtime File Change Observation v2](../contracts/runtime-file-change-observation-v2.md)、[Run Process Detail Surface v26](../contracts/run-process-detail-surface-v26.md)、[Runtime Monitoring](../architecture/runtime-monitoring.md)、[Runtime Usage Monitoring v3](../contracts/runtime-usage-monitoring-v3.md)、[Runtime Activity Registry](../runtime-activity/registry.md)。
- 理由来源：[v0.17](../versions/v0.17/decisions.md)、[v0.41](../versions/v0.41/decisions.md)、[v0.96](../versions/v0.96/decisions.md)、[v0.99](../versions/v0.99/decisions.md)、[V1.28-D12](../versions/v1.28/decisions.md#v1-28-d12)、[V1.29-D08](../versions/v1.29/decisions.md#v1-29-d08)、[V1.29-D09](../versions/v1.29/decisions.md#v1-29-d09)、[V1.29-D14](../versions/v1.29/decisions.md#v1-29-d14)。

## Qualification 与 Benchmark

- 当前规范：[Qualification/Benchmark 基础不变量](../architecture/foundational-invariants.md#qualification-evidence)、[Benchmark Protocol](../architecture/benchmark-protocol.md)、[Benchmark Protocol v3](../contracts/benchmark-protocol-v3.md)、[Semantic Judge Views v1](../contracts/semantic-judge-views-v1.md)、[Tool Interaction Measurement v2](../contracts/tool-interaction-measurement-v2.md)、[Paired Collaboration Experiment v1](../contracts/paired-collaboration-experiment-v1.md)。
- 理由来源：[v0.31](../versions/v0.31/decisions.md)、[v0.34](../versions/v0.34/decisions.md)、[v0.36](../versions/v0.36/decisions.md)、[v0.53](../versions/v0.53/decisions.md)、[v0.55](../versions/v0.55/decisions.md)、[v0.68](../versions/v0.68/decisions.md)。

## Product 与 Renderer

- 当前规范：[产品/Renderer 基础不变量](../architecture/foundational-invariants.md#product-execution-surface)、[Availability-first Runtime](../architecture/availability-first-runtime.md)、[Bootstrap Shell](../ui/components/bootstrap-shell.md)、[Desktop Navigation Refresh](../architecture/desktop-navigation-refresh.md)、[UI 规范](../ui/README.md)、[Camp 会话工作区](../ui/components/conversation-workspace.md)、[Run Process Detail Surface v26](../contracts/run-process-detail-surface-v26.md)、[Desktop App Updates](../architecture/desktop-app-updates.md)和[App Update v1](../contracts/app-update-v1.md)。
- 理由来源：[v0.11](../versions/v0.11/decisions.md)、[v0.24](../versions/v0.24/decisions.md)、[v0.55](../versions/v0.55/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.84](../versions/v0.84/decisions.md)、[v1.12](../versions/v1.12/decisions.md)、[v1.13](../versions/v1.13/decisions.md)、[V1.15-D01](../versions/v1.15/decisions.md#v1-15-d01)、[V1.15-D02](../versions/v1.15/decisions.md#v1-15-d02)、[V1.15-D05](../versions/v1.15/decisions.md#v1-15-d05)、[V1.18-D01](../versions/v1.18/decisions.md#v1-18-d01)、[V1.20-D02](../versions/v1.20/decisions.md#v1-20-d02)、[V1.28-D12](../versions/v1.28/decisions.md#v1-28-d12)、[V1.28-D13](../versions/v1.28/decisions.md#v1-28-d13)、[V1.29-D10](../versions/v1.29/decisions.md#v1-29-d10)、[V1.29-D12](../versions/v1.29/decisions.md#v1-29-d12)、[V1.29-D14](../versions/v1.29/decisions.md#v1-29-d14)、[V1.31-D01](../versions/v1.31/decisions.md#v1-31-d01)、[V1.31-D04](../versions/v1.31/decisions.md#v1-31-d04)。

## 文档治理

- 当前规范：[版本决策治理](README.md)、[文档导航](../README.md)、[版本生命周期](../versions/README.md)。
- 当前决定：[V1.11-D01：当前权威收敛与数字 ADR clean break](../versions/v1.11/decisions.md#v1-11-d01)、[V1.11-D02：局部替代归一与一次性迁移条款退役](../versions/v1.11/decisions.md#v1-11-d02)。

## 外部附件 CLI 入口

- 当前规范：[Camp Attachment v7](../contracts/camp-attachment-v7.md)、[Camp Message Send v14](../contracts/camp-message-send-v14.md)、[Built-in Tool Transport v21](../contracts/builtin-tool-transport-v21.md)及[附件架构](../architecture/camp-published-attachment-view.md)。
- 主要理由：[V1.32-D01](../versions/v1.32/decisions.md#v1-32-d01)：由 CLI 以 Runtime 权限适配外部路径，保持 Core 的读取根目录限制。
