---
document_type: ui-component-contract
authority: renderer-composer-atoms-and-structured-mentions
status: accepted
last_updated: 2026-09-05
---

# 结构化 Mention 与 Composer Atom

<a id="不得回退的交互合同"></a>

## 产品边界

Composer 是结构化纯文本输入框，不是富文本、Markdown 或通用文档编辑器。`# title`、`**bold**`、
`- list`、`[link](url)` 都保留为普通字符；不提供 heading、文本样式、代码、引用、列表、表格、链接、
Markdown shortcut、HTML 富文本粘贴、Block 拖拽或协同文档编辑。

普通文本与不可拆分 Atom 是仅有的业务 primitive。Member、All Members 和 Skill 共用同一种 Atom 交互与
DOM 形态，但 identity、候选来源、激活行为和发送校验保持强类型。

## Atom 呈现与身份

可解析 Member Atom 在 Composer 与历史消息中默认显示为无底色、无边框的蓝色行内文字；Hover、选中或
信息卡打开时只使用既有 8% mention feedback。Skill 使用既有 Skill 行内语言。unavailable 状态保留可见标签，
通过弱化样式和明确状态反馈表达，不消失、不变回可编辑文字。

每个 Composer Atom 是 identity-only inline `DecoratorNode<null>`，只对应一个 `contentEditable=false` span DOM；
`decorate()` 返回 null，不得挂载独立 React Root、Portal 或 Catalog 订阅。Atom 内没有独立可聚焦按钮，光标不能
进入其中，键盘可以 NodeSelection，Backspace/Delete 一次删除整个 Atom。普通字符落在 Atom 前后的独立 TextNode。

Member 的唯一身份是 `agentId`，显示名称/头像从当前 Camp Catalog 解析；改名只刷新显示。离队或不可解析时
保留 identity 和 fallback label，不按同名成员重新绑定。Skill 的唯一身份是 `skillId`，`nameAtSend` 保留发送时
语义/显示快照；当前描述、图标和来源不进入 Draft。Catalog 展示刷新不产生 dirty、Draft save 或 undo item。

## Member Typeahead

`@`、`@a`、`@alice` 只在折叠光标、普通 TextNode、非 composition，且 `@` 位于文本开头或允许分隔符之后时
打开。Member 与 Skill 共用一个 Trigger Plugin 和一个 Editor update listener；查询不得跨 Atom、换行或 Paragraph，
从当前 TextNode 的 caret 位置只分配光标左侧最多 128 个字符。方向键移动候选，Enter 选择，Esc 关闭；菜单消费
按键时不得触发发送。Enter/Tab 的归属不读取 React `menuOpen` 或渲染后的候选数组，而由 Typeahead 的 Lexical
critical-priority command 从当前 selection 同步重算 trigger：Catalog loading 时消费按键但不选择，ready 且有候选时
选择当前项，无 trigger 或 ready/error 且无候选时才交给普通发送行为。

选择 Member/All Members 后，匹配查询被一个 Atom 替换。右侧已有空白时复用；否则插入一个普通空格，并把
光标放在空格之后。查询或显示文本都不构成 identity。

## Skill Typeahead

`/`、`/rev`、`/review` 只在文本开头、空白、换行、中文标点或明确允许的命令边界之后打开，并与 Member 查询使用
同一个 128 字符 suffix matcher。`https://example.com/a/b`、`src/components/a/b.ts` 和 `word/review` 不触发。

选择候选后用 `skillId + nameAtSend` Atom 替换查询并执行同样的尾随空格规则。`/review` 只是查询/显示形式，
不是 Skill identity。Skill 不可用时保留 Atom，发送前由 Core 返回明确错误或既定降级结果；Composer 不重绑
同名 Skill。

## IME 与键盘

中文、日文、韩文 composition 期间，Typeahead 暂停更新，Atom 不插入，EditorState 不替换，Enter 不发送，
也不执行 DOM selection 恢复。compositionend 后基于最终普通文本重新计算查询。

- Enter：Typeahead 先同步决定是否消费；其返回 false 后，非 Shift、非 composition、Composer 非空且允许发送时提交；
- Shift+Enter：插入 LineBreak，领域文档导出为 Text 中的 `\n`；
- Escape：先关闭 Typeahead，再关闭 Atom 激活态，始终保留正文；
- Arrow Up/Down：仅在 Typeahead 打开时改变候选，否则保留正常光标行为；
- Backspace/Delete：普通文本遵循原生 Lexical 行为，Atom 整体删除；绝对起点保留 `onBackspaceAtStart`；
- Undo/Redo：覆盖输入、删除、粘贴、换行、Atom 插入/删除和选区替换；Catalog 与保存状态不进入历史。

<a id="锚定人物信息卡"></a>

## Atom 激活与人物信息卡

点击 Member Atom 时，编辑器从 DOM 定位 Lexical node，读取 `agentId` 并调用 Member 激活入口；点击 Skill Atom
读取 `skillId` 并调用 Skill 详情入口。激活只改变 presentation，不修改 `ComposerDocument`。

Member 人物信息卡保持非模态，宽 392px，采用“布局 2”：左侧 128px 受控 4:5 portrait，右侧依次显示名称、
团队角色、Presence、Agent 运行时、专业职责、工作准则和性格底色。它不是队员页链接、Dialog 或全局 Toast。
点击外部或 Esc 关闭，Popover 不设 focus trap；拖选文本不得误触打开。Atom 本身不进入独立 tab 顺序；需要
键盘激活时由编辑器 command 统一处理。

已移除、离开或不可解析队员按可见 fallback 静态显示，不能打开人物卡。队员头像和显示名在身份可操作时可复用
同一卡片，降级规则一致。

## Reply 与 Continuation

点击当前可寻址 Agent 消息的“回复”仍是明确 Member Atom 来源：Core 在设置 Draft reply target 的同一 revision
mutation 中把 canonical Member Atom 插入正文开头；已有相同 Atom 或 All Members 时复用。reply relation 本身
不参与发送寻址。原作者失效时保留引用并要求用户显式换人，不生成 lookalike、不删除意图、不回退 Default Lead。

“继续发给”仍只投影最近 accepted user message 的唯一非 Lead 显式接收者。第一次正文/附件 mutation 冻结后，
Core 在发送前物化 canonical Member Atom；对象失效时阻断并要求显式换人。用户手动改址后，即使删除全部 Member
Atom，也不从同一来源自动生成。

## Clipboard

Composer 选区 Copy/Cut 同时写：

- `text/plain`：Member 使用当前名称或 fallback、All Members 为 `@所有队员`、Skill 为 `/<nameAtSend>`、
  LineBreak 为 `\n`；
- `application/x-rovai-composer+json`：选区对应的 `ComposerDocument` V2，不是 Lexical JSON；RangeSelection 与
  键盘选中的 Atom NodeSelection 都必须产生对应投影；
- `text/html`：仅兼容可见文本，不拥有 identity。

粘贴时文件优先交给附件入口。没有文件时优先读取私有 MIME，严格校验 version、closed Segment/Atom shape 和
identity；当前 Catalog 中可恢复的引用还原为 Atom，不可恢复引用转换为普通可见文本。没有合法私有 MIME 时只
插入 `text/plain`，或把 HTML 解析为可见纯文本。

不得从纯文本 `@Alice`、`/review-code` 或外部 HTML 的 `data-reference-id`、`data-atom-type`、`data-skill-id`
猜测 identity。整条历史用户消息的专用复制入口继续保留文件链接原始 target，不因显示 label 丢失路径。

Draft 自动保存失败时 Composer 保留内容与 dirty 状态，显示可恢复的保存错误；当前 epoch 内可有限退避重试，发送
和 Camp 切换必须通过显式 flush 确认持久化后继续。普通 dirty/saving/saved 不提升到 Workspace，保存状态反馈不进入
EditorState 或 undo history。正文 autosave 回执不刷新整个 Workspace；批量附件只在批次开始前 flush 一次正文。

Draft 加载失败显示原位“草稿无法加载”和重新加载入口；此时正文、附件、Reply/Continuation 与发送全部禁用，不能
用 revision-zero 空 Draft 替代错误。ContentEditable 关闭浏览器 spellcheck。发送和路由 mutation 在第一个异步等待前
同步锁定 Lexical；Core 路由 mutation 改变 content 时在解锁前 authoritative-replace，发送成功则加载下一 Draft 后
replace。失败保留现有正文并恢复交互。

<a id="current-user-mention"></a>

## Current User Mention 与历史消息

只有 Core Structured Content 能生成历史消息中的 `@当前用户`。它与 Member Mention 使用相同行内色彩语言，
但不可交互、不进入 tab 顺序、不打开信息卡；可访问名称包含当前显示名称。它不是 Composer V2 Atom。

Agent 消息中的 Current User Mention 保持为 Markdown 正文之前的行内结构化前缀；其余权威 Structured Content
继续通过 sanitized GFM 呈现。正文里的 Agent Mention 在该路径只投影可见文本，显示名先按 Markdown literal
转义并折叠换行，不能注入链接、标题、代码或表格结构。

## Authority and regression

| 层级 | 权威入口 |
| --- | --- |
| Draft/Pending V2、identity、旧读新写与 exact revision | [Camp Composer Draft v9](../../contracts/camp-composer-draft-v9.md)与[Pending Camp Input v3](../../contracts/pending-camp-input-v3.md) |
| Lexical/React/Core 所有权、局部编辑、同步与 replacement | [Composer 架构](../../architecture/camp-composer-draft.md) |
| Reply/Continuation 来源、物化与无 fallback | [Composer Draft 不变量](../../architecture/foundational-invariants.md#camp-composer) |
| Renderer 视觉、Typeahead、Popover、IME、键盘与 Clipboard | 本文 |
| 自动化与打包 App 回归 | [结构化 Mention 门禁](../../development/ui-acceptance.md#结构化-mention-门禁) |

改为富文本/Markdown编辑、全局角色 Toast、页面跳转、模态 Dialog、每 Atom React Root 或其他信息架构属于产品
变更，必须同步更新本文、当前 Contracts/Architecture、Renderer 测试和真实 App 验收。历史原型只解释已确认的
信息卡选型，不是生产真源：[Mention Popover 原型](../../prototypes/mention-popover/README.md)。
