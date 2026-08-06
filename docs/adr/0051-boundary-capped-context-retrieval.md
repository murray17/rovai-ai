---
document_type: adr
id: ADR-0051
title: "Boundary-Capped Context Retrieval"
status: accepted
date: 2026-07-26
decision_scope: cross-version
source_version: v0.12
supersedes: []
superseded_by: null
---

# ADR-0051: Boundary-Capped Context Retrieval

> [ADR-0106](0106-agent-bounded-cross-camp-public-history-retrieval.md) 局部替代本文“网关层不存在
> 跨 Camp 查询”的限制，并以 ContextManifest 冻结的 Camp 集合和全局公开消息边界约束访问。
> [ADR-0108](0108-discovery-only-camp-message-search-and-sequence-paged-reads.md) 局部替代本文的
> 五个 `context.*` 工具、模型可读 Summary、相关性分页以及 window/thread 续读合同；字面量
> 查询安全、短查询有界回退、CampMessage 事实源、tombstone 过滤和硬响应预算继续有效。
> [ADR-0129](0129-deterministic-bounded-raw-public-context-delivery.md) 进一步删除 Summary、
> Coverage Baseline 与摘要回读假设，并冻结确定性原始消息窗口；`camp.read`/`camp.search`
> 仍按 ContextManifest 上界访问原始消息，不按“已读/未读”过滤。

## Context

溢出投递(ADR-0049)与渐进摘要(ADR-0050)成立的前提是 Agent 能按需回读被压缩的历史,否则摘要替代与 Coverage Baseline 就是信息削减。但直接开放活库查询会撕开冻结边界:长 Run 中途搜到自身启动后的新消息,与"新消息只能触发新 AgentRun"冲突。rovai 消息以中文为主,SQLite FTS5 默认 `unicode61` 不切 CJK;trigram tokenizer 对少于 3 个 Unicode 字符的查询不产生命中,而"任务""审批"这类双字词是中文高频查询。消息正文本身没有长度上限(用户消息与 Runtime 最终输出仅校验非空),因此工具还必须有响应体纪律,否则"按需回读"会重新制造超大上下文。

## Decision

### 工具组与网关

固定 Team MCP 网关(单一 Server,不新增进程)新增 `context.*` 工具组,与 `team.*`、`memory.*` 并列,共五个只读工具:

- `context.search`:统一搜索,内部合并消息 FTS、摘要 FTS 与精确引用查询;参数 `query`、`scope(messages|summaries|all)`、`references`、`senderIds`、`sequenceFrom/Through`、`limit` 与续取游标;`references` 精确命中优先于全文匹配。`query` 仅在 `scope=summaries` 时可省略,此时按 `through_sequence` 降序分页列举可见摘要,作为 Coverage Baseline 无需先验关键词的目录入口。
- `context.get_message`:按 ID 读单条消息(正文、附件元数据、引用、回复指向);支持 `bodyOffset`/`bodyLimit` 分段续读超长正文。
- `context.get_message_window`:按序号返回目标消息前后连续邻域,保护问答/提案-批准等时间相邻语义链。
- `context.get_message_thread`:返回根消息与可见回复;回复链是逻辑相邻,与 window 不可互代。
- `context.get_summary`:按摘要 ID 返回 Segment/Epoch 全文正文、层级、覆盖区间与 `source_digest`——Coverage Baseline 之前历史的加载路径:`context.search` 定位,本工具取全文。

`get_unread_camp_context` 不是 Agent 工具:唤醒组装是 Core 职责(ADR-0049),其产物由 ContextManifest 冻结。五个工具均只读、不设新 Capability(公共消息对全员可见);Camp 由当前 Run 的 fence 决定,工具无 `campId` 参数,跨 Camp 查询在网关层不存在。

### 输出纪律

条数与字节双重上限;任何截断都必须显式可见,并给出续取方式:

- **单条正文注入上限 4,000 字符**:任何工具返回的单条消息正文超出即截断,标注 `bodyTruncated: true` 与 `bodyLength`(全文字符数);全文经 `context.get_message` 的 `bodyOffset`/`bodyLimit`(单次 ≤ 4,000)分段续读。
- **单次响应总量上限 16,000 字符**(含正文、片段与元数据):达到即截断剩余条目并返回续取游标(window/thread 为已返回的最后序号,search 为已返回条数)。
- **附件元数据**每条消息 ≤ 10 项,超出标注省略数。
- 条数上限与排序:`context.search` `limit` 默认 10、最大 20,片段 ≤ 200 字符,排序「引用精确命中 → BM25 相关性 → 序号降序」;`context.get_message_window` `before`/`after` 各默认 10、最大 25,序号升序;`context.get_message_thread` 序号升序、单次 ≤ 100 条,凭 `sequenceFrom` 续取;`context.get_summary` 单条全文(正文由 ADR-0050 保证 ≤ 4,000 字符)。
- 截断标注的统一形态为 `truncated` + 省略数;唯一例外见"短查询回退"(有界扫描无法得知精确省略数)。

### 冻结边界封顶与 tombstone 例外

所有工具结果硬性满足 `sequence ≤` 当前 Run Manifest 的 `camp_message_boundary_sequence`;回复链与邻域窗口同样过滤;Segment/Epoch 摘要(含 `context.get_summary`)仅当 `through ≤ boundary` 时可见,部分越界的摘要整条不可见。唯一例外:tombstone **永远实时过滤**——Run 启动后被 tombstone 的消息立即从工具结果消失,隐私安全压过可复现性。工具调用结果是运行时交互,不进入 Manifest 冻结范围;可审计性由封顶与 tombstone 两条规则保证。

### 中文检索、短查询回退与转义

FTS 使用 FTS5 **trigram** tokenizer。查询串一律作为**字面量**处理:FTS `MATCH` 侧将整个查询包装为带引号短语(内部引号成对转义),用户输入不解析为 FTS 语法(`OR`/`NEAR`/`*` 等无特殊含义);`LIKE` 侧使用 `ESCAPE '\'` 并转义 `%`、`_`、`\`。

归一化后不足 3 个 Unicode 字符的查询,FTS `MATCH` 不产生命中,`context.search` 必须自动回退为有界 `LIKE` 子串扫描:范围锁定当前 Camp + `sequence ≤ boundary` + tombstone 过滤,按序号降序扫描,命中达 `limit` 或扫描达 10,000 行即止。有界扫描无法得知精确省略数,结果以 `scanBounded: true` + `scannedThroughSequence` + `hasMore` 表达(这是"截断必须返回省略数"规则的显式例外)。`references` 精确查询不受查询长度影响。边界、tombstone、双字中文查询与转义必须有专项测试。

### 派生索引层

索引层全部为可重建派生数据,`camp_message` 与 `camp_summary` 始终是事实源;单行 meta 记录 `index_version`,抽取规则升级时整层重建,重建结果必须与增量维护一致:

| 结构 | 内容 |
|---|---|
| `camp_message_fts` | FTS5 trigram,external-content 挂 `camp_message.body`,与 tombstone 同步 |
| `camp_summary_fts` | FTS5 trigram 挂 `camp_summary.body` |
| `camp_message_reference` | 写入事务内抽取:文本模式 `ADR-\d+`、`PR-\d+`、`issue-\d+`(大小写归一,不做内部实体外键解析);以及消息文本中出现的完整 UUID 与 `task.id` 精确比对,命中才记入(`kind='task'`) |
| `camp_message_mention` | 自既有 `addressed_agent_profile_ids_json` 派生的点名索引 |

Task ID 是 UUID,不存在 `task-\d+` 形态的真实标识符,该模式不抽取。不建统一 `message_search_document` 中间表——消息与摘要的统一在 `context.search` 网关代码内完成。附件复用既有 `message_attachment` 表。`camp_message` 新增 `content_digest`(正文 SHA-256),历史行回填,作为 ADR-0050 `source_digest` 的成分与索引重建校验依据。

## Consequences

- trigram 令中英文混合内容可搜索且加速 ≥ 3 字符的 LIKE;双字中文查询由有界顺序扫描兜底,大 Camp 下短查询可能不完整(`scanBounded`/`hasMore` 显式暴露)。索引体积约为正文 3 倍,本地单机可接受。
- 边界封顶使检索不构成越过冻结边界的侧信道;用户紧急纠正必须走取消/新 Run/Control Signal 通道。
- 条数与字节双上限使单次工具响应 ≤ 16,000 字符;超长正文与长回复链靠续读游标分次获取,Agent 以多次调用换深度。
- Task 引用依赖消息文本包含完整 UUID;口语化提及(如"那个部署任务")不入引用索引,由全文搜索兜底。
- `index_version` 保证抽取规则升级(如未来加入文件路径)可随时整层重建补抽。
- briefing 的点名清单(ADR-0049)依赖 `camp_message_mention`,两者同版实施。

## Rejected Alternatives

- 活库无界查询:撕开冻结边界,执行顺序不可推理。
- 工具 `get_unread_camp_context`:Marker 在输入接受时已推进,Run 存活期内未读恒为空集,语义死件。
- 只有条数上限没有字节上限:单条无上限正文使"硬上限"名存实亡。
- 将用户查询直接拼入 FTS MATCH / LIKE:语法注入与 `%`/`_` 通配符污染。
- `task-\d+` 文本模式:与 UUID 形态的真实 Task ID 永不匹配,只会制造假引用。
- `message_search_document` 统一文档物化:每条消息/摘要双写,多一层重建逻辑,统一抽象在网关代码内即可完成。
- `unicode61` 或纯 LIKE 全量方案:中文无 BM25;jieba 自定义分词:词典依赖与 FFI 胶水在 demo 阶段不划算。
- semantic/vector/hybrid/embedding 检索:本版明确不做,留待结构化检索证明不足时再议。
- 工具裸名或塞入 `team.*`:网关既有按领域分前缀惯例,读写分组更清晰。

## References

- [v0.12 版本文档](../versions/v0.12/README.md)
- [ADR-0049: Reproducible Context Delivery v2](0049-reproducible-context-delivery-v2.md)
- [ADR-0050: Camp-Shared Progressive Summaries](0050-camp-shared-progressive-summaries.md)
- [ADR-0014: Stable Team Tool Gateway v2](0014-stable-team-tool-gateway-v2.md)
- [SQLite FTS5 trigram tokenizer](https://www.sqlite.org/fts5.html#the_trigram_tokenizer)
