---
document_type: contract
contract: runtime-file-change-observation
version: v7
status: accepted
source_version: v1.72
last_updated: 2026-10-05
---

# Runtime File Change Observation v7

继承 [v6](runtime-file-change-observation-v6.md) 的来源水位、失效重算、路径、managed output 排除、
授权与持久化边界。本版新增有来源区别的 `reported_mutation`，用于原生工具确认成功、但可能模糊匹配的
修改片段；不把它升级成 exact mutation、完整文件状态或净差异。

## 来源与成功条件

当前 Product 准入仅包含 `cline-cli + acp-v1` 的
`session/update.tool_call_update.completed.apply_patch` 和
`session/update.tool_call_update.completed.editor`。ACP profile 必须按同一 ToolCall ID 配对原生输入、
要求 terminal `completed` 且 `rawOutput.success=true`。失败、取消、未知成功值、缺失输入和未知语法均不生成片段。
Profile 丢弃 wire 自带的同名私有 metadata，只生成自己验证的候选；公共 normalizer 再核对 frozen Adapter。

- `apply_patch` 只接受有界规范 Begin/End Patch、唯一 Update File 路径和 hunk 中的原生增删行。保留多文件、
  多 hunk 的顺序；上下文行不进入片段。Add/Delete/Move、重复路径和无法完整理解的语法保持原有回退。
- `editor` 只接受非空 `old_text` 与字符串 `new_text` 的替换；创建与 `insert_line` 保持 path-only。
- 上游模糊匹配、标点规范化或换行处理可能让实际旧字节不同。成功只证明执行了该工具报告的修改，
  不证明片段是完整或逐字精确的文件状态。
- Command Code 的 `tool_completed.edit_file` 可在内部 normalizer 生成同语义候选；其 Product Adapter 尚未准入，
  不能绕过 closed identity 或把内部 Probe 写成 App 证据。

本条是对早期合同“不得从 apply_patch input 反推实际 Diff”的窄化补充：仍禁止反推精确状态，
允许公开已确认成功的、明确标注来源的补丁片段。工具名、普通 stdout、未成功的输入本身不构成准入证据。
不读取当前文件、不捕获执行前后磁盘、不扫描 Git。

## Evidence 与投影

Candidate `semanticKind=reported_mutation`，每条 Evidence 只保留：

```json
{"semantics":"reported_mutation","path":"src/a.ts","fragments":[{"oldText":"old\n","newText":"new\n"}]}
```

每次最多 256 个规范化且唯一的路径，每文件最多 1024 个非空修改片段，单文件来源及展示内容上限 2 MiB、
整次 Diff 上限 8 MiB。路径、私有 managed output 排除和公开字段白名单继承既有合同；相邻原生字段不得跟入 Evidence。
旧新相同的片段不产生差异，未知或超限不截断伪装完整。

Command Diff 仍沿 schema 1 投影；AgentRun Files Changed 仍沿现有 schema 3 与敏感 Managed Blob 保存，
不增加数据库迁移。所有块均为此语义时 `presentationKind=reported_mutations`；混合语义保持 operation history。
片段只按原序累计，不拼接完整状态、不以“改回原文”抵消此前操作。统计来自片段本身，不宣称 Git 净增删。
迟到事实、revision、stale、原子发布和重开读取沿 v6，历史 Evidence 不回填。

## Renderer 与验证

Command 文件行可展开 `+ / −` 内容，文件名继续独立打开当前文件。Review 保留逐次操作。
两处显示“补丁片段”，提示统计来自原生补丁且匹配可能调整；无 hunk 坐标或虚构文件行号。
搜索只索引片段正文，保留与展示一致的顺序与坐标。Renderer 按语义分支，不按 Runtime 名分支。

验证拥有者分别覆盖 profile 的成功配对与失败回退、共享准入与字段剔除、Evidence 重建、按序归约和 UI 语义。
真实 App 验收必须读取持久化 Command/Files Changed，并点击展开核对；只有 native wire 或 fixture 不能证明产品闭环。
