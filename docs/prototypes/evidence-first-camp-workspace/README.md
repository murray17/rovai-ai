# 证据优先 Camp 工作区交互稿

入口：[`index.html`](index.html)

这是一份不依赖构建工具或外部资源的单文件 HTML 交互稿，不修改生产 Renderer，也不连接
Core、Runtime、Git 或本机打包流程。页面中的任务、运行结果与审批内容均为演示数据。

## 目的

用一个最具 Rovai 差异化的 Camp 页面演示“去 AI 味”后的信息优先级：

- 首层固定呈现“当前责任 / 需要你决定 / 最近证据”；
- 公共讨论仍是开放阅读面，但不再承担 Task、Approval 与 Run 的全部表达；
- Approval 仍位于 Composer 正上方，执行详情仍由 Drawer 承接；
- 保留 Porcelain Day / Steel Night、270px 侧栏、50px 顶栏和右侧任务/队员 Inspector；
- 移除星芒、渐变 Hero、英文眉题、提示词卡墙和大幅角色画像。

## 可操作内容

- 切换 Porcelain Day / Steel Night；
- 点击顶部三个协作态势入口定位任务、审批或最新证据；
- 筛选“全部 / 决策与证据 / 讨论”；
- 展开审批 Dock 并记录一次模拟决定；
- 打开三名队员各自的执行过程；
- 切换 Inspector 的任务与队员页签；
- 停止模拟的当前执行后，在 Composer 中输入并追加一条仅存在于页面内的模拟消息；
- 隐藏/恢复 Inspector，或打开右上角设计说明。

## 设计依据

- 根目录 `DESIGN.md`；
- `docs/ui/components/conversation-workspace.md`；
- `docs/ui/components/app-shell-navigation.md`；
- 当前 `CampWorkspace.tsx`、`CampNavigation.tsx` 与 `styles.css`；
- 2026-08-13 的 Renderer 去 AI 味审视结论。
