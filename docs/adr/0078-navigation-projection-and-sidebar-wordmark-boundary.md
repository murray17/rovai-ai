---
document_type: adr
id: ADR-0078
title: "Navigation Projection and Sidebar Wordmark Boundary"
status: accepted
date: 2026-07-30
decision_scope: cross-version
source_version: v0.24
supersedes: []
superseded_by: null
---

# ADR-0078: Navigation Projection and Sidebar Wordmark Boundary

## Context

ADR-0048 冻结了 `Rovai-ai` 的正式产品、打包与内部命名，ADR-0074 冻结了 Quick
Chat 的领域词汇与 `quick_chat` Workspace Binding，并明确 Quick Chat 不是 Project。
Arctic Dawn 首版 Renderer 因而把 Quick Chat 渲染为独立导航分组，同时在设置页保留
全局侧栏并增加第二列设置导航。

后续导航原型要求减少侧栏分组与并列导航：Quick Chat Camp 应在“项目”列表末尾以
文件夹式分组出现；设置分类应占用同一条 270px 侧栏；侧栏品牌位使用 `Rovai AI`
字标且不再显示副标题。这些都是 Renderer 投影要求，不能反向改变 Quick Chat
Binding、Project 读模型、正式应用身份或数据迁移合同。

## Decision

### Quick Chat 只在导航中使用项目式投影

Renderer 的普通导航固定为“置顶 / 项目”两个分区。“项目”分区先显示全部
directory-backed Project，最后显示一个文件夹样式的“快速对话”分组。

该分组是视觉投影，不是 Project：

- Navigation Snapshot 继续分别提供 `quickChat` 与 `projects`；
- `quick_chat` Camp 不进入 `ProjectNavigationGroup`，不获得 Project identity、
  canonical project path 或 Project pin；
- “快速对话”分组本身不能置顶；其 Camp 仍可单独置顶；
- 置顶 Camp 继续从普通分组移到“置顶”；置顶 directory Project 继续携带完整 Camp
  列表；
- 所有 Core、SQLite、IPC、受管目录和领域词汇继续遵守 ADR-0074。

### 设置分类覆盖同一侧栏槽位

进入设置时，App Shell 保留同一条固定 270px 侧栏，但把普通导航内容替换为设置导航：

1. Logo 与 `Rovai AI` 侧栏字标；
2. “返回 App”；
3. 设置标题与说明；
4. “技能 / MCP / 执行引擎 / 外观 / 诊断”。

设置内容区不再增加 188px 二级导航。返回 App 恢复进入设置前的一级页面和 Camp；
再次进入设置时保留上次选择的设置分类。切换只改变 Renderer 导航投影，不重建设置
数据、不产生领域事件，也不丢失设置页局部状态。

### Sidebar wordmark 与正式产品身份分离

普通侧栏和设置侧栏的可见品牌字标统一使用 `Rovai AI`，不显示
“北极晨光 · Workspace”或其他 slogan。该字标是窄范围 Renderer 展示：

- 正式产品名、窗口标题、安装包、应用数据目录、诊断文件和文档主体名称仍是
  `Rovai-ai`；
- `productName`、`appId`、artifact name、`window.rovai`、IPC、环境变量和文件命名
  继续遵守 ADR-0048；
- 不引入第二套内部 namespace，也不迁移任何应用数据。

### Core 健康只从诊断页访问

普通侧栏底部只保留“设置”。删除 Core 健康摘要与诊断深链，但不删除 Health
Snapshot、探测请求、诊断设置页或导出能力。

## Consequences

- 普通侧栏只有“置顶 / 项目”两个会话分区，Quick Chat 仍能在固定位置被发现。
- Quick Chat 的视觉文件夹不会污染领域模型或让 Project 获得新持久身份。
- 设置页在窄窗口获得更多内容宽度，并且不会同时显示两套导航。
- `Rovai AI` 只作为侧栏字标存在；正式产品和兼容路径继续保持 `Rovai-ai`。
- 删除健康入口后，用户仍可通过“设置 → 诊断”查看同一份健康事实。

## Rejected Alternatives

- **把 Quick Chat 真正改成 Project。** 这会破坏 Workspace Binding 与 Project
  读模型，并让受管目录冒充用户选择的 canonical directory。
- **把 `quickChat` 合并进 `projects` IPC。** 视觉排序不需要改变权威合同。
- **设置页同时保留普通侧栏和 188px 二级导航。** 继续占用额外宽度并重复导航层级。
- **每次进入设置都重置到“技能”。** 会丢失用户上次的工作位置。
- **把 `Rovai AI` 扩展成打包或内部正式名称。** 本轮没有授权第二次产品 namespace
  迁移，且会与现有兼容路径冲突。
- **删除健康探测。** 本轮只删除侧栏入口；诊断事实与能力仍然有效。

## References

- [ADR-0048: Rovai-ai Product Identity](0048-rovai-product-identity-and-legacy-namespace.md)
- [ADR-0074: Quick Chat Ubiquitous Language](0074-quick-chat-ubiquitous-language-and-binding-identity.md)
- [v0.24 Arctic Dawn V3](../versions/v0.24/README.md)
- [App Shell 与统一侧栏 UI 合同](../ui/components/app-shell-navigation.md)
- `rovai-navigation-settings-empty-v7-package`
