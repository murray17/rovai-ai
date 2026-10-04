---
document_type: contract
contract: runtime-execution-metrics
version: 1
status: accepted
source_version: v1.72
last_updated: 2026-10-02
---

# Runtime Execution Metrics v1

本合同区分两种原生数据：四项用量属于逻辑 `AgentRun`，沿用 [Runtime Usage Monitoring v4](runtime-usage-monitoring-v4.md)；上下文属于当前原生 `Conversation / Binding / Session`。两者不互相填补。

2026-10-02 按用户要求撤下所有 Runtime 的输出测速。Core 不再分类或累计正文／思考字符，Desktop／Web 不再提供临时测速接口，Renderer 不再轮询、平滑或显示 `tok/s`。原生用量、上下文和思考内容隔离继续保留；本次不修改数据库结构或已有数据。

## 读取与归属

`monitoring.execution({threadId, agentRunIds})` 返回 schemaVersion 1、`runs[]` 与 `sessions[]`。兼容旧 `campId` 输入；新旧字段同时出现则拒绝。最多读取 500 个指定 Run，Run 必须属于 Thread；返回的用量只取当前 Monitoring collection 的 `runtime_usage_run_summary`。每个 Run 行提供 `agentRunId`、`executionEpoch`、`promptInputTotalTokens`、`outputTokens`、`cacheReadTokens`、`cacheWriteTokens`、`finalizedAt`、`lastObservedAt`。缺失保持 `null`，运行中已到达的原生用量继续保存和读取。

`sessions[]` 只返回该 Camp 目前 `Conversation.native_binding_id + native_binding_generation + native_session_id` 均匹配的最新上下文。每行包含 `conversationId`、`agentId`、`sessionGeneration`、`runtimeKind`、`modelKey`、`usedTokens`、`windowTokens`、`nativeRatio`、`source`、`dialectId`、`observedAt`。持久行还保存原生 Session ID、Runtime 版本、有效配置摘要、来源 Run/epoch。旧会话事件、旧绑定代次、较早观测不能覆盖当前值；后续 Run 的有效配置变化使旧观测在读取时失效。

### Renderer 读取生命周期

执行面板用实际可见性与页面可见性共同控制 UI 读取；隐藏时停止用量和 Context 请求，
Core 的原生采集与落盘继续运行。恢复可见、重新聚焦或连接失效通知后立即重读。

`monitoring.execution` 只请求当前活动、视口内卡片以及新展开的 Run；可见但收起的卡片仍读取 token
入口。活动期间的 4 秒兜底只读取活动 Run。终态转换立即读取，并在 250ms／1s／4s 做有限尾读，
不为稳定历史永久轮询；尾读之外的迟到 Usage／Context 由落盘后的 `monitoring.changed` 承接。
通知按 80ms 合并，所有触发共享一个在途请求；在途期间到达的失效保留一次后续读取。
隐藏时保留刷新意图，旧范围或旧执行代次的迟到响应不提交。失败保留已有值，仅以 1s／2s／5s 有限重试。

每个 Camp／队员面板最多缓存 500 个 Run 行；只替换请求范围内的行，未请求的有效历史暂存复用，
已移出当前 Run 集合或代次不符的行清理。请求中缺失的行恢复未知；`sessions[]` 每次整体承接当前
Session 权威视图，不与历史 Run 缓存拼接。比较原始数值、代次、模型、来源、结算状态和观测时刻，
相同条目保留对象和数组引用，整份相同不更新 state。数量的缺失、原生零与仅有比例继续区分。
后端对指定 Run 执行一次参数化批量查询，保留 Camp／当前 collection／最大 500 条准入，不读取历史正文。

只接受同一原生 Session 观测的明确 `used`、正数 `window` 或有限的原生 `nativeRatio`（0–1）。`nativeRatio` 独立保存，数量仍可为空；可靠 used/window 齐全时优先按两者计算比例，否则可展示原生比例，不反推任何 token 数。只有窗口上限时 used 和比例仍未知。每次有效观测整体替换数量与原生比例，不跨时刻或配置拼接。Migration 179 在已安装的 v1.72/schema 128 表上添加 nullable REAL 比例，原记录和业务数据保留，升级为 schema 129；不回写已安装分支的 Migration 178。合入 Thread 更名后由 Migration 180 将 schema 129 收口为 130；main 已安装的 schema 128 仅在完整 v32 Context 准入、没有指标表且没有后续收据的精确布局下获准，179 在同一事务补建指标表和比例，180 保留其既有格式及冻结证据。随后 User 投影与队员创建分别由 Migration 181/182 升至 schema 131/132。已部署 main schema 129/130 仅在完整 Thread、User 和对应队员回执结构、连续迁移收据及没有指标表的精确组合下获准；原子补建空指标投影并追加缺失收据，既有收据时间、业务数据和冻结证据保持。缺失或混杂结构拒绝升级。Codex 当前已核验的通知把 `tokenUsage.last.totalTokens` 作为最近单次模型调用的 Context used 候选，与同一通知的 `modelContextWindow` 配对；它不是实时窗口同步值。`tokenUsage.total.totalTokens`、`last.inputTokens`、Run 累计与正文估算都不能代替 used。Context 的来源身份独立于 Run Usage 的累计来源身份：消耗总量未变但 `last` 或窗口变化时仍接收新观测。ACP 原生 Gauge 在提示结束后到达时，可在短暂的原 Session owner 保留期内按原 Run／代次落盘；新 owner 绑定后不沿用旧 owner。`used > window` 的无效观测不进入当前上下文。当前绑定发生已确认压缩后，旧 gauge 在新 gauge 到达前不再显示。

## 原生上下文来源

Claude 已核验的 Context used 取最近根模型调用的 `input_tokens + cache_read_input_tokens +
cache_creation_input_tokens`；三项必须齐全，window 只取同一 result 中与该调用原生模型严格匹配的
`modelUsage.<model>.contextWindow`。输出、其他模型以及整轮 `result.usage` 不能拼接到该观测。
尚未收到该调用有效 `message_delta` 时，不使用 `message_start` 的暂定零值建立占用。

Pi managed host v8 使用原生 `ctx.getContextUsage()` 的 tokens／contextWindow，来源标为
`pi-native-context-estimate-v1`，它包含 Pi 自己对最新调用之后本地条目的估计，不能描述为精确实时窗口。
Host 数值 status 必须匹配当前 Host instance、Run epoch、原生 Session、Binding generation 和实际
provider/model；拒绝额外内容字段。压缩后原生 tokens 未知时只保留窗口，不沿用旧比例。
`get_session_stats` 的全会话累计不参与 Context。以上是各 Runtime 的已验证专用来源，不是通用 Usage→Context 公式。

Qoder 1.1.64 只读当前根 Session journal 的 assistant `message.usage`，严格校验 Session、cwd、
entrypoint=acp 和 isSidechain=false。custom Provider 的输入承接已包含缓存的原生 prompt 总量；
其他来源的用量可能被原生隐藏，不把归零后的数字认作真实零。缓存归一化可能补默认零，缺乏原始
presence 的零保持未知。`context_usage_ratio` 独立形成 Gauge，used/window 保持未知。message.id
去重模型调用，Context 用 message.id + 原生观测时间去重；旧 pending message 也加入 prompt baseline。

Grok Build 1.0.44 的根 ACP 通知 `params._meta.totalTokens` 是原生当前占用，与终态累计 Usage 分开。
window 只取当前 Host 启动时捕获的、与原生观测模型 ID 匹配的 `model.<id>.context_window`。
未验证的内置 catalog/default 不猜窗口。身份使用当前 Host/prompt 的接收序号，不哈希随通知到达的
正文或思考。模型或有效配置变化继续由当前 Session 读取栅栏隔离。

OpenCode 1.18.30 的最近已完成根 assistant 调用用于原生占用：input + cache.read + cache.write，
不含输出或独立 reasoning。原生 ACP 的 size 由实际 Provider/Model 的有效 limit.context 得到；
其 native loader 已合并配置和模型目录，没有 size 时仅保留 used，不在 Core 猜模型窗口。

Copilot CLI 1.0.83 订阅 `clientCapabilities._meta["github.com/copilot"].events` 的
`assistant.usage`，不再主动订阅思考增量。`github.com/copilot/sessionEvent` 经当前 Session/prompt
栅栏，排除子 Agent 和 dataOmitted；逐调用 Usage 是 Run 的唯一输入，不再累加其 process/session
累计终态。未经请求仍到达的思考等私有事件继续丢弃，不进入 Evidence、Blob、公共 IPC 或 Renderer。

部分 ACP Runtime 在 prompt 返回时才确认输入交付。纯数值 Session Gauge 提前到达时，
Core 在现有 Usage buffer 中只保留同一当前 Run 的最新观测，保留原生观测时刻；交付确认后再按
原 Session／Binding／epoch 栅栏保存。其间原生 Token Usage 照常落盘，不重复累计。
不保存尚未确认归属的 Context；拒绝输入、失效绑定、新 owner 或未确认的终态会丢弃待确认 Gauge。
临时观测不跨 Core 重启恢复。Copilot 原生 `assistant.usage.data.model` 可以修正默认模式下
ACP 广告模型与实际调用模型的差异，不把广告标签当作实际 Provider 调用证据。

## 显示

- 运行中的 Run 卡片保留原有执行耗时；执行台标题保留当前 Session 上下文入口。
- 终态卡片不直接显示耗时。收到任一有效原生用量字段时，显示 `xxk` 用量入口；只有成功、Run summary 已结算、Input 与 Output 都已得到时，入口值为 `Input + Output`；Cache 是 Input 的子集，不再次相加。失败、取消及部分观测仍能在气泡查看已收到的字段，入口值为未知。完全没有用量字段时保留时钟入口，点击查看执行耗时；迟到用量落盘后入口切换为 token 数字。
- 用量气泡显示 Input Token、Output Token、Cache Read、Cache Write 四项和分隔后的执行耗时，不加用量合计行、Run 编号或摘要。上下文入口是弱化小圆环，默认并排显示四舍五入的整数百分比，比例未知时显示 `—`；气泡只显示 `used / window` 与比例。缺乏数量与原生比例时不显示 `0%`；可靠原生零比例可显示 `0%`，不从比例反推精确 used。

## 证据门槛

字段资格由 Runtime、版本及实际 wire 方言决定。Parser 命中、安装版本、端到端 Run、持久化和 UI 是不同证据阶段；未经过当前安装版本与真实调用核验的字段保持“未验证”。原生输入为缓存包含总量时直接使用原生总量；互斥桶只有齐全才合成 Input。Reasoning 已包含在 Output 时不重加。重复模型调用与终态统计按来源身份去重，恢复累计量由 checkpoint 建立基线；失败、取消和超时保留部分观测。

本轮 Qoder／Grok／OpenCode／Copilot 字段证据见[原生比例与当前占用核验](../research/runtime-monitoring/native-context-ratio-verification-2026-10-01.md)。上一轮原生 Usage、Context 和打包 App 证据见[原生来源补接与核验](../research/runtime-monitoring/native-usage-context-verification-2026-09-30.md)；[第二轮执行指标核验记录](../research/runtime-monitoring/execution-metrics-verification-2026-09-29.md)与[v3 思考流接通](../research/runtime-monitoring/observable-output-v3-verification-2026-09-30.md)保留各自当时的支持范围。[首轮 v3 核验](../research/runtime-monitoring/observable-output-v3-verification-2026-09-29.md)保留当时的 offset 限制与验证状态，不作为最新支持结论。

上述思考流与速度记录仅描述退役前的实现，不代表当前功能；历史探针和算法可在 Git 提交 `ee444ab1` 查阅。
