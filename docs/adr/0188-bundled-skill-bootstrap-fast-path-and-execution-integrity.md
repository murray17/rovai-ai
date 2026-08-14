---
document_type: adr
id: ADR-0188
title: Bundled Skill Bootstrap Fast Path and Execution-Time Integrity
status: accepted
date: 2026-08-14
decision_scope: cross-version
source_version: v0.82
supersedes: []
superseded_by: null
---

# ADR-0188: Bundled Skill Bootstrap Fast Path and Execution-Time Integrity

## Context

Core 冷启动会确保 official bundled Skills 已安装。旧实现即使内置 bundle 与数据库记录完全未变化，也会
把十二项 Skill 全部写入 staging、逐文件 `fsync`、复制到 verify 目录，再读取并哈希已安装 Revision。
这项完整性检查位于 Core 接收首个 Desktop request 之前，因此普通启动恢复会无条件承担数秒文件系统工作。

Skill Revision 仍必须不可变，损坏内容也不能进入 Runtime。启动性能优化不能把数据库 digest 当成唯一证明，
也不能把检查推给 Renderer，或允许未经完整校验的 Revision 启动 AgentRun。

## Decision

1. Core 从编译进二进制的 bundled definition 直接在内存计算 expected content digest、文件数、总字节与风险
   摘要；未变化路径不得先物化 staging。
2. 当 official Skill 的数据库 current digest 与 expected digest 相同，启动 bootstrap 只验证 Revision 的
   文件路径集合、regular-file 类型、大小与权限 mode。完全匹配时跳过 staging、复制、`fsync` 与全文哈希，
   但仍恢复 system-required enablement/assignment 配置。
3. digest 变化，或轻量文件树验证发现缺失、额外文件、symlink、大小或 mode 不一致时，Core 必须在 ready
   前走既有完整 materialize、copy、digest verify 与 publish/repair 路径。修复继续产生 durable event。
4. 轻量启动验证不是执行完整性证明。每次新 AgentRun 的 SkillProjection preflight 继续对精确 current
   Revision 做完整内容哈希；任何 digest mismatch 都 fail closed，Runtime 不得启动。用户显式诊断/修复也可
   执行完整校验。
5. 同大小、同 mode 的内容篡改可以在 bootstrap 快速路径中暂不读取，但必须在首次相关 AgentRun 的执行边界
   被完整哈希捕获。不得用快速路径结果生成新的 Revision、SkillExposureSnapshot 或 Runtime load receipt。
6. Core 输出不含用户内容、路径或稳定实体 ID 的启动阶段耗时与 fast/materialized/repaired count，供安装版
   冷启动回归使用。

本决定扩展 ADR-0075 的 change/execution integrity 时机，并保持 ADR-0105、ADR-0158、ADR-0161 的 Library、
Projection 与 AgentRun preflight 权威不变。

## Consequences

- bundle 未变化的常规启动成本与 official Skill 内容总字节脱钩，只保留有界元数据遍历和数据库配置检查；
- 首次安装、应用升级、明显损坏和权限漂移仍支付完整物化成本，且发生在 Core ready 之前；
- 同大小内容篡改的发现从进程启动边界移动到相关 AgentRun 执行边界，但 Runtime 准入仍 fail closed；
- bootstrap report 与阶段日志成为可回归性能证据，但不是领域状态或完整性 receipt。

## Rejected Alternatives

- **每次启动继续全文物化与哈希：** 完整性充分但把确定性的磁盘写放在所有会话恢复关键路径上。
- **只比较数据库 digest：** 无法发现 Revision 文件丢失、替换或权限漂移。
- **把完整校验永久移到后台：** 可能让损坏 Revision 在后台完成前进入 Runtime，违反执行准入门禁。
- **缓存一次“已验证”布尔值：** 不能证明缓存建立后文件系统没有变化，也缺少精确 Revision 身份。

## References

- [v0.82 版本目标](../versions/v0.82/README.md)
- [Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)
- [ADR-0075: Runtime Integrity at Change and Execution Boundaries](0075-runtime-integrity-at-change-and-execution-boundaries.md)
- [ADR-0161: Event-Driven Root-Scoped Skill Projection Reconciliation](0161-event-driven-root-scoped-skill-projection-reconciliation.md)
