---
document_type: version-overview
version: v0.33
lifecycle: historical
authority: version-scope-and-status
design_status: frozen
implementation_status: complete
last_updated: 2026-08-06
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

## 历史勘误（2026-08-06）

本文及其实施计划只记录 v0.33 的“统一侧栏操作”交付包。提交 `8af34a1` 同时合入了
结构化 Mention 的 Core、Contracts、Renderer 与 ADR-0096，但当时没有把这项并行工作
列入本版本 README。因此，下文“本版本只修改 Renderer”的边界只适用于统一侧栏操作，
不能被解释为提交 `8af34a1` 的完整变更范围。

同一提交首次实现的历史消息 Member Mention 交互是“点击打开队员详情”；其父提交仍只
把用户正文渲染为纯文本。后续提交 `69e335e` 只加入了已选中的 Mention Popover HTML
原型和方案 2 文档，没有修改生产 React 或重新打包应用。因此，用户在安装包里继续看到
旧样式或旧点击行为，并不是某个版本把已完成的 Popover 改回去了，而是已确认原型此前从未
进入生产包。2026-08-06 再次确认的当前 Renderer 合同是“默认无底色的飞书式行内文字 +
点击/键盘打开布局 2 人物信息卡 + 不离开会话”；全局角色 Toast 也不是历史生产合同。

本段只纠正历史归档的范围歧义，不改写 v0.33 当时的侧栏目标。当前权威分别为：

- Mention 内容、稳定身份与派生寻址：[ADR-0096](decisions.md#adr-0096)；
- Mention 视觉与点击行为：[Arctic Dawn 的不得回退合同](../../ui/components/structured-mentions.md#不得回退的交互合同)；
- 真实 App 回归门禁：[桌面 UI 验收](../../development/ui-acceptance.md#结构化-mention-门禁)。

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
