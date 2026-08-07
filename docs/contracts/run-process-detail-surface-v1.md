---
document_type: renderer-contract
contract: run-process-detail-surface-v1
authority: scheme-c-run-detail-surface
status: accepted
last_updated: 2026-08-07
---

# Run Process Detail Surface v1（Scheme C）

本合同只约束现有 Arctic Dawn Camp 会话区中 Run 过程详情的层级和交互。视觉 Token、导航、
Composer、Approval、响应式和无障碍基础继续以 [Arctic Dawn V3](../ui/arctic-dawn.md) 为准。
HTML 仅是[会话区原型](../prototypes/run-activity/README.md)，不是数据或状态真源。

## 1. 三层会话区

```text
Camp Header
  └─ Run Pulse（常驻、摘要、可选择）
公共消息时间线
  └─ Execution Drawer（按需、过程详情、可收起）
Approval Dock（紧贴 Composer 上方）
Composer（发送 / 活跃 CampTurn 时 Stop）
```

Run Pulse 只展示正在运行/等待/最近终态的轻量摘要和数量；它不能替代 Canonical Runtime
Activity 或 Execution Evidence。用户点击某个 Run Pulse chip 可以选择 Drawer 展示的 Run，
但后台事件不得自动打开 Drawer、切换 selected Run、滚动会话或抢焦点。用户已经打开的终态
Run 保持 selected，直到用户主动关闭或切换。

Execution Drawer 是唯一的 Run 过程详情界面：显示 Run 状态、Delivery 关联、ContextManifest/
Runtime evidence 的安全摘要、等待原因、终态和恢复入口。它不提供 Run 级 Stop/Cancel；
Drawer 中只能查看、选择、展开证据或跳回对应公共消息。

## 2. Inspector 收敛

Inspector 删除“活动”页，不保留空白 Tab、旧 URL、无使用者 state 或 Activity 专属 IPC。
Inspector 只保留：

```text
任务 | 上下文 | 审批 | 审计
```

Canonical Runtime Activity/Execution Evidence 仍由 Core 持久并可重建，但只通过 Execution
Drawer（以及审计中的证据引用）呈现 Run 过程。任务、上下文、审批、审计各自继续读取既有
权威 Read Side，不复制 Drawer 的本地状态。

## 3. Stop 与 Approval layering

- 存在活跃 CampTurn 时，Composer 的发送位置切换为唯一 danger Stop；停止 fence 当前
  CampTurn 的整棵 AgentRun/Message Delivery 执行树；v0.45 不引入 Run 级 cancel protocol；
- Header、Run Pulse、Execution Drawer、Inspector 和公共消息卡不得渲染另一个 Stop；
- Approval Dock 立即位于 Composer 上方，保持非模态、可聚合和可键盘操作；Drawer 的底部
  不得覆盖 Dock。空间不足时 Drawer 退化为一行摘要/收起态，Approval Dock 保持可见；
- Stop 正在处理时仍保留草稿编辑和导航，防止重复请求；权威 CampTurn 状态返回后更新
  Run Pulse、Drawer 和消息区。

## 4. 可访问性与适配

- Run Pulse 使用 `button`/`list` 语义，selected Run 有可读名称、状态和 Delivery 数量；
- Drawer 使用有标题的 `region`，关闭/收起后焦点返回触发按钮；不使用 `aria-live` 逐字
  播报 Runtime 流式日志，只播报状态变化；
- Drawer、Approval Dock、Composer 的视觉顺序与 Tab 顺序一致，200% zoom 不遮挡 Stop、
  Approval 或 Composer；
- 目标宽度沿用现有断点：`1440×920` 基准、最小 `1040×700`；Inspector 关闭时公共时间线
  不被 Drawer 固定宽度挤出横向滚动；
- `prefers-reduced-motion` 下去除自动展开、滑入和脉冲动画，但保留文字/图标状态。

## 5. 数据边界

Run Pulse/Drawer 只消费 Core Snapshot、Canonical Runtime Activity、Execution Evidence、
Delivery Read Side 和 ContextManifest refs。原型中的 demo Agent、假运行时、布局切换
按钮、Activity Inspector、Run 级 Stop 和“自动打开”逻辑均不得进入生产 schema、IPC 或
领域命令。
