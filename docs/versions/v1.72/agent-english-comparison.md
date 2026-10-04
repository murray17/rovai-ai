# Agent 英文指令 r5：完整文本对照

这是[已确认变更说明](model-context-change-agent-english.md)的完整文本附件。审阅基线为
`8991ca69705d1d523d061b3e43d776b3f8a7925f`，2026-09-30 确认。以下文本与已审阅 r5 一致。
30 份 Markdown 提供逐字原文和完整替换文本，末尾列出三处运行时／CLI 字符串。

## 先看索引 description
这些描述会参与 Skill 选择；正文按需读取。后面的全文区保留完整 frontmatter。
| Skill | 变更前 | 建议英文 |
| --- | --- | --- |
| cli-operations | 当不确定当前工作应使用 CampMessage、持久 Task、Camp/History 检索还是 Memory，需要由 Default Lead 并行征集多个成员后统一综合，普通消息是否应升级为 Task，一次业务事件需要协调多个 Rovai 操作，需要协调使命内容、状态与公开消息，或 CLI 返回后需要根据最新状态选择恢复动作时使用。普通单一操作及其具体收件人或参数应直接查看对应操作帮助，不要因此自动加载本 Skill。 | Choose among Rovai messages, Tasks, Missions, history and Memory; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly. |
| memory-stewardship | 当用户明确要求记住、更正或停止沿用某项长期信息，或当前内容包含会影响未来协作的稳定偏好、约定或经验时使用。先检查相关 Memory，再决定新增、修订、转交用户治理或不写入。临时状态、当前任务进度、项目事实、敏感信息和无依据推测不使用。 | Maintain durable collaboration preferences, agreements and lessons when the user asks to remember, correct or stop using them, or current evidence warrants capture. Excludes temporary work, project facts, sensitive data and speculation. |
| campfire | 当用户希望 Camp 中多位成员共同讨论、从不同角度分析、比较方案、评估利弊或讨论后形成建议时使用。主持人发起和继续整理讨论，成员在收到本次讨论任务时也使用。普通单人问题、无关发言、迟到补充和已经结束的讨论不使用。 | Run a Camp discussion with several members to compare perspectives, options or tradeoffs and produce shared notes. Applies to the host and invited contributors throughout that discussion; excludes solo work, unrelated messages and closed discussions. |
| grill-duo | 当用户希望在 Camp 中通过持续追问和一位固定搭档的独立复核，澄清或压力测试计划、需求、设计或决定时使用。邀请者继续处理用户回答或当前搭档建议，成员收到普通双人追问复核任务时也使用。普通单人问答、多人讨论、需要同步维护领域词汇或 ADR 的追问、无关发言和已经结束的会话不使用。 | Clarify or stress-test a plan, requirement, design or decision through user questions and one fixed Camp partner's independent review. Applies to the initiator and invited reviewer during that exchange; use grill-duo-with-docs when confirmed project documentation must also be maintained. |
| grill-duo-with-docs | 当用户希望在 Camp 中通过持续追问和一位固定搭档的独立复核，澄清计划或设计，并同步维护已确认的领域词汇、当前权威文档或版本决策记录时使用。邀请者继续处理用户回答或当前搭档建议，成员收到文档版双人追问复核任务时也使用。普通单人问答、无需维护领域文档的追问、多人讨论、无关发言和已经结束的会话不使用。 | Clarify a plan or design with one fixed Camp reviewer while maintaining confirmed domain language, current specifications and version decisions. Applies to the initiator and invited reviewer during that exchange; excludes solo questions, group debates and questioning without documentation work. |
| member-studio | 当用户希望创建新的 Rovai 队员，或继续调整、确认本次创建中尚未写入的队员名牌和头像方案时使用。普通成员资料咨询、编辑已创建队员，以及只设计角色或头像但不加入名册的任务不使用。 | Use to create a Rovai member or revise and confirm the unsaved identity card and avatar for that creation. Exclude profile questions, edits to existing members, and character or avatar designs without roster creation. |
| review-duo | 当用户希望由两位 Camp 成员共同审查一份明确的代码改动，并分别检查代码质量与需求符合度时使用。当前评审者发起、完成需求检查和整理报告，固定搭档收到本次规范与质量检查请求时也使用。普通单人评审、没有明确改动范围，以及只要求修改代码而未要求双人评审的任务不使用。 | Review a defined code change with two Camp members independently checking standards, quality and requirements. Applies to the initiator and invited reviewer through the final report; excludes solo review, undefined scope and implementation-only requests. |
| analyze-agent-codebase | 当用户希望依据源码、配置、schema 和测试，分析 Coding Agent、Agent 框架或多 Agent 系统的真实架构、执行流程、上下文、记忆、工具、权限或扩展点时使用。继续回答同一分析中的定向机制问题或整理专题文档时也使用。普通代码评审、实现或修复任务，以及不需要仓库证据的概念问答不使用。 | Use to analyze an agent system's architecture or mechanisms from repository evidence, including follow-up questions and analysis documents. Exclude ordinary code review, implementation, fixes, and conceptual questions that need no repository evidence. |
| worktree | 当用户明确要求使用 Git worktree，或需要为一项独立开发工作创建、查找、复用、交接或清理隔离工作目录时使用。普通只读任务、非 Git 仓库，以及当前工作无需独立分支或工作目录时不使用。 | Use when the user requests a Git worktree or a development task needs an isolated directory to create, find, reuse, hand off, or clean up. Exclude read-only work, non-Git repositories, and tasks that need no separate branch or directory. |

## 全文导航
- [01 cli-operations](#skill-01)
- [02 memory-stewardship](#skill-02)
- [03 campfire](#skill-03)
- [04 grill-duo](#skill-04)
- [05 grill-duo-with-docs](#skill-05)
- [06 member-studio](#skill-06)
- [07 review-duo](#skill-07)
- [08 analyze-agent-codebase](#skill-08)
- [09 worktree](#skill-09)

<a id="skill-01"></a>

## 01 cli-operations

### `skills/cli-operations/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: cli-operations
description: 当不确定当前工作应使用 CampMessage、持久 Task、Camp/History 检索还是 Memory，需要由 Default Lead 并行征集多个成员后统一综合，普通消息是否应升级为 Task，一次业务事件需要协调多个 Rovai 操作，需要协调使命内容、状态与公开消息，或 CLI 返回后需要根据最新状态选择恢复动作时使用。普通单一操作及其具体收件人或参数应直接查看对应操作帮助，不要因此自动加载本 Skill。
---

# Rovai CLI 操作协调

## 快速路径

普通单一操作直接查看对应操作的 `--help`，无需加载 references。
操作不明确时查看 `rovai --help`；Task 子命令不明确时查看 `rovai task --help`。

## 选择操作

先判断用户需要留下什么领域事实：

- Camp 中可见的答复、进展说明、问题或一次性协作消息：选择 CampMessage。
- 查找或读取使命定义，或修改当前使命内容与整体状态：选择 Mission。
- 当前 Default Lead 要把同一主题并行交给多个成员：选择一条带多个 `--to` 的普通 CampMessage；成员回复分别进入发起者的普通队列。
- 跨 AgentRun 仍需追踪、可独立交接和验收的责任：选择 Task。
- 查找 Camp、消息或稳定 ID 对应的历史事实：选择 Camp/History 读取。
- 跨未来 AgentRun 仍有价值的稳定偏好、约定或经验：转交 Memory 治理判断。

边界不清时，优先选择最小且能完整表达用户意图的领域对象。不要用 Task 代替普通公开消息，也不要用
Memory 代替 Task、项目文档或历史证据。

## 协调多步流程

1. 先读取做决定所需的权威状态，再执行 mutation。
2. 为每一步选择一个具体 operation，并查看它自己的精确 `--help`。
3. 每次调用只使用该 operation 接受的一种输入来源。
4. 检查 compact business result；只有已提交的 operation 可以作为后续步骤的事实。
5. 如果当前责任需要 Camp 中的公开答复，在结束前成功发送 CampMessage。

一次 operation 成功只证明该 Rovai operation 已提交，不证明下游执行完成、整体工作质量、测试、评审
或用户意图已经满足。

## 按需读取

- 需要协调使命内容、状态与公开消息时，读取 [Mission](references/mission.md)。

- 需要决定公开消息、Agent routing、User attention 或是否无需 Task 时，读取
  [Send](references/send.md)。
- 需要并行邀请成员或决定成员回复路由时，读取 [Send](references/send.md)。
- 需要判断消息是否升级为持久责任，或协调 Task 与消息 linkage 时，读取
  [Task](references/task.md)。
- 需要在当前 Camp、指定 Camp、跨 Camp 历史或稳定 ID exact read 之间选择时，读取
  [Camp 与 History](references/camp-history.md)；该 reference 同时定义裸 `rovai camp read` 的默认
  Timeline 行为、message-anchored 显式模式和 cursor 延续规则。
- 需求可能属于长期记忆时，读取 [Memory 路由](references/memory.md)，随后使用
  `$memory-stewardship`；此处不替代 Memory 治理。
- CLI 返回 `error.recovery`，尤其要求 refresh 或确认结果时，读取
  [Recovery](references/recovery.md)。

多步需求可以读取多份直接相关的 reference；不要为了普通单一 operation 预读全部文件。
````

#### 建议英文（完整替换）

````markdown
---
name: cli-operations
description: Choose among Rovai messages, Tasks, Missions, history and Memory; coordinate parallel member requests, multi-step operations or recovery. For one known operation, use its command help directly.
---

# Rovai CLI coordination

Use `rovai --help` to find an operation and its exact `--help` for syntax. Read only the references needed by the current decision. Write user-facing prose in the user's language.

## Choose the result to preserve

| Need | Operation family |
| --- | --- |
| Public answer, progress, question or one-time collaboration | CampMessage |
| Shared objective or whole-Mission status | Mission |
| Default Lead requests independent work from several members | One CampMessage with repeated `--to`; replies return separately |
| Responsibility that survives Runs and can be handed off and accepted independently | Task |
| Camp or message evidence | Camp/History |
| Durable collaboration preference, agreement or lesson | Memory governance |

Choose the smallest object that fully serves the request. Tasks own durable responsibilities; project sources and history own their facts.

## Coordinate operations

1. Read the authoritative state needed for the decision.
2. Use one supported input source per call, following that operation's help.
3. Inspect the committed business result before taking the next step.
4. Publish any required Camp-visible answer before ending the Run.

A successful operation proves its own commit, not downstream execution, validation or completion of the user's objective.

## References

- [Send](references/send.md): public messages, Agent routing, parallel invitations and Principal attention.
- [Task](references/task.md): durable responsibility and Task-linked messages.
- [Mission](references/mission.md): objective, status and public explanation.
- [Camp/History](references/camp-history.md): search scope, exact reads and pagination.
- [Memory](references/memory.md): route durable information to `memory-stewardship`.
- [Recovery](references/recovery.md): follow `error.recovery`, especially uncertain outcomes.
````

### `skills/cli-operations/references/camp-history.md`

#### 变更前（完整文件）

````markdown
# Camp 与 History：选择读取范围

根据问题需要的范围选择最窄读取：

- 列出可见 Camp 或取得 Camp ID：`rovai camp list --help`
- 在当前 Camp 内搜索消息：`rovai camp search --query "amount"`
- 在一个已知、可访问的历史 Camp 内搜索消息：
  `rovai camp search --camp-id "<camp-id>" --query "amount"`
- 已有稳定 message ID，或需要 timeline/thread 分页：`rovai camp read --help`
- 不知道消息属于哪个 Camp，需要跨 Camp 搜索：`rovai history search --help`

## `camp.read` 读取形态

`rovai camp read` 读取当前 Camp 最新的 20 条可见消息；`--camp-id` 只改变目标 Camp。四种 canonical
调用直接由字段表达，不使用 mode 或 direction：

```bash
rovai camp read --limit 20
rovai camp read --before <nextCursor>
rovai camp read --message-id "<message-id>"
rovai camp read --thread "<message-id>" --limit 20
```

Timeline 和 thread 都从最新/锚点向更早消息读取；继续分页时，把返回的 `nextCursor` 传给
`--before`。`--message-id` 是完整单条读取，不能与 `--thread`、`--before` 或 `--limit` 组合。

`camp.search` 和 `camp.read` 都只解析一个 Camp target：省略 `--camp-id` 时是当前 Camp，显式传入时是
当前 AgentRun 冻结 Manifest 中仍有实时访问权的那个历史 Camp。显式传入当前 Camp ID 与省略完全等价；
不会因为省略而搜索全部历史 Camp，也不会仅凭 `messageId` 跨 Camp 反查。

标准调用链：

```text
目标 Camp 未知
  → rovai history search --query "amount"
  → 取得 campId + messageId
  → rovai camp read --camp-id "<camp-id>" --message-id "<message-id>"

目标 Camp 已知
  → rovai camp search --camp-id "<camp-id>" --query "amount"
  → 取得 messageId
  → rovai camp read --camp-id "<camp-id>" --message-id "<message-id>"
```

读取当前 Camp 时可省略范围：

```bash
rovai camp read --message-id "<message-id>"
```

`rovai send` 仍然隐式使用当前 authenticated AgentRun Camp；它不接受 Agent 提供 `campId`。

优先 stable-ID exact read 验证具体消息。搜索结果用于发现，不应替代 exact item 的权威字段；需要确认
Agent recipients 或 Current User Mention 时，读取 exact item 的 `addressing`。

跨 Camp 搜索只用于用户确实需要更宽历史范围时。不要为了确认一次 mutation 的 outcome，用正文、作者、
时间或近似搜索猜测 invocation identity；这种情况遵循 [Recovery](recovery.md)。
````

#### 建议英文（完整替换）

````markdown
# Camp and history

Choose the narrowest scope that answers the question:

| Need | Command |
| --- | --- |
| Find accessible Camps or a Camp ID | `rovai camp list --help` |
| Search the current Camp | `rovai camp search --query "amount"` |
| Search a known historical Camp | `rovai camp search --camp-id <camp-id> --query "amount"` |
| Read an exact message or a timeline/thread page | `rovai camp read --help` |
| Find a message whose Camp is unknown | `rovai history search --help` |

## Read forms

Bare `rovai camp read` returns the latest 20 visible messages in the current Camp. `--camp-id` changes only the target Camp.

```bash
rovai camp read --limit 20
rovai camp read --before <nextCursor>
rovai camp read --message-id <message-id>
rovai camp read --thread <message-id> --limit 20
```

Timeline and thread pages move from the latest message or anchor toward older messages. Continue with the returned `nextCursor` as `--before`. Exact `--message-id` reads return the full message and cannot combine with `--thread`, `--before` or `--limit`. There are no mode or direction fields.

Search/read resolve one Camp: omitted scope means the current Camp; an explicit historical target must belong to the current Run's frozen access scope and remain accessible. An explicit current Camp ID is equivalent to omission. A message ID alone does not search across Camps.

When the Camp is unknown, use history search to obtain `campId` and `messageId`, then read that exact pair. When the Camp is known, search there if needed, then read the exact message. Inspect the exact item's `addressing` when recipients or Principal mentions matter; snippets are discovery aids.

Cross-Camp search requires a real need for wider history. An uncertain mutation outcome follows [Recovery](recovery.md); similar text, author or time cannot prove invocation identity. Send always uses the authenticated current Camp and accepts no caller-supplied Camp ID.
````

### `skills/cli-operations/references/memory.md`

#### 变更前（完整文件）

````markdown
# Memory：只做领域路由

当信息可能是跨未来 AgentRun 仍有价值的稳定偏好、未来协作约定或可复用经验时，使用
`$memory-stewardship` 判断是否应进入 Memory、选择 Scope/Kind、查重、读取和执行最小 mutation。

根据该 Skill 的决定，再查看具体 operation：

- `rovai memory view --help`
- `rovai memory search --help`
- `rovai memory read --help`
- `rovai memory write --help`

Hearth、Companion 与 directed Relationship 都通过 `memory write`；Hearth 的成功结果是
`review_pending`，不是已生效 Memory。Mutual Relationship 与 Lifecycle/Forget/Review decision 只属于
structured user governance。

本 reference 不拥有 Memory 的 authority 顺序、Entrypoint/cache state、安全边界、Revision、正文或
retrieval-key 限制；这些规则全部由 `$memory-stewardship` 管理，不能用这里的 CLI 路由摘要替代。

当前任务、临时计划、项目事实、历史证据或需要追踪的责任分别属于 Task、项目权威来源或 Camp/History，
不要为了跨 Run 可见而一律写成 Memory。
````

#### 建议英文（完整替换）

````markdown
# Memory routing

Use `memory-stewardship` for stable preferences, future collaboration agreements or reusable lessons. It owns eligibility, Scope/Kind, duplicate checks, authority, safety and the minimum write.

After that decision, read the relevant `rovai memory view|search|read|write --help`. Hearth, Companion and directed Relationship use `memory write`. Hearth success is `review_pending`, not effective Memory. Mutual Relationship and lifecycle, forgetting and review decisions belong to structured user governance.

Tasks, temporary plans, project facts and historical evidence belong to their existing authoritative sources. Cross-Run visibility alone is not a reason to store Memory.
````

### `skills/cli-operations/references/mission.md`

#### 变更前（完整文件）

````markdown
# Mission：使命读取与当前使命协作

已知使命 ID 时直接 get；需要查找时才 list。读取其他使命不会切换当前使命，
update/status 仍只修改当前公共 Camp 的使命。标记 needs_you/completed 前先公开说明，
再用该消息的 sourceMessageId 更新状态；已有说明直接复用。

Mission 保存共同目标，Task 保存可独立交接的责任；不要为使命自动创建同名 Task。
编辑描述只整理已明确的目标，不自行扩大授权或删减要求。

按整体使命选择状态：

- `not_started`：尚未开始，或退回等待安排。
- `in_progress`：正在推进目标，包括无需 Principal 介入的正常等待。
- `needs_you`：确有需要 Principal 回答、决定或处理的事项。
- `completed`：整体目标已经交付，不是自己的局部分工或本轮 Run 结束。

仅回答既有结果的解释性问题，不重开使命。

不要根据最新 Turn 是否提及 Principal 推断或改写 Mission 状态。公开消息和 `--to-principal` 都不会
自动改变状态；只有明确需要更新整体 Mission 状态时，才单独调用 `mission status`。

收到 `mission_start` 时，先用 mission get 读取当前完整定义，再开展工作；普通消息沿用本轮真实输入。
只提交要修改的字段；同字段后提交覆盖，无需读取或提交版本。结果不确定时，按 [Recovery](recovery.md) 处理。
````

#### 建议英文（完整替换）

````markdown
# Mission

Get a known Mission directly; list only to discover one. Reading another Mission does not switch context: update/status still affect the current public Camp's Mission.

`sourceMessageId` is optional for every status, including `needs_you` and `completed`. Update status directly; link a relevant existing public message only when useful. A Mission owns the shared objective; a Task owns independently transferable responsibility. Do not automatically create a duplicate Task. Edit only the established objective and requirements.

Choose status for the whole Mission:

| Status | Meaning |
| --- | --- |
| `not_started` | Work has not begun or has returned to scheduling |
| `in_progress` | Work is advancing, including normal waits without Principal intervention |
| `needs_you` | The Principal must answer, decide or act |
| `completed` | The entire objective has been delivered |

A local assignment or Run ending does not complete the Mission. Explaining an existing result does not reopen it. A public message or `--to-principal` does not itself change status; call `mission status` only when the whole Mission's state changes.

On a request to start the Mission, read its full current definition with `mission get` first. For other messages, follow the actual current input. Submit only changed fields; later writes to the same field win, with no version parameter. Use [Recovery](recovery.md) for uncertain results.
````

### `skills/cli-operations/references/recovery.md`

#### 变更前（完整文件）

````markdown
# Recovery：按业务指令恢复

把 CLI 的 `error.recovery` 当作下一步分类，不要仅凭错误文案猜测或盲目重试：

- `fix_input`：查看目标 operation 的精确 `--help`，修正闭合输入；不要尝试未声明字段。
- `refresh_then_decide`：重新读取权威对象，比较当前状态，再决定是否提交一项新的 mutation。
- `retry_same_request`：只按返回指示，用同一 request identity 做有界重试。
- `stop`：停止该操作并准确报告未提交。
- `confirm_outcome`：先判断返回是否包含可验证本次结果的权威 locator。

## `confirm_outcome`

有权威 CampMessage locator 时，查看 `rovai camp read --help`，用 stable message ID 做 exact item read，
再根据权威状态决定后续动作。当前 AgentRun 可以核验自己已提交的这条精确消息；该例外不允许
读取边界后的邻域、thread、timeline、search 或其他作者/Run 的消息。成功 Send 只证明消息与冻结
效果已提交；缺少下游完成不能反推 Send 失败。

没有 locator 时，公开说明 outcome 不确定并停止该 mutation。不得按正文、作者、时间或相似内容搜索，
不得猜测 request identity，也不得换 request identity 重发。近似命中既不能证明成功，也不能证明失败。

恢复之后仍要分别验证后续业务目标；CLI success 不证明测试、评审、交付或用户意图已经满足。
````

#### 建议英文（完整替换）

````markdown
# Recovery

Follow `error.recovery`, not guesses based on error wording:

| Recovery | Next action |
| --- | --- |
| `fix_input` | Read exact help and correct supported fields |
| `refresh_then_decide` | Read authoritative state, then decide whether a new mutation is needed |
| `retry_same_request` | Retry within the returned bounds using the same request identity |
| `stop` | Stop the operation and report that it did not commit |
| `confirm_outcome` | Check for an authoritative locator for this invocation |

## Uncertain outcome

With an authoritative CampMessage locator, read that stable message ID exactly and decide from its current state. The current Run may verify its own committed message; this exception does not allow a later neighborhood, thread, timeline, search, or another author/Run's messages. Missing downstream completion does not imply Send failure.

Without a locator, report the uncertain outcome and stop the mutation. Do not search by similar content, author or time, guess request identity, or resend with a new identity. Approximate matches prove neither success nor failure.

After recovery, verify the remaining business objective separately; CLI success does not prove tests, review or delivery.
````

### `skills/cli-operations/references/send.md`

#### 变更前（完整文件）

````markdown
# Send：一次公开协作事件

使用 `rovai send --help` 获取当前闭合输入、约束和短例子。

一个 Send 可以产生三个彼此正交的效果：

- **Public message**：在当前 authenticated AgentRun 的 Camp 中留下所有参与者可见的 CampMessage。
- **Agent routing**：向一个或多个 Agent 建立冻结 Delivery；只有 Agent recipient 参与 routing。
- **User attention**：把普通公开消息升级为需要当前用户特别处理的 attention；它不创建 Agent recipient 或 Delivery。

只需要公开记录时，发送 public-only message。需要某位 Agent 继续处理时增加 Agent routing。只有本条消息
产生新的、未解决的用户决定、回答或行动时，才增加 User attention。User attention 不是给用户创建 Task，
也不是把用户算入 Agent recipient cardinality。

## User attention

普通 CampMessage 已经对用户可见。

`--to-user` 是 attention escalation，不是普通 visibility，也不是另一种 recipient。只有当前消息新产生了
一个尚未解决的用户决定、回答或行动，或者用户明确要求重要异步结果通知时才使用。

不要在以下情况使用：

- 内部 Agent routing；
- 评审和交接；
- 常规进度；
- acknowledgement；
- 普通最终回复；
- 因为上一条消息提及了用户；
- 因为当前消息使用了 `--to`。

User attention 只属于当前消息，不会被 reply、Task、父子 AgentRun 或下游 A2A 继承。

默认由承担用户侧闭环责任的 Agent 决定是否提醒用户。内部评审或子任务 Agent 应把结果返回调用方，而
不是沿协作链继续提醒用户。该责任分工是 Agent 使用指导，不是 Core authorization 或角色拒绝规则。

`--to` 与 `--to-user` 只有在用户和 Agent 各自拥有相互独立的行动时才组合。如果 Agent 工作依赖用户
决定，先请求用户输入，收到回复后再唤醒 Agent。

不要为普通答复、状态同步、澄清问题、一次性请求或“请看这条消息”创建 Task。只有同一责任需要跨
AgentRun 保留、独立交接和验收时，才按 [Task](task.md) 的边界升级。

把消息关联到 Task 时，必须恰好有一个 Effective Agent Recipient；是否提醒当前用户不改变这个条件。
Send 成功只证明消息和冻结效果已提交，不证明 recipient 已启动或完成工作。

## 附件

使用 `rovai send --file <path>` 将本地文件随当前 CampMessage 发布为不可变 Camp 附件。

可以重复使用 `--file`。附件按照参数出现顺序排列，并显示在消息正文之后。发送文件不需要提前执行单独
的上传操作。

至少一个附件可以独立构成消息，因此纯附件发送直接使用 `rovai send --file <path>`；只有正文和附件同时
为空时才会被拒绝。

命令成功后，不要重复发送同一交付。
````

#### 建议英文（完整替换）

````markdown
# Send

Read `rovai send --help` for current inputs. A Send can independently:

- publish a message visible to everyone in the current Camp;
- route concrete work to Agents through frozen Deliveries;
- request Principal attention without creating an Agent Delivery.

Use `--public-only` for a public record that must wake no Agent. Use `--to` for concrete continuing work; repeat it for parallel recipients. Replies go to the requester. Do not address Agents for acknowledgements, closure or status with no new action.

## Principal attention

Ordinary messages are already visible to the Principal. Add `--to-principal` only for a new unresolved decision, answer or action, or an explicitly requested important asynchronous result notification.

Attention belongs to this message; replies, Tasks and downstream work do not inherit it. The Agent responsible for the user-facing outcome normally decides when to request attention. Internal reviewers return results to their caller; this is workflow guidance, not a Core permission rule.

Combine `--to` and `--to-principal` only when each recipient has an independent action. If Agent work depends on a human decision, obtain that decision first.

A one-time answer, update, question or request uses a message. Use a [Task](task.md) only for durable, independently transferable responsibility. A Task-linked Send requires exactly one effective Agent recipient; Principal attention does not count.

A successful Send proves publication and its frozen effects, not that a recipient has started or finished.

## Files

Use `--file <path>` to publish a file or directory with the message; repeat it to preserve attachment order. No separate upload is required. At least one file can form a message without a body.
````

### `skills/cli-operations/references/task.md`

#### 变更前（完整文件）

````markdown
# Task：跨 Run 的独立责任

只有一项责任同时需要持久追踪、跨 AgentRun 生存，并能独立交接或验收时，才创建 Task。短暂协调、
公开答复、进度广播、澄清问题和仅需用户注意的消息仍是 CampMessage。

用 `rovai task --help` 选择操作，参数看对应操作的 `--help`。
优先复用已有 Task；任务范围与要求统一写入 `description`。
`get` 读取完整描述和当前版本；更新使用已读取的版本，冲突后重读再决定，不新建 Task 绕过。

Task 与公开消息承担不同职责：Task 保存持久责任，CampMessage 向 Camp 公开沟通。需要在消息中关联
Task 时，Send 必须恰好有一个 Effective Agent Recipient；User attention 不计入这个 cardinality。
先让 Task 达到应有状态，再发送需要公开的交接、请求或结果消息。
````

#### 建议英文（完整替换）

````markdown
# Task

Create a Task only for responsibility that needs tracking across Runs and independent handoff or acceptance. Use CampMessage for brief coordination, answers, progress and questions.

Choose an operation with `rovai task --help`, then read its exact help. Reuse an existing Task where possible; put scope and requirements together in `description`.

Decide from current Task state; read it when the needed information is missing or stale. Submit only the fields you intend to change.

Tasks preserve responsibility; messages communicate it. Bring the Task to the appropriate state before publishing a required handoff, request or result. A Task-linked Send requires exactly one effective Agent recipient; Principal attention does not affect that count.
````

<a id="skill-02"></a>

## 02 memory-stewardship

### `skills/memory-stewardship/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: memory-stewardship
description: 当用户明确要求记住、更正或停止沿用某项长期信息，或当前内容包含会影响未来协作的稳定偏好、约定或经验时使用。先检查相关 Memory，再决定新增、修订、转交用户治理或不写入。临时状态、当前任务进度、项目事实、敏感信息和无依据推测不使用。
---

# 共同记忆维护

只保留会影响未来协作的稳定信息。当前事实、用户最新指令和项目权威来源始终高于 Memory。

## 判断标准

候选内容应当同时满足：

- 当前任务结束后仍有价值；
- 来自用户明确表达或真实经历支持的经验；
- 会改变未来协作行为，而不只是复述发生过的事情；
- 能写成一条独立、原子的偏好、约定或经验；
- 不应由 Task、项目文档、代码、历史记录或权限系统承担；
- 不包含敏感信息或无依据的人格判断。

不满足这些条件时不写入。

## 流程

1. 读取 [Authority 与安全](references/authority-and-safety.md)，确认候选内容适合长期保留。
2. 把候选压缩成一条原子的未来协作路标。
3. 读取 [Scopes、Kind 与方向](references/scopes.md)，选择最小适用范围。
4. 读取 [View、广泛回忆与最小写入](references/read-write-workflow.md)，检查相关现有 Memory。
5. 只选择一个结果：已有等价内容则停止；已有内容需要纠正则修订；确有新价值则新增；无法确定则停止。
6. 写入前读取 [正文与 Retrieval Keys](references/content-and-keys.md)，完成一次最小更新。
7. 根据实际结果准确说明已经生效、等待用户决定或未写入。

用户要求删除、停用、恢复或修改不属于当前队员权限的 Memory 时，不用相反正文模拟操作；说明需要由用户在记忆管理中完成。

## 边界

- 一次只处理一条原子信息，不连续写多条“以防万一”。
- 不在会话结束时进行全面记忆扫描。
- 不把临时日期、路径、分支、进度和一次性阻塞写成长期记忆。
- 不把搜索摘要、缓存或旧版本当作当前权威正文。
- 写入失败或结果不确定时，不声称已经保存。
````

#### 建议英文（完整替换）

````markdown
---
name: memory-stewardship
description: Maintain durable collaboration preferences, agreements and lessons when the user asks to remember, correct or stop using them, or current evidence warrants capture. Excludes temporary work, project facts, sensitive data and speculation.
---

# Memory stewardship

Preserve only information that will change future collaboration. Current instructions, facts and project authority outrank Memory. Use the user's language for Memory content and reports.

1. Read [Authority and safety](references/authority-and-safety.md) to assess eligibility.
2. Reduce the candidate to one durable understanding; select its smallest valid [Scope and Kind](references/scopes.md).
3. Follow [Read and write](references/read-write-workflow.md): inspect the complete applicable Scope, then stop, revise or add once.
4. Before writing, apply [Body and retrieval keys](references/content-and-keys.md).
5. Report the actual outcome: effective, pending user review, or not written.

Do not run an end-of-conversation Memory sweep or write several speculative candidates. Deletion, deactivation, restoration and changes outside the Agent's authority require the user's Memory management controls; an opposite statement cannot simulate those actions.
````

### `skills/memory-stewardship/references/authority-and-safety.md`

#### 变更前（完整文件）

````markdown
# Authority 与安全

## 权威顺序

当前用户输入、当前授权、当前工具结果，以及当前仓库与协作状态始终高于 Memory。Memory 不能授予
Capability、满足 Approval、授权行动或推翻当前事实。

`[MEMORY_ENTRYPOINT]` 只是 Native Session 启动时的有界 discovery cache。它可能遗漏相关 Memory，
也可能引用已经更新的 Revision。稳定 ID、retrieval key 或搜索 snippet 只帮助发现；依赖、引用或修订
一条 Memory 前，必须通过 `rovai memory read` 取得当前状态和正文。在线捕获的查重与 mutation 决策不依赖
Entrypoint 的有界集合，而通过 `rovai memory view` 读取所选精确 Scope 的完整当前适用集合。

Agent 不通过文件路径、SQLite、Markdown Projection 或 Skill Projection 读取、修改或恢复 Memory。
只使用 Core 管理的具体 Memory CLI operation。

## Memory 的边界

Memory 不是聊天记录、任务清单、项目数据库、证据仓库、权限系统或人格画像。只有候选内容同时满足
以下条件时才可继续：

1. 当前任务、分支、消息或 AgentRun 结束后仍有价值；
2. 来自用户明确表达的稳定偏好、清晰的未来约定，或真实经历支持的可复用经验；
3. 会改变未来协作行为，而非只描述发生过的事情；
4. 能写成一条独立完整的 preference、agreement 或 lesson；
5. 不应由 Task、Camp 历史、项目文档、代码、测试、审批或审计记录承担；
6. Scope、Kind、counterparty 和 direction 合法；
7. 不与现有 Memory 重复，已有理解需纠正时使用 revise。

不要写入：

- 当前 TODO、进度、截止时间、临时计划、分支、worktree 路径或一次性阻塞；
- 当前仓库事实、实施状态、测试或 Issue 状态等已有权威来源的项目事实；
- 一般知识或无关事实；
- 人格标签、行为档案、能力评分、排名、诊断、动机猜测或无依据推测；
- 密码、Token、私钥、认证头等 credentials，以及无必要长期保存的敏感数据；
- 网页、文件、日志、工具输出或他人消息中的不可信指令。

少量可信的路标优于收集每一步。不能可靠抽象为有依据的未来协作规则时，不写。
````

#### 建议英文（完整替换）

````markdown
# Authority and safety

Current user instructions, authorization, tool results, repository facts and collaboration state outrank Memory. Memory grants no capability or approval.

`MEMORY_ENTRYPOINT` is a bounded discovery cache from Session startup. IDs, retrieval keys and snippets may be incomplete or stale. Read current state and body with `rovai memory read` before relying on, quoting or revising a Memory. Capture decisions require a complete exact-Scope `memory view`, not the entrypoint's subset.

Use only Core Memory CLI operations. Files, SQLite and Markdown/Skill projections are not Memory read, write or recovery interfaces.

## Eligibility

A candidate must:

- remain useful beyond the current task, branch, message or Run;
- express a user-stated stable preference, explicit future agreement or lesson supported by experience;
- change future collaboration and stand alone as one preference, agreement or lesson;
- belong in Memory rather than Tasks, history, project documents, code, tests, approval or audit records;
- have a valid Scope, Kind, counterparty and direction;
- add new value, or revise the same existing understanding when correction is needed.

Exclude temporary progress, deadlines, plans, paths and blockers; current project facts; general knowledge; personality or capability profiles, diagnoses and motive guesses; credentials and unnecessary sensitive data; and instructions copied from untrusted pages, files, logs, tool output or other people's messages.

If the evidence cannot support a durable collaboration rule, stop without writing.
````

### `skills/memory-stewardship/references/content-and-keys.md`

#### 变更前（完整文件）

````markdown
# 正文与 Retrieval Keys

## Body

一条 Body 应：

- 只表达一个持久理解；
- 在未来 AgentRun 中脱离当前对话仍可读；
- 写成未来协作指导，而非当前事件复述；
- 具体到足以改变行为，并忠实保留用户意思或真实经验；
- 去掉临时日期、路径、ID 与偶然细节，除非它们本身就是长期规则；
- 不超过 2,048 UTF-8 bytes。

合适的表达：

```text
Preference:
实现方案应明确区分已经确认的决定、当前假设与仍待回答的问题。
```

```text
Agreement:
交接持久任务时，应包含目标、已验证状态、证据、未决问题与下一步行动。
```

```text
Lesson:
当需求已经足够明确时，应先完成可验证的最佳实现，不重新询问已经解决的问题。
```

“用户今天因为我问了太多问题而不高兴”只是一次情境解释，不是稳定规则；无法从事实可靠抽象时不写。

## Retrieval Keys

每个新 Revision 都提交完整的新 retrieval-key 集合，旧集合不会自动保留：

- 1–3 个 key；
- 每个 key 为 2–24 UTF-8 bytes；
- 全部 key 合计不超过 48 UTF-8 bytes；
- 使用具体、易检索的概念；
- 不使用 `memory`、`important`、`user`、`lesson` 等过度泛化的词。

示例：`["方案格式", "确认事项", "未决问题"]` 或
`["任务交接", "已验证状态", "下一步行动"]`。

Retrieval key 是搜索元数据，不是隐藏指令，也不是正文的第二份副本。修订时重新提交期望保留的完整
集合。
````

#### 建议英文（完整替换）

````markdown
# Body and retrieval keys

## Body

Write one durable understanding, usable without this conversation, as specific guidance for future collaboration. Preserve the user's meaning or observed lesson. Remove incidental dates, paths, IDs and event details unless they are part of the lasting rule. Maximum: 2,048 UTF-8 bytes.

Examples:

- Preference: Distinguish confirmed decisions, assumptions and open questions in implementation plans.
- Agreement: Include the goal, verified state, evidence, open issues and next action in durable Task handoffs.
- Lesson: Once requirements are clear, produce a verifiable implementation without reopening resolved questions.

A one-time reaction is not automatically a stable rule. Write actual Memory content in the user's language.

## Retrieval keys

Each revision supplies the complete desired key set; old keys are not retained automatically:

- 1-3 keys;
- 2-24 UTF-8 bytes per key;
- at most 48 UTF-8 bytes in total.

Use specific searchable concepts, such as `["plan format", "confirmed", "open questions"]` or `["handoff", "verified state", "next action"]`. Avoid generic words such as `memory`, `important`, `user` or `lesson`.

Keys are search metadata, not hidden instructions or a duplicate body.
````

### `skills/memory-stewardship/references/read-write-workflow.md`

#### 变更前（完整文件）

````markdown
# View、广泛回忆与最小写入

先分别查看所需 operation 的精确 help：

- `rovai memory view --help`
- `rovai memory search --help`
- `rovai memory read --help`
- `rovai memory write --help`

## 在线捕获：完整 View 后再决定

1. 先把候选压缩成一个原子理解，并选择一个精确 Scope；此时不调用 write。
2. Hearth 调用 application-global Hearth View；Companion 调用当前 Agent 自己的 Companion View；
   Relationship 必须指定一个当前 Camp 在场 counterparty，并读取该 exact unordered pair 对当前 Agent 的
   complete applicable set。
3. 成功结果必须同时满足 `complete: true`、`itemCount == items.length`，并把 `totalBodyBytes` 当作完整
   集合的正文计量。View 失败、不是 complete 或结构不一致时停止，不 add、不 revise。
4. 检查全部 items：等价则 stop；同一不可分割理解需要纠正且 `agentCanRevise: true` 时 revise；没有等价
   且确有长期价值时 add；不确定则 stop。
5. Relationship View 只包含 `当前 Agent -> counterparty` 的 directed 与该 pair 的 mutual，不包含反向
   directed。`agentCanRevise: false` 的 mutual 只能帮助查重和理解，不能用于 Agent revise。
6. revise 将选中 item 的 `target` 对象逐字段原样复制；不要重组 Memory ID、Revision ID、Scope、
   counterparty 或 direction。Core 仍会重新校验权限和 Revision CAS。

View 与后续 write 不是一个跨调用事务。并发 revise 由 `target.revisionId` 的 CAS 保护；并发语义重复 add
只能 best effort 避免。因此 View 后立即做一次决定，不在两次调用之间加入无关工作。

## 广泛回忆：Search 后 Read

1. `[MEMORY_ENTRYPOINT]` 有相关 ID 或 Retrieval Key 时，只把它当发现入口。
2. 不确定对应哪条 Memory 时，用具体概念或 Retrieval Key 调用 search；`limit` 最大 6。
3. 搜索 snippet 只用于判断相关性，不是权威正文。
4. 对可能相关的 Memory 调用 read；每次最多读取 4 个 ID。
5. 按 cache state 处理：
   - `current`：使用返回的当前正文；
   - `revision_changed`：使用新正文与新 Revision ID，丢弃缓存表述；
   - `inactive`、`deleted`、`access_changed`、`unavailable`：停止使用，不复原或猜测旧正文。
6. 当前 read 返回正文时，也返回不可分割的 `target` 与 `agentCanRevise`。依赖该正文时使用当前结果；若
   广泛回忆触发新的捕获判断，先切换到对应精确 Scope 的 View，再对完整集合决定 add/revise/stop。

## 只做一次最小 mutation

1. 先用一句话概括候选，不调用写 operation。
2. 选择最小 Scope、合法 Kind，以及仅在 Relationship add 时需要的 present counterparty 和 `directed`。
3. 用 View 检查所选 Scope 的完整当前适用集合。
4. 只选一个结果：等价则 stop；同一理解需纠正且允许修改则 revise；没有等价且确有长期价值则 add；
   不确定则 stop。
5. 用 `rovai memory write` 执行 add 或 revise。Hearth 也使用同一命令，不存在第二条 propose command。
6. 检查 closed outcome：
   - `effective`：`memoryId` 与 `revisionId` 对应正式且立即生效的 Memory；
   - `review_pending`：`reviewItemId` 只定位等待用户决定的 Hearth Review Item，不能声称已保存为 Memory；
   - 失败：遵循安全 recovery，不声称已写入，不猜测或泄露其他候选 ID/正文/keys。

不要通过连续 Revision 打磨细小措辞。revise 的 `target` 是不可分割的目标断言；命令只更新正文和完整
Retrieval Key 集合，不能改变 Scope、Kind、counterparty 或 direction。

Companion add 示例：

```json
{
  "action": "add",
  "scope": "companion",
  "kind": "preference",
  "body": "实现方案应明确区分已经确认的决定、当前假设与仍待回答的问题。",
  "retrievalKeys": ["方案格式", "确认事项", "未决问题"]
}
```

Hearth add 使用相同 shape，把 `scope` 设为 `hearth`。Relationship revise 示例：

```json
{
  "action": "revise",
  "target": {
    "memoryId": "memory_123",
    "revisionId": "revision_456",
    "scope": "relationship",
    "counterpartyAgentId": "agent_3",
    "direction": "directed"
  },
  "body": "交接时同时提供测试命令、结果与对应提交。",
  "retrievalKeys": ["交接证据", "测试结果"]
}
```

Companion/Hearth target 同样包含 `memoryId`、`revisionId` 和 `scope`，但不带 Relationship 两字段。
````

#### 建议英文（完整替换）

````markdown
# Read, decide and write once

Read exact help for each needed `rovai memory view|search|read|write` operation.

## Capture: complete View before mutation

1. Form one atomic candidate and select its exact Scope.
2. View the global Hearth, your Companion, or the applicable set for you and one present Camp counterparty.
3. Require `complete: true` and `itemCount == items.length`; `totalBodyBytes` measures that full set. Stop on failure, incompleteness or inconsistency.
4. Compare every item. Equivalent: stop. The same understanding needs correction and `agentCanRevise: true`: revise. No equivalent and clear lasting value: add. Uncertain: stop.
5. For revise, copy the selected item's entire `target` unchanged. Core rechecks authority and Revision CAS. Mutual Relationship items support understanding and duplicate detection, not Agent revision.
6. Write once, without unrelated work between View and write. They are separate calls; CAS protects concurrent revision, while semantic duplicate adds are avoided only best effort.

Use `memory write` for Hearth too; there is no separate propose command. Inspect its outcome:

- `effective`: `memoryId` and `revisionId` identify immediately active Memory.
- `review_pending`: `reviewItemId` identifies a Hearth candidate awaiting the user; do not call it saved Memory.
- failure: follow safe recovery without claiming success or guessing/exposing other candidates' IDs, bodies or keys.

Revise changes only the body and complete key set. Do not create successive revisions for minor wording polish.

## Recall: Search, then Read

Use entrypoint IDs/keys as discovery hints. Search concrete concepts when needed (`limit` at most 6), then read likely matches (at most 4 IDs per call). Snippets are not authoritative bodies.

| Read state | Action |
| --- | --- |
| `current` | Use the returned current body |
| `revision_changed` | Replace cached wording and Revision ID with the returned values |
| `inactive`, `deleted`, `access_changed`, `unavailable` | Stop using the Memory; do not reconstruct its old body |

A current Read also returns `target` and `agentCanRevise`. If recall reveals a capture candidate, return to complete exact-Scope View before deciding to write.

## Examples

Companion add:

```json
{
  "action": "add",
  "scope": "companion",
  "kind": "preference",
  "body": "Distinguish confirmed decisions, assumptions and open questions in implementation plans.",
  "retrievalKeys": ["plan format", "confirmed", "open questions"]
}
```

Hearth add uses the same shape with `scope: "hearth"`. Relationship revise:

```json
{
  "action": "revise",
  "target": {
    "memoryId": "memory_123",
    "revisionId": "revision_456",
    "scope": "relationship",
    "counterpartyAgentId": "agent_3",
    "direction": "directed"
  },
  "body": "Include test commands, results and the matching commit in handoffs.",
  "retrievalKeys": ["handoff", "test results"]
}
```

Copy real targets from View/Read. Companion/Hearth targets omit the two Relationship fields.
````

### `skills/memory-stewardship/references/scopes.md`

#### 变更前（完整文件）

````markdown
# Scopes、Kind 与方向

多个 Scope 看似合理时，选择能完整表达含义的最小 Scope。修订不能改变既有 Memory 的
Scope、Kind、counterparty 或 Relationship direction；需要不同身份时重新判断是否新增。
View/Read 返回的 `target` 是不可分割的目标身份而非可编辑字段；revise 必须原样复制并让 Core 校验，
不能仅凭相似正文或“这个 Memory 也在我的可修改集合中”推断目标。

## Companion

保存用户与当前队员之间的稳定协作理解，允许 `preference`、`agreement`、`lesson`。当前队员只能新增或
修订自己的 Companion；成功 `outcome: effective` 后立即用于后续协作。

判断：这件事是否只需要我以后与用户协作时记住？

## Relationship

保存当前队员与当前 Camp 中另一位在场队员之间的协作约定或经验，只允许 `agreement`、`lesson`。
Agent 只能新增或修订 `当前队员 → counterparty` 的 `directed` Relationship：方向表示当前队员对对方承担
未来责任。Agent 不能写 `mutual`、反向 directed、另一队员的 Companion，也不能替对方承诺。

Agent 可以读取适用于自己的既有 mutual Relationship，但这不授予修改权。
Mutual 只属于 structured user governance。

Relationship View 是 actor-relative exact-pair applicable View：对当前 Agent A 与 counterparty B，只返回
`directed(A -> B)` 和 `mutual(A, B)`，不返回 `directed(B -> A)`。它不是用户治理面上的完整 pair。

判断：这件事是否只影响我对某位在场队员今后的协作方式？

## Hearth

保存本地 Rovai home 内所有 AgentProfile 都应理解的 application-global 偏好、原则或经验，跨 Camp，
但不是 Camp-wide Memory。允许 `preference`、`agreement`、`lesson`。Agent 仍用
`rovai memory write` 提交，但 Core 只创建隔离的 pending Hearth Review Item；成功输出必须是
`outcome: review_pending`。候选不会成为 Memory、Revision 或 Agent 可读内容，只有用户接受后才生效。

判断：这件事是否应该让用户的所有队员都知道？

## Active 容量

条数上限与 active current body 总字节上限同时生效：Hearth application-global 为 32 条 / 16 KiB；
Companion 每个 AgentProfile 为 32 条 / 16 KiB；Relationship 每个 unordered pair 为 12 条 / 12 KiB。
Retire/Forget 释放 active 配额。收到 `memory.capacity_exceeded` 时停止，不拆成语义碎片规避配额，也不把
同一 `runtimeToolCallId` 当作新命令重试。

Retire、Reactivate、Forget、Supersession、Review schedule 和 Review decision 都只属于 structured user
governance。不要用相反正文模拟 Forget。
````

#### 建议英文（完整替换）

````markdown
# Scope, Kind and direction

Choose the smallest Scope that fully expresses the meaning. Revision preserves Scope, Kind, counterparty and direction. Copy the returned `target` intact; similar text or membership in a writable set cannot establish identity.

| Scope | Purpose and Agent authority |
| --- | --- |
| Companion | User-to-current-member collaboration. `preference`, `agreement`, `lesson`; write only your own Companion. `effective` applies immediately. |
| Relationship | Your future responsibility toward one present member in the current Camp. `agreement` or `lesson`; write only `directed(self -> counterparty)`. |
| Hearth | Application-global understanding for all members in the user's local Rovai home, across Camps. All three Kinds; `memory write` creates a pending user review. |

A Relationship View for A and B returns `directed(A -> B)` and `mutual(A, B)`, not `directed(B -> A)`. Reading mutual information grants no write authority. Do not write reverse or mutual relationships, another member's Companion, or commitments on their behalf.

Hearth success is `review_pending`. Its candidate is not Memory, a Revision or Agent-readable content until accepted by the user. Hearth is application-global, not Camp-wide.

## Capacity and user governance

Both active count and current-body byte limits apply:

| Scope | Active limit |
| --- | --- |
| Hearth, application-wide | 32 entries / 16 KiB |
| Companion, per member | 32 entries / 16 KiB |
| Relationship, per unordered pair | 12 entries / 12 KiB |

Retire/Forget releases capacity. On `memory.capacity_exceeded`, stop; do not fragment the meaning or reuse a `runtimeToolCallId` as a new command.

Retire, Reactivate, Forget, Supersession and review scheduling/decisions belong to structured user governance. Do not simulate forgetting with a contradictory body.
````

<a id="skill-03"></a>

## 03 campfire

### `skills/campfire/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: campfire
description: 当用户希望 Camp 中多位成员共同讨论、从不同角度分析、比较方案、评估利弊或讨论后形成建议时使用。主持人发起和继续整理讨论，成员在收到本次讨论任务时也使用。普通单人问题、无关发言、迟到补充和已经结束的讨论不使用。
---

# 篝火讨论

Campfire 由当前 Default Lead 主持。成员先独立判断；只有一个会改变结论的关键分歧可以进入定向回应；最后发布一份统一纪要。

## 使用边界

用于多人讨论、不同视角分析、方案比较、利弊评估或讨论后建议。不用于普通单人任务、持续双人追问、严格信息隔离，或不足两位成员的场景。CampMessage 公开可见，因此独立作答不是盲评。

只有用户直接请求当前 Default Lead 才能开始新讨论。普通成员收到用户的召集请求时不得自行启动；成员只在收到本场正式讨论任务时参与。

## 角色路由

| 当前角色与输入 | 动作 |
| --- | --- |
| 当前 Default Lead 收到用户直接请求 | 读取 [Default Lead 指南](references/lead.md)，开始第一轮 |
| 普通成员处于用户广播或同时触达 Default Lead 的阶段 | 读取 [参与者指南](references/member.md)，保持静默 |
| 普通成员的当前 AgentRun 由正式独立观点或定向回应请求触发 | 读取 [参与者指南](references/member.md)，返回一条完整结果 |
| 主持人收到本轮受邀成员的普通回复 | 读取 [Default Lead 指南](references/lead.md)，继续收集、综合或收口 |
| 任意角色收到纪要、迟到意见或无关发言 | 不自动续跑 |

按当前角色、请求来源和本轮完成结果判断，不凭消息标题推进流程。

## 公共规则

1. 同一 Default Lead 在一个 Camp 中一次只推进一场未结束的 Campfire。
2. 第一轮用一条普通多目标消息邀请 2–3 位成员独立作答；只有关键分歧可以触发一次邀请 1–2 人的回应消息。
3. 每场最多两轮，每位成员每轮只返回一条完整结果。
4. 第二轮完成后必须发布唯一《篝火纪要》，不追加澄清轮；迟到观点不自动更新纪要。
5. 用户的停止、替换话题、移除成员或立即总结始终优先。

## 流程

```text
用户请求 Default Lead
    → 第一轮普通多目标消息：邀请 2–3 位成员
    → 成员用普通消息分别回复主持人
    → 少于两份有效观点：部分纪要或终止
    → 无关键分歧：发布纪要
    → 有关键分歧：一次定向回应邀请
    → 发布纪要
```

不要为展示讨论感强行制造反方。准备终止输出时读取 [篝火纪要写作指南](references/notes.md)。
````

#### 建议英文（完整替换）

````markdown
---
name: campfire
description: Run a Camp discussion with several members to compare perspectives, options or tradeoffs and produce shared notes. Applies to the host and invited contributors throughout that discussion; excludes solo work, unrelated messages and closed discussions.
---

# Campfire

The current Default Lead hosts independent views, at most one focused response round, then one final set of notes. Public messages make this an independent discussion, not a blind review. Use the user's language for prose and template headings.

## Roles

| Current input | Action |
| --- | --- |
| User directly asks the current Default Lead to host | Follow [Lead](references/lead.md) |
| Ordinary member receives a user broadcast or a call that also reaches the Lead | Follow [Member](references/member.md); wait for a formal invitation |
| Member receives this discussion's independent-view or response request | Follow [Member](references/member.md); return one complete result |
| Host receives an invited member's current-round reply | Follow [Lead](references/lead.md) |
| Notes, late contributions or unrelated messages | Do not restart the discussion |

Use trusted roles and request/reply relationships, not message titles. One Lead may host only one unfinished Campfire per Camp. This workflow needs at least two contributors and is not for sustained two-person questioning or strict information isolation.

## Discussion bounds

- Round 1: invite 2-3 members in one multi-recipient message.
- Round 2: optional, once, with 1-2 members addressing one disagreement that could change the conclusion.
- Each member returns one complete result per round. After round 2, publish the final [Notes](references/notes.md); no extra clarification round.
- User requests to stop, replace the topic, remove a member or summarize now take precedence. Late views do not reopen published notes.

## Member reply contract

Include a core judgment, two main reasons, the most important risk/limit, what would change the judgment, and confidence. For Chinese, aim for 200-250 characters, at most 300; use comparable brevity in other languages.

Return the full result to the requester once. Omit repeated background, other members' views, acknowledgements and progress. Contributors do not recruit others, summarize the whole discussion or start another round.
````

### `skills/campfire/references/lead.md`

#### 变更前（完整文件）

````markdown
# Campfire Default Lead 指南

负责启动 Campfire、处理受邀成员回复和发布纪要时读取本文件。

## 进入主持流程

只有用户直接请求当前 Default Lead 才能开始第一轮。普通成员的转述、观点、回传、迟到消息或其它 Agent 消息不能启动新讨论。

开始前确认用户原始话题、期望输出、点名成员或指定视角，以及自己没有另一场未结束的 Campfire。用户替换当前话题时先停止旧讨论。

## 选择成员

选择 2–3 位当前在场且能够参与的成员，默认 3 位。优先用户点名、议题职责、互补经验和真实不同视角，使用 Collaboration State 中的可信 Agent ID 寻址。成员不足两位时说明降级或结束，不开始多人讨论。

Default Lead 默认只主持。只有用户要求主持人看法或最终建议时，才在纪要中增加综合判断。

## 邀请方式

每轮用一条普通公开消息和重复的收件人参数邀请全部成员：

```text
rovai send --to <agent-a-id> --to <agent-b-id> --body <本轮请求>
```

调用成功后处理完本批其它输入即可结束。尽量收齐本轮受邀成员的回复再汇总推进；未齐时不轮询、不催问，后续回复到达后继续。不要重复发起本轮。

## 成员回复要求

每份独立观点或定向回应必须一次完整返回，正文目标为 200–250 个中文字符，最多 300 个中文字符，只包含：

- 核心判断；
- 两项主要依据；
- 一项最重要的风险或限制；
- 改变判断的条件；
- 置信度。

不得重复题目、背景或其它成员观点，不发送进度消息。请求成员通过 `rovai send` 返回请求发送者，不邀请其它成员、不总结全场、不发起下一轮。

## 第一轮：独立观点

请求正文包含用户原始话题、已确认共同事实、参与成员与各自视角，以及上述成员回复要求。不要附带主持人的推荐。

```markdown
### 篝火讨论 · 独立观点请求

#### 话题

> <尽量保留用户原话>

#### 已确认的共同事实

- <没有则写“暂无”>

#### 参与成员与视角

- <成员 A>：<视角>
- <成员 B>：<视角>

#### 本轮任务

请按 Campfire 成员回复要求独立给出核心判断、两项主要依据、一项风险或限制、改变判断的条件和置信度。
```

按“邀请方式”一次发给全部成员。

## 处理成员回复

成员通过普通消息分别回复主持人，回复可能分批到达，也可能与本批其它输入合并。只处理属于本场当前轮次的受邀成员回复；其它输入正常处理。结合已收到的本轮公开观点判断是否已经足够推进，不创建轮询、催问、确认消息或额外回复账本。

尚未收齐时不推进讨论结论，处理完本批其它输入即可结束，等待后续回复自然触发新 Run。用户要求立即总结、停止、替换话题或成员已明确失败/退出时，可以按已有有效观点提前收口。

一份回复只有完整、直接回答本轮任务时才是有效观点。进度、确认、空泛文本、错误或无法确认结论的内容不计入，也不得代写。

## 处理第一轮

- 至少两份有效观点：区分真实共识、措辞差异、事实/预测/边界/价值取舍分歧。
- 只有一份：发布部分纪要，说明未形成有效多人讨论。
- 没有：发布终止说明。

只有一个会显著改变结论、建议或适用条件的关键分歧可以进入第二轮；否则直接发布纪要。

## 主持权变化

本轮回复始终由原发起者综合。准备推进第一轮时重新检查 Collaboration State：

- 仍是 Default Lead：可以发起可选第二轮；
- 已不是 Default Lead：继续综合并直接发布纪要。

第二轮回复无论主持权是否变化，都由原发起者发布纪要。讨论不会自动改由新 Default Lead 处理。

## 第二轮：定向回应

整场最多一次，通常邀请分歧最直接的两位成员；只需一方补充时邀请一位。请求保留原始话题、每位成员的“核心立场 + 最主要依据”摘要、唯一关键分歧和逐人任务，不复制完整第一轮档案。

```markdown
### 篝火讨论 · 定向回应请求

#### 原始话题

> <用户原话>

#### 第一轮立场摘要

- <成员 A>：<核心立场 + 最主要依据>
- <成员 B>：<核心立场 + 最主要依据>

#### 关键分歧

> <只写一个会影响结论的问题>

#### 定向任务

- <成员 A>：回应 ...
- <成员 B>：回应 ...

请按 Campfire 成员回复要求给出更新后的判断，并说明维持、修正或条件化。
```

按“邀请方式”发出。第二轮收齐或需要提前收口时，结合已收到的本轮回复和当前可见的第一轮公开观点：

- 有完整回应时使用更新立场；
- 回应失败或不完整时保留可确认的第一轮立场，并标记未完成回应；
- 未进入第二轮的成员保留第一轮立场；
- 无法确认的内容标记为未知，不补写。

随后读取 `notes.md`，发布纪要并结束讨论。

## 用户介入

用户可以随时停止、替换话题、移除成员或要求立即总结。立即总结只使用已形成的有效观点，标记未完成成员并结束讨论。停止或替换话题后，旧结果不得恢复旧讨论。
````

#### 建议英文（完整替换）

````markdown
# Host a Campfire

## Start and invite

Start only from the user's direct request to the current Default Lead. Establish the topic, desired output, named members or perspectives, and that you have no other unfinished Campfire. A replacement topic closes the old discussion.

Choose 2-3 present, available contributors, normally 3. Prefer the user's choices, relevant responsibilities and complementary experience; address trusted Agent IDs from Collaboration State. With fewer than two, explain the fallback or stop. The Lead hosts without adding a recommendation unless the user requests one.

Send one message per round with repeated `--to`:

```text
rovai send --to <agent-a-id> --to <agent-b-id> --body <round-request>
```

For round 1, include the user's original topic, confirmed shared facts, each member's perspective, and the member reply contract in `SKILL.md`. Include no host recommendation. A compact request is sufficient:

```markdown
### Campfire: independent views
Topic: <preserve the user's wording>
Shared facts: <confirmed facts, or none>
Perspectives: <member and assigned perspective>
Task: <reply contract; return one complete result to the requester>
```

After successful dispatch, finish other current inputs and end the Run. Resume when replies arrive; do not poll, chase, acknowledge or resend the round.

## Evaluate replies

Use only complete, direct answers from this round's invited members. Progress, acknowledgements, vague text and errors are not valid views. Process unrelated batch inputs normally; no extra reply ledger is needed.

Wait for all invited replies before drawing the round's conclusion, unless the user requests early closure or a member has clearly failed or left. Then:

- Two or more valid views: distinguish consensus from wording differences and factual, predictive, boundary or value disagreements.
- One valid view: publish partial notes stating that no effective group discussion formed.
- None: publish a termination explanation.

A second round is justified only by one disagreement that would materially change the conclusion, recommendation or applicability. Otherwise publish [Notes](notes.md).

## Optional response round

Recheck Collaboration State before starting round 2. If you are no longer Default Lead, synthesize and close instead. The original host always completes the current discussion; it does not transfer automatically to the new Lead.

Invite the two members closest to the disagreement, or one when only one side needs to clarify. Include the original topic, each member's core position and main reason, the single disagreement, individual response tasks, and the reply contract. Do not copy the full first-round record.

```markdown
### Campfire: focused response
Topic: <original topic>
Positions: <member: core position and main reason>
Disagreement: <one question that changes the conclusion>
Tasks: <member: specific response>
Reply: <retain, revise or qualify the judgment; follow the reply contract>
```

After replies or permitted early closure, use each complete updated position. Retain the confirmed round-1 position for nonparticipants or failed/incomplete responders, marking the latter incomplete. Mark unknowns explicitly; never supply a missing view. Publish notes and close, even if Lead status changed during this round.

At any point, honor user interruption. A stop or replacement makes old results ineligible to restart the old discussion.
````

### `skills/campfire/references/member.md`

#### 变更前（完整文件）

````markdown
# Campfire 参与者指南

收到用户广播，或当前 AgentRun 由 Default Lead 的独立观点或定向回应请求触发时读取本文件。

## 新讨论启动边界

只有当前 Default Lead 能响应用户的直接请求并开始 Campfire。普通成员不得自行启动或组织讨论。

用户向全体广播、使用 `@所有队员`、同时触达 Default Lead 或同时点名多位成员时，不提前发表观点、不发送控制消息、不组织讨论，直接结束当前 Run。若环境要求最终文本，只输出：

```text
等待 Default Lead 发起讨论。
```

用户只触达当前普通成员并要求多人讨论时，明确告知需要由当前 Default Lead 直接发起，不代为发送请求。

## 回复正式请求

处理本批中属于本场讨论的独立观点或定向回应请求；其它输入正常处理。使用 Runtime 提供的可信请求发送者 Agent ID，不根据显示名猜测，不改投其它成员，也不使用 `--to-user`。

完成思考后只发送一次：

```text
rovai send --to <请求发送者 Agent ID> --body <完整结果>
```

失败时按 CLI 返回指示处理，不盲目重发；当前 Run 的最终输出仍保留同一份完整观点。

## 回复限制

每条结果必须一次完整提交，正文目标为 200–250 个中文字符，最多 300 个中文字符，只保留：

- 核心判断；
- 两项主要依据；
- 一项风险或限制；
- 改变判断的条件；
- 置信度。

不要重复题目、背景或其它成员观点，不发送“收到”、分析进度、初步结论、分段修订或“请主持人继续”。

## 独立观点

只根据请求中的用户话题、共同事实和分配视角判断。即使公屏已有其它结果，也不引用、跟随或反驳。

```markdown
### 篝火讨论 · 独立观点

#### 核心判断

<1–2 句>

#### 两项主要依据

- ...
- ...

#### 风险或限制

...

#### 改变判断的条件

...

#### 置信度

高 | 中 | 低
```

## 定向回应

只回应请求中的唯一关键分歧，不复述对方观点或重写第一轮报告；证据改变判断时明确修正。

```markdown
### 篝火讨论 · 定向回应

#### 核心判断

维持 | 修正 | 条件化：<更新结论>

#### 两项主要依据

- ...
- ...

#### 风险或限制

...

#### 改变判断的条件

...

#### 置信度

高 | 中 | 低
```

## 参与者边界

参与者只完成本批中属于本场讨论的请求，向请求发送者返回一条完整结果；其它输入正常处理。不要组织他人、总结全场或自行开启下一轮。
````

#### 建议英文（完整替换）

````markdown
# Contribute to Campfire

Only the current Default Lead may start a discussion from the user's direct request.

On a user broadcast, all-members mention, or call that also reaches the Lead or several members, end without publishing a view or control message. If the Runtime requires final text, say in the user's language: "Waiting for the Default Lead to start the discussion."

If the user addresses only you and asks for a group discussion, explain that they should request it directly from the current Default Lead; do not forward a request on their behalf.

## Answer a formal invitation

Handle this discussion's requests in the current batch; process other inputs normally. Use the Runtime's trusted requester Agent ID, not a guessed display name. Send the complete result once to that requester:

```text
rovai send --to <requester-agent-id> --body <complete-result>
```

Follow the reply contract in `SKILL.md`. Follow CLI recovery on failure; do not blindly resend. If a Runtime final response is required, keep the same complete view there. Do not request Principal attention.

For an independent view, use only the requested topic, shared facts and assigned perspective. Do not cite, follow or rebut views already on the public screen.

For a focused response, address only the named disagreement. Explicitly retain, revise or qualify your judgment as the evidence warrants; do not restate the other side or rewrite the first-round report.

Use this compact structure, localizing its labels:

```markdown
Judgment: <1-2 sentences; retain/revise/qualify for a response>
Reasons:
- ...
- ...
Risk or limit: ...
Would change my view: ...
Confidence: high | medium | low
```

Return your result without organizing members, asking the host to continue, or adding another round.
````

### `skills/campfire/references/notes.md`

#### 变更前（完整文件）

````markdown
# 篝火纪要写作指南

由主持人使用每位成员最后一次有效表达，发布本场唯一终止输出。

## 综合规则

1. 进入回应轮的成员使用完整回应后的立场；未进入者使用第一轮完整观点。
2. 回应失败、截断或不完整时保留当前上下文中可确认的第一轮立场，并标记“未完成定向回应”。
3. 没有完整观点的成员标记为未完成，不替其补写。
4. 只有所有有效成员明确支持，或原反对者已经修正，才能写成共识；多数意见只写“当前倾向”。
5. 没有实质分歧时说明未开启回应轮，不强行制造反方。
6. 只有用户要求建议或主持人看法时，才加入“Default Lead 综合判断”；它不代表全体共识。
7. 纪要不自动创建 Task、Memory 或版本决策记录，也不开始实施。
8. 发布后讨论结束，迟到消息不自动更新纪要。

## 纪要模板

```markdown
### 篝火纪要

#### 话题

> <尽量保留用户原话>

#### 参与成员与状态

- <成员 A>：<视角>；已完成
- <成员 B>：<视角>；未完成 | 未完成定向回应

#### 各自最终判断

##### <成员 A>

> <1–2 句准确结论>

- 主要依据：...
- 关键限制：...
- 置信度：高 | 中 | 低

#### 达成的共识

1. ...

没有共识时写“未形成共识”。

#### 当前倾向

- <多数倾向；没有则写“无”>

#### 仍然存在的分歧

- 分歧：...
- 各方最终立场：...
- 类型：事实 | 预测 | 边界 | 价值取舍
- 继续所需的证据或用户决定：...

#### 关键适用边界

- 当 <条件> 时，结论更偏向 <方案>，因为……
- 当前尚未确认：……

#### 讨论过程

- 回应轮：未启动，因为没有会改变结论的实质分歧。

或：

- 回应轮：已围绕“<关键分歧>”邀请 <成员> 定向回应。

#### Default Lead 综合判断

<!-- 仅在用户要求时出现 -->

**建议：** ...
**建议强度：** 强 | 中 | 弱
**可能改变建议的条件：** ...

#### 建议下一步

1. ...

#### 需要用户决定的事项

- <没有则写“无”>
```

## 发布

用 public-only `rovai send --body <纪要正文>` 发布。发送成功后本场讨论结束，
不再邀请成员，迟到观点不自动续跑。
````

#### 建议英文（完整替换）

````markdown
# Final notes

Publish once, using each member's last valid position. Use complete round-2 views where available; otherwise retain confirmed round-1 views and mark incomplete responses. Mark missing contributors incomplete without writing their views for them.

Call a position consensus only when all valid contributors explicitly support it or earlier opponents have revised their view. Label a majority preference as a current tendency. Record why no response round was needed rather than inventing opposition.

Use the user's language for this structure:

```markdown
### Campfire notes
Topic: <preserve the user's request>

Participants:
- <member>: <perspective>; complete | incomplete | response incomplete

Final views:
- <member>: <1-2 sentence judgment>; main evidence; key limit; confidence

Consensus: <agreed points, or none>
Current tendency: <majority preference, or none>
Remaining disagreement:
- <issue; each position; fact/prediction/boundary/value; evidence or user decision needed>

Applicability: <conditions that change the recommendation; unresolved facts>
Process: <no response round and why, or the one disagreement and invited members>

Next steps: ...
User decisions needed: <items, or none>
```

Add a separate Default Lead judgment only when requested: recommendation, strength, and what could change it. It is not group consensus.

Publish with `rovai send --public-only --body <notes>`. Publication ends the discussion. Notes do not automatically create Tasks, Memory, version decisions or implementation work; late messages do not restart it.
````

<a id="skill-04"></a>

## 04 grill-duo

### `skills/grill-duo/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: grill-duo
description: 当用户希望在 Camp 中通过持续追问和一位固定搭档的独立复核，澄清或压力测试计划、需求、设计或决定时使用。邀请者继续处理用户回答或当前搭档建议，成员收到普通双人追问复核任务时也使用。普通单人问答、多人讨论、需要同步维护领域词汇或 ADR 的追问、无关发言和已经结束的会话不使用。
---

# 双人追问

邀请者负责持续追问，一位固定搭档负责独立复核。能查明的事实由成员自行查找，真正需要取舍的决定交给用户。

## 角色与轮次关联

- 用户启动会话或回答当前开放轮次：作为邀请者继续。
- 当前 AgentRun 由普通双人追问复核请求直接触发：作为固定搭档，只处理当前请求。
- 当前输入是固定搭档对本轮有效邀请的直接回复：作为邀请者继续。

使用 Runtime 提供的可信发送者、当前触发消息和直接回复关系判断角色。邀请者只接受当前固定搭档对本轮有效邀请的直接回复；旧轮、失效或迟到建议只作补充，不能推进、回退或重开会话。

## 基本流程

1. 选择合格的固定搭档，每轮整理 1–4 个前提已确认、彼此不依赖的问题。
2. 把本轮问题一次发给搭档，不附带自己的推荐。
3. 搭档用一条消息逐题返回建议、理由和风险。
4. 邀请者结合双方判断，一次向用户提出全部开放问题并给出推荐。
5. 用户回答后继续当前开放轮次；当前轮全部关闭后才整理下一轮。
6. 没有重要问题后，请用户确认共同理解；确认前不开始实施。

依赖本轮其它答案的问题留到下一轮。能从代码、权威文档、工具、当前输入或 Camp 公共历史查明的事实，不问用户。

## 固定搭档

固定搭档必须不是自己、仍在当前 Camp、能够接收请求。使用可信 Agent ID 寻址，不根据显示名或正文猜测。优先选择最匹配的成员，整场保持固定；只有用户要求、搭档离场或不可用，或者问题进入其无法有效判断的领域时才更换，并说明原因。

没有合格搭档时，明确降级为单人追问并继续相同轮次，不虚构第二个观点。

## 开放轮次

一轮在所有问题被明确回答、取消或失效前保持开放，使用稳定编号 `Q1`–`Q4`。

- 未回答问题保留原编号、原问题和已有搭档建议；内容未变时不重复复核。
- 开放轮次期间不混入新问题。
- 用户改变某题的问题、选项或约束时保留编号，只重新复核该题；此后只采用搭档对更新邀请的直接回复。
- 用户只回答部分问题时，确认已关闭项并继续列出仍开放的原编号和已有建议。

## 消息方式

- 邀请者请求搭档：`rovai send --to <搭档 Agent ID> --body <本轮问题>`
- 搭档返回建议：`rovai send --to <邀请者 Agent ID> --body <本轮建议>`
- 邀请者询问用户或请求最终确认：`rovai send --to-user --body <正文>`

使用可信 Agent ID。消息发送成功后结束当前响应；失败时按 CLI 返回指示处理，不盲目重发。

## 本轮内容

复核请求列出用户目标、已确认内容，以及每个问题的主要选项和重要约束。

搭档不得继续委派或增加问题，按原编号逐题给出建议、最主要理由和风险，不替用户决定或开始实施。

邀请者一次呈现全部开放问题，逐题说明主要取舍、自己的推荐和搭档看法；存在分歧时准确说明，并请用户按原编号回答。

## 完成

没有重要问题后，总结目标、已确认决定、关键约束和主要风险，并请求用户确认共同理解。用户确认后结束会话。
````

#### 建议英文（完整替换）

````markdown
---
name: grill-duo
description: Clarify or stress-test a plan, requirement, design or decision through user questions and one fixed Camp partner's independent review. Applies to the initiator and invited reviewer during that exchange; use grill-duo-with-docs when confirmed project documentation must also be maintained.
---

# Grill Duo

The initiator asks questions; one fixed partner reviews independently. Investigate facts available in code, authoritative documents, tools, current input or Camp history. Ask the user for genuine choices. Use the user's language.

## Roles and partner

Use trusted sender identity, the triggering request and direct replies:

- A user start/answer or the current partner's direct reply to the valid current invitation resumes the initiator.
- A direct Grill Duo review request makes you the partner for that request only.
- Old, invalid or late replies are supplementary; they cannot advance, roll back or reopen the exchange.

Choose a relevant partner who is not you, remains in the Camp and can receive work. Address a trusted Agent ID. Keep that partner unless the user requests a change, they leave or become unavailable, or the topic moves beyond their useful expertise; explain a change. With none available, disclose solo questioning and keep the same round rules.

## One open round

1. Prepare 1-4 independent questions with established prerequisites, numbered `Q1`-`Q4`. Defer questions that depend on this round's answers.
2. Send the partner the goal, confirmed facts, options and constraints, without your recommendation.
3. The partner returns one reply with a recommendation, main reason and risk for each original number. They do not delegate, add questions, decide for the user or implement.
4. Present all open questions to the user together: choices, tradeoffs, your recommendation and the partner's view, including disagreements. Ask for answers by number.
5. Close each question only when answered, cancelled or invalidated. Start the next round after all current questions close.

Keep unanswered questions, numbers and existing advice unchanged. Add no new questions mid-round. If the user changes a question, options or constraints, keep its number and re-review only that question; accept only a direct reply to the updated invitation. Partial answers close only the answered items.

## Messages and completion

- Partner request: `rovai send --to <partner-agent-id> --body <questions>`.
- Partner response: `rovai send --to <requester-agent-id> --body <advice>`.
- User questions or final confirmation: `rovai send --public-only --to-principal --body <questions-or-summary>`.

After dispatch, finish other current inputs and end while waiting for the reply. Follow CLI recovery on failure; do not blindly resend.

When no important questions remain, summarize the goal, decisions, constraints and major risks. Obtain the user's confirmation of that shared understanding before implementation, then close the questioning exchange. Solo questions, group debates, unrelated messages and closed exchanges do not start this workflow.
````

<a id="skill-05"></a>

## 05 grill-duo-with-docs

### `skills/grill-duo-with-docs/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: grill-duo-with-docs
description: 当用户希望在 Camp 中通过持续追问和一位固定搭档的独立复核，澄清计划或设计，并同步维护已确认的领域词汇、当前权威文档或版本决策记录时使用。邀请者继续处理用户回答或当前搭档建议，成员收到文档版双人追问复核任务时也使用。普通单人问答、无需维护领域文档的追问、多人讨论、无关发言和已经结束的会话不使用。
---

# 双人追问与文档

邀请者负责持续追问和维护文档，一位固定搭档负责独立复核。搭档只提供建议，不修改项目文档。

## 角色与轮次关联

- 用户启动会话或回答当前开放轮次：作为邀请者继续。
- 当前 AgentRun 由文档版双人追问复核请求直接触发：作为固定搭档，只处理当前请求。
- 当前输入是固定搭档对本轮有效邀请的直接回复：作为邀请者继续。

使用 Runtime 提供的可信发送者、当前触发消息和直接回复关系判断角色。邀请者只接受当前固定搭档对本轮有效邀请的直接回复；普通版、旧轮、失效或迟到建议只作补充，不能推进、回退或重开会话。

邀请者按需读取[领域建模纪律](references/domain-modeling.md)、[词汇表格式](references/context-format.md)和[决定与当前权威路由](references/decision-routing.md)；搭档不读取这些文档规则。

## 基本流程

1. 选择合格的固定搭档，每轮整理 1–4 个前提已确认、彼此不依赖的问题。
2. 把本轮问题一次发给搭档，不附带自己的推荐。
3. 搭档用一条消息逐题返回建议、理由和风险。
4. 邀请者结合双方判断，一次向用户提出全部开放问题并给出推荐。
5. 用户回答后继续当前轮，只维护已经确认的内容；当前轮全部关闭后才整理下一轮。
6. 没有重要问题后，请用户确认共同理解；确认前不开始产品实现。

依赖本轮其它答案的问题留到下一轮。能从代码、权威文档、工具、当前输入或 Camp 公共历史查明的事实，不问用户。

## 固定搭档

固定搭档必须不是自己、仍在当前 Camp、能够接收请求。使用可信 Agent ID 寻址，不根据显示名或正文猜测。优先选择最匹配的成员，整场保持固定；只有用户要求、搭档离场或不可用，或者问题进入其无法有效判断的领域时才更换，并说明原因。

没有合格搭档时，明确降级为单人追问并继续相同轮次和文档规则，不虚构第二个观点。

## 开放轮次

一轮在所有问题被明确回答、取消或失效前保持开放，使用稳定编号 `Q1`–`Q4`。

- 未回答问题保留原编号、原问题和已有搭档建议；内容未变时不重复复核。
- 开放轮次期间不混入新问题。
- 用户改变某题的问题、选项或约束时保留编号，只重新复核该题；此后只采用搭档对更新邀请的直接回复。
- 用户只回答部分问题时，只维护已确认部分，并继续列出仍开放的原编号和已有建议。

## 消息方式

- 邀请者请求搭档：`rovai send --to <搭档 Agent ID> --body <本轮问题>`
- 搭档返回建议：`rovai send --to <邀请者 Agent ID> --body <本轮建议>`
- 邀请者询问用户或请求最终确认：`rovai send --to-user --body <正文>`

使用可信 Agent ID。消息发送成功后结束当前响应；失败时按 CLI 返回指示处理，不盲目重发。

## 本轮内容

复核请求列出用户目标、已确认内容、每个问题的主要选项与约束，以及可能影响的文档。

搭档不得继续委派、增加问题或修改 `CONTEXT.md`、Architecture、Contract、Version Decisions 等项目文件，按原编号逐题给出建议、最主要理由和风险。

邀请者一次呈现全部开放问题，逐题说明主要取舍、自己的推荐、搭档看法和可能影响的文档；存在分歧时准确说明，并请用户按原编号回答。

## 维护文档

只维护用户明确确认的内容。领域词汇、当前权威、决定准入与格式、仓库规则和校验方式分别由上述三个 reference 及项目文档拥有；未回答、含糊或仅由搭档建议的内容不得写成已确认事实。

确认一项决定后，邀请者必须判断它应更新领域词汇、Architecture、Contract、当前版本 Decisions、Version 实施/验收文档中的哪几项，或者是否无需长期文档。不得创建新的数字 ADR 文件。

## 完成

没有重要问题后，总结已确认决定、关键约束和风险、文档变化及未确认但不阻塞的事项，并请求用户确认共同理解。用户确认后结束会话。
````

#### 建议英文（完整替换）

````markdown
---
name: grill-duo-with-docs
description: Clarify a plan or design with one fixed Camp reviewer while maintaining confirmed domain language, current specifications and version decisions. Applies to the initiator and invited reviewer during that exchange; excludes solo questions, group debates and questioning without documentation work.
---

# Grill Duo with Docs

The initiator questions and maintains documents; one fixed partner independently advises without editing project documents. Investigate facts available from code, authoritative documents, tools, current input or Camp history. Ask the user for real choices. Use the user's language.

## Roles and partner

Use trusted sender identity, the triggering request and direct replies. A user start/answer or the current partner's direct reply to the valid invitation resumes the initiator. A direct request for this documentation variant makes you its reviewer only. Plain Grill Duo, old, invalid and late replies cannot advance, roll back or reopen this exchange.

Choose a relevant, available Camp partner other than yourself; address a trusted Agent ID and keep them throughout. Change only at the user's request, departure/unavailability, or a shift beyond their useful expertise; explain why. With none available, disclose solo questioning and keep the same round and documentation rules.

## One open round

1. Prepare 1-4 independent questions with established prerequisites, numbered `Q1`-`Q4`; defer dependent questions.
2. Send the goal, confirmed facts, options, constraints and affected documents to the partner without your recommendation.
3. The partner returns one recommendation, main reason and risk per original number. They do not delegate, add questions or edit project files.
4. Present all open questions together, including tradeoffs, your recommendation, the partner's view, disagreements and affected documents. Ask the user to answer by number.
5. Maintain only confirmed content. Close questions when answered, cancelled or invalidated; start another round only after all close.

Keep unanswered questions, numbers and advice. Add no new questions mid-round. For a changed question, retain its number and re-review only that item; accept only a direct reply to the updated invitation. Partial answers confirm only the answered portion.

## Messages

- Request: `rovai send --to <partner-agent-id> --body <questions>`.
- Advice: `rovai send --to <requester-agent-id> --body <advice>`.
- User questions/final confirmation: `rovai send --public-only --to-principal --body <questions-or-summary>`.

After dispatch, finish other current inputs and end while waiting. Follow CLI recovery on failure; do not blindly resend.

## Confirmed documentation

The initiator reads [Domain modeling](references/domain-modeling.md), [Glossary format](references/context-format.md) and [Decision routing](references/decision-routing.md) as needed. The partner need not load these authoring rules.

For each confirmed decision, determine whether to update domain vocabulary, Architecture, Contract, current-version decisions, implementation/acceptance notes, or no durable document. Apply repository rules. Unanswered, ambiguous or partner-only advice is not a confirmed fact. Do not create numbered ADR files.

When no important questions remain, summarize confirmed decisions, constraints, risks, document changes and nonblocking unknowns. Obtain the user's confirmation of the shared understanding before product implementation, then close the exchange. Unrelated messages and completed exchanges do not restart it.
````

### `skills/grill-duo-with-docs/references/context-format.md`

#### 变更前（完整文件）

````markdown
# 词汇表格式

## 结构

```md
# {上下文名称}

{用一两句话说明这个上下文是什么，以及它为什么存在。}

## Language

**Order**:
{用一两句话给出紧凑定义。}
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

## 规则

- 明确选择一个规范术语；把同义但不推荐的表达列入 `_Avoid_`。
- 每个定义限一两句话，解释概念是什么，不描述完整行为或实现。
- 只记录项目领域特有概念；一般编程概念不进入词汇表。
- 概念自然形成簇时使用小标题；单一紧密领域保持扁平结构。
- 多上下文仓库由根 `CONTEXT-MAP.md` 列出上下文、位置和关系；各上下文维护自己的 `CONTEXT.md`。
````

#### 建议英文（完整替换）

````markdown
# Glossary format

```markdown
# <Context name>

<One or two sentences explaining its purpose.>

## Language

**Order**:
<One or two sentences defining the concept.>
_Avoid_: Purchase, transaction

**Invoice**:
A request for payment sent to a customer after delivery.
_Avoid_: Bill, payment request
```

Choose one canonical term; list discouraged synonyms under `_Avoid_`. Define what a concept is, without a full behavioral specification or implementation. Include only project-specific domain concepts.

Use subheadings for natural clusters; keep one tight domain flat. For several contexts, root `CONTEXT-MAP.md` lists their locations and relationships, and each context owns its `CONTEXT.md`. Follow the project's document language.
````

### `skills/grill-duo-with-docs/references/decision-routing.md`

#### 变更前（完整文件）

````markdown
# 决定与当前权威路由

仓库自己的文档导航、当前版本指针、决定准入和目录规则优先。本文件只提供没有更具体项目规则时的默认路由。

## 内容归属

| 已确认内容 | 目标位置 |
| --- | --- |
| 领域术语和概念边界 | 适用的 `CONTEXT.md` |
| 当前组件职责、权威边界、数据和控制流 | `docs/architecture/` |
| 当前字段、状态、协议、错误、幂等、并发和恢复语义 | `docs/contracts/` |
| 当前版本重要决定的背景、取舍和后果 | 当前版本唯一的 `decisions.md` |
| 实施、迁移、验收和临时措施 | 当前 Version 目录 |
| Renderer/UX 合同 | `docs/ui/` |
| 开发和运维规则 | `docs/development/` |
| 可逆局部实现选择 | 代码、测试或无需长期记录 |

当前版本必须从 `docs/versions/README.md` 的唯一指针解析，不从目录名或用户示例猜测。

## 决定准入

只有决定同时满足以下条件，才增加版本决定章节：

1. 未来改变成本显著；
2. 仅看当前代码或规范不足以理解原因；
3. 存在真实可行的替代方案并作出了明确取舍。

决定章节解释理由；改变后的当前语义必须同时写入真正拥有它的当前权威文档。仅链接决定记录不能代替当前规范。

不得创建新的数字 ADR 文件，不维护全局 accepted/superseded 图，也不改写历史版本决定来隐藏一次新变化。
````

#### 建议英文（完整替换）

````markdown
# Decisions and current authority

Repository navigation, version pointers and governance override these defaults. Resolve the unique current version from `docs/versions/README.md`, not directory names or example versions.

| Confirmed content | Owner |
| --- | --- |
| Domain terms and concept boundaries | Applicable `CONTEXT.md` |
| Component responsibilities, authority, data/control flow | `docs/architecture/` |
| Fields, states, protocols, errors, idempotency, concurrency and recovery | `docs/contracts/` |
| Important current-version rationale, tradeoffs and consequences | That version's single `decisions.md` |
| Implementation, migration, acceptance and temporary measures | Current Version directory |
| Renderer/UX contract | `docs/ui/` |
| Development and operations | `docs/development/` |
| Reversible local implementation choice | Code, tests or no durable record |

Add a version decision only when all three hold: later change is costly; code/specification alone cannot explain why; and real alternatives required a tradeoff.

A decision explains the choice. Put resulting current semantics directly in their owning authority; a link to rationale is insufficient. Do not create numbered ADR files, maintain a global accepted/superseded graph, or rewrite historical decisions to hide a new change.
````

### `skills/grill-duo-with-docs/references/domain-modeling.md`

#### 变更前（完整文件）

````markdown
# 领域建模纪律

在设计过程中主动打磨项目的领域语言：质疑模糊术语、构造边界场景，并在结论形成时及时记录。

## 定位文档

如果仓库根目录存在 `CONTEXT-MAP.md`，先找到当前主题所属的上下文和对应的 `CONTEXT.md`；只有根 `CONTEXT.md` 时，使用单一上下文。随后定位相关 Architecture、Contract，并从 `docs/versions/README.md` 解析唯一当前版本及其 `decisions.md`。没有相关文件时，等第一项内容真正确认后再按项目路由创建。

仓库自己的文档导航和维护规则始终优先。

## 会话中执行

### 对照现有词汇

用户使用的术语与现有 `CONTEXT.md` 冲突时立即指出，并把“沿用现有含义还是形成新概念”列为本轮待确认问题。若该冲突影响其它问题，优先解决。

### 收紧模糊语言

遇到模糊或重载词时，提出更精确的规范术语。不要让一个词同时代表多个领域概念。

### 构造具体场景

讨论概念关系时，用具体场景触碰边界和例外，帮助确认概念范围、所有权和生命周期。

### 与代码交叉验证

用户描述系统行为时检查代码和权威文档。发现矛盾就展示证据，让用户决定改变模型还是实现。

### 更新词汇表

术语确认后及时更新适用的 `CONTEXT.md`，使用 [词汇表格式](context-format.md)。`CONTEXT.md` 只保存领域语言，不保存实现细节、草稿或完整规格。

### 谨慎记录长期决定

只有决定同时满足以下条件时，才在当前版本 `decisions.md` 增加章节：

1. 以后改变的成本高；
2. 缺少背景时会让未来读者意外；
3. 存在真实取舍并选择了其中一种。

同时把当前语义直接写入适用的 Architecture、Contract、Context、UI 或 Development 文档。使用仓库自己的决定治理；没有项目规则时使用[决定与当前权威路由](decision-routing.md)。不得创建数字 ADR。
````

#### 建议英文（完整替换）

````markdown
# Domain modeling

Follow repository navigation first. If root `CONTEXT-MAP.md` exists, locate this topic's context and `CONTEXT.md`; otherwise use root `CONTEXT.md`. Find relevant Architecture/Contract documents and the unique current version. Create missing documents only after the first relevant content is confirmed.

During discussion:

- Compare the user's terms with the glossary. Surface a conflict and ask whether to retain the meaning or create a distinct concept; resolve it first if other questions depend on it.
- Replace vague or overloaded language with precise canonical terms. One term should not represent several concepts.
- Use concrete boundary cases to test ownership, relationships and lifecycle.
- Check claimed behavior against code and current authority. Show contradictions and let the user decide whether the model or implementation should change.
- Record confirmed terms promptly using [Glossary format](context-format.md). Keep drafts, implementation detail and full specifications out of `CONTEXT.md`.

For durable choices, follow [Decision routing](decision-routing.md) and the project's admission rules. Record rationale only when warranted, and update current semantics in the owning document at the same time.
````

<a id="skill-06"></a>

## 06 member-studio

### `skills/member-studio/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: member-studio
description: 当用户希望创建新的 Rovai 队员，或继续调整、确认本次创建中尚未写入的队员名牌和头像方案时使用。普通成员资料咨询、编辑已创建队员，以及只设计角色或头像但不加入名册的任务不使用。
---

# 伙伴入队

从名字和用户已经给出的要求直接起草完整队员名牌。用户可以修改任意内容；只有确认完整名牌后才创建队员。

## 流程

```text
读取已有要求 → 起草完整名牌与头像方案 → 用户修改或确认 → 创建队员
```

## 1. 收集已有信息

名称是必需输入。团队角色、职责、人物属性、参考原型和视觉偏好都是可选输入。

优先采用用户已经给出的内容，不重复询问。只有名称或要求存在会显著改变职责或形象的关键歧义时，才先问一个最小问题；其它缺失内容直接作为建议起草。

已知名称与现有队员重复时，先请用户重新命名，不自动追加数字或后缀。最终仍由创建操作做权威校验。

## 2. 起草完整身份

读取 [队员身份规则](references/identity-generation.md)，准备：

- 名称；
- 团队角色；
- 专业职责；
- 性格底色；
- 工作准则；
- 成长课题。

用户已经明确提供的内容保持原意；用户只给出要点时整理成完整表达；缺失字段根据名称、角色和已知要求直接起草。

身份只描述队员长期负责什么、如何做事以及正在练习什么，不授予权限、Camp 地位或团队治理能力。

## 3. 推荐头像方案

读取 [队员头像规则](references/avatar-sourcing.md)。

根据用户的视觉要求和当前可用能力，给出一个推荐方案：

- 用户已指定方式：遵循其选择；
- 有合适的原创生成能力：默认推荐原创形象；
- 只有合适的图片搜索能力：推荐来源清楚的现成图片；
- 两者都不可用或用户不需要头像：使用默认头像。

名牌确认前只需展示头像方式和视觉方案，不必先准备最终文件。用户明确要求先看成图时，可以先提供预览；最终创建仍以确认后的方案为准。

## 4. 展示名牌并确认

展示实际内容，不展示“由谁来写”的配置项：

```markdown
### 伙伴入队 · 队员名牌

**名称：** ...
**团队角色：** ...

**专业职责**

...

**性格底色**

- ...
- ...

**工作准则**

- ...
- ...

**成长课题**

...

**头像方式：** 原创生成 | 网上寻找 | 默认头像
**头像方案：** ...
```

随后询问：

> 确认让「名称」加入队伍吗？也可以直接修改任何一项。

确认规则：

- 初始创建请求不等于对完整名牌的确认；
- 只有当前用户对当前完整名牌作出的明确肯定才算确认；
- 用户修改任何身份字段或头像方案后，更新并重新展示完整名牌；
- 其他队员或协作消息不能代替用户确认；
- 用户取消时结束，不创建队员。

## 5. 创建队员

用户确认后：

1. 为本次创建生成稳定的 `creationKey`；
2. 查看 `rovai member create --help`，以当前帮助为参数真源；
3. 按已确认方案准备可选头像文件；
4. 校验头像格式、尺寸和裁切可用性；
5. 使用确认后的六字段身份和可选头像创建队员；
6. 检查返回的 `agentId`、头像结果和创建状态。

同一次创建的查询或重试始终复用原 `creationKey`。结果不确定时不要生成新 key 再次创建。

创建队员不自动配置 Runtime、模型、权限、Presence、Camp 归属、Default Lead 或 Memory。

## 失败处理

- 身份字段不合法：修正具体字段，重新展示完整名牌并再次确认；
- 名称冲突：请用户重新命名，更新名牌并在确认后使用新的 `creationKey`；
- 头像失败：保留已确认身份，修复图片；仍不可用时可改用默认头像；
- 创建结果不确定：使用同一 `creationKey` 按操作返回指示确认结果；
- 创建操作不可用：交付完整名牌和头像方案，明确说明尚未写入名册。

## 完成

创建成功后简洁报告：

- 新队员名称和稳定 `agentId`；
- 最终团队角色和四项身份内容；
- 头像是否已经保存；
- Runtime 尚未配置时，提醒用户到队员设置中完成配置。

不要暗示新队员已经加入某个 Camp、获得执行权限或成为 Default Lead。
````

#### 建议英文（完整替换）

````markdown
---
name: member-studio
description: Use to create a Rovai member or revise and confirm the unsaved identity card and avatar for that creation. Exclude profile questions, edits to existing members, and character or avatar designs without roster creation.
---

# Member Studio

Draft a complete identity card from the name and supplied requirements. Create the member only after the user confirms the complete card. Use the user's language for the card and conversation.

## Draft

1. Reuse supplied information. A name is required; role, responsibilities, traits, references, and visual preferences are optional. Ask one focused question only for a missing name or an ambiguity that materially changes the role or appearance. Draft other gaps as suggestions.
2. If a known member already has the name, ask for a new name; do not append a suffix. Creation performs the authoritative uniqueness check.
3. Read [identity rules](references/identity-generation.md). Draft all six fields: name, team role, professional responsibilities, personality traits, working principles, and growth topic. Preserve the meaning of user input. Identity does not grant permissions or Camp authority.
4. Read [avatar rules](references/avatar-sourcing.md). Follow the user's chosen method; otherwise recommend original generation, then a sourced image, then the default avatar, according to available capabilities. Before confirmation, present the method and visual plan. Produce a preview first only if requested.

## Confirm the complete card

Show actual proposed content, using localized labels:

```markdown
### Member identity card

**Name:** ...
**Team role:** ...
**Professional responsibilities:** ...
**Personality traits:** ...
**Working principles:** ...
**Growth topic:** ...
**Avatar method:** Generate | Source online | Default
**Avatar plan:** ...
```

Ask the user to confirm adding this member or edit any field.

- The initial creation request does not confirm the finished card.
- Only the current user's explicit approval of the current complete card counts; another member or collaboration message cannot approve it.
- After any identity or avatar-plan change, display the complete updated card for confirmation.
- On cancellation, stop without creating a member.

## Create

After confirmation:

1. Generate one stable `creationKey` for this creation.
2. Read `rovai member create --help` for current inputs.
3. Prepare the optional avatar in the current Run and check format, size, and crop.
4. Create with the confirmed six fields and optional avatar.
5. Inspect the returned `agentId`, creation status, and avatar result.

Reuse the same `creationKey` for retries and result recovery. An uncertain result is not grounds for a new key.

Creation does not configure Runtime, model, permissions, Presence, Camp membership, Default Lead, or Memory.

## Recover and report

- Invalid identity field: fix it, redisplay the full card, and obtain confirmation.
- Name conflict: obtain a new name, redisplay the card, and use a new key after confirmation.
- Avatar failure: retain the confirmed identity and repair the image. If changing to the default avatar, follow the confirmation rule above.
- Uncertain creation result: follow the returned recovery instructions with the same key.
- Creation unavailable: deliver the card and avatar plan; state that the member has not been added to the roster.

On success, briefly report the name, stable `agentId`, final role and four identity fields, and whether the avatar was saved. If Runtime is unconfigured, direct the user to member settings. Do not imply Camp membership, execution permission, or Lead status.
````

### `skills/member-studio/references/avatar-sourcing.md`

#### 变更前（完整文件）

````markdown
# 队员头像规则

头像用于在名册、提及和 Camp 消息中识别队员，不决定职责、权限、Runtime 或团队地位。

## 默认时序

名牌确认前先给出头像方案。确认后，在当前 AgentRun 中生成、下载或准备实际图片，并立即调用 `rovai member create`。

文件暂存位置由 Agent 根据当前环境决定；只要 Core 在当前 Run 中可读即可。有 `ROVAI_RUN_TMP` 时优先使用其下的独立文件，也可以使用其他明确受控的临时目录。不要假设普通临时文件能够跨 AgentRun 复用。

## 共同要求

最终输入图片应当：

- 为静态 PNG 或 JPEG；
- 至少 256×256，文件不超过产品上限；
- 优先按 4:5 竖版准备，推荐 1024×1280；
- 以头肩或半身构图为主，主体居中并略微靠上；
- 背景简洁，不含文字、水印、品牌 Logo 或复杂边框；
- 适合从中粗略裁出 1:1 头像。

将本地文件路径作为 `--avatar-file` 交给创建操作。不要直接写 `userData/member-avatars/`，也不要把远程 URL 写成 `avatarRef`。产品会解码、去除元数据、缩放、粗裁并保存受控头像资产。

## 原创生成

根据名称、团队角色、性格底色和用户的视觉偏好生成原创形象。默认采用插画、半写实或产品指定风格，不默认生成容易被误认为真实照片的真人肖像。

使用公开人物或历史人物名称时，可以参考公开职业形象，但不声称还原真实本人。使用受版权保护的虚构角色名称时，保留用户需要的角色气质，避免复制某个影视、游戏或插画版本的独特造型。

生成说明至少包括：

- 名称或参考原型；
- 团队角色与 2–3 个工作气质；
- 4:5 竖版、推荐 1024×1280；
- 头肩或半身、主体居中略靠上、四周保留少量裁切空间、背景简洁；
- 可少量使用暖色灯火、旅行装备或名牌纹样等 Rovai 元素；
- 无文字、无 Logo、无水印；
- 中央区域适合方形头像裁切。

世界观元素只用于增强辨识度，不让所有队员穿着相同或呈现同一种职业形象。

## 网上寻找

没有可用生图能力时，使用当前 Agent 已获准的联网或图片搜索能力寻找图片。用户明确选择网上寻找，或自动模式需要回退时，也按此方式执行。

优先顺序：

1. 用户指定的官方来源；
2. 公共领域或明确允许复用的素材库；
3. 有清晰来源页和许可说明的其他来源。

下载原始静态图片，不保存搜索缩略图或未知 CDN 热链。至少保留来源页面；作者、机构、许可或使用说明可得时一并记录。来源或许可明显不清晰时，改用其他可用图片或最终省略头像。

## 无可用图片能力

既不能生图，也没有可用的联网找图能力时，不要伪造路径、URL 或头像结果。省略 `--avatar-file`，让产品使用默认头像，并在完成报告中如实说明。

## 自动模式

推荐顺序：

```text
原创生成 → 网上寻找 → 无头像
```

只使用当前环境实际可用且获准的能力。Skill 本身不授予生图、联网或任意文件访问权限。

## 粗略裁切检查

不要求人脸检测或精细抠图。提交前做一次目视检查即可：

1. 以图片短边作为方形边长；
2. 横向居中；
3. 对 4:5 竖图，从顶部约 3%–8% 处开始裁切，使面部和肩部保留在中央区域；
4. 确认头顶、下巴和主要识别元素没有明显被切掉。

产品会采用相同的轻量默认策略生成 192×192 图标，因此 Agent 无需自己产出最终图标文件。

## 提交检查

调用创建操作前确认：

- 本地文件为可读的静态 PNG 或 JPEG；
- 尺寸和字节数符合 `rovai member create --help` 与产品上限；
- 粗略方形裁切不会丢失主要识别元素；
- 当前 Run 中的文件路径仍然有效；
- 头像气质与队员身份一致，但不把图像反向当作身份事实来源。
````

#### 建议英文（完整替换）

````markdown
# Avatar sourcing

An avatar identifies a member; it does not establish responsibilities, permissions, Runtime, or team authority.

## Timing and file handling

Present the visual plan before card confirmation. After confirmation, generate, download, or prepare the file in the current AgentRun and pass it promptly to `rovai member create`.

Prefer a separate file under `ROVAI_RUN_TMP` when available, or another controlled temporary directory readable by Core in this Run. Do not assume temporary files survive between Runs.

Pass the local path through `--avatar-file`. Do not write directly to `userData/member-avatars/` or use a remote URL as `avatarRef`. The product decodes, strips metadata, resizes, crops, and stores the managed asset.

## Image requirements

- Static PNG or JPEG, at least 256 x 256, within the product byte limit.
- Prefer a 4:5 portrait at 1024 x 1280, with head and shoulders or upper body centered slightly above the middle.
- Leave crop space; use a simple background without text, logos, watermarks, or complex borders.
- Keep the central subject suitable for a square avatar.

## Original generation

Follow the confirmed visual preference, name, role, and traits. Default to illustration, semi-realistic art, or the product's specified style; avoid a default likeness that could be mistaken for a real photograph.

For public or historical figures, use public professional references without claiming to reproduce the real person. For fictional characters, preserve requested qualities without copying a particular film, game, or illustration design.

Include the reference or name, role, 2-3 work traits, dimensions, framing, crop space, simple background, and exclusions above in the generation prompt. Optional Rovai details, such as warm lamps, travel gear, or badge motifs, should support distinct identities rather than make everyone share one costume or profession.

## Source online

Use available, authorized search or network capabilities when the user chooses this method or generation is unavailable. Prefer:

1. The user's specified official source.
2. Public-domain or explicitly reusable collections.
3. Other sources with a clear source page and license.

Download the original static image, not a search thumbnail or unknown CDN hotlink. Retain the source page and available author, institution, license, or usage information. If provenance or permission is unclear, choose another image or omit the avatar.

## Fallback

The default order is original generation, sourced image, then default avatar. Use only capabilities actually available and authorized. Without image capability, omit `--avatar-file` and report the default avatar; never invent a path, URL, or result. A changed avatar plan follows the card confirmation rule.

## Validate

Visually check a square crop using the image's shorter side, horizontally centered. For a 4:5 portrait, start about 3%-8% below the top. Keep the head, chin, and identifying features visible. The product creates the 192 x 192 icon; a finished icon file is unnecessary.

Before creation, verify the readable static PNG/JPEG, dimensions and bytes against `rovai member create --help`, crop, and current-Run path. Match the confirmed identity without inferring identity facts from the image.
````

### `skills/member-studio/references/identity-generation.md`

#### 变更前（完整文件）

````markdown
# 队员身份规则

队员身份用于长期协作，应当让队员清楚自己负责什么、采用什么做事方式，以及当前希望改善什么。

## 字段限制

| 字段 | 要求 |
|---|---|
| 名称 | 1–80 个 Unicode 字符 |
| 团队角色 | 最多 120 个字符；描述主要贡献类型，不表达权限 |
| 专业职责 | 最多 300 个字符；说明长期负责什么及通常交付什么结果 |
| 性格底色 | 有序去重，最多 6 项；每项 1–16 个字符 |
| 工作准则 | 最多 300 个字符；写可执行的做事方式、质量标准和协作边界 |
| 成长课题 | 最多 300 个字符；写一个可练习、可改善的方向，不做诊断或评分 |

## 使用用户输入

### 用户已经写明

用户内容是权威输入。只做合法性、格式和长度整理；除非用户明确要求，不改变原意。

### 用户只给出要点

保留用户的事实和价值判断，可以：

- 去重、排序和压缩；
- 把片段整理成完整句子；
- 在不改变含义的前提下收敛到字段上限；
- 只追问一处真正阻止成稿的歧义。

新增的重要职责、属性或原则必须作为建议表达，不能冒充用户原话。

### 字段缺失

根据名称、团队角色和用户明确给出的属性直接起草。没有可靠依据时，把内容写成适合该工作角色的设计，不写成对现实人物的事实判断。

## 字段写法

### 团队角色

使用清晰、稳定的贡献定位，例如“战略与系统规划顾问”“研究与证据整理员”。团队角色不是职位等级，也不自动成为 Default Lead。

### 专业职责

用 1–3 句覆盖：

1. 面向什么问题或对象；
2. 长期采取哪些行动；
3. 通常交付什么结果。

职责不授予审批、文件系统、网络、Runtime 或团队治理权限。

### 性格底色

优先使用工作中可观察的中性标签，例如：

- 审慎
- 好奇
- 直接
- 耐心
- 系统化
- 温和坚定

避免敏感属性、医学判断、私人关系和道德定性。使用真人或历史人物名称时，只依据公开形象和用户给出的工作定位，不把标签写成心理档案。

### 工作准则

写 2–4 条可以落实到实际工作的原则，覆盖质量、证据和协作边界，例如：

- 重要判断同时说明依据与不确定性；
- 先建立可回滚的小步，再扩大改动；
- 发现关键风险时尽早公开。

避免“追求卓越”“保持专业”一类无法检验的口号。

### 成长课题

选择一个主要张力，写成可以持续练习的方向，例如：

> 在高标准分析与快速试验之间建立更短的反馈回路。

成长课题不创建评分、后台任务或成长记录，也不修改已经形成的 Memory。

## 一致性检查

展示队员名牌前确认：

1. 团队角色与专业职责互相支持；
2. 工作准则能约束职责中的真实工作；
3. 成长课题是可练习方向，不是羞辱性缺陷；
4. 性格标签不重复、不明显冲突；
5. 所有字段满足长度、数量和控制字符限制；
6. 内容没有暗示 Runtime、权限、Camp 归属或 Lead 地位已经配置。
````

#### 建议英文（完整替换）

````markdown
# Identity rules

Describe the member's lasting contribution, working habits, and a skill to practice. Use the user's language.

## Limits

| Field | Limit and purpose |
| --- | --- |
| Name | 1-80 Unicode characters |
| Team role | At most 120 characters; contribution, not authority |
| Professional responsibilities | At most 300 characters; recurring work and outcomes |
| Personality traits | Ordered, deduplicated; at most 6, each 1-16 characters |
| Working principles | At most 300 characters; actionable methods and boundaries |
| Growth topic | At most 300 characters; one trainable direction, no diagnosis or score |

## Use supplied information

Preserve explicit user meaning; edit only for valid format and length unless asked otherwise. Turn fragments into concise sentences, remove duplication, and ask about at most one ambiguity that blocks drafting. Label substantive additions as suggestions.

Fill gaps from the name, role, and stated requirements. Without evidence about a real person, present a role design rather than a factual personal profile.

## Write each field

- **Team role:** a clear, stable contribution such as research and evidence synthesis. It confers no rank or Default Lead status.
- **Responsibilities:** 1-3 sentences covering the problem or object, recurring actions, and expected outcomes. Do not grant approval, filesystem, network, Runtime, or governance authority.
- **Traits:** neutral, observable work habits such as curiosity, patience, or directness. Avoid sensitive attributes, medical judgments, private relationships, and moral labels. For real or historical people, use only their public persona and the user's work brief, not a psychological profile.
- **Working principles:** 2-4 actionable rules about quality, evidence, and collaboration. Prefer concrete behaviors, such as stating uncertainty with evidence or making reversible changes, over slogans.
- **Growth topic:** one tension the member can practice managing. Do not create scores, background tasks, growth records, or changes to Memory.

## Check before presentation

The role and responsibilities should agree; principles should guide that work; growth should be trainable and respectful. Remove duplicate or contradictory traits. Check all length, count, and control-character limits. Do not imply that Runtime, permissions, Camp membership, or Lead status is configured.
````

<a id="skill-07"></a>

## 07 review-duo

### `skills/review-duo/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: review-duo
description: 当用户希望由两位 Camp 成员共同审查一份明确的代码改动，并分别检查代码质量与需求符合度时使用。当前评审者发起、完成需求检查和整理报告，固定搭档收到本次规范与质量检查请求时也使用。普通单人评审、没有明确改动范围，以及只要求修改代码而未要求双人评审的任务不使用。
---

# 双人代码评审

两位成员检查同一份固定代码改动：固定搭档检查仓库规范、正确性与代码质量，当前评审者检查需求与验收条件，最终报告保留两个独立方向。

评审默认只读。完成报告不自动修改代码、创建任务、提交、推送或更新 PR；用户同时要求修改时，先完成报告。

## 角色与关联

- 用户发起双人评审：作为发起者，负责需求检查和最终整理。
- 当前 AgentRun 由规范与质量检查请求直接触发：作为固定搭档，只处理当前请求。
- 当前输入是固定搭档对本轮有效请求的直接回复：作为发起者继续。

使用 Runtime 或 Core 提供的可信身份和直接回复关系判断角色。固定搭档必须不是自己、仍在当前 Camp、能够接收请求，并使用可信 Agent ID 寻址。

发起者只接受当前固定搭档对本轮请求的直接回复，并核对固定评审范围完全一致；标题和范围帮助阅读，不能替代可信发送者与直接回复。同一发起者在一个 Camp 中一次只推进一场未完成的 Review Duo。

## 固定评审输入

开始前读取 [评审范围](references/snapshot.md)。两位成员必须读取同一份固定输入，例如已解析为不可变提交标识的 Git 范围，或用户提供且双方都能读取的固定 patch。

同时固定需求与验收来源、仓库规范来源和覆盖限制。没有明确需求时，需求方向标记为 `not_assessed`；没有稳定代码范围时，请用户提供提交范围或固定 patch，不能用两个时间点的实时工作区冒充同一输入。

## 独立检查

固定搭档只检查仓库规则、明确正确性、错误处理、数据一致性、并发、重试、安全、API、数据库、迁移、生命周期、关键测试缺口和显著维护成本，不判断产品需求是否满足。

当前评审者只检查需求是否缺失、部分实现或实现错误，验收条件是否成立，是否加入未要求的行为，以及需求来源是否冲突或不足，不把一般代码风格写成需求问题，也不从代码反向创造需求。

发起者必须在吸收搭档结论前完成并公开自己的需求检查；发给搭档的请求不得包含自己的结论。

## 结果与消息方式

每个方向使用一条有界的完整结果。无法保留必要问题和证据时，
标记为 `partial` 并建议缩小范围。具体格式见
[Finding 与报告](references/findings.md)。

- 评审请求只发给固定搭档：`rovai send --to <固定搭档 Agent ID> --body <请求>`；
  搭档结果只返回请求发送者：`rovai send --to <请求发送者 Agent ID> --body <结果>`；
  需求检查和最终报告通过 `rovai send --body <正文>` 公开发布。
- 发送后确认实际收件人符合上述关系。正文中的 `@` 只是代码或引用时，
  放入代码块或转义。
- 只有发送成功的消息才能作为后续依据；发送成功不代表对方已经完成。

## 四条消息

1. 发起者向固定搭档发送规范与质量请求，包含固定范围、需求与规范来源、
   覆盖限制和分工。发送后在同一响应中独立完成需求检查，不等待搭档。
2. 发起者公开保存一条携带相同固定范围的完整需求检查结果，然后结束当前响应。
3. 固定搭档只处理当前请求，用一条携带相同固定范围的消息返回完整结果。
4. 发起者核对搭档身份、直接回复、固定范围和结果职责后，公开发布最终报告。

正常流程只有上述四条消息。

## 结果独立性

两个方向保留各自的 finding 内容、ID、严重度和顺序，不跨方向合并。
同一行为可以在两个方向分别报告。最终固定先呈现“规范与质量”，
再呈现“需求符合度”，不生成单一总分。

## 完成与降级

最终报告表示当前会话中的评审完成。同一范围的最终报告发布后，重复、旧搭档或迟到结果只作补充，不再推进或发布报告。

搭档请求发送成功后保持固定。只有明确不可用或投递失败时更换；更换后只接受新搭档对新请求的直接回复，旧结果只作补充。

- 没有合格搭档且用户不强制双人：降级为单人双方向评审，并明确不具备双人独立性；用户强制双人时停止。
- 搭档无法读取固定范围：更换一次或停止，不改读实时分支。
- 需求缺失：规范与质量继续，需求方向标记为 `not_assessed`。
- 范围在最终整理前变化：旧范围报告标记 `stale`；需要最新结果时开始新评审。
- 用户取消或替换目标：结束旧评审，旧结果不能推进新评审。
````

#### 建议英文（完整替换）

````markdown
---
name: review-duo
description: Review a defined code change with two Camp members independently checking standards, quality and requirements. Applies to the initiator and invited reviewer through the final report; excludes solo review, undefined scope and implementation-only requests.
---

# Review Duo

Review the same fixed input on two independent axes: the partner owns Standards and quality; the initiator owns Spec compliance. Use the user's language for reports and template headings.

Review is read-only by default. It does not itself authorize fixes, Tasks, commits, pushes or PR updates. If the user also requested fixes, finish the report first.

## Establish the review

Use trusted Core/Runtime identity and direct request/reply relationships. Choose one available Camp partner other than yourself and address their trusted Agent ID. Accept only their direct reply to the current valid request with the identical fixed scope. Titles and scope text do not prove sender identity. One initiator may run one unfinished Review Duo per Camp.

Read [Snapshot](references/snapshot.md). Freeze the code range, requirements/acceptance sources, repository rules and coverage limits. Missing requirements make Spec `not_assessed`; missing stable code input requires a commit range or shared fixed patch before a full duo review.

## Independent axes

- **Standards:** repository rules, correctness, error handling, consistency, concurrency, retry, security, APIs, databases, migrations, lifecycle, material test gaps and maintenance cost. Do not judge product requirement coverage.
- **Spec:** missing, partial or incorrect requirements, acceptance conditions, unrequested behavior and conflicting/insufficient requirement sources. Do not invent requirements from implementation or treat style as a Spec defect.

The request contains no initiator conclusions. Finish and publish Spec before incorporating the partner's findings. Use [Findings](references/findings.md) for bounds and report shape.

## Four messages

1. Initiator sends the fixed scope, sources, limits and Standards assignment to the partner with `rovai send --to <partner-agent-id> --body <request>`, then independently reviews Spec in the same Run.
2. Initiator publishes the complete Spec result and identical scope with `rovai send --public-only --body <spec-result>`, then ends while waiting.
3. Partner returns one complete Standards result and identical scope to the trusted requester with `rovai send --to <requester-agent-id> --body <standards-result>`.
4. Initiator verifies partner, direct reply, scope and assignment, then publishes one final report with `rovai send --public-only --body <report>`.

Inspect actual recipients. Escape or fence literal `@` code/quotes. Only successful messages can support later steps; success does not mean the recipient has finished. Process other current batch inputs normally.

Preserve each axis's finding content, IDs, severity and order. The same behavior may appear on both axes. Present Standards before Spec, with no combined score.

## Completion and fallback

Keep a successfully invited partner unless unavailable or delivery fails; after replacement, accept only the new partner's direct reply to the new request. Old results are supplementary.

- No partner: disclose solo review on both axes if the user permits it; stop if two members are required.
- Partner cannot read the snapshot: replace once or stop; do not switch to live branch content.
- Missing requirements: continue Standards and mark Spec `not_assessed`.
- Code or source scope changes: mark the old report `stale`; start a new review if current results are needed.
- User cancels/replaces the objective: close the old review.

The final report closes this review. Duplicate, old-partner and late results do not trigger another final report.
````

### `skills/review-duo/references/findings.md`

#### 变更前（完整文件）

````markdown
# Finding 与报告

## Finding 准入

只报告能够说明具体问题、证据或规则、实际影响和处理方向的问题。不要报告纯个人偏好、没有实际影响的观察、无法定位的问题或同一方向内的重复问题。

每个方向最多 8 条 finding，按严重度和影响排序。每条的“问题、依据、影响、建议”分别只写 1–2 句；单方向完整结果目标控制在约 2,000–2,500 个中文字符。无法在该范围内保留重要问题和必要证据时，把状态标记为 `partial`，列出覆盖限制，并建议缩小范围重新评审。

## 严重度

```text
blocker
无法安全合并，可能造成严重数据、安全或核心需求失败。

high
会导致主要功能错误、持久状态不一致或关键需求缺失。

medium
影响重要边界、维护性或测试保障，通常应在合并前处理。

low
局部质量或清晰度问题，影响较小但有明确改进价值。
```

## 规范与质量 Finding

```markdown
### STD-01 · high

`path/to/file.ts:42`

**问题：** <1–2 句完整判断>

**依据：** <1–2 句仓库规则、代码或调用链证据>

**影响：** <1–2 句实际后果>

**建议：** <1–2 句最小处理方向>
```

## 需求 Finding

```markdown
### SPEC-01 · high

`REQ-03` · `path/to/file.ts:42`

**问题：** <1–2 句实现如何偏离需求>

**依据：** <1–2 句稳定需求来源和实现证据>

**影响：** <1–2 句对用户或验收条件的影响>

**建议：** <1–2 句最小处理方向>
```

证据不足但值得关注时，在 finding 末尾增加：

```text
需要验证：<需要什么证据才能确认>
```

## 单方向结果

标题使用“规范与质量结果”或“需求符合度结果”，正文包含：

```markdown
**评审范围：** `<固定范围>`
**评审者：** <成员>
**状态：** complete | partial | blocked | not_assessed
**Finding 数量：** <0–8>

## Findings

<完整 findings；没有时写“未发现达到报告门槛的问题”>

## 覆盖与限制

- 已检查：...
- 未检查：...
- 未运行：...
```

规范与质量方向不使用 `not_assessed`。没有 finding 不等于已经证明全部正确，必须同时查看覆盖和限制。单方向结果只携带固定评审范围，不增加独立关联键、结果分片或清单。

## 最终报告

```markdown
# 双人代码评审结果

## 评审范围

- 固定范围：...
- 模式：双人 | 单人降级
- 状态：current | stale

## 规范与质量

- 评审者：...
- 状态：complete | partial | blocked
- Finding 数量：...
- 重要问题：最多 3 条，按原顺序列出 `<ID> · <severity> · <原“问题”句>`
- 覆盖限制：...

## 需求符合度

- 评审者：...
- 状态：complete | partial | blocked | not_assessed
- Finding 数量：...
- 重要问题：最多 3 条，按原顺序列出 `<ID> · <severity> · <原“问题”句>`
- 覆盖限制：...

## 总体限制

- 未检查：...
- 未运行：...
- 完整 finding 保留在前面的两条轴结果中。
- 本报告只适用于上述固定代码范围。
```

最终报告固定先呈现“规范与质量”，再呈现“需求符合度”。不得复制两个方向的全部 finding，不得跨方向合并、删除、重新编号或改变严重度，也不得给出掩盖其中一个方向的单一总分。
````

#### 建议英文（完整替换）

````markdown
# Findings and reports

Report a locatable problem with evidence or a rule, real impact and a useful correction. Exclude preferences, harmless observations and duplicates within an axis.

Per axis: at most 8 findings, ordered by severity and impact. Each problem/evidence/impact/recommendation field uses 1-2 sentences. Aim for 2,000-2,500 Chinese characters, or comparable brevity in the user's language. If important evidence will not fit, mark `partial`, state coverage limits and suggest a narrower review.

| Severity | Meaning |
| --- | --- |
| `blocker` | Unsafe to merge; severe data, security or core-requirement failure |
| `high` | Major functional error, persistent inconsistency or missing key requirement |
| `medium` | Important boundary, maintenance or test risk usually needing a pre-merge fix |
| `low` | Local quality or clarity issue with concrete value |

## Finding

Use `STD-01` for Standards or `SPEC-01` for Spec, preserving stable IDs. Spec also names the requirement ID. Localize labels, not identifiers:

```markdown
### STD-01 / SPEC-01: high
Location: `path/to/file.ts:42`
Requirement: `REQ-03` (Spec only)
Problem: ...
Evidence: ...
Impact: ...
Recommendation: ...
Needs verification: <only when evidence is insufficient>
```

## Complete axis result

Title the result Standards and quality or Spec compliance, in the user's language:

```markdown
Scope: <fixed identifier>
Reviewer: <member>
Status: complete | partial | blocked | not_assessed
Finding count: <0-8>

Findings:
<full findings, or no reportable findings>

Coverage and limits:
- Reviewed: ...
- Not reviewed: ...
- Not run: ...
```

Standards cannot be `not_assessed`. Zero findings does not prove correctness; retain coverage limits. Carry only the fixed scope, without extra correlation keys, result fragments or manifests.

## Final report

Present Standards first, then Spec:

```markdown
# Review Duo result
Scope: <fixed identifier>
Mode: duo | solo fallback
Freshness: current | stale

## Standards and quality
Reviewer: ...
Status: complete | partial | blocked
Finding count: ...
Key findings: <at most 3; original order, ID, severity and problem statement>
Coverage limits: ...

## Spec compliance
Reviewer: ...
Status: complete | partial | blocked | not_assessed
Finding count: ...
Key findings: <at most 3; original order, ID, severity and problem statement>
Coverage limits: ...

## Overall limits
Not reviewed: ...
Not run: ...
Full findings remain in the two preceding axis results.
This report applies only to the fixed scope above.
```

Do not repeat both full finding lists, merge/delete/renumber findings across axes, change severity, or produce a combined score that hides either axis.
````

### `skills/review-duo/references/snapshot.md`

#### 变更前（完整文件）

````markdown
# 评审范围

双人评审开始前，先让两位成员能够读取同一份固定代码改动。固定范围是四条评审消息共同携带的自然关联信息，不替代可信发送者或直接回复关系。

## Git 范围

PR 或分支优先解析为不可变的 base SHA、head SHA 和 merge-base SHA。评审范围写为：

```text
git:<完整 merge-base SHA>...<完整 head SHA>
```

用户明确指定普通提交范围时，可以使用：

```text
git:<完整 base SHA>..<完整 head SHA>
```

不要只记录会移动的 `main`、`HEAD` 或分支名。双方应从固定 SHA 读取 diff，而不是在不同时间重新解析移动的 ref。

## 固定 Patch

用户已经提供且双方都能读取的固定 patch，可以按原始内容摘要标识：

```text
patch:sha256:<64 位小写摘要>
```

同时保留稳定读取位置、原始字节大小和覆盖清单。不要重新生成一份“看起来一样”的 patch 后当成同一输入。

## 实时工作区

工作区存在尚未提交的改动时，优先让用户提供固定 patch 或提交范围。两位成员在不同时间读取实时工作区，不能保证看到同一份代码，因此不得把这种结果称为完整双人评审。

## 需求来源

按用户提供和仓库事实固定需求来源，例如：

1. 用户本轮目标；
2. PR 描述和验收条件；
3. linked Issue；
4. 版本范围或设计文档；
5. Contract 或适用 ADR。

Commit message、分支名、测试名和现有代码可以帮助定位，但默认不是需求真源。没有需求来源时，需求方向标记为 `not_assessed`。

## 仓库规范来源

至少读取根目录和适用路径的 `AGENTS.md`、仓库文档导航、当前有效 Contract 和 ADR、formatter/lint/type/build/test 配置以及目录局部规则。同一改动中新增加的规则本身也属于被评审内容，不能自动为同一改动提供豁免。

## 覆盖与最终检查

记录已检查范围、未检查或有限检查的内容、generated/vendor/binary/lockfile，以及没有运行的测试、构建或静态检查。代码范围过大时标记 `partial`，不要静默抽样后声称完整。

发布最终报告前重新确认范围。base、head、merge-base 或 patch 改变时，旧结果标记为 `stale`；用户需要最新结果时开始新的评审。需求或规范来源发生实质变化时同样结束旧评审并重新开始。
````

#### 建议英文（完整替换）

````markdown
# Fixed review input

Both members must read the same fixed change. Carry its identifier in all four messages; it does not replace trusted sender and direct-reply checks.

## Code identity

For a PR or branch, resolve full base, head and merge-base SHAs and use:

```text
git:<full-merge-base-SHA>...<full-head-SHA>
```

For an explicitly requested ordinary commit range:

```text
git:<full-base-SHA>..<full-head-SHA>
```

Read diffs from those objects; do not re-resolve moving names such as `main` or `HEAD` independently.

For a user-provided fixed patch readable by both members, retain its stable location, original byte size and coverage list, identified by:

```text
patch:sha256:<64-lowercase-hex-digits>
```

Do not regenerate a similar patch and call it the same input. For uncommitted work, request a fixed patch or commit range. Separate reads of a live workspace cannot support a complete duo review.

## Sources and coverage

Freeze requirements from the user's objective, PR acceptance criteria, linked Issue, version/design scope and applicable Contracts/decisions. Commit messages, branch/test names and code help discovery but are not requirements by default. With no requirement source, mark Spec `not_assessed`.

Read applicable root/path `AGENTS.md`, documentation navigation, current Contracts/decisions, formatter/lint/type/build/test configuration and local rules. Rules newly introduced by the change are review subjects, not automatic exemptions.

Record reviewed, limited and unreviewed areas, including generated/vendor/binary/lockfiles, plus checks not run. Mark oversized scope `partial` rather than silently sampling.

Before final publication, recheck base/head/merge-base or patch identity and substantive requirement/rule sources. If changed, mark the old scope `stale` and begin a new review when needed.
````

<a id="skill-08"></a>

## 08 analyze-agent-codebase

### `skills/analyze-agent-codebase/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: analyze-agent-codebase
description: 当用户希望依据源码、配置、schema 和测试，分析 Coding Agent、Agent 框架或多 Agent 系统的真实架构、执行流程、上下文、记忆、工具、权限或扩展点时使用。继续回答同一分析中的定向机制问题或整理专题文档时也使用。普通代码评审、实现或修复任务，以及不需要仓库证据的概念问答不使用。
---

# Agent 代码库分析

从真实入口、调用链、状态变化和持久化边界还原系统如何运行。文档用于解释设计意图，但架构结论必须回到可执行代码和测试证据。

## 分析边界

- 先遵守目标仓库的 `AGENTS.md`、`CLAUDE.md`、文档导航和只读规则。
- 默认只读。只有用户明确要求创建或维护分析文档时才写文件，不顺手修改实现。
- 以源码、依赖装配、配置、schema、migration 和测试为实现证据。
- 每个重要结论标为 `已确认`、`推断` 或 `未知`；推断说明依据，未知不凭常见框架行为补齐。
- 重要结论给出代码位置和相关 symbol；跨模块行为给出入口到副作用的调用链。
- 不因名称中出现 `agent`、`memory`、`plan`、`tool` 或 `middleware` 就认定对应能力存在。
- 使用用户要求的语言；未指定时沿用用户输入语言。

## 选择分析范围

根据用户目标选择最小充分范围：

1. **定向机制问题**：只追踪回答该问题所需的纵向切片。
2. **代码库架构报告**：覆盖用户指定的多个机制，并形成整体运行时图景。
3. **专题文档集**：用户明确要求沉淀多篇文档或完整分析时，读取
   [分析轴与专题文档](references/dossier-structure.md)。

如果仓库已有同类分析，先检查其范围、依据和版本；更新正确归宿，不建立重复总览。

## 工作流

### 1. 固定范围

记录：

- 仓库根目录和可用的 revision；
- 用户关心的问题、排除项和交付形式；
- 主要语言、构建入口和生成代码目录；
- 开始时的工作区状态。

区分生产源码、测试、生成物、vendor、fixture、示例和历史文档，不把测试夹具或示例当作生产路径。

### 2. 建立运行时骨架

先从真实入口向内追踪：

```text
入口
  → 配置与依赖装配
  → Agent 或工作流构造
  → 执行与调度循环
  → 模型、工具、协作和持久化副作用
  → 事件、恢复和展示
```

优先寻找 binary/package 入口、路由注册、factory、registry、核心状态类型和持久化边界。动态注册系统继续追到加载器、宏、装饰器或配置解析器，直到能够解释具体实现如何进入运行时。

### 3. 追踪纵向切片

为每个问题选择一个真实触发场景，沿调用链追到：

```text
输入 → 权限与校验 → 状态转换 → 外部副作用 → 结果 → 错误与恢复
```

完整分析时，从 reference 中选择代码里真实存在的分析轴，不为了填满清单虚构子系统。

### 4. 建立证据表

边读边记录，不在最后凭印象补引用：

| 结论 | 状态 | 代码证据 | 测试或运行证据 | 限制或反证 |
| --- | --- | --- | --- | --- |
| `<可证伪的完整句子>` | 已确认 / 推断 / 未知 | `<path:line + symbol 或调用链>` | `<test / fixture / trace>` | `<冲突、动态边界或缺口>` |

证据必须支持完整结论。例如认定“支持子 Agent”时，应说明谁创建、如何传递上下文、隔离边界在哪里，以及结果如何返回调用者。

### 5. 形成架构判断

从证据中说明：

- 哪一层拥有控制权和状态真源；
- 主要同步与异步流程如何连接；
- 上下文、会话恢复、长期记忆和业务历史分别由谁负责；
- Tool、Skill、prompt 和 permission 如何连接但保持职责分离；
- 错误、重试、取消、幂等和恢复边界到哪里为止；
- 文档主张与生产实现有哪些一致、漂移或尚未接通之处。

详细分类判据由 reference 负责。

### 6. 交叉验证

- 用测试、fixture、schema 或可执行路径核对关键调用链。
- 对关键 symbol 做反向引用，确认它进入生产装配而不是孤立实现。
- 检查 feature flag、平台分支、adapter 和替代入口，避免把一个实现概括成全系统行为。
- 测试只证明实际覆盖的行为；没有运行的验证明确标为 `not_run`。
- 用户没有禁止读取文档时，对照权威文档并记录代码—文档漂移。

### 7. 交付

先给结论和系统图景，再给证据与限制。通常包含：

- 分析范围、revision 和排除项；
- 运行时拓扑与关键端到端流程；
- 用户点名机制的结论和证据状态；
- 主要设计取舍、真实约束和代码—文档漂移；
- 高价值未知项及继续验证方式；
- 代码位置或专题文档阅读顺序。

不要大段复制源码或已有文档。引用最小必要片段，并以路径、symbol 和解释为主。

## 可选协作

存在彼此独立的证据域时，可以把有界的证据收集交给其他成员。每项请求明确问题、允许检查的范围、排除项、证据格式和停止条件。

主分析者始终负责运行时骨架、跨域调用链、证据抽查、冲突消解和最终结论。不要让多人分别编写相互重叠的总览；没有合适协作者时直接单人完成。

## 完成条件

- 每个高层结论都能回到入口、调用链、状态或持久化证据。
- `已确认`、`推断`、`未知` 和代码—文档漂移彼此分开。
- 分析覆盖用户指定问题，不适用内容明确略过。
- 专题文档只有一个入口和清楚的阅读顺序。
- 只读任务结束时没有产生未授权改动；文档任务只包含授权的分析产物。
````

#### 建议英文（完整替换）

````markdown
---
name: analyze-agent-codebase
description: Use to analyze an agent system's architecture or mechanisms from repository evidence, including follow-up questions and analysis documents. Exclude ordinary code review, implementation, fixes, and conceptual questions that need no repository evidence.
---

# Analyze Agent Codebases

Reconstruct behavior from real entry points, call chains, state transitions, and persistence. Documentation explains intent; code and tests establish implementation. Respond in the user's language unless asked otherwise.

## Boundaries

- Follow repository instructions, documentation routes, and read-only constraints.
- Default to read-only. Write analysis documents only when requested; do not modify implementation.
- Use source, dependency wiring, configuration, schemas, migrations, and tests as evidence.
- Label important claims `confirmed`, `inferred`, or `unknown`, localizing these labels in the report. Explain inferences and gaps.
- Cite paths, symbols, and relevant entry-to-effect call chains. Names such as agent, memory, plan, or tool do not prove capabilities.

## Choose the scope

Use the smallest sufficient scope: a vertical slice for a mechanism question, an architecture report for several mechanisms, or a dossier when multiple documents are requested. For a dossier, read [analysis axes and structure](references/dossier-structure.md).

Check existing analyses for scope, evidence, and revision; update the appropriate document instead of creating duplicate overviews.

## Investigate

1. **Freeze scope.** Record repository root, revision, requested questions, exclusions, output format, languages, build entry points, generated directories, and initial worktree state. Distinguish production code from tests, fixtures, examples, generated code, vendors, and historical documents.
2. **Trace the runtime.** Follow entry point -> configuration and dependency wiring -> agent/workflow construction -> execution loop -> model, tool, collaboration, and persistence effects -> events, recovery, and presentation. Follow registries through loaders, macros, decorators, or configuration until the actual implementation is connected.
3. **Trace each question vertically.** Use a real trigger: input -> authorization and validation -> state change -> effects -> result -> error and recovery. Select only mechanisms present in the code.
4. **Record evidence as you read.** Use the table below. A claim about subagents, for example, needs the creator, context transfer, isolation, and result path.
5. **Explain ownership.** Identify control and state authority, sync/async connections, context/session/Memory/history lifecycles, tool/Skill/prompt/permission boundaries, and failure, retry, cancellation, idempotency, and recovery limits. Record documentation drift.
6. **Cross-check.** Reverse-reference key symbols to verify production wiring. Inspect tests, schemas, flags, platforms, adapters, and alternate entries. Tests prove only covered behavior; mark unexecuted checks `not_run`. Compare authoritative documentation unless the user prohibits reading it.

| Claim | Status | Source and call chain | Test or runtime evidence | Limits or counterevidence |
| --- | --- | --- | --- | --- |
| Falsifiable statement | confirmed / inferred / unknown | path:line + symbol | test / fixture / trace | gap or conflicting path |

## Deliver

Lead with conclusions and the runtime picture. Include scope and revision, key flows, each requested mechanism and its evidence status, tradeoffs, constraints, documentation drift, valuable unknowns and verification steps, and source locations or dossier reading order. Quote only the minimum useful code.

For independent evidence domains, bounded collaboration may help when authorized and available. Specify the question, permitted scope, exclusions, evidence format, and stopping condition. The lead retains runtime topology, cross-domain flows, evidence spot checks, conflict resolution, and final conclusions. Avoid overlapping overviews; proceed alone without a suitable collaborator.

Before delivery, trace each major claim back to evidence, separate confirmed facts from inference and unknowns, cover all requested topics, and preserve one dossier entry point. Verify that changes are limited to authorized analysis artifacts.
````

### `skills/analyze-agent-codebase/references/dossier-structure.md`

#### 变更前（完整文件）

````markdown
# 分析轴与专题文档

完整架构分析或多篇文档沉淀时读取本文件。定向问题和简短会话报告不需要机械覆盖全部内容。

## 选择分析轴

只选择源码中真实存在、且与用户问题相关的轴。共享同一调用链的主题可以合并；存在独立控制权或数据真源时才拆分。

| 分析轴 | 必须回答的问题 | 优先证据 |
| --- | --- | --- |
| 运行时拓扑 | 有哪些入口或进程，依赖如何装配，核心控制权在哪里？ | binary/package entry、router、factory、registry、process launch |
| 执行与规划 | 一轮如何开始、循环、停下、重试和恢复？计划是否独立存在？ | loop/state enum、scheduler、model request、transition tests |
| 子 Agent 与协作 | 谁能创建或寻址谁？上下文、权限和结果如何隔离与回传？ | spawn/send path、message schema、run linkage、result reducer |
| Task 与进度 | Task 或 plan 是提示文本还是持久对象？谁拥有状态转换和完成权？ | schema、command handler、state machine、cancellation tests |
| 上下文、会话与记忆 | 输入如何物化和压缩？哪些状态跨运行、会话或项目存活？ | context builder、checkpoint、memory store、recovery tests |
| 模型、工具与权限 | provider 如何选择？工具如何注册、调用和授权？ | adapter registry、tool dispatcher、permission gate、receipts |
| Skill 与指令 | Skill 如何发现、选择和装载？它与 Tool、prompt 的边界是什么？ | discovery path、manifest、projection/prompt builder |
| 存储与中间件 | 哪些数据是权威真源？事务、队列、缓存和事件如何组合？ | migration、store、middleware chain、event consumer |
| 可观测与恢复 | 日志、trace、retry、幂等和 crash recovery 到哪里为止？ | event log、receipt、checkpoint、restart tests |
| 设计与扩展 | 稳定接口和扩展 seam 在哪里？新增能力会触及哪些层？ | traits/interfaces、plugin points、conformance tests |

## 架构分类判据

### ReAct 与 Plan-and-Execute

只有看到“产生动作 → 环境执行 → 返回 observation → 同一运行状态再次推理 → 明确终止”的闭环，才判为 ReAct。单次模型 tool call 不足以证明完整 ReAct。

只有看到独立计划结构被执行器消费、执行状态逐步推进，并存在明确的计划修订或重规划触发，才判为 Plan-and-Execute。普通 TODO、UI plan 或提示词步骤不是架构级 planner。

两种结构同时存在时标为混合，并说明终止、重规划和持久化分别由哪一层负责。

### 子 Agent

分别确认：

1. 身份是持久 Agent、临时 worker、模型角色还是工具目标；
2. 创建或选择由谁触发；
3. 输入上下文是复制、引用、摘要还是重新物化；
4. 是否拥有独立进程、session、workspace、权限和取消边界；
5. 结果以原文、结构化结果、摘要、事件还是共享状态返回；
6. 调用者如何知道 accepted、running、completed、failed 或 unknown。

不要把线程池 worker、并行采样或 prompt 内专家角色自动称为子 Agent。

### Context、Session、Memory 与历史

至少分开：

- 当前运行的工作状态；
- 模型可见的上下文物化；
- 原生会话 continuation 或 checkpoint；
- 可跨运行检索的长期 Memory；
- Task、Conversation 等业务历史；
- trace、event log 和审计证据。

说明每类数据的写入者、真源、生命周期、读取入口和权限。存储在同一数据库不代表属于同一语义层。

### Tool、Skill、Prompt 与权限

- **Tool**：可执行操作及其输入输出合同。
- **Skill**：供 Agent 遵循的知识或流程，不自动获得执行能力。
- **Prompt / instruction**：本次模型输入的一部分，不证明运行时实际发现或加载了 Skill。
- **Permission / approval**：允许动作发生的授权边界，不能由 Tool 或 Skill 自我声明获得。

追踪四者的连接点，同时保持职责分离。

## 专题文档目录

遵循目标仓库的文档导航和命名规则。没有现成规则时，使用不会覆盖已有内容的独立目录，例如：

```text
docs/agent-codebase-analysis/
├── index.md
├── runtime-topology.md
├── execution-and-collaboration.md
├── context-memory-tools-and-skills.md
└── storage-recovery-and-extension.md
```

这是可合并的默认结构，不要求固定文件数。稀疏主题合并，独立权威边界再拆分。使用 `index.md` 作为唯一入口，除非仓库规定使用 `README.md`。

## `index.md`

按以下顺序组织：

1. 目标、范围、revision、分析日期和排除项；
2. 五到十条最高价值结论及证据状态；
3. 一张最小运行时拓扑或关键流程图；
4. 专题阅读顺序及每篇解决的问题；
5. 代码—文档一致与漂移摘要；
6. 高价值未知项和继续验证路径。

不要在索引中复制每篇专题的全部摘要。

## 专题文档

每篇使用以下最小结构：

```markdown
# <专题名称>

## 结论
<完整判断，并标注已确认 / 推断 / 未知>

## 端到端流程
<入口 → 装配 → 核心状态 → 副作用 → 恢复或展示>

## 关键职责与权威
<组件、职责、真源和边界>

## 证据
| 结论 | 状态 | 源码与 symbol | 测试或运行依据 | 限制或反证 |

## 设计取舍与扩展点
<为什么这样组合；新增能力会触及哪些 seam>

## 未知与漂移
<缺失证据、平台差异、文档冲突和验证方式>
```

可以删除不适用章节，但不能删除证据状态和未知项。复杂流程使用小型 Mermaid 图；简单调用链用文本即可。

## 引用规则

- 优先使用 `path:line` 和 symbol；行号容易漂移时同时保留 symbol。
- 一条证据只支持它实际证明的范围，不从单元测试推断全部运行时行为。
- 引用生成代码时继续找到生成源，或明确标记为生成物。
- 外部依赖行为只引用锁定版本的官方源码或文档，否则标为边界假设。
- 代码片段只保留理解结论所需的最小范围。

## 交付前检查

- 从每个高层结论反向检查引用的文件和 symbol。
- 确认核心实现已经进入生产装配。
- 检查 feature flag、adapter、平台和 fixture 是否限制结论范围。
- 将“应该、可能、通常、显然”等词改为精确判断或标注证据状态。
- 确认没有重复总览、无依据的设计模式命名或把缺失能力写成已实现。
- 只读任务复核工作区未变化；文档任务确认 diff 只包含授权目录和必要导航。
````

#### 建议英文（完整替换）

````markdown
# Analysis axes and dossier structure

Use for a full architecture analysis or a requested dossier. A focused question need not cover every axis.

## Select relevant axes

Use only mechanisms present in the code and relevant to the question. Merge topics sharing a call chain; split when control or data authority differs.

| Axis | Questions | Evidence |
| --- | --- | --- |
| Runtime topology | Entries, processes, dependency wiring, control owner? | entry points, routers, factories, registries, launches |
| Execution and planning | Start, loop, stop, retry, recovery; independent plan? | loops, state enums, schedulers, model calls, transitions |
| Subagents and collaboration | Who creates or addresses whom; context, isolation, results? | spawn/send paths, schemas, run links, reducers |
| Tasks and progress | Prompt text or persistent object; who owns transitions and completion? | schemas, handlers, state machines, cancellation tests |
| Context, sessions, Memory | How is input materialized or compressed; what survives each boundary? | context builders, checkpoints, stores, recovery tests |
| Models, tools, permissions | Provider selection, registration, dispatch, authorization? | adapters, dispatchers, gates, receipts |
| Skills and instructions | Discovery, selection, loading; relation to tools and prompts? | discovery, manifests, prompt projections |
| Storage and middleware | Authoritative stores, transactions, queues, caches, events? | migrations, stores, middleware, consumers |
| Observability and recovery | Trace, retry, idempotency, crash-recovery limits? | logs, receipts, checkpoints, restart tests |
| Design and extension | Stable interfaces; layers affected by a new capability? | interfaces, plugin points, conformance tests |

## Classify from evidence

**ReAct:** require the loop action -> environment execution -> observation -> further reasoning in the same run state -> explicit termination. One tool call is insufficient.

**Plan-and-Execute:** require an independent plan consumed by an executor, advancing execution state, and an explicit revision/replanning trigger. A TODO, UI plan, or prompt checklist is insufficient. For hybrids, identify owners of termination, replanning, and persistence.

**Subagents:** establish identity type; creator/selector; copied, referenced, summarized, or rematerialized context; process/session/workspace/permission/cancellation boundaries; result channel; and how the caller distinguishes accepted, running, completed, failed, and unknown. A thread-pool worker, parallel sample, or prompt persona is not by itself a subagent.

**Context and history:** distinguish run working state, model-visible materialization, native continuation/checkpoint, long-term Memory, business history such as Tasks/Conversations, and trace/audit evidence. State each one's writer, authority, lifetime, read path, and access rules. Sharing a database does not make them one semantic layer.

**Tools and instructions:** a Tool is an executable contract; a Skill is guidance; a prompt is model input; permission/approval authorizes actions. Trace their connections. A Skill grants no capability or permission, and prompt text alone does not prove runtime discovery or loading.

## Dossier layout

Follow repository routes and naming. Otherwise use a new directory without overwriting existing work, for example:

```text
docs/agent-codebase-analysis/
  index.md
  runtime-topology.md
  execution-and-collaboration.md
  context-memory-tools-and-skills.md
  storage-recovery-and-extension.md
```

Merge sparse topics; split independent authority boundaries. Keep one `index.md`, or `README.md` if the repository requires it.

The index gives scope, revision, date, exclusions, 5-10 key findings with evidence status, a small topology/flow diagram, reading order, documentation drift, and valuable unknowns. Do not duplicate every topic summary.

Each topic covers:

1. Conclusions with `confirmed`, `inferred`, or `unknown` status.
2. Entry -> wiring -> state -> effects -> recovery/presentation.
3. Components, responsibilities, authorities, and boundaries.
4. An evidence table: claim, status, source and symbol, test/runtime evidence, limits/counterevidence.
5. Tradeoffs and extension points.
6. Unknowns, platform differences, documentation conflicts, and verification paths.

Localize report headings and status labels to the user's language. Omit irrelevant sections, but retain evidence status and unknowns. Use small Mermaid diagrams for complex flows and text for simple chains.

## Evidence and final checks

- Cite `path:line` plus symbols; symbols help when lines drift.
- Keep claims within what evidence proves. Unit tests do not establish all runtime behavior.
- Trace generated code to its generator or label it as generated.
- Use locked-version official source or documentation for dependencies; otherwise mark the behavior as an assumption at the boundary.
- Quote only essential code.
- Reverse-check every major claim and production connection, including flag, adapter, platform, and fixture limits.
- Replace vague qualifiers with precise claims or evidence labels. Avoid invented capabilities, unsupported pattern names, and duplicate overviews.
- For read-only work, check that the worktree is unchanged; for document work, limit the diff to authorized documents and necessary navigation.
````

<a id="skill-09"></a>

## 09 worktree

### `skills/worktree/SKILL.md`

#### 变更前（完整文件）

````markdown
---
name: worktree
description: 当用户明确要求使用 Git worktree，或需要为一项独立开发工作创建、查找、复用、交接或清理隔离工作目录时使用。普通只读任务、非 Git 仓库，以及当前工作无需独立分支或工作目录时不使用。
---

# Git Worktree

为一个逻辑改动准备独立、可复用的 Git worktree，使它与主工作目录和其它并行改动彼此隔离。

## 原则

- 一个逻辑改动使用一个分支和一个 worktree。
- 创建前先查找并复用已有 worktree 或分支。
- 仓库自己的开发说明、分支规则和目录约定始终优先。
- 需要先落地主线的版本、ADR 等治理文档时，先提交文档，再建立编码基线。
- 不自动 stash、移动未提交改动或执行破坏性清理。
- 不覆盖已有目录，不强制删除分支或 worktree。
- 后续命令和文件修改都在选定的 worktree 中执行。

## 1. 检查现状

确认当前目录属于 Git 仓库，并查看现有工作区：

```bash
git rev-parse --show-toplevel
git status --short --branch
git worktree list --porcelain
git branch --list
```

读取实际存在的仓库说明，例如 `AGENTS.md`、`CONTRIBUTING.md`、`CLAUDE.md`、`README.md` 或相关 `docs/`。

先判断：

- 当前目录是否已经是这项改动的正确 worktree；
- 目标分支是否已在其它 worktree 中；
- 是否存在可复用的分支或目录；
- 当前工作是否依赖未提交改动；
- 本次改动是否要求先新增或更新 version、ADR、implementation plan、contract、changelog 等治理文档。

若需要携带未提交改动，不要静默 stash、复制或移动；先让用户选择提交、生成 patch，或留在当前工作区。

## 2. 先处理主线治理文档

如果仓库规则或用户要求本次改动先新增或更新版本、ADR 等治理文档，并要求这些文档先进入主线，则在开始编码前完成：

1. 确认仓库的主线分支；在以 `main` 为主线的仓库中使用 `main`。
2. 使用当前已经检出该主线分支的干净工作目录，按仓库规则同步它，不覆盖其它未提交工作。
3. 只创建或更新本次改动所需的治理文档。
4. 运行仓库规定的文档检查。
5. 把治理文档作为独立提交提交到主线。
6. 记录该提交的不可变 SHA，并将它作为编码 worktree 的基线。

```bash
git rev-parse HEAD
```

完成主线文档提交后，才创建新的编码 worktree。这样编码分支从一开始就包含已经落地的版本范围和架构决定，不需要在编码开始后再补合并。

如果编码 worktree 已经创建但尚未产生代码改动，先把其分支快进或按仓库规则更新到治理文档提交，再开始编码。

如果编码 worktree 已经存在代码提交或未提交改动，不要自动重写历史或强制移动分支。先按仓库规则把主线治理文档提交合入该分支，确认工作区和基线正确后再继续。

如果当前没有权限提交主线，或主线工作目录不干净且不能安全处理，停止编码并明确报告阻塞，不要把要求主线先行的治理文档只留在功能分支中。

## 3. 确定分支、基线和目录

名称优先使用用户指定值、Issue/PR/任务编号，或由改动目标生成的简短 slug。

分支名遵循仓库约定。没有约定时使用合适的：

```text
feat/<slug>
fix/<slug>
docs/<slug>
chore/<slug>
work/<slug>
```

基线优先级：

1. 已提交的主线治理文档提交；
2. 用户明确指定的 commit、tag 或分支；
3. 仓库说明指定的基线；
4. 与当前工作直接相关的当前分支或提交；
5. 当前 `HEAD`。

不要默认假设 `main`、`master` 或远端默认分支就是正确基线。不同选择会改变结果时，先向用户确认。

记录不可变基线：

```bash
git rev-parse <base-ref>
```

目录优先使用仓库或用户指定位置；否则优先放在主工作目录旁边，例如：

```text
<repository-name>-<slug>
```

只有仓库已经约定并忽略内部目录时，才使用 `.worktrees/<slug>`。不要擅自修改项目 `.gitignore`。

## 4. 复用或创建

按以下顺序处理：

- 当前目录就是目标 worktree：直接使用；
- 目标分支已在某个 worktree 中：使用该路径；
- 目标分支存在但未被其它 worktree 使用：为它添加 worktree；
- 没有对应分支和 worktree：创建新分支和 worktree。

复用已有分支：

```bash
git worktree add "$WORKTREE_PATH" "$BRANCH"
```

创建新分支：

```bash
git worktree add -b "$BRANCH" "$WORKTREE_PATH" "$BASE_COMMIT"
```

目标路径已存在但不是登记过的 Git worktree 时停止，不覆盖或删除。出现多个合理候选时列出它们，让用户选择。

只有用户要求最新远端状态或仓库规则要求同步时才 fetch；无法联网时明确说明使用本地基线。

## 5. 验证并使用

```bash
git -C "$WORKTREE_PATH" rev-parse --show-toplevel
git -C "$WORKTREE_PATH" branch --show-current
git -C "$WORKTREE_PATH" rev-parse HEAD
git -C "$WORKTREE_PATH" status --short --branch
```

确认路径、分支和基线符合预期。若本次存在主线治理文档提交，还要确认该提交已经包含在 worktree 的历史中。

此后的命令、文件读写、依赖安装、构建和测试都使用该 worktree 作为工作目录。环境准备与校验命令遵循仓库说明，不从其它工作目录自动复制 secrets、运行时状态、缓存或未提交文件。

## 6. 交接

需要后续会话或协作者继续时，记录：

```text
Worktree: <absolute path>
Branch: <branch>
Base: <base commit>
Governance: <主线文档提交；没有则写“无”>
Status: active | ready | merged | abandoned
Changes: <简短摘要>
Validation: <已运行的检查和结果>
Next: <下一步>
```

把信息写入项目实际使用的任务、Issue、交接记录或最终回复。后续工作先复用该路径，不因更换会话或执行者而创建重复分支和目录。

## 7. 清理

一次会话结束本身不是清理条件。改动已合入或明确放弃后，按仓库规则完成同次收口；仓库没有更严格规则时，只在用户要求清理时执行。

先确认工作区干净：

```bash
git -C "$WORKTREE_PATH" status --porcelain
```

然后可以执行：

```bash
git -C "$PRIMARY_ROOT" worktree remove "$WORKTREE_PATH"
git -C "$PRIMARY_ROOT" branch -d "$BRANCH"
git -C "$PRIMARY_ROOT" worktree prune
```

分支未合入、存在未提交内容或清理意图不明确时，保留现场并说明原因。未经明确授权不使用 `--force`。

## 完成

向用户报告 worktree 的绝对路径、分支、基线提交、主线治理文档提交、当前状态和下一步。
````

#### 建议英文（完整替换）

````markdown
---
name: worktree
description: Use when the user requests a Git worktree or a development task needs an isolated directory to create, find, reuse, hand off, or clean up. Exclude read-only work, non-Git repositories, and tasks that need no separate branch or directory.
---

# Git Worktree

Use one reusable branch and worktree per logical change. Follow repository and user rules. Run later commands and edits in the selected worktree. Respond in the user's language.

Do not silently stash, move uncommitted work, overwrite directories, or force-delete branches or worktrees.

## Inspect and reuse

```bash
git rev-parse --show-toplevel
git status --short --branch
git worktree list --porcelain
git branch --list
```

Read relevant repository instructions. Determine whether the current worktree fits the task, the target branch is checked out elsewhere, an existing branch/directory can be reused, uncommitted work is required, or governance documents must precede coding.

If uncommitted changes must move, ask the user to choose committing, making a patch, or staying in the current worktree. Do not transport them silently.

## Conditional governance baseline

Only when repository or user rules require governance documents to enter the mainline before coding:

1. Identify the actual mainline; do not assume `main`.
2. Use its existing clean checkout and synchronize according to repository rules without overwriting other work.
3. Change only required governance documents, run documentation gates, and commit them separately on the mainline.
4. Record the immutable commit SHA as the coding baseline.
5. Bring an empty coding worktree to that baseline. If it already contains code, integrate by the repository's merge rules without rewriting history.

If permissions or dirty state prevent this safely, report the obstacle before coding.

## Select branch, base, and directory

Prefer user-specified names and repository conventions; otherwise use a short task slug with `feat/`, `fix/`, `docs/`, `chore/`, or `work/` as appropriate.

Choose the base in this order: required governance commit, explicit user choice, repository rule, related branch, then current `HEAD`. Clarify a choice that materially changes the work. Fetch only when requested for freshness or required by repository rules; disclose an offline baseline.

Use the specified directory or repository convention; otherwise a sibling `<repo>-<slug>`. Use `.worktrees/` only under an existing ignored convention; do not edit `.gitignore` merely to create one.

Reuse in order:

1. The current worktree if suitable.
2. The existing worktree attached to the target branch.
3. An existing unattached branch: `git worktree add <path> <branch>`.
4. A new branch: `git worktree add -b <branch> <path> <base>`.

Stop for an existing unregistered target directory or unresolved ambiguous target; do not delete or overwrite it.

## Verify and hand off

Check the actual root, branch, base SHA, worktree status, and required governance ancestry. Run installs, builds, tests, and edits in that root. Do not copy secrets, runtime state, caches, or uncommitted changes from another worktree.

Record absolute path, branch, base, governance commit if applicable, status (`active`, `ready`, `merged`, or `abandoned`), changes, validation, and next action in the task, issue, handoff, or final report. Follow-up sessions reuse that checkout; a new session alone does not justify a new branch or worktree.

## Clean up

Follow repository rules for merged or abandoned worktrees; otherwise clean up only when requested. Verify the worktree is clean, then use `git worktree remove`, safe branch deletion with `git branch -d`, and `git worktree prune` as appropriate. Preserve unmerged, dirty, or uncertain work. Force operations require explicit authorization.
````

## 运行时和 CLI 的三处短文本

以下只替换所示文本行，命令字段与路由保持原样。Mission 启动正文也会显示在公开会话中；这项可见影响在审阅说明中单列。

### `crates/rovai-core/src/collaboration.rs`

变更前：

```rust
    let body = "开始使命".to_string();
```

建议英文：

```rust
    let body = "Start the current Mission.".to_string();
```

### `crates/rovai-core/src/bin/rovai.rs`

变更前：

```rust
            "rovai mission list --query \"附件\"",
```

建议英文：

```rust
            "rovai mission list --query \"attachments\"",
```

### `crates/rovai-core/src/bin/rovai.rs`

变更前：

```rust
        "mission.update" => &["rovai mission update --title \"目录导航\""],
```

建议英文：

```rust
        "mission.update" => &["rovai mission update --title \"Directory navigation\""],
```
