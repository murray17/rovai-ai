---
document_type: contract
contract: file-preview
version: 19
status: accepted
authority: desktop-file-preview-wire
source_version: v1.67
last_updated: 2026-09-23
---

# File Preview v19

继承 [v18](file-preview-v18.md) 的来源、预览能力、恢复、Viewer 与 File Change 刷新语义。本版只调整
Run 文件证据的当前文件预览路径；历史 Diff/Review 内容和阅读操作入口不变。

`run_activity_file` 仍须证明请求的 exact Camp、AgentRun、execution epoch、Evidence ID 和 available canonical
diff projection，并要求 `rawReference` 精确等于该 projection 的一个文件路径。`run_evidence / open_current`
仍须证明 exact Run、epoch、`evidenceFileId` 及摘要与详情的同一路径。两种来源均可返回规范化绝对路径或
不含父目录跳转的相对路径；不再因证据路径位于 Run `executionRoot` 外而拒绝绝对路径。

相对路径继续以该 Run 冻结的有效 `executionRoot` 为基准；仅在旧 Run 缺失有效值时回退到 active directory
Camp 的绝对 `project_path`。绝对路径按证据给出的原位置解析，不拼接 Run 或 Camp 根目录，也不转向其中的
同名文件。Desktop Main 继续执行引用解析、realpath、普通文件、当前文件身份与来源重验；成功只授予这个具体
文件的临时能力，不授予根外目录或任意路径访问。目录仍不可由这两个来源打开。

验收须覆盖根外绝对路径命中正确的文件、相对路径命中 Run 工作树中的同名文件、错误 Run/epoch/Evidence/
文件路径拒绝、相对父目录跳转拒绝，以及根外文件打开后不产生 Root Grant。
