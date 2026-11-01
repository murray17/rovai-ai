---
document_type: protocol-contract
contract: run-process-detail-surface-v58
authority: conversation-run-presence-surface
status: accepted
version: 58
source_version: v1.72
last_updated: 2026-11-01
---

# Run Process Detail Surface v58

继承 [v57](run-process-detail-surface-v57.md)，收敛原生子代理执行记录。

## 一条执行主线

主代理公开正文、主代理工具和已由原生协议转发的子代理工具进入同一个 AgentRun 平铺列表。独立子代理正文、
文字进度和无法确认归属的并发文本在正文聚合之前过滤。工具实际返回的文本、结构化回执和报告保留在该调用中。
不新增代理树、子代理卡片、独立详情、来源跳转、模式标签或重复的生命周期说明。

所有调用复用普通 command 的 summary、状态、展开详情、单个文本区域、滚动和通用重试。
不另设“输入／输出”分区或嵌套任务输入折叠；公开任务入参与真实返回连续呈现。任务参数不作为 Shell command，
不添加 `$` 前缀。真实工具名保留。Core 准入的 `tool.agent` 使用机器人图标，只有图标表达类型差异。
入参／返回中真实存在的模式、任务 ID 和类型仍保留；不复制为额外标签。

## 身份、更新和排序

一条真实工具调用只占一个稳定位置。Adapter 在已路由的 Native Session/Prompt 内保存工具来源与调用身份，
Core 再以 AgentRun/epoch 隔离 operation。完整来源分别报告的同名／同 ID 调用不合并；稀疏更新仅在同一作用域
内该原生 ID 有唯一已知归属时补齐身份。归属冲突时拒绝配对，不用名称、标题、文本、时间或到达间隔猜测。
ZCode 继续使用其原生 bridge 已封闭的调用身份，保持既有 late-background fencing。

工具行状态只属于本次调用。同步启动可直接返回报告；异步启动成功只表示启动调用成功。后续 `read_agent`、
`TaskOutput`、`task_output` 等是各自独立的真实调用。独立完成通知不新增工具行，也不覆盖启动回执。
Codex `subAgentActivity(kind=started)` 的 started/completed 是同一次启动调用；`kind=completed` 是独立通知。
原生没有公开任务参数时不补造 prompt 或函数名，保留实际 item 类型与公开回执。
Qwen 的 `_meta.source=background_task_completed/background_notification` 且 backgroundTask.kind=agent 只表示独立通知，
不进入主代理正文；TRAE 的结构化 subagent_completion 通知同样排除。

稳定展示位置以 Core 首次记录的 `sequence` 为准；`revision/changeSequence` 仅用于原位更新。
Live event 同时携带 `sequence/occurredAt`，历史读取沿用同一顺序。相邻主／子工具使用同一个既有工具组及步骤计数，
每次调用计一次，更新不增加计数。正文、用户插话等既有非工具项继续分组。

展开状态以稳定 operation identity 保留。结果缓存同时验证 Evidence ID 和 revision/changeSequence；晚到读取不能覆盖
较新结果。刷新不卸载已展示的文本区域，保留焦点和滚动。读取失败保留通用重试，不改变工具执行状态。
加载、空结果与永久截断继续沿用既有合同。

## 分类切换与兼容

Migration 219 原子写入 schema 169／`activity-v5` marker 与 receipt，不改写旧 Evidence 或 Canonical Activity。
新 operation 才使用 v5 的 `tool.agent` 语义；既有 v1–v4 operation 按原分类器结算。
Read Side 依次选择 v5、v4、v3、v2、v1；兼容读取不表示历史回填。旧版本应用不能直接打开 schema 169。

Adapter 只在已验证的原生工具字段或封闭协议映射下声明类型；未知工具保持原域。
不修改模型上下文、后台模式限制、调度、自动续跑、结果获取策略，也不主动补采未转发的子代理工具。

当前匿名输出边界：Copilot/Qoder 在可观测委派未结束时无法单凭 ACP chunk 判断作者，过滤这段并发正文；
后台启动后无法证明子任务结束时持续保守处理。TRAE 的根 `messageId` 与转发的匿名 child chunk 分别处理。
这可能减少可显示的主代理过程文字，但不会把不明作者文本写成主代理正文；真实工具输出仍完整遵循既有预算。
