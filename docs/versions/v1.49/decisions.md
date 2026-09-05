---
document_type: version-decisions
version: v1.49
lifecycle: current
last_updated: 2026-09-05
---

# v1.49 决定

<a id="v1-49-d01"></a>
## V1.49-D01：正常退出先复用 Camp Leave Guard，再启动 Planned Shutdown

### 背景

最新 Composer 正文只存在于 Renderer 的 Lexical EditorState，低频 autosave 不保证用户触发退出时最后一次编辑已成为
Core Draft。Planned Shutdown 一旦开始便关闭新的业务 request、execution 和 writer admission，因此在
`runtime.state = shutting_down` 之后再保存既太晚，也会把 Draft persistence 错误地耦合进 AgentRun/Runtime 关闭协议。
React cleanup 与 `beforeunload` 同样不能可靠等待附件、Draft queue 和 exact revision persistence。

### 决定

保留 Main 的唯一 `AppQuitCoordinator` 和 Renderer 的唯一 `CampLeaveGuard`。Main 阻止首个正常或更新 quit，在服务
drain 与 `core.shutdown()` 前通过私有一次性响应通道请求 Renderer；Renderer 只对精确匹配当前 view/Camp 的注册调用
guard，成功后 `complete(true)`。附件准备、Lexical flush、Coordinator idle、Core revision 与 Pending 收尾继续内聚在
guard，Main 不理解 Draft。准备失败终止本次 quit、保留 App/Core 和 Composer，并让后续 quit 重试；只有成功响应才
进入既有 Planned Shutdown。

### 后果与被拒绝方案

- 正常退出建立 `latest EditorState persisted -> Core shutdown` 的明确 happens-before；clean Draft 仍可 no-op。
- `runtime.state = shutting_down` 和现有 overlay 仍只表示 Planned Shutdown，不新增准备 UI 或退出状态。
- Windows/Linux 主窗口 close 必须在 Renderer 销毁前进入 coordinator；macOS 关窗不退出语义保持不变。
- 拒绝 Main 直接保存 Draft：它没有 Lexical、附件队列或 Coordinator authority。
- 拒绝 localStorage、新 Draft Store、`beforeunload`、新 Shutdown Coordinator 或 Composer 状态机：现有 guard 已拥有完整
  可等待的保存边界。
- 拒绝 Draft 保存失败后继续取消 AgentRun：这会在用户仍留在 App 时不可逆地关闭 Core 业务准入。
