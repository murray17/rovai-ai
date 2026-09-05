---
document_type: architecture
architecture: camp-composer-draft
authority: camp-composer-editing-draft-pending-and-user-send-boundaries
status: accepted
last_updated: 2026-09-05
---

# Camp Composer Draft 架构

Camp Composer 有三个互不替代的权威层：输入期间的 Lexical `EditorState`、稳定业务语义的
`ComposerDocument` V2，以及持久化与 exact revision 的 Core Draft。已提交但尚未公开的下一轮输入由私有
Pending Camp Input 拥有。字段和行为见 [Camp Composer Draft v12](../contracts/camp-composer-draft-v12.md)、
[Pending Camp Input v3](../contracts/pending-camp-input-v3.md)，附件生命周期见
[Camp Attachment v8](../contracts/camp-attachment-v8.md)。

## Component authority

| Component | Responsibility |
| --- | --- |
| React Composer Shell | 稳定挂载编辑器；拥有 Member/Skill Catalog、placeholder、disabled、Picker UI、发送编排、Draft load state 与持久化错误；普通 dirty/saving/saved 不提升到 Workspace，不逐字符保存完整正文 |
| Lexical Editor | 输入期间唯一拥有节点树、selection、composition、局部 DOM reconciliation、undo/redo、当前 local version 与最新 EditorState snapshot |
| Composer adapters | 在 Lexical tree 与 `ComposerDocument` V2 间双向转换；生成纯文本；校验/恢复私有 Clipboard；不把 Lexical JSON 变成领域协议 |
| Draft Sync | 只拥有 EditorState ref、epoch、local/saved version、dirty 与 persistence status；以 debounce/max-wait single-flight 请求内容保存，并在业务边界 flush 捕获 snapshot；不保存完整 Draft View 或 Core revision |
| Draft Mutation Coordinator | Renderer 唯一完整 `CampComposerDraftView` owner；将正文、附件、Reply、Continuation 与接收者 mutation 串入同一队列，并用每次 Core 返回的完整 View 原子替换 authority |
| Camp Draft module | 持久化 V2 document、source refs、legacy Prepared 互斥状态、Reply/Continuation、recipient touched、revision 与 expiry；从 document 派生 body |
| Pending module | 原子保存已提交的完整 V2 下一轮意图、FIFO、edit token/revision、working source refs 与 needs-repair 状态 |
| Collaboration send | 从 exact Draft/Pending 读取 V2，物化 continuation，最终校验 Reply/Atom/source availability，转换成公共 Structured Content，并只在 accepted transaction 消费 owner |
| Camp Read Model | 投影公开 Message、Reply/Continuation 和统一无路径附件 View；不暴露 Lexical 状态 |
| Runtime source resolver | 对触发 Message 的 source refs 返回 executionRoot 内原路径或当前 Run Temp 路径；Adapter 不理解 Composer 或存储差异 |

## 两层 Schema

Lexical 内部保持一个 Paragraph 容器：

```text
RootNode
└── ParagraphNode
    ├── TextNode
    ├── LineBreakNode
    └── ComposerAtomNode
```

普通 TextNode 不直接挂 Root；换行使用 LineBreakNode。粘贴或外部状态产生多个 Paragraph 时，节点 transform
把段落边界归一成 LineBreakNode 并合并到前一个 Paragraph。`ComposerAtomNode` 是单一 identity-only inline
`DecoratorNode<null>`；Member、All Members、Skill 只由 payload 区分。Atom 没有字符 offset，允许键盘 NodeSelection，
并以一个 `contentEditable=false` span DOM 呈现；`decorate()` 返回 null，不挂载独立 React 子树。

领域层只有：

```text
ComposerDocument(version = 2)
└── segments
    ├── Text(text; newline = "\n")
    └── Atom
        ├── member(agentId, labelFallback?)
        ├── all_members
        └── skill(skillId, nameAtSend)
```

Paragraph、LineBreak node、selection、history、node key、DOM、React/plugin state 与 presentation state 不导出。
相邻 Text 合并，空 Text 删除。Core 不保存 Lexical JSON。公共 Message 仍使用既有 Structured Content，只有
发送/发布边界才把 V2 Atom 映射为对应 Mention。

## Identity and presentation flow

```text
Member Atom.agentId ──> current Camp Member Catalog ──> display name/avatar/availability
Skill Atom.skillId  ──> current Skill Catalog       ──> current presentation/availability
                       nameAtSend remains the semantic snapshot
```

Catalog 变化使用 `rovai:atom-presentation` 只更新标签和 DOM 属性。节点不保存当前动态 label，Lexical 文本长度与
DOM 展示不会因改名分叉。Draft Sync 忽略该 tag；更新不增加 local
version、不触发保存、不进入 undo。不可解析对象保留原 identity 并显示 unavailable，不按显示名重绑、不转普通
文本、不在输入阶段删除。Member `labelFallback` 与 Skill `nameAtSend` 只承担合同规定的降级/快照职责。

## Local editing path

```text
beforeinput / composition
  -> Lexical pending EditorState
  -> only affected Text/Atom nodes reconcile
  -> committed immutable EditorState
  -> dirty leaves update small content/recipient/availability counters
  -> localVersion + 1 and schedule persistence
```

普通按键路径禁止完整 tree serialization、完整纯文本投影、全文 trigger 正则、完整 React content setState、DOM
snapshot、Core IPC 或 Draft persistence。Member 与 Skill 共用一个 Trigger Plugin 和一个 Editor update listener；
它从当前普通 TextNode 的 caret 位置只分配最多 128 字符 suffix，并在同一 matcher 内区分 `@` 与 `/`。查询不跨
Atom、LineBreak、非法标点或 Paragraph 边界。Typeahead 以高于通用发送的 Lexical command 优先级，在 Enter/Tab
事件中同步从当前 selection 重算同一 bounded match；Catalog loading 时消费按键，ready 且有候选时选择，否则交回
通用 Enter。composition 期间不更新候选、不插 Atom、不发送、不替换 EditorState。ContentEditable 关闭浏览器
spellcheck，避免长中文、Skill、路径与代码输入产生额外扫描和 decoration。

Editor Extension 图是模块级稳定引用，由 `LexicalExtensionComposer` 挂载 Plain Text、History、Atom、command、
clipboard 与 Draft Sync；统一 React Typeahead Plugin 负责有界匹配、候选键盘所有权和 Portal。普通 Catalog、placeholder、disabled 或父组件 render
不重新创建 Editor。

## Draft synchronization

```text
committed EditorState
  -> localVersion / latestEditorState ref
  -> debounce 350 ms (max wait 1500 ms)
  -> serialize one ComposerDocument snapshot exactly once
  -> DraftMutationCoordinator queue
  -> current Draft exact-revision Core mutation
  -> update Coordinator authority + savedVersion
```

同一 Draft 的全部 mutation 共用 Coordinator queue，内容层仍只允许一个 save 在途。若 version 10 保存时继续输入至
version 13，不并发提交 11/12；10 完成后直接保存当时最新的 13。完成只确认同 epoch 对应 version；
`localVersion > completedVersion` 时保持 dirty 并继续追赶。selection、focus、Picker highlight、Catalog presentation、
placeholder、disabled 和 history bookkeeping 不增加版本。Canonical document 比较按 Segment/Atom 直接线性完成，不在
同一保存边界重新 normalize、JSON stringify、派生 body 或再次导出 EditorState。`save_content` 回执只更新
Coordinator 的内部 authority/revision，不触发整个 Workspace projection render；普通 dirty/saving/saved 留在 Sync，
只有持久化 error 及其成功恢复向上报告。批量附件先 flush 一次正文，再顺序进入同一 revision queue。

自动保存失败保持 dirty，记录 `error` persistence status，并只在当前 epoch 做有限退避重试；显式 flush/发送直接暴露
失败。发送、Reply/Continuation、依赖 Draft revision 的 mutation，以及任何会卸载或替换当前 Camp Composer 的普通
导航，先同步锁定 Lexical，再停止 timer、
等待在途 save 与 Coordinator queue、读取最新已提交 EditorState、按需保存 exact V2 并取得 Coordinator 当前 Core
revision。App 只调用当前 `CampWorkspace` 注册的统一 leave guard，不复制附件、Pending 或 Draft 保存逻辑；Camp-to-Camp
和 Camp-to-其他 Surface 只有 flush 成功才继续。失败保留当前 Camp 和内容；transition 失败或实际未卸载 Composer 时
以 `complete(false)` 恢复交互。组件 cleanup 只释放 listener、timer、Sync 与 Lexical runtime，不承担异步保存。离散
提交只用于显式更新后必须立即读取的边界，不用于普通输入。

正常 App 退出使用同一个边界，而不创建第二套保存路径。Main 的既有 quit coordinator 在任何服务 drain 或
`core.shutdown()` 前向已加载 Renderer 发出一次准备请求；App 只读取 live view、active Camp ID 与已注册 guard，匹配
时调用 guard 并在成功后 `complete(true)`。guard 失败由原路径恢复 Composer 交互并显示保存错误，Main 放弃本次退出且
允许下一次 quit 重试。此阶段早于 `runtime.state = shutting_down`，不改变既有关闭 overlay。

macOS 红色关闭 / Cmd+W 复用同一 Renderer preparation，成功后只关闭主窗口，App、Core 与 Runtime 继续运行。
失败不关闭窗口，沿用保存错误与重试行为；连续关窗或关窗与 Cmd+Q 重叠时，共享该窗口进行中的一次 preparation。

## Initialization and authoritative replacement

首次创建时把 Core V2 转为单 Paragraph EditorState。`draftIdentity = campId:draftId` 是编辑上下文身份；切换
identity 会新建 editor 并清除 history、Picker、pending save、selection 和 composition。相同 identity 下，Core
返回当前已保存 revision、Catalog/placeholder/disabled 更新或页面其他 render 都不得替换 EditorState。

本地有未保存修改时，自己的 save 回执只由 Coordinator 更新 Core authority；普通迟到 props 不得调用
`setEditorState` 覆盖输入。Reply/Continuation 等 Core mutation 必须在锁定并 flush 后比较返回 content；有变化时通过
唯一 `replaceDocument()` seam 清除旧 selection/history、关闭 Typeahead，并让 Sync 接受新 authoritative state，不产生
autosave。切换 Camp/Draft、restore、发送后下一 Draft 或明确 replacement 推进 epoch；旧 epoch 结果不能更新新编辑
对象的 saved/dirty/UI 状态。

Draft load 明确区分 loading、ready 和 error。只有 Core 成功返回的 revision-zero Draft 是权威空 Draft；IPC、数据库或
Core 失败保持 error，Composer、附件、Reply/Continuation 与发送全部禁用并提供显式重新加载。失败不能构造空 V2
并交给 Coordinator 或 Lexical 冒充已加载 authority。

## Clipboard and commands

Copy/Cut 同时写 `text/plain`、兼容 `text/html` 和 `application/x-rovai-composer+json`；私有 MIME 内容是选区的
`ComposerDocument`，不是 Lexical JSON。Paste 优先文件附件，其次严格校验私有 MIME，再降级到普通文本/HTML
可见文本。只恢复当前 Catalog 中仍有效的 Atom；不可恢复 Atom 转可见文本。外部 HTML 的 data attributes 和纯文本
`@name`、`/skill` 永远不能成为 identity 来源。

Typeahead 的 critical-priority Enter 先同步检查当前 Lexical selection：有效候选直接选择，Catalog loading 消费但不
发送，无 trigger 或 ready/error 且无候选才返回 false。之后 Enter 在非 composition、内容可发送时交给发送；
Shift+Enter 插入 LineBreakNode。Escape 先关闭
Typeahead，再关闭 Atom 激活展示并保留内容。Backspace/Delete 与 History 由 Lexical 处理，Decorator Atom 一次整体删除；
编辑器绝对起点继续调用 Rovai 的 `onBackspaceAtStart`。

## Send and queue flow

```text
lock Lexical interaction -> wait attachment queue -> flush through Coordinator
  -> current exact Core Draft revision
  -> derived body non-empty OR source/legacy attachment exists
     -> Camp idle and Pending empty
        -> validate current Atom/source availability
        -> map V2 to public Structured Content
        -> create CampMessage/Turn/Run and consume Draft atomically
     -> Camp busy or Pending exists
        -> source-ref Draft: copy complete V2 intent into Pending and consume Draft atomically
        -> legacy Prepared Draft: reject queue admission and preserve exact Draft
  -> no content and no attachment
     -> reject camp_message.empty_body
```

发送锁在第一个 `await` 前生效，同一 Composer 在途期间不接受下一条输入。accepted 后 Renderer load 下一份 Core Draft、
authoritative-replace Lexical，再解除锁；rejection 不清空、不替换并解除锁供重试。因此不存在 send-time persistence hold、
`sentLocalVersion`、成功后的版本条件清空或 generation A/B。附件或路由等并行 mutation 仍由 Coordinator queue 排序。

Source-ref publication only copies JSON between owners. Pending keeps V2, source refs, Reply/Continuation result and
Execution Request as one intent. Scheduler publishes only the head after prior execution settles；missing、unreadable 或
kind-changed source paths retain the head as `needs_repair` and block FIFO.

## Reply, Continuation and Pending Edit

Reply 与 Continuation 的来源、优先级、失效显式修复和无 Default Lead fallback 保持不变。任何会修改这些 Core
intent 的动作先 flush Composer。Frozen continuation 的 recipient 最终物化为 V2 Member Atom，然后在发送边界映射
为 public Mention。

Pending Edit 使用 `campId:pendingInputId` 作为独立 draft identity，从 canonical V2 初始化；Save flush 本地 EditorState
后把完整 V2 与 working refs 置换进 Pending，Cancel 放弃 working state，Delete 取消整条 Pending。所有动作继续由
pendingInputId、pending revision 与 editToken fencing，且不会消费或覆盖普通 Composer Draft。

## Legacy and failure boundaries

- 旧 Draft/Pending 用户 Segment 数组只在 Core reader 转成 V2；成功写入只产生 V2，不修改公共历史 Message；
- 旧 Prepared Draft 仍与 source refs 互斥，可编辑 V2 文本、移除附件、直接发送或丢弃，不能进入附件 Pending；
- revision conflict 不能让迟到 props 覆盖 dirty EditorState，必须显式 reload/resolve；
- direct source/identity failure 创建不了 Message 并保留 Draft；Pending failure 保留队首供显式修复；
- accepted Message 的 source 后续失效与 v7/v2 相同，读取和 Runtime 失败均诚实呈现；
- command replay 使用持久 result，不需要已消费 Draft 再出现。

## References

- [Camp Composer Draft v12](../contracts/camp-composer-draft-v12.md)
- [Pending Camp Input v3](../contracts/pending-camp-input-v3.md)
- [Camp Attachment v8](../contracts/camp-attachment-v8.md)
- [结构化 Mention 与 Atom](../ui/components/structured-mentions.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
- [V1.43-D01](../versions/v1.43/decisions.md#v1-43-d01)
- [V1.43-D02](../versions/v1.43/decisions.md#v1-43-d02)
- [V1.45-D01](../versions/v1.45/decisions.md#v1-45-d01)
- [V1.45-D02](../versions/v1.45/decisions.md#v1-45-d02)
- [V1.45-D03](../versions/v1.45/decisions.md#v1-45-d03)
- [V1.46-D01](../versions/v1.46/decisions.md#v1-46-d01)
