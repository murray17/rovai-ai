---
document_type: renderer-contract
contract: run-process-detail-surface-v16
authority: agent-process-detail-team-first-inspector-tabs
status: accepted
last_updated: 2026-08-20
---

# Run Process Detail Surface v16（队员优先的 Inspector 页签）

本合同完整继承 [Run Process Detail Surface v15](run-process-detail-surface-v15.md) 的运行中 Camp
进入恢复、全局位置偏好、唯一稳定 ExecutionDrawer、Agent 过程分组、Run stage、Evidence chronology、
直接停止、完整 Tool 结果、内部滚动与键盘语义。v16 只替代 Inspector 的基础 Tab 顺序。

## 1. Inspector Tab 顺序

默认底部 placement 时，Inspector 的 DOM、视觉与键盘顺序固定为“队员 / 任务”。当 placement 为
`inspector` 时，条件式“执行”仍是第一个 Tab，完整顺序固定为“执行 / 队员 / 任务”。移动到右侧、
进入 running Camp 或其他精确执行导航仍激活“执行”；移回底部后“执行”从 DOM 移除，并恢复用户
切换前最后使用的基础 Tab。

重排不改变当前激活 Tab、Task/队员内容、Default Lead、执行 selection、Inspector visibility、
Draft 或权限边界，也不创建新的 surface。视觉顺序、DOM 顺序和键盘遍历必须始终一致。

## 2. 验收

- 底部 placement 的普通 Inspector 只包含“队员 / 任务”，队员位于任务之前；
- 右侧 placement 的 Inspector 顺序为“执行 / 队员 / 任务”，“执行”仍唯一且处于首位；
- 在“队员”和“任务”之间切换后移动执行台，移回底部时恢复此前选中的基础 Tab；
- v15 的进入恢复、位置写入、失败重试、唯一 Drawer DOM、Tool disclosure、停止、阅读位置与焦点返回
  语义全部保持。

## References

- [Run Process Detail Surface v15（历史）](run-process-detail-surface-v15.md)
- [产品/Renderer 基础不变量](../architecture/foundational-invariants.md#product-execution-surface)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
