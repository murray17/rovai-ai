---
document_type: version-overview
version: v1.46
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-05
---

# Rovai-ai v1.46：Composer 事务边界与交互锁收口

前置：[v1.45](../v1.45/README.md)。本版本保留 Lexical、Text + Atom `ComposerDocument` V2、唯一
`DraftMutationCoordinator` 和 Core exact revision；只收紧 Core 正文回写、发送、Camp 切换、Draft 加载、
Typeahead Enter 与 autosave 投影边界，不引入 Session Manager、双缓冲或新的完整 Draft 缓存。

## 范围与当前状态

- Reply/Continuation 等路由 mutation 在同步锁定编辑器后 flush；Core 返回的完整 Draft 若改变 content，立即以
  authoritative replacement 回写 Lexical，不产生 autosave、undo 或新的 local version。
- 发送在第一个 `await` 前调用 Lexical imperative lock；等待附件队列、flush 并提交 exact revision。成功后读取
  下一 Draft 并替换编辑器，失败保留当前内容；发送期间不再接受“下一条消息”输入。
- 从一个已打开 Camp 切换到另一 Camp 前必须等待附件准备和 Draft flush；保存失败阻断切换并保留内容。React
  cleanup 不再发起关键异步保存。
- Draft read 明确区分 `loading | ready | error`；只有 Core 成功返回的 revision 0 才是空 Draft，读取失败时编辑、
  附件、路由和发送全部禁用，并提供重新加载入口。
- Typeahead 以 Lexical critical-priority command 同步重算当前 bounded trigger；Catalog loading 时消费 Enter，
  ready 且有候选时选择，当前 selection 没有有效候选时才让普通发送 command 继续。
- autosave 每轮只导出一个 `ComposerDocument`，使用线性直接比较；正文保存只更新 Coordinator 内部 authority，
  不刷新整个 Workspace。普通保存状态留在 Sync，只有错误/恢复向上投影；批量附件只 flush 一次。
- Composer 关闭浏览器拼写检查，继续保持结构化纯文本、IME、inline Atom、Clipboard 与历史边界。

## 保留边界

Core Draft wire 与 SQLite schema 不变；`body` 继续从 `ComposerDocument` 派生，Pending、source attachment、
Reply/Continuation 字段和公共 Structured Content 映射不变。Renderer 仍只有 `ComposerDraftSync` 与
`DraftMutationCoordinator` 两类同步对象，不增加 per-Camp 后台编辑 Session、CRDT、Worker、fingerprint、
generation A/B 或 React controlled editor。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.45 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.46 |
| Decisions | 已更新 | [V1.46-D01](decisions.md#v1-46-d01)记录同步交互锁、Core content 回写、加载 fail-closed 与拒绝复杂发送并发；CURRENT 已纳入导航 |
| Contracts | 已更新 | [Camp Composer Draft v9](../../contracts/camp-composer-draft-v9.md)替代 v8；wire 不变，明确路由/发送/导航/加载与 autosave transaction semantics |
| Architecture | 已更新 | [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)、[Camp Activation Lifecycle](../../architecture/camp-activation-lifecycle.md)和[Composer 基础不变量](../../architecture/foundational-invariants.md#camp-composer)同步唯一 authority、显式 replacement、交互锁、切换保存与错误边界 |
| UI | 已更新 | [结构化 Mention 与 Atom](../../ui/components/structured-mentions.md)及[Camp 会话工作区](../../ui/components/conversation-workspace.md)同步 Enter 优先级、加载重试、发送/路由锁定与导航保存反馈 |
| Runtime Activity | 确认无需更新 | Runtime 输入、Canonical Activity、证据和执行台投影均未变化 |
| Runtime compatibility | 确认无需更新 | Runtime 版本、能力、资格、平台证据和兼容性结论均未变化 |
| Documentation routing | 已更新 | 文档任务导航、Contracts 索引、版本指针和当前决定导航均指向 v9 / v1.46 当前边界 |
| Root README | 确认无需更新 | 产品定位、安装方式和公开能力范围未变化；本次是 Composer 已有能力的事务正确性与性能收口 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Camp Composer Draft v9](../../contracts/camp-composer-draft-v9.md)
- [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)
- [结构化 Mention 与 Atom](../../ui/components/structured-mentions.md)
- [Camp 会话工作区](../../ui/components/conversation-workspace.md)
