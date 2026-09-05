---
document_type: version-overview
version: v1.51
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-06
---

# Rovai-ai v1.51：Camp 文件预览会话恢复

前置：[v1.50](../v1.50/README.md)；后续：[v1.52](../v1.52/README.md)。本版本保留既有文件来源、具体文件能力、Viewer、布局和显式打开分类；只增加
窗口生命周期内按 Camp 隔离的 Tab 会话恢复、自动恢复的无副作用边界，以及文件不可读时的单句内容状态。

## 范围与当前状态

- Renderer 以有界内存 Map 按 Camp 保存 Tab 顺序、当前 Tab、Pane 可见性、可重验业务 source 和安全呈现；不写
  localStorage、SQLite、Core 或消息，App 重启后自然清空。
- Camp A→B→A 时先绑定 Main，再恢复 A 的 shell；仅可见 Pane 的 active 文件立即重验，其他文件首次激活才加载。
- 快照不保留 handle、reopen token、Root Grant、challenge、Blob URL、正文、分页、旧文件尺寸或 `previewKey`；临时
  child/root 来源恢复为明确 unavailable。
- 新 `filePreview.restore` 只接受消息、工作区、owner-scoped Attachment 和 Run Evidence 业务来源；它可签发新的
  Preview handle，但不能打开系统应用、显示目录、请求确认或产生目录授权 challenge。
- Main 以 Camp binding generation 覆盖来源解析、原生效果和 handle 注册边界；相同 Camp ID 的 A→B→A 也拒绝旧 A
  的 late completion。
- 文件不可定位或读取时，内容区只显示通用文件轮廓与一句错误码映射文案；不显示路径、尺寸、按钮或内部错误详情。
  Tab 结构与既有视觉保持不变，只在可访问名称中表达状态。
- Pane 关闭仍只隐藏，Tab 关闭才删除；Camp 永久删除同时清除窗口快照。File Change 历史 Tab 保持不可变 Evidence
  读取，不借恢复流程推测当前文件。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.50 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.51 |
| Decisions | 已更新 | [V1.51-D01](decisions.md#v1-51-d01)记录无能力窗口快照；[V1.51-D02](decisions.md#v1-51-d02)记录无副作用恢复与双 generation fence；CURRENT 已纳入导航 |
| Contracts | 已更新 | [File Preview v7](../../contracts/file-preview-v7.md)增加 closed restore wire、快照禁存字段、恢复矩阵和失败文案 |
| Architecture | 已更新 | [File Preview Architecture](../../architecture/file-preview.md)同步 Renderer session、Main binding generation、惰性恢复与资源代次 |
| UI | 已更新 | [Camp 文件预览区](../../ui/components/file-preview.md)只更新 Camp 恢复和失败内容态；既有布局、Tabs 与其他 Viewer 视觉不变 |
| Runtime Activity | 确认无需更新 | AgentRun Activity、Evidence 写入和执行台映射均未变化；File Change 继续读取既有不可变 Evidence |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime Adapter、协议、模型、平台准入或 Native Session |
| Documentation routing | 已更新 | 文档任务导航、Contracts/Architecture 索引、版本指针与当前决定导航均指向 File Preview v7 |
| Root README | 确认无需更新 | 项目定位、安装方法与公开 Runtime 支持范围不受窗口内文件阅读状态影响 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [File Preview v7](../../contracts/file-preview-v7.md)
- [File Preview Architecture](../../architecture/file-preview.md)
- [Camp 文件预览区](../../ui/components/file-preview.md)
