---
document_type: production-design
version: v0.26
authority: version-design
status: frozen
last_updated: 2026-07-31
---

# v0.26 Member Runtime Parameters 生产设计

## 会话表面 v3 补充

- Camp Header 在状态摘要右侧提供 Inspector 按钮。展开态使用选中样式与实心右栏
  图标，隐藏态使用中性样式与虚线右栏图标；`aria-pressed`、名称和提示同步。
- Inspector 默认展开并用 Renderer 本机偏好记忆。隐藏后 `workspace-grid` 只保留
  会话列，Inspector 不保留 rail、Drawer 或可访问残影。
- Run 与审批摘要改为按钮；点击分别恢复并打开“活动”或“审批”。Inspector Tab
  选择留在 App 会话状态，不改变 Camp 或滚动位置。
- `CampTurn.status=cancelled` 且存在 `cancelRequestedAt` 时投影唯一停止事件。排序优先
  使用匹配 `camp_turn.cancel_requested` 事件序列，耗时由 `createdAt` 到请求时间
  计算；任一所属 Run 有未确认效果时显示“结果待确认”并可打开“活动”。
- 用户、Agent 与已交付 A2A 消息用正文 `message-surface` 包裹正文、复制图标和
  “已复制”反馈；元数据行不再承载复制操作。
- 时间线与 Composer 共用 790px 最大轨道。队员与记忆页增加同一 AppHeader，
  但保留当前生产 Workbench，不采用原型中的演示内容和旧响应式侧栏。

## 页面结构

“运行配置”继续只展示 Product Runtime 和真实可用性。在运行时摘要下增加
`<details>` 形式的“运行参数”，默认收起；选择 Runtime 后才显示。折叠区与
“高级设置”是两个独立区域，前者属于队员执行配置，后者继续只承载 Camp 共享摘要模型。

表单只显示“保存运行时”，用于提交 Product Runtime、模型和权限草稿；不显示
“放弃更改”或独立清除按钮。已选择 Runtime 时，按钮在保存完成后保持可用；请求期间
禁用并显示“正在保存…”，成功后恢复并显示 Toast。选择“不选择 Agent 运行时”后保存
即清空配置。切换 Runtime 立即在本地丢弃旧草稿并载入新 Runtime 默认值，但保存成功
前不改变数据库。无 ready snapshot 时折叠区显示普通说明，不虚构模型或权限。

Runtime 保存与清除只同步提交成员配置和排队必要检查；Skill 投影通过 Core 后台通知
执行，不阻塞保存响应。AgentRun 启动边界仍执行自身的投影准备，因此后台刷新不削弱
冻结或准入保证。

页面打开立即读取 Core 最近缓存。所选 Runtime 缺少结果或结果过期时只发送后台
`ensure`，切换 Runtime 时异步请求一次检查；两者都不阻塞表单。保存按钮只显示
“正在保存…”，Core 在当前 Snapshot 上事务校验，不在保存请求中运行 Discovery、
CLI 深度探测或完整 fingerprint。

Runtime 摘要行显示产品名、一个主状态和版本；需要处理时再显示一条次级原因与
“前往 Agent 运行时”。主状态固定为“正在检查… / 可用 / 需要登录 / 未安装 / 版本不支持 /
不可用 / 暂时无法确认”，未选择时为“未配置 Agent 运行时”。不显示队员区顶部第二条
Readiness 警告，也不把“已找到”“尚未检查”“已检查”放入选项或摘要。

## 模型交互

- “模型策略”包含“跟随 Runtime 默认”和“固定模型”。
- 跟随默认时隐藏模型选择与全部模型参数。
- 固定模型只列出 snapshot 中未隐藏、未废弃且不是 synthetic runtime-default 的模型。
- 选择模型后，只显示对应 Runtime 认识且该模型实际报告的参数。
- 参数没有 Runtime 默认值时提供“跟随模型默认值”，保存时不写该 option。
- 已保存但失效的值以普通失效选项显示，用户必须重新选择后才能保存。

## Runtime 专用字段

| Runtime | 控件 |
|---|---|
| Codex CLI | 模型；推理强度；文件系统访问；审批策略 |
| OpenCode | 模型；可选推理强度；工具权限 |
| GitHub Copilot CLI | 模型；可选推理强度；“自动允许全部操作”开关 |
| Claude Code | 模型；思考强度；权限模式 |
| Kiro CLI | 模型策略与模型 |
| Qoder CLI | 能力存在时的模型/推理强度；权限模式 |
| CodeBuddy | 能力存在时的模型/推理强度；权限模式 |
| Qwen Code | 能力存在时的模型/推理强度；审批模式 |
| Antigravity | 模型；执行模式；终端沙箱；“自动通过权限请求”开关 |

所有原生值原样保存。特别是 CodeBuddy 的 `bypassPermissions` 与 Qoder 的
`bypass_permissions` 不共享转换逻辑。

## 数据与校验

```mermaid
flowchart LR
  T["Startup / Discovery / Selection / Expiry"] --> B["Core background check queue"]
  B --> S["Cached Adapter Capability Snapshot"]
  S --> C["Core Adapter defaults/schema"]
  C --> D["Runtime-specific Renderer draft"]
  D --> V["Version-checked atomic save"]
  V --> P["Member Runtime Configuration"]
  P --> F["Frozen Run Runtime Configuration"]
  F --> L["Lightweight launch confirmation"]
```

- Core 返回基于当前 snapshot 校验过的队员默认配置。
- Renderer 只渲染专用组件认识的字段。
- Core 在事务中重新读取 ready Managed Default Installation 和 snapshot。
- 模型与权限必须同时通过；失败不修改任何持久队员字段。
- Runtime 未就绪且草稿不含模型/权限时，只保存 `AdapterKind`。
- 后台探测只更新 Installation/snapshot，不完成队员配置。
- 同一 Product Runtime 的后台检查去重；仍可用的成功 Snapshot 在刷新期间继续投影
  “可用”，失败作为次级说明。
- Runtime 文件身份变化在执行边界阻止启动并排队后台修复，不撤回用户消息。

## 状态与可访问性

- 折叠按钮可键盘操作并具有明确“运行参数”名称。
- 下拉框和开关都使用普通 Arctic Dawn 表单样式，不显示风险等级。
- 所有用户状态使用文字与状态点，不只依赖颜色；内部 Discovery/Probe/Snapshot 阶段
  不作为主状态。
- 提交期间禁用整个 Runtime 表单；失败保留本地草稿和焦点。
- 普通页面不渲染 Installation ID、路径、fingerprint、auth scope 或探测详情。
