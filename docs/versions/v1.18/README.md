---
document_type: version-overview
version: v1.18
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: implemented
model_context_change: false
last_updated: 2026-08-20
---

# Rovai-ai v1.18：Codex 执行台真实命令预览

> 当前状态：Renderer 实施与仓库回归已完成；主线合入、macOS 打包和日常安装交接待完成。
>
> 前置版本：[v1.17 统一附件发布与 Agent 文件发送](../v1.17/README.md)。v1.17 已按完成事实冻结为
> historical；其统一附件 publication、Delivery gate 与 Runtime View 语义继续作为本版基线。

## 版本目标

让 Codex 的 Shell Tool 行忠实显示经脱壳、脱敏后的真实命令，而不是只显示 `node`、`git status` 等命令家族
摘要。单条和复合命令保留全部可审阅子命令、参数与 `&&`、`||`、`|`、`;`、`&`；超出可用宽度时仅在
单行视觉上省略。用户展开 Tool 行后分别查看同一条完整命令与公开输出。

## 交付范围

- Codex `commandExecution` 仅在结构化 `commandActions` 完整证明 `read/listFiles/search` 时继续使用
  “读取 / 列出 / 搜索 / 检索项目文件”等中文语义标题；
- 其他 Codex Shell 活动去掉外层 `/bin/zsh -lc`、`/bin/bash -c` 等解释器包装，保留内部完整命令序列；
- Node `-e` 与 heredoc/stdin 内联脚本的标题包含代码开头，不再退化为单独的 `node`；
- 标题轨保持单行 CSS ellipsis，DOM 与辅助技术持有完整的脱敏标题，不按固定字符数破坏 Unicode 或 Shell 结构；
- 展开详情以“命令 / 输出”分区展示完整脱敏命令和 Runtime 已公开输出；没有输出时仍可展开查看命令；
- 已知 token、password、Authorization、API key 与 `rovai send` 正文在标题和命令详情中替换为脱敏占位；
- OpenCode、Copilot、Kiro、Qoder、CodeBuddy、Qwen Code、TRAE、Claude Code 与 Antigravity 的现有标题和
  Evidence 公开边界不在本版改变。

## 数据与 Context 兼容性

本版不增加数据库 Migration，继续使用 Data Contract `v1.17 / projection schema 57 / Migration 102`。
Codex app-server 的公开 `item.command`、`commandActions`、Canonical Activity、operation identity、lifecycle、
Evidence/Managed Blob 与 Read Side shape 均不改变；只调整 Renderer 对既有公开字段的标题与详情投影。

Formatter 21、ContextManifest 21、Run Facts v2、Profile v4、Session Charter 和 Runtime Host compatibility
不变。本版不把命令文本提升为分类、identity、effect 或模型输入事实。

## 明确不做

- 不根据命令文本改变 `activityDomain`、`semanticKind`、operationId 或 lifecycle；
- 不把 ACP `rawInput`、Antigravity 私有日志或其他未公开 Runtime 字段带入 Renderer；
- 不把 Shell 命令家族翻译成新的中文业务语义；
- 不把视觉省略后的字符串写回 Evidence，也不截断展开后的命令；
- 不承诺识别任意脚本语言中的所有秘密，只对合同列出的敏感参数与常见赋值/header 形态做确定性脱敏。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.17 按完成事实冻结；本概览、实施计划与索引建立唯一 current v1.18。 |
| Decisions | 已更新 | [V1.18-D01](decisions.md#v1-18-d01)记录真实命令可审阅性与敏感参数最小暴露之间的边界。 |
| Contracts | 已更新 | [Run Process Detail Surface v17](../../contracts/run-process-detail-surface-v17.md)冻结 Codex 标题、视觉省略、脱敏与展开详情。 |
| Architecture | 确认无需更新 | Evidence 所有权、Canonical Activity、Renderer 职责和进程/传输结构均不改变。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)改为 Codex 真实命令预览与完整命令/输出详情。 |
| Runtime Activity | 已更新 | Registry 更新 Codex Renderer 展示边界；classifier、映射字段和 Runtime coverage 不变。 |
| Runtime compatibility | 确认无需更新 | 不改变 Adapter 协议、探测、版本或真实 Runtime 能力结论。 |
| Documentation routing | 已更新 | 文档导航、合同索引、当前决定导航与 UI 验收入口切换到 Surface v17。 |
| Root README | 确认无需更新 | 这是既有执行台的局部可审阅性改进，不改变项目定位、平台范围或安装入口。 |

## References

- [v1.18 实施与验收计划](implementation-plan.md)
- [v1.18 决策记录](decisions.md)
- [Run Process Detail Surface v17](../../contracts/run-process-detail-surface-v17.md)
- [Runtime Activity Mapping Registry](../../runtime-activity/registry.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
