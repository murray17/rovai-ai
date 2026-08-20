---
document_type: version-overview
version: v1.20
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: planned
model_context_change: false
last_updated: 2026-08-20
---

# Rovai-ai v1.20：会话附件系统打开

> 当前状态：设计与长期合同已确认，实施待完成。
>
> 前置版本：[v1.19 Agent 文件入口隔离与纯附件发送](../v1.19/README.md)。v1.19 已按完成事实冻结为
> historical；其 Authority ingress、统一 publication 与 Runtime View v3 继续作为本版基线。

## 版本目标

让已发布的会话附件遵循桌面系统的自然交互，同时保持本地路径和 Authority 边界不可从 Renderer 绕过：
图片继续在会话内预览，普通文件使用系统默认应用打开，目录交给 Finder / 文件资源管理器打开；高风险
文件在 Desktop Main 执行前二次确认。

## 交付范围

- Core 增加仅供 Desktop Main 使用的 published Attachment open-target lookup；输入只接受 canonical Camp ID
  与 Attachment ID，查询必须同时命中对应 Camp 的 `message_attachment`；
- Core 对 Authority 精确路径、类型、大小、digest、目录树和 no-follow identity 重新验证，目标必须位于
  `<data_dir>/camp-attachments/<camp-id>/<attachment-id>/...`；
- 用户打开 Authority Attachment 不依赖 `runtimeProjectionState`，Runtime View pending、recovery 或 failed
  只影响队员读取；已发布图片预览同样与该状态解耦；
- Desktop Main 独占 `shell.openPath` / `shell.showItemInFolder` 与风险确认；Renderer 只发送 Camp/Attachment ID，
  永不接收路径或可能包含路径的原始系统错误；
- Timeline Attachment Card：图片单击保持会话预览，其他附件单击系统打开；右键菜单提供打开与显示所在位置，
  并覆盖键盘、忙碌、失败和长文件名状态；Composer Prepared Attachment 保持既有准备/移除交互。

## 数据与 Context 兼容性

本版不增加数据库 Migration，不改变 Data Contract、CampMessage/Attachment read model、Runtime View、
ContextManifest、Run Facts、Built-in Tool 或模型输入字节。Camp Attachment 合同升级到 v5，只新增 Desktop
本机读取与打开边界；Renderer `RovaiApi` 增加封闭的 `attachments` namespace。

## 明确不做

- 不让 Renderer、消息、Context、日志或错误携带 Authority / Runtime View 绝对路径；
- 不从 Renderer 接收任意路径，不使用 `shell.openExternal(file://...)`；
- 不把 `.rovai` Runtime View 作为用户打开来源，也不因 View 未就绪而禁用 Authority 打开；
- 不改变 Prepared Attachment 的 Composer 交互或让未发送附件进入 Timeline open API；
- 不把系统打开结果解释为文件内容安全、执行成功或 Runtime 可读。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.19 按完成事实冻结；本概览、实施计划与索引建立唯一 current v1.20。 |
| Decisions | 已更新 | [V1.20-D01](decisions.md#v1-20-d01)记录 Authority open target 与 Main-owned Shell 边界。 |
| Contracts | 已更新 | Camp Attachment v5 冻结 open target、风险和无路径错误边界。 |
| Architecture | 已更新 | Attachment Architecture 与基础不变量同步 Authority 用户打开和 Runtime View 解耦。 |
| UI | 已更新 | Camp 会话工作区定义 Timeline 附件主动作、右键菜单、忙碌、失败与投影状态关系。 |
| Runtime Activity | 确认无需更新 | 系统打开是 Desktop 用户动作，不产生 Runtime activity 或 Execution Evidence。 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime 目录准入、已验证版本或功能资格。 |
| Documentation routing | 已更新 | 文档导航、合同索引和当前决定导航切换到 Camp Attachment v5。 |
| Root README | 确认无需更新 | 不改变项目定位、平台范围、安装入口或常青能力列表。 |

## References

- [v1.20 实施与验收计划](implementation-plan.md)
- [v1.20 决策记录](decisions.md)
- [Camp Attachment v5](../../contracts/camp-attachment-v5.md)
- [Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
