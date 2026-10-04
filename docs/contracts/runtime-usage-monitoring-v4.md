---
document_type: contract
contract: runtime-usage-monitoring
version: 4
status: accepted
source_version: v1.34
last_updated: 2026-09-30
---

# Runtime Usage Monitoring v4

v4 replaces [v3](runtime-usage-monitoring-v3.md). 五张 Usage 表、稀疏 Token 语义、buffer/checkpoint、
Coverage、保留期与 RuntimeUsageSnapshot v2 不变；Run summary 增加可空 `observed_service_tier`。
本文同时拥有下述已核验原生来源对 v3 通道规则的收口，不新增 Usage 表或改变公开读取字段。

## 原生逐调用来源

一个 prompt 在发送前选择一种 Token 来源。CodeBuddy 2.133.1、Kimi Code 2.1.1 和 OpenCode 1.18.30
可从当前根 Native Session 的本地记录只读采集新模型调用；先冻结已有 offset／调用身份作为 baseline，
只把本次新增、完成且通过归属检查的调用作为 `delta / model_call` 保存。恢复已有 Session 不认领历史记录，
同一调用的多个本地记录与 ACP 终态统计不能重复累加。选用本地来源后，ACP 的 Context Gauge 与 Cost
仍可独立采集，ACP Token 统计不再进入同一个 prompt 的用量。来源不可用时保持未知。

| 已核验版本 | 原生来源 | Input / Output / Cache 语义 |
| --- | --- | --- |
| CodeBuddy 2.133.1 | 当前 `projects/<workspace>/<session>.jsonl` 的根 `cli` 调用，按 `providerData.messageId` 去重，只读 `rawUsage` | `prompt_tokens` 已含缓存；`completion_tokens` 已含 reasoning，不能再加；缓存读只接受明确 `cached_tokens`，缓存写未知 |
| Kimi Code 2.1.1 | 当前 `agents/main/wire.jsonl` 的 `context.append_loop_event / step.end`，按原生 uuid 去重，排除 `usage.record` 重述 | `inputOther + inputCacheRead + inputCacheCreation` 三桶齐全才合成 Input；Output 取原生值；当前 OpenAI adapter 明确返回缓存写零，不证明正缓存写能力 |
| OpenCode 1.18.30 | 当前根 Session 的只读 `opencode.db`，仅已完成 assistant message 的 Token 元数据，按 message ID 去重 | Input 的三桶齐全才相加；Output 为原生 output 加单独 reasoning 一次；Cache 取明确桶 |

OpenCode 1.18.30 的 ACP prompt result 只描述最后一条 assistant 调用，不能作为整个 Run 的终态 Token
总量；该版本不应用 v3 的终态归并规则。其他版本仍须按各自已验证方言处理，不能自动套用本地格式。
原生记录文件消失、替换、截断、身份容量或单帧边界超限时停止当前 cursor，保留已收到的部分结果，
不从头扫描补历史、不切换来源补总数。终态强制 Flush 在既有序列化锁内先读取，再等待最多 400ms
的固定尾读窗口并再读一次；它解决已观测的 Kimi 写入先后竞争，不承诺任意延迟的完整性。

Claude 的根 `message_delta` 用 `claude-stream-call-usage-v1 / cumulative / model_call` 按原生 message ID
保存。该方言的 message 在本 Run 内新建，首次累计值从零开始计入；后续相同调用只投影正差。
Session／Run 累计来源仍先建立历史 baseline。已经观察到逐调用 Usage 时，终态 `result.usage`
不再重复进入 Token 汇总；独立的原生 Cost 保留。缺字段仍是 `null`，不得用终态聚合补造单次调用字段。

逐字段版本、原始数值与读回证据见[原生 Usage 与 Context 核验](../research/runtime-monitoring/native-usage-context-verification-2026-09-30.md)。

## 实际服务档位

Codex 请求档位仍由 Run 冻结的 `model.options.serviceTier` 初始化。发送前原生 metadata 解析出的实际
请求/继承值可校正 summary 的请求档位，不修改 Run 的冻结对象。原生 Usage 或完成/开始事件明确返回的
档位写入 `observed_service_tier`，未知非空值规范为 `unknown`，而不是缺省 Standard。

费用投影选择 `observed_service_tier > service_tier > unknown`，只有现有静态价格目录和完整 Token buckets
同时支持该档位才估算。`priority`/`fast` 是 Fast，显式 `default`/`standard` 是 Standard；字段缺失、
`auto` 或未知值不套标准价。用户请求 Fast 但原生报告 Standard 时，使用 Standard 估算；后续出现未知
实际档位时撤回旧请求档位产生的 price_catalog 估算，不保留一个已失去依据的 Fast 金额。

原生 reported cost 仍优先于 price estimate。Claude `total_cost_usd` 继续使用原生金额；本合同不建立
Fast 单独计费系统，不访问在线价格，不把 ChatGPT/Claude 订阅额外用量解释为 API 实际账单。

Camp 偏好的资格与作用域见 [Camp Member Fast v1](camp-member-fast-v1.md)；组件边界见
[Runtime Monitoring](../architecture/runtime-monitoring.md)。
