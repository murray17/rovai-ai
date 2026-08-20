---
document_type: renderer-contract
contract: run-process-detail-surface-v15
authority: agent-process-detail-workspace-entry-and-primary-inspector-tab
status: accepted
last_updated: 2026-08-20
---

# Run Process Detail Surface v15（运行中 Camp 进入恢复）

本合同完整继承 [Run Process Detail Surface v14](run-process-detail-surface-v14.md) 的全局位置偏好、
唯一稳定 ExecutionDrawer、Agent 过程分组、Run stage、Evidence chronology、直接停止、完整 Tool 结果、
内部滚动与键盘语义。v15 只替代 workspace 进入时的 selection/disclosure 初始化，以及执行台位于
Inspector 时的 Tab 顺序。

## 1. 进入运行中 Camp

从另一个 Camp、其他一级页面或应用启动/恢复进入 Camp workspace 时，Renderer 必须使用本次权威
Camp open snapshot 检查 `AgentRun.status=running`：

- 没有 running Run 时保持普通进入行为，不自动打开执行台，也不显示 Inspector；
- 恰有一个 running Run 时，打开该 Agent 的同一个 ExecutionDrawer 并聚焦该精确 Run stage；
- 同时有多个 running Run 时，选择 `createdAt` 最新者，时间相同时按稳定 Run ID 降序决定；
- `queued`、`waiting`、`recovery_blocked` 和 terminal Run 不具备本次自动打开资格。

该 selection 仍是 workspace 局部瞬时状态，不写入 Main preferences、Camp、Core 或 SQLite。重新进入时从
当前权威 snapshot 重建，不是恢复旧 selection。执行台在底部时直接展开底部 Drawer；位置为
`inspector` 时，本次进入属于精确执行导航，必须显示 Inspector、激活“执行”并展开同一个 Drawer，
即使进入前 Inspector visibility 为 hidden。该显示沿用既有本机 visibility 状态，不改变全局 placement。

自动打开只改变呈现 selection，不把 DOM 键盘焦点移入 Tab、过程入口或 Drawer。用户进入后可以继续使用
当前导航或 Composer 焦点；Drawer 仍可按既有 live-follow 规则定位最新输出。

## 2. 不得由后台事件泛化触发

上述行为只发生在 Camp workspace 进入/重新挂载边界。用户已经停留在同一 workspace 时，后到的 Runtime
event、A2A、poll/refresh 或 Run 从 queued 变为 running 不得自动打开执行台、改选 Agent/Run、显示
Inspector 或移动焦点。显式用户发送回执、Task related execution、停止结果和世界地图入口继续遵守 v14
继承的精确导航规则。

## 3. Inspector Tab 顺序

默认底部 placement 时，Inspector 仍只有“任务 / 队员”。当 placement 为 `inspector` 时，Tab 的视觉、
DOM 与键盘顺序固定为“执行 / 任务 / 队员”，“执行”是第一个 Tab；移动到右侧、进入 running Camp 或
其他精确执行导航仍激活它。移回底部后“执行”从 DOM 移除，并恢复用户切换前最后使用的基础 Tab。

Tab 顺序变化不创建新的 surface、不复制过程列表，也不改变“任务”或“队员”的状态、内容与权限边界。

## 4. 验收

- Camp A 有 running Run、Camp B 无 running Run：B → A 后 A 自动展开最新 running Run，A → B 不自动展开；
- 从设置、队员或记忆页返回带 running Run 的 Camp 时得到相同行为；应用恢复到该 Camp 时亦相同；
- Inspector placement 且 visibility hidden 时进入带 running Run 的 Camp，Inspector 显示、“执行”激活、
  精确 Run 展开，placement 仍为 `inspector`；
- 自动打开前后的键盘焦点不进入执行台；同一 workspace 内新增后台 running Run 不触发自动切换；
- 多个 running Run 稳定选择最新 `createdAt + id`，只有 queued/waiting/terminal 时保持关闭；
- 右侧 Tab 顺序与键盘遍历均为“执行 / 任务 / 队员”，底部仍为“任务 / 队员”；
- v14 的位置写入、失败重试、唯一 Drawer DOM、Tool disclosure、停止、阅读位置与焦点返回语义全部保持。

## References

- [Run Process Detail Surface v14（历史）](run-process-detail-surface-v14.md)
- [产品/Renderer 基础不变量](../architecture/foundational-invariants.md#product-execution-surface)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [V1.15-D05](../versions/v1.15/decisions.md#v1-15-d05)
