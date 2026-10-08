---
document_type: protocol-contract
contract: run-process-detail-surface-v44
authority: ephemeral-root-thinking-feedback
status: accepted
version: 44
source_version: v1.72
last_updated: 2026-10-07
---

# Run Process Detail Surface v44

继承 [v43](run-process-detail-surface-v43.md) 的 Evidence 生命周期、主线与 Tool 组分页。本版扩展瞬时
思考反馈的位置，并允许 Codex/Copilot 原生短标题替换通用“思考中”。不新增表或迁移，不改变模型输入。

## 阶段与公开短标题

`agent_run.runtime_phase_changed` 保留 `agentRunId/executionEpoch/phase`，增加可空 `thinkingTitle`。
`agentRunExecution.page/changes` 的 schema 2/3 增加可空 `runtimeThinkingTitle`，与既有 `runtimePhase`
组成同一当前快照。仅当前 execution epoch、`running` 且未请求取消的 Run 可投影该状态。

只有以下来源可提供标题：Codex `item/reasoning/summaryTextDelta` 中位于摘要开头的显式 Markdown
标题（闭合粗体或一至三级标题行），以及 Copilot ACP 订阅透传的根 `assistant.intent.data.intent`。
不截取任意思考正文首句，不生成或翻译标题，不把 Session title、计划、工具名或子智能体活动当成标题。
Claude、Pi 及其他 Runtime 没有标题准入；有根思考信号时显示通用提示。

标题必须非空、单行、至多 80 个 Unicode 字符，不允许控制字符和 Unicode 行分隔符；无效或未完成的
标题使用“思考中”。Codex 解析器只在内存保留最多 384 bytes 的未闭合标题前缀；发现普通正文、超限、
换行或标题闭合立即清空前缀并停止读取该摘要段的后续内容。

这是一项针对已准入短标题的公开例外，覆盖 v41 的完全无文本 phase 限制。完整 private thought/reasoning
仍在持久化、日志、临时文件与 Renderer 缓存之前丢弃。标题只属于有界瞬时状态，不进入 Evidence、SQLite、
搜索、历史正文或模型上下文。结束、公开正文、计划或新的根工具开始会清除标题；新 epoch 不继承旧标题。

## 根来源与生命周期

Native Session、prompt 与执行代次继续由各 Runtime 的既有 transport admission 验证。显式 child、replay、
snapshot 不能更改根阶段或标题。Claude/Pi 原生空 thinking block 的开始和结束也产生无正文阶段信号；
signature-only 块不再依赖非空文本增量。晚到的旧 thinking item 结束不能结束更新的 item。

后台 Tool 的结果、文件更新、Fast 观察或压缩 imminent/completed 不能清除更新的根思考状态。新的根工具
开始、公开正文/计划和实际压缩开始是阶段边界。阶段准入与状态更新受同一数据库状态检查约束；终态清理
已有内存状态。分页读取以同一读取时刻的 Run 状态与 epoch 验证阶段，不把阶段作为 Evidence change cursor。

## 呈现

只在最新阅读窗口、Run 仍运行且无最终正文时显示瞬时思考反馈。公开正文→thinking、公开计划→thinking、
Tool→正文→thinking 都应覆盖。活动 Tool 与已验证的根 thinking 可以同时显示，不能把活动工具伪装成完成。
真正活动的压缩优先；imminent 不压制思考。等待、取消、恢复与终态按已有状态反馈优先，不残留旧标题。

折叠 Run、Mobile 和 Single Chat 使用相同标题回退规则。重新打开或连接失效后可通过有界的当前 Run 读取恢复
瞬时状态；旧请求响应、旧 epoch 事件不能覆盖较新的状态。标题按普通文本渲染，复用既有单行省略与完整 title
属性，不渲染 Markdown，不新增历史思考行。

## 验证

Parser owner 覆盖分片标题、Unicode/长度/控制字符、正文不保留、child/replay 和旧 item 结束；现有 Runtime
owner 覆盖空块生命周期。Renderer owner 覆盖正文/计划之后的思考、活动工具共存、标题回退、旧 epoch、
只改变标题的分页刷新与终态清除。真实 LLM Smoke 与确定性测试分别报告；未观察到原生标题不能声称已获标题。
