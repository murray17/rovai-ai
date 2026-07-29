---
document_type: adr
id: ADR-0049
title: "Reproducible Context Delivery v2"
status: superseded
date: 2026-07-26
decision_scope: cross-version
source_version: v0.12
supersedes: [ADR-0009]
superseded_by: ADR-0067
---

# ADR-0049: Reproducible Context Delivery v2

> 后续局部规范：[ADR-0063](0063-minimal-a2a-turn-envelope-and-reply-correlation.md)
> 仅替代本文“每个 AgentRun 都包含 Turn Envelope”及其优先预算条款：普通用户 Run
> 省略该区段，A2A Run 使用最小来源说明。本文其余 ContextManifest、冻结重发、
> Context Read Marker、摘要与检索边界继续有效。

## Context

ADR-0009 建立了可复现上下文投递:不可变 ContextManifest、独立的 Native Binding 投递确认水位、Bootstrap/压缩路径。但它同时保留了公共消息向 Conversation 的全文物化(`conversation_message` 逐行拷贝公共前缀,`last_seen_camp_message_sequence` 作为物化游标),而该副本除充当 AgentRun 触发指针外几乎无读取方,是纯粹的存储与簿记负债。其次,"预算按模型窗口推导"在 400K 级上下文模型上退化为每次唤醒注入数百条原文,成本与长输入中段召回衰减同时失控。第三,该水位需要一个不暗示模型已经阅读或理解的正式名称;随检索工具(ADR-0051)引入,Agent 还可以主动读取 Marker 之外的历史。本 ADR 整篇替代 ADR-0009,未在此重述的旧条款不再有效;替代在本 ADR 通过评审时与状态切换原子完成。

## Decision

### Instruction layers 与输入区段(承接 ADR-0009,不变)

Adapter 自带的 System Prompt 永远保留,Rovai-ai 不读取、不替换、不当作可移植上下文。每个新 Native Session 必须追加一次 Session Charter,包含 AgentProfile 身份与指令、稳定 Collaboration Contract、Team Tool 使用边界和升级给用户或 Default Lead 的规则;Adapter 优先使用原生追加指令能力,只有替换能力时不得替换,而是在该 Session 首次 AgentRun 输入前附加;不为 Charter 单独产生模型调用。每个 AgentRun 的动态输入由以下区段组成:

```text
Turn Envelope
Collaboration State
Control Signals
Shared Conversation Updates
[WORK_BRIEF] ... [/WORK_BRIEF]
Current Input + Attachment Metadata
```

公共消息、附件名称等用户/Agent 内容始终作为带明确来源的非系统内容编码,不得提升为 Charter 或 System Prompt。预算优先保证 Current Input、Turn Envelope、Work Brief 和关键 Control Signals;成员清单首次完整注入,之后仅在成员状态摘要变化时更新,本轮参与成员始终可见。Adapter 提供可靠上下文上限时使用该值,否则使用保守默认值,并始终预留输出空间。Charter 是协作指导,不是安全边界;权限、身份、配额、Fencing 和副作用仍由 Rust Core 强制。

### Immutable ContextManifest(承接,含恢复协议)

每个 AgentRun 首次 Dispatch 前必须拥有唯一、不可变、可审计的 ContextManifest,至少冻结:消息边界与稳定消息 ID、使用的 `camp_summary` ID(`camp_summary_ids_json`)、Coverage Baseline 位置(如有)、当前输入及附件的稳定引用/名称/类型/大小/位置、确定性 Work Brief、Control Signals、Charter/成员状态/Formatter 版本、完整输入载荷的不可变 Blob 引用与内容摘要、Native Binding 代际与输入边界。附件正文不进入 Prompt,模型经 Runtime/Workspace 能力按权限读取。同一 AgentRun 的恢复不得从当前数据库重新拼装输入:Runtime 未确认接受时只能字节级重发同一冻结载荷;已确认接受时只能 Resume 对应 Native Session/Turn;投递结果不确定时必须先进入 `delivery_unknown` 对账,禁止盲目重发。之后出现的新消息只能触发新的 AgentRun。检索工具调用结果是运行时交互,不属于 Manifest 冻结范围,其可审计性由 ADR-0051 的边界封顶规则保证。

### Context Read Marker

该水位统一命名为 **Context Read Marker**,字段统一为 `conversation.native_read_through_camp_message_sequence`。每个当前 Native Binding 持有独立、单调的 Marker;组装时记录 `boundarySequence`;仅当 Runtime 接受输入且 Core 持久化稳定接收回执后,以 Compare-and-Set 单调推进;接受前失败不推进,之后的模型失败/取消/等待不回滚,模糊崩溃先对账。Marker 推进只证明输入被接受,不证明模型阅读或理解,也与 Agent 的检索工具读取无关。

Marker 只能跨过全部满足以下**覆盖证明**之一的连续序列:

1. 该消息原文包含在已接受输入中;
2. 覆盖该消息的 Segment/Epoch 摘要**正文**包含在已接受输入中(仅引用不算);
3. 该消息是**当前 Native Binding 代际内**由该 Agent 自身产生的公共输出——其正文已由该 Native Session 在产生时确认,无需重复投递;
4. 该消息 `sequence ≤ B`,其中 `B = coverage_baseline_sequence` 是从序号 1 起由已生成摘要连续覆盖、但未注入摘要正文的最大 `through_sequence`;且本次已接受输入的 Context Briefing 已声明 B、其前历史的有界摘要目录与无需先验关键词的分页检索入口(ADR-0051)。

### 公共消息仅引用,不物化

`camp_message` 是公共消息唯一事实源。废除公共前缀向 `conversation_message` 的物化:删除逐行拷贝、gap 校验与 `last_seen_camp_message_sequence`。AgentRun 触发指针在 `agent_run` 上表达:新增 `trigger_camp_message_id` 引用公共消息,与既有 `trigger_conversation_message_id` 互斥。约束必须兼容 A2A 延迟投递的合法中间态(目标 Run 先以 `input_ready_at IS NULL` 且双 trigger 为空存在,投递事务再补齐):

```sql
CHECK (trigger_camp_message_id IS NULL OR trigger_conversation_message_id IS NULL)
CHECK (input_ready_at IS NULL
       OR trigger_camp_message_id IS NOT NULL
       OR trigger_conversation_message_id IS NOT NULL)
```

`context_manifest` 不新增触发字段,冻结职责由载荷 Blob 承担。`conversation_message` 回归纯私有内容:A2A InboxMessage 投递结果与运行产物。历史 camp 来源行按 `source_camp_message_id` 映射迁移触发指针后删除。

### 统一投递组成算法与软预算

公共上下文软预算 = min(Adapter 推导切片, 60,000 字符),约束投递中的**原文部分**;摘要正文注入另设 **24,000 字符**预算。正常路径与 Bootstrap 共用同一组成算法,Bootstrap 只是未读区间为全史(新 Binding 的 Marker 为 0)的特例:

1. 设未读区间 U = (Marker, boundary]。未读原文总量在软预算内时全部原文投递,预算内不得以摘要替代原文,算法终止。
2. 否则(溢出/Bootstrap):自 boundary 向旧注入覆盖 U 的 Segment/Epoch 摘要**正文**,直至摘要注入预算耗尽;未能注入的更旧已覆盖连续前缀落入 **Coverage Baseline**。`coverage_baseline_sequence = B` 取该前缀的最大 `through_sequence`,精确覆盖 `sequence ≤ B`;B、其前有界摘要目录与无需先验关键词的分页检索入口必须写入 Context Briefing(覆盖证明 4)。
3. 摘要前沿之后的**未覆盖尾部全部原文注入**——未覆盖序列不得因任何组成规则被静默跳过;其规模受 ADR-0050 关段规则约束(达到可生成规模时先走按需生成)。
4. 无论是否被摘要覆盖,最近 30 条始终原文注入。
5. **点名保证**:U 内点名当前 Agent 或回复其消息的条目,若未包含于上述原文部分,额外原文注入,上限 20 条;超出部分在 Context Briefing 中以引用列出并标注省略数。
6. 注入 Context Briefing。

所需摘要缺失且已达可生成规模时进入 `waiting(context_compaction)`(等待者语义见 ADR-0050);摘要就绪后必需区段仍超模型预算则 `waiting(context_overloaded)`。系统不得在残缺上下文上静默执行。

### Context Briefing

系统派生、无 LLM 参与的结构化定位区段,仅注入 Bootstrap 与溢出路径,总量 ≤ 8,000 字符,各区段有独立条数上限,截断必须显式标注 `truncated` 与省略数,不得静默丢弃。内容分两类一致性:

- **序号锚定区段**(封顶 Manifest boundary:消息 `sequence ≤ boundary`,摘要 `through ≤ boundary`):未读区间(序号与时间跨度)及覆盖摘要清单、Coverage Baseline 声明(位置、其前摘要目录、检索入口)、未读范围内各发送者消息计数、未读范围引用标识符聚合(≤ 20 项)、涉及本 Agent 的未读消息清单(≤ 20 条)、全史摘要目录统计、Bootstrap 专属的本 Agent 上次公开发言位置。
- **状态区段**(组装时点快照,随 Manifest 冻结,不承诺 as-of-boundary 一致性——与 ADR-0012 Task Context 同语义,且 `team.list_tasks` 本就暴露活状态):本 Agent 的 open Task 与 Camp open 总数(各 ≤ 10 条)、本 Agent 发起且 pending 的 ActionRequest(≤ 10 条)。

用户审批决定与 Task 状态变更以 `author_type='system'` 的 CampMessage 落入公共消息流,由 Marker、摘要与搜索统一覆盖,不设 recentEvents 旁路。

### 可见性与去重(承接并收窄)

CampMessage 对所有当前有效 CampMember 可见;Addressing/Reply 只影响路由,不是 ACL。私有 A2A 内容经 InboxMessage 进入目标 ConversationMessage,不自动变成公共消息。原文增量保留用户公共消息、其他 Agent 公共最终回复与公开 Connector 消息;排除 thinking/stream/草稿、内部日志与无权查看的私有内容。"排除自身旧回复"**限定于当前 Native Binding 代际内产生的自身输出**(与覆盖证明 3 严格同域);旧代际的自身消息对新 Session 是未见历史,与其他成员消息同等按原文或摘要投递。当前输入已包含在增量中不得再次附加;因权限过滤未包含的,不得用 fallback 绕过权限。Camp 级共享摘要以中立第三人称复述全体成员发言,不受该排除规则约束(见 ADR-0050)。

## Consequences

- 每次唤醒的原文注入被软预算封顶、摘要注入被独立预算封顶,Camp 无限增长时输入仍有界;历史深度经 Coverage Baseline 转化为"可检索"而非"必注入"。
- 公共消息存储去重,双游标簿记收敛为单一 Context Read Marker;四种覆盖证明与统一组成算法保证任何路径下 Marker 无永久缺口。
- 触发指针多态化并兼容 A2A 延迟投递中间态;`load_current_input` 按来源分支读取 `camp_message`(含 tombstone 过滤)或 `conversation_message`。
- briefing 两类一致性是显式让步:任务与审批区段为组装时点快照,不提供 as-of-sequence 历史投影。
- 溢出路径依赖 ADR-0050 的摘要就绪度与关段规则的配套关系;briefing、基线声明与点名保证增加组装分支与截断标注的实现复杂度。
- 术语与字段更名波及文档、代码与既有测试;既有有效 ADR 中对 ADR-0009 的规范性引用在本 ADR 通过时随状态切换一并改指(见 v0.12 实施计划切换清单)。

## Rejected Alternatives

- 每轮重发完整公共历史;复用物化游标充当投递游标(承 ADR-0009)。
- 保留物化行仅置空正文,或仅物化触发消息:留下半套物化机器。
- 纯 briefing + 全拉取投递:懒 Agent 缺上下文即行动,Manifest 丧失"Run 知道什么"的审计力。
- 预算继续按模型窗口推导:400K 窗口下成本与注意力质量双输。
- Bootstrap 注入全部历史摘要以满足覆盖证明:Epoch 数量随 Camp 无限增长,必然超出任何预算;由 Coverage Baseline 取代。
- 为凑足摘要覆盖对不足规模的尾部生成碎片摘要:被"未覆盖尾部全部原文注入"取代。
- 无条件排除自身旧回复:换绑后旧代际自身消息失去一切覆盖来源,形成 Marker 永久缺口。
- Task/ActionRequest 的 as-of-sequence 历史投影:需要为任务域引入事件溯源,而 `team.list_tasks` 本就暴露活状态,boundary 封顶的目的(阻断未来消息侧信道)不适用于状态快照。
- 将 Marker 命名为阅读证明,或继续保留已经废弃的旧术语。

## References

- [v0.12 版本文档](../versions/v0.12/README.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](0009-reproducible-context-delivery.md)(本 ADR 通过时整篇替代)
- [ADR-0012: Collaboration v3](0012-collaboration-v3-lightweight-task.md)(Task Context 冻结语义)
- [ADR-0050: Camp-Shared Progressive Summaries](0050-camp-shared-progressive-summaries.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
