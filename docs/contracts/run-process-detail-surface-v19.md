---
document_type: renderer-contract
contract: run-process-detail-surface-v19
authority: agent-process-public-shell-command
status: accepted
source_version: v1.20
last_updated: 2026-08-21
---

# Run Process Detail Surface v19（跨 Runtime Shell 命令）

本合同完整继承 [Run Process Detail Surface v18](run-process-detail-surface-v18.md) 的 Inspector、执行台位置、
完整 Tool chronology、结果读取、停止、Runtime retry 与终态语义。v19 把 v17 的完整命令体验扩展到所有拥有
公开 Shell command 的 Runtime Activity。

## 1. 标题

Canonical Activity 为 `shell` 且同一公开 payload 存在 command 时，Claude Code、TRAE 和其他 ACP Adapter
与 Codex 共用完整脱敏命令预览：去除有界外层 Shell wrapper，保留参数、子命令、Shell 运算符、Node inline
和 heredoc 代码开头。Codex `commandActions` 全为 read/list/search 时仍优先使用结构化中文语义 hint。

标题值不按固定字符数裁剪；底部与 Inspector 在真实宽度内使用单行视觉省略，并通过 `title` 和辅助技术名称
保留完整脱敏值。没有公开 command 的 Runtime 继续使用 `toolName / presentationHint / domain fallback`，不得从
digest、output、私有 terminal 或 Runtime 名称反推命令。

## 2. 展开详情

拥有公开 Shell command 的 Tool 行始终可展开，详情稳定分为：

1. `命令`：与标题使用同一 wrapper 处理和确定性脱敏函数；
2. `输出`：存在时显示同一 terminal Evidence 的完整公开 output。

命令与输出互不替代。Claude Code 与 ACP terminal Evidence 必须自带 command，历史页和 Managed Blob 全文读取
不得依赖 Renderer 按 operation ID 回看 started Evidence；live reducer 对稀疏旧 Evidence 的合并只作为兼容。

## 3. 安全与状态

v17 的 token、password、Authorization、API key、secret、credential 与 `rovai send` 正文脱敏规则应用于所有
公开 Shell command。Renderer 不展示 rawInput 的其他字段或 digest。ACP 非零 exit code 显示失败状态与公开
stdout/stderr；它不会把父 AgentRun 自行改写为失败，Run 终态仍由既有权威流程决定。

## 4. 验收

- Claude 与 TRAE 的八条展示命令均以完整脱敏命令作为标题，复合命令、Node inline 和 heredoc 不退化；
- 展开后分别显示“命令”和存在时的“输出”，`true` 与空输出命令仍可展开；
- 假测试 API key 在 DOM 中按规则隐藏，其他 rawInput 字段不可见；
- TRAE exit 7 显示失败并保留 stdout/stderr，后续命令仍正常出现；
- 没有 command 的其他 Runtime 标题矩阵保持不变；
- Day/Night、底部/Inspector、200% zoom 与 Forced Colors 下无页面级横向溢出。

## References

- [Run Process Detail Surface v18](run-process-detail-surface-v18.md)
- [Runtime Launch and Verification v16](runtime-launch-and-verification-v16.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
