---
document_type: version-overview
version: v1.37
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-08-31
---

# Rovai-ai v1.37：Runtime 图片与飞书文件交付

前置：[v1.36](../v1.36/README.md)。渠道已有代码先保存为 f0e1ce2f、b7316a57、6f9f8bd2；
钉钉未完成 Owner/Core/群卡片/packaged 验收的 NO-GO 原样保留，本版本不继续实施钉钉。

## 范围与状态

- 实施本机 Runtime 结构化图片，稳定路径零拷贝、inline bytes 优先、Run 临时图片复用 Blob；
  不做目录范围或符号链接限制，不增加授权、File Preview 合同或通用复制机制。
- ACP 增量/终态、Claude Tool Result、Codex MCP/原生 imageGeneration 已接入；本机实测后补齐
  Antigravity generatedMedia、TRAE builtin 图片、Copilot binaryResultsForLlm。六种 Runtime 的图片结果链
  已通过隔离 Core；Cursor 旧版无 ACP，其他 Runtime 的上游/能力限制见[真实验收](runtime-image-acceptance.md)。
- 共享图片 Gallery/Lightbox、消息附件顺序、Run supplement 排序、真实 Chromium 解码已实施。
- 飞书复用已有显式附件 Outbox，不自动上传 Runtime 图片；钉钉链路保持原样。
- Migration 133 只新增图片元数据表和索引，Data Contract `v1.43 / schema 84`；旧业务行保持不变。
- [model-context-change revision 1](model-context-change.md) 已由开发者二次确认并实施：精简文件帮助，
  仅新飞书 Session 增加冻结的文件交付提示；Charter revision 3 复用既有兼容路径，其余版本轴不变。
- 当前仍 in_progress：Antigravity 边界已关闭，但 Cursor 非标准通知、所有 Runtime 原生生图及渠道实发
  并未全部验收；本机已观察到的工具/协议/上游限制保留，不提升任何 Runtime 平台资格。

具体完成事实、测试 owner 与待办见[实施计划](implementation-plan.md)。后续 main 合并、完整回归及
Applications 非终止安装见[本机交付记录](main-merge-and-daily-app.md)；没有创建 PR 或重启日常 App。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、实施计划、版本索引；v1.36 冻结为 historical，未验收事实保留 |
| Decisions | 已更新 | [V1.37-D01](decisions.md#v1-37-d01) 与 [CURRENT](../../decisions/CURRENT.md) |
| Contracts | 已更新 | [Runtime Images v2](../../contracts/runtime-images-v2.md)、[Camp Open Projection v12](../../contracts/camp-open-projection-v12.md)、[Camp Message Send v16](../../contracts/camp-message-send-v16.md) |
| Architecture | 已更新 | [Runtime 图片](../../architecture/runtime-images.md)、[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md#bootstrap-与-dynamic-context)及架构导航 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md#runtime-图片与消息图片)；保留既有双主题 |
| Runtime Activity | 确认无需更新 | 内部图片观察不进入 Canonical Activity，不修改 classifier/映射或已有公开 Evidence |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md#2026-08-31-runtime-图片观察边界)区分协议 fixture 与真实 Runtime smoke |
| Documentation routing | 已更新 | [文档导航](../../README.md)、合同与架构索引 |
| Root README | 确认无需更新 | 不改变产品定位、安装方式或平台支持承诺；当前实施状态留在本版本 |
