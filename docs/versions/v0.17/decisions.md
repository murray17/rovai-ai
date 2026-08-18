---
document_type: version-decisions
version: v0.17
lifecycle: historical
last_updated: 2026-08-18
---

# v0.17 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0061](#adr-0061) | Durable User-Visible and Agent-Inaccessible Execution Evidence | `accepted` |
| [ADR-0062](#adr-0062) | Interruptible Run Trees and Unsettled External Effects | `accepted` |
| [ADR-0063](#adr-0063) | Minimal A2A Turn Envelope and Trusted Reply Correlation | `superseded` |

<!-- legacy-adr:begin id=ADR-0061 source-file-sha256=18d6f93214e39a22bf77a8db86c498201a28f099a380685d7b9b9de9d658307f -->
<a id="adr-0061"></a>

## ADR-0061: Durable User-Visible and Agent-Inaccessible Execution Evidence

迁移时原路径：`docs/adr/0061-durable-agent-inaccessible-execution-evidence.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0061
title: "Durable User-Visible and Agent-Inaccessible Execution Evidence"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.17
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0061 -->
> [ADR-0129](../v0.44/decisions.md#adr-0129) 删除 Segment/Epoch Summary
> 及摘要模型输入目标；Execution Evidence 仍不得进入 CampMessage、FTS、Shared Conversation、
> ContextManifest payload、A2A、Memory 或任何后续 AgentRun 输入。

<a id="adr-0061-context"></a>
### Context

Rovai-ai 已能从部分 Runtime 接收 reasoning summary、进展说明、计划、步骤、命令和
工具生命周期通知，但 v0.16 只把这些通知保存在 Renderer 的有界内存中。用户离开
Camp、重新打开会话或重启 App 后，执行过程会消失；实时事件丢失时，界面也无法从
SQLite 恢复。

把这些内容直接写成 CampMessage 又会破坏另一条必要边界：执行过程是给用户理解
Agent 行为的证据，不是给 Agent 继续推理的会话内容。工具输出和 reasoning summary
一旦进入公共消息、FTS、摘要、ContextManifest、A2A 或后续 Run 上下文，会造成
上下文污染、成本膨胀、工具结果自我引用，并把用户可见性误当成 Agent 可检索性。

因此，执行过程需要成为 SQLite 中独立、可恢复的权威事实，同时在所有 Agent
上下文路径上保持不可见。

<a id="adr-0061-decision"></a>
### Decision

<a id="adr-0061-execution-evidence-是-agentrun-的独立权威记录"></a>
#### Execution Evidence 是 AgentRun 的独立权威记录

Core 为 Runtime 明确报告的用户可见执行过程持久化规范化
**AgentRun Execution Evidence**。每条记录至少归属一个 AgentRun，并通过该 Run
关联 CampTurn 与 Camp；同一 Run 内具有稳定顺序、类型、时间和终态信息。

允许的语义种类包括：

```text
reasoning_summary
narration
plan
step
tool_call
tool_result
file_change
command
```

具体 Runtime 事件先由 Adapter/Core 归一化，再进入该记录。不得把 provider 原始
协议包、隐藏思维链、内部日志或 Renderer 临时状态作为权威正文保存。Runtime 没有
报告的步骤不得推断或伪造。

Agent 最终回复仍属于 CampMessage；Approval、Action、Task、Audit 和
Runtime Permission Request 继续由各自领域对象拥有。Execution Evidence 不替代
这些对象，也不是 Task 完成证明。

<a id="adr-0061-用户可见不等于-agent-可用"></a>
#### 用户可见不等于 Agent 可用

Execution Evidence 必须在数据流入口处与 Agent 可用内容分离，而不是依赖
Renderer 隐藏：

- 不写入 CampMessage 或 ConversationMessage；
- 不进入 Camp FTS、`context.search` 或任何检索索引；
- 不进入 Segment Summary、Epoch Summary 或摘要模型输入；
- 不进入 ContextManifest payload、Shared Conversation Updates、Current Input、
  Work Brief、Control Signals 或 Session Charter；
- 不进入 A2A body、A2A target context 或后续 AgentRun 输入；
- 不作为 Memory Proposal、Memory Projection 或自动学习来源。

未来增加新的搜索、摘要、导出给 Agent 或上下文组装路径时，必须以 allowlist 选择
Agent 可用内容；Execution Evidence 默认不在 allowlist 中。仅靠调用方记得过滤的
denylist 不足以构成此边界。

<a id="adr-0061-大内容使用-managed-blob"></a>
#### 大内容使用 Managed Blob

SQLite 保存规范化展示字段、有界 preview、内容摘要、字节数、截断标记和可选
Managed Blob 引用。较大的工具结果、命令输出或文件变更内容写入
ADR-0013 的 Managed Blob Store；Blob 引用是权威 GC root，直到所属 Camp 被永久
删除。

截断必须显式。UI 不得把 preview 表现为完整结果，也不得为了展示方便静默丢弃
“原内容更长”这一事实。Renderer 只能通过受控 Core API 读取授权 Camp 中的
Evidence 内容，不能取得 Blob 文件路径或直接读取 SQLite。

<a id="adr-0061-read-side-与生命周期"></a>
#### Read Side 与生命周期

Execution Evidence 是权威表，不是 event replay 生成的第二投影。Camp snapshot
或专用分页 Read Side 在同一授权和 schema-version 边界下读取它；实时订阅只用于
增量失效和低延迟展示，断线或重启后必须能从 SQLite 恢复。

记录为追加式事实。允许按稳定 provider identity/内容摘要幂等合并同一通知，但不得
因 Run 完成、用户折叠、重新打开 Camp 或 App 重启而删除。它与所属 Camp 同生命周期：
永久删除 Camp 时一起删除，其 Managed Blob 引用随后按现有 GC 规则回收。

<a id="adr-0061-展示与安全渲染"></a>
#### 展示与安全渲染

每个 AgentRun 拥有独立的执行披露区，邻接该 Run 的最终回复或运行状态。运行中默认
展开；Run 进入终态后默认折叠为带时长和结果的摘要，用户可随时重新展开。

reasoning summary、narration、plan、step 和 Agent 最终回复可使用安全 GFM 展示；
原始 HTML、脚本、事件属性和嵌入式远程内容禁用。工具、命令、文件变更及其结果使用
结构化证据组件，不把任意内容当 Markdown 执行。用户消息保持精确纯文本、可选择且
可复制。

<a id="adr-0061-consequences"></a>
### Consequences

- 用户离开、重启或稍后返回后仍能检查同一 Run 的执行过程。
- Agent 上下文不会因工具输出和 reasoning summary 污染或自我引用。
- SQLite、Read Model、Contracts、Managed Blob GC 和 Renderer 都需要新增明确
  Evidence 合同。
- 高频通知需要规范化、幂等和容量控制；大内容读取需要分页或按需加载。
- “用户看得到”不能再被实现为 CampMessage；新增内容路径必须主动选择正确领域。

<a id="adr-0061-rejected-alternatives"></a>
### Rejected Alternatives

- 继续只存在 Renderer 内存：无法跨导航、断线和重启恢复。
- 写入 CampMessage 后在搜索时过滤：遗漏任何摘要、A2A 或上下文路径都会泄漏。
- 保存 provider 原始事件包：协议不稳定、可能包含不应展示的内部字段，且无法形成
  跨 Runtime 的稳定 UI 合同。
- 保存原始隐藏思维链：既不是必要产品证据，也违反 Runtime 的公开边界。
- Run 完成后删除详情只保留摘要：用户无法复查工具和步骤证据。
- 把 Execution Evidence 作为 Task completion evidence：Task 完成仍是授权 Actor
  的状态声明，Core 不据此判断工作质量。

<a id="adr-0061-references"></a>
### References

- [v0.17 可中断执行与持久会话证据](README.md)
- [ADR-0013: Managed Content and Read Side v2](../v0.06/decisions.md#adr-0013)
- [ADR-0049: Reproducible Context Delivery v2](../v0.12/decisions.md#adr-0049)
- [ADR-0050: Camp-Shared Progressive Summaries](../v0.12/decisions.md#adr-0050)
- [ADR-0051: Boundary-Capped Context Retrieval](../v0.12/decisions.md#adr-0051)
<!-- legacy-adr-body:end id=ADR-0061 -->
<!-- legacy-adr:end id=ADR-0061 -->

<!-- legacy-adr:begin id=ADR-0062 source-file-sha256=aaf74dba3d138087ed1076066a320a22a0bb05bd4ff46b0101a15c8d222a3011 -->
<a id="adr-0062"></a>

## ADR-0062: Interruptible Run Trees and Unsettled External Effects

迁移时原路径：`docs/adr/0062-interruptible-runs-and-unsettled-external-effects.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0062
title: "Interruptible Run Trees and Unsettled External Effects"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.17
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0062 -->
<a id="adr-0062-context"></a>
### Context

现有取消路径把“AgentRun 能否进入取消终态”与“所有 Runtime 投递、Action 或外部
效果是否已经确定”绑定在一起。只要存在 `delivery_unknown`、正在执行或结果未知的
外部操作，Core 就可能拒绝取消，界面因此长期停留在运行中，用户也无法恢复发送。

这混淆了两个不同事实：

1. Rovai-ai 是否仍允许这棵执行树继续产生消息、Team Tool 调用和后续 Run；
2. 已经交给外部 Runtime 或工具的操作是否真正停止、是否产生了不可撤销效果。

Rovai-ai 可以可靠地终止自己的执行权和后续提交，却不能承诺撤销已经交给外部系统
的副作用。产品需要诚实表达这种不确定性，而不是为了等待确定结果而拒绝用户停止。

<a id="adr-0062-decision"></a>
### Decision

<a id="adr-0062-stop-作用于整个-campturn-执行树"></a>
#### Stop 作用于整个 CampTurn 执行树

用户停止一个活动 CampTurn 时，Core 对该 CampTurn 内所有非终态 AgentRun 以及由其
A2A 派生的后代建立同一取消意图。取消请求一旦被 Core 接受：

- 立即提升相关 Run 的 execution fence/epoch，使旧回调失去写权限；
- 禁止这些 Run 再写公共最终消息、Execution Evidence、Task mutation、
  `team.post_message` 或创建新的 A2A 后代；
- 对仍连接的 Runtime 发出其原生 interrupt/cancel；
- 对排队、等待、恢复中或当前没有可中断进程的 Run 直接关闭继续执行资格；
- 幂等重复停止返回同一取消结果，不创建第二棵状态机。

停止是 CampTurn 级执行控制，不自动取消或改写 Task，不删除已经产生的消息、证据、
Approval、Action 或审计记录，也不回滚外部文件或网络效果。

<a id="adr-0062-执行终止与效果确定性分离"></a>
#### 执行终止与效果确定性分离

Run/CampTurn 在 Rovai-ai 已完成 fencing、关闭新工作入口并处理当前 Runtime
interrupt 后即可进入取消终态。未知 Runtime 投递、外部 Action、命令或工具效果留在
它们自己的权威记录中继续标记为 executing/unknown/recovery；它们不再作为
AgentRun 取消终态的 blocker。

Read Side 必须分别表达：

```text
executionState = cancelled
hasUnsettledExternalEffects = true | false
```

当第二项为真时，普通 UI 显示“已停止 · 结果待确认”及可访问的警告说明。不得把它
显示成“未执行”“已回滚”或普通成功，也不得自动重试不确定投递或外部操作。

后续恢复只能对账和收敛原记录，不能恢复已取消 Run 的执行权。迟到的 Runtime
callback 可以用于更新其对应的效果/投递记录，但不得重新产生 Agent 消息、工具调用、
A2A 或执行过程。

<a id="adr-0062-composer-解锁边界"></a>
#### Composer 解锁边界

活动 CampTurn 的 Composer 输入保持可编辑且保留草稿，发送位置改为明确的危险
“停止”操作。只有用户点击或键盘聚焦后显式激活该按钮才会停止；
`Cmd/Ctrl + Enter` 在停止态不得触发取消。

当整棵 CampTurn 执行树已经 fenced 且所有 Run 不再拥有继续执行资格时，Composer
立即恢复发送，不等待未知外部效果最终对账。新提交创建新的 CampTurn/AgentRun 和
execution epoch；旧 Run 的任何迟到回调不能写入新 Turn。

<a id="adr-0062-consequences"></a>
### Consequences

- 用户能够可靠结束卡住、等待或结果不明的执行，并继续使用 Camp。
- “停止执行”不再被错误描述为“撤销外部世界”；未知效果有独立、持久、诚实的状态。
- Core 必须把取消请求、Runtime interrupt、fencing、Run 终态和效果对账拆成可恢复
  的步骤。
- 所有消息、Team Tool、Evidence 和 Runtime callback 写路径都必须校验当前 fence。
- UI 需要同时展示取消终态与结果待确认警告，而不是一个含义过载的状态徽标。

<a id="adr-0062-rejected-alternatives"></a>
### Rejected Alternatives

- 有任一 unknown/executing 记录就拒绝取消：会永久占用 Composer，并把外部确定性
  错当成 Core 执行控制。
- 取消时把 unknown 强制改为未执行或失败：伪造事实，可能导致危险重试。
- 只停止当前前台 AgentRun：A2A 后代仍可继续写消息和创建新工作。
- 只发送进程信号而不建立 fence：迟到回调仍能污染已停止的 CampTurn。
- 等全部外部效果确定后再恢复发送：把独立的新工作无期限绑定到旧外部状态。
- 取消时自动回滚文件、Task 或网络操作：跨 Runtime 不可证明安全，也超出停止语义。

<a id="adr-0062-references"></a>
### References

- [v0.17 可中断执行与持久会话证据](README.md)
- [ADR-0001: Core Transaction](../v0.02/decisions.md#adr-0001)
- [ADR-0016: Multi-Runtime Execution Boundary v2](../v0.06/decisions.md#adr-0016)
- [ADR-0058: Collaboration v4](../v0.15/decisions.md#adr-0058)
- [ADR-0059: Runtime-Owned Resource Permissions](../v0.16/decisions.md#adr-0059)
<!-- legacy-adr-body:end id=ADR-0062 -->
<!-- legacy-adr:end id=ADR-0062 -->

<!-- legacy-adr:begin id=ADR-0063 source-file-sha256=f4ebb96e2ed04ddd2a58fcf28fe4aeb5ef17b4bc5c725caf40e4b50cc9eca0ae -->
<a id="adr-0063"></a>

## ADR-0063: Minimal A2A Turn Envelope and Trusted Reply Correlation

迁移时原路径：`docs/adr/0063-minimal-a2a-turn-envelope-and-reply-correlation.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0063
title: "Minimal A2A Turn Envelope and Trusted Reply Correlation"
status: superseded
date: 2026-07-28
decision_scope: cross-version
source_version: v0.17
supersedes: []
superseded_by: ADR-0067
```

<!-- legacy-adr-body:begin id=ADR-0063 -->
<a id="adr-0063-context"></a>
### Context

当前 ContextManifest 为每个 AgentRun 都输出 JSON `TURN_ENVELOPE`，其中包含
`campId`、`campTurnId`、`agentRunId`、`taskId`、invocation、parent Run、
reply linkage 和 trigger 等执行控制字段。这些字段由 Core 强制执行，模型既不能
改变，也不需要依赖它们完成普通用户请求。将它们暴露给模型增加噪声，并鼓励模型在
正文或工具参数中复述内部标识。

A2A 接收方确实需要知道请求来自哪个 Agent，以及后续结果应返回给谁。但
`sourceInboxMessageId`、Run lineage 和 delivery correlation 仍属于可信后台状态，
不应变成模型负责维护的协议。与此同时，显式 `team.post_message` 语义不能被
“自动回信”取代：Agent 是否发送后续消息仍由它实际调用工具决定。

本 ADR 局部替代 ADR-0049“每个 AgentRun 都包含 Turn Envelope”及 Turn Envelope
优先占用输入预算的条款；ADR-0049 的 ContextManifest 冻结、字节级重发、Context
Read Marker、摘要和检索边界继续有效。

<a id="adr-0063-decision"></a>
### Decision

<a id="adr-0063-普通用户-run-不输出-turn-envelope"></a>
#### 普通用户 Run 不输出 Turn Envelope

由普通用户 CampMessage 触发的 AgentRun 完全省略 `[TURN_ENVELOPE]` 区段。不得输出
空区段、空 JSON、用户 sender 伪装或默认 Lead 接收说明。

Core 继续在 ContextManifest 和权威 Run 记录中冻结执行控制元数据，但 formatter
不把这些字段放入模型载荷。安全、身份、权限、配额、fencing、Task association 和
触发关系仍由 Core 执行，不依赖 prompt。

<a id="adr-0063-a2a-run-只输出最小来源说明"></a>
#### A2A Run 只输出最小来源说明

只有 InboxMessage/A2A 触发的 AgentRun 输出以下文本区段：

```text
[TURN_ENVELOPE]
From {{senderName}} ({{senderId}}); return results or follow-ups to the same agent.
[/TURN_ENVELOPE]
```

- `senderName` 是组装时由 Core 解析的发送 Agent 显示名称；
- `senderId` 是发送 AgentProfile 的权威稳定 ID；
- 两者随 ContextManifest payload 冻结，重发同一 Run 时字节不变；
- 文本不得由消息正文或 LLM 参数提供；
- 区段中不再出现 JSON，也不出现 Camp、CampTurn、AgentRun、parent/root Run、
  execution epoch、Task、trigger、reply message 或 Inbox correlation ID。

`sourceInboxMessageId` 不得通过 `CURRENT_INPUT`、Work Brief 或其他模型区段旁路泄漏。
模型需要做出的唯一协作判断是：若要把结果或追问发回来源 Agent，显式调用
`team.post_message` 并选择该 Agent。

<a id="adr-0063-reply-linkage-由后台补全"></a>
#### Reply linkage 由后台补全

Core 在 A2A target AgentRun 中保留可信的 source InboxMessage 和 sender
AgentProfile 关联，但不把该关联 ID 暴露给模型。

当且仅当以下条件同时成立时，Core 可以为一次显式 `team.post_message` 调用补全
`inReplyToMessageId`：

1. 当前 Run 由一个有效 A2A InboxMessage 触发；
2. 模型没有显式提供 `inReplyToMessageId`；
3. recipient 是该 source InboxMessage 的原发送 Agent；
4. 当前 Binding、Run、epoch、Camp membership 和 capability 校验全部通过。

补全值来自当前 Run 的可信后台关联，并与新 InboxMessage 一起原子持久化。模型显式
提供 reply linkage 时继续按既有反向关系和可见性规则校验；无效值失败关闭，不回退
到隐式关联。发给第三个 Agent 时不得套用 source reply linkage。

这只是相关性补全：

- 不自动调用 `team.post_message`；
- 不把 Agent 的普通最终回复自动发给来源 Agent；
- 不自动唤醒来源 Agent；
- 不创建额外 AgentRun；
- 不合并同一 Agent 的多次 Run 或消息；
- 不改变一次工具成功只表示“已接受执行”的既有语义。

<a id="adr-0063-context-与控制面继续分离"></a>
#### Context 与控制面继续分离

A2A parent/root/depth、CampTurn、Task、execution epoch、idempotency 和配额仍从当前
认证 Binding 与权威数据库派生。它们可以用于审计、fencing、Read Side 和恢复，但
不得要求模型在 Turn Envelope、body、references 或 Team Tool 参数中回传。

<a id="adr-0063-consequences"></a>
### Consequences

- 普通用户 Run 获得更短、更自然的动态输入，不再看到无助于推理的执行元数据。
- A2A 接收方获得明确的来源和返回方向，但不会被迫维护后台 correlation ID。
- 忘记填写 `inReplyToMessageId` 不再丢失直接回信的后台链路；显式工具调用仍是
  唯一发送动作。
- Context formatter 版本必须提升；旧 Run 恢复继续字节级使用其已冻结 payload，
  不能按新格式重组。
- Context、Team Tool 和 idempotency 测试需要同时覆盖省略、最小区段、显式关联、
  隐式补全以及第三方目标不补全。

<a id="adr-0063-rejected-alternatives"></a>
### Rejected Alternatives

- 所有 Run 保留 JSON Turn Envelope：向模型暴露无权控制且无助推理的内部字段。
- 普通用户 Run 输出空 Turn Envelope：仍然制造格式噪声和错误的协议暗示。
- 把 `sourceInboxMessageId` 写入最小区段：让模型承担本可由 Core 可靠维护的关联。
- Agent 最终回复自动返回来源 Agent：改变显式 A2A 协议并制造意外唤醒。
- 根据自然语言中的名称猜测 reply linkage：名称文本不是权威路由或关联来源。
- 对任何 recipient 都套用当前 source linkage：会产生错误的会话关系和越权侧信道。

<a id="adr-0063-references"></a>
### References

- [v0.17 可中断执行与持久会话证据](README.md)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [ADR-0049: Reproducible Context Delivery v2](../v0.12/decisions.md#adr-0049)
- [ADR-0058: Collaboration v4](../v0.15/decisions.md#adr-0058)
<!-- legacy-adr-body:end id=ADR-0063 -->
<!-- legacy-adr:end id=ADR-0063 -->
