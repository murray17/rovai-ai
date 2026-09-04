---
document_type: version-decisions
version: v1.43
lifecycle: current
last_updated: 2026-09-04
---

# v1.43 决定

<a id="v1-43-d01"></a>
## V1.43-D01：Composer 领域协议收敛为 Text + Atom，并与 Lexical 和公共消息分层

### 背景

旧 Composer 把多个业务 Mention 类型直接当作编辑模型的一部分，并在每次输入后重建完整 Structured Content。
直接持久化 Lexical JSON 会把 Paragraph、selection、node key 和编辑器版本细节扩散到 Core；直接复用公共消息
Structured Content 又会让 Core-owned Current User Mention、渠道 External Quote 等不可编辑节点进入用户输入域。

### 决定

Draft 与 Pending 的唯一领域内容改为版本化 `ComposerDocument` V2，Segment 只包含普通文本或一个 Atom；
Member、All Members 与 Skill 仅是 Atom 的强类型 payload。换行在领域层属于文本中的 `\n`，Paragraph 只存在于
Lexical 内部。Core 兼容读取旧的用户可写 Segment 数组，但所有后续写入只产生 V2；发送时再转换成既有公共
Structured Camp Message Content。

Member 身份只由 `agentId` 决定，Skill 身份只由 `skillId` 决定；显示名、头像、可用状态和 Lexical presentation
字段都不是持久 identity。当前规范由 [Camp Composer Draft v8](../../contracts/camp-composer-draft-v8.md)与
[Composer 架构](../../architecture/camp-composer-draft.md)拥有。

### 后果与被拒绝方案

- Core Draft 不保存 Lexical JSON，公共 Message/Channel/Runtime 合同也无需随编辑器迁移。
- 无法从旧输入域表达的 Core-owned Segment 会被拒绝，不会静默丢失；纯文本粘贴不会猜测 identity。
- 拒绝让每种业务引用成为独立领域节点：它会重新扩张编辑 Schema。拒绝把显示名称当身份或按同名重绑：
  它会在重命名和离队后改变用户已选择的对象。拒绝持久化 Lexical tree：它会把第三方编辑器实现变成跨进程合同。

<a id="v1-43-d02"></a>
## V1.43-D02：高频编辑留在 Lexical，本地版本以低频 single-flight Snapshot 接入 Core

### 背景

React 受控 `contenteditable` 使普通按键经过全文序列化、父组件 setState、完整子树 reconciliation、DOM selection
映射和 Core Draft 保存。长输入、多个引用和 IME composition 因此共享同一条 O(N) 热路径。把完整内容迁到 React
state 或只用另一种全文字符串模型都不能消除这条路径。

### 决定

输入期间由 Lexical `EditorState` 唯一拥有内容、selection、composition 与 history。内部仅使用 Plain Text、History、
局部 Typeahead 和单一 token/unmergeable `ComposerAtomNode`；Atom 直接维护轻量 span DOM。React 只保存 Catalog、
Picker、发送状态、local/saved version 等小型状态。

真实内容更新增加 local version，并以 debounce/max-wait 形成 `ComposerDocument` Snapshot；同 Draft 保存 single-flight，
在途版本完成后直接追赶最新版本。发送和 revision-dependent mutation 先 flush exact EditorState；成功发送只有在
`currentLocalVersion === sentLocalVersion` 时清空。Catalog 展示更新使用专用 tag，不增加版本、不保存、不进入 undo。
当前数据流由 [Composer 架构](../../architecture/camp-composer-draft.md)拥有，交互由
[结构化 Mention](../../ui/components/structured-mentions.md)拥有。

### 后果与被拒绝方案

- 普通字符输入不执行全文 serialize/normalize/plain-text projection、Core IPC 或 Draft persistence；完整遍历只在
  初始化、authoritative replacement、低频保存和显式 flush 边界发生。
- 同一 Draft 的普通 props 与 Catalog 更新不替换 EditorState；有未保存本地修改时，远端 props 不能覆盖输入。
- 拒绝继续全文 React 受控模式、手工 DOM selection/ownership reset 和每字符 Core 同步：它们正是热路径来源。
  拒绝每个 Atom 一个 React Root：大量引用会引入独立生命周期与 Portal。拒绝并发保存每个版本：乱序回执无法
  安全表达 exact revision，也会制造无意义 IPC 压力。
