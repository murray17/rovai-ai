---
document_type: adr
id: ADR-0096
title: Core-Owned Structured Mentions and Mention-Derived Camp Addressing
status: accepted
date: 2026-08-03
decision_scope: cross-version
source_version: v0.33
supersedes: []
superseded_by: ADR-0128
---

# ADR-0096: Core-Owned Structured Mentions and Mention-Derived Camp Addressing

## Context

现有 Camp Composer 使用纯文本 `<textarea>`。Renderer 在候选选择时只插入
`@名称` 文本，发送前再扫描正文并另行提交 `agentProfileIds`。候选触发和最终扫描使用
不同边界规则，因此 `让@小河狸` 可以显示并选择候选，却可能在发送时丢失目标。手工输入、
Paste、改名和真正选择的 Mention 也无法被可靠区分。

正文、视觉身份和收件人列表成为三份可分叉事实后，系统既不能保证蓝色 Mention 与实际
AgentRun 一致，也不能提供原子编辑、结构化 Clipboard、跨重启 Draft 恢复或准确的重复
Mention。继续修补字符串边界仍会把名称和 Unicode 位置当作路由协议。

ADR-0080 已确立 Core-owned Camp Composer Draft，但当前 Draft 只保存 `body` 与附件，发送者
仍可同时提交另一份正文、附件 ID 和地址。结构化 Mention 因而需要扩展同一个 Draft 与
消息提交边界，而不是在 Renderer 增加一层不可恢复的装饰。

本决策局部替代 ADR-0058 中“扫描正文 handle 决定显式目标”的规则、ADR-0060 中新消息
Mention 输入与寻址条款，以及 ADR-0080 中 Draft 只有正文/附件和发送者再次枚举其内容的
条款。ADR-0057 的 Presence、ADR-0060 的不透明稳定身份、ADR-0076 的 message-first Runtime
边界和 ADR-0080 的附件准备与原子消费原则继续有效。

## Decision

### 1. Closed structured content is the semantic authority

每个新版用户 Camp Composer Draft 及其成功提交的 CampMessage 使用同一份有序
`Structured Camp Message Content`：

```ts
type StructuredCampMessageSegment =
  | { kind: "text"; text: string }
  | { kind: "member_mention"; agentProfileId: string }
  | { kind: "all_members_mention" }

type StructuredCampMessageContent = StructuredCampMessageSegment[]
```

Core 规范化空 Text 和相邻 Text，验证封闭类型、大小与稳定身份引用，并从规范内容派生：

- 当前纯文本投影；
- Renderer 结构化投影；
- Default、Explicit 或 Broadcast 地址模式；
- 去重的收件人和成员检索索引；
- 稳定语义 digest。

系统不保存 Mention 字符偏移，不把 HTML、Markdown AST、`contenteditable` DOM 或通用富文本
模型提升为领域真源。存储中的兼容 `body`、Renderer 乐观消息和上下文纯文本都是投影，不得
反向覆盖结构化内容。

普通 `@文字` 永远只是 Text。只有用户从当前 Camp 的 Mention discovery 中选择候选，或从
Rovai-ai 结构化 Clipboard 保留一个通过目标 Camp 校验的完整 Token，才创建 Mention。
Renderer 不在发送、加载或 Paste 纯文本时重新解析名称或 handle。

### 2. Mentions are atomic identity occurrences

`MemberMention` 保存稳定 `AgentProfile.id`，不保存可编辑名称。正文可以保留同一成员的多个
出现位置，也可以同时包含与 `AllMembersMention` 重叠的 MemberMention；可见出现不去重，
寻址目标去重且每个成员最多创建一个直接 AgentRun。

`AllMembersMention` 始终是一个结构化 Token，不在 Draft 或历史正文中展开。发送接受时 Core
把它解析为当时全部 present current CampMembers，并把精确收件人 ID 集合冻结在消息中。
后来加入、离队、移除或改名不改变该历史集合。

没有 Mention 的消息继续使用持久 Default Lead，但默认寻址不创建、插入或显示一个隐式
Mention。包含至少一个 MemberMention 且没有 AllMembersMention 时为 Explicit；包含任意
AllMembersMention 时为 Broadcast。调用者不能另行提交地址模式或收件人列表来增删目标。

发送时每个 MemberMention 必须仍指向目标 Camp 中 present、current、可提及的 CampMember。
任一目标失效均以 `mention_target_unavailable` 在 CampMessage、CampTurn、AgentRun 和 Draft
消费之前拒绝完整请求；Draft 原样保留，不降级 Token、不删除目标，也不回退 Default Lead。
Runtime Readiness 不是 Mention 身份有效性，继续遵循 ADR-0076 的消息优先与执行失败语义。

同一消息解析出的全部唯一收件人在一个事务和一个创建时间边界内各自获得 queued AgentRun；
Default Lead 即使也是显式目标，也不拥有阻止、串行化或替代其他 Mention 的特殊优先级。
调度器并发执行这些 Run 各自的 Workspace、Runtime 与 Git 启动前检查，任何一个目标都不等待
前一个目标的 Runtime 完成后才开始调度。这里保证的是原子 fanout 与并发调度，不虚构操作
系统能给多个独立进程完全相同的实际启动时刻。

### 3. Exact Draft revision is the user-send boundary

Camp Composer Draft 保存 Structured Content、有序 Prepared Attachments 和 Core-owned 单调
Revision。内容或附件的每次成功变更都推进 Revision；Renderer 必须串行对账异步保存，不得
把本地计数或时间戳当作权威版本。

用户发送命令引用 `campId + draftRevision` 以及与消息内容正交的 reply/execution 意图，不再
重复提交 `body`、`agentProfileIds`、address mode 或 Prepared Attachment ID 集合。Core 在
同一短事务中：

1. 先处理既有 `commandId` 的幂等重放；
2. 比较当前 Draft 与引用的精确 Revision；
3. 验证结构、Camp、Mention 目标和既有业务准入；
4. 派生正文、地址、收件人、索引与 digest；
5. 创建消息、Turn、queued AgentRuns 和 Message Attachments；
6. 消费该 Draft。

Revision 不一致以 `draft_changed` 在任何新业务状态之前拒绝，不覆盖、不消费也不自动发送
较新的 Draft。成功命令的幂等重放不要求已经消费的 Draft 仍存在。

发送前 Renderer 用 Core 返回的精确 Draft 构造乐观消息；接受后以权威消息对账。拒绝或 IPC
失败时移除乐观投影并重新显示同一耐久 Draft，不从乐观纯文本重建 Mention。

### 4. Identity projection and run freezing

MemberMention 的 UI、标准 Clipboard 纯文本、成员检索结果和未来 AgentRun 上下文在各自读取
边界通过稳定 ID 投影当前 Member Name。改名不改写 Draft 或历史 Structured Content；removed
身份使用 ADR-0057 保留的最后名称。历史消息中的精确收件人集合不因投影变化而改变。

消息的语义 digest 基于规范结构与稳定 ID，因此改名不改变消息身份。每个 AgentRun 在自己的
ContextManifest 中冻结该 Run 实际收到的纯文本投影及 payload digest；之后再次改名不能改变
既有 Run 输入或证据。

### 5. Clipboard and legacy compatibility

复制结构化内容时，标准 `text/plain` 只包含当前可见文字，例如 `@小河狸`，不暴露内部 ID。
Rovai-ai 可以同时写入应用私有结构化 Clipboard 格式，但只为完整选中的 Token 保留身份；
部分 Token 或只有纯文本的 Clipboard 永远按 Text Paste。私有 payload 不是受信任命令，Paste
到另一 Camp 时必须按目标 Camp 当前成员重新校验；无效 MemberMention 降级为 Text，
AllMembersMention 解释为目标 Camp 的所有成员并在该消息发送时冻结。

没有 Structured Content 的旧用户消息按一个 Text segment 读取，不从名称、handle、旧收件人
列表或正文位置猜测蓝色 Token。旧 `addressedAgentProfileIds` 和既有成员索引继续作为历史
寻址、审计和搜索事实。ADR-0060 既有 `@handle → @当前名称` 只读显示兼容可以继续作为普通
文本投影，但不得创建 Mention、改变地址或生成新的结构化索引。

## Consequences

- 候选菜单、蓝色身份、Draft 恢复、历史显示和实际唤醒来自同一语义值，最初的 Unicode
  边界分叉被结构上消除。
- Core 合同和 SQLite 需要新增结构化内容与 Draft Revision；兼容 `body` 和现有成员索引成为
  可重建投影，而不是第二真源。
- Renderer 必须用支持原子行内 Token、IME、Selection 和 Clipboard 事件的结构化 Composer
  取代纯 textarea；DOM 仍不是持久化真源。
- 保存内容、附件准备和删除必须按 Revision 串行对账，测试需要覆盖乱序返回、跨 Camp 导航、
  重启、发送竞争和命令重放。
- 旧消息不会突然获得猜测性的蓝色身份；升级不需要重写历史正文或恢复不存在的位置数据。
- Runtime 暂时不可用仍可能产生已保存消息和失败 Run；这与身份失效导致的发送前拒绝保持
  清晰分离。

## Rejected Alternatives

- **统一两个字符串正则后继续解析正文。** 仍无法区分选择、手工输入和 Paste，也无法可靠
  支持改名、重复出现或原子编辑。
- **保留 body 与 caller-supplied recipient IDs 两个真源。** 两者在删除、Paste、保存竞争和
  非 Renderer 调用下仍可分叉。
- **Renderer-only 蓝色 Overlay 或 Token map。** 导航、重启、发送失败和跨进程读取会丢失
  身份，Core 仍无法验证实际寻址。
- **保存字符 offset。** Unicode、名称投影和 Text 编辑会使位置脆弱，并要求复杂位置迁移。
- **引入通用富文本/HTML/Markdown 文档。** 当前需求只有三个封闭 segment，扩大输入与安全
  表面而没有领域收益。
- **把 `@所有成员` 展开成多个 MemberMention。** 丢失用户的广播意图，并让历史显示随成员
  集合变化变得不可解释。
- **根据旧 body 和收件人索引迁移历史 Mention。** 旧数据没有可靠 occurrence/order，任何
  反推都会制造虚假身份位置。

## References

- [ADR-0057: Member Presence and Retained Permanent Removal](0057-member-presence-and-retained-removal.md)
- [ADR-0058: Presence-Aware Routing and Execution Admission](0058-collaboration-v4-presence-aware-admission.md)
- [ADR-0060: Opaque Member Routing Identity](0060-opaque-member-routing-identity.md)
- [ADR-0076: Message-First AgentRun Dispatch Boundary](0076-message-first-agent-run-dispatch-boundary.md)
- [ADR-0080: Durable Camp Composer Draft](0080-durable-camp-composer-draft-and-atomic-attachment-consumption.md)
- [Arctic Dawn Camp Composer](../ui/arctic-dawn.md#camp-composer)
- [`AgentMentionTextarea.tsx`](../../apps/desktop/src/renderer/src/AgentMentionTextarea.tsx)
- [`collaboration.rs`](../../crates/rovai-core/src/collaboration.rs)
