---
document_type: contract
contract: runtime-usage-monitoring
version: 4
status: accepted
source_version: v1.33
last_updated: 2026-08-31
---

# Runtime Usage Monitoring v4

v4 replaces [v3](runtime-usage-monitoring-v3.md). 五张 Usage 表、稀疏 Token 语义、buffer/checkpoint、
Coverage、保留期与 RuntimeUsageSnapshot v2 不变；仅在 Run summary 增加可空 `observed_service_tier`。

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
