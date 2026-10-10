---
document_type: architecture
architecture: runtime-monitoring
authority: runtime-usage-metering-and-read-boundaries
status: accepted
last_updated: 2026-10-05
---

# Runtime Monitoring 架构

精确字段与方法见 [Runtime Usage Monitoring v8](../contracts/runtime-usage-monitoring-v8.md)；执行台的原生用量与上下文另见 [Runtime Execution Metrics v7](../contracts/runtime-execution-metrics-v7.md)。长期最小化、
稀疏语义、clean break 与 Cost grain 由
[Evidence 与 Usage 不变量](foundational-invariants.md#evidence-usage)拥有。本架构只说明 Usage Transport、内存归一化、
Projection/Rollup、Read Side 和 Renderer 如何组合。

## Component authority

| Component | Responsibility |
| --- | --- |
| Runtime adapter parser | 从已证明的 Runtime wire path 提取稀疏 Token/Cache/Cost；不估算缺失值 |
| Native Usage reader | 在 prompt 发送前冻结当前根 Session cursor，按已验证字段结构只读本地数值元数据；不保存正文或历史回填 |
| Usage buffer | 按调用归一化并以 source identity 去重；保留有序数值帧与 cumulative/gauge baseline |
| Usage flush service | 周期最多每 4 秒一次；一个短事务更新 checkpoint、Run summary 与 hourly rollup |
| Pricing catalog | 按 model key、service tier 与 effective date 提供版本化公开费率；不访问网络 |
| AgentRun terminal boundary | 在结算前等待该 Run pending Usage Flush；权威状态 transition finalizes summary 并删除 checkpoint |
| Retention worker | 每天低频、分批删除超过 45 天的 derived rows 与超过 72 小时的 abandoned checkpoint |
| Snapshot read side | 一次短查询组装 summary/trend/breakdown/Coverage；不访问 Evidence、Blob、Transcript 或网络 |
| Provider reconciliation writer | 在独立后台任务中保存 aggregate billing bucket；不由页面刷新触发 |
| Renderer | 一个 Usage 页面，single-flight Snapshot、可见时有界刷新、未知值与 Coverage 并列展示 |

Execution Evidence、Canonical Activity、AgentRun、Approval、Delivery、Recovery、Context 和 Runtime health
继续由各自 Core domain 拥有。Monitoring 不复制、不删除也不重建这些事实。

执行台增加一条窄读取路径：现有 Run summary 提供每 Run 四项用量，当前原生 Session 上下文单独保存在 `runtime_session_context_latest`。后者由 Session gauge 写入，并由 `Conversation` 的当前 Binding ID、代次和原生 Session ID 在读取时栅栏；指标分支的 Migration 178 从 v1.72/schema 127 建立空表，179 添加 nullable `native_context_ratio` 并升级到 schema 129，保留已安装分支的数据，不回填旧 Run 或旧 Session。合入 Thread 更名后由 180 收口为 schema 130；main 已部署的另一种 schema 128 仅按完整 v32 准入、指标表缺失和精确收据链识别，179 原子补建指标投影，180 保留已具备的 Thread 格式和冻结证据。占用数量与原生比例属于同一最新观测；比例不用于反推 token 数。所有 Runtime 的输出测速已于 2026-10-02 退出；没有字符计数器或临时速度读取路径。原生 Usage buffer、checkpoint、hourly rollup 与 Session Context 继续按既有合同工作。

## Write path

```text
Runtime event/result
  -> adapter/format parser
  -> sparse normalized Usage in memory
  -> source-identity dedupe + ordered per-source numeric buffer
  -> 4s periodic flush OR terminal forced flush
  -> one short SQLite transaction
       runtime_usage_checkpoint
       runtime_usage_run_summary
       runtime_usage_hourly
       optional Codex price_estimated projection
```

`delta` 可直接进入 additive projection；Session／Run 的 `cumulative` 与 `gauge` 首值只建立 baseline，之后只投影正差。
Claude 已核验的 `claude-stream-call-usage-v1 / model_call` 身份在当前 Run 内新建，首次累计值从零计入。
counter reset 只重建 baseline。Run summary 以 logical `agent_run_id` 为粒度，Recovery execution epoch 只隔离
checkpoint，避免重复 Run 和 Coverage。Runtime 事件处理不写 raw/normalized observation row，也不追加
Execution Evidence。

原始 input/read/write 不跨独立调用合并。请求命中计数在已验证的单调用边界生成，
summary/hourly 只加已归一的 contribution；缺 Input/Output 的 contribution 会将 summary 标为部分，
终态不会把部分和升级为完整总量。失败恢复保留旧数值帧在新帧之前，累计首次基线与 reset 不能被
“只保留最后一帧”覆盖。Delta checkpoint 按调用身份暂存，仍遵守 terminal 删除与 72 小时上限。
执行台根据新完整性字段决定是否能显示 Input＋Output，四项已观测值继续可读。

指标层没有 CLI 版本白名单或私设最低版本。实际字段、来源身份和计量语义决定准入；产品本身的
Runtime 最低版本和平台门槛保持。OpenCode V1 使用原生逐调用来源；V2 prompt response 只拥有当前
根会话本轮已报告用量，未覆盖原生子会话／委派，因此沿用部分统计，不能作为完整 Run 总量。
ACP `usage_update.cost` 的 Session 累计不进入 Run summary。Codex 完整 buckets、
模型／档位／生效时间仍决定静态价格投影，不以 CLI 版本代替字段完整性。

周期 Flush 不发出立即 Snapshot 事件。普通事件受全局最短间隔约束；terminal 事件可在 Debounce 后立即
刷新。所有请求仍 single-flight，从而不让 Dashboard 反向阻塞单一 SQLite Database Mutex 上的运行结算。
既有 4 秒周期 Flush 实际提交 Usage／Context 后发出 `monitoring.changed`，活动 Session 与
迟到结果均可刷新当前可见范围；没有写入不通知。提交失败才恢复 batch，不再次累加已提交用量。

### 本地原生数值来源与 Context

CodeBuddy、Kimi Code、Qoder 与 TRAE 使用当前 workspace／Session 下的 JSONL cursor；OpenCode V1
使用只读 SQLite 中的根 Session assistant 元数据，读取根与所选 Runtime 的有效环境一致。
OpenCode V2 停用 V1 reader，使用本轮终态 usage，缺响应时保持缺失；不能从两个来源重复累计。
代际选择数据语义，不形成补丁版本白名单。prompt 发送前建立历史 offset 与身份 baseline；之后
最多每 4 秒在既有 Flush 锁内读取、buffer、落盘，terminal 强制 Flush 保持同一 Run cursor，增加 400ms
尾读后才允许后继 prompt 建立 baseline。整个过程在 blocking pool 读取，不持有 Core Database Mutex
等待原生磁盘。部分行等待完整换行；文件换代、缺口、超限停止采集且不重扫历史。

这些 reader 只保留有界调用身份、offset、文件身份和必要数值。JSONL 的非 Usage 字段由封闭 DTO 跳过，
SQLite 不读取 part／正文；原始行只在本次解析缓冲中存在，不进入 Evidence、Blob、日志或 Renderer。
选定本地 Token 来源后不再混加 ACP Token；Gauge 和 Cost 独立处理。最新版本与字段语义由
[Usage v8](../contracts/runtime-usage-monitoring-v8.md)及其继承的原生来源合同拥有。

Antigravity 在当前根 DONE step 进入 buffer 前，只读对应原生 SQLite 的同调用数值，
交叉核对 stream 与本地身份/计数后替换稀疏观测；Context 读取同一 generator 的原生窗口估计。
Qoder 的 custom-provider input 与显式模型窗口须与原生比例相符；TRAE 的最近根 prompt
占用按已核验的原生 calibrated 语义使用，窗口从本次有效原生模型目录取得。
Kiro 只从精确绑定 Session 文件补原生窗口，缺少独立 used 时仍保留比例和未知数量。
这些补充均不扫描历史会话、不恢复测速，也不从比例反推数量。

Claude 的 Core 私有路径保留最新根调用的数值 Usage 和原生模型身份；真实 message_delta 的
三个输入桶齐全即发出 used-only Session Gauge，同一 result 的该模型 `modelUsage.contextWindow`
到达后确认窗口。Context 保留实际模型身份；同绑定/实际模型/有效配置的后续 used-only
观测复用已确认窗口。模型/配置变化撤下旧分母，used 始终独立；不使用整轮 Usage。Pi managed host v8
调用原生 `ctx.getContextUsage()` 并只发送封闭数值 status，Core 验证 Host、Run、Session、绑定代次和
实际 provider/model 后消费；正文或全会话统计不进入此路径。只有窗口上限时 used 仍未知，压缩后
原生 tokens 尚未重新有效时清空旧 used。两条私有路径均在公开 Evidence 分发前截断。

Kiro 从原生 metadata 接收比例，CodeBuddy 从最新根调用输入与同模型 catalog 窗口得到 Context；
只有比例／只有 used 都可保留，但不能反推精确数量或猜窗口。Antigravity 的结构化 DONE step
走数值专用 Usage 事件，消费后在公开 Evidence 分发前截断；累计 result 不混入 Run。

DSH 私有 committed Usage 保留原生完整调用 total，校验后以 total 减 output 接通含缓存 Input；
缓存桶缺失仍未知。ZCode 从已有终态 session/read 的原生 runtime.contextUsage 提取同 Session
used/size，在 prompt 终态之前交给现有绑定栅栏；不增加轮询或传播完整 snapshot。

Cline 官方 ACP 的数值补充来自只读 Plugin `afterModel`，按根调用、精确 Prompt lease、原生 Run 和
单调序号归属。既有周期 Flush 读取有界私有文件，terminal 消费同一批记录并排除已采序号；
无正文、原生历史扫描或第二个定时器。四个原生 token 桶按 `model_call / delta` 归一化，可选 reasoning
不与 output 重复相加；最新调用的含缓存 input 独立产生 used-only Gauge，实际模型来自该调用。
Host 同时将原生 `settings/models.json` 中显式的 `contextWindow` 冻结为仅含 Provider/模型/数值的私有目录，
observer 以实际调用返回的 Provider 与模型 ID 精确匹配后补窗口；目录由现有 native configuration digest 栅栏，
不猜别名、不使用压缩回退或最大可选窗口。窗口和 used 独立，缺字段仍未知；此只读路径不访问 Provider 网络。
配置缺窗口时，可先独立核验 Provider 对精确模型的元数据，再由原生配置明确生效；不把手动同步说成自动发现。
原生比例和费用缺失时保持未知。Cline 仍未取得 First-Class 资格。
Command Code ACP 的 `usage_update.used/size` 作为 Session Gauge，`session/prompt` 结果的 `_meta.usage`
四个字段作为当前 prompt 的 Delta，input 包含缓存，归一化时扣除 read/write 得到 uncached；同结果的 `usage` 是 Session 累计，禁止入账。原生累计 Session
cost 缺少安全的跨 Run baseline，按现有 OpenCode 边界保持 Run 费用未知；没有 reasoning 字段时保持 NULL。
旧 headless 数值帧只保留内部研究路径。真实字段与验收层级见
[两条 Runtime 数值核验](../research/runtime-monitoring/command-cline-verification-2026-10-04.md)及
[窗口补采复核](../research/runtime-monitoring/command-cline-context-window-2026-10-05.md)。

## Read path

Codex Run summary 可记录实际 service tier；费用投影先用原生观察、再用冻结/发送时请求档位。未知不套
Standard 价，实际回退 Standard 不按请求 Fast 计价；失去档位依据时撤回旧目录估价。这个小型 metadata
写入不新增计费系统，也不替代 Claude 等 Runtime 的原生 reported cost。精确行为由
[Runtime Usage Monitoring v8](../contracts/runtime-usage-monitoring-v8.md) 拥有。

```text
visible Settings page
  -> one monitoring.snapshot(filter)
  -> bounded SQL over run_summary/hourly/reconciliation
  -> RuntimeUsageSnapshot v2
  -> summary + trend + Runtime/Model tables + optional reconciliation
```

24 小时趋势直接读取 hourly；7/30 天在查询中按日聚合。Snapshot 不随 Tab 预计算无关 read model，因为
当前页面没有 Tab 和 Reliability 子产品。查询只处理小 projection，不读取 Managed Blob、不解析大型 JSON、
不扫描 Transcript/Evidence，也不执行网络请求。

## Sparse and grain rules

- missing 保持 `NULL`；显式 zero 或已验证 dialect 的 omitted-zero 才参与聚合；
- Runtime/version Eligibility 由真实 Fixture/协议冻结，不因某次 Run 缺字段而改变；
- Coverage 始终按 `observed logical Runs / eligible logical Runs`；
- input/cache bucket 只有在 semantics 可证明时组合；
- reasoning output 不与 output 重复相加；
- Run cost 只保存可归因该 Run 的最佳来源；Codex catalog projection 固定为
  `price_estimated / price_catalog / USD`，不是订阅账单；
- Provider aggregate cost 保持 Provider/billing scope/currency/time range grain，不分摊到 Run；
- currency 不推断、不转换，不同 currency 分行返回。

## Retention and clean break

Run summary、hourly 与 reconciliation 保存 45 天。active checkpoint 受保护；terminal transition 立即删除，
遗留 checkpoint 72 小时到期。清理每天一次、每批不超过 1,000 行，不在页面请求中执行，也不自动完整
`VACUUM`。

Migration 92 是破坏性的 Monitoring clean break：删除 v1 Monitoring schema，建立 schema 2 五表、新 collection
epoch、Database contract `v0.99` 与 projection schema `47`。不存在回填、双读、双写或兼容视图。

## References

- [Evidence 与 Usage 不变量](foundational-invariants.md#evidence-usage)
- [Runtime Usage Monitoring v8](../contracts/runtime-usage-monitoring-v8.md)
- [v0.99 implementation plan](../versions/v0.99/implementation-plan.md)
- [Runtime monitoring feasibility audit](../research/runtime-monitoring/README.md)
- [Core 受管内容不变量](foundational-invariants.md#core-managed-content)
- [Canonical Activity 不变量](foundational-invariants.md#evidence-canonical-activity)

### Context 的运行中可用性

Context 以当前 Session/绑定/Run epoch 归属，和 delivery 是否 accepted 解耦；不存在等待 prompt
终态的第二个临时 Context 池。原生占用不进入 consumption checkpoint，只更新一个 latest 行。
消息省略实际模型时允许继承同绑定配置已经确认的身份，配置别名本身不建立确认。

ZCode 当前根模型调用结束/压缩完成通过合并的待读序号唤醒一个 snapshot worker；返回快照已覆盖的触发不再补读，既有原生响应
reader 不被查询阻塞。live、terminal 和 background snapshot 串行读取；仅 live 返回消息数限制为 1，终态沿用原参数，
只把数值投递到 Core；旧 input 的回读丢弃。无通用新定时器或正文保存。Pi/Antigravity 的独立
used/window 不再互为入口条件。支持时机与真实 App 范围见[可用性验收](../research/runtime-monitoring/live-context-usability-2026-10-04.md)。
