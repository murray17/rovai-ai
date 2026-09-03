---
document_type: protocol-contract
contract: run-process-detail-surface-v30
authority: active-tool-group-current-instruction-presentation
status: accepted
version: 30
source_version: v1.39
last_updated: 2026-09-03
---

# Run Process Detail Surface v30

完整继承 [v29](run-process-detail-surface-v29.md) 的布局、Evidence、Tool 行标题、连续分组、详情交互、
取消终态与 Runtime Compaction 展示。本版只让活动 Tool 组摘要展示当前可证明的具体公开指令；不改变
Canonical Activity 分类、operation identity、lifecycle、稳定 Tool 行标题或渠道卡片文案。

## 当前指令

活动组继续使用“执行中/等待审批 · <当前指令>”，live-tail 继续使用“执行中 · <最近一条指令>”。
`publicCommand` 始终优先；否则 Renderer 按以下顺序选择：

- Shell：完整脱敏的公开 command；没有 command 时依次使用非通用 Runtime title、非通用 toolName；
- File：可靠 typed `runtimeFileOperation` path 或单文件 available Canonical Diff 显示
  `修改 <basename>`，多文件 available Canonical Diff 显示 `修改 N 个文件`；否则依次使用非通用
  Runtime title、非通用 toolName；
- `tool.web.search`：available typed `runtimeSearchOperation` 显示 `搜索 <query>`；多项 query 按既有
  中文逗号规则连接；否则依次使用非通用 Runtime title、非通用 toolName；
- 其他 Tool、Runtime 与 Unknown：依次使用非通用 Runtime title、非通用 toolName。

通用占位包括 Shell/Terminal/command executor、Edit/Read/Write/apply patch、Web Search/Search、
Tool Call/Runtime Activity 及其既有中文 fallback。没有更具体值时必须诚实回退到 v24 冻结的 Tool 行标题，
不能制造空摘要。相同 operation 的 terminal 更新若省略当前指令，Renderer 保留 started/progress 阶段已经
投影的当前指令；后续明确值仍可原位覆盖。

## 证据与表面边界

文件 path/count 和 Web query 只来自既有 typed/Canonical 公开 Evidence。Renderer 不得从 raw input/output、
detail、显示标题或当前文件猜测这些事实。Runtime 明确提供的公开 title 只能原样作为 presentation 使用，
不能反向证明 File/Web 分类或生成新的持久 Evidence。

Desktop 底部执行台与 Inspector 继续移动同一个 Drawer DOM，并使用同一活动组摘要；局域网只读执行台复用
同一共享分组 presentation。展开后的稳定 Tool 行仍使用 v24 标题，飞书/钉钉卡片继续使用既有 public title，
不读取本版 `currentInstruction`。本版不新增 IPC、Schema、Migration、Activity Registry 条目、渠道投递或
视觉结构。

## 验收

- File 的稳定 Tool 行为“文件操作”或 Runtime toolName 时，活动摘要可显示“执行中 · 修改 settings.ts”；
- 多文件 available Diff 显示“修改 N 个文件”，单文件 reliable path 只显示 basename；
- available typed Web query 显示“执行中 · 搜索 <query>”，缺少 typed projection 时不从 payload 猜 query；
- Shell 使用完整脱敏公开 command；只有 `exec_command`/`Shell` 等占位时回退稳定 Tool 行标题；
- sparse terminal update 保留同 operation 已知的具体指令；新 Tool 到达后活动组原位替换；
- Tool 行标题、详情、计数、状态、飞书/钉钉文案与 Runtime Compaction 行均不改变；
- 底部、Inspector、局域网只读执行台和辅助名称表达同一个当前指令。

## References

- [Run Process Detail Surface v29](run-process-detail-surface-v29.md)
- [Run Process Detail Surface v24](run-process-detail-surface-v24.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
