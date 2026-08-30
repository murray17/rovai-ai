---
document_type: version-overview
version: v1.32
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: completed
model_context_change: true
last_updated: 2026-08-30
---

# Rovai-ai v1.32：外部附件静默快照

`rovai send --file` 在首次 IPC 前把 Runtime 可读取的外部文件或目录快照到当前 Run tmp，
消除“发送失败、手工复制、重新发送”的重复操作。Core 继续只读取 execution workspace 或 Run tmp。

前置版本：[v1.31](../v1.31/README.md)。

- [实施计划](implementation-plan.md)
- [版本决定](decisions.md)
- [已确认模型教学变更](model-context-change-send-external-files.md)

## 范围

CLI 路径适配、共用文件快照能力、lease 根目录、Run tmp 清理、错误脱敏和精确附件帮助。
Managed v2 数据库、消息/Delivery 原子提交、Renderer 和 Runtime 专属目录准入不改变。

实现与本地回归已完成，结果见[实施计划的验证记录](implementation-plan.md#验证记录)。
未启动日常 App 或真实 Runtime；Windows 原生附件与 Named Pipe 验证由 PR CI 执行，不据此扩大 Runtime 支持声明。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | 本概览、实施计划与版本索引；v1.31 冻结 |
| Decisions | 已更新 | [V1.32-D01](decisions.md#v1-32-d01) 与当前决定导航记录 CLI 适配和 Core 权威边界 |
| Contracts | 已更新 | Camp Attachment v7、Camp Message Send v14、Built-in Tool Transport v21（本次实现同步） |
| Architecture | 已更新 | Built-in Tool Runtime 与 Camp Attachments（本次实现同步） |
| UI | 确认无需更新 | Renderer 与附件展示不变 |
| Runtime Activity | 确认无需更新 | 不改变 Runtime 事件映射 |
| Runtime compatibility | 确认无需更新 | 未新增 Runtime 或宣称真实 Runtime 验收结果 |
| Documentation routing | 已更新 | docs/README.md 与合同索引（本次实现同步） |
| Root README | 确认无需更新 | 产品定位和安装方式不变 |
