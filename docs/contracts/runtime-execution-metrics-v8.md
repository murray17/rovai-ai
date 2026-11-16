---
document_type: contract
contract: runtime-execution-metrics
version: 8
status: accepted
source_version: v1.72
last_updated: 2026-11-16
---

# Runtime Execution Metrics v8

继承 [v7](runtime-execution-metrics-v7.md) 的 Session Context、绑定栅栏和刷新路径，替换 RunCard 的
成功/结算/完整性门槛。保留原有用量详情、耗时后备入口、Context 和整个监控页面的结构。
采集与投影规则由 [Usage v12](runtime-usage-monitoring-v12.md)拥有。

## Run 显示投影

`monitoring.execution` 保持 `schemaVersion: 1`，每个 `runs[]` 新增必返字段：

```ts
displayTotalTokens: number | null
```

Core 统一使用方案 1：对当前 logical Run 内可信、可归属、已去重的消费单位求已知计数的和。
优先同范围原生 full total；否则优先含缓存 Input；没有 Input 总量时只合计已知互斥输入桶；
输出已含 reasoning 时不得再加 reasoning。只有 reasoning 时可以贡献已证明的输出子集。
缺字段/缺调用不清空其他贡献；没有合格计数为 null，可信显式零为 0。

成功、失败、取消、等待、运行中和正在停止共用上述准入。`finalizedAt` 与 `inputOutputComplete`
继续作为内部事实返回，不决定是否显示。Context/Session 占用、无法归当前 Run 的累计值、价格或文字估算
不得进入该投影；不同 Runtime 不能改用方案 2 的门槛来补数字。

总量在写入时按同调用 checkpoint 计算，前端不得把 Run 分项相加或据质量猜测。
新 Run 使用 per-source 已知贡献；旧 Run 的安全保守数值及冻结边界见 Usage v12，不能恢复已丢失调用关系。
返回数字必须是非负安全整数；投影超出可安全传递范围时返回 null，不能截断或近似。

## RunCard

- 卡片摘要有数值时只显示一个可点击的 `xxK`，千进制，保留至多一位小数；显式零显示 `0K`。
- 无数值时不显示 Token 数字；保留既有运行耗时或终态时钟入口。
- 卡片摘要不显示“部分”、完整性/覆盖标签、`≥`、`≈`，不回退 Input、Output、Cache Read/Write 分项。
- 有数值时用量入口替代时钟；点击保留原有 Input Token、Output Token、Cache Read、Cache Write 和执行耗时明细。明细读取已有投影，缺失显示 `—`，不重算总量，不新增采集或详情查询。
- 迟到投影沿现有 `monitoring.changed`/有界读取更新；可见性、single-flight、旧 epoch 排除和失败保留规则不变。

## 证据

[Runtime 核查、两方案同样本对照与选择依据](../research/runtime-monitoring/runcard-token-total-audit-2026-11-15.md)。
真实旧样本与本轮受控 parser/事务/UI 测试分别记录，不将它们解释为全部 Provider 的完整账单验收。
