---
document_type: adr-template
authority: adr-authoring
last_updated: 2026-07-22
---

# ADR Template

复制下面的模板创建新 ADR。文件名使用 `NNNN-short-kebab-title.md`，编号全局递增且一经分配不再复用。

```markdown
---
document_type: adr
id: ADR-NNNN
title: Concise decision title
status: proposed
date: YYYY-MM-DD
decision_scope: cross-version
source_version: v0.XX
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-NNNN: Concise decision title

## Context

描述必须解决的问题、约束和为什么需要形成跨版本决策。不要写实施进度。

## Decision

使用明确、可验证的规范语言记录最终选择及其边界。

## Consequences

记录正面效果、成本、限制和后续实现必须承担的责任。

## Rejected Alternatives

列出认真考虑过但被否决的方案及主要原因。

## References

- [来源版本](../versions/v0.XX/README.md)
- 相关 ADR、代码、Migration 或测试
```

## 作者检查清单

- 决策是否具有跨版本影响或高逆转成本？
- 是否只解决一个关键问题？
- 是否能在不读取历史讨论的情况下理解最终约束？
- 是否明确记录后果和被拒绝方案？
- 是否没有混入任务列表、完成百分比、测试流水账或动态实施状态？
- 如果计划完整替代旧决策，proposed 阶段是否只填写 `intended_supersedes`，并确保旧 ADR 继续有效？
- 接受完整替代时，是否在同一最终快照把候选关系移入 `supersedes`、更新旧 ADR 的 status 与
  `superseded_by`，并同步 CURRENT/HISTORY？
- 如果只是局部覆盖，是否保持完整替代元数据为空，并把当前组合写入 Architecture/Contract？
- 是否已为 CURRENT 人工选择且只选择一个 primary 主题？主题选择不得由 Skill 名称、关键词或脚本猜测。
- 是否运行 `pnpm docs:test`、`pnpm docs:check` 和带真实 base SHA 的 `pnpm docs:check:ci`？
