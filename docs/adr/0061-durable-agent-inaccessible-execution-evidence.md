---
document_type: adr
id: ADR-0061
title: "Durable User-Visible and Agent-Inaccessible Execution Evidence"
status: accepted
date: 2026-07-28
decision_scope: cross-version
source_version: v0.17
supersedes: []
superseded_by: null
---

# ADR-0061: Durable User-Visible and Agent-Inaccessible Execution Evidence

## Context

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

## Decision

### Execution Evidence 是 AgentRun 的独立权威记录

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

### 用户可见不等于 Agent 可用

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

### 大内容使用 Managed Blob

SQLite 保存规范化展示字段、有界 preview、内容摘要、字节数、截断标记和可选
Managed Blob 引用。较大的工具结果、命令输出或文件变更内容写入
ADR-0013 的 Managed Blob Store；Blob 引用是权威 GC root，直到所属 Camp 被永久
删除。

截断必须显式。UI 不得把 preview 表现为完整结果，也不得为了展示方便静默丢弃
“原内容更长”这一事实。Renderer 只能通过受控 Core API 读取授权 Camp 中的
Evidence 内容，不能取得 Blob 文件路径或直接读取 SQLite。

### Read Side 与生命周期

Execution Evidence 是权威表，不是 event replay 生成的第二投影。Camp snapshot
或专用分页 Read Side 在同一授权和 schema-version 边界下读取它；实时订阅只用于
增量失效和低延迟展示，断线或重启后必须能从 SQLite 恢复。

记录为追加式事实。允许按稳定 provider identity/内容摘要幂等合并同一通知，但不得
因 Run 完成、用户折叠、重新打开 Camp 或 App 重启而删除。它与所属 Camp 同生命周期：
永久删除 Camp 时一起删除，其 Managed Blob 引用随后按现有 GC 规则回收。

### 展示与安全渲染

每个 AgentRun 拥有独立的执行披露区，邻接该 Run 的最终回复或运行状态。运行中默认
展开；Run 进入终态后默认折叠为带时长和结果的摘要，用户可随时重新展开。

reasoning summary、narration、plan、step 和 Agent 最终回复可使用安全 GFM 展示；
原始 HTML、脚本、事件属性和嵌入式远程内容禁用。工具、命令、文件变更及其结果使用
结构化证据组件，不把任意内容当 Markdown 执行。用户消息保持精确纯文本、可选择且
可复制。

## Consequences

- 用户离开、重启或稍后返回后仍能检查同一 Run 的执行过程。
- Agent 上下文不会因工具输出和 reasoning summary 污染或自我引用。
- SQLite、Read Model、Contracts、Managed Blob GC 和 Renderer 都需要新增明确
  Evidence 合同。
- 高频通知需要规范化、幂等和容量控制；大内容读取需要分页或按需加载。
- “用户看得到”不能再被实现为 CampMessage；新增内容路径必须主动选择正确领域。

## Rejected Alternatives

- 继续只存在 Renderer 内存：无法跨导航、断线和重启恢复。
- 写入 CampMessage 后在搜索时过滤：遗漏任何摘要、A2A 或上下文路径都会泄漏。
- 保存 provider 原始事件包：协议不稳定、可能包含不应展示的内部字段，且无法形成
  跨 Runtime 的稳定 UI 合同。
- 保存原始隐藏思维链：既不是必要产品证据，也违反 Runtime 的公开边界。
- Run 完成后删除详情只保留摘要：用户无法复查工具和步骤证据。
- 把 Execution Evidence 作为 Task completion evidence：Task 完成仍是授权 Actor
  的状态声明，Core 不据此判断工作质量。

## References

- [v0.17 可中断执行与持久会话证据](../versions/v0.17/README.md)
- [ADR-0013: Managed Content and Read Side v2](0013-managed-content-and-read-side-v2.md)
- [ADR-0049: Reproducible Context Delivery v2](0049-reproducible-context-delivery-v2.md)
- [ADR-0050: Camp-Shared Progressive Summaries](0050-camp-shared-progressive-summaries.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
