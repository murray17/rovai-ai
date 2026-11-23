---
document_type: contract
contract: runtime-file-change-observation
version: v10
status: accepted
source_version: v1.72
last_updated: 2026-11-23
---

# Runtime File Change Observation v10

沿用 [v9](runtime-file-change-observation-v9.md) 的证据准入、存储、投影、授权与 wire schema。
本版更新 Files Changed Review 的呈现约定，覆盖 v1 的可见操作编号及空状态文案、v7 的 Review 补丁来源标签。

## Review

- 文件列表和工具栏显示路径及增删行数，缺少可靠行数时显示操作次数。列表保留 A/M/D 标记，详情省略差异类型标签和修改编号。
- 代码块按原始 `sequence` 排列，相邻块以细线分隔。完整差异保留来源中的 hunk 和行号，
  精确替换与原生补丁显示增删符号及正文。查找按同一顺序定位代码行。
- 仅记录路径的操作计入操作总数。有可读详情且没有可显示代码块时，阅读区显示文件图标和一个
  “打开当前文件”按钮，并向辅助技术提供空状态名称。按钮沿用 `run_evidence / open_current`。

Command 的补丁展开仍标明原生补丁来源。两处均使用原有 `reported_mutation` 语义与统计规则。
具体交互见[文件预览](../ui/components/file-preview.md#file-change-标签页)。
