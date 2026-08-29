---
document_type: version-overview
version: v1.30
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: true
last_updated: 2026-08-30
---

# Rovai-ai v1.30：Camp 文件预览

> 当前状态：设计、边界与实施顺序已经确认，生产代码与自动化验收正在实施。完成证据以
> [实施计划](implementation-plan.md)中的逐项记录为准。

前置版本：[v1.29 Camp 动态队员管理与 Runtime 文件变化](../v1.29/README.md)已按冻结时事实转为 historical。

## 版本目标

在当前 Camp 内提供一个只读、可多 Tab 切换的独立文件阅读面。所有文件入口先经过 Core 的领域来源验证，
再由 Desktop Main 持有真实路径、文件句柄、重开能力与 root watcher；Renderer 只消费安全显示路径和不透明能力。

本版本交付：

- 会话、文件预览与任务/队员 Sidecar 共用一行紧凑顶栏，宽、中、紧凑三种布局由容器实测决定；
- Markdown、HTML、代码/文本、分页文本、图片/SVG 与 Diff/Patch 的单一规范阅读视图；
- Camp workspace、消息文件引用、Attachment、Files Changed 当前文件、文档子链接和用户授权 root 的封闭来源；
- 一个 canonical root 复用一个事件 watcher，外部变化只设置轻量更新提示，用户主动刷新前保留旧内容；
- 不支持的文件不创建 Tab、句柄或 watcher，显式激活后继续交给系统默认应用；
- 文件选区以冻结快照附加到当前 Composer，不把短期句柄变成持久读取授权。

文件选区进入 Agent input 属于核心模型上下文变更；其精确前后合同见
[待二次确认的 revision 2](model-context-change-file-selection.md)。确认完成前，该子项不视为可合入交付。

## 明确不做

- 不编辑或保存文件，不提供语言服务、调试器、终端或通用文件浏览器；
- 不暴露 `readFile(path)`、任意 IPC channel、canonical path、watcher、Grant 或 token；
- 不扫描工作区、不轮询打开文件、不自动覆盖用户当前正在阅读的内容；
- 不把历史 Runtime Evidence 与当前磁盘文件混成一个真源；
- 不为不支持格式建立文件信息占位页；
- 不建立 macOS 与 Windows 两套 Renderer 组件树。

## 核心验收口径

- Core 校验领域来源，Main 校验 realpath、containment、regular file、大小与文件身份；Renderer 不能用显示路径重新授权；
- 同一窗口同一来源文件以 Main 返回的 `previewKey` 去重；Tab 关闭、Camp 切换、窗口销毁和退出幂等释放资源；
- watcher 事件只令匹配 Tab `hasExternalUpdate=true`，不读文件、不切 Tab、不移动焦点；
- 主动刷新保留旧内容，成功原位替换；失败保留旧内容并提供重试；较早刷新不能清除较新的外部更新信号；
- 不支持格式只在本次显式激活中调用系统默认应用一次，并且不进入 Renderer reducer；
- 路径行只显示项目/root 相对路径，左侧自然排列，中部目录省略并尽可能保留文件名，无水平滚动；
- 文件 Tab 完成 ARIA tab 语义、手动激活、roving focus、关闭后焦点恢复和键盘重排；关闭按钮 hover/focus 显示，粗指针持续可见；
- HTML iframe 没有 Preload/Rovai API，CSP 先于正文生效，本地资源只通过短期受控协议与父文件授权范围读取；
- Windows 只投影原生 chrome、字体、快捷键和文件管理器文案差异。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.29 冻结为 historical；本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.30。 |
| Decisions | 已更新 | [V1.30-D01–D07](decisions.md#v1-30-d01)记录独立 Pane、封闭来源、窗口能力、HTML 隔离、Evidence 分流、事件更新与选区快照。 |
| Contracts | 已更新 | 新增 [File Preview v1](../../contracts/file-preview-v1.md)，固定公开联合、读取、更新、释放、错误与短期能力边界。 |
| Architecture | 已更新 | 新增 [File Preview](../../architecture/file-preview.md)，固定 Core/Main/Preload/Renderer 职责、root watcher 与 HTML 协议。 |
| UI | 已更新 | 新增 [文件预览区](../../ui/components/file-preview.md)，并从 Camp 会话工作区路由共享顶栏、响应式替换和焦点恢复。 |
| Runtime Activity | 确认无需更新 | 本版本消费既有 Files Changed typed projection，不改变 Runtime Activity 映射或 Evidence 准入。 |
| Runtime compatibility | 确认无需更新 | 文件预览是 Desktop 本机能力，不改变任何 Agent Runtime 的产品准入或实测能力。 |
| Documentation routing | 已更新 | 文档总导航、Architecture/Contract/UI 索引和当前决定导航加入 File Preview 当前入口。 |
| Root README | 确认无需更新 | 当前仍为 in-progress，尚不新增根 README 的常青已交付能力声明。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [File Preview Architecture](../../architecture/file-preview.md)
- [File Preview v1 Contract](../../contracts/file-preview-v1.md)
- [文件预览区 UI](../../ui/components/file-preview.md)
- [模型上下文变更 revision 2（待二次确认）](model-context-change-file-selection.md)
