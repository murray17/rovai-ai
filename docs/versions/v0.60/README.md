---
document_type: version-overview
version: v0.60
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-12
---

# Rovai-ai v0.60：有界 Tool 输出预览与按需全文复制

> 当前状态：Renderer 实现、真实打包 App 验收与 macOS 安装均已完成。
>
> 前置版本：[v0.59 九 Runtime 的零 send 公共输出恢复发布](../v0.59/README.md)
>
> 后续版本：[v0.61 队员页来源感知会话返回](../v0.61/README.md)

## 版本目标

在不改变现有 Agent 聚合、AgentRun stage、Tool Call 行、Canonical Activity、Execution Evidence 或
Drawer 布局的前提下，让超长 Tool 输出保持可读：展开后只显示开头的有界预览，完整公开输出通过
轻量 Icon-only 按钮按需复制，不再把完整 Evidence Payload 渲染进 Drawer。

## 交付范围

- 短 Tool 详情继续原样显示；超过 10 行、2,000 个 Unicode 字符或 Core 已标记 Blob Evidence 时，
  Renderer 只保留开头并显示“后续内容未显示”，不拼接末尾；
- 截断预览右上角增加 25px、无常驻边框、具名的复制图标，保持现有 Porcelain Evidence 表面；
- 存在完整 Blob 时，点击通过现有 `agentRunEvidence.getContent` 按需读取；没有 Blob 但超过 Renderer
  预览上限时，复制当前已持有的完整 Tool 详情；
- 复制只提取该事件的公开输出、Patch、命令结果或 Built-in Tool `output`/`input` 字段，不复制
  Evidence 外层 JSON、内部 ID、digest 或其他元数据；
- 全文只进入一次性局部变量和系统剪贴板，不进入 React state 或 DOM；读取中、成功与失败重试通过
  图标、可访问名称和 `aria-live` 状态反馈。

## 冻结边界

- 不改变 Core 的 16 KiB inline/Blob 分界、4,000 字符公共 Evidence preview 或 Managed Blob 生命周期；
- 不修改 `agentRunEvidence.getContent` IPC、Camp 授权、Canonical Activity Mapping 或 Evidence schema；
- 不新增第二层 Tool 详情、命令/目录/统计面板、头尾拼接、全文展开或 Drawer 内全文缓存；
- 不改变消息区、Agent 聚合、Run 聚焦、自动跟随、Drawer 高度、Approval、Composer、Inspector 或
  Runtime 数据语义；
- Reasoning/Thought 继续不进入 Renderer，复制能力不成为读取隐藏思考的旁路。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.59 冻结为 historical；本版本成为唯一 current，并新增概览与实施计划 |
| ADR | 确认无需更新 | 只改变既有公开 Tool Evidence 的 Renderer 有界呈现，不产生跨版本领域或权威决策 |
| Contracts | 确认无需更新 | 复用现有 `agentRunEvidence.list/getContent`、Camp 授权和 Evidence wire shape，不增删字段或错误语义 |
| Architecture | 确认无需更新 | Core、Blob Store、IPC 和 Renderer 职责不变；完整内容仍由 Core 按需返回 |
| UI | 已更新 | [当前 UI 详规](../../ui/arctic-dawn.md)冻结开头预览、Icon-only 复制和不渲染全文边界 |
| Runtime Activity | 确认无需更新 | 不改变 Canonical Activity 分类、标题、生命周期、聚合或来源可信度 |
| Runtime compatibility | 确认无需更新 | 不改变任何 Runtime Adapter、协议、版本或已验证能力 |
| Documentation routing | 已更新 | [版本索引](../README.md)指向 v0.60；开发 UI 验收补充真实 Blob 复制门禁 |
| Root README | 确认无需更新 | 项目定位与常青能力不变，根 README 不记录局部 Renderer 呈现策略 |

## References

- [v0.60 实施与验收计划](implementation-plan.md)
- [当前 UI 详规](../../ui/arctic-dawn.md)
- [桌面 UI 验收](../../development/ui-acceptance.md)
