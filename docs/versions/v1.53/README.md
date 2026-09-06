---
document_type: version-overview
version: v1.53
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in-progress
model_context_change: false
last_updated: 2026-09-06
---

# Rovai-ai v1.53：Runtime 图片来源、工具一致性与正文块持久化

前置：[v1.52](../v1.52/README.md)。本版本保留 Runtime 结构化图片观察、混合存储、按需读取和既有图片
Gallery，只收紧 Runtime 图片自动进入 Camp 公屏的来源准入。

## 范围与当前状态

- Codex 仅在当前 route 的 `item/completed` 且 item type 为 `imageGeneration` 时确认原生生图来源。
- Antigravity 仅在精确 conversation/step 关联、generate-image step type 和 done status 全部成立时读取
  `generateImage.generatedMedia` 并确认来源；既有 Run/epoch 和 terminal 去重 fence 保留。
- Claude、ACP、Codex MCP、TRAE、Copilot、截图、读图及其他工具图片继续可以被 Adapter 解析和保存，但
  来源为空，不自动附加到 Agent 消息，也不生成终态独立兜底。工具名 `generate_image` 不提升资格。
- Migration 141 / Data Contract `v1.53` / projection schema 92 增加 nullable 闭集
  `agent_run_image.public_display_source`；历史行不猜测、不回填，默认不展示但保留数据。
- Camp 图片 metadata 查询在同一 Core seam 过滤来源；实时更新、刷新、重开、消息合并与无公开消息兜底
  因而使用同一集合，Renderer wire 和 UI 结构不变。
- `rovai send --file` 的显式图片附件继续走 CampMessage 与 Managed Attachment 链，不读取来源标记，行为不变。

## 正文持久化补充

本轮补充正文持久化与维护写放大修复，见 [V1.53-D02](decisions.md#v1-53-d02)和
[实施与验收](implementation-plan.md#正文持久化补充)。补充任务更新 Runtime Evidence、Camp Open 读取
与可见通知调用源。Migration 143 对旧库中已被同一 Canonical Command 终态完整输出覆盖的历史 delta
及无正文生命周期空壳做一次性压缩，原子修复 Canonical 来源引用，并将 current marker 推进到
`v1.53/schema 94/activity-v3`；没有终态的部分输出和所有真实工具事实保留。显式模型已由冻结配置拥有，
因此其 Runtime 观察不再提交空命令。上述变化不改变 UI 布局、Runtime 平台准入或本版本原生图片过滤边界。

## 工具一致性与已部署数据库兼容

合入 PR #245 的 typed read/write、Shell 阅读摘要、统一工具状态及成功读取后提交文件预览；保留主线
文件阅读器改动，不重新设计界面。Migration 142 将 classifier 切换到 `activity-v3` 并形成
`v1.53/schema 93` 的 Migration 143 精确来源；此前主线 `v1.53/schema 92` 和工具分支
`v1.52/schema 92/activity-v3` 均有明确升级路径，随后统一进入 current `v1.53/schema 94/activity-v3`。
旧工具 141 的时间在原子汇合中保留，未知/部分 schema 不准入。见 [V1.53-D03](decisions.md#v1-53-d03)
及 [Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md)。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.52 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.53 |
| Decisions | 已更新 | [V1.53-D01](decisions.md#v1-53-d01)拥有图片准入理由，[D02](decisions.md#v1-53-d02)拥有正文块与维护调用理由，[D03](decisions.md#v1-53-d03)拥有部署迁移汇合理由；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Runtime Images v5](../../contracts/runtime-images-v5.md)、[Camp Open Projection v16](../../contracts/camp-open-projection-v16.md)、[Runtime File Change Observation v3](../../contracts/runtime-file-change-observation-v3.md)与 [Run Process Detail Surface v31](../../contracts/run-process-detail-surface-v31.md)分别拥有图片、读取、typed 操作与工具呈现 |
| Architecture | 已更新 | [Runtime 图片](../../architecture/runtime-images.md)、[文件操作](../../architecture/runtime-file-change-observation.md)、[Availability-first Runtime](../../architecture/availability-first-runtime.md#migration-switch)同步保留式投影与精确升级源汇合 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)与 [File Preview](../../ui/components/file-preview.md)保留合入分支的工具一致性和文件阅读语义；正文优化不增加界面设计改动 |
| Runtime Activity | 已更新 | [Registry](../../runtime-activity/registry.md)记录 activity-v3、可靠 typed read/write、历史 classifier 冻结和两种部署源兼容 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 启动、协议能力或平台资格；只使用已经适配并验证的原生事件字段 |
| Documentation routing | 已更新 | 文档任务导航、Contracts/Architecture 索引、版本指针和当前决定导航均指向 Runtime Images v5 与 Camp Open v16 |
| Root README | 确认无需更新 | 项目定位、安装方法与公开 Runtime 支持范围不因本地公屏图片集合收紧而变化 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Images v5](../../contracts/runtime-images-v5.md)
- [Camp Open Projection v16](../../contracts/camp-open-projection-v16.md)
- [Runtime 图片架构](../../architecture/runtime-images.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md#runtime-图片与消息图片)
