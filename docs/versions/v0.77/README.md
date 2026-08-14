---
document_type: version-overview
version: v0.77
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-14
---

# Rovai-ai v0.77：持久消息回复链与显式接收者修复

> 当前状态：用户已确认的方案 C（轻量无框）已完成实现与发布验收。Composer 与时间线父引用
> 均为无框单行省略；鼠标点击“回复”聚焦编辑器但不增加输入框、描边或光晕，键盘路径保留局部
> `focus-visible`。Core Draft schema/mutation、Draft-only send、IPC、Renderer、迁移、文档与真实打包 App 验收全部闭环。
>
> 前置版本：[v0.76 显示名 Inline Alias 行首寻址门禁](../v0.76/README.md)
>
> 后续版本：[v0.78 完整 Exact-Scope Memory View 与 Copyable Target](../v0.78/README.md)

## 版本目标

让用户在 Camp 公共时间线点击一条消息后，既能保留明确父引用，又能看清真正由谁接收执行，减少忘记
`@` 后误交 Default Lead 的情况。引用回答“在回应什么”，Structured Mention 回答“交给谁执行”；两者
保持正交，但“回复一个当前可接收 Agent”这一显式用户手势可以在同一 Core Draft revision 中同时建立
引用和可见 Mention。

本版本必须守住危险边界：原作者已退出 Camp、变为 `away` 或被移除时，引用可以保留，但不能插入失效
Mention 后悄悄回退 Default Lead。Composer 原位显示“原作者当前不可接收，请选择其他成员”，并在用户
显式换人前阻止发送。

## 交付范围

### Core-owned durable reply intent

- `CampComposerDraftView` 增加持久 reply intent，Core Draft 保存同 Camp reply target 与显式换人
  requirement，并与 content、附件共享 revision、expiry、导航/重启恢复和 accepted 后消费；
- 新增 start/cancel/resolve reply Draft mutation。点击可用 Agent 时原子插入或复用 canonical Member
  Mention；点击失效 Agent 时只保留引用并持久化 requirement；
- user send 参数删除临时 `replyToCampMessageId`，只提交 exact Draft revision。Core 从 Draft 同时读取
  content、附件和 reply intent，避免第二份真源；
- migration 保留现有 Draft，并把旧记录投影为 `replyIntent=null`。

### Reply 与 recipient interaction

- 稳定 user/agent 消息在内容列右上角增加“回复”；optimistic message 在取得稳定 ID 前不可回复；
- Composer 显示一层 reply dock，父消息作者与有界摘要共用一个可视行，超出显示省略号；关闭 dock
  只取消引用，不删除可见 Mention；
- 回复 Agent 当前可用时插入原子 Mention，并始终展示完整 fanout；已有其他 Mention 或
  `@所有队员` 时不隐藏实际接收者；
- 回复当前用户消息只建立引用，不从历史收件人或 reply relation 猜 Agent；无 Mention 时明确显示
  `Default Lead · {name}`；
- accepted 消息在正文前显示一层紧凑父引用，点击精确定位同 Camp 原消息；不创建嵌套私密 thread。

### Unavailable author and race-safe rejection

- 点击时已失效：不写失效 Mention，保留引用，显示显式替代成员选择并阻断发送；
- 点击后失效：Core 继续以 `mention_target_unavailable` 原子拒绝；Renderer 保留正文、附件、引用与错误，
  显式 replace 后才允许重试；
- `reply_recipient_required`、`mention_target_unavailable` 和 `camp_message.invalid_reply` 都不得创建消息、
  Turn、Run、Delivery 或改投 Default Lead；
- Renderer 预检只提前暴露 Core 的同一结论，不能成为最终 admission authority。

## 已选交互方向

[HTML 交互稿](../../prototypes/message-reply-chain/README.md)保留三个共享同一状态机的布局方向；用户已选择
方案 C 作为生产方向：

1. **平衡型：** Composer 与时间线父引用固定为单行，超出显示省略号；正常回复一步完成，
   只有异常时展开修复；
2. **接收者优先：** 接收者选择始终可见，最稳妥但占用更多 Composer 高度；
3. **轻量无框（已确认）：** 去掉正常引用的独立边框、底色和阴影，作者与摘要仍保持单行省略，
   危险状态仍完整展开。

Renderer 实现以已确认的轻量无框型为唯一生产基线；其余两项只保留为设计对照。点击回复后编辑器照常
获得插入光标，但鼠标触发不得改变 Composer 边框或阴影；键盘焦点提示仍须可见。该视觉选择不改变
Core 合同或安全状态机，失效作者错误与替代成员选择仍可独立扩展为多行。

## 非目标与冻结边界

- 不建立 Slack 式私密 thread、树形缩进、递归祖先展开或独立 Conversation；
- 不从 reply author、历史 recipient、正文普通文本、Task 或 Default Lead 反向推导显式收件人；
- 不改变 Agent-authored Camp Message Send v6、display-name alias、caller return 或 Message Delivery v2；
- 不把 Runtime readiness 当成 Member Mention 身份有效性，也不为忙碌/暂时不可运行自动换人；
- 不回填历史消息的 reply relation，不让 optimistic ID 进入持久 Draft；
- 不在本版本引入私有消息、第二套 Draft、第二套 Delivery 或 Renderer-side parser。

## 发布门槛

1. schema migration、Draft store 与 IPC tests 证明 reply intent/replacement requirement 跨导航、重启、
   revision conflict 与过期边界一致；
2. Core send tests 证明 exact Draft-only reply、失效 Mention、unresolved requirement、跨 Camp target 和竞态
   全部原子拒绝且没有 Default Lead fallback；
3. Renderer tests 覆盖可用作者、away/left/removed、回复自己、多人 Mention、取消引用、optimistic message、
   parent anchor 和 accepted/rejected 清理；
4. Porcelain Day / Steel Night、1440×920、1040×700、736px、360px、200% zoom 与键盘/屏幕阅读器验收通过；
5. 定向/完整 Core 与 Renderer tests、typecheck、build、文档治理和 `git diff --check` 通过；
6. 只有上述证据完成后才把本版本与实施计划标记为 `complete`。

## 实现与验收结果

- Data Contract 升级为 v0.77 / projection schema 38 / migration 83；旧 Draft 无损迁移为
  `replyIntent=null`，content、attachment 与 reply intent 共享唯一 revision/expiry 边界；
- user send 已删除 caller-supplied reply target，Core 只从 exact Draft 读取引用和结构化 Mention。
  `reply_recipient_required`、`mention_target_unavailable` 与 `camp_message.invalid_reply` 均原子拒绝，
  不产生 Message/Turn/Run/Delivery，也不回退 Default Lead；
- Renderer 已交付稳定消息 Reply action、单行 dock、完整 fanout、away/left/removed chooser、
  same-Camp anchor load 和 accepted parent quote；optimistic message 不暴露持久 Reply action；
- 真实 arm64 打包 App 在隔离 `userData` 中验证了：可用原作者自动写入原子 Mention；
  away 原作者不写入失效 Mention、展示“原作者当前不可接收，请选择其他成员”且禁用发送；
  显式改选 `agent_2` 后只创建 `agent_2` 的 run，无 Default Lead fallback；
- Porcelain Day / Steel Night 已完成 1440×920 真实 App 截图；原型完成 1440/1040/736/360
  双主题窄屏对照；最小 1040×700 窗口在收起检查器后以 200% 缩放实测为 520×350 CSS viewport，
  dock、父引用与执行操作无水平溢出；reduced-motion、pointer focus suppression、键盘触发和 ARIA 状态均纳入自动验收；
- 定向 Core/Renderer tests、全量 Rust/TypeScript tests、typecheck、strict Clippy、build、文档治理、
  结构化 Mention/Reply 真实 App acceptance 与附件 smoke 作为本版发布门禁。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.76 按完成事实冻结为 historical；v0.77 成为唯一 current，并新增本概览与[实施计划](implementation-plan.md) |
| ADR | 已更新 | 新增 [ADR-0185](../../adr/0185-durable-composer-reply-intent-and-explicit-recipient-resolution.md)，局部替代 ADR-0128 的 caller-supplied user reply target 并扩展 ADR-0080 Draft 范围 |
| Contracts | 已更新 | 新增 [Camp Composer Draft v1](../../contracts/camp-composer-draft-v1.md)，冻结 Draft view、reply mutations、exact send 与 fail-closed errors；Camp Message Send v7 不变 |
| Architecture | 已更新 | 新增 [Camp Composer Draft 架构](../../architecture/camp-composer-draft.md)，组合 Renderer、Draft store、user send 与 timeline read projection 权威 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)与[结构化 Mention](../../ui/components/structured-mentions.md)增加 reply entry、dock、父引用、fanout 和失效作者修复合同 |
| Runtime Activity | 确认无需更新 | reply intent 与 recipient repair 不新增 provider event、Canonical Activity domain、semantic kind 或 evidence shape |
| Runtime compatibility | 确认无需更新 | Agent CLI、Runtime adapter、Native Session capability 与已验证 Runtime 版本不变；变化仅在 user Draft/Core IPC |
| Documentation routing | 已更新 | 文档导航、CURRENT、ADR/Contract/Architecture/Version 索引增加 Composer reply 的当前入口 |
| Root README | 确认无需更新 | 项目定位、常青能力和 Runtime 支持范围不变；根 README 不记录版本局部交互或当前进度 |

## References

- [实施与验收计划](implementation-plan.md)
- [三方向 HTML 交互稿](../../prototypes/message-reply-chain/README.md)
- [ADR-0185](../../adr/0185-durable-composer-reply-intent-and-explicit-recipient-resolution.md)
- [Camp Composer Draft v1](../../contracts/camp-composer-draft-v1.md)
- [Camp Composer Draft architecture](../../architecture/camp-composer-draft.md)
- [ADR-0163](../../adr/0163-explicit-caller-return-and-core-managed-reply-reference.md)
