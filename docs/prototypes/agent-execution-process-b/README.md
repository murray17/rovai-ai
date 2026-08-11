# Agent 级执行过程 · B 底部执行台设计稿

打开 [`index.html`](./index.html) 查看可点击静态稿，或在仓库根目录运行：

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory docs/prototypes/agent-execution-process-b
```

然后访问 `http://127.0.0.1:4173/`。

## 这版展示什么

- B 方案不在会话顶部渲染 RunPulse 或其他执行入口。
- Composer 上方的底部执行台是唯一执行入口；沐瓦、洛可、若汐各只有一个 `(Camp, Agent)` pill。
- 展开执行台后，在 Composer 上方呈现同一个 Agent 的连续过程。
- 多个底层 AgentRun 作为时间段/证据事实保留在同一轨道里，不提供 Run 级切换。
- 面板内不展示“当前责任 / 状态 / purpose 业务标题 / 预期交付”，只展示可追溯的 Run 边界、投递和证据。
- 每次点击 Agent，最新 running Run 优先被定位并自动展开证据；没有 running 时定位最新 queued/waiting Run。
- running、已完成、失败/取消的过程都能重新打开；关闭不清除历史。
- 消息下不再出现“打开执行过程 / 复制 / 定位”文字操作；复制按 main 改为右侧 hover/focus 才出现的小图标。
- 会话中的 Task 固定采用与 main 一致的紧凑双行卡，不展示 description 或 Criteria，只展示状态、标题、负责人。
- Task 的关联执行只显示一个 Agent 级入口。
- Inspector 只保留“任务 / 上下文投递 / 审批”，审计 Tab 已删除。

这是静态设计稿，不连接 Core、IPC 或真实运行时；按钮只改变本地视觉状态。生产实现仍需在现有 Renderer 中复用真实 snapshot 和持久化证据。

本期没有改动侧栏“队员 / 长期事项”、当前队员列表、Camp 顶栏、Composer、Approval Dock 或 Task Inspector 详情；它们只用于保留完整会话上下文。

底部执行台每一类内容的真实来源、缺失能力与降级规则见 [`DATA_SOURCES.md`](./DATA_SOURCES.md)。
