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
- macOS 红色关闭 / Cmd+W 同样等待既有 Renderer preparation，成功后只关闭窗口，失败保留窗口并允许重试；与
  Cmd+Q 重叠时共享当前窗口的 preparation，不增加 Draft 状态或新的 lifecycle coordinator。
- Draft preparation 失败时不停止服务、不启动 Core shutdown、不退出 App；当前 Camp、Lexical 内容和 Composer 交互
  保留，既有保存错误可见，下一次 quit 重新尝试。
- 成功后才执行现有 Planned Shutdown、AgentRun 取消/收口、Runtime 关闭和 `app.exit()`；Core protocol/report、
  `runtime.state = shutting_down` 与“正在安全退出” overlay 均不改变。
- 不增加 Draft Store、localStorage、Shutdown Coordinator、Composer 状态机或 `beforeunload` 保存逻辑。
- 维护者确认 Pi 已在 macOS arm64、macOS x64 与 Windows x64 分别完成目标主机验收并批准正式开放；三行各自
  绑定 immutable evidence revision 晋升为 `qualified`，成员与 Settings 不再显示“实验性/实验性开放”。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.48 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.49 |
| Decisions | 已更新 | [V1.49-D01](decisions.md#v1-49-d01)记录 App quit 复用 Camp leave guard；[V1.49-D02](decisions.md#v1-49-d02)记录 Pi 三平台独立验收后的正式准入；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Camp Composer Draft v12](../../contracts/camp-composer-draft-v12.md)、[Planned Shutdown v6](../../contracts/planned-shutdown-v6.md)和[App Update v2](../../contracts/app-update-v2.md)冻结退出顺序；[Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)同步 Pi 三平台 qualified 行 |
| Architecture | 已更新 | Composer Draft、Planned Shutdown、Desktop App Updates、Runtime Catalog、基础不变量及 Architecture 索引同步当前职责、准入和 happens-before |
| UI | 已更新 | App Shell、Camp 会话区和 UI acceptance 同步退出体验；队员与 Settings surface brief 同步 Pi 正式展示并移除实验性披露 |
| Runtime Activity | 确认无需更新 | Runtime 输入、Canonical Activity、证据分类和执行台映射均未变化 |
| Runtime compatibility | 已更新 | 兼容性清单与三份 adapter-scoped artifact 记录 Pi 三平台发布确认；既有 Unsupported/hidden 能力不变 |
| Documentation routing | 已更新 | 文档任务导航、Contracts 索引、版本指针和当前决定导航均指向退出合同与 Pi 当前准入边界 |
| Root README | 已更新 | Runtime 表移除 Pi 的 experimental preview 标注，其他能力列保持不变 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime Platform Admission v2](../../contracts/runtime-platform-admission-v2.md)
- [Camp Composer Draft v12](../../contracts/camp-composer-draft-v12.md)
- [Planned Shutdown v6](../../contracts/planned-shutdown-v6.md)
- [App Update v2](../../contracts/app-update-v2.md)
- [Composer Draft 架构](../../architecture/camp-composer-draft.md)
- [Planned Shutdown 架构](../../architecture/planned-shutdown.md)
