---
document_type: version-overview
version: v0.99
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-17
---

# Rovai-ai v0.99：最小 Runtime Usage Metering

> 当前状态：长期边界已由 [ADR-0205](../../adr/0205-minimal-runtime-usage-metering.md)接受；实现与验收
> 正在按[实施计划](implementation-plan.md)收口。
>
> 前置版本：[v0.98 结构化 Skill 文件链接](../v0.98/README.md)

## 版本目标

把 v0.96 引入的宽 Runtime Monitoring 收缩为只服务 Token、Cache 和 Cost 的最小 Usage metering。
Runtime Usage 在内存解析、去重和兼容合并，以 4 秒周期或 terminal 强制 Flush 到五张有界派生表；页面只
读取单一 `monitoring.snapshot`，不扫描 Execution Evidence、Transcript 或 Blob。

这是 Monitoring 数据的 clean break。v1 历史不回填、不双读、不双写；Runtime 未上报字段保持未知，
Coverage 只对已由协议或真实 Fixture 证明 eligible 的 logical AgentRun 统计。

## 交付范围

### 最小持久化与热路径

- Migration 92 删除旧 Monitoring table/trigger/index，建立唯一 schema 2 collection epoch；
- 只保留 collection state、logical Run summary、hourly rollup、Provider reconciliation bucket 和 active
  checkpoint 五张表；
- 不保存 raw/normalized Usage 或 permanent dedupe ledger，Usage 不追加为 Execution Evidence；
- 同 source identity 在内存合并，周期 Flush 不触发立即 Snapshot，权威 terminal transition finalizes
  summary 并清理 checkpoint；
- 45 天派生数据保留、72 小时 abandoned checkpoint、每日最多 1,000 行分批清理，不自动完整 VACUUM。

### Runtime Usage 语义

- Codex、Claude、ACP/Copilot 按各自已证明 wire shape 解析 Token/Cache/Cost；
- OpenCode、Kiro、Qoder、CodeBuddy、Qwen、TRAE 仅保存实际出现且 Fixture 证明的 ACP Usage；
- Antigravity 不做 Tokenizer 推断，也不制造 Cache 或真实成本；
- delta/cumulative/gauge、counter reset、input/cache bucket 和 reasoning subset 维持稀疏且可审计的算术；
- Run cost 只保存可归因值，Provider aggregate cost 保持独立 billing grain，currency 不推断。

### Snapshot 与设置页

- TypeScript/Core Snapshot 升为 schema version 2，只含 collection/range、Usage summary/trend、Runtime/Model
  breakdown、Coverage 与可选 reconciliation；
- 设置页只有一个 Usage 视图、五个筛选器、汇总、趋势和两张分组表；无 Overview/Reliability Tab；
- 页面可见时 12 秒轮询，事件刷新有 Debounce、10 秒最短间隔和 single-flight；隐藏后停止；
- 未知值显示 `—`，同时显示 observed/eligible Coverage；不显示 cutover 提醒或版本说明。

## 明确不做

- 不在 Monitoring 复制 Session、Tool、Activity、Delivery、Approval、Reliability、Context、Compaction 或
  Probe 数据；
- 不读取或重建 Execution Evidence、Canonical Activity、AgentRun 与其他 Core authority；
- 不保存每次 Runtime Usage update 的 raw row，也不为未来可能性保留旧 v1 schema；
- 不在页面打开、普通刷新或 Snapshot 持锁期间执行 Provider 对账、价格同步、网络请求或清理；
- 不补算历史数据，不把缺失解释为零，不推断币种或把 Provider 账单摊到 AgentRun。

## 验收边界

- Migration 92 证明旧 Monitoring schema/数据彻底退出、新五表和 collection epoch 建立、Core 历史不受影响；
- parser/normalizer 覆盖稀疏字段、显式零、partial、counter baseline/reset、ACP cost currency 与 Antigravity；
- checkpoint/rollup 覆盖同一 logical Run 的 Recovery epoch、重启去重、terminal cleanup 与无重复累计；
- Snapshot 覆盖 empty/partial/populated、24h/7d/30d、筛选、Coverage、multi-currency 和 Provider grain；
- Rust、TypeScript、Renderer、Node、文档、fmt、Clippy、Desktop build、隔离打包 UI 与 `/Applications`
  安装启动全部通过。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.98 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v0.99。 |
| ADR | 已更新 | [ADR-0205](../../adr/0205-minimal-runtime-usage-metering.md)替代 ADR-0201，冻结最小五表、稀疏 Usage、保留和读取边界。 |
| Contracts | 已更新 | [Runtime Usage Monitoring v2](../../contracts/runtime-usage-monitoring-v2.md)替代 v1，定义 parser、persistence、Snapshot 与刷新合同。 |
| Architecture | 已更新 | [Runtime Monitoring](../../architecture/runtime-monitoring.md)收缩为 in-memory Usage buffer、短 Flush、五表 Projection/Rollup 与单 Snapshot read side。 |
| UI | 已更新 | [Runtime Monitoring surface brief](../../../apps/desktop/.impeccable/surfaces/runtime-monitoring.md)删除三 Tab 和可靠性面板，只保留 Usage 汇总、趋势与分组表。 |
| Runtime Activity | 确认无需更新 | Runtime Activity 与 Execution Evidence authority 未改变；本版明确禁止 Usage 进入 Evidence。 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 产品准入或版本结论；各字段 Eligibility 由 parser Fixture 拥有，不扩大 Runtime 支持声明。 |
| Documentation routing | 已更新 | 文档导航、ADR CURRENT/HISTORY、Contract/Architecture 索引切换到 ADR-0205 与 v2 合同。 |
| Root README | 确认无需更新 | 项目定位和公开 Runtime 支持范围不因内部监控删减而改变；版本状态由唯一 current 入口拥有。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0205](../../adr/0205-minimal-runtime-usage-metering.md)
- [Runtime Usage Monitoring v2](../../contracts/runtime-usage-monitoring-v2.md)
- [Runtime Monitoring 架构](../../architecture/runtime-monitoring.md)
- [Runtime monitoring feasibility audit](../../research/runtime-monitoring/README.md)
