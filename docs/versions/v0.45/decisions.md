---
document_type: version-decisions
version: v0.45
lifecycle: historical
last_updated: 2026-08-18
---

# v0.45 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0130](#adr-0130) | Public A2A Messages and Unified Message Delivery | `accepted` |
| [ADR-0131](#adr-0131) | Recipient-Scoped Event-Driven Delivery Dispatch and Interrupted Recovery | `accepted` |
| [ADR-0132](#adr-0132) | Bounded Public Reference Context Closure and Profile v2 | `accepted` |
| [ADR-0133](#adr-0133) | Scheme C Run Process Detail Surface | `superseded` |
| [ADR-0134](#adr-0134) | Explicit Runtime Public Output Boundary | `accepted` |

<!-- legacy-adr:begin id=ADR-0130 source-file-sha256=375dcfbbee1b88ecf3c38d9fa83940631bebd5fe58252e870254c0d35056c9d6 -->
<a id="adr-0130"></a>

## ADR-0130: Public A2A Messages and Unified Message Delivery

迁移时原路径：`docs/adr/0130-public-a2a-message-and-unified-delivery.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0130
title: Public A2A Messages and Unified Message Delivery
status: accepted
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes:
  - ADR-0073
  - ADR-0099
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0130 -->
<a id="adr-0130-context"></a>
### Context

历史 A2A 把 Agent 间请求、私有输入、收件人记录和后续 AgentRun 分散在 Member Call 与多种
recipient 表中。用户只能看到 AgentRun 的总结，无法把一次协作当作 Camp 公共讨论的一部分；
多个收件人还可能经过不同投递路径，造成幂等、审计和恢复语义分叉。v0.45 尚未上线，不需要
保留旧数据或 alias。

<a id="adr-0130-decision"></a>
### Decision

采用一条公共消息事实和一个收件人责任模型：

1. `camp.message.send` / `rovai send` 是唯一 Agent-authored A2A 发送操作。每次成功请求先
   原子提交一个 Camp-visible Public A2A Message，再为每个 Effective Recipient 创建一个
   Message Delivery；公共-only 请求创建零个 Delivery。
2. Message Delivery 是 recipient-specific 投递、排队、尝试、Context gate、目标 Run 绑定、
   重试和终态的唯一权威。不得引入私有 A2A message、`CampMessageRecipient`、
   `AgentMessageDelivery` 或第二套投递机制。
3. `--to`、严格正文 Addressing Token 和 reply-to default target 在 Core 统一解析。解析失败
   整笔拒绝并返回完整结构化错误；有效集合去重后按 opaque Agent ID 的 UTF-8/ASCII 字节序
   升序冻结。该排序不表达调度优先级。
4. Agent-authored Public A2A Message 进入公共时间线、搜索和 Shared Conversation。回复关系
   只建立公共引用与明确的 reply-to default target，不创建 response obligation、结果回传槽位
   或自动私有闭环。
5. 单次 fanout 受 CampTurn 剩余 A2A budget 与绝对上限 16 约束；A2A lineage 最大深度 5，
   self/ancestor cycle 和预算失败在持久化前原子拒绝。没有语义相似度或时间窗去重。

<a id="adr-0130-consequences"></a>
### Consequences

- 用户和有权 Camp 成员能看到同一条公共协作事实，公共检索和动态上下文不再遗漏 Agent
  handoff；
- Delivery 的队列与终态可按 recipient 独立展示，兄弟目标不会被一个 Runtime 故障隐藏；
- Core、Read Side、CLI、Adapter、审计和 Renderer 必须共同使用同一个 canonical recipient
  snapshot；
- 公共可见性提高了正文治理和引用链预算的重要性，Profile v2 与严格错误合同成为必要配套；
- v0.45 需要 clean-break Schema/Migration，旧 private Member Call 数据不迁移。

<a id="adr-0130-rejected-alternatives"></a>
### Rejected Alternatives

- **保留 Member Call，额外复制一条公共总结**：会保留两套投递/幂等事实，且公共消息不是
  协作请求本身。
- **每个 recipient 产生一条独立公共消息**：破坏一条用户可见事实与多目标审计的关联，容易
  出现正文/顺序分叉。
- **让 Renderer 解析 Mention 或直接投递**：绕过 Core 的身份、预算、lineage 和唯一 Delivery
  authority，无法 fail closed。
- **按 Agent ID sort 作为执行顺序**：把 opaque identity 的稳定性误当调度策略，限制公平性
  和容量调度。

<a id="adr-0130-references"></a>
### References

- [v0.45 版本目标](README.md)
- [Camp Message Send v1](../../contracts/camp-message-send-v1.md)
- [Message Delivery v1](../../contracts/message-delivery-v1.md)
- [ADR-0131：事件驱动 Delivery 恢复](decisions.md#adr-0131)
<!-- legacy-adr-body:end id=ADR-0130 -->
<!-- legacy-adr:end id=ADR-0130 -->

<!-- legacy-adr:begin id=ADR-0131 source-file-sha256=4cdac6a68ff50a7256fbcbb74e306b3b9193046f295732e7ac6d280ff94ac5ce -->
<a id="adr-0131"></a>

## ADR-0131: Recipient-Scoped Event-Driven Delivery Dispatch and Interrupted Recovery

迁移时原路径：`docs/adr/0131-recipient-scoped-event-driven-delivery-recovery.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0131
title: Recipient-Scoped Event-Driven Delivery Dispatch and Interrupted Recovery
status: accepted
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0131 -->
<a id="adr-0131-context"></a>
### Context

公共 Message 与 Delivery 提交后，目标 Agent 可能暂时忙、Runtime 不可用或容量不足。周期扫描
和启动时全局重调度看似简单，却会把 Core restart 变成历史 Camp 的隐式执行入口，也无法区分
“已经尝试过但暂时等待”和“第一次 dispatch attempt 尚未建立就崩溃”这两个完全不同的事实。

<a id="adr-0131-decision"></a>
### Decision

Message Delivery 使用 recipient-scoped、纯事件驱动的 Dispatch Pump：

- Delivery 在首次实际 dispatch attempt 前保持 pending；attempt 必须先持久化唯一 fence；
- attempt 已建立但暂时阻塞时记录明确 waitCondition：`target_busy`、`runtime_unavailable` 或
  `capacity_unavailable`；
- 只有新 Delivery 接受、该 recipient 的目标 Run 结束、Runtime 配置/ready 恢复、容量变化或
  针对单条 Delivery 的显式 Retry 才能调用 `dispatchPending(agentId)`；
- 不做周期扫描，不在 Core/App 启动时全局 pump，不使用 Camp 级“继续待处理协作”兜底；
- 崩溃发生在第一次 attempt fence 之前时，Delivery 终态为
  `interrupted_before_dispatch`，标记 manual intervention，任何启动/Camp/新消息/Run 结束/
  Runtime 恢复/容量事件都不能隐式复活；
- Retry 和 Cancel 必须指向具体 Delivery。Retry 复用冻结的 Message、recipient、展示快照、
  Task 和 lineage，并拥有独立 Retry Identity；不得重新解析正文或扩大 fanout。

<a id="adr-0131-consequences"></a>
### Consequences

- 重启不会偷偷启动历史协作，UI 能诚实区分未开始中断和已尝试暂时等待；
- Scheduler 需要维护 recipient-scoped event subscription、attempt fencing 和对账逻辑；
- Delivery 可能长期保持 pending 或 manual intervention，Read Side 必须提供明确行动入口；
- CampTurn settlement 不能忽略 interrupted Delivery，必须等待显式 Retry 或 Cancel；
- 没有 periodic safety net，事件发布、持久化和恢复证据必须具备可验证的一致性。

<a id="adr-0131-rejected-alternatives"></a>
### Rejected Alternatives

- **启动时扫描全部 pending**：会让 Core/App restart 产生未授权的历史执行，并掩盖崩溃窗口。
- **Camp 级继续事件批量恢复**：不能证明每个 recipient 的等待条件已经解除，且会跨目标错误
  复活 Delivery。
- **固定周期轮询**：延迟、重复尝试和资源开销不可控，无法表达 recipient-scoped causality。
- **把 interrupted 当普通 pending**：会把“从未开始”误报成可自动等待，用户无法知道需要
  明确确认。

<a id="adr-0131-references"></a>
### References

- [Message Delivery v1](../../contracts/message-delivery-v1.md)
- [Public A2A Message 架构](../../architecture/public-a2a-message-delivery.md)
- [v0.45 实施计划](implementation-plan.md)
<!-- legacy-adr-body:end id=ADR-0131 -->
<!-- legacy-adr:end id=ADR-0131 -->

<!-- legacy-adr:begin id=ADR-0132 source-file-sha256=8edbe35ab49ad838d977f8853a066412dff9f7f0f14ae26f6b66d76ac7d71586 -->
<a id="adr-0132"></a>

## ADR-0132: Bounded Public Reference Context Closure and Profile v2

迁移时原路径：`docs/adr/0132-public-reference-context-closure-profile-v2.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0132
title: Bounded Public Reference Context Closure and Profile v2
status: accepted
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0132 -->
<a id="adr-0132-context"></a>
### Context

v0.44 的 Profile v1 有确定的 recent count、公共字符和单条正文上限，但明确不补回复祖先。
公共 A2A 进入 Camp 后，Agent 回复某条公共消息时需要看到直接父消息；如果沿整个 reply graph
或无界历史闭合，会让一个引用改变上下文大小、成本和 ACK 边界。用户已确认保留最多 3 条
reference chain，并要求 omission、Manifest/ACK 和直接父消息失败边界可审计。

<a id="adr-0132-decision"></a>
### Decision

保留 Profile v1 的 immutable semantics，并新增 Profile v2：

```yaml
profileVersion: 2
maxPublicMessages: 15
maxPublicHistoryChars: 24000
maxMessageBodyChars: 2000
maxPublicReferenceChainMessages: 3
```

对带 `replyToCampMessageId` 的当前 trigger，只沿直接公共父边向根选择最多三条消息，优先
direct parent，再是更近祖先。Closure 不递归展开无关消息的 reply、Mention、附件或语义
关系，且不扩大原始 recipients。Closure 与 ordinary recent 共享字符/body budget；稳定 ID
去重，Manifest 冻结 selected/omitted refs 和 exact payload。

Budget priority 固定为完整 Current Input、mandatory structure、direct parent、远端 closure、
lineage-required origin、ordinary recent。移除所有可选内容后 direct parent 或必需结构仍
无法容纳时，Delivery 在 AgentRun materialization 前以 `context_payload_too_large` 终态失败，
不建立 Run、不进入 waitCondition、不推进 ACK；公共 Message 和 sibling Deliveries 保留。

ContextManifest ACK 仍只推进既有 Accepted Public Context Boundary；Closure 没有独立 read
cursor。Recovery 复用冻结 bytes，不按当前 Profile/消息重新闭合。

<a id="adr-0132-consequences"></a>
### Consequences

- 回复关系提供有限、可解释的动态上下文，同时最多 3 条链额度阻止历史无界增长；
- 直接父消息成为明确的容量失败边界，用户可区分“缺失/不可读”与“结构必需但超限”；
- Profile v1 的历史 Manifest 永远不被 v2 重写，Formatter/fixture 必须同时支持版本识别；
- ACK 仍是单一边界，closure 不产生第二套已读/补投机制；
- Delivery dispatch 必须在 AgentRun 物化前完成 Context gate，增加一次可审计的提交边界。

<a id="adr-0132-rejected-alternatives"></a>
### Rejected Alternatives

- **删除 3 条上限，只受 24,000 字符约束**：会让单个 reply chain 无界挤出普通公共历史，
  且难以预测成本。
- **闭合整个 reply graph 或所有被引用消息**：把 unrelated context 变成隐式输入，破坏
  当前 Input/公共历史的确定性。
- **父消息超限时截断 Current Input 或静默创建空 Run**：丢失 Agent 真实请求或制造无法
  解释的执行，违反 fail-closed。
- **为 closure 增加独立 ACK/read cursor**：产生第二套边界和重复补投语义。

<a id="adr-0132-references"></a>
### References

- [Context Delivery Profile v2](../../contracts/context-delivery-profile-v2.md)
- [Context Delivery Profile v1](../../contracts/context-delivery-profile-v1.md)
- [ADR-0129：Profile v1 与 raw public context](../v0.44/decisions.md#adr-0129)
<!-- legacy-adr-body:end id=ADR-0132 -->
<!-- legacy-adr:end id=ADR-0132 -->

<!-- legacy-adr:begin id=ADR-0133 source-file-sha256=30f99b4b260c0f09780ef5254d5f7182edfbe2a3421baaef572e9d9a251dbae0 -->
<a id="adr-0133"></a>

## ADR-0133: Scheme C Run Process Detail Surface

迁移时原路径：`docs/adr/0133-scheme-c-run-process-detail-surface.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0133
title: Scheme C Run Process Detail Surface
status: superseded
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes: []
superseded_by: ADR-0154
```

<!-- legacy-adr-body:begin id=ADR-0133 -->
<a id="adr-0133-context"></a>
### Context

执行过程既需要在会话区保持可见，又不能把 Runtime 日志变成第二条聊天时间线。现有 Inspector
“活动”页与会话区执行卡重复过程详情；原型还展示了 Run 级停止按钮，与已经冻结的 CampTurn
级停止权威冲突。v0.45 需要在不改变 Arctic Dawn App Shell 的前提下收敛信息架构。

<a id="adr-0133-decision"></a>
### Decision

采用 Scheme C：

- Run Pulse 常驻在会话区上方，提供数量、状态摘要和 Run 选择，不自动打开/切换 Drawer 或
  抢焦点；
- Execution Drawer 按需展开，成为唯一的 Run 过程详情面。它只读 Canonical Runtime
  Activity、Execution Evidence、Delivery 和 ContextManifest 摘要，不提供 Run stop/cancel；
- 删除 Inspector “活动”页，Inspector 只保留 Tasks、Context、Approvals、Audit；
- Approval Dock 继续固定在 Composer 正上方。Drawer 空间不足时收缩为摘要，不能遮挡 Dock；
- 存在活跃 CampTurn 时，Composer 发送位置切换为唯一的 CampTurn Stop，fence 整棵
  AgentRun/Message Delivery 执行树；v0.45 不新增 Run 级取消协议；
- HTML 只作为会话区层级和交互参考，现有 Arctic Dawn Token、导航、Composer、Approval、
  断点和无障碍合同优先。

<a id="adr-0133-consequences"></a>
### Consequences

- 用户有一个明确的过程详情入口，不需要在 Inspector 与会话区之间寻找同一 Run；
- Drawer 的只读边界避免把 Run cancel 与 CampTurn stop 混成两套协议；
- Inspector 迁移需要删除旧 Activity tab route/state/test，并将原有 Activity 入口转为 Drawer
  selection；
- 窄窗口下需要优先保证 Approval 和 Stop 可见，Drawer 详情可退化为摘要。

<a id="adr-0133-rejected-alternatives"></a>
### Rejected Alternatives

- **保留 Inspector Activity 页并新增 Drawer**：形成两个过程详情权威和重复状态；
- **每个 Run 卡提供 Stop**：绕过 CampTurn fence，导致树内部分取消；
- **后台事件自动打开 Drawer**：抢焦点、改变用户阅读位置，并把观察变成注意力副作用；
- **完整复制 HTML Demo Shell**：会覆盖当前 Arctic Dawn 设计系统并把演示数据误当生产状态。

<a id="adr-0133-references"></a>
### References

- [Run Process Detail Surface v1](../../contracts/run-process-detail-surface-v1.md)
- [Camp 会话工作区 UI 合同](../../ui/components/conversation-workspace.md)
- [v0.45 会话区原型](../../prototypes/run-activity/README.md)
- [ADR-0084：Conversation surface controls](../v0.26/decisions.md#adr-0084)
<!-- legacy-adr-body:end id=ADR-0133 -->
<!-- legacy-adr:end id=ADR-0133 -->

<!-- legacy-adr:begin id=ADR-0134 source-file-sha256=ec3a6b105e03740dfbf7d9fafe563fcae3e22d6ad5c40267c8eac816e23e0bb8 -->
<a id="adr-0134"></a>

## ADR-0134: Explicit Runtime Public Output Boundary

迁移时原路径：`docs/adr/0134-runtime-public-output-boundary.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0134
title: Explicit Runtime Public Output Boundary
status: accepted
date: 2026-08-07
decision_scope: cross-version
source_version: v0.45
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0134 -->
<a id="adr-0134-context"></a>
### Context

不同 Runtime 对“助手最终输出”的可观测边界不同。若 Core 把每个 stdout、stream chunk 或
最后一段文本都当作公共消息，会把中间思考、重复重连和无关日志写入公共 Camp；若完全依赖
Agent 明确发送，又无法利用 Adapter 已经可靠证明的 final boundary。

<a id="adr-0134-decision"></a>
### Decision

每个 Runtime Adapter 必须声明且冻结一种 public output mode：

1. `explicit_send_only`：只有 `camp.message.send` 成功才写 Public A2A Message；
2. `assistant_final_visible`：Adapter 能证明同一 AgentRun 的 final boundary 且输出为
   recipient-free assistant final 时，Core 可以创建一条公共消息。

自动 final 输出不得推导 recipients、创建 Delivery、改变 reply-to 或替代显式发送。精确
重复抑制只在同一 Run、同一 output mode、规范化正文完全相同且已确认同一 final boundary
时生效；不做语义相似度、时间窗或跨 Run 去重。无法证明 final boundary 时按
`explicit_send_only` 处理并保留原始 evidence。

<a id="adr-0134-consequences"></a>
### Consequences

- Adapter 能力差异成为显式、可审计的合同，不由 Core 猜测 Runtime 文本；
- 公共区只接收可靠 final 或明确 send，减少中间输出污染；
- 每个 Adapter 需要提供 boundary evidence 和 exact suppression fixture；
- `assistant_final_visible` 仍不会产生 recipient-specific Delivery，回复/寻址必须另行显式
  发送。

<a id="adr-0134-rejected-alternatives"></a>
### Rejected Alternatives

- **把最后一个 stdout 当 final**：无法区分日志、重试和模型输出，证据不足；
- **所有 Runtime 一律自动公开**：把低观测能力 Runtime 的猜测变成公共事实；
- **语义相似度去重**：会删除用户有意重复的更新，且不可重现；
- **让 Renderer 决定 final**：UI 不是 Runtime evidence authority，也无法保证重启一致性。

<a id="adr-0134-references"></a>
### References

- [v0.45 版本目标](README.md)
- [Public A2A Message 架构](../../architecture/public-a2a-message-delivery.md)
- [Camp Message Send v1](../../contracts/camp-message-send-v1.md)
<!-- legacy-adr-body:end id=ADR-0134 -->
<!-- legacy-adr:end id=ADR-0134 -->
