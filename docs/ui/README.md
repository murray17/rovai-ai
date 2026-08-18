---
document_type: ui-style-index
authority: renderer-ui-routing
status: accepted
design_direction: porcelain-day-steel-night
target_version: cross-version
last_updated: 2026-08-18
---

# Rovai AI UI 规范

本文件是 Renderer UI/UX 的稳定路由，不保存版本流水账。开始 UI 工作时先读根目录
[`DESIGN.md`](../../DESIGN.md)，再按目标读取主题、复杂组件、surface brief、QA 与相关领域合同。

## 当前视觉系统

Porcelain Day 与 Steel Night 是同一 Rovai AI 视觉世界的两套生产主题。它们共享组件树、功能和
状态矩阵；`system` 跟随当前宿主 OS 的应用主题解析策略。全局排版、空间、形状、深度、色彩职责和基础组件
规则由 [`DESIGN.md`](../../DESIGN.md) 统一拥有。

## 主题

- [主题注册、首屏解析与新增流程](themes/README.md)
- [Porcelain Day 完整 Token 合同](themes/porcelain-day.md)
- [Steel Night 完整 Token 合同](themes/steel-night.md)
- [新主题模板](themes/_template.md)

完整色值只在主题文档和生产 Token block 中维护。组件不得添加主题专属十六进制或按主题分叉
业务结构。

## 复杂组件

[复杂组件索引](components/README.md)路由以下稳定呈现合同：App Shell/统一侧栏、Camp 会话工作区、
首次训练、结构化 Mention、队员身份与图像，以及会话区附件拖放。Task、AgentRun、A2A、Recovery、权限、
持久化和事务语义仍须读取相关 ADR/Contract，不能从 UI 文档反向推导。

## 平台差异

- [Windows Interaction Delta](windows-interaction-delta.md)
- [Windows Interaction Delta HTML 评审稿](../prototypes/windows-interaction-delta/index.html)

平台文档只拥有 native frame、快捷键/文案、系统主题、文件系统反馈和平台准入等展示差异，不创建第二套
产品结构。HTML 是对规范的交互评审载体，不是生产组件或领域状态真源。

## 页面局部 Brief

Renderer 目标由 Impeccable 解析为 `apps/desktop` project root，因此受审查的局部策略位于
`apps/desktop/.impeccable/surfaces/`：

- [队员工作区](../../apps/desktop/.impeccable/surfaces/member-workspace.md)
- [记忆工作区](../../apps/desktop/.impeccable/surfaces/memory-workspace.md)
- [设置工作区](../../apps/desktop/.impeccable/surfaces/settings-workspace.md)
- [运行监控](../../apps/desktop/.impeccable/surfaces/runtime-monitoring.md)
- [创建新对话 Dialog](../../apps/desktop/.impeccable/surfaces/new-conversation-dialog.md)

brief 只拥有具体 surface 的信息优先级和构图；它不能覆盖全局设计、主题、ADR、Contract 或当前
版本范围。没有匹配 brief 时直接读取目标组件、测试和现有合同，不要创建空占位。

## QA 与验收

- [双主题覆盖矩阵](qa/theme-matrix.md)
- [无障碍基线](qa/accessibility.md)
- [桌面 UI 验收流程](../development/ui-acceptance.md)

文档状态不等于实现完成。当前范围与证据从[唯一 current 版本](../versions/README.md)进入；当前用户
注意力、Notification Episode 与类型化动作的当前实现证据见
[v0.71 实施计划](../versions/v0.71/implementation-plan.md)。生产事实仍由代码、Migration、测试和
可复现真实 App 验收证明。

## 权威边界

1. 有效 ADR、Architecture 和 Contract 决定领域、安全、持久化、Runtime 与可执行语义。
2. 当前版本文档决定本版本范围、进度和验收结论。
3. `DESIGN.md` 决定跨页面视觉系统；主题文档决定完整 Token；组件文档决定复杂呈现合同；
   surface brief 决定单一页面局部策略。
4. 生产代码与测试证明当前实现，不能静默覆盖已确认设计；设计文档也不能伪造实现完成。
5. 发现冲突时报告“文档—实现漂移”，指出双方、权威类型、缺失证据与本任务权限。

## Coding Agent 工作规则

- 保持 established visual world；除非用户明确要求重新设计，不进入 replacement-world 流程。
- 先读目标组件、`styles.css`、相关测试和本索引路由的最小文档集。
- Impeccable 是可选的 Provider 本地工具，不是仓库真源；安装/手动模式见
  [Coding Agent Impeccable 与 UI 文档工作流](../development/coding-agent-impeccable-ui-workflow.md)。
- 共享色值只扩展语义 Token；不引入新的 UI 框架、CSS-in-JS、字体、图标库、动画库或状态管理库。
- 变化后运行目标 Typecheck/Renderer 测试、构建和版本要求的真实 App 视觉/键盘验收。

## 历史设计

“Arctic Dawn”可在历史版本和原型中作为当时的设计名称保留，但不再是当前文件或路由。
历史会话事件样例已移入
[prototype archive](../prototypes/archive/arctic-dawn/README.md)，明确不具有生产权威。理解版本演进请从
[版本索引](../versions/README.md)进入；历史文档不能覆盖本索引或当前生产事实。
