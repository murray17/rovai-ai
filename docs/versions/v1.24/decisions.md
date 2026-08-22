---
document_type: version-decisions
version: v1.24
lifecycle: historical
last_updated: 2026-08-22
---

# v1.24 决定记录

本文件解释 Runtime Probe 完整 identity 边界与自动恢复冷却；当前字段和可测试行为由 Architecture 与
Contract 直接拥有。

<a id="v1-24-d01"></a>

## V1.24-D01：完整 Adapter Probe identity 边界与有界自动恢复

### 背景

v1.22 已在完整 Deep Probe 前后复核 executable identity，并在首次更新取代后重绑一次。但 Codex 与 ACP
Runtime 的 managed resolution 仍可能在受保护 Probe 外先执行重复 `--version`；该进程若遇到 Runtime 自更新，
会直接持久化 version 或 cleanup failure。连续两轮 Superseded 后的进程内集合又会永久拒绝同 Runtime 的
Execution 检查，使已稳定的 Runtime 仍需用户动作或 App 重启才能恢复。

### 决定

删除 managed resolution 的外层 version gate，以 Adapter Deep Probe 作为版本、认证、能力、协议与模型目录的
唯一 manager-owned 结果。每轮 Adapter Deep Probe 的完整 `Result` 都位于 v1.22 定义的 identity 前后复核内；
Superseded 仍在同一 attempt/deadline 内最多重绑并重试一次。

Execution 触发的第二轮仍 Superseded 时，不再写永久集合，而是为该 Runtime 写入三秒进程内冷却。冷却内的
Scheduler 请求保持 deferred 且不延长冷却；到期后的下一次请求自动建立新的、仍受 90 秒 deadline 和两轮上限
约束的 attempt。Catalog Open 或 User Check 可以提前清除冷却，但不是恢复的必要条件。

### 后果

- version 阶段更新、认证/能力检查更新和 cleanup timeout 使用同一 Superseded 分类；
- 稳定失败仍绑定重绑后的 path/fingerprint，过时结果不形成公开 failure；
- Scheduler 不忙循环，也不会永久冻结同 Runtime 的等待 Run；
- 公开 wire、数据库、LKG/Ready 分离、Adapter Probe 与正常 AgentRun 执行链保持不变。

### 当前权威影响

- [Runtime Launch and Verification v18](../../contracts/runtime-launch-and-verification-v18.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [Runtime 进程与校验不变量](../../architecture/foundational-invariants.md#runtime-process-verification)
