---
document_type: version-overview
version: v1.49
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-05
---

# Rovai-ai v1.49：正常退出前 Composer Draft Fence

前置：[v1.48](../v1.48/README.md)。本版本保留 `AppQuitCoordinator`、`CampLeaveGuard`、Lexical、
`ComposerDraftSync`、唯一 `DraftMutationCoordinator`、Core exact revision 和 Planned Shutdown v3 wire；只在正常
退出的 Renderer 与 Core shutdown 之间增加一道 Draft preparation fence。

## 范围与当前状态

- Main 的既有 quit coordinator 在任何服务 drain 或 `core.shutdown()` 前，以一次性响应通道请求当前 Renderer 准备
  退出；重复 quit 继续合并为同一轮。
- Renderer 只检查 live view、active Camp ID 和匹配注册，存在 active Camp 时复用现有 `CampLeaveGuard`；附件等待、
  最新 Lexical flush、Draft queue idle、Core revision 与 Pending 收尾仍全部由 guard 拥有。
- Windows/Linux 主窗口关闭在 Renderer 销毁前进入同一 coordinator；macOS 保留关窗不退出语义，Quit 与已接受更新
  继续通过 `before-quit`。
- Draft preparation 失败时不停止服务、不启动 Core shutdown、不退出 App；当前 Camp、Lexical 内容和 Composer 交互
  保留，既有保存错误可见，下一次 quit 重新尝试。
- 成功后才执行现有 Planned Shutdown、AgentRun 取消/收口、Runtime 关闭和 `app.exit()`；Core protocol/report、
  `runtime.state = shutting_down` 与“正在安全退出” overlay 均不改变。
- 不增加 Draft Store、localStorage、Shutdown Coordinator、Composer 状态机或 `beforeunload` 保存逻辑。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.48 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.49 |
| Decisions | 已更新 | [V1.49-D01](decisions.md#v1-49-d01)记录 App quit 复用 Camp leave guard 且失败不启动 Planned Shutdown；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Camp Composer Draft v11](../../contracts/camp-composer-draft-v11.md)、[Planned Shutdown v6](../../contracts/planned-shutdown-v6.md)和[App Update v2](../../contracts/app-update-v2.md)冻结正常/更新退出的准备、失败与顺序；Core wire 不变 |
| Architecture | 已更新 | Composer Draft、Planned Shutdown、Desktop App Updates、基础不变量及 Architecture 索引同步 Main/Renderer/Core 职责和 happens-before |
| UI | 已更新 | App Shell、Camp 会话区和 UI acceptance 同步“准备阶段只锁 Composer、失败留在 Camp、shutdown overlay 不变” |
| Runtime Activity | 确认无需更新 | Runtime 输入、Canonical Activity、证据分类和执行台映射均未变化 |
| Runtime compatibility | 确认无需更新 | Runtime 版本、能力、资格、进程协议和平台兼容结论均未变化 |
| Documentation routing | 已更新 | 文档任务导航、Contracts 索引、版本指针和当前决定导航均指向 v11 / v6 / App Update v2 当前边界 |
| Root README | 确认无需更新 | 项目定位、安装方式与公开功能范围不变；本次只收紧既有正常退出的持久化顺序 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Camp Composer Draft v11](../../contracts/camp-composer-draft-v11.md)
- [Planned Shutdown v6](../../contracts/planned-shutdown-v6.md)
- [App Update v2](../../contracts/app-update-v2.md)
- [Composer Draft 架构](../../architecture/camp-composer-draft.md)
- [Planned Shutdown 架构](../../architecture/planned-shutdown.md)
