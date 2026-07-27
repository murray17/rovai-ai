---
document_type: adr
id: ADR-0050
title: "Camp-Shared Progressive Summaries"
status: accepted
date: 2026-07-26
decision_scope: cross-version
source_version: v0.12
supersedes: []
superseded_by: null
---

# ADR-0050: Camp-Shared Progressive Summaries

## Context

旧 `context_summary` 是 per-Conversation 产物:同一段公共历史要为 N 个成员各生成一次,索引与搜索必须按成员隔离,且生成只在投递需要时同步发生——长期积压会让某次唤醒当场偿还全部摘要债务。公共消息本身对全体 CampMember 可见,视角隔离并无 ACL 依据。需要一个生成一次、全员复用、可检索、生成与投递解耦,覆盖关系由 schema 保证唯一可判定,且并发生成安全的摘要层。

## Decision

### Camp 级共享与两级封顶

新表 `camp_summary` 归属 Camp,`level ∈ {segment, epoch}`,行不可变,记录覆盖序号区间 `[from, through]`、`source_digest`、`input_truncated` 标志、正文与生成者元数据(Adapter/Model/版本/时间)。摘要以中立第三人称复述全体成员发言;Segment 正文 ≤ 2,000 字符,Epoch 正文 ≤ 4,000 字符。层级两级封顶:Epoch 不再向上压缩。未被注入投递的旧 Epoch 不要求进入输入——其覆盖责任由 ADR-0049 的 Coverage Baseline(覆盖证明 4)承担,检索路径为 `context.search` 定位 + `context.get_summary` 全文加载(ADR-0051)。旧 per-Conversation `context_summary` 表、`visibility_scope_digest` 概念及其代码路径直接删除;新 ContextManifest 以 `camp_summary_ids_json` 引用本表。

### 覆盖分区与并发协议

同层摘要对序号轴构成**严格分区**,由持久前沿与租约协议共同保证:

- **持久前沿**:`camp_summary_frontier(camp_id, level, next_from)`,每 Camp 每层一行。首段 `from = 1`;任何摘要的 `from` 必须等于其生成时刻的 `next_from`。
- **原子认领**:生成事务内读取前沿并插入非终态 attempt;部分唯一索引「`(camp_id, level, from_sequence)` WHERE 非终态」使重复认领冲突失败。attempt 携带 `lease_owner`/`lease_expires_at`(复用既有 inbox 租约惯例);租约过期后其他 Worker 可条件接管。
- **条件终态提交**:成功在同一事务内原子完成「插入 `camp_summary`(`from` = 认领值)+ 前沿 CAS 前进(`WHERE next_from = 认领值`,0 行即回滚)+ attempt 条件置 `succeeded`(`WHERE status='running' AND lease_owner = self`)」。失败同样条件置 `failed`。重试预算:自动重试 ≤ 3 次,复用同一 `from`,耗尽后进入失败升级。
- `UNIQUE(camp_id, level, from_sequence)` 与 `UNIQUE(camp_id, level, through_sequence)` 保留为兜底约束;重叠区间在此协议下不可能产生,投递器不存在多候选选择问题。
- Epoch 对 Segment 区间同样经其前沿首尾相接,并记录其覆盖的有序 Segment ID 列表(渐进输入的来源即该列表)。

### 关段规则

积压量与段输入预算一律按**完整规范化输入**的字符数计(见 source_digest 一节的序列化,含发送者、序号、回复关系与附件元数据,而非仅正文之和):

- **触发**:未覆盖积压规范化输入 ≥ 60,000 字符,或条数 ≥ 300。
- **关闭**:自 `next_from` 起按序贪心吸收消息,直至「再吸收下一条将使规范化输入超过 60,000 字符」或「已达 300 条」,即关闭生成。因越界强制关闭的段可以小于 100 条——这是唯一允许小段的路径。
- **单消息超限**:单条消息自身规范化输入 > 60,000 字符时独立成段,生成输入按确定性规则截断正文尾部至预算,`camp_summary.input_truncated = true` 并计入 `source_digest`。
- **碎片禁令(重述)**:不得为清尾主动生成未触发的段;未达触发条件的未覆盖尾部由投递侧全部原文注入(ADR-0049),不构成 Marker 缺口。
- **Epoch**:未被 Epoch 覆盖的 Segment ≥ 12 个,或其正文合计 ≥ 40,000 字符(护栏)时生成,渐进输入为有序 Segment 正文。
- 阈值单位使用字符数而非 token 数:多 Runtime 环境下本地无从获得各模型分词器。阈值为代码内常数,不做用户配置。

投递需要的区间尚无摘要且已达触发条件时按需生成;生成使用隔离的无工具压缩会话,失败不推进 Context Read Marker。

### 摘要输入契约与 source_digest

摘要输入 = 覆盖区间内未 tombstone 的 `camp_message` 原文(含发送者、序号、回复关系)+ 附件元数据(仅名称/类型);`author_type='system'` 的事件消息计入。附件正文与任何 `conversation_message`/`inbox_message` 私有内容永不进入——这是源头不变量:不适合被摘要的内容不允许写入 `camp_message`。

`source_digest` = 对完整规范化输入的 SHA-256:覆盖区间、逐条 `{message_id, sequence, author_type, author_id, content_digest, reply_to, 附件名称/类型}`(Epoch 则为逐个 `{segment_id, from, through, body_digest}`)、截断标志及输入契约版本号;`camp_message.content_digest` 是其成分而非替代。

### 等待者模型

`waiting(context_compaction)` 支持一对多等待:`context_compaction_waiter(attempt_id, agent_run_id UNIQUE)` 记录等待同一 attempt 的全部 AgentRun。attempt 进入终态时必须处理**全部**等待者:成功则各自恢复投递组装;失败则等待者挂到重试 attempt,重试耗尽走既有失败升级路径。并发出现的第二个等待者不新建 attempt,只追加 waiter 行。

### 生成者选择与 Camp 删除

应用级可配置**摘要模型**(AdapterInstallation + Model);未配置时,异步路径回退 Default Lead 的有效 Adapter/Model,按需兜底路径回退等待者自身的 Adapter/Model(其必然可用)。`context_compaction_attempt` 重建为锚定 `camp_id + level + 覆盖区间`,不再关联单一 AgentRun;既有经 `attempt.agent_run_id` 实现的 Camp 删除 blocker 一并迁移:Camp 删除按 `camp_id` 取消非终态 attempt,并级联删除 attempt、waiter、frontier 与 `camp_summary`。

### 删除语义预留

消息删除功能本版不实施。既有 `tombstoned_at` 列与全部读取过滤保留。将来实施删除时必须同步:tombstone 事务内级联标记覆盖该消息的 Segment 与 Epoch 为 stale(Epoch 因渐进输入必须随 Segment 联动),stale 摘要立即退出搜索与投递,异步重生成并排除 tombstoned 内容;且必须向用户诚实声明——已投递进 Native Session 的内容不可召回,tombstone 的隐私保证仅面向未来。

## Consequences

- 一段公共历史只付一次生成成本,搜索层无需成员隔离;摘要在唤醒之间预先就绪,唤醒不偿还摘要债务。
- 显式替代 ADR-0009 的"不得周期性无条件压缩":禁令的对象从**生成**收窄为**投递替代**(预算内仍必须原文,见 ADR-0049)。
- 前沿 + 租约 + 条件终态把分区、并发与幂等全部落在 schema 与事务协议层,代价是生成必须严格按序,无法乱序补段。
- 关段规则保证任何消息流都存在合法分段(含超长单消息的截断段);截断段的摘要保真度下降,由 `input_truncated` 显式暴露。
- 被抛弃的 Camp 也会产生摘要成本;阈值常数将其限制在每约 60K 字符一次调用。
- 渐进式 Epoch 存在两级有损叠加,由"摘要保留覆盖区间与源消息回读入口"兜底。
- Default Lead 回退意味着未配置摘要模型时可能用重型模型做压缩,成本次优但零配置可用。

## Rejected Alternatives

- per-Conversation 视角摘要(第二人称定制):成本 ×N,索引隔离,无 ACL 依据。
- 纯惰性生成:唤醒串行偿还积压,摘要搜索在首次消费前为空。
- 同步阻塞生成:消息写入或唤醒被 LLM 调用延迟绑架。
- 仅靠双 UNIQUE 约束防重叠、无持久前沿与租约:`[1,100]` 与 `[50,150]` 可并存,双 Worker 可同时执行同一 attempt。
- attempt 仅关联单一等待 Run:并发第二等待者要么孤儿要么重复生成。
- 对超长单消息拒绝生成或拒绝写入:前者造成永久未覆盖区间,后者截断用户/Runtime 的合法长输出。
- 第三层及以上压缩、滚动全局摘要:无限上卷丢失回读锚点。
- token 阈值:引入各 Runtime 分词器依赖,本地不可靠。
- 保留旧表冻结共存:demo 阶段无审计包袱,双摘要机制徒增歧义。

## References

- [v0.12 版本文档](../versions/v0.12/README.md)
- [ADR-0049: Reproducible Context Delivery v2](0049-reproducible-context-delivery-v2.md)
- [ADR-0051: Boundary-Capped Context Retrieval](0051-boundary-capped-context-retrieval.md)
