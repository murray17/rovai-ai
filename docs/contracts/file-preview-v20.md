---
document_type: contract
contract: file-preview
version: 20
status: accepted
authority: desktop-file-preview-wire
source_version: v1.69
last_updated: 2026-09-24
---

# File Preview v20

继承 [v19](file-preview-v19.md) 的来源、具体文件能力、恢复和预览行为。本版扩展
`run_activity_file` 的精确证据准入，覆盖没有可靠 Diff 的终态 Read/Write 文件操作。

Renderer 对可用的 schema 2 `runtimeFileOperation` 保留终态 Evidence 身份。
Command 文件操作行点击已证明的 `path` 时，继续提交原有封闭请求
`{kind: 'run_activity_file', campId, agentRunId, executionEpoch, evidenceId, rawReference}`；
`evidenceId` 是携带该文件操作的 Evidence ID，不从文件名、Tool 标题或 Camp 目录推断。
canonical Diff 文件行仍可使用 Diff projection 的 `sourceEvidenceIds`。终态 Read/Write 行没有
可用证据身份时拒绝打开，不能回退到 Camp 项目中的同名文件；仅缺少身份的历史 Diff
presentation 保留既有 `camp_workspace` 兼容回退。

Core 对文件操作路径必须同时证明：Evidence 属于请求的 exact Camp、Run 与 execution epoch，
该 Evidence 列在当前 canonical activity 的 `sourceEvidenceIds` 中，Evidence 阶段为
`completed` 且 activity outcome 为 `succeeded`；其持久化
`runtimeFileOperation` 为 schema 2、`status=available`、`operationKind=read|write`，
且规范化 `path` 与 `rawReference` 完全一致。Diff 路径仍须通过 v19 的 available
projection 与精确来源证据校验。失败、未准入、受管临时输出、错误 Run/epoch/Evidence/路径，
以及相对父目录跳转均不得产生文件目标。

准入后，相对路径优先以该 Run 冻结的有效 `executionRoot` 解析；只有旧 Run 缺少有效值时
才回退到 active directory Camp 的绝对 `project_path`。绝对路径保持证据报告的位置。
Main 继续在打开与恢复时校验来源、realpath、普通文件身份和具体文件能力；失败只反馈
`无法打开该文件`，不切换当前预览。

验收覆盖无 Diff 的成功 Read/Write 在 Mission worktree 命中正确文件、Camp 项目同名文件不被
误选、错误身份或路径拒绝，以及有 Diff 的既有入口保持有效。
