---
document_type: design-comparison
version: v1.72
revision: 2
status: confirmed
last_updated: 2026-10-03
---

# Thread 查询提示词与 CLI 帮助完整对照

本附录是[方案 r2](model-context-change-thread-runs.md)的组成部分，基线为 `f229ce3edf24d4054499babf98b0b3d984e46868`。下面的“变更前”取自该基线源码；Rust 转义已还原为模型实际读取的文本。“变更后”是完整替换稿，不是已生效的运行结果。

r2 只明确生效策略，以下提示词全文不再增字：旧 Session 的 resume 与压缩补发继续使用原冻结 Bootstrap，新 Session 才生成新版；受管 Skill 正文与 reference 随升级同步原路径，旧、新 Session 后续读取文件均可取得新版。

用户要求上下文提示词尽可能简洁有效。因此常驻 Charter 只改两处：命令目录加 `runs`，已有等待规则加 `or execution status`。平台 Skill description、其他索引和每轮动态上下文保持原文。具体用法只放在 Agent 按需读取的帮助和 reference 中；不把完整 JSON 合同注入每轮上下文。

下面每个文本块是该层的完整内容。读取帮助同时就是目录中 description 的可见载体，避免另写一份含义不同的教学。新 runs 的完整数据形状和验证条件由主方案拥有。

## 阅读顺序

1. 先看公开 Charter 的两处短改动。
2. 再看 CLI 根帮助、read 帮助及新增 runs 帮助。
3. 最后看 cli-operations 的两个文件全文及保持不变的附加指令。


## 公开 Session Charter

来源：`context.rs::build_session_charter` 与 `resources/charter-rovai-cli.md`。此处是完整公共基础正文；按 Runtime、渠道和 Mission 条件附加的原文在本文末尾完整列出，拼接顺序保持。`[SESSION_CHARTER]` 包裹标签不变。

### 变更前

````text
Rovai-ai Session Charter

- MEMBER_IDENTITY describes you; COLLABORATION_STATE describes your peers and the current Default Lead.
- Handle every work item in the current input, in order. Quotes are reference excerpts; Skill links and attachment paths identify resources. Quotes alone do not request actions.
- The User is the human who owns the Thread objective. --to-user requests their attention.
- The User or current Thread Default Lead defines Task responsibilities; other Agents execute assigned Tasks.
- Follow current user instructions and Core permissions. Prefer current evidence to Memory, history, or cached context.
- Preserve existing user work.
- Use rovai thread read only when needed Thread context is missing. A history boundary is a reference point, not a read or completion marker.
- When you cannot make further progress without another agent's reply, end this run instead of polling Thread history. Resume when you receive the reply.

Rovai Built-in CLI Contract

- Use the local `rovai` CLI for the complete built-in operation catalog: `rovai send`; `rovai member create`; `rovai task create|get|list|update`; `rovai thread list|search|read`; `rovai history search`; `rovai memory view|search|read|write`; and `rovai mission list|get|update|status`.
- Use `rovai --help` to choose an operation and its exact `--help` for syntax. Reuse help already available in the current Native Session.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` always publishes one public Thread message. When the current responsibility has a Thread-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Thread messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Thread messages are visible to the User. Use `--to-user` only for a new decision, answer or action needed from them, or an explicitly requested important-result notification.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
````

### 变更后

````text
Rovai-ai Session Charter

- MEMBER_IDENTITY describes you; COLLABORATION_STATE describes your peers and the current Default Lead.
- Handle every work item in the current input, in order. Quotes are reference excerpts; Skill links and attachment paths identify resources. Quotes alone do not request actions.
- The User is the human who owns the Thread objective. --to-user requests their attention.
- The User or current Thread Default Lead defines Task responsibilities; other Agents execute assigned Tasks.
- Follow current user instructions and Core permissions. Prefer current evidence to Memory, history, or cached context.
- Preserve existing user work.
- Use rovai thread read only when needed Thread context is missing. A history boundary is a reference point, not a read or completion marker.
- When you cannot make further progress without another agent's reply, end this run instead of polling Thread history or execution status. Resume when you receive the reply.

Rovai Built-in CLI Contract

- Use the local `rovai` CLI for the complete built-in operation catalog: `rovai send`; `rovai member create`; `rovai task create|get|list|update`; `rovai thread list|search|read|runs`; `rovai history search`; `rovai memory view|search|read|write`; and `rovai mission list|get|update|status`.
- Use `rovai --help` to choose an operation and its exact `--help` for syntax. Reuse help already available in the current Native Session.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` always publishes one public Thread message. When the current responsibility has a Thread-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Thread messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Thread messages are visible to the User. Use `--to-user` only for a new decision, answer or action needed from them, or an explicitly requested important-result notification.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
````

## CLI 根帮助

来源：`bin/rovai.rs::root_help_text(true)`。展示 Core 托管 Agent 进程中的完整根帮助；用户终端另有的 User Automation 尾段保持，见末尾。

### 变更前

````text
Rovai CLI

Agent operations:
  rovai send
  rovai member create
  rovai task create|get|list|update
  rovai thread list|search|read
  rovai history search
  rovai memory view|search|read|write
  rovai automation list|get|create|run|close|update|delete
  rovai mission list|get|update|status

Run an Agent operation's exact `--help` for its closed inputs. Each Agent operation supports direct flags, JSON stdin/heredoc, or --input-file <path>.
````

### 变更后

````text
Rovai CLI

Agent operations:
  rovai send
  rovai member create
  rovai task create|get|list|update
  rovai thread list|search|read|runs
  rovai history search
  rovai memory view|search|read|write
  rovai automation list|get|create|run|close|update|delete
  rovai mission list|get|update|status

Run an Agent operation's exact `--help` for its closed inputs. Each Agent operation supports direct flags, JSON stdin/heredoc, or --input-file <path>.
````

## thread read 帮助

来源：`team_tool_catalog.rs` 的 `thread.read` description、`bin/rovai.rs` 的输入帮助和示例。目录 title 仍为 `Read public Thread messages`。变更后缩短重复解释，明确 addressing，并把旧说明中的 thread 参数名称改为现行 replyChain；输入能力不增加。

### 变更前

````text
rovai thread read
Read messages from exactly one public Thread. Target-Thread membership is not a read permission. With no message selector, return the newest published messages from the current or explicitly selected Thread; use before as the exclusive sequence cursor. The default limit is 20; an explicit limit must be an integer from 1 to 100. Recallable messages remain readable until withdrawn; a withdrawn message returns a Message withdrawn marker without its original content. Use messageId for one exact message, or thread for a thread page ending before the optional cursor. Reuse nextCursor as before. IDs and cursors never bypass the publication boundary.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.

  --before                     field=before type=integer
  --limit                      field=limit type=integer
  --message-id                 field=messageId type=string
  --reply-chain                field=replyChain type=string
  --thread-id                  field=threadId type=string
      Optional. Omit for the current Thread; pass any extant public Thread ID to target that Thread only.

Examples:
  rovai thread read
  rovai thread read --limit 20
  rovai thread read --before 123
  rovai thread read --message-id '<message-id>'
  rovai thread read --reply-chain '<message-id>' --limit 20
````

### 变更后

````text
rovai thread read
Read published messages from one public Thread using its live state, including an explicit historical Thread. Target membership is not a read permission. With no selector, return the newest page; use before/nextCursor for older messages. Default limit: 20; range: 1-100. Use messageId for one message or replyChain for a reply chain. messageId cannot combine with replyChain, before or limit. Normal items include addressing; withdrawn items contain only a withdrawal marker. IDs and cursors never bypass visibility.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.

  --before                     field=before type=integer
  --limit                      field=limit type=integer
  --message-id                 field=messageId type=string
  --reply-chain                field=replyChain type=string
  --thread-id                  field=threadId type=string
      Optional. Omit for the current Thread; pass any extant public Thread ID to target that Thread only.

Examples:
  rovai thread read
  rovai thread read --limit 20
  rovai thread read --before 123
  rovai thread read --message-id '<message-id>'
  rovai thread read --reply-chain '<message-id>' --limit 20
````

## thread runs 帮助

### 变更前

当前基线没有 `thread.runs` operation、命令帮助或对应 description。

### 变更后

目录 title 为 `Read Thread execution state`。以下为完整帮助；命令名之后、Input 段之前的文字作为目录 description，使用现有帮助拼装机制。字段补充说明仅接入本 operation 的既有 help 路径，不新建帮助框架。

````text
rovai thread runs
Read public executions and queued work in one Thread. Omit threadId for the current Thread; explicit Threads are read live. Private Single Chat executions are excluded, and Single Chat callers cannot use this command. Business calls return JSON only.

Each item identifies an Agent and its status. A non-null agentRunId identifies a real Run. A null ID is allowed only for queued work; those messages may be split across future Runs. Item counts are not Run counts. waitReason is always null: this interface does not provide reasons.

messageCount is the input count, or null when unknown. messagePreview shows the first message as readable now, up to 200 Unicode code points plus an ellipsis if truncated; unavailable previews are null.

Execution and queues can change between pages; pagination does not guarantee a complete traversal of queued work. Start again without cursor when checking current state.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.

  --active                     field=active type=boolean
      Default: false. Include queued, running and waiting items. Cannot combine with status.
      These are logical states; they do not prove process liveness or Agent availability.
  --agent-id                   field=agentId type=string
      Optional. Filter by Agent ID.
  --cursor                     field=cursor type=string
      Continue with nextCursor. Keep the same Thread and filters.
  --limit                      field=limit type=integer
      Default: 20. Range: 1-100. Limits items, not messageCount.
  --status                     field=status type=string
      One of: queued, running, waiting, succeeded, failed, cancelled. Cannot combine with active.
      queued includes items with and without a Run ID. Without either filter, include all states.
  --thread-id                  field=threadId type=string
      Optional. Omit for the current Thread; pass any extant public Thread ID.

Examples:
  rovai thread runs
  rovai thread runs --active
  rovai thread runs --agent-id agent_5 --active
  rovai thread runs --status queued
  rovai thread runs --thread-id '<thread-id>' --active
  rovai thread runs --limit 20
  rovai thread runs --cursor '<nextCursor>'
  rovai thread runs --input-file query.json
````

## cli operations Skill

来源：`skills/cli-operations/SKILL.md`。description 保持逐字不变；只在按需读取的正文中增加一个操作选择行，并更新 reference 的说明。

### 变更前

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
| Public answer, progress, question or one-time collaboration | ThreadMessage |
| Shared objective or whole-Mission status | Mission |
| Default Lead requests independent work from several members | One ThreadMessage with repeated `--to`; replies return separately |
| Responsibility that survives Runs and can be handed off and accepted independently | Task |
| Thread or message evidence | Thread/History |
| Durable collaboration preference, agreement or lesson | Memory governance |

Choose the smallest object that fully serves the request. Tasks own durable responsibilities; project sources and history own their facts.

## Coordinate operations

1. Read the authoritative state needed for the decision.
2. Use one supported input source per call, following that operation's help.
3. Inspect the committed business result before taking the next step.
4. Publish any required Thread-visible answer before ending the Run.

A successful operation proves its own commit, not downstream execution, validation or completion of the user's objective.

## References

- [Send](references/send.md): public messages, Agent routing, parallel invitations and User attention.
- [Task](references/task.md): durable responsibility and Task-linked messages.
- [Mission](references/mission.md): objective, status and public explanation.
- [Thread/History](references/camp-history.md): search scope, exact reads and pagination.
- [Memory](references/memory.md): route durable information to `memory-stewardship`.
- [Recovery](references/recovery.md): follow `error.recovery`, especially uncertain outcomes.
````

### 变更后

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
| Public answer, progress, question or one-time collaboration | ThreadMessage |
| Shared objective or whole-Mission status | Mission |
| Default Lead requests independent work from several members | One ThreadMessage with repeated `--to`; replies return separately |
| Responsibility that survives Runs and can be handed off and accepted independently | Task |
| Thread or message evidence | Thread/History |
| Who is running, queued or waiting | Thread execution query |
| Durable collaboration preference, agreement or lesson | Memory governance |

Choose the smallest object that fully serves the request. Tasks own durable responsibilities; project sources and history own their facts.

## Coordinate operations

1. Read the authoritative state needed for the decision.
2. Use one supported input source per call, following that operation's help.
3. Inspect the committed business result before taking the next step.
4. Publish any required Thread-visible answer before ending the Run.

A successful operation proves its own commit, not downstream execution, validation or completion of the user's objective.

## References

- [Send](references/send.md): public messages, Agent routing, parallel invitations and User attention.
- [Task](references/task.md): durable responsibility and Task-linked messages.
- [Mission](references/mission.md): objective, status and public explanation.
- [Thread/History](references/camp-history.md): message reads, addressing, execution state and pagination.
- [Memory](references/memory.md): route durable information to `memory-stewardship`.
- [Recovery](references/recovery.md): follow `error.recovery`, especially uncertain outcomes.
````

## Thread 读取 reference

来源：`skills/cli-operations/references/camp-history.md`。保留原文件路径。正文区分显式实时读取与历史搜索；新增执行状态的短指引，参数详情继续引导 exact help。

### 变更前

````markdown
# Thread and history

Choose the narrowest scope that answers the question:

| Need | Command |
| --- | --- |
| Find accessible Threads or a Thread ID | `rovai thread list --help` |
| Search the current Thread | `rovai thread search --query "amount"` |
| Search a known historical Thread | `rovai thread search --thread-id <thread-id> --query "amount"` |
| Read an exact message or a timeline/reply chain page | `rovai thread read --help` |
| Find a message whose Thread is unknown | `rovai history search --help` |

## Read forms

Bare `rovai thread read` returns the latest 20 visible messages in the current Thread. `--thread-id` changes only the target Thread.

```bash
rovai thread read --limit 20
rovai thread read --before <nextCursor>
rovai thread read --message-id <message-id>
rovai thread read --reply-chain <message-id> --limit 20
```

Timeline and reply chain pages move from the latest message or anchor toward older messages. Continue with the returned `nextCursor` as `--before`. Exact `--message-id` reads return the full message and cannot combine with `--reply-chain`, `--before` or `--limit`. There are no mode or direction fields.

Search/read resolve one Thread: omitted scope means the current Thread; an explicit historical target must belong to the current Run's frozen access scope and remain accessible. An explicit current Thread ID is equivalent to omission. A message ID alone does not search across Threads.

When the Thread is unknown, use history search to obtain `threadId` and `messageId`, then read that exact pair. When the Thread is known, search there if needed, then read the exact message. Inspect the exact item's `addressing` when recipients or User mentions matter; snippets are discovery aids.

Cross-Thread search requires a real need for wider history. An uncertain mutation outcome follows [Recovery](recovery.md); similar text, author or time cannot prove invocation identity. Send always uses the authenticated current Thread and accepts no caller-supplied Thread ID.
````

### 变更后

````markdown
# Thread and history

Choose the narrowest scope that answers the question:

| Need | Command |
| --- | --- |
| Find accessible Threads or a Thread ID | `rovai thread list --help` |
| Search the current Thread | `rovai thread search --query "amount"` |
| Search a known historical Thread | `rovai thread search --thread-id <thread-id> --query "amount"` |
| Read messages or their addressing | `rovai thread read --help` |
| Check who is running, queued or waiting | `rovai thread runs --help` |
| Find a message whose Thread is unknown | `rovai history search --help` |

## Read messages

Bare `rovai thread read` returns the latest 20 visible messages. `--thread-id` selects one public Thread; reads use its live state, including historical Threads. Target membership is not a read permission. Cross-Thread search and discovery retain their existing frozen search boundary.

```bash
rovai thread read --limit 20
rovai thread read --before <nextCursor>
rovai thread read --message-id <message-id>
rovai thread read --reply-chain <message-id> --limit 20
```

Timeline and reply-chain pages move toward older messages. Pass nextCursor as --before. Exact messageId cannot combine with replyChain, before or limit; there are no mode or direction input fields.

Normal items include addressing: saved effectiveAgentRecipients and mentionsCurrentUser. Withdrawn markers have no addressing. Use these fields when recipients or User mentions matter.

When the Thread is unknown, use history search to obtain threadId and messageId, then read that pair. Once the Thread is known, search there if needed. A message ID alone does not search across Threads.

## Read execution state

```bash
rovai thread runs --active
rovai thread runs --agent-id <agent-id> --active
```

Read items by agentId, status and messagePreview. A non-null agentRunId identifies a real Run; a null ID means queued messages not yet assigned to a Run. Queued messages may be split across future Runs. waiting remains distinct from queued.

waitReason:null means this interface does not provide reasons. A preview is the first message readable now, not a work summary. Use the exact help for filters, fields and pagination. Query for a needed status answer; do not poll while waiting for another Agent's reply.

## Scope and recovery

Cross-Thread search requires a real need for wider history. An uncertain mutation outcome follows [Recovery](recovery.md); similar text, author or time cannot prove invocation identity. Send always uses the authenticated current Thread and accepts no caller-supplied Thread ID.
````

## 保持不变的上下文与条件附加文本

`ROVAI_PLATFORM_SKILLS` 的 Skill 集合、description、路径和结构保持逐字不变；`ROVAI_ADDITIONAL_SKILLS`、MEMBER_IDENTITY、COLLABORATION_STATE、Memory Entrypoint、RUN_INPUT 和 RUN_FACTS 也不增加执行查询字段或说明。`agents/openai.yaml` 不变。

下面是公共 Charter 的三个原有附加片段。它们按渠道片段、Codex 片段、Mission 片段的现有顺序按条件拼接，内容不改。它们不是本次新增上下文。

### 渠道文件交付

````text
- This Thread is connected to an external channel. Local file paths and Runtime image previews are not delivered there; when the recipient needs the file itself, include `--file <path>` in the corresponding `rovai send` message.
````

### Codex 最终答复

````text
- When publishing the Thread-visible final answer with `rovai send`, use the complete final response in polished Markdown; do not send a compressed one-line summary and then write a richer Runtime final.
````

### Mission 附加契约

````text
Rovai Mission Contract

- All current members may use `rovai mission get|update|status` to maintain this Thread's Mission.
- Use `rovai mission get` when the current Mission's full definition is missing or outdated; judge completion against that definition.
- The Mission working directory is already prepared. Continue follow-up work there on its current checkout by default. Do not create or switch branches, or create another Worktree, merely because a new Run starts, context is compacted, or more changes are requested. Follow explicit user requests for a different branch or baseline.
- Change status only when the whole Mission's state changes, not merely when your Run ends.
````

### 用户终端根帮助尾段

````text
User Automation:
  rovai app --help

Agent operations keep their process-private transport. `rovai app` uses the running Desktop App's separate User Automation transport.
````

Single Chat 专用 Charter 和 Guidance 保持原文，也不显示 thread runs 的新权限。新命令在 Single Chat 中由现有 policy 拒绝；没有新的权限配置。以上附加文本和不变 section 不需要在实现中重写。

## 文本规模核对

按 UTF-8 字节和空白分词统计，仅用于检查提示词增量；不是模型 tokenizer 计数或效果证明。

| 文本 | 原字节 | 新字节 | 原词数 | 新词数 |
| --- | --- | --- | --- | --- |
| 公共基础 Charter | 2502 | 2527 | 369 | 372 |
| CLI 根帮助 | 443 | 448 | 48 | 48 |
| read description | 650 | 516 | 100 | 76 |
| cli-operations 全文 | 2115 | 2195 | 286 | 299 |
| Thread reference | 2018 | 2575 | 312 | 396 |
| 新 runs description | 0 | 908 | 0 | 144 |
| 新 runs 完整帮助 | 0 | 2310 | 0 | 304 |

常驻基础 Charter 仅新增 `|runs` 和 ` or execution status`，合计 25 个 ASCII 字节；平台 description 增量为 0。完整合同、错误表和实现细节只在设计文档中，不进入常驻上下文。

## 原文来源校验

| 基线文件 | SHA-256 |
| --- | --- |
| `crates/rovai-core/src/context.rs` | `542b6831dc6005d7b70bf631217ecd30656012b8f5fe694cc7c0d81fa964c6a7` |
| `crates/rovai-core/resources/charter-rovai-cli.md` | `b29fbc8801e215463e7852da5697401f9b6cdc26a343fd16b3f5648bcb035c7e` |
| `crates/rovai-core/src/bin/rovai.rs` | `796dac30b26558d4fffacd18b7b3e57db1b2b0a1e91d13ae05f21480df1c490f` |
| `crates/rovai-core/src/team_tool_catalog.rs` | `1fecdefffb5254c09cb1479b2aa0461e473960a71a1f65951bb788cc6ec07322` |
| `skills/cli-operations/SKILL.md` | `6e39ce09dc73c0ea89f1f7c9da398a9a4e920c37b99ea2d555df4c7ce0daadbc` |
| `skills/cli-operations/references/camp-history.md` | `d2747aeca5dc0423d666afc5501e53f907dfe939e1401d69feb0cdf06d96ab9c` |
