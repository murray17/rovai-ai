---
document_type: version-overview
version: v0.10
lifecycle: historical
authority: version-scope-and-status
last_updated: 2026-07-25
---

# Lumen AI v0.10 长期记忆

> 状态：产品实现完成（6/6）
>
> 文档规则：[文档导航](../../README.md)
>
> 前置版本：[v0.09 MCP Library](../v0.09/README.md)
>
> 跨版本约束：[ADR 索引](../../adr/README.md)
>
> 实施入口：[架构与协议](architecture.md) · [实施计划](implementation-plan.md)

## 版本目标

v0.10 为 Lumen 建立由用户治理的长期记忆，使稳定认识能够伴随长期
AgentProfile 身份跨 Camp 延续，同时保持可见、可审计、可修订和可遗忘。

当前设计通过 `grill-with-docs` 逐项确认。未记录为已确认的输入方案、字段、
容量、工具、UI 和生命周期都仍是讨论材料，不构成本版本约束。

## 已确认决策

### MEM-01 应用级所有权边界

- Memory Library 属于本机 Lumen 应用级状态，不属于 Camp、Project、
  Conversation、Native Session、Runtime 或 repository。
- Hearth Memory 面向全部 AgentProfile；Companion Memory 绑定用户与一个
  AgentProfile；Relationship Memory 绑定一对无序 AgentProfile。
- Camp、AgentRun、消息、Task 或 Git Commit 可以成为来源引用，但不改变记忆的
  所有权或可见范围。
- 长期记忆跨 Camp 延续，但不得借来源引用扩大原对象的可见权限。

跨版本规范见
[ADR-0019](../../adr/0019-application-global-memory-ownership.md)。

### MEM-02 用户独占正式写入权威

- Agent 只能从当前、已 fencing 的 AgentRun 提交非权威 MemoryProposal，不能直接
  新增、修订或改变正式记忆生命周期。
- Proposal 保存成功不代表记忆生效；只有用户接受或编辑后接受的最终内容才能
  形成正式变更。
- 用户主动管理记忆时直接提交权威命令，不必先向自己创建 Proposal。
- Default Lead、模型置信度、重复观察或其他评分都不能自动接受 Proposal。
- 已经冻结的 AgentRun prompt 不会被重写；但活动 Run 后续按路径读取 live
  Projection 时可以观察到已提交的新状态。

跨版本规范见
[ADR-0032](../../adr/0032-user-authorized-live-memory-projection.md)。

### MEM-03 原子 Memory 与不可变 Revision

- 每条原子认识是一个具有稳定 ID 的独立 Memory；作用域文件不是领域聚合。
- Memory 通过 `currentRevisionId` 选择一个不可变 MemoryRevision；修订创建新
  Revision，不原地改写旧内容。
- 新增 Proposal 在接受时创建 Memory 与首个 Revision；修订 Proposal 必须冻结
  `memoryId + baseRevisionId`。
- 同一 Memory 的并发接受使用当前 Revision 做 Compare-and-Set；陈旧 Proposal
  不能覆盖后来已确认的内容。不同 Memory 之间不共享无意义的整文件版本冲突。
- `current.md` 一类按作用域组织的文件只能是可重建只读投影。

跨版本规范见
[ADR-0021](../../adr/0021-atomic-memory-and-immutable-revisions.md)。

### MEM-04 Memory Scope 不可变

- Memory 创建时固定 Hearth、一个 Companion 或一对无序 Relationship 成员；
  作用域不是可由 Revision 修改的字段。
- 跨作用域提升、收窄或更换 Relationship 成员对必须创建新的 Memory 与首个
  Revision，并记录稳定派生引用。
- 新 Memory 不会自动删除或终结来源 Memory；用户必须明确选择是否同时改变来源
  Memory 的生命周期。
- 目标作用域必须独立满足可见性规则；派生引用不能把来源权限带入新作用域。

跨版本规范见
[ADR-0022](../../adr/0022-immutable-memory-scope.md)。

### MEM-05 Relationship Direction 定义 Agent 适用视图

- Relationship Scope 始终由一对无序 AgentProfile 组成；完整 pair 只在用户的
  Memory 管理界面中查看和治理。
- `mutual` 进入双方的 Agent 读取视图；`directed(actor → counterparty)` 只进入
  actor 与 counterparty 协作时的读取视图。
- Agent 不获得反向 `directed(counterparty → actor)` 的受支持读取或搜索入口；
  Direction 因而定义 Agent 适用视图，但不能对用户隐藏记录。
- Direction 在 Memory 创建时固定；mutual/directed 转换或调换方向必须创建新的
  Memory。
- Directed Memory 仍不得记录人格评价、能力评分或对另一位伙伴的秘密观察档案。

跨版本规范见
[ADR-0035](../../adr/0035-user-transparent-agent-applicable-relationship-memory.md)。

### MEM-06 封闭且不可变的 Memory Kind

- v0.10 只允许 `preference`、`agreement` 和 `lesson`。
- Preference 是用户稳定选择；Agreement 是面向未来的协作规则；Lesson 是从真实
  经历提炼的可复用行动经验。
- Hearth 与 Companion 允许三类；Relationship 只允许 Agreement 和 Lesson。
- Kind 在 Memory 创建时固定；重新分类创建新 Memory，不能由 Revision 修改。
- 通用 Fact、人格标签、能力评分、行为画像、任务或运行状态、Conversation
  Summary、TODO、当前计划及秘密凭据都不属于 Memory。

跨版本规范见
[ADR-0024](../../adr/0024-closed-memory-kinds.md)。

### MEM-07 Proposal 保存最小提案溯源

- MemoryProposal 保存提案 AgentProfile、提案时间及由 Gateway 解析的来源
  AgentRun、Execution Epoch 和 Camp。
- 来源身份由当前 Native Binding 和 AgentRun 推导，模型不能自行声明。
- 来源 ID 是应用级 Proposal 的稳定审计快照；来源 Camp 删除不级联抹掉这些
  标识，也不让 Proposal 变成 Camp-owned record。
- 接受生成的 MemoryRevision 只保留可选 `createdFromProposalId` 与自身创建时间。
  用户直接写入没有 Proposal。
- v0.10 不建立独立 Origin、Evidence 或 Acceptance 对象；用户命令继续由现有
  `event_log` 审计。
- Proposal 溯源只用于管理和审计，不进入 Agent 可读 Memory Projection。

跨版本规范见
[ADR-0025](../../adr/0025-proposal-scoped-memory-provenance.md)。

### MEM-08 Supersession 是关系而非生命周期状态

- Memory 的权威生命周期只有 `active`、`retired` 和 `forgotten`。
- `retired` 从 Agent 可读 Projection 和未来搜索中移除，但保留正文和 Revision
  历史供用户管理。
- Supersession 以显式 `predecessorMemoryId → successorMemoryId` 关系记录，并在
  同一用户命令中把 predecessor 转为 retired。
- 同一 Memory 的新 Revision 不构成 Supersession；Scope、Kind、Direction 变化
  或合并等创建新 Memory 的场景才可能建立替代关系。
- `forgotten` 的具体清除和审计残留语义由 MEM-09 定义。

跨版本规范见
[ADR-0026](../../adr/0026-explicit-memory-supersession.md)。

### MEM-09 Forget 清除 Memory Library 内容

- Forget 是用户发起、不可恢复的 Memory Library 内容清除，不是全局历史擦除。
- Forgotten Memory 的 Revision 正文与关联已接受 Proposal 正文被清除，并从未来
  搜索、Memory Projection 和导出中移除。
- 系统只保留防止恢复和重复执行所需的最小 tombstone、Proposal 来源标识及永久
  命令事实；永久日志不得复制记忆明文。
- 原始 Camp/Task/Commit 等来源、已完成 AgentRun 的不可变输入、Native Session
  历史和用户或系统备份不随 Memory Forget 改写。
- 需要保留正文但停止沿用时使用 retire，而不是 forget。

跨版本规范见
[ADR-0027](../../adr/0027-memory-domain-forgetting.md)。

### MEM-10 立即生效与建议复核

- MemoryRevision 的 `createdAt` 同时表达用户确认时间；不重复保存 `acceptedAt`。
- 正式变更不重写已冻结 prompt，但活动 AgentRun 稍后读取 live Projection 时可以
  观察到新 Revision。
- v0.10 不提供 `validFrom` 或 `validUntil`，避免把计划和临时要求伪装成长时记忆，
  也避免时钟在无命令时静默改变效力。
- Memory 可以有可选 `reviewAfter`。Lesson 默认在创建或修订 90 天后建议复核；
  Preference 与 Agreement 默认不设置，但用户可以手动安排。
- Review 到期不改变 active 状态，也不自动 retire、forget 或创建 Revision。

跨版本规范见
[ADR-0033](../../adr/0033-advisory-memory-review-v2.md)。

### MEM-11 Retire 有限可逆

- 用户手动 retire 的 Memory 可以通过显式命令重新变为 active；正文未变，因此
  不创建新 Revision，只更新 Memory 版本并记录审计。
- 存在 outgoing MemorySupersession 的 predecessor 不能直接重新启用；恢复旧
  内容需要基于历史 Revision 创建新的 Memory，不能删除或反转替代历史。
- Active 和 retired Memory 都可以被 forget；forgotten 永远不能恢复。
- Review due 不阻止重新启用，也不会因重新启用自动清除。

跨版本规范见
[ADR-0029](../../adr/0029-bounded-memory-reactivation.md)。

### MEM-12 Proposal 使用三态生命周期

- MemoryProposal 只有 `pending`、`accepted` 和 `rejected`。
- Accepted 与 rejected 都是终态；再次考虑需要创建新 Proposal。
- “忽略”只关闭当前会话提示，Proposal 保持 pending 并继续出现在记忆管理页，
  不写入第四种状态。
- `baseRevisionId` 过期产生派生 stale 条件，不改变 Proposal status。
- Proposal 的任何状态都不阻塞当前 AgentRun。

### MEM-13 SQLite 唯一真源与 live 只读 Markdown 投影

- Memory、Revision、Proposal、Supersession 及短正文全部以现有 SQLite 为唯一
  权威；2 KiB 级正文不进入 Managed Blob。
- Markdown 位于 Lumen 私有 userData，只是确定性、可丢弃重建的 Memory
  Projection，不进入 project/Git，也不参与反向写入；Agent 可以按暴露的精确
  路径使用 Runtime 原生文件工具读取。
- 投影缺失、过旧、损坏或摘要不一致时原子重建；外部编辑不会改变 Memory。
- SQLite 权威命令提交不依赖文件系统成功。事务后 projector 失败只产生诊断，
  由稳定扫描恢复。
- 用户管理 Read Side 的结构化查询始终读取 SQLite；v0.10 不向 Agent 提供
  `memory.search`，Agent 原生文件读取看到的是当时 live Projection，不是按 Run
  复制的快照。

跨版本规范见
[ADR-0032](../../adr/0032-user-authorized-live-memory-projection.md)。

### MEM-14 短 Memory Guide 与原生按需读取

- AgentRun 只接收短 `[MEMORY_GUIDE]`，包含用途、较低优先级、建议读取时机和
  当前授权 Scope 的 Markdown 文件或目录地址，不内联 Memory 正文。
- Agent 自己决定是否以及何时用各 Runtime 原生文件工具读取；只有实际读取的正文
  才消耗上下文。
- 当前输入、职责、Core 权限、真实 repository 状态和当前协作上下文始终优先；
  Memory 不能授予权限、证明完成或覆盖当前事实。
- ContextManifest 只冻结 Guide 文本、暴露路径、formatter version 和组装时观察到
  的 Projection digest，不冻结文件正文，也不证明 Agent 已经读取。
- 不建立 per-Run Memory 文件副本；活动 Run 在稍后读取时可能看到新 Projection。
- Runtime 无可靠文件读取能力或权限时明确显示不可用，不回退为全文 prompt 注入。

跨版本规范见
[ADR-0032](../../adr/0032-user-authorized-live-memory-projection.md)。

### MEM-15 Agent 专属 Relationship Projection Directory

- 对当前 Agent A，Memory Guide 暴露 Hearth 文件、A 自己的 Companion 文件和一个
  A 专属的 Relationship Projection Directory；不随 Camp 成员数枚举每个关系文件。
- 该目录只为当前 Camp 中的其他成员提供默认协作视图，不自动暴露 Camp 外的
  Relationship pair。
- A 与成员 B 对应的文件只渲染 active `mutual(A, B)` 和
  `directed(A → B)`，不渲染 `directed(B → A)`。
- 用户管理视图保留完整 pair；Agent 没有 `memory.search` 或其他受支持入口读取
  反向内容。A 的长期记忆读取面就是上述文件和目录。
- Memory Guide 与 ContextManifest 冻结该目录根路径，不枚举或冻结其 live 子文件；
  不建立 per-Run 目录副本。

跨版本规范见
[ADR-0035](../../adr/0035-user-transparent-agent-applicable-relationship-memory.md)。

### MEM-16 Agent 投影条目只保留修订所需字段

- 每条 Agent 可读 Projected Memory Entry 只渲染 `memoryId`、当前
  `revisionId`、`kind`、Relationship 时的 `direction` 和正文。
- Scope 由所在 Hearth、Companion 或 Relationship 文件表达，不在每条中重复。
- Agent 文件只包含 active Memory，因此不重复渲染 lifecycle。
- `revisionId` 是 `memory.propose_change` 修订提案的 `baseRevisionId`，用于拒绝
  基于陈旧投影生成的覆盖。
- Proposal 来源、提案时间、Revision 创建时间、`reviewAfter`、Supersession 和
  管理审计字段不进入 Agent 投影。

### MEM-17 Agent Proposal 只支持 add 与 revise

- `memory.propose_change` 的操作集合严格封闭为 `add` 与 `revise`。
- `add` 只建议创建一条新的 Memory；`revise` 只建议为同一 Memory 创建新的
  Revision，不改变 Scope、Kind、Direction 或 Lifecycle。
- Agent 不能提议 `retire`、`reactivate`、`forget` 或 `supersede`，也不能把这些
  副作用藏在 add/revise Proposal 中。
- 接受 add Proposal 不会自动 retire 或 supersede 相似旧记忆；用户必须通过独立
  管理命令明确处理旧 Memory。
- Lifecycle 与 Supersession 始终是用户在 Memory 管理界面直接发起的权威操作。

### MEM-18 Agent Proposal 目标受当前身份与 Camp 约束

- 对当前 Agent A，`memory.propose_change` 只能以 Hearth、Companion(A) 或
  Relationship(A, B) 为目标，其中 B 必须是来源 Camp 的另一位当前成员。
- revise 只能针对当前投影已暴露给 A 的 active Memory，并必须携带投影中的
  `memoryId + baseRevisionId`。
- A 不能为 Companion(B)、Relationship(B, C) 或当前 Camp 外的 Relationship pair
  创建 Proposal。
- Gateway 从 Native Binding、AgentRun 和 CampMember 状态解析并验证 A、B 与来源
  Camp；模型不能自行声明 proposer，也不能靠传入 ID 扩大提案范围。
- 用户通过管理界面直接治理整个应用级 Memory Library，不受 Agent Proposal
  范围约束。

跨版本规范见
[ADR-0036](../../adr/0036-agent-bounded-memory-proposal-scope.md)。

### MEM-19 Relationship add Proposal 不能替他方承担义务

- 对合法 pair `(A, B)`，Agent A 的 add Proposal 只能选择 `mutual` 或
  `directed(A → B)`。
- A 不能提议 `directed(B → A)`；需要约束 B 行为的单向记忆只能由 B 提议或由用户
  直接创建。
- `mutual` 可以由任一 pair 成员提议，因为 Proposal 本身不生效；用户接受后才进入
  双方 Agent 投影，不增加第二位 Agent 的确认状态。
- Gateway 从当前 AgentRun 推导 directed actor，并验证 counterparty 是来源 Camp
  的另一位当前成员，不信任模型传入 actor ID。

跨版本规范见
[ADR-0037](../../adr/0037-actor-bounded-relationship-proposal-direction.md)。

### MEM-20 add Proposal 使用最小扁平参数

- `memory.propose_change(action = add)` 的模型参数只有 `action`、`scope`、`kind`、
  `body`，以及 Relationship 时的 `counterpartyAgentId` 与 `direction`。
- `scope = companion` 自动绑定当前 AgentProfile；不接受目标 Agent ID。
- `scope = relationship` 时 counterparty 必须是当前 Camp 的另一位成员；
  `direction` 只接受 `mutual | directed`，directed actor 自动绑定当前 Agent。
- 非 Relationship add 禁止携带 counterparty 或 direction。Kind 与 Scope 的合法
  组合继续按 MEM-06 校验。
- proposer、Camp、AgentRun、Epoch、actor、时间、`reviewAfter`、理由和幂等键都不
  是模型参数；Gateway 推导协议身份与幂等事实。
- 输入采用 `additionalProperties: false` 的扁平对象；跨字段条件由 Core 严格
  验证，不使用会被部分 Adapter 丢弃的根级联合 Schema。

### MEM-21 revise Proposal 使用完整正文与 CAS 基线

- `memory.propose_change(action = revise)` 的模型参数只有 `action`、`memoryId`、
  `baseRevisionId` 和完整候选 `body`。
- Scope、Kind、Direction 和目标 Agent 不重复传入；Gateway 从现有 Memory 读取并
  验证这些不可变属性与当前 Agent 的 Proposal 边界。
- `baseRevisionId` 必须来自 Agent Projection，冻结 Agent 实际基于哪个 Revision
  提议修改。
- revise 正文是完整原子 Memory 替换，不支持 diff、patch 或部分字段合并。
- proposer、来源、时间和幂等事实继续由 Gateway 推导。

### MEM-22 revise Proposal 区分提交时冲突与后来 stale

- Gateway 在保存 revise Proposal 的同一事务中校验 `baseRevisionId` 仍是
  `currentRevisionId`；已经陈旧时直接返回冲突，不保存 Proposal。
- 成功保存后若 Memory 的当前 Revision 再变化，Proposal status 仍为 `pending`，
  Read Side 只派生 `stale` 条件。
- Stale Proposal 不能接受、编辑后接受或原地 rebase；用户只能拒绝它，或基于最新
  Revision 重新产生一个 Proposal。
- 这不增加第四种 Proposal status，也不会把未确认冲突写入正式 Memory。

跨版本规范见
[ADR-0038](../../adr/0038-memory-proposal-staleness.md)。

### MEM-23 Proposal Tool Receipt 明确 Memory 未生效

- `memory.propose_change` 成功只返回标准 `lumenTeamTool`、
  `lumenTeamReceipt`、稳定 `proposalId`、`status = pending` 和
  `effective = false`。
- 返回值不包含 Memory ID、Revision ID 或候选正文，因为 add 尚未创建 Memory，
  revise 也尚未推进 current Revision。
- Tool 描述与 receipt 必须明确“已保存待用户确认”，不能使用 learned、remembered
  或 updated 等生效措辞。
- 相同 Runtime tool-call 的幂等重试返回同一 Proposal Receipt；同一调用身份配不同
  payload 按现有 Gateway 协议返回幂等冲突。

### MEM-24 Memory Proposal 使用独立 Capability

- Agent 保存 Proposal 必须具有冻结在当前 AgentRun effective config 中的
  `memory.propose_change` Capability。
- 该 Capability 默认加入所有 active AgentProfile 的默认配置；用户可以在伙伴默认
  配置或 CampMember override 中撤销。
- 配置变化只影响之后物化的 AgentRun，不改写当前 Run 已冻结的 Capability。
- Tool 可见、Default Lead、重复观察或模型置信度都不能替代 Capability 校验；Core
  在每次命令事务中 fail closed。
- Capability 只允许保存受限 add/revise Proposal，不允许 Agent 接受 Proposal 或
  执行任何正式 Memory 管理；用户命令不依赖 Agent Capability。

跨版本规范见
[ADR-0039](../../adr/0039-memory-proposal-capability.md)。

### MEM-25 每个 AgentRun 最多保存四条 Proposal

- 同一来源 AgentRun 的 add 与 revise 合计最多成功持久化 4 条 MemoryProposal。
- Gateway 在保存事务中原子检查该 Run 已创建数量；并发调用共同竞争同一配额，不能
  分别越过上限。
- 相同 Runtime tool-call 的幂等重试复用原 Proposal，不重复计数；Schema、权限、
  stale 或其他失败调用不计数。
- Proposal 后来 accepted 或 rejected 都不返还名额；配额不是 pending 数量窗口。
- 达到上限后当前 Run 的后续 Proposal 调用明确失败，不延迟到未来 Run；用户管理
  命令不受该配额约束。

### MEM-26 单条 Memory 正文最多 2 KiB

- 每个 add/revise Proposal 候选正文以及用户直接创建的 MemoryRevision 正文都必须
  是 trim 后非空的 UTF-8 文本。
- 上限按实际持久化正文的 UTF-8 长度计算，为 2,048 bytes；投影标记与 ID 开销不
  计入。
- 超限写入在事务提交前拒绝，不截断、不自动摘要，也不拆成多条 Memory。
- 用户编辑 Proposal 后接受时必须重新执行同一校验，所有写入入口保持一致。

### MEM-27 Scope 容量只约束 active 当前工作集

| Scope | active Memory 上限 | 当前 Revision 正文合计 |
|---|---:|---:|
| Hearth | 32 | 32 KiB |
| 每个 Companion | 64 | 64 KiB |
| 每个无序 Relationship pair | 32 | 32 KiB |

- 两个上限必须同时满足，正文合计按当前 Revision 的实际 UTF-8 bytes 计算。
- Pending Proposal 不预留容量；用户接受 add/revise 时在权威事务中重新校验。
- Retired Memory、forgotten tombstone 和历史 Revision 不占 active Scope Capacity；
  retire 释放工作集容量，reactivate 必须重新校验。
- Supersession 以同一事务结束后的 active 集合计算，允许 predecessor retire 释放的
  空间供 successor 使用。
- 达到上限不自动淘汰、合并或压缩；用户必须显式 retire、修订、合并或放弃接受。

### MEM-28 Memory Body 是纯文本

- Proposal 候选与正式 MemoryRevision 的 `body` 都是纯 UTF-8 文本，不保存
  Markdown 或 HTML 富文本语义。
- 普通换行可以保留；正文中的 `#`、反引号、链接、标签等字符只属于文本，不能定义
  投影标题、字段、代码块或可执行内容。
- Projector 负责把正文确定性转义进 Markdown，使正文无法伪造 `memoryId`、
  `revisionId`、Kind、Direction 或文件边界。
- Renderer 管理界面也按文本展示/编辑正文，不执行内嵌 HTML 或 Markdown。
- 具体 Markdown 转义与条目布局属于 formatter version；SQLite 中不保存投影语法。

### MEM-29 Memory Body 写入前规范化一次

- 所有 Proposal 和用户写入先把 `CRLF` 与单独 `CR` 转成 `LF`，再删除正文首尾
  空白；内部空格、TAB 和换行保持不变。
- 除 TAB 与 LF 外的 C0 控制字符全部拒绝，NUL 不能进入 SQLite、hash 或投影。
- 不执行 Unicode NFC/NFKC 或大小写折叠，避免改变用户文字与跨语言语义。
- 规范化后的值是唯一持久正文，不保留原始输入副本；若结果为空则拒绝。
- 2 KiB 校验、Scope byte capacity、digest、精确重复比较和 Markdown Projection
  全部使用同一组规范化 UTF-8 bytes。

### MEM-30 No-op Proposal 在持久化前拒绝

- add 候选若与一条 active Memory 的 Scope、Kind、Relationship Direction 和
  canonical body 全部相同，返回 `already_exists`，不保存 Proposal。
- revise 候选若 canonical body 与目标当前 Revision 相同，返回 `no_change`，不保存
  Proposal。
- 比较只使用结构化字段和规范化 UTF-8 bytes，不调用模型、embedding、模糊匹配或
  大小写折叠推断语义重复。
- No-op 错误不占 AgentRun Proposal quota，也不创建 Memory、Revision 或审计正文
  副本。

### MEM-31 Pending 精确重复只保留最早 Proposal

- pending add 的精确重复键是规范化后的 Scope、Kind、Relationship Direction 与
  canonical body。
- pending revise 的精确重复键是 `memoryId`、`baseRevisionId` 与 canonical body。
- Gateway 在同一事务中只保留最早一条；后续相同候选返回 `duplicate_pending`，
  不新增 Proposal、不改写最早 proposer/source，也不占 Run quota。
- 不建立多提案者 Evidence 或 proposer 列表；第二次尝试只保留现有脱敏命令失败
  事实。
- 最早 Proposal rejected 后不再占 pending 重复键，未来 Run 可以重新提出；语义
  相似但不精确相等的候选不合并。

### MEM-32 Pending Proposal 不自动过期

- MemoryProposal 不保存 `expiresAt`；pending 一直保留到用户明确 accepted 或
  rejected。
- 当前会话的“忽略”只关闭提示，不改变状态、保留期或 pending 精确重复键。
- 时间经过不会自动拒绝或清除 Proposal；后来派生 stale 也继续保留候选与来源供
  用户审阅。
- 管理界面必须提供 pending 筛选与批量拒绝，但后台不得以年龄、数量或 Camp 结束
  为理由静默淘汰。

### MEM-33 Terminal Proposal 正文采用不对称保留

- Accepted Proposal 保留 Agent 原始候选正文、proposer/source 和
  `createdFromProposalId` 链接，供用户对照候选与最终 MemoryRevision。
- 用户编辑后接受时，Proposal 仍保留原候选，Revision 只保存用户最终确认正文；
  不新增 Acceptance 对象。
- 关联 Memory 被 forget 时，同一清除流程移除 accepted Proposal 候选正文；Proposal
  仅留最小非正文元数据。
- Rejected Proposal 在拒绝事务中立即清除候选正文，只保留 `proposalId`、提案者、
  提案时间、Camp/Run/Epoch 与 terminal status。
- Terminal 非正文元数据不按时间自动删除；永久事件与 receipt 仍不得复制候选正文。

跨版本规范见
[ADR-0040](../../adr/0040-terminal-memory-proposal-retention.md)。

### MEM-34 Proposal 来源是不会级联的弱引用

- Proposal 冻结的 proposer、提案时间和 Camp/AgentRun/Epoch ID 在来源对象删除或
  不可读后继续保留，Proposal status 与候选正文不因此变化。
- 来源可用性由管理 Read Side 派生；无法解析时显示“来源不可用”并禁用跳转，不新增
  持久 source status。
- Pending Proposal 仍可接受或拒绝；来源不是 Evidence 门槛，用户根据自包含候选
  独立决定。
- 系统不复制 Camp 消息、Task、AgentRun 输入或其他原始正文来维持链接，也不通过
  Proposal 恢复已删除对象。
- 弱引用不能扩大来源权限；可见时的跳转仍按来源领域原有授权执行。

### MEM-35 AgentProfile 状态不级联 Memory Lifecycle

- 现有 AgentProfile 只有 `active | disabled | archived`，状态变化不会自动 retire、
  forget 或删除其 Companion/Relationship Memory，也不改变历史 Proposal。
- Disabled/archived AgentProfile 不能产生新 AgentRun，因此不生成其 Companion 投影；
  它也不作为当前成员进入其他 Agent 的 Relationship Projection Directory。
- 相关 Memory 仍保持原 active/retired 状态并照常占 Scope capacity；用户可在伙伴
  inactive 期间直接管理，也可接受已有 pending Proposal。
- AgentProfile 重新 active 并参与 Camp 后，同一批 active Memory 重新进入适用
  Projection，不创建 Revision 或 Lifecycle 事件。
- 需要永久停止沿用或清除时，用户必须另行执行 retire/forget；Profile status 不能
  充当批量 Memory 命令。

跨版本规范见
[ADR-0041](../../adr/0041-agent-profile-status-memory-independence.md)。

### MEM-36 Projection 单文件安全上限为 256 KiB

- 每个完整 Memory Projection Markdown 文件最多 256 KiB
  (`262,144` UTF-8 bytes)，包括 formatter 文件头、条目字段、正文转义与文件级
  元数据。
- Relationship Projection Directory 不设目录合计上限；其中每个 counterparty
  文件分别执行相同上限。
- 超限时 projector 不截断、不省略部分 Memory，也不发布临时或半成品文件，只记录
  明确诊断并等待恢复。
- SQLite 权威事务与 active Scope 状态保持成功；该阈值只保护文件投影，不反向限制
  数据库。
- 正常 active Scope 容量远低于阈值，命中通常表示 formatter 膨胀、转义异常或实现
  缺陷。

### MEM-37 已知 stale 投影以无正文占位符 fail closed

- 当现有 Projection 已知 stale、损坏、超限或无法从 SQLite 生成时，projector 不把
  last-good 内容继续当作当前结果。
- Projector 尽力原子替换受影响路径为不含 Memory 正文的 `UNAVAILABLE` Markdown
  sentinel；Agent 读取后必须知道该 Scope 暂不可用。
- 稳定 reconciliation 成功后，最新确定性投影再原子替换 sentinel，不需要修改
  SQLite 或 AgentRun Guide。
- Sentinel 写入也失败时保留高优先级用户诊断并持续重试；系统不得声称旧文件
  current，但不承诺在完全文件系统故障下物理删除残留 bytes。
- 权威 Memory 命令不因 projector 或 sentinel 写入失败回滚。

跨版本规范见
[ADR-0042](../../adr/0042-fail-closed-memory-projection.md)。

### MEM-38 不生成用户完整 pair Markdown

- Relationship Projector 只生成按当前 Agent 适用方过滤的文件：A 的 B 文件包含
  mutual 与 `A → B`，B 的 A 文件包含 mutual 与 `B → A`。
- 不额外生成同时包含 mutual、`A → B`、`B → A` 的第三份完整 pair Markdown。
- 用户的完整 pair 管理视图直接查询 SQLite Read Side；完整导出属于独立导出协议，
  不复用 Agent Projection。
- 该选择减少重复投影与完整关系文件被 Runtime 意外发现的表面积。

### MEM-39 Secrets 在所有 Memory 写入入口 fail closed

- 密码、访问令牌、私钥、认证 Header 与其他凭据类秘密在 canonical body 持久化前
  由 Core 拒绝；Agent Proposal、用户直接 add/revise、编辑后接受都使用同一校验。
- 该规则不可由 Agent Capability 或用户确认覆盖；需要保存相关经验时必须改写为不含
  secret value 的 Lesson。
- 错误、event、receipt、diagnostic 与遥测不得回显命中正文或匹配片段。
- v0.10 不为普通个人信息增加 `sensitive` Kind、风险评分、自动标签或特殊
  Lifecycle；合法内容仍受三种 Kind、Scope 与用户确认约束。
- 模型或启发式“敏感度判断”不能成为权威字段；Secret Filter 只承担凭据泄露的硬
  安全边界。
- v0.10 不增加 Memory 专用静态加密。SQLite 与 Agent 可读 Projection 由本机
  账户、磁盘和私有 `userData` 边界保护；不承诺隔离同一系统用户权限下的进程。

跨版本规范见
[ADR-0043](../../adr/0043-memory-secret-filter.md)。

### MEM-40 Proposal 必须逐条由用户确认

- 每条 pending Proposal 支持 `接受`、`编辑后接受`、`拒绝`；接受前必须同时展示
  最终正文、Scope、Kind 与 Relationship Direction。
- 用户编辑后，最终值重新执行 canonicalization、Secret Filter、Kind/Scope、
  capacity 与 CAS 校验；正式 Revision 只保存最终确认内容。
- 不提供批量接受；长期记忆必须逐条审阅。管理界面可以批量拒绝，拒绝正文按
  MEM-33 同一事务清除。
- Stale Proposal 不能接受或编辑后接受，只能拒绝，或基于最新 Revision 产生新
  Proposal。
- 会话“忽略”只关闭当前提示；Proposal 继续进入管理队列。

跨版本规范见
[ADR-0044](../../adr/0044-per-proposal-user-confirmation.md)。

### MEM-41 Memory Store 使用五类规范化 SQLite 表

- `memory` 保存稳定身份、不可变 Scope/Kind/Direction、Lifecycle、
  `currentRevisionId`、Review 与并发 version。
- `memory_revision` 保存不可变 canonical body、创建时间与可选
  `createdFromProposalId`。
- `memory_proposal` 保存 add/revise 候选、三态状态、base、最小
  proposer/time/Camp/Run/Epoch；候选正文允许按拒绝/Forget 规则清除。
- `memory_supersession` 保存不可变 predecessor → successor 边；
  `memory_projection_observation` 只保存派生投影健康、digest 与诊断。
- 全部位于现有 `lumen.sqlite`，复用 DomainCommandGateway、expected version、
  幂等与脱敏 `event_log`；不建立 JSON 聚合、事件回放、FTS 或独立数据库。
- v0.10 使用增量 Migration 创建新表/索引；此前没有正式 Memory 数据，不扫描或
  推断历史 Conversation 来回填。

跨版本规范见
[ADR-0045](../../adr/0045-normalized-sqlite-memory-store.md)。

### MEM-42 统一提供共同记忆维护 Skill

- Lumen 只提供一个 Bundled Skill：`memory-stewardship`，界面名称为“共同记忆维护”；
  对可使用 Skill 的 AgentProfile 默认启用，用户可以关闭。
- Skill 指导 Agent 判断内容是否值得长期保存、按当前授权路径阅读既有投影、避免
  重复、选择 Scope/Kind/Direction、写成无 Secret 的原子正文，并通过
  `memory.propose_change` 提交 Proposal。
- Hearth、Companion 与 Relationship 共用一套工作流；不按 Scope 或 Runtime
  复制多套 Skill。
- 分发复用现有 Skill Library、不可变 SkillRevision 与 Runtime 原生
  SkillProjection。项目中的同名 Skill 继续按既有 shadow 规则优先；实际投影和
  digest 进入 ContextManifest。
- Skill 只提供指导，不授予 `memory.propose_change` Capability，也不绕过 Scope、
  Run quota 或用户确认。Runtime 不支持 Skill 时必须可见降级：不内联正文、不注入
  隐式替代提示，也不阻塞正常 AgentRun。

跨版本规范见
[ADR-0046](../../adr/0046-memory-stewardship-bundled-skill.md)。

### MEM-43 只提供用户主动导出，不新增 Memory 专属备份或同步

- v0.10 提供用户主动触发的 Memory 导出，但不新增 Memory 专属自动备份、后台
  复制或云同步。
- 导出必须从 SQLite 权威状态生成；不能把面向 Agent 的局部 Markdown Projection
  当成备份源。
- 导出文件一旦离开 Lumen 管理边界，后续 `forget` 无法追回或清除该副本。导出
  前必须明确提示这一点，不能暗示外部副本仍受 Memory Lifecycle 控制。
- 导出格式、选择范围与是否包含未遗忘历史属于实施协议，不继续扩大架构决策面；
  但任何格式都不得包含已 forgotten 的正文。

跨版本规范见
[ADR-0047](../../adr/0047-user-initiated-memory-export-boundary.md)。

## 当前版本状态

关键架构与产品边界已经确认。Projection v1、Migration v21、Core Method、错误族、
Export v1、六个检查点和完整测试矩阵的实施默认值见
[implementation-plan.md](implementation-plan.md)。

CampMember 离开/移除后的 Relationship Projection 行为不在 v0.10 Memory 范围内；
当前 Collaboration Domain 尚未提供该正式命令，未来引入时另行设计。

当前状态为“产品实现完成（6/6）”。Migration v21、领域服务、Proposal Tool、
Projection/Guide、Bundled Skill、管理 UI、导出、诊断与隔离 Smoke 均已落地；
实施证据与仍需在具体 Runtime 账户环境中手工执行的验证见
[实施计划](implementation-plan.md)。
