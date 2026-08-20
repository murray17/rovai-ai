---
document_type: renderer-contract
contract: run-process-detail-surface-v17
authority: agent-process-detail-codex-command-preview
status: accepted
last_updated: 2026-08-20
---

# Run Process Detail Surface v17（Codex 真实命令预览）

本合同完整继承 [Run Process Detail Surface v16](run-process-detail-surface-v16.md) 的 Inspector Tab 顺序，
以及 v15 以前的执行台位置、进入恢复、Tool chronology、完整结果、停止、阅读位置和焦点语义。v17 只替代
Codex Shell Tool 行的标题与命令详情投影。

## 1. 标题来源

Codex `commandExecution` 的 `commandActions` 非空且每项都为 `read | listFiles | search` 时，继续使用 Core
结构化生成的“读取 / 列出 / 搜索 / 检索项目文件”中文 presentation hint。除此之外，只要同一公开 Evidence
包含非空 `item.command`，Tool 行必须显示该命令的完整脱敏预览，不得按 Node、Git、Cargo、pnpm 等命令家族
翻译或缩减，也不得用泛化 Runtime title 覆盖。

预览剥离外层 `bash/dash/fish/ksh/sh/zsh -c|-lc` 与对应绝对路径包装，递归最多处理有界层数；内部命令保持
原始顺序并把换行/连续空白规范化为单个空格。`&&`、`||`、`|`、`;`、`&` 以及全部子命令必须保留。
Node `-e` 和 heredoc/stdin 脚本必须包含代码开头，不能退化为单独的 `node`。

## 2. 视觉省略与详情

Tool 标题轨继续使用 `minmax(0, 1fr)`、单行 `white-space: nowrap` 与 `text-overflow: ellipsis`。Renderer 不得
按固定字符数修改标题值；底部和 Inspector 根据各自真实可用宽度视觉省略，完整脱敏标题仍作为元素 `title`
和辅助技术可读名称。

Codex command Tool 行只要存在命令即可展开。详情按以下顺序组成：

1. `命令`：剥离 wrapper、脱敏后的完整命令，不做视觉标题省略；
2. `输出`：同一 activity 的完整公开 `aggregatedOutput/output`，存在时显示。

命令与输出不得互相替代。Managed Blob 的按需读取、完整结果内部滚动、键盘、焦点、loading/retry 与
Envelope 排除继续使用 v13 边界。

## 3. 脱敏边界

标题与“命令”详情必须使用同一确定性脱敏函数。至少覆盖：

- 名称含 `token`、`password/passwd`、`authorization`、`api key`、`secret`、`credential` 的环境赋值和 flag 值；
- `Authorization:` header 的值；
- `rovai send --body <value>`、`--body=<value>` 与 positional body。

脱敏只替换值，保留 flag/变量名、命令与 Shell 运算符，使复合命令仍可审阅。Runtime 已公开 output 继续按
既有 Evidence 合同展示；本合同不扩大或重新定义 output 的公开边界。

## 4. Runtime 边界

OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code 与 TRAE 继续显示 ACP Runtime title/toolName；Claude
Code Bash 继续使用其公开 input 的既有有界标题；Antigravity 继续显示 `run_command` 等结构化工具名。没有公共
command 正文的 Runtime 不得从 rawInput digest、私有 terminal/log 或输出反推命令。

命令预览是 Renderer presentation，不改变 Canonical Activity 分类、semantic kind、operation identity、
lifecycle、credibility、coverage 或 source authority。

## 5. 验收

- `git status` 原样显示；`git status && git checkout branch && git rebase main` 的三条命令和运算符都保留；
- `/bin/zsh -lc '<command>'` 只显示内部 command，嵌套 wrapper 有界脱壳；
- `node -e '<script>'` 与 Node heredoc 显示代码开头，长脚本在窄轨视觉省略但展开后完整；
- 结构化 Codex read/list/search 继续显示中文语义标题；
- token/password/Authorization/API key 与 `rovai send` 正文不进入标题或命令详情；
- 展开后命令和输出均存在且顺序稳定，无输出命令仍可展开；
- 其他九 Runtime 的受控标题矩阵保持不变；
- Day/Night、底部/Inspector、200% zoom 和 Forced Colors 下四轨无页面级横向溢出。

## References

- [Run Process Detail Surface v16（历史）](run-process-detail-surface-v16.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [Runtime Activity Mapping Registry](../runtime-activity/registry.md)
- [V1.18-D01](../versions/v1.18/decisions.md#v1-18-d01)
