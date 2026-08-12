---
document_type: ui-component-contract
authority: renderer-app-shell-navigation
status: accepted
last_updated: 2026-08-13
---

# App Shell 与统一侧栏

## 统一侧栏结构

所有一级页面共享固定 270px rail 和 50px 顶行。侧栏品牌字标为 `Rovai AI`，不带副标题；
通知入口位于品牌行，普通侧栏底部只保留“设置”。设置分类覆盖同一个 270px 槽位，不在内容区
再增加第二列导航。

普通侧栏依次显示置顶内容和 Project。每个 Project 行负责展开/折叠，不显示独立折叠图标；
右侧仅保留项目级 `＋` 与三点菜单。标题与“查看更多 / 收起”不显示 Camp 数量。当前 Project
使用中性 `--surface-selected` 与短 Steel rail；Hover 不能是发现行操作的唯一方式。

Camp 行显示稳定标题和必要状态。三点菜单是置顶/取消置顶、重命名、复制会话 ID 和删除的唯一
入口；复制只写稳定 Camp ID 原文。Camp 顶栏不得重复这些操作。

Project 的“移除项目”只从此 Mac 的导航移除并取消相关置顶，不删除工作目录、Camp 或历史。
重新选择相同目录可恢复。Core 的访问 ledger 与运行中清理边界由架构/ADR 决定，Renderer 不用
隐藏行状态推断目录已经删除。

## Quick Chat 与 Project 分组

“快速对话”在 Renderer 中是 Project 列表末尾的文件夹式投影，底层仍是 `quick_chat`，不创建
Project 领域实体。它没有 Project 菜单；其 Camp 行与目录 Project 下的 Camp 使用同一行为。
产品中文固定使用“快速对话”，英文使用 `Quick Chat`，不恢复“大厅”或 `Lobby`。

Quick Chat 首页不提供 Composer。普通“新对话”先原子创建 Active Camp；一键入口先取得
Core-owned Pending Camp 并进入同一 Composer，第一条消息成功后再原子激活。界面不得用静态
演示数据伪造日期、阶段或创建结果。

## 设置与返回

设置侧栏分三组：

- 应用：通用、外观、通知；
- 能力：Skill、MCP、Agent 运行时；
- 支持：诊断与修复。

不增加“关于与更新”。返回 App 后恢复原一级页面；当前 Main Window Session 内记住最后设置分类，
全新安装默认“通用”。设置页面的局部构图见
[`settings-workspace` surface brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)。

从具体 Camp 进入队员页时，返回控件显示来源上下文并精确回到同一 Camp，不区分 directory
Project 与快速对话；从 Memory、Quick Chat 首页或启动恢复进入时只显示“返回 App”。返回目标只在
当前 Renderer 窗口存活，并遵守未保存 Runtime 草稿保护。

## 响应式与可访问性

270px rail 不收缩。最小 `1040×700` 下内容区自行重排，不能让 rail、菜单或主要操作被裁切。
Project/Camp 行、菜单、通知入口和设置返回均可键盘操作，Icon-only 控件有可访问名称；选中、
展开和未读状态不能只靠颜色。

## References

- [ADR-0074: Quick Chat 全栈切换](../../adr/0074-quick-chat-ubiquitous-language-and-binding-identity.md)
- [ADR-0078: Navigation projection](../../adr/0078-navigation-projection-and-sidebar-wordmark-boundary.md)
- [v0.57 Project remove 实施计划](../../versions/v0.57/implementation-plan.md)
- [v0.58 实施计划](../../versions/v0.58/implementation-plan.md)
- [v0.61 实施计划](../../versions/v0.61/implementation-plan.md)
