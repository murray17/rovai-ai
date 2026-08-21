---
document_type: version-decisions
version: v1.22
lifecycle: historical
last_updated: 2026-08-21
---

# v1.22 决策记录

本文件解释 Runtime 更新竞态的处理边界；当前字段与可测试行为由 Architecture 与 Contract 直接拥有。

<a id="v1-22-d01"></a>

## V1.22-D01：完整 Probe 使用 bounded supersession，并把 stale LKG 与当前 Ready evidence 分离

### 背景

Runtime 可以在 `--version`、`--help`、协议初始化或模型目录读取期间更新自身。一次 Probe 因而可能从旧
binary 开始、在新 binary 上完成，或者在更新进程继承 stdout/stderr 后触发 cleanup timeout。直接提交结果会
产生“旧版本号 + 新模型目录”的混合 snapshot；直接记录失败又会把正常更新误报为损坏、认证失败或模型缺失。

完整 SHA 在每个子命令前后重复计算、复制 binary、文件锁或数据库 CAS 都能缩小竞态，但会显著扩大执行成本、
平台耦合和持久协议。另一方面，只延长 cleanup timeout 不能区分真实后代泄漏与更新进程持有 pipe，也不能保护
成功结果的一致性。

### 决定

Check Manager 在每轮完整 Deep Probe 前后读取同一路径的轻量 `ExecutableFileIdentity`。开始读取失败沿用既有
结果；开始成功而结束 identity 不同或无法复核时，本轮为 Superseded，无论 Probe 返回成功、直接错误还是
cleanup timeout 都丢弃。首次 Superseded 在同一 attempt ID、single-flight 槽和绝对 deadline 内等待约 300 ms，
重新解析当前 executable、canonicalize 并计算一次 SHA，然后最多再执行一轮；第二次仍 Superseded 时 deferred，
不写 snapshot、failure、diagnostic 或公开 attempt。

fingerprint 变化后，当前 Installation 立即使用新 binary 的静态 snapshot，旧 Deep Probe 不再构成 Ready、认证、
capability、动态权限或 Session compatibility evidence。唯一可继承事实是最近一次成功 Deep Probe 的模型目录与
成功时间；它在原 24 小时窗口内只作为 stale LKG 展示，到期即 expired，不能绕过当前 fingerprint 的 Dispatch
Preflight。公开 `lastProbeAttempt` 只投影与当前 snapshot fingerprint 匹配的历史行。

### 后果

- 更新竞态成为内部三态中的 Superseded，而不是 Runtime failure 或认证分类；
- 所有 Runtime 共享同一 Check Manager 行为，不在 Adapter 中复制更新特判；
- 一次外部检查最多执行两轮完整 Probe，deadline、attempt identity 和单飞关系保持不变；
- Execution 触发的两轮均被取代后使用进程内 deferred 闸门，Scheduler 重复 tick 不会形成无限外部重试；
  打开模型目录或显式检查可以解除闸门并发起下一次有界检查；
- 模型 Picker 在短暂更新时仍可展示未过期 LKG，但新 binary 的执行资格始终 fail closed；
- 真实稳定 cleanup timeout、稳定认证失败或第二轮稳定错误继续按当前 fingerprint 正常持久化。

### 被拒绝方案

- 每个 Probe 子命令前后计算 SHA 或完整 Probe Identity Lease：更强但超出本次轻量修复；
- 数据库 CAS、文件/更新锁或 binary 副本：增加持久与平台协议，并不能要求第三方 updater 配合；
- 无限重试或重置 90 秒 deadline：让显式检查与执行阻断失去有界终态；
- 单纯延长 cleanup timeout：掩盖稳定后代泄漏且不保护成功 snapshot；
- AGY 专用分支：问题属于所有可自更新 Runtime 的统一生命周期；
- 继承旧 Ready 直到新 Probe 成功：会让当前 binary 借用旧 fingerprint 的执行证据。

### 当前权威影响

- [Runtime Launch and Verification v17](../../contracts/runtime-launch-and-verification-v17.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [Runtime Catalog 与 Installation 不变量](../../architecture/foundational-invariants.md#runtime-catalog-installation)
- [Runtime 进程与校验不变量](../../architecture/foundational-invariants.md#runtime-process-verification)
