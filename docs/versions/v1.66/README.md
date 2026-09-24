---
document_type: version-overview
version: v1.66
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: false
last_updated: 2026-09-22
---

# Rovai-ai v1.66：持久化 Tool 输出上限与诚实丢失提示

前置：[v1.65](../v1.65/README.md)。本版把新 Tool 结果的 Rovai 持久化/展示副本限制为 7,680 UTF-8 字节，
同时保留 Runtime 实际交给 Agent 的完整结果和独立结构化文件事实。目标不是增加预览层，而是在唯一持久化投影中
永久丢弃普通输出后缀，避免 SQLite、Managed Blob、事件、日志或详情接口继续保存另一份全文。

## 目标与边界

- 在 Adapter/Core 完成规范化、operation 分类和文件事实提取后构造唯一 `PersistableResult`；后续存储与事件只消费该投影。
- 普通输出按 `aggregatedOutput`、output/result、stdout+stderr、typed content、summary fallback 的封闭优先级选择，
  与错误文本共享 7,680 字节预算，按最长合法 UTF-8 前缀保存。
- 更新由 `CompleteSnapshot | OrderedDelta | MetadataOnly` 三态驱动；归约器不从字段或 phase 猜测，迟到元数据不能
  清除已保存文本或截断标记。
- 新增 nullable `outputTruncated`；`true/false` 只描述新快照是否丢失普通输出，历史缺失保持 unknown，不复用
  `isTruncated` 或 Blob 完整性状态。
- operation 身份、状态、退出/错误码、时间、输入、结构化 diff、Files Changed、附件和图片不占普通输出预算。
- Renderer 只展示预算内结果，截断时显示“结果过长，部分内容已省略。”，没有全文恢复入口。
- Migration 170 不回填或清理历史记录，不新增存储系统、服务或 Blob owner。

字段、归约和验收见 [Run Process Detail Surface v42](../../contracts/run-process-detail-surface-v42.md)，架构边界见
[Evidence/Activity 基础不变量](../../architecture/foundational-invariants.md#evidence-canonical-activity)，取舍理由见
[版本决定](decisions.md)，实施证据见[实施与验收](implementation-plan.md)。

## 当前状态

Core、Migration 170、Desktop wire 与 Renderer 提示已经实现。第 7,680 字节后标记已由 SQLite、result Blob、实时事件
和详情读取的联合回归证明不会持久化，结构化 diff 仍可读；三态归约、历史 nullable 字段、旧版 Built-in 关联和仓库标准
门禁均已通过，因此本版状态为 `completed`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.65 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[版本决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.66 |
| Decisions | 已更新 | [V1.66-D01](decisions.md#v1-66-d01)记录永久舍弃普通输出后缀、而非保存全文 Blob 的取舍，并同步当前决定导航 |
| Contracts | 已更新 | 发布当前 [Run Process Detail Surface v42](../../contracts/run-process-detail-surface-v42.md)，v41 降为历史，定义三态、字段和验收不变量 |
| Architecture | 已更新 | [Evidence/Activity 基础不变量](../../architecture/foundational-invariants.md#evidence-canonical-activity)固定统一持久化投影、输出预算和结构化事实独立性 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)使用简洁的结果省略提示；不新增恢复按钮 |
| Runtime Activity | 确认无需更新 | Canonical Activity identity、phase/outcome、Adapter mapping 与 Registry 不变；本版只约束已分类结果的持久化副本 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 协议、实测版本、Agent 输入或安装资格；所有 Adapter 共用 Core 投影 |
| Documentation routing | 已更新 | 文档任务入口、合同索引、当前决定导航与版本指针均路由到 v42/v1.66 |
| Root README | 确认无需更新 | 项目定位与常青能力不变；该限制属于执行证据的内部持久化与详情语义 |
