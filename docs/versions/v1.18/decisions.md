---
document_type: version-decisions
version: v1.18
lifecycle: historical
last_updated: 2026-08-20
---

# v1.18 决策记录

本文件只解释 v1.18 的重要取舍；当前展示规范由 Run Process Detail Surface、UI 与 Runtime Activity
Registry 直接拥有。

<a id="v1-18-d01"></a>

## V1.18-D01：Codex Shell 标题展示完整脱敏命令，不再展示命令家族摘要

### 背景

Codex app-server 已公开完整 `commandExecution.command`，但现有 Renderer 只提炼可执行文件和少量子命令。
这会把 `node -e <script>` 显示成 `node`，也会把 `git status && git checkout && git rebase` 压缩成首个
命令，使执行台无法回答“Agent 实际执行了什么”。直接显示原始 wire 字符串又会保留 `/bin/zsh -lc`
包装、换行噪声，并可能把 token、密码、Authorization header 或消息正文推到始终可见的 Tool 行。

### 决定

只有 Codex `commandExecution` 使用完整命令预览。Renderer 先剥离可证明只是启动包装的 Shell `-c/-lc`
层，再把同一命令的空白规范化为单行；所有子命令、参数和 Shell 运算符保持原顺序。Node `-e` 与
heredoc/stdin 代码保留代码开头。Tool 标题不做固定字符截断，由现有单行轨按可用宽度视觉省略。

结构化 `commandActions` 全部属于 `read/listFiles/search` 时，Core 的中文语义 hint 继续优先。其余 Codex
Shell 标题不按 Git、Node、Cargo 等家族翻译，也不优先采用 Runtime 的泛化标题。标题和新增的“命令”详情
共享确定性脱敏：敏感 flag/assignment/header 值与 `rovai send` 正文替换为稳定占位；展开详情另以“输出”
分区保留 Runtime 已经公开的 output。命令文本仍只是 presentation，不参与分类、identity 或 effect 推断。

### 后果

- Tool 行可直接审阅单条、复合和内联脚本命令，宽度不足时仍保持四轨布局；
- 展开后命令与输出不再互相覆盖，失败和无输出命令也可核对；
- 相比旧家族摘要，更多公开参数会进入标题，因此脱敏规则成为 Renderer 合同和回归门禁；
- 其他 Runtime 若未来需要相同行为，必须先把安全公共 command 字段加入各自 Adapter/Evidence 合同，不能从
  digest、私有日志或 title 反推。

### 被拒绝方案

- 继续只显示命令家族：无法区分复合命令和 Node inline script，执行台缺少审阅价值；
- 固定字符数切字符串：会破坏 Unicode、引号和运算符，且不能适配底部与 Inspector 的不同宽度；
- 显示原始 app-server command：Shell wrapper 噪声占据首屏，并扩大敏感值暴露；
- 把命令解析结果写入 Canonical Activity：presentation 文本不能成为分类或 identity 证据；
- 同时统一 ACP/Antigravity：当前公共 Evidence 没有等价 command 正文，Renderer 无权补造。

### 当前权威影响

- [Run Process Detail Surface v17](../../contracts/run-process-detail-surface-v17.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
- [Runtime Activity Mapping Registry](../../runtime-activity/registry.md)
