---
document_type: renderer-contract
contract: run-process-detail-surface-v14
authority: agent-process-detail-global-placement-and-complete-tool-result-surface
status: accepted
last_updated: 2026-08-20
---

# Run Process Detail Surface v14（全局执行台位置偏好）

本合同完整继承 [Run Process Detail Surface v13](run-process-detail-surface-v13.md) 的单一稳定
ExecutionDrawer、Agent 过程分组、Run stage、Evidence chronology、直接停止、Tool 行、完整公开结果、
内部滚动与键盘语义。v14 只替代 v6 延续至 v13 的 mounted-workspace 瞬时 placement 生命周期：执行台
位置成为 Main-owned 的本机安装级偏好，但仍不是 Camp、AgentRun、Core 或 SQLite 领域事实。

## 1. 偏好字段与生命周期

`GeneralPreferencesSnapshot` 增加以下字段并推进自身 schema：

```text
schemaVersion: 3
executionConsolePlacement: bottom | inspector
```

Main 的 `GeneralPreferencesStore` 是该字段的唯一持久权威。最后一次**成功**的用户显式位置选择同时决定
当前执行台位置，以及此后打开的所有 Camp workspace 的初始位置；该偏好跨 Camp、页面切换和应用重启，
但不云同步、不写入 Core/SQLite，也不随 Camp 导出、删除或恢复。

旧 `GeneralPreferences` v1/v2、字段缺失或无法识别的位置值统一解析为 `bottom`。迁移只补这个默认值并
保留仍可识别的其他通用偏好；不从历史 Camp、Renderer state、Inspector 可见性或窗口尺寸推断位置，
也不提供 downgrade reader。

## 2. 唯一写入口与提交语义

底部的“移到右侧”和 Inspector 的“移回底部”是唯一普通写入口；Settings 不增加“默认位置”或第二个
同权控件。控件的辅助名称应说明应用会记住位置，但成功不需要重复 Toast。

一次显式切换按以下顺序执行：

1. Renderer 提交 `setExecutionConsolePlacement(target)`，按钮进入 pending 并拒绝重复提交；
2. Main 沿用 General Preferences 的串行队列、临时文件与原子替换，只有写入成功才更新内存 snapshot；
3. Renderer 只接受返回 snapshot 中的权威位置，再移动 v13 定义的同一个已挂载 Drawer DOM；
4. 写入失败时执行台留在原位置，旧 snapshot 继续生效，控件附近显示可重试错误。

不得先乐观移动再回弹，也不得让 Camp、运行状态、窗口宽度、后台事件或恢复逻辑自动改写该偏好。

## 3. 启动与 Workspace 挂载

恢复或打开 Camp 前，Renderer 必须先取得权威 General Preferences；Camp workspace 不得先以 `bottom`
挂载后再跳到 `inspector`。没有可用偏好时使用已经解析的 `bottom` 默认，而不是阻塞为未知位置。

切换 Camp、离开再返回 Camp 页面或重启应用只重建 workspace 局部状态，不重置 placement。Agent/Run
selection、Drawer 开合、已读 Tool 全文和滚动位置仍遵守 v13 的 workspace/Drawer 生命周期，不因全局
placement 而跨 Camp 持久化。

## 4. 与 Inspector 可见性的组合

`executionConsolePlacement` 与既有 Inspector visibility 是两项独立的本机展示偏好：

- `placement=inspector` 且 Inspector hidden 时，执行台仍归 Inspector，只是随整个 Inspector 不可见；
- Header 恢复 Inspector 后继续显示保留的“执行”Tab 与当前 workspace 内的 Agent/Run 上下文；
- 用户在底部显式选择“移到右侧”时，写入成功后必须同时显示 Inspector、激活“执行”并移动 Drawer；
- Task related execution、停止结果和世界地图等既有精确导航仍可显示 Inspector、激活“执行”并定位 Run；
- 普通 Camp 切换、应用恢复、后台 Runtime/A2A 事件不得仅因全局 placement 自动显示 Inspector。

Renderer 不得在 Inspector hidden 时临时把执行台投到底部，也不得通过进入新 Camp 强制覆盖用户刚作出的
隐藏选择。Header Inspector 显隐控件必须始终可发现、可键盘到达并有明确名称。

## 5. 验收

- 全新偏好、v1/v2 偏好与缺失位置字段均从 `bottom` 开始，其他可识别通用偏好保持；
- 显式移到 Inspector 后，切换 Camp、进入其他一级页面再返回和完整应用重启都仍从 Inspector 承载；
- 再显式移回底部后，相同导航与重启矩阵都从底部承载；任一 Camp 都不拥有独立 override；
- 写入 pending 时不能重复提交；注入原子写失败后位置与旧 snapshot 均不变，原位错误可重试；
- 恢复 `inspector` 偏好时首个 Camp meaningful paint 不出现 bottom→inspector 闪跳；
- Inspector hidden 与 inspector placement 可同时成立；Header 恢复、显式移动和精确执行导航分别满足第 4 节；
- v13 的唯一 Drawer DOM、selection/disclosure、按需完整 Tool 结果、焦点和阅读位置语义全部保持。

## References

- [Run Process Detail Surface v13（历史）](run-process-detail-surface-v13.md)
- [产品/Renderer 基础不变量](../architecture/foundational-invariants.md#product-execution-surface)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [V1.15-D05](../versions/v1.15/decisions.md#v1-15-d05)
