---
document_type: current-decision-navigation
authority: current-authority-and-rationale-routing
last_updated: 2026-09-25
---

# 当前规范与决定理由导航

结果 Judge 来源材料当前规范：[Semantic Judge Views v12](../contracts/semantic-judge-views-v12.md)；理由：[V1.58-D02](../versions/v1.58/decisions.md#v1-58-d02)、[V1.58-D03](../versions/v1.58/decisions.md#v1-58-d03)、[V1.58-D04](../versions/v1.58/decisions.md#v1-58-d04)。

本页先连接当前规范，再连接形成这些边界的重要理由。历史版本决定不证明代码已经实现；实现状态仍需检查代码、Migration、测试和当前版本验收。

完整规范内核迁移对应关系见[当前决策权威覆盖](AUTHORITY-COVERAGE.md)，旧数字 ID 查找见[迁移映射](LEGACY-MAP.md)。

## Public Camp 消息与多输入 AgentRun

- 当前主链：[Public Camp Message/Delivery 架构](../architecture/public-a2a-message-delivery.md)、
  [Message Delivery v10](../contracts/message-delivery-v10.md)、[Camp Message Send v23](../contracts/camp-message-send-v23.md)；
  Delivery-first 与 CampTurn/Gather clean break 理由：[V1.60-D01](../versions/v1.60/decisions.md#v1-60-d01)、
  [V1.60-D02](../versions/v1.60/decisions.md#v1-60-d02)；单一事件唤醒 claim owner 与固定全局兜底理由：
  [V1.60-D06](../versions/v1.60/decisions.md#v1-60-d06)。Camp Read 直接请求合同与旧模式 clean break 理由：
  [V1.60-D07](../versions/v1.60/decisions.md#v1-60-d07)；首次目标路由与存量 waiting 自愈理由：
  [V1.60-D11](../versions/v1.60/decisions.md#v1-60-d11)。默认路由在 Agent 自动上下文中显式呈现冻结接收者、
  同时保持用户原文与路由权威分离的理由：[V1.61-D03](../versions/v1.61/decisions.md#v1-61-d03)。
- 撤回与 Desktop-local Composer：[Camp Composer Draft v15](../contracts/camp-composer-draft-v15.md)、
  [Camp History v10](../contracts/camp-history-v10.md)；理由：[V1.69-D01](../versions/v1.69/decisions.md#v1-69-d01)、[V1.60-D03](../versions/v1.60/decisions.md#v1-60-d03)、
  [V1.60-D08](../versions/v1.60/decisions.md#v1-60-d08)、
  [V1.60-D10](../versions/v1.60/decisions.md#v1-60-d10)。
- 多输入 Context 与完整运输：[ContextManifest v30](../contracts/context-manifest-evidence-v30.md)、
  [Profile 10](../contracts/context-delivery-profile-v10.md)、[Run Facts v7](../contracts/run-facts-v7.md)、
  [Built-in Transport v32](../contracts/builtin-tool-transport-v32.md)；理由：
  [V1.60-D04](../versions/v1.60/decisions.md#v1-60-d04) 与
  [V1.68-D01](../versions/v1.68/decisions.md#v1-68-d01)。
- Channel/Automation 复用普通消息：[Channel Message Bridge v1](../contracts/channel-message-bridge-v1.md)、
  [Scheduled Automation v3](../contracts/scheduled-automation-v3.md)；理由：
  [V1.60-D05](../versions/v1.60/decisions.md#v1-60-d05)。
- Delivery-first 终态注意力：[Notification Episode v9](../contracts/notification-episode-v9.md)、
  [Current User Attention v8](../contracts/current-user-attention-v8.md)；理由：
  [V1.60-D09](../versions/v1.60/decisions.md#v1-60-d09)、[V1.71-D01](../versions/v1.71/decisions.md#v1-71-d01)。

## Linux Server 发布基线

- 当前规范：[统一 Host](../architecture/unified-rust-host.md#命令事件与兼容性)、[Runtime Platform Admission v2](../contracts/runtime-platform-admission-v2.md)、[Server 验收](../development/server-preview.md#linux-的两个验收-gate)。
- 理由来源：[V1.59-D06](../versions/v1.59/decisions.md#v1-59-d06)。

## Core data 与 Read Side

- 命令结果单份正文与事件双读：[Domain Command Result v1](../contracts/domain-command-result-v1.md)、
  [命令/Read Side 不变量](../architecture/foundational-invariants.md#core-command-transaction)与
  [schema 95 原位升级](../architecture/availability-first-runtime.md#migration-switch)；理由：
  [V1.53-D06](../versions/v1.53/decisions.md#v1-53-d06)。

- 工具分类与图片迁移汇合：[原位升级](../architecture/availability-first-runtime.md#migration-switch)、[Runtime File Change Observation v3](../contracts/runtime-file-change-observation-v3.md#canonical-与读取兼容)；理由：[V1.53-D03](../versions/v1.53/decisions.md#v1-53-d03)。

- Execution Evidence 生命周期、独立变更水位、私有思考边界与普通输出预算当前规范：[Run Process Detail Surface v42](../contracts/run-process-detail-surface-v42.md)、[Camp Open Projection v24](../contracts/camp-open-projection-v24.md)、[Single Chat v8](../contracts/single-chat-v8.md)与[Evidence 不变量](../architecture/foundational-invariants.md#evidence-usage)；统一记录与变更游标理由：[V1.64-D01](../versions/v1.64/decisions.md#v1-64-d01)，分离内容引用和定向回收理由：[V1.64-D02](../versions/v1.64/decisions.md#v1-64-d02)，永久有界输出理由：[V1.66-D01](../versions/v1.66/decisions.md#v1-66-d01)。历史正文块选择见 [V1.53-D02](../versions/v1.53/decisions.md#v1-53-d02)，既有维护降频见 [V1.62-D05](../versions/v1.62/decisions.md#v1-62-d05)。

- Camp 队员 Fast 当前规范：[Camp Member Fast v1](../contracts/camp-member-fast-v1.md)、[Runtime 边界](../architecture/runtime-catalog-boundaries.md#camp-队员-fast-边界)、[Usage v4](../contracts/runtime-usage-monitoring-v4.md)；理由：[V1.34-D01](../versions/v1.34/decisions.md#v1-34-d01)。

- 启动分层补充规范：[可选功能门禁](../contracts/desktop-runtime-availability-v2.md#7-authority-ready-and-optional-subsystem-gates)、[Windows Bootstrap assessment](../contracts/desktop-runtime-availability-v2.md#8-windows-pre-ready-bootstrap-assessment)；理由：[V1.31-D05](../versions/v1.31/decisions.md#v1-31-d05)、[V1.31-D06](../versions/v1.31/decisions.md#v1-31-d06)。
- 渠道/main 数据迁移汇合：[Channel/Main Schema Join v2](../contracts/channel-main-schema-join-v2.md)、[原位升级与旧 switch 恢复](../architecture/availability-first-runtime.md#migration-switch)；理由：[V1.36-D06](../versions/v1.36/decisions.md#v1-36-d06)、[V1.36-D07](../versions/v1.36/decisions.md#v1-36-d07)。
- 普通升级去整库复制、逐事务恢复与启动重试：[Desktop Runtime Availability v2](../contracts/desktop-runtime-availability-v2.md#4-migration-and-recovery)；理由：[V1.36-D07](../versions/v1.36/decisions.md#v1-36-d07)。

- 当前规范：[Desktop 可用性与权威准入](../architecture/foundational-invariants.md#desktop-authority-admission)、[Availability-first Runtime](../architecture/availability-first-runtime.md)、[Desktop Runtime Availability v2](../contracts/desktop-runtime-availability-v2.md)、[基础 Core 不变量](../architecture/foundational-invariants.md#core-command-transaction)、[通知架构](../architecture/notification-episodes.md)、[Notification Episode v9](../contracts/notification-episode-v9.md)。
- 理由来源：[v0.02](../versions/v0.02/decisions.md)、[v0.06](../versions/v0.06/decisions.md)、[v0.28](../versions/v0.28/decisions.md)、[v0.71](../versions/v0.71/decisions.md)、[V1.31-D01](../versions/v1.31/decisions.md#v1-31-d01)、[V1.31-D02](../versions/v1.31/decisions.md#v1-31-d02)、[V1.31-D03](../versions/v1.31/decisions.md#v1-31-d03)。

## Camp、Workspace 与 Attachments

- Runtime 图片当前规范：[Runtime 图片架构](../architecture/runtime-images.md)、[Runtime Images v5](../contracts/runtime-images-v5.md)、[Camp Open Projection v24](../contracts/camp-open-projection-v24.md)、[统一图片展示](../ui/components/conversation-workspace.md#runtime-图片与消息图片)；原生生图闭合集与历史 fail-closed 理由：[V1.53-D01](../versions/v1.53/decisions.md#v1-53-d01)，混合生命周期与不自动发布的理由：[V1.37-D01](../versions/v1.37/decisions.md#v1-37-d01)。

- 当前规范：[Camp/Composer 基础不变量](../architecture/foundational-invariants.md#camp-lifecycle)、[Camp Identity](../architecture/camp-identity.md)、[Camp Identity v1](../contracts/camp-identity-v1.md)、[动态 Camp 队员关系](../architecture/dynamic-camp-membership.md)、[Camp Membership v2](../contracts/camp-membership-v2.md)、[Camp Activation](../architecture/camp-activation-lifecycle.md)、[Pending Camp Activation v2](../contracts/pending-camp-activation-v2.md)、[Public Camp Composer](../architecture/camp-composer-draft.md)、[Camp Composer Draft v15](../contracts/camp-composer-draft-v15.md)、[结构化 Mention 与 Atom](../ui/components/structured-mentions.md)、[Camp Open](../architecture/camp-open-read-path.md)、[Camp Open Projection v24](../contracts/camp-open-projection-v24.md)、[Camp Attachments](../architecture/camp-published-attachment-view.md)、[Camp Attachment v10](../contracts/camp-attachment-v10.md)、[Camp Published Attachment View v4（legacy v1）](../contracts/camp-published-attachment-view-v4.md)、[Camp 永久删除](../architecture/camp-deletion.md)、[Camp Permanent Deletion v4](../contracts/camp-permanent-deletion-v4.md)、[Runtime File Change Observation](../architecture/runtime-file-change-observation.md)、[Runtime File Change Observation v6](../contracts/runtime-file-change-observation-v6.md)、[First-run](../architecture/first-run-onboarding.md)及[First-run Onboarding v5](../contracts/first-run-onboarding-v5.md)。Files Changed 来源水位与重算理由见 [V1.64-D03](../versions/v1.64/decisions.md#v1-64-d03)。
- 理由来源：[v0.22](../versions/v0.22/decisions.md)、[v0.23](../versions/v0.23/decisions.md)、[v0.25](../versions/v0.25/decisions.md)、[v0.43](../versions/v0.43/decisions.md)、[v0.77](../versions/v0.77/decisions.md)、[v0.80](../versions/v0.80/decisions.md)、[v0.97](../versions/v0.97/decisions.md)、[v1.00](../versions/v1.00/decisions.md)、[v1.10](../versions/v1.10/decisions.md)、[V1.15-D01](../versions/v1.15/decisions.md#v1-15-d01)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)、[V1.15-D06](../versions/v1.15/decisions.md#v1-15-d06)、[V1.16-D01](../versions/v1.16/decisions.md#v1-16-d01)、[V1.17-D01](../versions/v1.17/decisions.md#v1-17-d01)、[V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)、[V1.19-D02](../versions/v1.19/decisions.md#v1-19-d02)、[V1.20-D01](../versions/v1.20/decisions.md#v1-20-d01)、[V1.27-D08](../versions/v1.27/decisions.md#v1-27-d08)、[V1.28-D10](../versions/v1.28/decisions.md#v1-28-d10)、[V1.29-D01](../versions/v1.29/decisions.md#v1-29-d01)、[V1.29-D04](../versions/v1.29/decisions.md#v1-29-d04)、[V1.29-D06](../versions/v1.29/decisions.md#v1-29-d06)、[V1.29-D08](../versions/v1.29/decisions.md#v1-29-d08)、[V1.29-D09](../versions/v1.29/decisions.md#v1-29-d09)、[V1.31-D04](../versions/v1.31/decisions.md#v1-31-d04)、[V1.40-D01](../versions/v1.40/decisions.md#v1-40-d01)、[V1.43-D01](../versions/v1.43/decisions.md#v1-43-d01)、[V1.43-D02](../versions/v1.43/decisions.md#v1-43-d02)、[V1.58-D06](../versions/v1.58/decisions.md#v1-58-d06)、[V1.65-D01](../versions/v1.65/decisions.md#v1-65-d01)及[V1.65-D02](../versions/v1.65/decisions.md#v1-65-d02)。

## Camp 文件预览

- 当前规范：[File Preview Architecture](../architecture/file-preview.md)、[File Preview v20](../contracts/file-preview-v20.md)、[Camp 文件预览区](../ui/components/file-preview.md)及[Camp 会话工作区](../ui/components/conversation-workspace.md)；版本化 projection 原位刷新与旧响应 fence 理由见 [V1.64-D03](../versions/v1.64/decisions.md#v1-64-d03)。
- 窗口保留与刷新取舍：[V1.59-D07](../versions/v1.59/decisions.md#v1-59-d07)。
- HTML 运行环境理由：[V1.58-D07](../versions/v1.58/decisions.md#v1-58-d07)。
- 理由来源：[V1.30-D01–D06](../versions/v1.30/decisions.md#v1-30-d01)、[V1.37-D04](../versions/v1.37/decisions.md#v1-37-d04)、[V1.40-D01](../versions/v1.40/decisions.md#v1-40-d01)、[V1.42-D01](../versions/v1.42/decisions.md#v1-42-d01)、[V1.51-D01](../versions/v1.51/decisions.md#v1-51-d01)、[V1.51-D02](../versions/v1.51/decisions.md#v1-51-d02)、[V1.52-D01](../versions/v1.52/decisions.md#v1-52-d01)及[V1.55-D01](../versions/v1.55/decisions.md#v1-55-d01)；[V1.30-D07](../versions/v1.30/decisions.md#v1-30-d07) 的选区方案与 [V1.39-D05](../versions/v1.39/decisions.md#v1-39-d05) 的 inline-code 存在性探测已被替代。

## Channels 与 External Principals

- 内部调度合同：[Channel Host Maintenance v5](../contracts/channel-host-maintenance-v5.md)；Core 领域表拥有 outstanding 真源，Main 使用事件快路径与仅在有工作时存在的十分钟恢复 watchdog；飞书快路径只跟随当前执行卡 Run，启动恢复不先扫描历史群，真实业务命令与 Outbox 恢复不变。按需调度选择理由见 [V1.37-D07](../versions/v1.37/decisions.md#v1-37-d07)。
- 当前规范：[Channel Message Bridge v1](../contracts/channel-message-bridge-v1.md)、[Channel Storage v3](../contracts/channel-storage-v3.md)、[飞书渠道架构](../architecture/feishu-channel.md)、[Feishu Channel v17](../contracts/feishu-channel-v17.md)、[Lark 渠道架构](../architecture/lark-channel.md)、[Lark Channel v1](../contracts/lark-channel-v1.md)、[钉钉渠道架构](../architecture/dingtalk-channel.md)、[DingTalk Channel v13](../contracts/dingtalk-channel-v13.md)、[Camp Membership v2](../contracts/camp-membership-v2.md)、[ContextManifest Evidence v30](../contracts/context-manifest-evidence-v30.md)和[渠道设置](../ui/components/channel-settings.md)。
- 飞书理由来源：[V1.35-D01（已由 D09 取代）](../versions/v1.35/decisions.md#v1-35-d01)、[V1.35-D02](../versions/v1.35/decisions.md#v1-35-d02)、[V1.35-D03（Topic root structural-parent 部分已由 V1.37-D06 取代）](../versions/v1.35/decisions.md#v1-35-d03)、[V1.35-D04（话题扩张部分已由 D15 取代）](../versions/v1.35/decisions.md#v1-35-d04)、[V1.35-D05](../versions/v1.35/decisions.md#v1-35-d05)、[V1.35-D06](../versions/v1.35/decisions.md#v1-35-d06)、[V1.35-D07](../versions/v1.35/decisions.md#v1-35-d07)、[V1.35-D08](../versions/v1.35/decisions.md#v1-35-d08)、[V1.35-D09（私聊投递部分已由 D12 取代）](../versions/v1.35/decisions.md#v1-35-d09)、[V1.35-D10](../versions/v1.35/decisions.md#v1-35-d10)、[V1.35-D11](../versions/v1.35/decisions.md#v1-35-d11)、[V1.35-D12](../versions/v1.35/decisions.md#v1-35-d12)、[V1.35-D13（终态展示与 view state 已由 D16 取代）](../versions/v1.35/decisions.md#v1-35-d13)、[V1.35-D14（命令展示与 callback 已由 D16 取代）](../versions/v1.35/decisions.md#v1-35-d14)、[V1.35-D15](../versions/v1.35/decisions.md#v1-35-d15)、[V1.35-D16（执行卡正文/分页已由 V1.37-D05 取代）](../versions/v1.35/decisions.md#v1-35-d16)、[V1.37-D05](../versions/v1.37/decisions.md#v1-37-d05)、[V1.37-D06](../versions/v1.37/decisions.md#v1-37-d06)、[V1.37-D08](../versions/v1.37/decisions.md#v1-37-d08)及[V1.37-D10](../versions/v1.37/decisions.md#v1-37-d10)。
- 钉钉与共享渠道存储理由来源：[V1.36-D01（存储由 D04、OAuth 控制面由 D05 取代）](../versions/v1.36/decisions.md#v1-36-d01)、[V1.36-D02](../versions/v1.36/decisions.md#v1-36-d02)、[V1.36-D03](../versions/v1.36/decisions.md#v1-36-d03)、[V1.36-D04](../versions/v1.36/decisions.md#v1-36-d04)、[V1.36-D05](../versions/v1.36/decisions.md#v1-36-d05)、[V1.37-D09](../versions/v1.37/decisions.md#v1-37-d09)、[V1.37-D10](../versions/v1.37/decisions.md#v1-37-d10)、[V1.37-D11（群目标 ID 相等假设已由 D12 取代）](../versions/v1.37/decisions.md#v1-37-d11)、[V1.37-D12](../versions/v1.37/decisions.md#v1-37-d12)、[V1.37-D13](../versions/v1.37/decisions.md#v1-37-d13)、[V1.37-D14](../versions/v1.37/decisions.md#v1-37-d14)、[V1.37-D15](../versions/v1.37/decisions.md#v1-37-d15)、[V1.38-D01](../versions/v1.38/decisions.md#v1-38-d01)和[V1.38-D02](../versions/v1.38/decisions.md#v1-38-d02)。
- Lark 独立 provider、克隆表族、参数化飞书实现与按请求名推导 Host actor 的理由：[V1.72-D01](../versions/v1.72/decisions.md#v1-72-d01)。

## Member identity

- 当前规范：[成员身份与生命周期](../architecture/foundational-invariants.md#member-identity)、[动态 Camp 队员关系](../architecture/dynamic-camp-membership.md)、[Camp Membership v2](../contracts/camp-membership-v2.md)、[Collaboration State v3](../contracts/collaboration-state-v3.md)、[`CONTEXT.md`](../../CONTEXT.md)。
- 理由来源：[v0.14](../versions/v0.14/decisions.md)、[v0.15](../versions/v0.15/decisions.md)、[v0.16](../versions/v0.16/decisions.md)、[v0.27](../versions/v0.27/decisions.md)、[v0.50](../versions/v0.50/decisions.md)、[V1.29-D02](../versions/v1.29/decisions.md#v1-29-d02)、[V1.29-D03](../versions/v1.29/decisions.md#v1-29-d03)。

## Collaboration、Task 与 Message Delivery

- 当前规范：[协作与消息基础不变量](../architecture/foundational-invariants.md#collaboration-admission)、[动态 Camp 队员关系](../architecture/dynamic-camp-membership.md)、[Public Camp Message/Delivery](../architecture/public-a2a-message-delivery.md)、[Durable Task v5](../contracts/durable-task-v5.md)、[Camp Message Send v23](../contracts/camp-message-send-v23.md)、[Message Delivery v10](../contracts/message-delivery-v10.md)和[Camp History v10](../contracts/camp-history-v10.md)。主动查询与撤回边界理由见 [V1.69-D01](../versions/v1.69/decisions.md#v1-69-d01)；Task 去版本化与模型投影清理理由见 [V1.67-D01](../versions/v1.67/decisions.md#v1-67-d01)；正文收敛理由见 [V1.63-D01](../versions/v1.63/decisions.md#v1-63-d01)，协议 clean break 见 [V1.63-D02](../versions/v1.63/decisions.md#v1-63-d02)。Gather 只保留[历史解释](../architecture/durable-gather-barrier.md)。
- 理由来源：[v0.15](../versions/v0.15/decisions.md)、[v0.45](../versions/v0.45/decisions.md)、[v0.47](../versions/v0.47/decisions.md)、[v0.54](../versions/v0.54/decisions.md)、[v0.59](../versions/v0.59/decisions.md)、[v0.62](../versions/v0.62/decisions.md)、[v0.67](../versions/v0.67/decisions.md)、[v0.89](../versions/v0.89/decisions.md)、[v0.90](../versions/v0.90/decisions.md)、[v1.06](../versions/v1.06/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[v1.14](../versions/v1.14/decisions.md)、[V1.19-D02](../versions/v1.19/decisions.md#v1-19-d02)、[V1.29-D01](../versions/v1.29/decisions.md#v1-29-d01)、[V1.29-D02](../versions/v1.29/decisions.md#v1-29-d02)、[V1.29-D05](../versions/v1.29/decisions.md#v1-29-d05)、[V1.29-D06](../versions/v1.29/decisions.md#v1-29-d06)及[V1.37-D03](../versions/v1.37/decisions.md#v1-37-d03)。

## Mission

- 当前规范：[Mission 架构](../architecture/missions.md)、[Mission v11](../contracts/mission-v11.md)、[使命板 UI](../ui/components/mission-board.md)、[ContextManifest v30](../contracts/context-manifest-evidence-v30.md)及 [`CONTEXT.md`](../../CONTEXT.md)。
- 复用 Camp、preparing 才创建持久工作区、固定基准与无模型业务版本的理由：[V1.59-D11](../versions/v1.59/decisions.md#v1-59-d11)；稳定公开编号、无历史正文与 accepted 投递水位的理由：[V1.59-D12](../versions/v1.59/decisions.md#v1-59-d12)；附件原路径读取的初始理由：[V1.59-D13](../versions/v1.59/decisions.md#v1-59-d13)；删除默认保留与最小双检查点的原始理由：[V1.59-D14](../versions/v1.59/decisions.md#v1-59-d14)；内部 ID 贯通 Agent/模型、UI 展示编号、全局发现和当前 Mission 写入边界的理由：[V1.61-D01](../versions/v1.61/decisions.md#v1-61-d01)；状态操作与消息发布解耦的当前理由：[V1.62-D01](../versions/v1.62/decisions.md#v1-62-d01)；持久清理意图、后台执行与先删使命的当前理由：[V1.62-D02](../versions/v1.62/decisions.md#v1-62-d02)；状态列独立纵向滚动与拖拽边缘滚动的理由：[V1.62-D03](../versions/v1.62/decisions.md#v1-62-d03)；受管分支与实时 checkout 分离、分支不作为执行门禁的理由：[V1.62-D04](../versions/v1.62/decisions.md#v1-62-d04)。

## Single Chat

- 当前规范：[Single Chat Architecture](../architecture/single-chat.md)、[Single Chat v8](../contracts/single-chat-v8.md)、[AgentRun Recovery](../architecture/agent-run-recovery.md)和[Camp 内单聊 UI](../ui/components/conversation-workspace.md#camp-内单聊)。
- 复用现有执行体系、固定私有路由与封闭 Built-in policy 的理由：[V1.50-D01](../versions/v1.50/decisions.md#v1-50-d01)。
- 重启取消当前回复、显式结束和无 successor cleanup fence 的理由：[V1.50-D02](../versions/v1.50/decisions.md#v1-50-d02)。
- 复用公共弱持久 Source Ref、不维护 Single Chat 附件内容仓库的理由：[V1.50-D03](../versions/v1.50/decisions.md#v1-50-d03)；Run 前宿主重检后原路径投影的当前理由：[V1.58-D06](../versions/v1.58/decisions.md#v1-58-d06)。
- 运行中输入进入 Conversation-local FIFO、失效队首阻塞并可修复的理由：[V1.50-D04](../versions/v1.50/decisions.md#v1-50-d04)。
- policy version 2 只增加 Mission 全局读取并冻结 version 1 历史 allowlist 的理由：[V1.61-D02](../versions/v1.61/decisions.md#v1-61-d02)。

## Runtime execution 与 Security

- 当前规范：[Runtime 基础不变量](../architecture/foundational-invariants.md#runtime-catalog-installation)、[Runtime Catalog](../architecture/runtime-catalog-boundaries.md)、[AgentRun Recovery](../architecture/agent-run-recovery.md)、[Network Interruption Recovery v2](../contracts/network-interruption-recovery-v2.md)、[Planned Shutdown](../architecture/planned-shutdown.md)、[Planned Shutdown v8](../contracts/planned-shutdown-v8.md)、[Camp Published Attachment View](../architecture/camp-published-attachment-view.md)、[Windows Platform](../architecture/windows-desktop-platform.md)、[ACP Client Terminal v3](../contracts/acp-client-terminal-v3.md)、[Runtime Launch and Verification v43](../contracts/runtime-launch-and-verification-v43.md)、[Runtime Platform Admission v2](../contracts/runtime-platform-admission-v2.md)和[Managed Runtime Process v2](../contracts/managed-runtime-process-v2.md)。
- 同一 Core generation 内采用固定退避、只有明确未接收的 ACP 输入才由 Rovai 接管，并让 native retry 与 Rovai 保持单一 owner 的理由：[V1.53-D04](../versions/v1.53/decisions.md#v1-53-d04)。
- Runtime 安装缺失只进入 Availability、optional subsystem 只覆盖 Adapter 自有初始化的当前边界与理由：
  [V1.53-D07](../versions/v1.53/decisions.md#v1-53-d07)。
- 当前 Cursor identity、同名 `agent` 碰撞与未准入策略的理由：[V1.26-D01](../versions/v1.26/decisions.md#v1-26-d01)。
- 当前 Kimi provider 凭据隔离理由：[V1.27-D01](../versions/v1.27/decisions.md#v1-27-d01)；Built-in fixture 修正与 macOS arm64 准入理由：[V1.27-D03](../versions/v1.27/decisions.md#v1-27-d03)；warm Host、External MCP 与 async catalog 边界理由：[V1.27-D04](../versions/v1.27/decisions.md#v1-27-d04)；Kimi 原生完成帧的初始 idle ACP 准入理由：[V1.27-D05](../versions/v1.27/decisions.md#v1-27-d05)；正式 AgentRun 继承用户原生 Home、Probe 独立隔离的理由：[V1.27-D06](../versions/v1.27/decisions.md#v1-27-d06)；Active Prompt lifecycle correlation 与 blocked 保留 pending 的当前理由：[V1.27-D07](../versions/v1.27/decisions.md#v1-27-d07)；macOS x64 独立平台验收后的准入理由：[V1.27-D09](../versions/v1.27/decisions.md#v1-27-d09)；ACP error/activity 输入确认与防重放理由：[V1.27-D10](../versions/v1.27/decisions.md#v1-27-d10)；AgentRun 审计时间与预算时间分域理由：[V1.27-D11](../versions/v1.27/decisions.md#v1-27-d11)；Runtime-specific ACP Client Terminal policy 与通用本地 Bridge 的理由：[V1.27-D12](../versions/v1.27/decisions.md#v1-27-d12)。
- 当前 Grok 官方 config/Home/auth 边界理由：[V1.28-D01](../versions/v1.28/decisions.md#v1-28-d01)；Kimi/Grok generic ACP agent-text 与逐平台准入理由：[V1.28-D02](../versions/v1.28/decisions.md#v1-28-d02)；External MCP 私有 Plugin 追加理由：[V1.28-D03](../versions/v1.28/decisions.md#v1-28-d03)；历史 load-only 取舍：[V1.28-D04](../versions/v1.28/decisions.md#v1-28-d04)；Grok native rules 与 structured compaction redelivery 理由：[V1.28-D05](../versions/v1.28/decisions.md#v1-28-d05)；`>= 1.0.0` 与标准 ACP resume clean break 理由：[V1.28-D06](../versions/v1.28/decisions.md#v1-28-d06)。
- 当前 macOS Runtime Files 稳定卷 identity 与 schema-1 私有根 rekey 理由：[V1.28-D07](../versions/v1.28/decisions.md#v1-28-d07)。
- 当前 Pi 独立 JSONL optional subsystem 与资格分离理由：[V1.39-D01](../versions/v1.39/decisions.md#v1-39-d01)，其中
  “缺安装即 subsystem degraded”的旧后果已由 [V1.53-D07](../versions/v1.53/decisions.md#v1-53-d07)局部替代；
  串行多 Session Resident Host、exact resume 与 locator 隐私理由：[V1.39-D02](../versions/v1.39/decisions.md#v1-39-d02)；历史三平台 Preview 与 disclosure 理由：[V1.39-D06](../versions/v1.39/decisions.md#v1-39-d06)，当前三平台独立 evidence 晋升与移除实验性披露理由：[V1.49-D02](../versions/v1.49/decisions.md#v1-49-d02)；ACP derived child 最终请求上下文解析理由：[V1.39-D08](../versions/v1.39/decisions.md#v1-39-d08)；Pi External MCP Unsupported、Assignment 静默保留与 bridge 删除理由：[V1.39-D09](../versions/v1.39/decisions.md#v1-39-d09)；Pi 原生能力的初始理由：[V1.39-D10](../versions/v1.39/decisions.md#v1-39-d10)。单一原生启动、普通 Prompt、结构化图片与精确 resume 分类理由见 [V1.44-D01](../versions/v1.44/decisions.md#v1-44-d01)；公共 Fleet 锁外并发启动与 Starting fencing 理由见 [V1.44-D02](../versions/v1.44/decisions.md#v1-44-d02)；Fleet-owned Startup/Stop operation 与锁外 reap 理由见 [V1.45-D04](../versions/v1.45/decisions.md#v1-45-d04)。v35 的 Receipt/Approval 条款现为历史；当前 `--approve` project trust、v7 薄扩展、原生 Tool、无 active Receipt 与 `agent_start` admission 理由见 [V1.48-D01](../versions/v1.48/decisions.md#v1-48-d01)。
- 当前 Published Attachment View startup rebuild failure 的 Camp-local fail-closed 边界理由：[V1.28-D08](../versions/v1.28/decisions.md#v1-28-d08)。
- 当前零附件 Camp 的空集 controlled rebuild completion 与 root receipt 更新理由：[V1.28-D09](../versions/v1.28/decisions.md#v1-28-d09)。
- 当前已成功发布附件的当前可读性局部降级、Camp 继续运行与自动恢复理由：[V1.28-D10](../versions/v1.28/decisions.md#v1-28-d10)。
- 当前 Windows Runtime PATH hydration、entrypoint closed set 与 command-shim identity 理由：[V1.28-D11](../versions/v1.28/decisions.md#v1-28-d11)。
- 当前 ACP Client FS/Terminal 无第二层文件或 Shell 授权、无 execution-root containment，以及自动模式
  permission compatibility allow 的理由：[V1.29-D11](../versions/v1.29/decisions.md#v1-29-d11)。
- 当前退出即取消全部 AgentRun、关闭准入后快速结算与 400ms 冷启动反馈理由：[V1.29-D07](../versions/v1.29/decisions.md#v1-29-d07)。
- 退出前持久保存 public Composer Draft 的旧理由见 [V1.49-D01](../versions/v1.49/decisions.md#v1-49-d01)；该 public-Camp 部分已由 [V1.60-D03](../versions/v1.60/decisions.md#v1-60-d03) 的 Renderer-local clean break 替代。
- 理由来源：[v0.16](../versions/v0.16/decisions.md)、[v0.17](../versions/v0.17/decisions.md)、[v0.19](../versions/v0.19/decisions.md)、[v0.20](../versions/v0.20/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.64](../versions/v0.64/decisions.md)、[v0.66](../versions/v0.66/decisions.md)、[v1.01](../versions/v1.01/decisions.md)、[v1.03](../versions/v1.03/decisions.md)、[v1.04](../versions/v1.04/decisions.md)、[v1.05](../versions/v1.05/decisions.md)、[v1.11](../versions/v1.11/decisions.md)、[v1.12](../versions/v1.12/decisions.md)、[v1.13](../versions/v1.13/decisions.md)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)、[V1.15-D06](../versions/v1.15/decisions.md#v1-15-d06)、[V1.17-D02](../versions/v1.17/decisions.md#v1-17-d02)、[V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)、[V1.20-D02](../versions/v1.20/decisions.md#v1-20-d02)、[V1.21-D03](../versions/v1.21/decisions.md#v1-21-d03)、[V1.22-D01](../versions/v1.22/decisions.md#v1-22-d01)、[V1.24-D01](../versions/v1.24/decisions.md#v1-24-d01)。

## Session、Context 与 Bootstrap

- 当前规范：[Context 基础不变量](../architecture/foundational-invariants.md#context-session-bootstrap)、[Native Session Bootstrap Redelivery](../architecture/native-session-bootstrap-redelivery.md)、[Skills 来源与链接](../architecture/skills.md)、[ContextManifest Evidence v30](../contracts/context-manifest-evidence-v30.md)、[Context Delivery Profile v10](../contracts/context-delivery-profile-v10.md)、[Run Facts v7](../contracts/run-facts-v7.md)和[Skills Rebuild v1](../contracts/skills-rebuild-v1.md)；Single Chat 使用 Formatter/Manifest 26、Profile 6、[非 batch Run Facts v5](../contracts/run-facts-nonbatch-v5.md) 与 Skill Links v1；投影技术字段清理理由见 [V1.67-D01](../versions/v1.67/decisions.md#v1-67-d01)，公开历史按需读取理由见 [V1.68-D01](../versions/v1.68/decisions.md#v1-68-d01)。
- 理由来源：[v0.21](../versions/v0.21/decisions.md)、[v0.35](../versions/v0.35/decisions.md)、[v0.44](../versions/v0.44/decisions.md)、[v0.48](../versions/v0.48/decisions.md)、[v0.50](../versions/v0.50/decisions.md)、[v0.52](../versions/v0.52/decisions.md)、[v0.54](../versions/v0.54/decisions.md)、[v0.89](../versions/v0.89/decisions.md)、[v0.90](../versions/v0.90/decisions.md)、[v0.94](../versions/v0.94/decisions.md)、[v0.98](../versions/v0.98/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[V1.15-D03](../versions/v1.15/decisions.md#v1-15-d03)、[V1.15-D04](../versions/v1.15/decisions.md#v1-15-d04)、[V1.15-D06](../versions/v1.15/decisions.md#v1-15-d06)、[V1.28-D05](../versions/v1.28/decisions.md#v1-28-d05)。
- Pi managed system prompt 与 `native_system_prompt_preserved` 的初始理由见 [V1.39-D03](../versions/v1.39/decisions.md#v1-39-d03)、[V1.39-D10](../versions/v1.39/decisions.md#v1-39-d10)及已确认的[模型上下文 revision 3](../versions/v1.39/model-context-change-pi-managed-system-prompt.md)；其中 Receipt 准入已由 [V1.48-D01](../versions/v1.48/decisions.md#v1-48-d01) 退役。普通 Prompt 不解释 Slash、图片走独立结构化通道的当前边界见[模型上下文 revision 1](../versions/v1.44/model-context-change-pi-native-prompt.md)。

## Memory

- 当前规范：[Memory 基础不变量](../architecture/foundational-invariants.md#memory-lifecycle)、[Online Memory Capture](../architecture/online-memory-capture.md)、[Memory Capture v3](../contracts/memory-capture-v3.md)。
- 理由来源：[v0.10](../versions/v0.10/decisions.md)、[v0.21](../versions/v0.21/decisions.md)、[v0.73](../versions/v0.73/decisions.md)、[v0.78](../versions/v0.78/decisions.md)。

## Skills、MCP 与 Built-ins

当前 Skills 来源与模型冻结的取舍见 [V1.70-D01](../versions/v1.70/decisions.md#v1-70-d01) 和 [V1.70-D02](../versions/v1.70/decisions.md#v1-70-d02)；旧项目入口改为显式清理的理由见 [V1.70-D03](../versions/v1.70/decisions.md#v1-70-d03)，Windows 固定官方名称和无 observation 副本的准入见 [V1.70-D04](../versions/v1.70/decisions.md#v1-70-d04)与[V1.70-D05](../versions/v1.70/decisions.md#v1-70-d05)。旧 Library/项目投递仅作为历史恢复与用户显式处理的证据。

- 当前规范：[Skill/MCP 基础不变量](../architecture/foundational-invariants.md#skills-builtin-transport)、[Built-in Tool Runtime](../architecture/builtin-tool-runtime.md)、[Skills 架构](../architecture/skills.md)、[Skills Rebuild v2](../contracts/skills-rebuild-v2.md)、[Diagnostics Center v2](../contracts/diagnostics-center-v2.md)、[Built-in Tool Transport v32](../contracts/builtin-tool-transport-v32.md)、[Windows Skill Projection v2](../contracts/windows-skill-projection-v2.md)、[Skill Content Preview v1](../contracts/skill-content-preview-v1.md)和[Capability settings](../ui/components/capability-settings.md)。
- 理由来源：[v0.06](../versions/v0.06/decisions.md)、[v0.09](../versions/v0.09/decisions.md)、[v0.31](../versions/v0.31/decisions.md)、[v0.37](../versions/v0.37/decisions.md)、[v0.42](../versions/v0.42/decisions.md)、[v0.43](../versions/v0.43/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.67](../versions/v0.67/decisions.md)、[v0.82](../versions/v0.82/decisions.md)、[v0.85](../versions/v0.85/decisions.md)、[v0.91](../versions/v0.91/decisions.md)、[v0.92](../versions/v0.92/decisions.md)、[v0.93](../versions/v0.93/decisions.md)、[v1.05](../versions/v1.05/decisions.md)、[v1.07](../versions/v1.07/decisions.md)、[v1.14](../versions/v1.14/decisions.md)、[V1.17-D02](../versions/v1.17/decisions.md#v1-17-d02)、[V1.19-D01](../versions/v1.19/decisions.md#v1-19-d01)、[V1.19-D02](../versions/v1.19/decisions.md#v1-19-d02)、[V1.21-D01](../versions/v1.21/decisions.md#v1-21-d01)、[V1.27-D04](../versions/v1.27/decisions.md#v1-27-d04)、[V1.28-D03](../versions/v1.28/decisions.md#v1-28-d03)。
- Pi `.pi/skills` 只由原生 ResourceLoader 发现、Rovai 不追加路径或验证 catalog 的理由：[V1.44-D01](../versions/v1.44/decisions.md#v1-44-d01)；当前 Pi External MCP Unsupported 与旧 bridge clean removal 理由：[V1.39-D09](../versions/v1.39/decisions.md#v1-39-d09)。

## User Automation 与 Diagnostic Trial

- 当前 CLI 防误调用与移除 macOS Runtime 外层沙箱理由：[V1.58-D05](../versions/v1.58/decisions.md#v1-58-d05)，替代 V1.21-D03 的 OS denial 选择；进程合同见 [Managed Runtime Process v2](../contracts/managed-runtime-process-v2.md)。
- 当前规范：[User Automation 不变量](../architecture/foundational-invariants.md#user-automation-trial)、[Workspace 与动态 Git 不变量](../architecture/foundational-invariants.md#camp-workspace)、[User Automation Architecture](../architecture/user-automation.md)和[User Automation v5](../contracts/user-automation-v5.md)。
- 理由来源：[V1.21-D01](../versions/v1.21/decisions.md#v1-21-d01)、[V1.21-D02](../versions/v1.21/decisions.md#v1-21-d02)、[V1.21-D03](../versions/v1.21/decisions.md#v1-21-d03)、[V1.21-D04](../versions/v1.21/decisions.md#v1-21-d04)及[V1.53-D05](../versions/v1.53/decisions.md#v1-53-d05)。

## Scheduled Automation

- 当前规范：[Scheduled Automation 不变量](../architecture/foundational-invariants.md#scheduled-automation)、[Scheduled Automation Architecture](../architecture/scheduled-automation.md)、[Scheduled Automation v3](../contracts/scheduled-automation-v3.md)、[Automation 工作区](../ui/components/automation-workspace.md)和[Built-in Tool Transport v32](../contracts/builtin-tool-transport-v32.md)。
- 原子领取、新 Camp 派发与不可恢复重派发的理由：[V1.54-D01](../versions/v1.54/decisions.md#v1-54-d01)；执行和渠道通知分离的理由：[V1.54-D02](../versions/v1.54/decisions.md#v1-54-d02)。

## Evidence、Runtime Activity 与 Usage

- 当前规范：[Evidence/Activity 基础不变量](../architecture/foundational-invariants.md#evidence-canonical-activity)、[Runtime File Change Observation](../architecture/runtime-file-change-observation.md)、[Runtime File Change Observation v6](../contracts/runtime-file-change-observation-v6.md)、[Run Process Detail Surface v42](../contracts/run-process-detail-surface-v42.md)、[Runtime Monitoring](../architecture/runtime-monitoring.md)、[Runtime Usage Monitoring v4](../contracts/runtime-usage-monitoring-v4.md)、[Runtime Activity Registry](../runtime-activity/registry.md)。生命周期、Blob 与文件投影理由分别见 [V1.64-D01](../versions/v1.64/decisions.md#v1-64-d01)、[V1.64-D02](../versions/v1.64/decisions.md#v1-64-d02)与 [V1.64-D03](../versions/v1.64/decisions.md#v1-64-d03)；普通输出永久有界理由见 [V1.66-D01](../versions/v1.66/decisions.md#v1-66-d01)。
- Pi 成功 edit 的 path-bound 原生 patch、activity-v4 cutover、Migration 147 与历史 classifier 冻结理由：[V1.55-D02](../versions/v1.55/decisions.md#v1-55-d02)。
- 理由来源：[v0.17](../versions/v0.17/decisions.md)、[v0.41](../versions/v0.41/decisions.md)、[v0.96](../versions/v0.96/decisions.md)、[v0.99](../versions/v0.99/decisions.md)、[V1.28-D12](../versions/v1.28/decisions.md#v1-28-d12)、[V1.29-D08](../versions/v1.29/decisions.md#v1-29-d08)、[V1.29-D09](../versions/v1.29/decisions.md#v1-29-d09)、[V1.29-D14](../versions/v1.29/decisions.md#v1-29-d14)。
- Pi terminal assistant model-call Usage、原生 Action lifecycle 与 `agent_start` admission 的当前字段边界由 [Runtime Launch v43](../contracts/runtime-launch-and-verification-v43.md)继承并收敛，接入理由见 [V1.39-D01](../versions/v1.39/decisions.md#v1-39-d01)和[V1.48-D01](../versions/v1.48/decisions.md#v1-48-d01)。

## Qualification 与 Benchmark

- 当前规范：[Qualification/Benchmark 基础不变量](../architecture/foundational-invariants.md#qualification-evidence)、[Benchmark Protocol](../architecture/benchmark-protocol.md)、[Benchmark Protocol v3](../contracts/benchmark-protocol-v3.md)、[Semantic Judge Views v1](../contracts/semantic-judge-views-v1.md)、[Tool Interaction Measurement v2](../contracts/tool-interaction-measurement-v2.md)、[Paired Collaboration Experiment v1](../contracts/paired-collaboration-experiment-v1.md)。
- 理由来源：[v0.31](../versions/v0.31/decisions.md)、[v0.34](../versions/v0.34/decisions.md)、[v0.36](../versions/v0.36/decisions.md)、[v0.53](../versions/v0.53/decisions.md)、[v0.55](../versions/v0.55/decisions.md)、[v0.68](../versions/v0.68/decisions.md)。

## Product 与 Renderer

- 当前规范：[产品/Renderer 基础不变量](../architecture/foundational-invariants.md#product-execution-surface)、[Availability-first Runtime](../architecture/availability-first-runtime.md)、[Bootstrap Shell](../ui/components/bootstrap-shell.md)、[Desktop Navigation Refresh](../architecture/desktop-navigation-refresh.md)、[UI 规范](../ui/README.md)、[Camp 会话工作区](../ui/components/conversation-workspace.md)、[Run Process Detail Surface v42](../contracts/run-process-detail-surface-v42.md)、[Desktop App Updates](../architecture/desktop-app-updates.md)和[App Update v5](../contracts/app-update-v5.md)。
- 理由来源：[v0.11](../versions/v0.11/decisions.md)、[v0.24](../versions/v0.24/decisions.md)、[v0.55](../versions/v0.55/decisions.md)、[v0.58](../versions/v0.58/decisions.md)、[v0.84](../versions/v0.84/decisions.md)、[v1.12](../versions/v1.12/decisions.md)、[v1.13](../versions/v1.13/decisions.md)、[V1.15-D01](../versions/v1.15/decisions.md#v1-15-d01)、[V1.15-D02](../versions/v1.15/decisions.md#v1-15-d02)、[V1.15-D05](../versions/v1.15/decisions.md#v1-15-d05)、[V1.18-D01](../versions/v1.18/decisions.md#v1-18-d01)、[V1.20-D02](../versions/v1.20/decisions.md#v1-20-d02)、[V1.28-D12](../versions/v1.28/decisions.md#v1-28-d12)、[V1.28-D13](../versions/v1.28/decisions.md#v1-28-d13)、[V1.29-D10](../versions/v1.29/decisions.md#v1-29-d10)、[V1.29-D12](../versions/v1.29/decisions.md#v1-29-d12)、[V1.29-D14](../versions/v1.29/decisions.md#v1-29-d14)、[V1.31-D01](../versions/v1.31/decisions.md#v1-31-d01)、[V1.31-D04](../versions/v1.31/decisions.md#v1-31-d04)、[V1.41-D01](../versions/v1.41/decisions.md#v1-41-d01)。

## 文档治理

- 当前规范：[版本决策治理](README.md)、[文档导航](../README.md)、[版本生命周期](../versions/README.md)。
- 当前决定：[V1.11-D01：当前权威收敛与数字 ADR clean break](../versions/v1.11/decisions.md#v1-11-d01)、[V1.11-D02：局部替代归一与一次性迁移条款退役](../versions/v1.11/decisions.md#v1-11-d02)。

## 外部附件 CLI 入口

- 当前规范：[Camp Attachment v10](../contracts/camp-attachment-v10.md)、[Camp Message Send v23](../contracts/camp-message-send-v23.md)、[Built-in Tool Transport v32](../contracts/builtin-tool-transport-v32.md)及[附件架构](../architecture/camp-published-attachment-view.md)。新增 Agent 文件统一原路径登记；旧 snapshot 仅服务历史记录读取。
- 主要理由：[V1.32-D01](../versions/v1.32/decisions.md#v1-32-d01)：由 CLI 以 Runtime 权限适配外部路径，该历史选择由 V1.59-D08 的原路径引用决定替代。

## Camp 连续消息

- 当前规范：[Camp Composer Draft v15](../contracts/camp-composer-draft-v15.md)与[Public Camp Composer 架构](../architecture/camp-composer-draft.md)。旧 Core Pending/Draft/恢复合同仅解释历史；clean break 理由见 [V1.60-D03](../versions/v1.60/decisions.md#v1-60-d03)，本机恢复理由见 [V1.60-D08](../versions/v1.60/decisions.md#v1-60-d08)。

- [V1.56-D01](../versions/v1.56/decisions.md#v1-56-d01)：选文快照独立于 Reply 与派发。

## 取消事务与 Runtime 清理

- 当前规范：[Cancellation Settlement v2](../contracts/cancellation-settlement-v2.md)、[Accepted Input Recovery v6](../contracts/accepted-input-recovery-v6.md)、[Camp Membership v2](../contracts/camp-membership-v2.md)、[Channel Storage v3](../contracts/channel-storage-v3.md)和[Runtime 恢复与关闭](../architecture/foundational-invariants.md#runtime-recovery-shutdown)。
- 理由：[V1.37-D02](../versions/v1.37/decisions.md#v1-37-d02)。


## 官方 ZCode 接入

- 当前规范：[Runtime Catalog](../architecture/runtime-catalog-boundaries.md#官方-zcode-当前边界)、[Runtime Launch v43](../contracts/runtime-launch-and-verification-v43.md)、[Runtime Platform Admission v2](../contracts/runtime-platform-admission-v2.md)、[File Change v6](../contracts/runtime-file-change-observation-v6.md)。
- 理由：[V1.57-D01](../versions/v1.57/decisions.md#v1-57-d01)、[V1.57-D02](../versions/v1.57/decisions.md#v1-57-d02)。

## 双轨执行评测

- 当前规范：[双轨执行评测](../architecture/execution-evaluation.md)、[Execution Evaluation v14](../contracts/execution-evaluation-v14.md)、[User Automation v5](../contracts/user-automation-v5.md)与[操作指南](../development/evaluation.md)。
- 理由来源：[V1.58-D01](../versions/v1.58/decisions.md#v1-58-d01)。

## 统一 Host 与 Web

- 当前规范：[统一 Rust Host](../architecture/unified-rust-host.md)、[原生 Server 数据与分发](../architecture/unified-rust-host.md#原生-server-数据与分发)、[Host Lifecycle v2](../contracts/host-lifecycle-v2.md)、[Host Web v4](../contracts/host-web-v4.md)与[Server 开发预览](../development/server-preview.md)。Task 旧 payload reconciliation clean break 理由见 [V1.63-D02](../versions/v1.63/decisions.md#v1-63-d02)。
- 理由来源：[V1.59-D01](../versions/v1.59/decisions.md#v1-59-d01)、[V1.59-D02](../versions/v1.59/decisions.md#v1-59-d02)。

- 新对话默认队伍归属：[Host Web v2](../contracts/host-web-v2.md#shared-creation-preferences)、[Camp Activation](../architecture/camp-activation-lifecycle.md#component-authority)；理由见 [V1.59-D03](../versions/v1.59/decisions.md#v1-59-d03)。
- Web HTML 附件预览：[统一 Host 的用户文件](../architecture/unified-rust-host.md#草稿与用户文件)、[Host Web v2](../contracts/host-web-v2.md)、[文件查看器](../ui/components/file-preview.md)；可信同来源与原生存储取舍见 [V1.59-D09](../versions/v1.59/decisions.md#v1-59-d09)，初始方案见 [V1.59-D04](../versions/v1.59/decisions.md#v1-59-d04)。

- 长期登录与普通 Session 续期：[Host Web v2](../contracts/host-web-v2.md#session-lifetime-and-renewal)、[统一 Host 身份与控制面](../architecture/unified-rust-host.md#身份与控制面)；理由见 [V1.59-D05](../versions/v1.59/decisions.md#v1-59-d05)。

- 当前 Agent 附件原路径发布、默认输出与归属理由：[V1.59-D08](../versions/v1.59/decisions.md#v1-59-d08)。

- DeepSeek Harness ACP 接入：[Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md#deepseek-harness-acp)、[平台准入](../contracts/runtime-platform-admission-v2.md#deepseek-harness-增量准入)；理由：[V1.59-D10](../versions/v1.59/decisions.md#v1-59-d10)。
