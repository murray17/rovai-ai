---
document_type: version-overview
version: v1.55
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-07
---

# Rovai-ai v1.55：文件路径如实呈现与 Pi edit Diff

前置：[v1.54](../v1.54/README.md)。本版本把文件入口与项目归属解耦，并在文件成功打开后直接展示
实际目标的位置。项目归属只决定路径使用项目相对形式还是外部绝对形式，不再决定路径行是否可见。本版本同时
接入 Pi 成功 `edit` 终态自带的 path-bound patch，让 Files Changed 如实显示可证明的增删行；没有等价 patch 的
Pi `write` 继续保持路径级操作事实。

## 范围与当前状态

- 消息中已经识别的显式 Markdown 文件链接继续使用统一入口，点击前不读取或检查目标；普通正文、
  inline-code 与代码块仍不自动扫描路径。
- Main 在完成来源校验、canonical 文件解析和 classifier 校验后签发路径。项目内文件显示相对项目根路径，
  包括项目根文件名；项目外文件显示 canonical 绝对路径，主目录内可缩写为 ~/。
- Attachment 继续只投影和复制 authority 给出的安全显示名，不暴露用户 source、Managed/legacy storage 或系统
  临时路径；Main 拒绝对只有安全名称的 handle 复制 absolute 路径。
- Tabs 下的路径使用既有视觉样式，中部省略长目录，并通过 hover、键盘焦点和 title 提供完整显示值。
  路径入口复用现有 reveal 能力；普通文件右键“复制完整路径”始终复制重验后的 canonical 绝对路径。
- 同名普通文件 Tab 从路径末尾逐级扩展到最短唯一目录后缀；无法从安全路径区分时才使用序号。
- 消息相对路径继续使用来源会话工作目录，预览内相对链接继续使用当前文档目录。项目切换不改变历史
  引用的解析基准，缺少上下文时不搜索同名文件。
- 文件链接、路径显示、reveal 和复制均不新增父目录授权，不改变项目、会话工作目录或 Agent 读写权限。
- Pi JSONL RPC v1 只在成功小写 `edit`、同 ToolCall 非空 `args.path`、`result.details.patch` 双文件头与路径精确一致且
  至少含一个 hunk 时产生 unified Diff；`write`、失败或不完整 edit 不从输入、磁盘或相邻字段反推 `+ / -`。
- Migration 147 在既有 Notification Single Chat Migration 146 后，把 Data Contract 从
  `v1.54 / schema 96 / activity-v3` 原子推进到 `v1.55 / schema 97 / activity-v4`；历史与 in-flight v1/v2/v3
  Activity 不回写、不重投影。
- 实现、定向回归与真实 Electron 场景已完成；完整门禁记录在[实施与验收](implementation-plan.md)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.54 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引和前后链接建立唯一 current v1.55 |
| Decisions | 已更新 | [V1.55-D01](decisions.md#v1-55-d01)记录 canonical 目标路径由 Main 在成功打开后签发并与目录授权分离；[V1.55-D02](decisions.md#v1-55-d02)记录 Pi patch 的窄准入、activity-v4 cutover 与历史冻结；CURRENT 已纳入导航 |
| Contracts | 已更新 | [File Preview v10](../../contracts/file-preview-v10.md)定义路径呈现边界；[Runtime File Change Observation v4](../../contracts/runtime-file-change-observation-v4.md)定义 Pi edit Diff 与 Migration 147 |
| Architecture | 已更新 | [File Preview 架构](../../architecture/file-preview.md)同步 Main 路径投影；[Runtime File Change Observation 架构](../../architecture/runtime-file-change-observation.md)同步 Pi terminal patch ingress 与 fail-closed 边界 |
| UI | 已更新 | [Camp 文件预览区](../../ui/components/file-preview.md)记录项目内外路径、长路径、完整路径入口和同名 Tab 行为 |
| Runtime Activity | 已更新 | [Mapping Registry](../../runtime-activity/registry.md)把 current classifier 切换到 activity-v4，并冻结 v1/v2/v3 operation 的原 classifier |
| Runtime compatibility | 已更新 | [Runtime Compatibility](../../runtime-compatibility.md)记录 Pi 0.84.4 edit/write 真实 wire 差异；启动、权限、模型、Session 与平台资格不变 |
| Documentation routing | 已更新 | 文档任务导航、Contracts/Architecture 索引、版本指针和当前决定导航均纳入 File Preview v10、Runtime File Change Observation v4 与 v1.55 |
| Root README | 确认无需更新 | 项目定位和常青能力范围未变化；细节由当前 File Preview 合同、架构和 UI 规范拥有 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [File Preview v10](../../contracts/file-preview-v10.md)
- [File Preview 架构](../../architecture/file-preview.md)
- [Camp 文件预览区](../../ui/components/file-preview.md)
- [Runtime File Change Observation v4](../../contracts/runtime-file-change-observation-v4.md)
- [Runtime File Change Observation 架构](../../architecture/runtime-file-change-observation.md)
- [Runtime Activity Registry](../../runtime-activity/registry.md)
