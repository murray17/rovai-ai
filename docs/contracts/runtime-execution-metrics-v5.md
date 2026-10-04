---
document_type: contract
contract: runtime-execution-metrics
version: 5
status: accepted
source_version: v1.72
last_updated: 2026-10-03
---

# Runtime Execution Metrics v5

v5 继承 [v4](runtime-execution-metrics-v4.md) 的原生上下文、读取生命周期与布局，沿用
[Usage v8](runtime-usage-monitoring-v8.md) 的逐调用归一化与 Input/Output 部分状态。
不增加 UI 入口、轮询、数据库迁移或正文存储。

`monitoring.execution` 的 schemaVersion 1 Run 行增加 `inputOutputComplete: boolean`。
新 Core 始终返回；TypeScript 将它设为可选以兼容旧快照，缺失按未确认处理。
仅内部 collector parser_version >= 5 且 usage_quality 为 runtime_reported 才为 true；
部分、无观测、旧 collector 的历史行均为 false。此门槛是采集实现的证据版本，不是 CLI 版本限制。

四项数值仍提供已收到的稀疏数值与部分和，不因部分状态清空。只有成功终态、summary 已结算、
inputOutputComplete 为 true、Input 与 Output 均可得时，现有 token 入口显示 Input＋Output。
否则沿用现有部分/未知入口与气泡；缓存不再相加。稳定对象复用同时比较该完整性字段，避免
数值相同但完整性变化时漏刷新。该字段仅证明收到的 contribution，不承诺所有原生调用都已上报。

当前 Session Context 的数量、比例、代次和来源规则保持 v4；Flush 不跨观测拼接上下文数量。
