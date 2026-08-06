---
document_type: adr
id: ADR-0075
title: Runtime Integrity at Change and Execution Boundaries
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
---

# ADR-0075: Runtime Integrity at Change and Execution Boundaries

> [ADR-0129](0129-deterministic-bounded-raw-public-context-delivery.md) 删除等待摘要完成的
> Context Compaction 执行路径；本文的 AgentRun Runtime integrity 检查与失败边界继续有效。

## Context

Rovai-ai 为已验证 Runtime 保存 SHA-256 fingerprint，并在 AgentRun 中冻结该证据。
ADR-0066 原先要求发送准入在发现路径或 fingerprint 硬失效时先完成 Runtime
Resolution，只有成功后才创建公开消息、CampTurn 和 AgentRun。当前实现因此在每次
发送前读取并哈希 Runtime 可执行文件。

Codex CLI 等 Runtime 可执行文件可能达到数百 MB。即使优化 SHA-256 实现或在同一请求
内复用结果，把完整内容校验放在每条消息的交互热路径仍会增加发送延迟、磁盘读取、
内存带宽和功耗。Runtime 文件在正常使用期间很少变化，完整哈希的触发频率不应与消息
频率绑定。

本决策局部替代 ADR-0066 第 3、5、6、7 节中关于发送准入必须重新确认 Runtime
fingerprint、fingerprint 变化不得先创建公开消息的条款。ADR-0066 的产品目录、发现、
深度探测、Installation、迁移、能力快照和 Native Session 约束继续有效。

## Decision

### 1. 完整哈希退出消息发送热路径

普通 `camp.messages.send` 准入不得打开或读取 Runtime 可执行文件，也不得计算其
SHA-256。发送只验证可由持久状态同步确定的成员选择、冻结 Runtime 配置、权限和领域
不变量；成功后原子创建用户消息、CampTurn、AgentRun 与冻结 Runtime 配置。工作目录
launchability、当前 Runtime Readiness 和 Git observation 的进一步时机由 ADR-0076
收敛到 AgentRun 调度边界。

文件在消息提交前被删除或替换，不得撤回或阻止已经通过持久配置准入的用户消息。

### 2. 成功完整校验同时保存轻量文件身份

Runtime 安装、更新、自动迁移、成功深度探测或用户主动检查完成完整 SHA-256 后，
Rovai-ai 为当前 Installation 持久保存：

- 可执行路径；
- 已验证 SHA-256；
- 文件大小；
- 纳秒级修改时间；
- 平台文件标识；macOS/Unix 使用 device 与 inode；
- 验证时间。

能力快照继续保存 Runtime 报告版本和完整 fingerprint。轻量文件身份只是判断是否需要
重新完整校验的派生证据，不替代 capability snapshot 或 AgentRun 中冻结的 fingerprint。

### 3. 实际执行边界先做轻量比较

AgentRun 和 Context Compaction 真正启动 Runtime 前，Core 读取文件 metadata，并与当前
Installation 的已验证轻量身份比较。

- 身份完全一致：直接进入 Runtime 启动，不重新读取文件内容；
- 身份缺失或路径、大小、修改时间、文件标识任一变化：在阻塞线程中执行一次完整
  SHA-256；
- 完整 SHA-256 仍等于冻结 fingerprint：更新轻量身份并继续执行；
- 文件不可用、校验期间再次变化或 SHA-256 不一致：禁止 Runtime 启动，把当前能力
  快照标记为需要修复，并让 AgentRun 或后台工作失败。

完整校验发生在公开消息已经持久化之后，不阻塞消息落库或 Renderer 显示。失败属于执行
结果，不通过删除、撤回或隐藏用户消息来伪装发送未发生。

### 4. 低频完整校验触发

完整 SHA-256 只由以下边界触发：

- Runtime 安装完成；
- Runtime 更新、重新发现或自动迁移；
- 轻量文件身份变化或尚无身份记录；
- 用户主动刷新或执行完整性检查。

数据库升级不为既有快照同步读取 Runtime 文件。旧 Installation 第一次进入实际执行边界
时完成一次延迟校验并建立轻量身份。

### 5. 使用标准 SHA-256 实现

完整哈希是低频操作，不再为了消息热路径维护 Rovai-ai 专属的 ARM64 加速配置。所有平台
统一使用依赖库的标准 SHA-256 实现；平台差异只存在于轻量文件标识的采集方式。

## Consequences

- 普通发送不再读取数百 MB Runtime 文件，消息显示延迟、I/O、内存带宽和功耗下降。
- Runtime 未变化时，Agent 启动只承担一次 metadata 读取和数据库查询。
- Runtime 变化时，用户消息会先保留，AgentRun 随后校验并可能失败；UI 与恢复流程必须
  把它呈现为执行失败或 Runtime 需要修复，而不是发送失败。
- 新 Migration 需要持久保存轻量身份；升级后的第一次执行可能进行一次完整哈希。
- metadata 不是内容密码学证明。攻击者若能在同一文件标识下修改内容并精确恢复大小和
  修改时间，轻量比较可能无法触发重新哈希；本决策接受这一取舍，并把完整校验集中在
  安装、更新、显式检查和检测到变化的执行边界。
- 已冻结 AgentRun 的路径和 fingerprint 继续不可变；Installation 更新不能改写历史
  Run。

## Rejected Alternatives

- **每条消息发送前完整哈希。** 安全检查频率与消息频率绑定，造成持续的交互延迟和资源
  消耗。
- **只优化或缓存发送请求内的 SHA-256。** 能降低单次耗时，但仍会在每条消息中读取整个
  Runtime 文件。
- **检测到文件变化后撤回用户消息。** 混淆消息事实和执行事实，也会破坏已经显示与持久
  化的会话历史。
- **完全移除完整哈希。** 无法在安装、更新和真实执行边界确认 Runtime 内容仍与已验证
  快照一致。
- **长期使用进程内缓存。** 无法跨 Core 重启保留证据，也不能可靠表达 Installation
  更新和文件替换。

## References

- [ADR-0066：Managed Product Runtime Discovery, Resolution, and Relocation](0066-managed-product-runtime-resolution.md)
- [ADR-0076：Message-First AgentRun Dispatch Boundary](0076-message-first-agent-run-dispatch-boundary.md)
- [v0.24 版本范围](../versions/v0.24/README.md)
- [v0.24 实施与验收](../versions/v0.24/implementation-plan.md)
