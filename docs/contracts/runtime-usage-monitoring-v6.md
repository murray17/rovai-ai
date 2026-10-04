---
document_type: contract
contract: runtime-usage-monitoring
version: 6
status: accepted
source_version: v1.72
last_updated: 2026-10-03
---

# Runtime Usage Monitoring v6

v6 继承 [v5](runtime-usage-monitoring-v5.md)，补齐 DSH 原生完整调用总量。延续原生稀疏计量、去重、buffer/checkpoint、
Coverage、保留期、实际服务档位和 RuntimeUsageSnapshot v2；不新增数据库表或修改读取 wire。

## 兼容资格

指标采集不得按 CLI 的单个版本、版本白名单或指标私设的最低版本拒绝读取。Runtime 产品准入拥有
真正的最低版本／平台要求（例如 Grok Build 的产品门槛），指标层不再增加一层版本阻断。
版本只用于诊断和记录实测证据。版本未知、旧版本和新版本，只要原生字段结构、归属与语义符合方言，
均进入同一解析路径；不符合的字段保持未知，不自动套用其他格式，不把缺失补零。

这取代 v3/v4 的指标版本门槛，包括 Codex cache-write/price projection、ACP 私有 Usage、
Copilot 订阅、Grok Context window 和本地 reader。静态价格目录的模型／档位／生效时间条件不变。

## 原生逐调用来源

一个 prompt 发送前固定一种 Token 来源。CodeBuddy、Kimi Code、Qoder、OpenCode 和 TRAE 的
本地 reader 先建立已有 offset／调用身份 baseline，再采集当前根 Native Session 的新调用。
同一调用与终态重复汇总不混加。恢复已有 Session 不认领历史；旧 pending 调用也属于 baseline。
以下版本记录属于实测证据，不是准入限制。

| Runtime（实测版本） | 原生来源 | Input / Output / Cache 语义 |
| --- | --- | --- |
| CodeBuddy（2.133.1） | 当前 workspace/Session journal 的根 `cli`、`providerData.messageId`、`rawUsage` | `prompt_tokens` 含缓存，`completion_tokens` 含 reasoning；Cache Read 取明确 `cached_tokens`；Cache Write 未知 |
| Kimi Code（2.1.1） | 当前 `agents/main/wire.jsonl` 的 `context.append_loop_event / step.end`，原生 uuid 去重 | Input 需 `inputOther/inputCacheRead/inputCacheCreation` 三桶齐全；排除 `usage.record` 重述 |
| Qoder（1.1.64） | 当前根 journal，Session/cwd/entrypoint/sidechain 校验 | custom provider 的 `message.usage`；隐藏或原生默认归零的分类仍未知；比例独立于 Usage |
| OpenCode（1.18.30、1.18.32） | 只读 SQLite 根 Session 的已完成 assistant message 元数据 | input/cache.read/cache.write 齐全才合成 Input；output 加独立 reasoning 一次；异常空调用的初始化零不成为 Usage/Context |
| TRAE CLI CN（0.120.52） | 平台 cache 的 `trae-cli/sessions/<id>/events.jsonl`，`session.json` 校验 id/cwd；根 branch/agent/parent 身份校验 | `message.message.response_meta.usage.prompt_tokens/completion_tokens/prompt_token_details.cached_tokens`；Input 含缓存，Output 不重加 reasoning；Cache Write 未知 |

本地来源不可用时保持未知；选中后不切换另一来源补总数。ACP Gauge/Cost 仍可独立采集。
OpenCode 与 Copilot 的 ACP 终态可能只覆盖最后调用或整个原生 Session，不再按版本猜其为完整 Run。
文件消失、替换、截断、身份／单帧超限时停止当前 cursor，保留已有部分结果，不从头扫描补历史。
终态在既有序列化锁内强制读，并以固定 400ms 尾读承接写入竞争；不承诺任意迟到的完整性。

TRAE session metadata 与 journal 都只读、拒绝符号链接、限定大小；首个 prompt 允许原生目录尚未创建，
记录出现后必须验证元数据。正文、思考、工具参数和 trace 不进入 Rovai 持久化或公开 IPC。

Claude 根 `message_delta` 继续按 message ID 归并 `claude-stream-call-usage-v1 / cumulative / model_call`。
本 Run 新调用的首值从零计入；已收到逐调用 Usage 后不再混加 `result.usage`，原生 Cost 独立保留。
Copilot 在所有产品准入版本只请求 `assistant.usage`，不请求思考增量；根、时间、Session 和
`dataOmitted` 校验保持。原生未返回不代表零。

### Antigravity 结构化来源

`stream-json` 当前 input step 之后的根 `DONE` agent_response/checkpoint step Usage，按
conversation ID + step index 去重并作为 model_call delta。输入之前、旧 step、子 Agent、工具及
ACTIVE 快照不计入；每次执行最多保留 8192 个已处理数字身份，超限停止新采集。
`result.usage` 已由真实恢复和官方协议确认是 Session 累计，不能作为新 Run 总量或与 step 相加。

Output 取 `output_tokens`，thinking 是其分项，不重复相加；Cache Read 取明确 `cache_read_tokens`。
原生 `total_tokens` 不含缓存读，不能充当含缓存的 Input。输入缓存分类语义尚未完整确认，因此
Input total、Cache Write、Context 保持未知；不由 token 总量推测占用。
没有结构化 step 来源时保持未知，不能解析普通正文凑数。

逐字段原始数值与读回见[无指标版本门槛的原生来源验收](../research/runtime-monitoring/native-format-compatibility-2026-10-02.md)。

## DSH 原生完整调用总量

`assistant/message` 与有已确认 owner turn 的 `compaction/summary` 继续由原生 committed event
提供逐调用数值。私有 bootstrap 白名单同时保留 `totalTokens`，不引入会话累计来源。
DSH TokenUsage 将该字段定义为含缓存输入加输出的完整调用总量；校验通过时，
`promptInputTotalTokens = totalTokens - outputTokens`，并标记 `cache_inclusive_total`。

减法必须非负，且结果不小于所有已知互斥输入桶之和；读写缓存均已知时必须与三桶之和相等。
显式非法或矛盾的 total 不提供 Input；未提供 total 时沿用三桶齐全才合成的规则。
Cache Read/Write 的缺失仍是 null，不能由剩余数倒推出分类，也不能再次把缓存加到 Input。
方言为 `dsh-committed-call-usage-v3`，不按 CLI 版本决定准入。

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
