---
document_type: version-overview
version: v1.45
lifecycle: historical
authority: version-scope-and-status
design_status: confirmed
implementation_status: complete
model_context_change: false
last_updated: 2026-09-05
---

# Rovai-ai v1.45：Composer 权威、Atom 与 Runtime 生命周期收口

前置：[v1.44](../v1.44/README.md)。后续：[v1.46](../v1.46/README.md)。本版本不改变 `ComposerDocument` V2、Core Draft wire、source attachment、
Reply/Continuation 或 exact-revision send 合同；它收敛 Renderer 内部的权威与高频编辑路径，消除多份完整 Draft
缓存、文本伪装 Atom 和 Typeahead 先取全文再截断的问题。本版本同时完成 v1.44 后续发现的 Pi 控制面与公共
Runtime Fleet 生命周期收口，不改变 Pi 已确认的原生化方向。

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
- Fleet 在 Reserve 后立即启动自身拥有的 Startup Operation；任意 acquire waiter 被取消都不会遗留 Starting。
  Stop 统一为短锁 Mark、锁外 reap、精确 Commit，同 Host 的并发停止共享 completion。
- Pi `abort` 使用正常 RPC correlation；managed receipt 与 Bootstrap 注入合并到 `before_agent_start`。旧 execution
  epoch 在任何清理前被拒绝，未映射的第三方 Extension UI 只被 cancelled/denied，不 poison Host。

## 保留边界

`ComposerDocument` 仍只有 Text + Atom，Core 不保存 Lexical JSON，`body` 仍从 document 派生。Core Draft revision、
Pending、附件 source refs、公开 Structured Content 映射和发送时身份校验均不改变，因此不创建新的 wire contract。
Composer 仍是结构化纯文本输入框，不引入 Rich Text、Markdown 或通用文档能力。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.44 冻结为 historical；本概览、[实施计划](implementation-plan.md)、版本索引与前后链接建立唯一 current v1.45 |
| Decisions | 已更新 | [D01](decisions.md#v1-45-d01)至[D03](decisions.md#v1-45-d03)记录 Composer 收口；[D04](decisions.md#v1-45-d04)与[D05](decisions.md#v1-45-d05)记录 Fleet operation ownership 和 Pi 最终 pre-agent/control boundary；CURRENT 已纳入导航 |
| Contracts | 已更新 | Composer wire 继续由 [Camp Composer Draft v8](../../contracts/camp-composer-draft-v8.md)拥有；[Runtime Launch and Verification v35](../../contracts/runtime-launch-and-verification-v35.md)替代 v34，定义 Pi correlation/receipt/epoch 与 Fleet operation lifecycle |
| Architecture | 已更新 | [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)同步 Composer；[Runtime 基础不变量](../../architecture/foundational-invariants.md#runtime-process-verification)与[Built-in Tool Runtime](../../architecture/builtin-tool-runtime.md#runtime-process-lease-and-camp-scope)同步 Runtime operation ownership与锁外 reap |
| UI | 已更新 | [结构化 Mention 与 Atom](../../ui/components/structured-mentions.md)同步真实 inline Atom、单监听器 Typeahead、NodeSelection Clipboard 与持久化失败反馈 |
| Runtime Activity | 确认无需更新 | Runtime 输入、活动归一、证据与执行台呈现均未变化 |
| Runtime compatibility | 确认无需更新 | Runtime 实测能力、版本、资格与冻结 evidence 均未改变；Pi 继续 Preview/NotQualified，兼容性证据文件保持原字节 |
| Documentation routing | 已更新 | 版本指针、Architecture/Contracts 索引、当前决定导航、Context 术语与 Runtime 任务入口均指向新的当前边界 |
| Root README | 确认无需更新 | 产品定位、安装与公开能力没有变化，Renderer 内部收口不属于根 README 范围 |

## References

- [实施与验收](implementation-plan.md)
- [版本决定](decisions.md)
- [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)
- [Camp Composer Draft v8](../../contracts/camp-composer-draft-v8.md)
- [结构化 Mention 与 Atom](../../ui/components/structured-mentions.md)
- [Runtime Launch and Verification v35](../../contracts/runtime-launch-and-verification-v35.md)
