---
title: "Rovai AI 运行监控指标可采集性审计"
status: "accepted-design-input"
reviewed_at: "2026-08-17"
target_repo: "murray17/rovai-ai"
target_version: "v0.96"
baseline_ref: "4b4fe088b15ef785cd76f54f221e5d87c9d639a4"
---

# Rovai AI 运行监控指标可采集性审计

> 本文审计设置页“运行监控”原型中的数据是否能由 Rovai 当前事实和 Runtime 原生协议可靠提供。
> 用户提供的 HTML、Research 报告和 Codex Brief 仅作为需求与候选设计输入，不是仓库权威合同；
> 结论以当前代码、已有真实 Fixture、当前文档和上游官方协议为准。

## 1. 结论

**页面可以做，但不能把原型中的每一个数字都当作当前已经存在、也不能保证十个 Runtime 都完整填满。**

- 运行生命周期、输入交付、首次可见活动、审批、ContextManifest、省略历史、Bootstrap
  redelivery、已观测 Compaction、结构化活动和 Runtime Probe，大部分已有持久化事实，可以直接建立查询。
- Claude Code、Codex CLI 和 Copilot CLI 的原生通道已经提供足够的结构化 Usage；当前缺口主要是
  Rovai 尚未解析、归一化和持久化这些字段。
- ACP 标准 `usage_update` 只能稳定表达当前 Context Used、Context Window 和可选的累计 Session Cost，
  而且通知本身是可选能力；不能据此宣称所有 ACP Runtime 都有 Input、Output 和 Cache 桶。
- OpenCode 1.18.15、CodeBuddy 2.133.1 和 Qwen Code 0.21.5 已完成真实调用并建立脱敏 Usage Fixture；
  Kiro 与 TRAE 的当前真实样本未返回 Token/Cache，Qoder 虽返回终态 Usage 结构但数值全为 0，不能作为
  可靠消耗数据。
- Antigravity 当前没有可靠的结构化 Token、Cache、Context Token 或真实运行级成本来源。Rovai 可以对
  已知输入与最终输出做本地 Tokenizer 粗估，但必须单独标为 `tokenizer_estimated`，不能进入原生
  Usage Coverage，也不能据此声称还原了 Cache 或 Provider 费用。
- Provider 账单通常是时间桶、项目、API Key 或 line item 粒度；没有请求关联或隔离时，不能精确归因到
  AgentRun。订阅套餐也没有“本次 AgentRun 实际成本”这一事实。
- Native Session 是否延续目前在启动时会被计算，但没有为每个 AgentRun 持久化完整 disposition/outcome；
  v0.96 应补一等运行事实，从 clean-break cutover 后的新 AgentRun 开始精确统计。

因此，产品层应把指标分成 `available / partial / unavailable`，同时返回 `observed / eligible / coverage`
和来源质量。未知不能补零，样例金额不能作为真实数据上线。

### 1.1 Clean-break 数据边界

v0.96 **不回填任何历史监控指标**：不扫描旧 Runtime transcript，不从旧 Resume Attempt 反推 Session
延续，不为旧 AgentRun 重算 Token、Cache、Tool Duration 或 Cost，也不设计旧监控 schema 的兼容读取。

- Migration 只创建空的监控事实、parser state 与 rollup；现有 Core 权威表原样保留。
- 以持久化 `collectionEpoch + collectionStartedAt` 建立唯一 cutover；只有带当前 collection epoch 的
  AgentRun/Observation 才进入监控 eligible 分母。
- 24h/7d/30d 查询自动截断到 cutover，并显示“数据自该时间开始采集”。即使旧 AgentRun 已有生命周期
  时间戳，也不与新 Usage/Session 指标混在同一监控窗口。
- 每个新 AgentRun 在启动时冻结 adapter、Runtime version、parser support 和可观察能力；Coverage 只按
  当时冻结的 eligibility 计算。
- clean break 不等于缺失补零。cutover 后 Runtime 没有上报的字段仍为 `NULL`，并贡献 partial/unavailable
  Coverage。

## 2. 原型指标逐项审计

状态说明：

- **现成事实**：当前数据库或公开 read model 已有可靠事实，主要工作是查询与聚合。
- **可补采集**：Runtime/协议已有结构化来源，但 Rovai 尚未解析或持久化。
- **条件支持**：只对部分 Runtime、版本、事件边界或可观察样本成立。
- **当前不可得**：没有可靠原生来源；如提供估算，必须使用独立的 estimated quality，不能冒充原生事实。

### 2.1 概览与可靠性

| 原型数据 | 判断 | 当前证据与缺口 |
| --- | --- | --- |
| AgentRun 数、执行中数 | 现成事实 | `agent_run.status` 和时间戳已持久化。 |
| 成功率、成功/失败/取消分布 | 现成事实 | 分母应只包含可靠终态，不含 queued/running/waiting。 |
| P95 排队等待 | 现成事实 | `createdAt -> startedAt`。 |
| P95 端到端总耗时 | 现成事实 | `createdAt -> endedAt`；应另列执行耗时 `startedAt -> endedAt`，避免同名混用。 |
| P95 输入接受 | 现成事实 | Transport 指标应为 `delivery.preparedAt -> acceptedAt`；若展示 `startedAt -> acceptedAt`，应另命名为“启动后输入接受”。 |
| P95 首次可见活动 | 条件支持 | 推荐 `delivery.acceptedAt -> first Execution Evidence occurredAt`；只在两端都可观察时入分母，且不得称为首 Token。 |
| 长运行且无新 Evidence | 现成事实 | active AgentRun 加最近 Evidence 时间可计算；无 Evidence 时保持明确状态。 |
| Delivery Unknown | 现成事实 | `RuntimeInputDeliveryView.status = delivery_unknown`。 |
| Pending Approval 与等待时长 | 现成事实 | `requestedAt / resolvedAt / status / adapterKind / actionKind` 均已公开。 |
| 上下文省略次数与消息数 | 现成事实 | `ContextManifestView` 已有 raw/recent/omitted count 和省略范围。 |
| Bootstrap redelivery | 现成事实 | `RuntimeInputDeliveryView` 已有 redelivery present/revision/evidence metadata。 |
| Context payload byte 数 | 可补采集 | Manifest 有 digest，没有公开的 rendered/runtime payload byte count；字节数也不能替代 Token Context。 |
| Native Session 延续/新建/回退 | 可补采集 | disposition 在启动时计算；cutover 后为每个 AgentRun + execution epoch 新增一等事实即可精确统计，不做历史回填。 |
| Resume incompatible/ambiguous | 可补采集 | 新事实记录 requested、disposition、outcome、fallback 和 reason；旧 attempt 表不进入 v0.96 监控分母。 |
| 已观测 Compaction | 现成事实 | 有 append-only observation，但只代表“观测到”。 |
| Compaction 覆盖率 | 条件支持 | 必须按当时 adapter capability/observer lease 计算 eligible；不支持的 Runtime 不能算“0 次”。 |
| 结构化 Activity 覆盖 | 现成事实 | Canonical Activity 有 operation identity、phase、coverage level 和 credibility。 |
| 完整 started + terminal 对 | 条件支持 | 可按 operation identity 计算；缺失、并行和重试必须保留为 partial，不能反推。 |
| Tool 总耗时 | 条件支持 | Rovai 自有 Tool，以及有稳定 Tool Call ID、started、terminal 的 Runtime 可在改造后精确配对；其余只显示“已覆盖 Tool 耗时”与 Coverage，不宣称全量。并行 Tool 的 wall-clock union 与各调用 duration sum 必须分开。 |
| Runtime Probe、最近成功、认证状态 | 现成事实 | Health/read model 已公开状态、诊断、版本、last attempted/successful probe。 |
| 活跃 Host 数 | 可补采集 | Fleet 只保存在 Core 内存；cutover 后新增当前快照查询并按需持久化样本，不做历史趋势回填。 |
| Runtime/成员/状态/时间范围筛选 | 现成事实 | Run 已冻结 adapter/model config；Usage Observation 需保留相同维度。实际模型 reroute 不能只靠配置模型。 |
| Coverage、freshness、脱敏导出 | 可补采集 | 可由 eligible/observed 和最近观测时间导出，但必须先定义每个指标的 eligibility。 |

### 2.2 Usage、Cache 与成本

| 原型数据 | 判断 | 当前证据与缺口 |
| --- | --- | --- |
| Input / Output Token | 条件支持 | Claude、Codex、Copilot 可补采集；其余 ACP Runtime 待 Fixture。Antigravity 只能另给 `tokenizer_estimated` 粗估。 |
| Reasoning/Thought Token | 条件支持 | Codex schema 和 Copilot Fixture 有字段；Claude/模型是否独立报告需按原生语义；不能从正文估算。 |
| Cache Read / Cache Write | 条件支持 | Claude、Codex 和 Copilot 有结构化桶；其他 Runtime 必须逐一验证，缺字段保持未知。 |
| Token Cache Read 占比 | 条件支持 | 只在互斥桶语义已证明时计算，并显示字段 Coverage。 |
| 请求 Cache 命中率 | 条件支持 | 必须有稳定 model-call 边界和该调用的 Cache 字段；Session/Run 聚合快照不能充当调用数。 |
| Cache 读写摊销比 | 条件支持 | 同一可比窗口内 read/write 均可观察才计算；write 缺失不是 0。 |
| Cache 节省估算 | 可补采集 | 需要版本化模型、Provider、service tier 和价格目录，只能标记 `price_estimated`。 |
| Context Used / Window | 条件支持 | Codex 直接提供；发出 `usage_update` 的 ACP Runtime 可提供；Claude 可从 `modelUsage.contextWindow` 获得窗口，但当前 context used 口径需单独确认。 |
| Runtime Reported Cost | 条件支持 | Claude `total_cost_usd` 是客户端估算；ACP cost 是可选累计 Session 值，需 baseline；当前 Copilot Fixture 未报告 cost。 |
| Price Estimated Cost | 可补采集 | Token 与实际模型/tier 已知时可算；基于 Tokenizer 粗估的 Antigravity 金额还要标注复合估算。订阅 Runtime 只能叫“API 等价估算”。 |
| Provider Reconciled Cost | 条件支持 | 可同步 Provider 聚合 bucket，但除非有稳定 request ID 关联或专用项目/API Key 隔离，否则不精确到 AgentRun。 |
| Best Available Cost | 条件支持 | 只能在**相同粒度、时间范围和币种**内选层级；聚合账单不能覆盖到单 Run/Model 行。 |
| Runtime / Model 拆分 | 条件支持 | Runtime 维度已冻结；模型需优先使用 Usage 原生模型，配置模型只作 fallback，并处理 reroute/subagent。 |

## 3. Runtime-by-Runtime 结论

| Runtime | Token/Cache | Context | Cost | 审计结论 |
| --- | --- | --- | --- | --- |
| Claude Code | 可补采集 | 部分 | Runtime estimate | 当前使用 `stream-json`，但 parser 只保存终态、正文和 session ID。官方 result/modelUsage 足够扩展；需处理重复 message ID 和 subagent 口径。 |
| Codex CLI | 可补采集 | 可补采集 | 无运行级实际成本 | 本机 `codex-cli 0.147.0` 生成 schema 已确认 `thread/tokenUsage/updated` 包含 last/total、context window、input、cached input、cache write、output 和 reasoning output；当前 normalize 分支尚未解析。 |
| GitHub Copilot CLI | **Fixture 已证明，可补采集** | **Fixture 已证明** | 未证明 | v0.64 真实 ACP ledger 同时包含 `usage_update {used,size}` 和终态 `usage {inputTokens, outputTokens, thoughtTokens, cachedReadTokens, cachedWriteTokens}`；当前 prompt completion 只读 stop reason。 |
| OpenCode | **Fixture 已证明，部分** | ACP Context | Session gauge | 1.18.15 终态返回 uncached input、cache read、visible output 与独立 thought；parser 将后两者归一为包含 reasoning 的 Output。未上报 cache write，因此 prompt input total 保持未知。 |
| Kiro | 当前样本未上报 | 当前样本未上报 | 未证明 | 2.16.1 的真实最小 AgentRun 成功，但 ACP 边界没有 Usage 消息；不能从标准可选能力推断字段。 |
| Qoder | 结构存在但不可用 | 未证明 | 未证明 | 1.1.17 的真实 AgentRun 成功，终态 `inputTokens/outputTokens/totalTokens` 却全为 0；与实际生成不一致，不能纳管为真实消耗。 |
| CodeBuddy | **Fixture 已证明，部分** | ACP Context | 未证明 | 2.133.1 私有 `usage_update._meta.usage` 返回 prompt/uncached/cache-read/output/reasoning；同一 request 会重复补发，按 request ID 去重。未上报 cache write。 |
| Qwen Code | **Fixture 已证明，部分** | 未证明 | 未证明 | 0.21.5 私有 `agent_message_chunk._meta.usage` 返回 input/output/thought/cache-read；Input 含 Cache Read，未上报 uncached input 与 cache write。 |
| TRAE CLI CN | 当前样本未上报 | 当前样本未上报 | 未证明 | 0.120.52 的真实最小 AgentRun 成功，但 ACP 边界没有 Usage；不能从一般 ACP 能力推断字段。 |
| Antigravity | 原生不可得；可粗估 I/O | 当前不可得 | 真实成本不可得 | 现有 plain output/受控日志没有 Usage。可对 Rovai 已知输入与最终输出运行版本化本地 Tokenizer，但不能还原 Cache、Provider 实际 Token 或费用；权威数据需要上游 Usage 或可控 Provider Gateway/API 请求关联。 |

### 3.1 Copilot 已有真实证据

仓库 v0.64 的真实 ledger 已提供五个终态 Usage 样本。样本满足：

```text
totalTokens = inputTokens + outputTokens
uncachedInputTokens = inputTokens - cachedReadTokens - cachedWriteTokens
```

这证明当前观测版本至少存在 cache-inclusive Input 语义和稳定 prompt-response 边界。实现仍应把 Runtime
版本、dialect/parser 版本和原始字段存在性写入 Fixture，不能把一个版本的结论永久泛化。

### 3.2 v1.01 OpenCode/Codex 补充证据

后续对 OpenCode tag `v1.18.15`（commit
`d7b115f623760e68a4749d16508a9eca350f246f`）的源码审计修正了上表 OpenCode 缺口：

- `packages/opencode/src/acp/usage.ts` 明确定义 `inputTokens = message.tokens.input`，并把
  `message.tokens.cache.read/write` 分别映射为 `cachedReadTokens/cachedWriteTokens`；
- Thought、Cache Read、Cache Write 只在正值时输出，因此已验证版本的成功 terminal Usage 中省略代表
  显式零；
- 官方 ACP service 成功 `end_turn` Fixture 包含 Input 100、Output 40、Thought 7、Read 11、Write 13，
  可冻结正 Cache Write 与 Output/Reasoning 组合回归；
- `usage_update.cost` 调用 `totalSessionCost(messages)`，是累计 Session gauge，不能直接归因当前 Run。

本机 OpenCode `1.18.15` 还完成两次隔离真实成功调用：`opencode/hy3-free` 的约 65k Input 返回 Cache
Read 1728、未返回 Write；`deepseek/deepseek-v4-flash` 的约 52k Input 未返回任何 Cache 分类。DeepSeek
secret 只从 Qwen 本机配置注入子进程环境，未回显或持久化。这两次结果说明“dialect 支持 Cache Write”与
“当前 Provider 实际产生正 Cache Write”必须分开；本机无独立 Anthropic API credential，本轮不能把官方
正值 Fixture 描述成 Provider 实测。

Codex `>= 0.145.0` 的 App Server 四桶已足以计算 API 公价等价估算。v1.01 采用 model key、service tier、
effective date 版本化目录；GPT-5.6 Cache Write 按 uncached Input `1.25x`，早期模型保留各自规则。
Reasoning 属于 Output 子集，不额外计费；结果固定标记 `price_estimated / price_catalog / USD`，不冒充
订阅账单、Codex Credits 或 Provider reconciliation。

## 4. 必须修正的指标口径

附件之间存在几处冲突，建 Contract 前必须统一：

1. **Cache Read Token 占比**

   ```text
   cache_read / (uncached_input + cache_read + cache_write)
   ```

   HTML 原型多处漏掉 `cache_write`。Cache Write 在本次请求中并没有被缓存读取，应进入分母。

2. **端到端与执行耗时分开**

   ```text
   end_to_end = endedAt - createdAt
   execution  = endedAt - startedAt
   queue      = startedAt - createdAt
   ```

   Research 报告和 HTML 对“总耗时”使用了不同起点，不应共享一个名称。

3. **输入接受使用 Delivery 边界**

   ```text
   transport_accept = acceptedAt - preparedAt
   ```

   `startedAt -> acceptedAt` 混入了准备输入的时间，可以作为另一指标，但不能叫纯 Transport 接受时长。

4. **首次可见活动从输入接受后开始**

   ```text
   first_visible_activity = firstEvidence.occurredAt - delivery.acceptedAt
   ```

   若没有 acceptedAt 或 Evidence，则该 Run 对此指标不可判定；它不等于 Provider 首 Token。

5. **P95 不能对小时 P95 再求 P95或平均**

   Rollup 必须保存可合并 histogram/sketch，或在保留窗口内从明细重算。

6. **成本只在同一粒度内比较**

   Provider 月/日 bucket 无法映射到 Run 时只能并列展示或明确标记 allocated，不能成为某个 Run 的
   `best available cost`。多币种也不能在没有版本化 FX 证据时直接求和。

## 5. 建议的 v0.96 范围

### Phase A：可信监控骨架

- 新增三个只读查询：summary、usage、reliability；
- 建立新的 collection epoch 和 cutover，不回填、扫描或推断旧 AgentRun；
- 对 cutover 后的新 AgentRun 接入 Delivery、Evidence、Approval、ContextManifest、Compaction 和 Probe 事实；
- 所有 Metric 强制返回 value、observed、eligible、coverage、source、quality 和 freshness；
- 为每个 AgentRun + execution epoch 新增 Native Session 一等事实，至少表达 `resumeRequested`、
  `resumeDisposition`、`resumeOutcome`、`fallbackToNewSession` 和稳定 `reasonCode`。`resumeSucceeded` 与
  `resumeRejected` 由互斥 outcome 推导，避免多个布尔字段产生矛盾状态；
- 为 Rovai 自有 Tool 与具有稳定 operation identity 的 Runtime Activity 持久化可配对 duration，并把
  covered duration、eligible calls、paired calls 和 Coverage 分开返回；
- 页面完整支持 available/partial/unavailable、空状态和脱敏导出。

### Phase B：首批原生 Usage

- 建独立 append-only raw Usage Observation 与可重建 normalized projection；
- 接 Claude result/modelUsage、Codex token usage notification 和 Copilot prompt response；
- 建统一 ACP Usage Parser，同时读取 `session/update.usage_update`、prompt 终态 `result.usage` 和
  Runtime 私有扩展；统一层只负责稀疏字段、计数模式与原生身份，字段别名和语义由版本化 Runtime
  dialect 拥有；
- Runtime 实际上报多少就保存多少；未上报字段保持 `NULL`，不得因同属 ACP 而补齐；
- 对 cumulative/gauge/delta 分别建 parser state，不把 Context gauge 相加；
- 先用 Claude、Codex、Copilot 的成功、失败、取消、resume 和重复事件 Fixture 关门。

### Phase C：ACP 方言与估价

- 对 OpenCode、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE CLI 逐一采集当前二进制 Fixture；
- 每个 Fixture 都覆盖 `usage_update`、终态 Usage、私有扩展、缺字段、明确 0、resume baseline、
  delta/cumulative 与 counter reset；
- 只有对应 Runtime + version 的 Fixture 证明后才开启 Turn Token、Cache 和 Cost 字段；
- 引入版本化模型价格目录后再提供 `price_estimated` 与 Cache Savings。

### 后续版本：Provider 对账

- Provider 凭据、权限和同步任务放在独立设置域；
- 账单 bucket 与运行 Usage 分表；
- 只在拥有稳定请求关联或隔离维度时建立精确 allocation，否则保持聚合对账。

Provider 对账不应阻塞 v0.96 的本地可信监控。

## 6. 数据模型注意事项

- 新表从空状态开始，且每条 Observation、Session Fact、Tool Duration 与 Rollup 都携带 collection epoch；
  query 不读取 epoch 之前的 AgentRun。clean break 不删除旧 Core 事实，只是不把它们解释成监控事实。
- Usage Observation 是稀疏事实：所有原生数字字段都允许 `NULL`，字段存在性独立于数值；明确上报的
  `0` 与未上报必须可区分。
- Raw source identity 的幂等键应独立于 parser version。若唯一键包含 parser version，同一个原始事件在
  重放新 parser 时可能被重复计费；正确做法是 raw event 只收一次，normalized projection 可版本化重建。
- 单次模型调用成本可能远低于货币最小单位。持久层不要只用“分”为单位的整数；应使用明确 scale 的
  高精度整数或 decimal string，并携带 currency/exponent。
- `source`、`authority`、`quality`、`counterMode` 和 `inputSemantics` 是不同轴，不能用一个枚举混合。
- Reasoning/Thought 通常是 Output 的子集或附加分类，不得默认再加到 Output。现有 Copilot Fixture 中
  `totalTokens = inputTokens + outputTokens` 且 `thoughtTokens > 0`，已经证明直接相加会重复计数。
- 对 cache-inclusive Input 做归一化时，如果 `rawInput < cacheRead + cacheWrite`，应标记 parser/语义
  不匹配并保持未知，不能用 `max(..., 0)` 静默制造一个零值。
- Claude top-level usage、modelUsage 和 assistant event 可能覆盖不同范围；不得互相相加后重复计数。
- Codex 应保存 notification 的 `last` 与 `total` 原值，并通过 Fixture 决定 turn delta；resume 无可靠
  baseline 时只保存 Gauge，不归因历史 Token 给当前 Run。
- Tool Duration 至少区分单调用 elapsed sum 和并行区间 wall-clock union；缺 started 或 terminal 的调用
  不进入精确时长分子，只进入 eligible/partial Coverage。
- Native Session、Turn、Request 身份建议用本机密钥 HMAC 后持久化，而不是可跨导出关联的裸 hash。
- Rollup 必须可从 Observation 重建；清理监控派生数据不得删除 AgentRun、Approval、Context、Recovery
  或 Execution Evidence 权威事实。

## 7. 实施前证据门槛

1. Claude、Codex、Copilot 各自固定 Runtime 版本和完整脱敏 Fixture。
2. 每个 parser 覆盖字段缺失、明确 0、重复、乱序、counter reset、resume baseline 和 truncated event。
3. 六个尚未证明的 ACP Runtime 分别验证：`usage_update`、终态 Usage、私有扩展、字段名、
   delta/cumulative、Input 语义、resume baseline、Cost 粒度和币种。
4. Native Session disposition 必须关联 AgentRun + execution epoch，且成功、controlled failure、fallback
   new session 都可审计。
5. Tool Duration Fixture 覆盖并行调用、重复 terminal、缺 started、缺 terminal、重试和相同 ID 冲突。
6. Coverage 的 eligible 由当前 collection epoch 与 Run 启动时冻结的 Runtime/parser support 决定；
   pre-cutover Run 永远不进入分母。
7. 24h/7d/30d 边界、cutover 截断、时区、P95 merge、重复 rollup、删除与重建通过测试。
8. HTML 中的所有样例 Token、百分比和金额继续明确标记为 prototype data，直到真实查询替换。

## 8. 当前源码与证据锚点

- AgentRun、Evidence、Delivery、ContextManifest、Approval、Runtime Health contracts：
  [`packages/contracts/src/index.ts`](../../../packages/contracts/src/index.ts)
- Claude stream-json 启动与当前最小 result parser：
  [`crates/rovai-core/src/claude.rs`](../../../crates/rovai-core/src/claude.rs)
- Codex notification normalization：
  [`crates/rovai-core/src/codex.rs`](../../../crates/rovai-core/src/codex.rs)
- ACP prompt response、`usage_update` normalization：
  [`crates/rovai-core/src/acp.rs`](../../../crates/rovai-core/src/acp.rs)、
  [`crates/rovai-core/src/main.rs`](../../../crates/rovai-core/src/main.rs)
- Usage 尚未进入 Execution Evidence 持久化白名单：
  [`crates/rovai-core/src/execution_evidence.rs`](../../../crates/rovai-core/src/execution_evidence.rs)
- Native Session disposition 与 attempt 持久化：
  [`crates/rovai-core/src/runtime.rs`](../../../crates/rovai-core/src/runtime.rs)、
  [`crates/rovai-core/src/db.rs`](../../../crates/rovai-core/src/db.rs)
- Compaction observation：
  [`crates/rovai-core/src/compaction.rs`](../../../crates/rovai-core/src/compaction.rs)
- Copilot 真实 ACP Usage ledger：
  [`docs/versions/v0.64/evidence/copilot-native-turn-reconciliation-2026-08-12/`](../../versions/v0.64/evidence/copilot-native-turn-reconciliation-2026-08-12/)
- 当前 Runtime 兼容性证据：
  [`docs/runtime-compatibility.md`](../../runtime-compatibility.md)

## 9. 上游官方依据

- [Codex App Server](https://developers.openai.com/codex/app-server)
- [OpenAI Prompt Caching](https://developers.openai.com/api/docs/guides/prompt-caching)
- [OpenAI Organization Usage and Costs](https://developers.openai.com/api/reference/resources/admin/subresources/organization/subresources/usage)
- [Claude Code structured output](https://code.claude.com/docs/en/headless)
- [Claude Code cost and usage](https://code.claude.com/docs/en/agent-sdk/cost-tracking)
- [Claude Prompt Caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
- [ACP Session Context Size and Cost](https://agentclientprotocol.com/rfds/session-usage)
- [OpenCode v1.18.15 ACP Usage source](https://github.com/sst/opencode/blob/v1.18.15/packages/opencode/src/acp/usage.ts)
- [GPT-5.6 pricing and Cache Write](https://openai.com/index/gpt-5-6/)
- [GPT-5.6 Terra/Luna July 30 price update](https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/)
- [OpenAI Fast mode pricing](https://openai.com/api-fast-mode/)
