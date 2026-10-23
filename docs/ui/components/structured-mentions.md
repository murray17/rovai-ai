---
document_type: ui-component-contract
authority: renderer-composer-atoms-and-structured-mentions
status: accepted
last_updated: 2026-10-23
---

# 结构化 Mention 与 Composer Atom

<a id="不得回退的交互合同"></a>

## 产品边界

Composer 是结构化纯文本输入框，不是富文本、Markdown 或通用文档编辑器。`# title`、`**bold**`、
`- list`、`[link](url)` 都保留为普通字符；不提供 heading、文本样式、代码、引用、列表、表格、链接、
Markdown shortcut、HTML 富文本粘贴、Block 拖拽或协同文档编辑。

普通文本与不可拆分 Atom 是仅有的业务 primitive。Member、All Members、Skill、Thread Reference 和 Mission Reference 共用同一种 Atom 交互与
DOM 形态，但 identity、候选来源、激活行为和发送校验保持强类型。

## Atom 呈现与身份

可解析 Member Atom 在 Composer 与历史消息中默认显示为无底色、无边框的蓝色行内文字；Hover、选中或
信息卡打开时只使用既有 8% mention feedback。Skill 使用既有 Skill 行内语言。unavailable 状态保留可见标签，
通过弱化样式和明确状态反馈表达，不消失、不变回可编辑文字。

每个 Composer Atom 是 identity-only inline `DecoratorNode<null>`，只对应一个 `contentEditable=false` span DOM；
`decorate()` 返回 null，不得挂载独立 React Root、Portal 或 Catalog 订阅。Atom 内没有独立可聚焦按钮，光标不能
进入其中，键盘可以 NodeSelection，Backspace/Delete 一次删除整个 Atom。普通字符落在 Atom 前后的独立 TextNode。

Member 的唯一身份是 `agentId`，显示名称/头像从当前 Camp 成员或可邀请的队员资料解析；改名只刷新显示。
不可解析时保留 identity 和 fallback label，不按同名成员重新绑定。已离队但资料仍在的队员可以作为待邀请对象；
资料离线、已移除或身份缺失时按不可用显示。Skill 的唯一身份是 `skillId`，`nameAtSend` 保留发送时
语义/显示快照；当前描述、图标和来源不进入 Draft。Catalog 展示刷新不产生 dirty、Draft save 或 undo item。

## Member Typeahead

`@`、`@a`、`@alice` 只在折叠光标、普通 TextNode、非 composition，且 `@` 位于文本开头或允许分隔符之后时
打开。Member 与 Skill 共用一个 Trigger Plugin 和一个 Editor update listener；查询不得跨 Atom、换行或 Paragraph，
从当前 TextNode 的 caret 位置只分配光标左侧最多 128 个字符。方向键移动候选，Enter 选择，Esc 关闭；菜单消费
按键时不得触发发送。Enter/Tab 的归属不读取 React `menuOpen` 或渲染后的候选数组，而由 Typeahead 的 Lexical
critical-priority command 从当前 selection 同步重算 trigger：Catalog loading 时消费按键但不选择，ready 且有候选时
选择当前项，无 trigger 或 ready/error 且无候选时才交给普通发送行为。
当前候选必须保持在滚动区域内，并通过稳定 option ID 与编辑器的 `aria-activedescendant` 对应；
Member 与 Skill 菜单共享这项焦点同步，菜单关闭后移除该关联。

`@` 空查询先显示 `@所有队员` 和当前 Camp 可接收的队员，再显示“邀请其他队员”入口；该入口在长名册中仍须
处于可见候选上限内。邀请层和按名称／角色查询的队外候选，与会话内邀请弹窗共用新建对话的可用性规则：
资料为 `present`、已配置智能体，且 Runtime 为 `ready | light_ready | installed_unverified`；未配置或需要处理的队员不作为邀请候选。
进入邀请层后显示返回入口和符合此规则的队员。输入查询时按名称或团队角色查找，
当前 Camp 成员排在可邀请队员之前；队外候选标明邀请状态。普通 Member 候选主行显示当前名称，副行显示
团队角色；团队角色为空时显示“团队角色未设置”。副行不得使用所有候选共享的“Camp 成员”等占位文案。
All Members 候选继续显示广播说明，范围仍是发送时 Camp 中的全部可接收队员。

姓名和团队角色保留原文的 NFKC、大小写不敏感与有序子序列匹配，并增加本地拼音匹配。
例如“爱丽丝”可由 `@aili`、`@ailisi`、`@als`、`@al`、`@ail`、`@爱li` 找到；
全角和大写字母同样可用，`v` 或 `ü` 可匹配“吕”。拼音按相邻汉字的音节前缀匹配，
支持首字母、全拼和混输；多音字任一读音可命中，不把其中一个读音固化为姓名权威。
拼音查询不跳过中间汉字、不从音节中间开始，也不推断英文译名或别名。

此规则由公屏（含 Pending）和使命描述共用，只扩展候选召回；原候选顺序、可提及资格、
队内优先、邀请层、50 项上限与 IME composition 边界不变。选择后仍显示中文姓名并绑定
原 `agentId`；重名或同音的不同身份各保留一项。对话／使命标题与 Skill 搜索不使用此拼音规则。

会话与使命描述候选保持头像与两行紧凑布局：左侧为名称和团队角色，右侧只显示已有智能体产品图标。
图标为独立详情入口，点击不选择队员；浮层显示智能体名称和当前配置的模型，并提供提及该队员的动作。
姓名和头像区域仍直接选择队员，方向键与 Enter/Tab 的选择行为保持不变。关闭详情后保留输入位置；
点到其他目标时不抢回焦点。手机图标入口至少 44px，不依赖悬停才能获取名称与模型。
模型复用已有目录显示名，目录缺失时保留配置 ID；原生默认策略显示“智能体默认”，不推断实际运行模型。
悬浮标题及候选可访问名称包含完整智能体与模型。资料未载入和未配置智能体使用中性占位图标，详情分别
显示对应状态，不伪造模型。候选已按可提及资格过滤，不再显示“可用”圆点；队外“邀请／待邀请”位于图标左侧，
在整行内垂直居中。姓名、状态与图标共用整行高亮；广播、邀请与返回入口占满行宽，不预留空图标列。
信息刷新只影响展示，不改变 Atom 身份、查询范围、候选排序或发送语义。

选择 Member/All Members 后，匹配查询被一个 Atom 替换。右侧已有空白时复用；否则插入一个普通空格，并把
光标放在空格之后。查询或显示文本都不构成 identity。

队外 Member Atom 与在队 Member Atom 使用同一正文结构和逐处呈现。重复提及保留每一个 Atom；Composer 从当前
正文中的 `agentId` 去重派生“待邀请”名单，不维护第二份持久名单。删除最后一个该身份的 Atom 就取消待邀请；
删除部分重复 Atom 不取消。状态在路由轨提示“发送时邀请”，主按钮提示“邀请并发送”；待邀请身份只参与
这次本机发送流程，不会因为选中候选就提前改变 Camp 名册。
普通一键 Pending 草稿也提供相同候选、Atom 与提示；首次发送直接交给 Core 原子邀请、激活和发布，
不先调用单独加入命令。失败保留完整输入；本机恢复后仍按最新资料判定待邀请或不可用。
已选队外队员的配置或可用性失效时，正文 Atom 保留姓名并标为不可用，发送前使用最新资料重验；
邀请弹窗同步移除失效的待选项。此限制只约束新邀请，已有成员的提及仍按 membership 与 Presence 判断。

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
- Escape：候选/链接菜单优先；输入历史浏览时恢复原结构化草稿并消费事件，其余沿用 Atom 激活态关闭；
- Arrow Up/Down：Typeahead 优先；会话输入在文档绝对起点用 Up 回看，浏览中在绝对终点用 Down 前进。
  回看置于起点，前进置于终点；Down 越过最新项恢复草稿。有选区、修饰键或 IME 时保持原行为，
  非浏览中的 Down 不接管。见 [Input History v1](../../contracts/input-history-v1.md)；
  Mission 等非会话编辑器保持原行为；
- Backspace/Delete：普通文本遵循原生 Lexical 行为，Atom 整体删除；绝对起点保留 `onBackspaceAtStart`；
- Undo/Redo：覆盖输入、删除、粘贴、换行、Atom 插入/删除和选区替换；Catalog 与保存状态不进入历史。

<a id="锚定人物信息卡"></a>

## Atom 激活与人物信息卡

点击 Member Atom 时，编辑器从 DOM 定位 Lexical node，读取 `agentId` 并调用 Member 激活入口；点击 Skill Atom
读取 `skillId` 并调用 Skill 详情入口。激活只改变 presentation，不修改 `ComposerDocument`。

Member 人物信息卡保持非模态，默认宽 376px，采用单列：紧凑头像、名称、团队角色与 Presence 对齐；正文优先展示专业职责，
智能体、模型和思考强度保留但降低强调。性格底色、工作准则与成长课题在默认收起的“更多设定”中，
更多设定排在运行配置之前，性格以普通文字排列；运行配置作为低强调度页脚，模型与强度紧凑并列。
空字段不占位。它不是队员页链接、Dialog 或全局 Toast。长内容在视口内滚动，手机关闭点击区至少 44px。
正常配置时智能体一栏只显示产品名称（例如 `Codex CLI`）；未配置或异常时才附加必要状态。
点击外部或 Esc 关闭，Popover 不设 focus trap；拖选文本不得误触打开。Atom 本身不进入独立 tab 顺序；需要
键盘激活时由编辑器 command 统一处理。

已移除或不可解析队员按可见 fallback 静态显示，不能打开人物卡。待邀请队员的 Atom 保持静态并显示发送时
加入的可访问名称；队员头像和显示名在身份可操作时可复用
同一卡片，降级规则一致。

## Reply 与 Continuation

点击当前可寻址 Agent 消息的“回复”仍是明确 Member Atom 来源：Renderer 用已经可见的完整消息建立 Camp-local
reply intent，并把 canonical Member Atom 插入正文开头；已有相同 Atom 或 All Members 时复用。reply relation 本身
不参与发送寻址。原作者失效时保留引用并要求用户显式换人，不生成 lookalike、不删除意图、不回退 Default Lead。

“继续发给”仍只投影最近 accepted user message 的唯一非 Lead 显式接收者。Desktop 把 intent 写入同一 Camp-local
snapshot，并在发送前物化 canonical Member Atom；对象失效时阻断并要求显式换人。用户手动改址后，即使删除全部 Member
Atom，也不从同一来源自动生成。

## Clipboard

Composer 选区 Copy/Cut 同时写：

- `text/plain`：Member 使用当前名称或 fallback、All Members 为 `@所有队员`、Skill 为 `/<nameAtSend>`、
  LineBreak 为 `\n`；
- `application/x-rovai-composer+json`：选区对应的 `ComposerDocument` V2，不是 Lexical JSON；RangeSelection 与
  键盘选中的 Atom NodeSelection 都必须产生对应投影；
- `text/html`：仅兼容可见文本，不拥有 identity。

粘贴时文件优先交给附件入口。没有文件时优先读取私有 MIME，严格校验 version、closed Segment/Atom shape 和
identity；当前 Catalog 中可恢复的引用还原为 Atom，不可恢复引用转换为普通可见文本。只有恢复后仍包含实际
Member、All Members 或 Skill Atom 的内容优先按结构化粘贴。仅含文字的内部文档使用文档自身的完整正文，
同样参与下面的长文本阈值判断；不能因带私有 MIME 而豁免，也不被并行的 `text/plain` 截短或替换。
没有合法私有 MIME 时使用 `text/plain`，或把 HTML 解析为可见纯文本。

仅公屏消息输入框（已有与新建 Thread）通过调用方可选回调启用单次长文本附件化；使命描述和单聊不启用。
只在 paste 的普通文本分支对本次最终纯文本按 Unicode 码点计数：不超过 10,000 时正常插入，超过时
将完整 UTF-8 内容写为 `.txt`，保留空格、Tab 和换行。文件名从 `粘贴内容-1.txt`（英文 `Pasted-text-1.txt`）起，仅避开当前已添加和
待准备附件的显示名；Main 在所属 Thread 输出目录写入 UUID 文件，沿用原附件卡片、预览、草稿与发送。转换成功不改正文，
包括已有选区；成功后只显示附件卡片，不追加成功提示。无正文占位符或永久保存承诺。

长文本附件在既有串行准备队列内按最新草稿数量检查加入后的附件上限。原文保留到原草稿接纳结果明确：
未接纳时，在该准备任务结束前追加到原编辑器当前正文末尾，移除本次被回填替代的失败附件卡并轻提示；
已接纳后发生本地保存、Pending presence 或发送错误时沿用既有错误处理，不重复回填。Pending 本地保存成功
即已接纳，不能把后续 presence 拒绝当作未接纳。回填不表示持久保存成功，后续保存失败继续保留编辑器与错误。
发送按钮禁用和离开前等待沿用原行为，不记忆一次点击并自动发送。不增加位置追踪、跨 Thread 后台恢复、
自动重试、累计正文检测、输入预算预判或选中文本转换。

移除未进入发送流程的生成附件，先成功保存移除后的本机草稿，再等待异步删除并清登记。曾进入发送流程的
文件只移除引用，保留到会话删除。清理失败用轻提示说明，允许继续编辑；外部文件和发送成功后的源文件不删除。
发送成功后先保存新草稿，再释放旧登记，保存失败保留恢复能力。普通弹窗零消息 Active 不按 Pending 清理；
一键 Pending 的附件仍在时不是空草稿。存储、保护和失败边界见 [Composer Draft v20](../../contracts/camp-composer-draft-v20.md)。

不得从纯文本 `@Alice`、`/review-code` 或外部 HTML 的 `data-reference-id`、`data-atom-type`、`data-skill-id`
猜测 identity。整条历史用户消息的专用复制入口继续保留文件链接原始 target，不因显示 label 丢失路径。

Draft 自动保存失败时 Composer 保留内容与 dirty 状态，显示可恢复的保存错误；当前 epoch 内可有限退避重试，发送
和任何会卸载或替换当前 Camp Composer 的普通导航必须通过显式 flush 确认持久化后继续。普通 dirty/saving/saved 不提升到 Workspace，保存状态反馈不进入
EditorState 或 undo history。正文 autosave 回执不刷新整个 Workspace；批量附件只在批次开始前 flush 一次正文。

Draft 加载失败显示原位“草稿无法加载”和重新加载入口；此时正文、附件、Reply/Continuation 与发送全部禁用，不能
用 revision-zero 空 Draft 替代错误。ContentEditable 关闭浏览器 spellcheck。发送和路由 mutation 在第一个异步等待前
同步锁定 Lexical；Core 路由 mutation 改变 content 时在解锁前 authoritative-replace，发送成功则加载下一 Draft 后
replace。失败保留现有正文并恢复交互。

<a id="current-user-mention"></a>

## Current User Mention 与历史消息

默认路由的本地用户或 External Principal 历史消息可由 Renderer 根据消息冻结的唯一
`addressedAgentId`，在可见正文前派生一个 Member Mention。它复用本节的行内色彩、人物卡和不可用降级，
但使用 `data-quote-exclude` 与用户原文边界隔离：不是 Structured Content，不改变复制、引用定位、搜索、
`camp.read` 或 Agent 路由。显式 Member Mention 仍只来自权威 Structured Content，不得从正文或显示前缀反推身份。

发送受理后，本机临时展示的结构化 Member Mention 若尚无名册行，可以按同一 `agentId` 的现有、未移除队员资料
保留姓名；资料为 `present` 或 `away` 都不抹去该身份的姓名。静态提示“正在同步队员名册”，不提前开放人物卡、
不补造成员行或改变发送资格。该展示补充只从仍待
投影的已受理消息派生，名册到达后收敛回成员状态；明确离队或资料已移除的名册行仍按不可用显示。
正文、复制、历史回复预览和消息导航摘要共用这份临时名称解析，不从普通文本猜测身份。

Current User Mention 从 Desktop 当前个人资料解析名称；保存后历史结构化 `@你` 立即显示为新名称。
普通文本、代码和外部引用中的同名字面字符不替换。作者栏、复制投影和历史回复预览的当前资料规则见
[Current User Profile v1](../../contracts/current-user-profile-v1.md)，不改变 Core 的 Agent 上下文投影。

只有 Core Structured Content 能生成历史消息中的 `@当前用户`。它与 Member Mention 使用相同行内色彩语言，
点击或聚焦后按 Enter/Space 打开当前用户资料卡；可访问名称包含当前显示名称。它不是 Composer V2 Atom。
会话中的本人消息头像打开同一卡片。卡片宽 240px，仅显示 160px 圆形头像和名称，不显示“个人资料”文案；
保存资料后，已打开卡片同步刷新。点击外部或 Escape 关闭；键盘打开时焦点进入卡片，Escape 将焦点返回触发点。
沿用队员信息卡的视口避让和单卡片互斥，选中文字时不因点击误打开。

Agent 消息中的 Current User Mention 可为前缀，也可位于任意已解析位置；全部从当前用户资料读取昵称，
保留所在位置及周围 sanitized GFM。前缀继续复用既有呈现；非前缀和重复提及通过来源无碰撞的内部占位与可信 UI 绑定，
碰撞检查覆盖完整原始文本及独立于块语法的实体解码视图，缩进区域也显示真实昵称。
不按字面名称解析 Markdown，不把昵称拼成 Markdown。正文里的 Agent Mention 在该路径只投影可见文本，显示名先按 Markdown literal
转义并折叠换行，不能注入链接、标题、代码或表格结构。

## Authority and regression

| 层级 | 权威入口 |
| --- | --- |
| public Composer 本地所有权、发送快照、失败保留与退出边界 | [Camp Composer Draft v16](../../contracts/camp-composer-draft-v16.md)与[Pending Camp Activation v5](../../contracts/pending-camp-activation-v5.md) |
| Lexical/React/Core 所有权、局部编辑、同步与 replacement | [Composer 架构](../../architecture/camp-composer-draft.md) |
| Reply/Continuation 来源、物化与无 fallback | [Composer Draft 不变量](../../architecture/foundational-invariants.md#camp-composer) |
| Renderer 视觉、Typeahead、Popover、IME、键盘与 Clipboard | 本文 |
| 自动化与打包 App 回归 | [结构化 Mention 门禁](../../development/ui-acceptance.md#结构化-mention-门禁) |

改为富文本/Markdown编辑、全局角色 Toast、页面跳转、模态 Dialog、每 Atom React Root 或其他信息架构属于产品
变更，必须同步更新本文、当前 Contracts/Architecture、Renderer 测试和真实 App 验收。历史原型只解释已确认的
信息卡选型，不是生产真源：[Mention Popover 原型](https://github.com/murray17/rovai-ai/blob/0de773a75231038e384c03cd761fea56344a6e4f/docs/prototypes/mention-popover/README.md)。

## 公开引用候选

公开 `@` 面板为队员／对话／使命三个 30px 标签，不显示“全部”、标题或键盘操作说明。
成员保持既有头像、角色、Runtime 和邀请图标。搜索包括会话外可邀请成员；模糊匹配按队员、对话、使命
优先选择首个有结果的类别。等待期间只显示“搜索中…”，不逐个切换标签。手动切换固定本次 `@` 的类别；
新一次触发重新自动选择。空结果仅“无匹配结果”。

对话和使命候选为 32px 单行：既有无底色图标、左标题、右项目，两者独立省略。不显示时间、状态、编号、
总数或最近条数提示。同名项仍按稳定 ID 选择。初始和每次追加最多 8 条；“加载更多”为无分隔线的弱文字，
重复加载被禁止，追加保留滚动位置，结束隐藏。面板最高 min(482px,65vh)，内部滚动，超过 40 条窗口化；
键盘当前项必须挂载且可见，50 条之后仍可选择。

引用 Atom 共用现有输入法、撤销/重做、光标、删除、剪贴板与恢复机制，前置对应对话/使命图标。
历史显示发布标题；详情按当前 ID 读取可用性并打开来源，不按同名绑定。不可用保留标签及移除/重选入口。
私聊和使命描述不提供引用候选。内容与事务权威见 [Thread Reference v1](../../contracts/thread-reference-v1.md)。
