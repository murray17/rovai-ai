---
document_type: version-overview
version: v1.47
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-09-05
---

# Rovai-ai v1.47：Camp Draft 统一离开保护

前置：[v1.46](../v1.46/README.md)。本版本保留 Lexical、`ComposerDraftSync`、唯一
`DraftMutationCoordinator`、Core exact revision 和现有 `CampLeaveGuard`；只把该 guard 从 Camp-to-Camp
切换扩展到所有真正卸载当前 Camp Composer 的普通 Renderer 导航。

## 范围与当前状态

- App 提供单一薄 `leaveActiveCamp()` 入口：当前没有已挂载 Camp Composer 时直接执行 transition；存在匹配 guard
  时先 prepare，成功后才 transition，并按实际是否离开调用 `complete(true | false)`。
- Camp→Camp、Camp→设置、记忆、队员，以及移除当前 Project 后返回快速对话，共用同一个 guard；新建会话在真正
  激活新 Camp 的时刻复用 Camp→Camp 路径，单纯打开创建 Dialog 或展开 Project 分组不伪装成 Composer 卸载。
- guard 继续由 `CampWorkspace` 拥有：同步锁定 Composer，等待附件准备，flush 最新 Lexical EditorState，等待
  Coordinator queue，并保留 Pending Camp 离开收尾。
- flush 或 guard preparation 失败时不执行导航、不卸载、不清空 Lexical，并恢复交互；transition 自身失败以
  `didLeave = false` 收尾。
- 已保存 Draft 只等待现有 mutation idle，不为了导航额外增加 revision；React cleanup 仍只销毁本地 Sync/runtime。
- 不增加 Draft Store、Session Manager、后台 Session、双缓冲、navigation state machine 或新的持久化层。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.46 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.47 |
| Decisions | 已更新 | [V1.47-D01](decisions.md#v1-47-d01)记录 App 事件边界统一调用既有 leave guard、拒绝 cleanup 保存与新导航状态机；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Camp Composer Draft v10](../../contracts/camp-composer-draft-v10.md)替代 v9；wire 不变，只扩展 active-Camp leave transaction 边界 |
| Architecture | 已更新 | [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)、[Camp Activation Lifecycle](../../architecture/camp-activation-lifecycle.md)和[Composer 基础不变量](../../architecture/foundational-invariants.md#camp-composer)同步统一离开边界 |
| UI | 已更新 | [App Shell 与统一侧栏](../../ui/components/app-shell-navigation.md)、[Camp 会话工作区](../../ui/components/conversation-workspace.md)及[结构化 Mention 与 Atom](../../ui/components/structured-mentions.md)同步保存失败阻断和无卸载不误判规则 |
| Runtime Activity | 确认无需更新 | Runtime 输入、Canonical Activity、证据和执行台投影均未变化 |
| Runtime compatibility | 确认无需更新 | Runtime 版本、能力、资格、平台证据和兼容性结论均未变化 |
| Documentation routing | 已更新 | 文档任务导航、Contracts 索引、版本指针和当前决定导航均指向 v10 / v1.47 当前边界 |
| Root README | 确认无需更新 | 产品定位、安装方式和公开能力范围未变化；本次仅收紧既有 Composer 的导航持久化边界 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Camp Composer Draft v10](../../contracts/camp-composer-draft-v10.md)
- [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)
- [App Shell 与统一侧栏](../../ui/components/app-shell-navigation.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
