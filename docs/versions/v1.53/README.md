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

# Rovai-ai v1.53：Runtime 原生生图公屏收紧

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
与可见通知调用源；不改变 UI 布局、Runtime 平台准入或本版本原生图片过滤边界。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.52 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.53 |
| Decisions | 已更新 | [V1.53-D01](decisions.md#v1-53-d01)记录 Adapter 确认的闭集来源、历史 fail-closed 与保留式过滤；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Runtime Images v5](../../contracts/runtime-images-v5.md)拥有来源准入、持久标记和显式发送边界；[Camp Open Projection v16](../../contracts/camp-open-projection-v16.md)拥有收紧后的集合语义 |
| Architecture | 已更新 | [Runtime 图片架构](../../architecture/runtime-images.md)同步观察/保留与自动展示分层、Core 单一过滤 seam 和显式附件分离 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md#runtime-图片与消息图片)明确只消费 Core 已准入图片；布局、组件和文案不改 |
| Runtime Activity | 确认无需更新 | 内部图片观察仍在 Evidence 前消费，Canonical Activity、Evidence 分类与执行台映射均不改变 |
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
