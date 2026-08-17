---
document_type: version-overview
version: v1.02
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
model_context_change: false
last_updated: 2026-08-17
---

# Rovai-ai v1.02：Runtime Usage 补全与 Codex 公价估算

> 当前状态：沿用 [ADR-0205](../../adr/0205-minimal-runtime-usage-metering.md) 的五表最小模型；
> [Runtime Usage Monitoring v3](../../contracts/runtime-usage-monitoring-v3.md) 已接受，实施与验收已按
> [计划](implementation-plan.md)完成。
>
> 前置版本：[v1.01 TRAE 与 Kiro 最高权限队员默认](../v1.01/README.md)

## 版本目标

不新增 Usage 事件表、不改变 Snapshot schema，也不引入 Runtime transcript 扫描：补齐 OpenCode
`>= 1.18.15` 已有 ACP Usage 合同的 Cache Write 与 omitted-zero 语义，并用 Codex `>= 0.145.0` 的完整
Token bucket 生成版本化 OpenAI API public-price equivalent。

## 交付范围

- OpenCode terminal parser 把 `inputTokens` 视为 non-cached Input；对已验证版本把省略的 thought、Cache
  Read/Write 归零，计算完整 Prompt Total 与包含 reasoning 的 Output Total；
- OpenCode Eligibility 增加 Prompt Total 与 Cache Write；版本未知、字段畸形或核心字段不完整时继续
  保持稀疏未知；
- OpenCode ACP `usage_update.cost` 作为累计 Session Cost 被排除在 Run cost 之外；不增加长期 Session
  baseline；
- Codex 完整四桶命中 model/tier/effective-date 价格目录时，在 Run summary 保存
  `price_estimated / price_catalog / USD` 与 catalog version；Reasoning 不重复计费；
- 使用上游 OpenCode 1.18.15 成功 end-turn Cache Write Fixture、现有本机 Fixture和真实 OpenCode Zen/DeepSeek
  探针分别验证正值合同、省略零值及 Provider 实际覆盖边界。

## 明确不做

- 不新增 Runtime-reported Codex Cost parser，不把 ChatGPT/Codex 套餐额度描述为 API 账单；
- 不实现 Codex Credits 持久化，不推断 Legacy Enterprise Rate Card 或未知 Fast Mode；
- 不从 DeepSeek cache miss、Prompt 长度或本地 Tokenizer 推断 OpenCode Cache Write；
- 不改变 Usage schema 2 五表、Snapshot schema 2、45 天 retention 或 clean-break epoch；
- 不覆盖 OpenAI long-context multiplier、regional uplift、Tool fee 或 Provider reconciliation。

## 验收边界

- Rust Fixture 证明 OpenCode Prompt/Uncached/Read/Write/Output/Reasoning 六桶和 omitted-zero/malformed 边界；
- Rust projection 证明 Codex Cache Write 按模型目录计价、Reasoning 不重复计费、结果携带 catalog version；
- 本机真实 OpenCode 1.18.15 探针完成 OpenCode Zen 与 DeepSeek 成功 Turn，并如实记录 Provider 是否返回
  正 Cache Write；
- 定向/全量 Rust、fmt、Clippy、TypeScript、Desktop build、文档门禁和最终差异复核通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.01 冻结为 historical；本概览、实施计划与索引建立唯一 current v1.02。 |
| ADR | 确认无需更新 | 保持 ADR-0205 的最小五表、稀疏值、Run 归因和不存 raw Usage 决定；只升级字段合同和实现。 |
| Contracts | 已更新 | [Runtime Usage Monitoring v3](../../contracts/runtime-usage-monitoring-v3.md)冻结 OpenCode omitted-zero/Session cost 与 Codex price projection。 |
| Architecture | 已更新 | [Runtime Monitoring](../../architecture/runtime-monitoring.md)增加静态价格目录和 Flush 内 Run projection 组合。 |
| UI | 确认无需更新 | Snapshot wire shape 与现有 Usage 页面不变；通用 Cost/Cache 字段会自动显示新增数据。 |
| Runtime Activity | 确认无需更新 | Usage 仍不进入 Execution Evidence 或 Canonical Activity，映射合同完全不变。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 OpenCode 1.18.15 上游合同及本机 Zen/DeepSeek 实测差异。 |
| Documentation routing | 已更新 | Contract 索引切换到 v3，版本索引切换到 v1.02；既有顶层任务导航无需新入口。 |
| Root README | 确认无需更新 | 项目定位和公开 Runtime 支持集合不变，该字段级增强由当前版本与合同拥有。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0205](../../adr/0205-minimal-runtime-usage-metering.md)
- [Runtime Usage Monitoring v3](../../contracts/runtime-usage-monitoring-v3.md)
- [Runtime Monitoring 架构](../../architecture/runtime-monitoring.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
