---
document_type: version-decisions
version: v1.47
lifecycle: current
last_updated: 2026-09-05
---

# v1.47 决定

<a id="v1-47-d01"></a>
## V1.47-D01：由 App 导航事件统一调用既有 Camp Leave Guard

### 背景

v1.46 已让 Camp-to-Camp 切换在卸载当前 Composer 前同步锁定、等待附件并 flush，但设置、记忆、队员和
移除当前 Project 等普通导航仍可直接改变 `view` 或清除 active Camp。React cleanup 不能被 await，因此不能保证
最后一个 Lexical EditorState 已成为 Core Draft authority。按目标页面分别复制保存逻辑又会让附件、Pending 和
revision 规则重新分叉。

### 决定

App 使用一个薄 `leaveActiveCamp(transition)` 入口，在当前 Camp Surface 存在匹配注册时先调用既有
`CampLeaveGuard`，成功后才执行 transition，并根据 Composer 是否实际卸载或替换完成 preparation。Camp-to-Camp
也复用该入口。`CampWorkspace` 继续独占交互锁、附件队列、Composer flush、Coordinator idle 和 Pending leave
settlement；App 不理解或复制这些 Draft 细节。没有实际卸载 Composer 的 Dialog/Project 展开动作不完成 leave。

### 后果与被拒绝方案

- 保存失败会留在当前 Camp，保留 Lexical 内容并恢复交互；clean Draft 不因导航增加 revision。
- transition 自身失败或未离开时以 `complete(false)` 解锁，成功卸载才使用 `complete(true)`。
- 拒绝在组件 cleanup 中异步 flush：卸载生命周期不能等待持久化完成。
- 拒绝 per-Camp Session Manager、后台 Draft Store 和 navigation state machine：现有 guard 已拥有完整准备边界，
  App 只需在线性用户事件中调用它。
