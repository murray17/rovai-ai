---
document_type: production-design
version: v0.38
authority: renderer-ui-contract
status: frozen
last_updated: 2026-08-05
---

# v0.38 唯一实时 Task 卡生产设计

## 会话卡

每个 Task 在创建时间位置显示一张紧凑、可点击的 Task 卡。卡片沿用 Arctic Dawn 的会话
事件表面，只展示：

- 当前状态文字；
- 当前标题；
- 当前负责人，未分配时明确显示“未分配”。

卡片不显示描述、固定百分比、Runtime 计划、关联 Run 的受阻/失败状态或状态转换箭头。
状态必须同时使用文字和语义色，不能只靠颜色。

## 更新与终态

标题、负责人、`pending / in_progress / completed / cancelled` 任一变化都只更新原卡。
完成和取消不追加机械终态节点；Agent 的真实总结、Run 失败和 CampTurn 停止继续遵守既有
会话合同，不与 Task 卡合并。

更新不得把卡片移动到会话底部，不触发自动滚动，也不改变 Task 创建时间。点击卡片打开
Inspector“任务”页并聚焦当前 Task。

## 历史行为

历史 `task_event` 卡片从会话隐藏，同一 Task 只显示当前卡。数据本身不删除；任务面板和审计
继续提供当前详情与完整变更顺序。创建事件超出 Snapshot 审计窗口时仍按 Task `createdAt`
显示卡片，不能让较早 Task 消失。

## 无障碍与适配

整张卡是一个具有明确“打开任务”可访问名称的按钮，支持键盘聚焦和激活；Focus、Hover、
状态对比度与 1040×700 最小窗口继续使用现有 Arctic Dawn Token 和规则。
