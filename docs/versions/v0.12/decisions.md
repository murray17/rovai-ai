---
document_type: version-decisions
version: v0.12
lifecycle: historical
last_updated: 2026-08-18
---

# v0.12 决策记录

本文件按来源版本聚合迁移前的数字 ADR，保存当时的背景、选择、后果与被拒绝方案。它是历史理由来源，不是当前系统规范真源；当前规范从 [文档导航](../../README.md) 进入。

## 历史 ADR 索引

| 历史 ID | 决策 | 迁移时状态 |
| --- | --- | --- |
| [ADR-0049](#adr-0049) | Reproducible Context Delivery v2 | `superseded` |
| [ADR-0050](#adr-0050) | Camp-Shared Progressive Summaries | `superseded` |
| [ADR-0051](#adr-0051) | Boundary-Capped Context Retrieval | `accepted` |

<!-- legacy-adr:begin id=ADR-0049 source-file-sha256=22b30f74db5a2dc92d71835b342125458702ed9f7ea8fd6fd4e0c1256babb3d0 -->
<a id="adr-0049"></a>

## ADR-0049: Reproducible Context Delivery v2

迁移时原路径：`docs/adr/0049-reproducible-context-delivery-v2.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0049
title: "Reproducible Context Delivery v2"
status: superseded
date: 2026-07-26
decision_scope: cross-version
source_version: v0.12
supersedes: [ADR-0009]
superseded_by: ADR-0067
```

<!-- legacy-adr-body:begin id=ADR-0049 -->
> 后续局部规范：[ADR-0063](../v0.17/decisions.md#adr-0063)
> 仅替代本文“每个 AgentRun 都包含 Turn Envelope”及其优先预算条款：普通用户 Run
> 省略该区段，A2A Run 使用最小来源说明。本文其余 ContextManifest、冻结重发、
> Context Read Marker、摘要与检索边界继续有效。

<a id="adr-0049-context"></a>
### Context

ADR-0009 建立了可复现上下文投递:不可变 ContextManifest、独立的 Native Binding 投递确认水位、Bootstrap/压缩路径。但它同时保留了公共消息向 Conversation 的全文物化(`conversation_message` 逐行拷贝公共前缀,`last_seen_camp_message_sequence` 作为物化游标),而该副本除充当 AgentRun 触发指针外几乎无读取方,是纯粹的存储与簿记负债。其次,"预算按模型窗口推导"在 400K 级上下文模型上退化为每次唤醒注入数百条原文,成本与长输入中段召回衰减同时失控。第三,该水位需要一个不暗示模型已经阅读或理解的正式名称;随检索工具(ADR-0051)引入,Agent 还可以主动读取 Marker 之外的历史。本 ADR 整篇替代 ADR-0009,未在此重述的旧条款不再有效;替代在本 ADR 通过评审时与状态切换原子完成。

<a id="adr-0049-decision"></a>
### Decision

<a id="adr-0049-instruction-layers-与输入区段承接-adr-0009不变"></a>
#### Instruction layers 与输入区段(承接 ADR-0009,不变)

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

<a id="adr-0049-immutable-contextmanifest承接含恢复协议"></a>
#### Immutable ContextManifest(承接,含恢复协议)

每个 AgentRun 首次 Dispatch 前必须拥有唯一、不可变、可审计的 ContextManifest,至少冻结:消息边界与稳定消息 ID、使用的 `camp_summary` ID(`camp_summary_ids_json`)、Coverage Baseline 位置(如有)、当前输入及附件的稳定引用/名称/类型/大小/位置、确定性 Work Brief、Control Signals、Charter/成员状态/Formatter 版本、完整输入载荷的不可变 Blob 引用与内容摘要、Native Binding 代际与输入边界。附件正文不进入 Prompt,模型经 Runtime/Workspace 能力按权限读取。同一 AgentRun 的恢复不得从当前数据库重新拼装输入:Runtime 未确认接受时只能字节级重发同一冻结载荷;已确认接受时只能 Resume 对应 Native Session/Turn;投递结果不确定时必须先进入 `delivery_unknown` 对账,禁止盲目重发。之后出现的新消息只能触发新的 AgentRun。检索工具调用结果是运行时交互,不属于 Manifest 冻结范围,其可审计性由 ADR-0051 的边界封顶规则保证。

<a id="adr-0049-context-read-marker"></a>
#### Context Read Marker

该水位统一命名为 **Context Read Marker**,字段统一为 `conversation.native_read_through_camp_message_sequence`。每个当前 Native Binding 持有独立、单调的 Marker;组装时记录 `boundarySequence`;仅当 Runtime 接受输入且 Core 持久化稳定接收回执后,以 Compare-and-Set 单调推进;接受前失败不推进,之后的模型失败/取消/等待不回滚,模糊崩溃先对账。Marker 推进只证明输入被接受,不证明模型阅读或理解,也与 Agent 的检索工具读取无关。

Marker 只能跨过全部满足以下**覆盖证明**之一的连续序列:

1. 该消息原文包含在已接受输入中;
2. 覆盖该消息的 Segment/Epoch 摘要**正文**包含在已接受输入中(仅引用不算);
3. 该消息是**当前 Native Binding 代际内**由该 Agent 自身产生的公共输出——其正文已由该 Native Session 在产生时确认,无需重复投递;
4. 该消息 `sequence ≤ B`,其中 `B = coverage_baseline_sequence` 是从序号 1 起由已生成摘要连续覆盖、但未注入摘要正文的最大 `through_sequence`;且本次已接受输入的 Context Briefing 已声明 B、其前历史的有界摘要目录与无需先验关键词的分页检索入口(ADR-0051)。

<a id="adr-0049-公共消息仅引用不物化"></a>
#### 公共消息仅引用,不物化

`camp_message` 是公共消息唯一事实源。废除公共前缀向 `conversation_message` 的物化:删除逐行拷贝、gap 校验与 `last_seen_camp_message_sequence`。AgentRun 触发指针在 `agent_run` 上表达:新增 `trigger_camp_message_id` 引用公共消息,与既有 `trigger_conversation_message_id` 互斥。约束必须兼容 A2A 延迟投递的合法中间态(目标 Run 先以 `input_ready_at IS NULL` 且双 trigger 为空存在,投递事务再补齐):

```sql
CHECK (trigger_camp_message_id IS NULL OR trigger_conversation_message_id IS NULL)
CHECK (input_ready_at IS NULL
       OR trigger_camp_message_id IS NOT NULL
       OR trigger_conversation_message_id IS NOT NULL)
```

`context_manifest` 不新增触发字段,冻结职责由载荷 Blob 承担。`conversation_message` 回归纯私有内容:A2A InboxMessage 投递结果与运行产物。历史 camp 来源行按 `source_camp_message_id` 映射迁移触发指针后删除。

<a id="adr-0049-统一投递组成算法与软预算"></a>
#### 统一投递组成算法与软预算

公共上下文软预算 = min(Adapter 推导切片, 60,000 字符),约束投递中的**原文部分**;摘要正文注入另设 **24,000 字符**预算。正常路径与 Bootstrap 共用同一组成算法,Bootstrap 只是未读区间为全史(新 Binding 的 Marker 为 0)的特例:

1. 设未读区间 U = (Marker, boundary]。未读原文总量在软预算内时全部原文投递,预算内不得以摘要替代原文,算法终止。
2. 否则(溢出/Bootstrap):自 boundary 向旧注入覆盖 U 的 Segment/Epoch 摘要**正文**,直至摘要注入预算耗尽;未能注入的更旧已覆盖连续前缀落入 **Coverage Baseline**。`coverage_baseline_sequence = B` 取该前缀的最大 `through_sequence`,精确覆盖 `sequence ≤ B`;B、其前有界摘要目录与无需先验关键词的分页检索入口必须写入 Context Briefing(覆盖证明 4)。
3. 摘要前沿之后的**未覆盖尾部全部原文注入**——未覆盖序列不得因任何组成规则被静默跳过;其规模受 ADR-0050 关段规则约束(达到可生成规模时先走按需生成)。
4. 无论是否被摘要覆盖,最近 30 条始终原文注入。
5. **点名保证**:U 内点名当前 Agent 或回复其消息的条目,若未包含于上述原文部分,额外原文注入,上限 20 条;超出部分在 Context Briefing 中以引用列出并标注省略数。
6. 注入 Context Briefing。

所需摘要缺失且已达可生成规模时进入 `waiting(context_compaction)`(等待者语义见 ADR-0050);摘要就绪后必需区段仍超模型预算则 `waiting(context_overloaded)`。系统不得在残缺上下文上静默执行。

<a id="adr-0049-context-briefing"></a>
#### Context Briefing

系统派生、无 LLM 参与的结构化定位区段,仅注入 Bootstrap 与溢出路径,总量 ≤ 8,000 字符,各区段有独立条数上限,截断必须显式标注 `truncated` 与省略数,不得静默丢弃。内容分两类一致性:

- **序号锚定区段**(封顶 Manifest boundary:消息 `sequence ≤ boundary`,摘要 `through ≤ boundary`):未读区间(序号与时间跨度)及覆盖摘要清单、Coverage Baseline 声明(位置、其前摘要目录、检索入口)、未读范围内各发送者消息计数、未读范围引用标识符聚合(≤ 20 项)、涉及本 Agent 的未读消息清单(≤ 20 条)、全史摘要目录统计、Bootstrap 专属的本 Agent 上次公开发言位置。
- **状态区段**(组装时点快照,随 Manifest 冻结,不承诺 as-of-boundary 一致性——与 ADR-0012 Task Context 同语义,且 `team.list_tasks` 本就暴露活状态):本 Agent 的 open Task 与 Camp open 总数(各 ≤ 10 条)、本 Agent 发起且 pending 的 ActionRequest(≤ 10 条)。

用户审批决定与 Task 状态变更以 `author_type='system'` 的 CampMessage 落入公共消息流,由 Marker、摘要与搜索统一覆盖,不设 recentEvents 旁路。

<a id="adr-0049-可见性与去重承接并收窄"></a>
#### 可见性与去重(承接并收窄)

CampMessage 对所有当前有效 CampMember 可见;Addressing/Reply 只影响路由,不是 ACL。私有 A2A 内容经 InboxMessage 进入目标 ConversationMessage,不自动变成公共消息。原文增量保留用户公共消息、其他 Agent 公共最终回复与公开 Connector 消息;排除 thinking/stream/草稿、内部日志与无权查看的私有内容。"排除自身旧回复"**限定于当前 Native Binding 代际内产生的自身输出**(与覆盖证明 3 严格同域);旧代际的自身消息对新 Session 是未见历史,与其他成员消息同等按原文或摘要投递。当前输入已包含在增量中不得再次附加;因权限过滤未包含的,不得用 fallback 绕过权限。Camp 级共享摘要以中立第三人称复述全体成员发言,不受该排除规则约束(见 ADR-0050)。

<a id="adr-0049-consequences"></a>
### Consequences

- 每次唤醒的原文注入被软预算封顶、摘要注入被独立预算封顶,Camp 无限增长时输入仍有界;历史深度经 Coverage Baseline 转化为"可检索"而非"必注入"。
- 公共消息存储去重,双游标簿记收敛为单一 Context Read Marker;四种覆盖证明与统一组成算法保证任何路径下 Marker 无永久缺口。
- 触发指针多态化并兼容 A2A 延迟投递中间态;`load_current_input` 按来源分支读取 `camp_message`(含 tombstone 过滤)或 `conversation_message`。
- briefing 两类一致性是显式让步:任务与审批区段为组装时点快照,不提供 as-of-sequence 历史投影。
- 溢出路径依赖 ADR-0050 的摘要就绪度与关段规则的配套关系;briefing、基线声明与点名保证增加组装分支与截断标注的实现复杂度。
- 术语与字段更名波及文档、代码与既有测试;既有有效 ADR 中对 ADR-0009 的规范性引用在本 ADR 通过时随状态切换一并改指(见 v0.12 实施计划切换清单)。

<a id="adr-0049-rejected-alternatives"></a>
### Rejected Alternatives

- 每轮重发完整公共历史;复用物化游标充当投递游标(承 ADR-0009)。
- 保留物化行仅置空正文,或仅物化触发消息:留下半套物化机器。
- 纯 briefing + 全拉取投递:懒 Agent 缺上下文即行动,Manifest 丧失"Run 知道什么"的审计力。
- 预算继续按模型窗口推导:400K 窗口下成本与注意力质量双输。
- Bootstrap 注入全部历史摘要以满足覆盖证明:Epoch 数量随 Camp 无限增长,必然超出任何预算;由 Coverage Baseline 取代。
- 为凑足摘要覆盖对不足规模的尾部生成碎片摘要:被"未覆盖尾部全部原文注入"取代。
- 无条件排除自身旧回复:换绑后旧代际自身消息失去一切覆盖来源,形成 Marker 永久缺口。
- Task/ActionRequest 的 as-of-sequence 历史投影:需要为任务域引入事件溯源,而 `team.list_tasks` 本就暴露活状态,boundary 封顶的目的(阻断未来消息侧信道)不适用于状态快照。
- 将 Marker 命名为阅读证明,或继续保留已经废弃的旧术语。

<a id="adr-0049-references"></a>
### References

- [v0.12 版本文档](README.md)
- [ADR-0009: Reproducible Context Materialization and Delivery](../v0.05/decisions.md#adr-0009)(本 ADR 通过时整篇替代)
- [ADR-0012: Collaboration v3](../v0.06/decisions.md#adr-0012)(Task Context 冻结语义)
- [ADR-0050: Camp-Shared Progressive Summaries](decisions.md#adr-0050)
- [ADR-0051: Boundary-Capped Context Retrieval](decisions.md#adr-0051)
<!-- legacy-adr-body:end id=ADR-0049 -->
<!-- legacy-adr:end id=ADR-0049 -->

<!-- legacy-adr:begin id=ADR-0050 source-file-sha256=8859a7082741d05adbda5fdf73f3afb650ec91cd9f9722ab6f0b3d6519c56bb4 -->
<a id="adr-0050"></a>

## ADR-0050: Camp-Shared Progressive Summaries

迁移时原路径：`docs/adr/0050-camp-shared-progressive-summaries.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0050
title: "Camp-Shared Progressive Summaries"
status: superseded
date: 2026-07-26
decision_scope: cross-version
source_version: v0.12
supersedes: []
superseded_by: ADR-0129
```

<!-- legacy-adr-body:begin id=ADR-0050 -->
> 本决策已由 [ADR-0129](../v0.44/decisions.md#adr-0129) 完整替代。
> Segment/Epoch Summary、覆盖区间、生成调度、持久化和 AgentRun 摘要注入均不再构成当前约束。

<a id="adr-0050-context"></a>
### Context

旧 `context_summary` 是 per-Conversation 产物:同一段公共历史要为 N 个成员各生成一次,索引与搜索必须按成员隔离,且生成只在投递需要时同步发生——长期积压会让某次唤醒当场偿还全部摘要债务。公共消息本身对全体 CampMember 可见,视角隔离并无 ACL 依据。需要一个生成一次、全员复用、可检索、生成与投递解耦,覆盖关系由 schema 保证唯一可判定,且并发生成安全的摘要层。

<a id="adr-0050-decision"></a>
### Decision

<a id="adr-0050-camp-级共享与两级封顶"></a>
#### Camp 级共享与两级封顶

新表 `camp_summary` 归属 Camp,`level ∈ {segment, epoch}`,行不可变,记录覆盖序号区间 `[from, through]`、`source_digest`、`input_truncated` 标志、正文与生成者元数据(Adapter/Model/版本/时间)。摘要以中立第三人称复述全体成员发言;Segment 正文 ≤ 2,000 字符,Epoch 正文 ≤ 4,000 字符。层级两级封顶:Epoch 不再向上压缩。未被注入投递的旧 Epoch 不要求进入输入——其覆盖责任由 ADR-0049 的 Coverage Baseline(覆盖证明 4)承担,检索路径为 `context.search` 定位 + `context.get_summary` 全文加载(ADR-0051)。旧 per-Conversation `context_summary` 表、`visibility_scope_digest` 概念及其代码路径直接删除;新 ContextManifest 以 `camp_summary_ids_json` 引用本表。

<a id="adr-0050-覆盖分区与并发协议"></a>
#### 覆盖分区与并发协议

同层摘要对序号轴构成**严格分区**,由持久前沿与租约协议共同保证:

- **持久前沿**:`camp_summary_frontier(camp_id, level, next_from)`,每 Camp 每层一行。首段 `from = 1`;任何摘要的 `from` 必须等于其生成时刻的 `next_from`。
- **原子认领**:生成事务内读取前沿并插入非终态 attempt;部分唯一索引「`(camp_id, level, from_sequence)` WHERE 非终态」使重复认领冲突失败。attempt 携带 `lease_owner`/`lease_expires_at`(复用既有 inbox 租约惯例);租约过期后其他 Worker 可条件接管。
- **条件终态提交**:成功在同一事务内原子完成「插入 `camp_summary`(`from` = 认领值)+ 前沿 CAS 前进(`WHERE next_from = 认领值`,0 行即回滚)+ attempt 条件置 `succeeded`(`WHERE status='running' AND lease_owner = self`)」。失败同样条件置 `failed`。重试预算:自动重试 ≤ 3 次,复用同一 `from`,耗尽后进入失败升级。
- `UNIQUE(camp_id, level, from_sequence)` 与 `UNIQUE(camp_id, level, through_sequence)` 保留为兜底约束;重叠区间在此协议下不可能产生,投递器不存在多候选选择问题。
- Epoch 对 Segment 区间同样经其前沿首尾相接,并记录其覆盖的有序 Segment ID 列表(渐进输入的来源即该列表)。

<a id="adr-0050-关段规则"></a>
#### 关段规则

积压量与段输入预算一律按**完整规范化输入**的字符数计(见 source_digest 一节的序列化,含发送者、序号、回复关系与附件元数据,而非仅正文之和):

- **触发**:未覆盖积压规范化输入 ≥ 60,000 字符,或条数 ≥ 300。
- **关闭**:自 `next_from` 起按序贪心吸收消息,直至「再吸收下一条将使规范化输入超过 60,000 字符」或「已达 300 条」,即关闭生成。因越界强制关闭的段可以小于 100 条——这是唯一允许小段的路径。
- **单消息超限**:单条消息自身规范化输入 > 60,000 字符时独立成段,生成输入按确定性规则截断正文尾部至预算,`camp_summary.input_truncated = true` 并计入 `source_digest`。
- **碎片禁令(重述)**:不得为清尾主动生成未触发的段;未达触发条件的未覆盖尾部由投递侧全部原文注入(ADR-0049),不构成 Marker 缺口。
- **Epoch**:未被 Epoch 覆盖的 Segment ≥ 12 个,或其正文合计 ≥ 40,000 字符(护栏)时生成,渐进输入为有序 Segment 正文。
- 阈值单位使用字符数而非 token 数:多 Runtime 环境下本地无从获得各模型分词器。阈值为代码内常数,不做用户配置。

投递需要的区间尚无摘要且已达触发条件时按需生成;生成使用隔离的无工具压缩会话,失败不推进 Context Read Marker。

<a id="adr-0050-摘要输入契约与-source_digest"></a>
#### 摘要输入契约与 source_digest

摘要输入 = 覆盖区间内未 tombstone 的 `camp_message` 原文(含发送者、序号、回复关系)+ 附件元数据(仅名称/类型);`author_type='system'` 的事件消息计入。附件正文与任何 `conversation_message`/`inbox_message` 私有内容永不进入——这是源头不变量:不适合被摘要的内容不允许写入 `camp_message`。

`source_digest` = 对完整规范化输入的 SHA-256:覆盖区间、逐条 `{message_id, sequence, author_type, author_id, content_digest, reply_to, 附件名称/类型}`(Epoch 则为逐个 `{segment_id, from, through, body_digest}`)、截断标志及输入契约版本号;`camp_message.content_digest` 是其成分而非替代。

<a id="adr-0050-等待者模型"></a>
#### 等待者模型

`waiting(context_compaction)` 支持一对多等待:`context_compaction_waiter(attempt_id, agent_run_id UNIQUE)` 记录等待同一 attempt 的全部 AgentRun。attempt 进入终态时必须处理**全部**等待者:成功则各自恢复投递组装;失败则等待者挂到重试 attempt,重试耗尽走既有失败升级路径。并发出现的第二个等待者不新建 attempt,只追加 waiter 行。

<a id="adr-0050-生成者选择与-camp-删除"></a>
#### 生成者选择与 Camp 删除

应用级可配置**摘要模型**(AdapterInstallation + Model);未配置时,异步路径回退 Default Lead 的有效 Adapter/Model,按需兜底路径回退等待者自身的 Adapter/Model(其必然可用)。`context_compaction_attempt` 重建为锚定 `camp_id + level + 覆盖区间`,不再关联单一 AgentRun;既有经 `attempt.agent_run_id` 实现的 Camp 删除 blocker 一并迁移:Camp 删除按 `camp_id` 取消非终态 attempt,并级联删除 attempt、waiter、frontier 与 `camp_summary`。

<a id="adr-0050-删除语义预留"></a>
#### 删除语义预留

消息删除功能本版不实施。既有 `tombstoned_at` 列与全部读取过滤保留。将来实施删除时必须同步:tombstone 事务内级联标记覆盖该消息的 Segment 与 Epoch 为 stale(Epoch 因渐进输入必须随 Segment 联动),stale 摘要立即退出搜索与投递,异步重生成并排除 tombstoned 内容;且必须向用户诚实声明——已投递进 Native Session 的内容不可召回,tombstone 的隐私保证仅面向未来。

<a id="adr-0050-consequences"></a>
### Consequences

- 一段公共历史只付一次生成成本,搜索层无需成员隔离;摘要在唤醒之间预先就绪,唤醒不偿还摘要债务。
- 显式替代 ADR-0009 的"不得周期性无条件压缩":禁令的对象从**生成**收窄为**投递替代**(预算内仍必须原文,见 ADR-0049)。
- 前沿 + 租约 + 条件终态把分区、并发与幂等全部落在 schema 与事务协议层,代价是生成必须严格按序,无法乱序补段。
- 关段规则保证任何消息流都存在合法分段(含超长单消息的截断段);截断段的摘要保真度下降,由 `input_truncated` 显式暴露。
- 被抛弃的 Camp 也会产生摘要成本;阈值常数将其限制在每约 60K 字符一次调用。
- 渐进式 Epoch 存在两级有损叠加,由"摘要保留覆盖区间与源消息回读入口"兜底。
- Default Lead 回退意味着未配置摘要模型时可能用重型模型做压缩,成本次优但零配置可用。

<a id="adr-0050-rejected-alternatives"></a>
### Rejected Alternatives

- per-Conversation 视角摘要(第二人称定制):成本 ×N,索引隔离,无 ACL 依据。
- 纯惰性生成:唤醒串行偿还积压,摘要搜索在首次消费前为空。
- 同步阻塞生成:消息写入或唤醒被 LLM 调用延迟绑架。
- 仅靠双 UNIQUE 约束防重叠、无持久前沿与租约:`[1,100]` 与 `[50,150]` 可并存,双 Worker 可同时执行同一 attempt。
- attempt 仅关联单一等待 Run:并发第二等待者要么孤儿要么重复生成。
- 对超长单消息拒绝生成或拒绝写入:前者造成永久未覆盖区间,后者截断用户/Runtime 的合法长输出。
- 第三层及以上压缩、滚动全局摘要:无限上卷丢失回读锚点。
- token 阈值:引入各 Runtime 分词器依赖,本地不可靠。
- 保留旧表冻结共存:demo 阶段无审计包袱,双摘要机制徒增歧义。

<a id="adr-0050-references"></a>
### References

- [v0.12 版本文档](README.md)
- [ADR-0049: Reproducible Context Delivery v2](decisions.md#adr-0049)
- [ADR-0051: Boundary-Capped Context Retrieval](decisions.md#adr-0051)
<!-- legacy-adr-body:end id=ADR-0050 -->
<!-- legacy-adr:end id=ADR-0050 -->

<!-- legacy-adr:begin id=ADR-0051 source-file-sha256=65cbd35445117313c40730c63af498959527ecf022d64378968bcee5c3a2ebe6 -->
<a id="adr-0051"></a>

## ADR-0051: Boundary-Capped Context Retrieval

迁移时原路径：`docs/adr/0051-boundary-capped-context-retrieval.md`。以下 Front Matter 与正文来自迁移基线；状态表示迁移时的记录状态，不代表该决定在来源版本冻结时的状态。

```yaml
document_type: adr
id: ADR-0051
title: "Boundary-Capped Context Retrieval"
status: accepted
date: 2026-07-26
decision_scope: cross-version
source_version: v0.12
supersedes: []
superseded_by: null
```

<!-- legacy-adr-body:begin id=ADR-0051 -->
> [ADR-0106](../v0.40/decisions.md#adr-0106) 局部替代本文“网关层不存在
> 跨 Camp 查询”的限制，并以 ContextManifest 冻结的 Camp 集合和全局公开消息边界约束访问。
> [ADR-0108](../v0.40/decisions.md#adr-0108) 局部替代本文的
> 五个 `context.*` 工具、模型可读 Summary、相关性分页以及 window/thread 续读合同；字面量
> 查询安全、短查询有界回退、CampMessage 事实源、tombstone 过滤和硬响应预算继续有效。
> [ADR-0129](../v0.44/decisions.md#adr-0129) 进一步删除 Summary、
> Coverage Baseline 与摘要回读假设，并冻结确定性原始消息窗口；`camp.read`/`camp.search`
> 仍按 ContextManifest 上界访问原始消息，不按“已读/未读”过滤。

<a id="adr-0051-context"></a>
### Context

溢出投递(ADR-0049)与渐进摘要(ADR-0050)成立的前提是 Agent 能按需回读被压缩的历史,否则摘要替代与 Coverage Baseline 就是信息削减。但直接开放活库查询会撕开冻结边界:长 Run 中途搜到自身启动后的新消息,与"新消息只能触发新 AgentRun"冲突。rovai 消息以中文为主,SQLite FTS5 默认 `unicode61` 不切 CJK;trigram tokenizer 对少于 3 个 Unicode 字符的查询不产生命中,而"任务""审批"这类双字词是中文高频查询。消息正文本身没有长度上限(用户消息与 Runtime 最终输出仅校验非空),因此工具还必须有响应体纪律,否则"按需回读"会重新制造超大上下文。

<a id="adr-0051-decision"></a>
### Decision

<a id="adr-0051-工具组与网关"></a>
#### 工具组与网关

固定 Team MCP 网关(单一 Server,不新增进程)新增 `context.*` 工具组,与 `team.*`、`memory.*` 并列,共五个只读工具:

- `context.search`:统一搜索,内部合并消息 FTS、摘要 FTS 与精确引用查询;参数 `query`、`scope(messages|summaries|all)`、`references`、`senderIds`、`sequenceFrom/Through`、`limit` 与续取游标;`references` 精确命中优先于全文匹配。`query` 仅在 `scope=summaries` 时可省略,此时按 `through_sequence` 降序分页列举可见摘要,作为 Coverage Baseline 无需先验关键词的目录入口。
- `context.get_message`:按 ID 读单条消息(正文、附件元数据、引用、回复指向);支持 `bodyOffset`/`bodyLimit` 分段续读超长正文。
- `context.get_message_window`:按序号返回目标消息前后连续邻域,保护问答/提案-批准等时间相邻语义链。
- `context.get_message_thread`:返回根消息与可见回复;回复链是逻辑相邻,与 window 不可互代。
- `context.get_summary`:按摘要 ID 返回 Segment/Epoch 全文正文、层级、覆盖区间与 `source_digest`——Coverage Baseline 之前历史的加载路径:`context.search` 定位,本工具取全文。

`get_unread_camp_context` 不是 Agent 工具:唤醒组装是 Core 职责(ADR-0049),其产物由 ContextManifest 冻结。五个工具均只读、不设新 Capability(公共消息对全员可见);Camp 由当前 Run 的 fence 决定,工具无 `campId` 参数,跨 Camp 查询在网关层不存在。

<a id="adr-0051-输出纪律"></a>
#### 输出纪律

条数与字节双重上限;任何截断都必须显式可见,并给出续取方式:

- **单条正文注入上限 4,000 字符**:任何工具返回的单条消息正文超出即截断,标注 `bodyTruncated: true` 与 `bodyLength`(全文字符数);全文经 `context.get_message` 的 `bodyOffset`/`bodyLimit`(单次 ≤ 4,000)分段续读。
- **单次响应总量上限 16,000 字符**(含正文、片段与元数据):达到即截断剩余条目并返回续取游标(window/thread 为已返回的最后序号,search 为已返回条数)。
- **附件元数据**每条消息 ≤ 10 项,超出标注省略数。
- 条数上限与排序:`context.search` `limit` 默认 10、最大 20,片段 ≤ 200 字符,排序「引用精确命中 → BM25 相关性 → 序号降序」;`context.get_message_window` `before`/`after` 各默认 10、最大 25,序号升序;`context.get_message_thread` 序号升序、单次 ≤ 100 条,凭 `sequenceFrom` 续取;`context.get_summary` 单条全文(正文由 ADR-0050 保证 ≤ 4,000 字符)。
- 截断标注的统一形态为 `truncated` + 省略数;唯一例外见"短查询回退"(有界扫描无法得知精确省略数)。

<a id="adr-0051-冻结边界封顶与-tombstone-例外"></a>
#### 冻结边界封顶与 tombstone 例外

所有工具结果硬性满足 `sequence ≤` 当前 Run Manifest 的 `camp_message_boundary_sequence`;回复链与邻域窗口同样过滤;Segment/Epoch 摘要(含 `context.get_summary`)仅当 `through ≤ boundary` 时可见,部分越界的摘要整条不可见。唯一例外:tombstone **永远实时过滤**——Run 启动后被 tombstone 的消息立即从工具结果消失,隐私安全压过可复现性。工具调用结果是运行时交互,不进入 Manifest 冻结范围;可审计性由封顶与 tombstone 两条规则保证。

<a id="adr-0051-中文检索短查询回退与转义"></a>
#### 中文检索、短查询回退与转义

FTS 使用 FTS5 **trigram** tokenizer。查询串一律作为**字面量**处理:FTS `MATCH` 侧将整个查询包装为带引号短语(内部引号成对转义),用户输入不解析为 FTS 语法(`OR`/`NEAR`/`*` 等无特殊含义);`LIKE` 侧使用 `ESCAPE '\'` 并转义 `%`、`_`、`\`。

归一化后不足 3 个 Unicode 字符的查询,FTS `MATCH` 不产生命中,`context.search` 必须自动回退为有界 `LIKE` 子串扫描:范围锁定当前 Camp + `sequence ≤ boundary` + tombstone 过滤,按序号降序扫描,命中达 `limit` 或扫描达 10,000 行即止。有界扫描无法得知精确省略数,结果以 `scanBounded: true` + `scannedThroughSequence` + `hasMore` 表达(这是"截断必须返回省略数"规则的显式例外)。`references` 精确查询不受查询长度影响。边界、tombstone、双字中文查询与转义必须有专项测试。

<a id="adr-0051-派生索引层"></a>
#### 派生索引层

索引层全部为可重建派生数据,`camp_message` 与 `camp_summary` 始终是事实源;单行 meta 记录 `index_version`,抽取规则升级时整层重建,重建结果必须与增量维护一致:

| 结构 | 内容 |
|---|---|
| `camp_message_fts` | FTS5 trigram,external-content 挂 `camp_message.body`,与 tombstone 同步 |
| `camp_summary_fts` | FTS5 trigram 挂 `camp_summary.body` |
| `camp_message_reference` | 写入事务内抽取:文本模式 `ADR-\d+`、`PR-\d+`、`issue-\d+`(大小写归一,不做内部实体外键解析);以及消息文本中出现的完整 UUID 与 `task.id` 精确比对,命中才记入(`kind='task'`) |
| `camp_message_mention` | 自既有 `addressed_agent_profile_ids_json` 派生的点名索引 |

Task ID 是 UUID,不存在 `task-\d+` 形态的真实标识符,该模式不抽取。不建统一 `message_search_document` 中间表——消息与摘要的统一在 `context.search` 网关代码内完成。附件复用既有 `message_attachment` 表。`camp_message` 新增 `content_digest`(正文 SHA-256),历史行回填,作为 ADR-0050 `source_digest` 的成分与索引重建校验依据。

<a id="adr-0051-consequences"></a>
### Consequences

- trigram 令中英文混合内容可搜索且加速 ≥ 3 字符的 LIKE;双字中文查询由有界顺序扫描兜底,大 Camp 下短查询可能不完整(`scanBounded`/`hasMore` 显式暴露)。索引体积约为正文 3 倍,本地单机可接受。
- 边界封顶使检索不构成越过冻结边界的侧信道;用户紧急纠正必须走取消/新 Run/Control Signal 通道。
- 条数与字节双上限使单次工具响应 ≤ 16,000 字符;超长正文与长回复链靠续读游标分次获取,Agent 以多次调用换深度。
- Task 引用依赖消息文本包含完整 UUID;口语化提及(如"那个部署任务")不入引用索引,由全文搜索兜底。
- `index_version` 保证抽取规则升级(如未来加入文件路径)可随时整层重建补抽。
- briefing 的点名清单(ADR-0049)依赖 `camp_message_mention`,两者同版实施。

<a id="adr-0051-rejected-alternatives"></a>
### Rejected Alternatives

- 活库无界查询:撕开冻结边界,执行顺序不可推理。
- 工具 `get_unread_camp_context`:Marker 在输入接受时已推进,Run 存活期内未读恒为空集,语义死件。
- 只有条数上限没有字节上限:单条无上限正文使"硬上限"名存实亡。
- 将用户查询直接拼入 FTS MATCH / LIKE:语法注入与 `%`/`_` 通配符污染。
- `task-\d+` 文本模式:与 UUID 形态的真实 Task ID 永不匹配,只会制造假引用。
- `message_search_document` 统一文档物化:每条消息/摘要双写,多一层重建逻辑,统一抽象在网关代码内即可完成。
- `unicode61` 或纯 LIKE 全量方案:中文无 BM25;jieba 自定义分词:词典依赖与 FFI 胶水在 demo 阶段不划算。
- semantic/vector/hybrid/embedding 检索:本版明确不做,留待结构化检索证明不足时再议。
- 工具裸名或塞入 `team.*`:网关既有按领域分前缀惯例,读写分组更清晰。

<a id="adr-0051-references"></a>
### References

- [v0.12 版本文档](README.md)
- [ADR-0049: Reproducible Context Delivery v2](decisions.md#adr-0049)
- [ADR-0050: Camp-Shared Progressive Summaries](decisions.md#adr-0050)
- [ADR-0014: Stable Team Tool Gateway v2](../v0.06/decisions.md#adr-0014)
- [SQLite FTS5 trigram tokenizer](https://www.sqlite.org/fts5.html#the_trigram_tokenizer)
<!-- legacy-adr-body:end id=ADR-0051 -->
<!-- legacy-adr:end id=ADR-0051 -->
