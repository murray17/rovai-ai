---
document_type: version-overview
version: v0.33
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-03
---

# Rovai-ai v0.33 Unified Sidebar Actions

> 中文名：统一侧栏操作
>
> 状态：统一侧栏生产实施、自动化门禁与真 App 验收已完成
>
> 前置版本：[v0.32 Event-Driven Member Calls](../v0.32/README.md)
>
> 生产设计：[production-design.md](production-design.md)
>
> 实施门禁：[implementation-plan.md](implementation-plan.md)

## 版本意图

统一 Camp 与可置顶 Project 的侧栏操作语法：行末只保留一个三点菜单，将置顶、重命名
和删除收敛到稳定位置，并移除项目会话数量对侧栏标题空间的干扰。

## 已确认范围

- Camp 菜单固定为“置顶/取消置顶、重命名、删除”，删除项前有分隔线；
- 可置顶 Project 使用只包含“置顶项目/取消置顶项目”的三点菜单；
- “快速对话”继续是不可整组置顶的 Renderer 投影，不显示 Project 菜单；
- 普通区与置顶区使用同一 Camp 行和菜单；
- 项目标题不显示会话数量，“查看全部”不包含数量；
- 菜单覆盖键盘、焦点返回、点击外部关闭、视口碰撞和触摸入口；
- “记忆”待确认角标及其带真实数量的可访问名称保持不变。

## 边界

本版本只修改 Renderer、Renderer 依赖与 UI 文档。`NavigationPin`、Electron Main 的
`navigation.json` 原子写入、Core、SQLite、IPC 和共享 Contracts 均不改变。置顶迁移、
排序、失效记录清理、Camp 重命名和永久删除继续使用既有生产合同。

## 完成定义

[实施计划](implementation-plan.md)中的语义测试、Typecheck、Renderer 全量测试、Desktop
构建，以及 `1440×920`、`1040×700` 真 App 菜单与键盘验收全部通过后，v0.33 才能标记完成。
