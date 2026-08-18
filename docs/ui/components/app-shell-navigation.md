---
document_type: ui-component-contract
authority: renderer-app-shell-navigation
status: accepted
last_updated: 2026-08-18
---

# App Shell 与统一侧栏

## 统一侧栏结构

所有一级页面共享固定 270px rail 和 50px 顶行。侧栏品牌字标为 `Rovai AI`，不带副标题或通知铃铛；
普通侧栏底部只保留“设置”。应用内提醒只在新动态到达时临时呈现，偏好位于“设置 → 提醒”。设置
分类覆盖同一个 270px 槽位，不在内容区再增加第二列导航。

普通侧栏依次显示置顶内容和 Project。每个 Project 行负责展开/折叠，不显示独立折叠图标；
右侧仅保留项目级 `＋` 与三点菜单。标题与“查看更多 / 收起”不显示 Camp 数量。当前 Project
使用中性 `--surface-selected` 与短 Steel rail；Hover 不能是发现行操作的唯一方式。

Camp 行显示稳定标题和必要状态。三点菜单是置顶/取消置顶、重命名、复制会话 ID 和删除的唯一
入口；复制只写稳定 Camp ID 原文。Camp 顶栏不得重复这些操作。

自动生成的 Camp 标题不把开头连续的真实队员 Mention / 所有队员 Mention 当作标题内容；只保留
首段正文开始后的文字，正文中后部的 Mention 和手写 `@文字` 继续作为普通标题文字。Camp 行不把
任何 `@文字` 渲染为身份 Token、人物卡入口或独立点击目标，整行仍只负责打开会话。

Project 的“移除项目”只从此设备的导航移除并取消相关置顶，不删除工作目录、Camp 或历史。
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

- 应用：通用、外观、提醒；
- 能力：Skill、MCP、Agent 运行时；
- 支持：诊断与修复。

不增加“关于与更新”。返回 App 后恢复原一级页面；当前 Main Window Session 内记住最后设置分类，
全新安装默认“通用”。设置页面的局部构图见
[`settings-workspace` surface brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)。

队员页继续显示普通全局侧栏和 Project / Camp 导航，不再用队员名册覆盖该槽位，也不提供独立的
“返回对话 / 返回 App”控件。队员名册位于内容区左侧；用户通过全局侧栏切换页面或会话，所有切换
继续遵守未保存 Runtime 草稿保护。

## 宿主平台交互

macOS 保留 hidden title bar 与受控 drag region；Windows 使用 OS native frame，所有 Renderer
`-webkit-app-region: drag` 必须关闭。Windows caption buttons、Snap Layout、Alt+Space、双击标题栏和多屏 DPI
由系统拥有，50px App 顶行位于原生标题栏之下且不复制窗口按钮或第二个 App 标题。

实现统一使用 `CommandOrControl` 动作和集中式平台文案映射：macOS 可显示 `⌘K`、Windows 显示 `Ctrl+K`；
文件定位分别显示“在 Finder 中显示”和“在文件资源管理器中显示”。可访问名称始终描述动作，不能只读出快捷键
符号。普通设备文案优先使用“此设备”；仅在确需 OS 语境时分别使用“此 Mac / 此电脑”。完整差异见
[Windows Interaction Delta](../windows-interaction-delta.md)。

## 响应式与可访问性

270px rail 不收缩。队员内容区名册默认 236px，可显式收起到 76px。最小 `1040×700` 下内容区自行
重排，不能让 rail、名册、菜单或主要操作被裁切。
Project/Camp 行、菜单、临时提醒和设置返回均可键盘操作，Icon-only 控件有可访问名称；选中、展开和
未读状态不能只靠颜色。Camp 行“有新回复”只在真正打开该会话、窗口可见且拥有焦点后消除；后台
Snapshot 刷新、设置/记忆页和应用失焦均不得提前清除。

页面缩放继续使用标准 `CommandOrControl + / - / 0` 快捷键；App 拦截 Electron 的默认倍率阶梯，
将键盘放大和缩小固定为每次增减 10 个百分点，`CommandOrControl 0` 重置为 100%。键盘调整后，
App Shell 在不抢夺焦点的全局浮层中短暂显示实际缩放比例，并通过 polite live region 播报同一文字。
浮层使用双主题语义 Token，在首次训练和所有一级页面上保持同一位置与行为。

## References

- [ADR-0074: Quick Chat 全栈切换](../../adr/0074-quick-chat-ubiquitous-language-and-binding-identity.md)
- [ADR-0078: Navigation projection](../../adr/0078-navigation-projection-and-sidebar-wordmark-boundary.md)
- [ADR-0173: Generated Camp names exclude leading Structured Mentions](../../adr/0173-leading-structured-mentions-excluded-from-generated-camp-names.md)
- [v0.57 Project remove 实施计划](../../versions/v0.57/implementation-plan.md)
- [v0.58 实施计划](../../versions/v0.58/implementation-plan.md)
- [v0.61 实施计划](../../versions/v0.61/implementation-plan.md)
