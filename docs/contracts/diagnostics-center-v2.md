---
document_type: interface-contract
contract: diagnostics-center
version: 2
authority: diagnostics-read-repair-and-export
status: accepted
last_updated: 2026-09-25
---

# Diagnostics Center v2

本版继承 [v1](diagnostics-center-v1.md) 的 typed report、三态分类、只读性质、单项复检、Recovery 和 `rovai-diagnostics-v5` 导出。当前旧 Skill 入口问题与修复动作按 [Skills Rebuild v2](skills-rebuild-v2.md) 执行。

`diagnostics.check` 的 `legacy-skill-entries` 是 v1 不访问历史项目根规则的唯一例外：Windows 可以只读检查已登记 `active` 根下已知 Skill 组与固定九名称的精确路径，以发现 observation 已消失的旧副本。它不递归枚举项目、不启动 Runtime、不执行 reconcile、不修改文件或数据库。`entryCount` 是 observation 精确路径与无记录固定名称路径去重后的数量；大于零为 `attention`，零为 `ok`。

该问题的唯一修复动作是用户显式调用 `skills.cleanupLegacyEntries`，完成后再运行 `diagnostics.check`。无法确认所有权、不可访问或运行中的入口继续按现有报告字段保留。其他诊断检查及平台行为继承 v1。
