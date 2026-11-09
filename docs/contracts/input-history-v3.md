---
document_type: protocol-contract
contract: input-history-v3
status: accepted
version: 3
source_version: v1.72
last_updated: 2026-11-08
---

# Input History v3

继承 [v2](input-history-v2.md)。

恢复 project_file_reference 时保留 targetKind；缺省 file，directory 作为文件夹 Atom 恢复，位置和完整来源保留。
可用性重新校验但不改身份、不添加 undo 项。参考 [项目引用 v2](project-file-reference-v2.md)，其余历史顺序与去重不变。
