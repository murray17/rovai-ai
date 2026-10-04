---
document_type: contract
contract: windows-skill-projection-v2
status: accepted
source_version: v1.70
last_updated: 2026-09-25
---

# Windows Skill Projection v2

本版继承 [v1](windows-skill-projection-v1.md) 的 copy backend、journal、恢复、Execution Root Gate 和普通 reconcile 所有权规则。仅用户显式执行的旧入口清理增加无 observation 的固定名称路径，具体集合与诊断合同见 [Skills Rebuild v2](skills-rebuild-v2.md)。

无记录候选只来自已登记且 `active` 的项目根与 `SkillDeliveryGroupKey::ALL` 的精确项目 Skills 路径。根及 Skills 父目录须为当前可访问的规范路径；入口必须存在。删除前重新验证 root access、active Run、路径、普通目录及整棵目录的 no-reparse 条件，并沿保留的目录 handle 删除。已有 observation 的路径由 v1 路径处理，不重复计数或删除；无记录候选成功后没有 observation 写入或清除。

诊断只读检查这些精确路径；Core 启动、升级、普通投影 reconcile 和 macOS 均不触发该名称规则。其他名称及未登记根不进入无记录候选。
