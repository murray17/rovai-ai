---
document_type: implementation-plan
version: v0.96
authority: implementation-plan-and-acceptance
status: in_progress
last_updated: 2026-08-17
---

# v0.96 实施与验收计划

## 计划状态与使用方式

本计划基于 `4b4fe088`、[指标可采集性审计](../../research/runtime-monitoring/README.md)和用户确认的
clean-break 边界编写。附件中的 HTML 数值是 prototype data；Research 与 Codex Brief 是设计输入，不能
替代当前代码、Migration、Contract、真实 Runtime Fixture 或官方协议。

实施按 Checkpoint 顺序推进。一个 Runtime 的 parser 可以独立进入 partial 支持，但单一快照的三个子视图、Coverage、
NULL 和 collection epoch 必须先完成，避免先采数据后再猜分母。开始修改 Rust 测试前遵守
[Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)；启动真实 Runtime
前遵守[本地 Runtime 工作流](../../development/local-workflow.md)。

## 不变量

- Monitoring Collection Epoch 是 v0.96 监控数据集的唯一 cutover；pre-cutover 与 cutover 时 active Run
  都不 enrollment；
- clean break 不删除旧 Core 事实，只排除旧事实的监控解释；
- Runtime Usage Observation 与 AgentRun Execution Evidence 是不同 authority，Usage 不进入模型上下文；
- 所有 Usage 数字是稀疏 nullable 字段；未上报不等于 0；
- raw source identity 的幂等不依赖 parser version；normalized projection 可以版本化重建；
- 同属 ACP 不代表同一 Usage 方言；所有 Turn Token/Cache 字段按 Runtime + version Fixture 准入；
- Reasoning/Thought 不默认与 Output 相加；Cache-inclusive Input 归一化失败时保持 unknown；
- cumulative、delta 和 gauge 分别处理；无可靠 baseline 时不归因 Session 历史值到当前 Run；
- Tool duration 只使用稳定 operation identity 和真实 started/terminal；Coverage 与时长同时返回；
- Provider 聚合 bucket 不在缺少稳定请求关联时变成单 Run 真实成本；
- Renderer 只展示 Core typed query，不在前端重算权威指标或从文案推断来源质量。
- Usage Update 先在内存合并；全局 4 秒节拍批量持久化，terminal/Host exit/shutdown 强制 Flush；
- 页面只调用 `monitoring.snapshot`；可见时每 12 秒轮询，隐藏/卸载停止，Core 事件以 300ms debounce 刷新；
- snapshot/trend 不扫描 Evidence、Transcript、Blob 或 raw Usage，不在 Database Mutex 内解析大型 JSON、联网或对账。
- recovery 保留逐 execution epoch lineage，但 lifecycle、trend 和 Coverage 对同一 `agentRunId` 只计一个 logical Run；
- 同时只允许一个 Renderer snapshot request 在途；重叠 poll/event/manual/filter 刷新合并，不在 Core Mutex 前排队；

## Checkpoint 0：合同、术语与 Fixture 目录

- [x] 以 [ADR-0201](decisions.md#adr-0201)为长期边界；
- [x] 以 [Runtime Monitoring v1](../../contracts/runtime-monitoring-v1.md)冻结 collection、observation、
  Native Session fact、查询与 metric shape；
- [x] Core/TypeScript 只使用 CONTEXT 中的 Monitoring Collection Epoch、Monitoring Run Enrollment、
  Runtime Usage Observation、Runtime Usage Coverage 和 Provider Billing Bucket；
- [x] 建立 `crates/rovai-core/tests/fixtures/runtime-usage/<adapter>/<version>/` 或等价固定目录；
- [x] Fixture 保存脱敏结构化事件和预期 normalized observation，不保存 Prompt、Completion、Tool Output、
  凭据、绝对用户路径或裸 Native Session/Turn/Request ID；
- [x] 每个 dialect 显式声明字段路径、counter mode、Input semantics、Reasoning semantics、Cost grain 和
  parser version；
- [x] 文档与测试都不把附件中的样例金额或百分比写成默认生产数据。

## Checkpoint 1：Collection enrollment 与持久化

### 1.1 Migration

在 `crates/rovai-core/src/db.rs` 新增 append-only Migration，至少建立：

```text
monitoring_collection_state
monitoring_run_enrollment
runtime_usage_raw_observation
runtime_usage_normalized_observation
runtime_usage_parser_state
runtime_usage_run_rollup
runtime_cost_run_rollup
runtime_usage_rollup_hourly
monitoring_run_rollup_hourly
agent_run_native_session_fact
```

- [x] `monitoring_collection_state` 只有一个 current epoch，包含 schema version、epoch ID 和
  `collection_started_at`；
- [x] Migration 不为任何既有 AgentRun 建 enrollment，不运行 backfill SQL；
- [x] 新 AgentRun 成功冻结 Runtime 配置并进入执行准入时，原子建立 `(agentRunId, executionEpoch)`
  enrollment，冻结 adapter、Runtime version、model config 和 parser/capability support snapshot；
- [x] cutover 时 active Run、recovery 旧 epoch 和没有 enrollment 的 Run 全部被查询排除；
- [x] raw observation 唯一身份独立于 parser version；重复 source event 幂等；
- [x] normalized observation 引用 raw identity、dialect/parser version，并允许重新投影而不重复汇总；
- [ ] parser state 按 collection epoch、adapter、Native Session digest、模型和 counter family 隔离；
- [x] 所有 Native Session/Turn/Request identity 使用本机盐化 digest，且不进入响应/导出；
- [x] Money 使用带 currency 的规范 decimal string 与精确十进制加法，不用浮点数，也不只保留货币“分”。

### 1.2 Native Session fact

- [x] 每个 enrollment 的 Run/epoch 写一条 Session fact；
- [x] 字段表达 `resumeRequested`、`resumeDisposition = new | compatible | controlled`、
  `resumeOutcome = not_attempted | succeeded | rejected | incompatible | ambiguous | failed`、
  `fallbackToNewSession` 和 `reasonCode`；
- [x] disposition 在 launch 决策点写入，outcome/fallback 在实际结果边界 CAS 更新；
- [x] 互斥约束禁止 succeeded/rejected/fallback 的矛盾组合；
- [x] 旧 `native_session_resume_attempt` 可继续服务现有恢复机制，但不用于 v0.96 监控回填。

### 1.3 清理与重建

- [ ] 监控派生清理只删除当前监控表/rollup，不删除 AgentRun、Evidence、Action/Approval、Context、
  Recovery、Native Session 或 Runtime Probe；
- [ ] normalized observation 和 rollup 可从当前 epoch raw observation 确定性重建；
- [ ] raw retention 变更不在运行监控页配置；若未来引入，必须保留可解释 Coverage 和 freshness。

## Checkpoint 2：Runtime Usage 采集

### 2.1 统一 parser seam

新增深模块（建议 `runtime_usage.rs`）拥有：

```text
raw Runtime message/result
  -> adapter/version dialect
  -> sparse parsed observation
  -> input/counter/cost validation
  -> raw + normalized persistence
```

- [x] `main.rs` 只负责绑定 AgentRun/epoch/adapter route，不散落 Runtime 私有 JSON Pointer；
- [x] parser 返回字段存在性、原始值、counter mode、scope 和语义，不用默认值填缺失字段；
- [x] 明确 0 被保存为 0，缺失为 `NULL`，非法/冲突值保持 unknown；
- [x] `rawInput < cacheRead + cacheWrite` 不 clamp 为 0；
- [x] Reasoning/Thought 记录为 Output 子分类或 unknown，不直接加入 total；
- [ ] cumulative snapshot 使用稳定 baseline/dedupe；counter reset 开新 segment，不产生负 delta；
- [x] Gauge（如 ACP Context Used）只保存观测和最新值，不进入 Token sum；
- [x] Runtime Update 在专用 `RuntimeUsageBuffer` 中 source-dedupe/coalesce；全局 4 秒节拍批量写，终态强制 Flush；
- [x] coalesced batch 持久保存 constituent source digest，Core 重启 replay 不会与新 Update 一起重复累加；
- [ ] parser error 不阻断 AgentRun terminal authority，只降低 Usage Coverage 并产生受控诊断。

### 2.2 Claude Code

目标：`crates/rovai-core/src/claude.rs`。

- [ ] 扩展终态 `result`：usage、modelUsage、total_cost_usd、duration_ms、duration_api_ms、num_turns；
- [ ] 解析 assistant per-call Usage，并按稳定 message/request identity 去重；
- [ ] 终态聚合与 assistant 事件按明确 precedence 合并，不相加重复范围；
- [ ] Anthropic exclusive buckets 映射 uncached/cache read/cache creation/output；
- [ ] `modelUsage` 与 top-level usage 的 subagent 范围分别测试；
- [x] Runtime cost 标记 `runtime_estimate`，不称为 Provider invoice；
- [ ] 成功、失败、取消、无 result、重复 assistant、重复 terminal 和多模型 Fixture 通过。

### 2.3 Codex CLI

目标：`crates/rovai-core/src/codex.rs` 的 app-server notification route。

- [x] 解析当前 `thread/tokenUsage/updated`，保留 threadId/turnId digest、last、total 和
  modelContextWindow；
- [x] 解析 input、cached input、cache write、output、reasoning output 和 total；
- [x] 用 Fixture 与本机 Codex rollout tokenUsage 事件确认 last 为调用 delta、total 为 cumulative；
- [ ] resume 前后取得可靠 baseline；没有 baseline 时保存 Session Gauge，不把历史 total 算给当前 Run；
- [ ] 记录冻结模型和 `model/rerouted` 等实际模型变化；不能证明 per-model 粒度时保持 partial；
- [ ] 不从 ChatGPT account token activity 推导单 Run cost；
- [ ] notification 重复、乱序、reset、resume、reroute 和 terminal 丢失 Fixture 通过。

### 2.4 ACP 与 Copilot

目标：`crates/rovai-core/src/acp.rs` prompt response 和 `main.rs` ACP route。

- [x] 统一 parser 读取 `session/update` 的 `usage_update {used,size,cost?}`；
- [x] 读取经 Fixture 证明的 prompt 终态 `result.usage`；
- [x] dialect 可以读取经 Fixture 证明的 Runtime 私有扩展，但不扫描未知日志；
- [x] `used/size` 标为 Context Gauge；`cost` 标为可选累计 Session Cost；
- [x] ACP Cost 只有 amount 与显式合法 currency 同时存在才保存；缺 currency 不默认 USD；
- [x] 无 baseline 的 cumulative Session Cost 只保留 raw Gauge，不进入 Run/range cost rollup；
- [x] Copilot fixture 验证 input cache-inclusive、Thought 是 Output
  子分类、cached write 明确 0；
- [ ] OpenCode、Kiro、Qoder、CodeBuddy、Qwen、TRAE 各自采集当前 Runtime version Fixture；
- [ ] 每个 ACP Runtime 分别验证缺字段、明确 0、Input semantics、counter mode、resume baseline、
  Cost grain/currency；
- [x] 未经对应 Runtime/version Fixture 证明的 Turn Token、Cache 或 Cost 字段保持 `NULL`。

### 2.5 Antigravity

目标：`crates/rovai-core/src/antigravity.rs` 与独立 estimate seam。

- [x] 原生 Token/Cache/Context/Cost support 始终为 unavailable，除非上游新增稳定结构化 Usage；
- [ ] 可选本地 Tokenizer 只处理 Rovai 已知输入 payload 和已验证最终输出，绑定 tokenizer name/version；
- [ ] 结果来源固定为 `tokenizer_estimated`，不进入 native Usage observedCount；
- [ ] 不生成 Cache Read/Write，不将估算称为 Provider token；
- [ ] 基于粗估 Token 的价格金额同时标记 tokenizer + price 双重估算；
- [ ] 上游 Usage 或可控 Provider Gateway/request linkage 需另行准入，不在本版本代理 Runtime 流量。

## Checkpoint 3：聚合、Tool Duration 与成本

### 3.1 Query service

新增深模块（建议 `monitoring.rs`）拥有 collection clamp、filter、eligibility、metric assembly 和 rollup。

- [x] 唯一 `monitoring.snapshot` 一次返回 summary/usage/reliability 三个子视图；
- [x] summary 返回 run/status/trend/runtime breakdown/attention；
- [x] usage 返回 token/cache/context/已保存 cost 层及 Runtime/Model breakdown；
- [x] reliability 返回 queue/input acceptance/first visible/end-to-end/Session/Context/
  Approval/Activity/Compaction 与 enrolled Runtime health；
- [x] 三个子视图使用相同 range/filter 解析、collection boundary 和 timezone；
- [x] 每个 metric 返回 availability、value、observedCount、eligibleCount、coverage、source、quality、
  freshness 和必要的 currency/reconciledThrough；
- [x] `eligibleCount = 0` 时 value/coverage 为 contract 定义的 unknown，不显示 0%；
- [x] 24h/7d/30d 起点早于 cutover 时截断，并返回 effectiveStartAt；
- [x] trend 只读小时 rollup；snapshot 不读 raw Usage、Evidence、Transcript 或 Blob；
- [x] enrollment 预投影 capability/first-visible/Evidence count，持 Database Mutex 时不解析 per-Run JSON；
- [x] snapshot/read path 不执行网络请求、价格同步或 Provider Usage/Cost 对账。
- [x] Delivery、Approval 与 Tool timing 在 SQL CTE/window 内聚合为有界标量，不在 Core 无界物化明细；
- [x] lifecycle/P95 与 Usage/Context 在 SQL 内返回标量，Runtime/Model 只返回受控维度分组；Cost 使用
  SQLite 精确十进制 aggregate，先逐 logical Run 选层再汇总，不在 Database Mutex 下物化 Run/Usage/Cost 明细；

### 3.2 生命周期与可靠性

- [x] success denominator 只含 terminal enrolled Run；
- [x] recovery 多 epoch 的 lifecycle/trend/Coverage 按 logical AgentRun 去重，终态不会遗留旧 active rollup；
- [x] queue、execution、end-to-end 分开；负值/缺端点排除并降低 Coverage；
- [x] input acceptance 使用 prepared→accepted；first visible 使用 accepted→持久化 first-visible projection；
- [x] pending Approval duration 计算到 query observedAt，terminal Approval 使用 resolvedAt；
- [ ] Context omission/redelivery 只使用 enrolled Run 的 Manifest/Delivery；
- [x] Compaction eligible 由 enrollment 时 capability 和 observer observation 决定；unsupported 不算 0；
- [ ] active Host 新增当前 fleet snapshot；历史 trend 只从 cutover 后样本开始。

### 3.3 Tool Duration

- [x] Core-owned Tool 使用 verified operation identity；Runtime Tool 只接受 Canonical fine-grained stable
  operation identity；
- [x] 配对规则按 AgentRun/epoch/operationId，不按标题、命令、时间窗或 cwd；
- [x] 重复 terminal 幂等，冲突 terminal 标记 unknown/unsettled；
- [x] 返回 eligible calls、paired calls、paired elapsed sum、wall-clock union 和 Coverage；
- [x] 缺 started/terminal、run-level/unknown Runtime 和并行调用不被包装成“全部 Tool 总耗时”。

### 3.4 Cache 与 Cost

- [x] Cache Read share 分母包含 uncached/read/write；
- [x] request hit rate 在缺少稳定 model-call boundary 时明确 unavailable；
- [x] read/write amortization 在 write unknown 时保持 unknown，write=0/read>0 显示只观测读取；
- [ ] price estimate 绑定 provider/model/tier/pricing catalog version；未知模型不猜；
- [x] Schema/response 分层保留 Runtime reported、runtime estimate、price estimate、provider reconciled 和 allocated；
- [x] best available 只比较相同 grain 和 currency；未实现的 price/provider 层不制造值；
- [x] best available 先逐 logical Run 选质量再汇总；mixed quality 不丢失其余 Run 的低层金额；
- [x] Provider bucket 无 request linkage/隔离维度时不写 AgentRun allocation；
- [ ] P95 rollup 保存可合并 sketch/histogram 或从明细重算，不聚合 percentile 的 percentile。

## Checkpoint 4：Contract、Desktop bridge 与 Renderer

### 4.1 TypeScript 与 IPC

- [x] `packages/contracts/src/index.ts` 实现 v1 request/response/metric types 和唯一 `monitoring.snapshot`；
- [x] Core server route 只接受 closed range、AdapterKind、agentId 和 terminal status filter；
- [x] `apps/desktop/src/main/index.ts` 只 allowlist `monitoring.snapshot`；
- [x] preload 继续通过通用 typed request，不新增数据库或文件直读；
- [x] export 使用显式 Save Dialog并复用一次 snapshot，只包含聚合、Coverage、来源质量和 cutover，
  不含正文/裸 ID/路径。

### 4.2 设置导航与页面

目标：`CampNavigation.tsx`、`App.tsx`、新 `RuntimeMonitoring.tsx`、测试和 `styles.css`。

- [x] 在设置“支持”分组增加“运行监控”，不进入普通 App 主导航；
- [x] 使用共享设置侧栏、内容轨、SettingsPageHeader 和 Porcelain/Steel tokens；
- [x] 三 Tab 为概览、用量与成本、性能与可靠性；range/filter 在 Tab 间保持且切换不重复请求；
- [x] overview 显示 run/status/end-to-end/Session/Cache/cost/trend/attention；
- [x] usage 显示 I/O/read/write、Cache efficiency、Context、Cost layers 和 Runtime/Model table；
- [x] reliability 显示 queue/input/first-visible/Session/Context/Approval/Tool/Compaction/enrolled health；
- [x] 每个指标都能显示 available/partial/unavailable 与 Coverage；unknown 显示 `—`；
- [x] 页面显示“数据自 collectionStartedAt 开始采集”，不暗示存在历史回填；
- [x] Antigravity 原生 Usage 保持 unavailable；未实现的 tokenizer estimate 不显示；
- [x] loading/empty/partial/error 保留 header、filter 和已有内容；
- [x] 可见时 12 秒轮询；隐藏/卸载停止；`monitoring.changed`/terminal 以 300ms debounce 刷新；
- [x] 不增加渐变、发光、卡片墙、二级内容侧栏或主题分叉 hex。

## Checkpoint 5：自动验证与真实验收

### Core 与数据

- [ ] Migration fresh install、升级、cutover active Run 排除、无 backfill 和 FK/invariant 测试；
- [ ] raw dedupe、parser replay、counter reset、resume baseline、NULL/0、money precision 和 rollup rebuild；
- [ ] Native Session outcome 的所有合法/非法组合；
- [ ] query range/cutover/timezone/filter/empty/partial 与并发写入 snapshot consistency；
- [ ] Tool Duration 配对、并行 union、冲突/缺失和 Coverage；
- [ ] 监控派生清理不影响 Core 权威事实。

### Parser 与 Runtime

- [ ] Claude、Codex、Copilot fixture suites；
- [ ] OpenCode、Kiro、Qoder、CodeBuddy、Qwen、TRAE 当前版本真实脱敏 Fixture；
- [ ] Antigravity unavailable 与 tokenizer estimate 隔离；
- [ ] 至少对本机可用的 Claude、Codex、Copilot 和 ACP Runtime 执行隔离 smoke；未运行者逐项记录原因，
  不把 Fixture pass 写成真实 smoke pass；
- [ ] 实测能力变化后同步 `docs/runtime-compatibility.md`；Activity 映射变化才同步 registry。

### Renderer

- [ ] navigation、method loading、filter persistence、Tab、empty/partial/error/recovery 与 export tests；
- [ ] Day/Night、1040×700、1440×920、2560×1440、200% zoom、reduced motion；
- [ ] 键盘 Tab/方向键/表格阅读、焦点恢复、屏幕阅读器 label/status；
- [ ] 无页面级横向溢出，长 Runtime/model/currency/source 文本有受控换行/省略和可访问详情；
- [ ] 与用户提供的 HTML 做信息覆盖对照，但不复制 prototype 数字为生产 fallback。

### 仓库门禁

- [x] `cargo fmt --all -- --check`；
- [x] `cargo test --workspace`；
- [x] `cargo clippy --workspace --all-targets --all-features -- -D warnings`；
- [x] `pnpm typecheck`；
- [x] `pnpm test`；
- [x] 目标 Renderer tests/build；
- [x] `pnpm docs:test`；
- [x] `pnpm docs:check`；
- [x] `pnpm docs:adr:generate -- --check`；
- [x] `DOCS_BASE_REF=4b4fe088 pnpm docs:check:ci`；
- [x] `git diff --check`；
- [ ] 按[真实 App UI 验收](../../development/ui-acceptance.md)运行开发 userData 与截图检查。

补充记录：arm64 macOS 打包与隔离 Application 的真实 Renderer→Core、clean-break 空态、三 Tab/筛选、
Day/Night、reduced motion、200% 等效布局及横向溢出检查已通过；populated/partial/error 的真实 App 场景和
真实 Runtime/version smoke 尚未完成，因此不勾选完整 UI 验收。

## 完成条件

只有当 collection clean break、单一 snapshot 的三个子视图、Native Session fact、Tool Coverage、Claude/Codex/Copilot parser、
六个 ACP Runtime Fixture、Antigravity 诚实降级、Renderer 三 Tab 和要求的自动/真实验收全部记录后，才能把
本计划与版本概览标为 `complete`。Provider 对账连接本身属于后续版本，不阻塞本版本；但 v0.96 不能用
allocated bucket 冒充精确单 Run 成本来绕过该边界。
