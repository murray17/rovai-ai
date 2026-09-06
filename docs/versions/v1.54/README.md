---
document_type: version-overview
version: v1.54
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-06
---

# Rovai-ai v1.54：工具执行展示一致性

前置：[v1.53](../v1.53/README.md)。本版本保留 v1.52 的项目文件恢复、v1.53 的 Runtime 原生生图公屏
准入，以及既有 Tool 内容、Runtime 协议和原始 Evidence；只统一执行台的状态、详情、文件操作与纯读取 Shell
展示。[HTML 交互稿](tool-call-consistency.html)、[实施及验收清单](implementation-plan.md)和
[真实 Runtime 验收](runtime-acceptance.md)随版本保存。

## 已确认范围

1. Tool 子行、底部执行台、Inspector 头像角标、Run 时间线和单聊工具行复用同一套状态图形。组右侧只在执行中、
   等待审批时显示图形；所有终态只显示“完成了 x 个步骤”，不追加失败、停止或未知数量。
2. Shell、Web、Built-in 与普通 Tool 详情复用既有 Shell 背景与左轴，保留当前内容、内边距、字号和换行，不新增
   “指令／结果”标签、分隔线或空白行。静态行不提供整行 hover，取消等待不形成色条。
3. 可靠单文件 read 显示“阅读 文件名”，可靠 write 按证据显示“新增 文件名”或“编辑 文件名”。文件名使用虚线
   底线并可打开当前文件预览；写入 Diff 仍由独立箭头展开。打开失败只显示红色 Toast，不切换预览页。
4. 同一 Shell Activity 中多条确定的纯读取命令仍是一条执行记录。文件按完整路径去重并保留首次顺序，折叠态在
   一行内显示“阅读 文件 A, 文件 B”；同名不同路径显示足以区分的相对路径，每个文件名独立可点击。缺少路径、
   混入其他动作或出现未支持 Shell 语法时保持原 Shell 展示；展开内容仍保留完整命令、输出和整次状态。
5. `runtimeFileOperation schema 2` 继续拥有可靠 typed read/write 与可选 filesystem `changeKind`。Claude Code
   2.1.236 的 matching Write 终态另保留其原生 `type=create|update`：`create` 只在 Renderer 映射为“新增”，
   不改写成文件此前不存在的 Evidence；`originalFile` 内容不进入公开规范化 Evidence。
6. Migration 142 在 v1.53 / schema 92 / `activity-v2` 及 migration 141 完整成立后，原子切换到 Data Contract
   `v1.54` / projection schema 93 / `activity-v3`。历史 Evidence 与既有 Canonical Activity 不回填、不重分类。

本版本不改变命令执行、Runtime 协议、Tool Call/Evidence 数量、权限放行、安全判断、Agent 模型上下文或 Runtime
平台资格。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.53 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.54 |
| Decisions | 确认无需更新 | 展示层映射继续遵守既有 Evidence／Canonical／Renderer 分层和诚实回退原则，没有新增跨版本重要取舍 |
| Contracts | 已更新 | [Run Process Detail Surface v31](../../contracts/run-process-detail-surface-v31.md)冻结单行多文件摘要、状态和文件入口；[Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md)冻结 typed operation、Claude 原生类型与 migration 142 |
| Architecture | 已更新 | [Runtime 文件变化](../../architecture/runtime-file-change-observation.md)与 Evidence/Activity 基础不变量同步来源字段、展示映射和迁移边界 |
| UI | 已更新 | [会话工作区](../../ui/components/conversation-workspace.md)记录统一状态、单行多文件入口、文件名／Diff 双入口和失败 Toast |
| Runtime Activity | 已更新 | [Registry](../../runtime-activity/registry.md)切换 `activity-v3` 的 migration 142，并记录各 Runtime typed read/write 准入与真实验收 |
| Runtime compatibility | 确认无需更新 | [真实 Runtime 验收](runtime-acceptance.md)记录本功能实测，不改变 Adapter 支持级别、模型合同或平台资格 |
| Documentation routing | 已更新 | 文档任务导航、Contracts 索引与当前权威导航指向 v31、v3 和本版本范围 |
| Root README | 确认无需更新 | 项目定位、安装方式和常青 Runtime 支持范围不因执行台展示收敛而变化 |

## References

- [实施与验收清单](implementation-plan.md)
- [真实 Runtime 文件操作验收](runtime-acceptance.md)
- [HTML 交互稿](tool-call-consistency.html)
- [Run Process Detail Surface v31](../../contracts/run-process-detail-surface-v31.md)
- [Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md)
- [File Preview v8](../../contracts/file-preview-v8.md)
