---
document_type: production-design
version: v0.33
authority: version-design
status: frozen
last_updated: 2026-08-03
---

# v0.33 统一侧栏操作生产设计

## 权威与原型边界

本设计基于现行[App Shell 与统一侧栏合同](../../ui/components/app-shell-navigation.md)、生产代码和
`rovai-sidebar-scheme-2-final` 交付包收敛。交付包的说明、HTML 与两张基准预览已经核对，
其 SHA-256 清单与实际文件一致。原型中的静态 Camp、Project、时间和演示事件不进入生产。

本文只替代 Arctic Dawn 中“Camp/Project 使用独立直接置顶按钮”的侧栏交互合同；未涉及
的布局、Token、Navigation Read Side、领域语义与安全边界继续有效。

## 统一操作模型

每个 Camp 行只保留一个三点菜单触发器。菜单项按固定顺序显示：

1. `置顶` 或 `取消置顶`；
2. `重命名`；
3. 分隔线；
4. danger 语义的 `删除`。

普通 Project 与置顶 Project 使用同一个三点菜单，且只显示 `置顶项目` 或
`取消置顶项目`。Project 本身仍不可选择，不新增 Project Workspace。快速对话继续显示
文件夹式标题，但没有 Project 菜单；其中的 Camp 仍使用完整 Camp 菜单。

置顶 Camp 在顶部“置顶”分区和普通 Camp 使用同一个行组件，不保留专用取消置顶按钮。
置顶 Project 继续展示完整分组。Camp 或 Project 置顶后从来源分组迁移，取消后按最新
Navigation Read Side 返回；任何目标都不重复显示。

## 数量与读取

Project 标题不再投影 `totalCount`。`totalCount` 继续作为 Renderer 内部事实，用于判断空
状态、是否提供全量读取入口和 `navigation.groupCamps` 分页，但不会显示在标题或菜单中。

折叠态的读取入口固定为 `查看全部`，不再显示“查看全部 N 个”；全量展开后仍显示
`收起`，读取中仍显示 `正在读取…`。本版本不改变默认最近 5 个 Camp、分页大小、排序或
失败反馈。

## 组件与依赖

生产实现复用项目现有 Radix 技术栈，增加 `@radix-ui/react-dropdown-menu`，不引入新的
UI 框架、图标库、状态管理或 CSS-in-JS。

- `SidebarActionMenu` 统一触发器、Portal、碰撞边界、菜单项、分隔线和图标；
- `CampRow` 统一普通区与置顶区的 Camp 标题、marker、选择态与菜单；
- `CampGroup` 只负责 Project 标题、可选 Project 菜单、Camp 列表和全量读取入口；
- Camp/Project 菜单文案由纯函数生成，并由 Renderer 测试覆盖。

菜单通过 Portal 渲染，避免被 `.navigation-scroll` 裁切；普通侧栏行不增加阴影，只有真实
菜单浮层使用 `--shadow-menu`。三点触发器在 Hover、Focus-within 和打开状态可见，在
`hover: none` 或粗指针环境中常驻。

## 键盘、焦点与失败

Radix Menu 提供 `menu/menuitem/separator` 语义、方向键、`Home/End`、`Escape`、点击外部
关闭和关闭后的焦点返回。触发器具有包含完整 Camp 或 Project 名称的可访问名称。

Pin 写入仍由现有 `onTogglePin → navigationPins.replace` 完成。写入成功导致目标迁移后，
Renderer 通过 `camp:<campId>` 或 `project:<projectKey>` 稳定目标键，在新位置恢复对应菜单
触发器焦点。写入失败时 Pin 状态和位置不变，既有错误反馈继续显示，焦点返回原触发器。

重命名与删除继续打开现有 Radix Dialog。取消、失败或重命名成功后按稳定 Camp ID 返回
菜单触发器；永久删除成功后目标不存在，不制造虚假焦点目标。删除阻塞、停止运行和重新
检查行为不变。

## 状态与非目标

- Navigation loading/error、Camp marker、选中态和长标题截断保持现有实现；
- “记忆”角标只表示待确认普通提案，继续使用暖色圆点和带真实数量的可访问名称；
- 不新增归档、回收站、拖拽排序、Project Workspace 或 Quick Chat 整组置顶；
- 不修改 `NavigationPin`、`navigation.json`、SQLite、Core、IPC、Contracts 或审计；
- 不复制原型假数据、页面切换器、Toast 文案或单文件事件实现。

## 验收矩阵

自动化必须证明：

- 未置顶/已置顶 Camp 与 Project 的菜单文案正确；
- Camp 菜单顺序固定，Project 菜单只有一个动作；
- 普通区和置顶区不存在独立 Pin 控件；
- Quick Chat 没有 Project 菜单；
- Project 标题和“查看全部”不显示数量；
- 记忆角标及其可访问数量继续存在；
- Typecheck、Renderer 全量测试和 Desktop 构建通过。

真 App 在 `1440×920` 与 `1040×700` 验收 Hover、Focus、打开态、视口内菜单、长标题、
置顶迁移、重命名、删除确认、点击外部关闭、`Escape`、方向键、`Home/End`、焦点返回与
reduced-motion；窗口不得出现整页横向溢出。
