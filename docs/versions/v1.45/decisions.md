---
document_type: version-decisions
version: v1.45
lifecycle: historical
last_updated: 2026-09-05
---

# v1.45 决定

<a id="v1-45-d01"></a>
## V1.45-D01：Renderer 只保留一个完整 Camp Draft authority

### 背景

`ComposerDraftSync.latestResult`、`CampWorkspace.composerDraftRef` 和 React Draft state 都曾缓存完整
`CampComposerDraftView`。正文保存后，附件或 Reply mutation 可以推进 Core revision，而 Sync 仍返回旧回执；发送再以
“最近 result 或外层 ref”选择 Draft，无法证明正文、附件、路由意图和 revision 属于同一事务状态。

### 决定

`DraftMutationCoordinator` 是 Renderer 唯一完整 Draft owner。正文、附件、Reply、Continuation 和接收者修改进入同一
Promise queue；每个操作在实际执行时读取 Coordinator 当前 revision，Core 返回完整 View 后再替换 authority。React
只保存重渲染 tick 和派生 UI 状态；`ComposerDraftSync` 不缓存 View/revision，只在 flush 结束时读取 Coordinator。

编辑对象整体替换会推进 epoch。异步操作只在 epoch 仍一致时更新当前 UI/本地保存状态；旧 epoch 的 Core 工作可完成，
但其回执不能进入新 Draft。失败 mutation 尝试刷新当前 authority，同时向调用者保留原始错误。

### 后果与被拒绝方案

- flush 的含义是“捕获版本已落到当前权威 Draft 并返回队列结束后的 View”，不是返回最近一次 autosave 回执。
- exact send 不再有 `latestResult ?? currentResult` 分支；附件和正文不能并行争用同一 revision。
- 拒绝用更多 refs 互相同步：它只能缩小竞态窗口，不能建立唯一顺序或权威。
- 拒绝把完整 Draft 放入逐字符 React state：它会重新引入全文 render 和双 owner。

<a id="v1-45-d02"></a>
## V1.45-D02：Composer Atom 是 identity-only inline DecoratorNode

### 背景

token `TextNode` 同时保存旧显示文本，而 Catalog presentation 直接改 DOM `textContent`。成员改名后 Lexical 字符长度
仍是旧标签，DOM 却是新标签，selection offset、浏览器范围和编辑模型不再同构。

### 决定

`ComposerAtomNode` 继承 `DecoratorNode<null>`，显式 inline、keyboard-selectable、non-isolated。节点只保存领域允许的
identity/fallback/snapshot state；`createDOM` 建立一个 `contentEditable=false` span，`updateDOM` 用当前 Catalog 投影
label/availability，`decorate()` 返回 `null`，不创建 Atom 级 React 子树。

### 后果与被拒绝方案

- Atom 没有字符 offset，光标只能位于前后节点边界；相邻删除按 Lexical Decorator 语义整体处理。
- 键盘 NodeSelection 的 Copy/Cut 也投影 `ComposerDocument`，不会因 `getTextContent()` 为空丢失 identity。
- 拒绝继续同步 TextNode 文本与 Catalog label：动态显示不属于领域内容，也不应进入 undo/Draft revision。
- 拒绝每 Atom React Root：简单 span 不需要独立生命周期、Portal 或 Catalog subscription。

<a id="v1-45-d03"></a>
## V1.45-D03：`@` 与 `/` 共用源头有界的 Trigger listener

### 背景

标准 `LexicalTypeaheadMenuPlugin` 会先取得光标前的完整 TextNode prefix，再把字符串交给 trigger；尽管 Rovai
随后截取 128 字符，较长 prefix 的分配已经发生。分别挂载 Member 和 Skill 插件还重复 selection/update 监听。

### 决定

Rovai 使用一个 React Plugin 和一个 Lexical update listener。它只接受 collapsed plain-Text selection，按 caret offset
请求当前 TextNode 最后最多 128 字符的 suffix，在同一个 matcher 内区分 Member/Skill，并输出 node key 与精确
`fromOffset/toOffset`。节点起点只在无前置节点或 LineBreak 后成立；Atom、Paragraph 和非法边界不跨越。IME 期间保持
候选状态但不重新匹配、选择或发送，compositionend 后再计算。

### 后果与被拒绝方案

- 查询成本和分配上限与 Draft 总长度无关；URL、路径和单词内部 slash 继续是负例。
- 候选 UI 仍由一个 React Portal 呈现，键盘行为与现有视觉合同不变。
- 拒绝在 trigger callback 内才截断：那无法撤销标准插件已经完成的 prefix 分配。
- 拒绝两套自定义 listener：Member 与 Skill 的 selection、IME、键盘和关闭语义应共享一个 owner。

<a id="v1-45-d04"></a>
## V1.45-D04：Fleet 拥有 Starting 与 Stopping operation

### 背景

Reserve/锁外 Spawn/Commit 只移除了 spawn 时的全局锁，却仍让第一个 `acquire()` Future 隐式拥有 Starting；该
waiter 被取消会把 reservation 永久留在容量表。另一方面，release、idle sweep、失效和 Camp fence 仍可能在
global operations mutex 内等待慢 Host 退出，同一 Host 的并发 stop 还可能重复发起 shutdown/reap。

### 决定

Starting reservation 一经创建，Fleet 立即启动自身拥有的 Startup Operation，调用方只订阅 completion。取消
Starting 通过 operation signal 使其拒绝 commit、清理已创建 Host 并精确释放 reservation。Stop 对称采用
`Mark Stop → Reap outside lock → Commit Stop`，每个 ProcessEntry 同时最多一个 stop operation；所有停止入口共享
其 completion。字段和并发行为由 [Runtime Launch v35](../../contracts/runtime-launch-and-verification-v35.md)拥有。

### 后果与被拒绝方案

- 丢弃任意 acquire waiter 不再影响 spawn，其他同 Run waiter 仍取得同一终态。
- 慢 Host 只占自己的 operation，不再阻塞其他 Runtime 的 acquire/release/stop。
- stop timeout 保留 Stopping、lease 和 capacity，后续可重试；只有 exact operation 确认 reap 才删除。
- 拒绝让 Adapter 或首个 waiter 保存 task handle：这会把公共 capacity 与 cleanup 正确性重新分散到调用方。
- 拒绝只把 operations mutex 改成更细的锁：await 进程 I/O 的所有权问题仍然存在，也不能完成失联 waiter。

<a id="v1-45-d05"></a>
## V1.45-D05：Pi 只在最终 pre-agent seam 接受输入，并把正常控制与协议损坏分离

### 背景

Pi 原生 `input` pipeline 允许后续 Extension transform 或 handled 输入；Rovai 若在自己的 `input` hook 先提交
receipt，会把没有启动 Agent Turn 的 Delivery 误记为 accepted。与此同时，one-way `abort` 带 ID 却不登记 pending，
其正常 response 会被 reader 当成 protocol corruption；普通第三方 Extension UI 请求也会被取消后继续 poison
Host。不同 execution epoch 的 creation gate 独立，旧请求还可能在比较 epoch 前清理新 Runtime。

### 决定

Managed receipt 与 Bootstrap 注入合并到 Rovai 的 `before_agent_start` hook：重新读取并验证 binding/session、观察
三个 governed Tool、等待 Core durable nonce，成功后才追加 Bootstrap。`abort` 使用完整 request correlation，等待者
超时后保留可消费的 late-response correlation。Pi active Runtime 在任何副作用前执行 pre-create epoch fence，并保留
commit fence 与所有 exact Run+epoch 删除 fence。非 Rovai Extension 的未映射交互只返回 cancelled/denied；只有
framing 或 Rovai-owned identity/schema corruption 才 fail closed。完整行为由
[Runtime Launch v35](../../contracts/runtime-launch-and-verification-v35.md)拥有。

### 后果与被拒绝方案

- 更早 Extension handled 输入时不产生 receipt，Input 不会错误进入 accepted。
- 正常 cancel 和 UI capability mismatch 不再冒充 Host failure；迟到 abort response 仍保持 JSONL framing。
- 旧 epoch 无权 cleanup、unbind、remove 或 stop 新 epoch，创建前和提交时形成双重 fence。
- 拒绝保留 `approvedBindingDigest` 跨 hook 授权：它证明的是过早阶段，不能证明 Agent Turn 会启动。
- 拒绝为所有 Pi Extension 重建通用 TUI：Rovai 只拥有自己的 identity、Bootstrap、receipt 和部分审批合同。
