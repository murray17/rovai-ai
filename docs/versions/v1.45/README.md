---
document_type: version-overview
version: v1.45
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-04
---

# Rovai-ai v1.45：Composer 权威、Atom 与查询边界收口

前置：[v1.44](../v1.44/README.md)。本版本不改变 `ComposerDocument` V2、Core Draft wire、source attachment、
Reply/Continuation 或 exact-revision send 合同；它收敛 Renderer 内部的权威与高频编辑路径，消除多份完整 Draft
缓存、文本伪装 Atom 和 Typeahead 先取全文再截断的问题。

## 范围与当前状态

- `DraftMutationCoordinator` 是 Renderer 唯一完整 `CampComposerDraftView` owner；正文、附件、Reply、
  Continuation 与接收者修改进入同一队列，每次只从当前 Draft 读取 `expectedRevision`，成功回执原子替换 authority。
- `ComposerDraftSync` 只保留 EditorState、epoch、local/saved version、dirty 与持久化状态；flush 等待 Draft 队列、
  按需保存捕获快照，并在完成后读取 Coordinator 当前 Draft。自动保存失败保持 dirty、显示 error，并在当前 epoch
  内有限退避重试；显式 flush 不吞错。
- 发送冻结一个 local version，flush 后只使用 Coordinator 返回的 exact revision；发送过程中出现的新本地版本不会
  被成功回执清空，并在下一 Draft epoch 继续保存。
- `ComposerAtomNode` 改为 identity-only inline `DecoratorNode<null>`。Catalog 只更新一个不可编辑 span 的展示，
  不改变节点字符长度、领域内容、local version、Draft revision 或 history。
- `@` 与 `/` 共用一个 React Typeahead 插件和一个 Editor update listener；扫描只为当前普通 TextNode 的光标左侧
  分配最多 128 字符，不跨 Atom、LineBreak 或 Paragraph，IME 期间暂停。

## 保留边界

`ComposerDocument` 仍只有 Text + Atom，Core 不保存 Lexical JSON，`body` 仍从 document 派生。Core Draft revision、
Pending、附件 source refs、公开 Structured Content 映射和发送时身份校验均不改变，因此不创建新的 wire contract。
Composer 仍是结构化纯文本输入框，不引入 Rich Text、Markdown 或通用文档能力。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.44 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.45 |
| Decisions | 已更新 | [V1.45-D01](decisions.md#v1-45-d01)、[V1.45-D02](decisions.md#v1-45-d02)与[V1.45-D03](decisions.md#v1-45-d03)分别记录 Draft authority、Decorator Atom 与源头有界统一 Trigger；CURRENT 已纳入导航 |
| Contracts | 确认无需更新 | `ComposerDocument` V2、`CampComposerDraftView`、Core command、revision、Pending 与 send wire shape/错误/幂等语义均未改变；当前 [Camp Composer Draft v8](../../contracts/camp-composer-draft-v8.md)继续适用 |
| Architecture | 已更新 | [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)与架构索引同步 Coordinator、epoch、失败恢复、Decorator 与统一 Trigger 的组件职责 |
| UI | 已更新 | [结构化 Mention 与 Atom](../../ui/components/structured-mentions.md)同步真实 inline Atom、单监听器 Typeahead、NodeSelection Clipboard 与持久化失败反馈 |
| Runtime Activity | 确认无需更新 | Runtime 输入、活动归一、证据与执行台呈现均未变化 |
| Runtime compatibility | 确认无需更新 | Runtime adapter、版本、能力、资格与兼容性均未变化 |
| Documentation routing | 已更新 | 版本指针、Architecture 索引、当前决定导航和 Context 术语已指向新的当前边界；任务入口路径不变 |
| Root README | 确认无需更新 | 产品定位、安装与公开能力没有变化，Renderer 内部收口不属于根 README 范围 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)
- [Camp Composer Draft v8](../../contracts/camp-composer-draft-v8.md)
- [结构化 Mention 与 Atom](../../ui/components/structured-mentions.md)
