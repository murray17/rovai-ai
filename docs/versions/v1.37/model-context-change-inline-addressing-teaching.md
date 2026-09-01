---
document_type: model-context-change
version: v1.37
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray.xue
confirmed_at: 2026-09-01
last_updated: 2026-09-01
---

# Agent 寻址帮助去机制化

本变更只收敛 Agent 可见教学：canonical `--to` 继续作为唯一推荐的 Agent 收件人 authoring 入口，
Core-only inline addressing 继续保留为兼容与运维兜底，但不再由 Bootstrap、Send/Gather schema 或 CLI help
主动教学。解析、投递、宽松 invalid-tail、PublicOnly 旁路及 Principal Attention 行为全部不变。

## 变更前

### Native Session Bootstrap：Rovai Built-in CLI Contract

新 Native Session Bootstrap 中完整的 `Rovai Built-in CLI Contract` section 为：

```text
Rovai Built-in CLI Contract

- Use the local `rovai` CLI for the complete built-in operation catalog: `rovai send`; `rovai gather`; `rovai member create`; `rovai task create|get|list|update`; `rovai camp list|search|read`; `rovai history search`; and `rovai memory view|search|read|write`.
- Use `rovai --help` when the operation is unclear, and consult the selected operation's exact `--help` when the required syntax is unclear. Reuse help already available in the current Native Session when possible. Do not assume that a command family has its own help entry.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` always publishes one public Camp message. When the current responsibility has a Camp-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Camp messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` and recognized inline Agent addressing may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Camp messages are already visible to the Principal. Use `--to-principal` when this message creates a new need for the Principal to decide, answer, or act, or when an important-result notification is explicitly requested.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
```

### `camp.message.send` operation summary

完整文本为：

```text
Publish one public Camp message. Use --public-only when the message must not address any Agent; it bypasses all inline Agent addressing, leaves Agent-like @text literal, and creates no Agent Delivery. Without --public-only, --to and the existing restricted inline Agent addressing may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.
```

### `send.publicOnly` schema description

完整文本为：

```text
Guarantee that this public Camp message addresses no Agent. When true, explicit Agent recipients and taskId are invalid, restricted inline Agent addressing is not parsed, Agent-like @text remains ordinary text, effectiveRecipients and deliveryIds are empty, and no Agent is woken. This may be combined with mentionUser because Principal attention is not Agent routing.
```

### `rovai send --public-only` CLI help

完整文本为：

```text
Guarantee that this public message wakes no Agent.

Restricted inline Agent addressing is disabled, Agent-like @text remains ordinary text, effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.

Do not combine this option with --to or --task-id. It may be combined with --to-principal.
```

### `team.gather` input schema descriptions

`body` 的完整 description 为：

```text
One shared public topic for every Gather recipient. Canonical inline addressing follows camp.message.send rules.
```

`to` 的完整 description 为：

```text
Canonical Agent IDs to gather from. Explicit and valid inline recipients are merged, deduplicated and frozen in canonical byte order.
```

### `rovai gather --to` CLI help

完整文本为：

```text
Canonical member target; repeat as needed. Duplicate targets are frozen once.
```

## 变更后

### Native Session Bootstrap：Rovai Built-in CLI Contract

只替换 Agent addressing bullet；替换后的完整 section 为：

```text
Rovai Built-in CLI Contract

- Use the local `rovai` CLI for the complete built-in operation catalog: `rovai send`; `rovai gather`; `rovai member create`; `rovai task create|get|list|update`; `rovai camp list|search|read`; `rovai history search`; and `rovai memory view|search|read|write`.
- Use `rovai --help` when the operation is unclear, and consult the selected operation's exact `--help` when the required syntax is unclear. Reuse help already available in the current Native Session when possible. Do not assume that a command family has its own help entry.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` always publishes one public Camp message. When the current responsibility has a Camp-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Camp messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Camp messages are already visible to the Principal. Use `--to-principal` when this message creates a new need for the Principal to decide, answer, or act, or when an important-result notification is explicitly requested.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
```

### `camp.message.send` operation summary

完整替换为：

```text
Publish one public Camp message. Use --public-only when the message must not address any Agent; it prevents Agent addressing, creates no Agent Delivery, and wakes no Agent. Without --public-only, --to may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the Principal. Use --to-principal only for a new unresolved Principal decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.
```

### `send.publicOnly` schema description

完整替换为：

```text
Guarantee that this public Camp message addresses no Agent. When true, explicit Agent recipients and taskId are invalid, effectiveRecipients and deliveryIds are empty, and no Agent is woken. This may be combined with mentionUser because Principal attention is not Agent routing.
```

### `rovai send --public-only` CLI help

完整替换为：

```text
Guarantee that this public message wakes no Agent.

effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.

Do not combine this option with --to or --task-id. It may be combined with --to-principal.
```

### `team.gather` input schema descriptions

`body` 的完整 description 替换为：

```text
One shared public topic for every Gather recipient.
```

`to` 的完整 description 替换为：

```text
Canonical Agent IDs to gather from. Effective recipients are frozen in canonical byte order.
```

这里使用既有公开结果字段 `effectiveRecipients` 的概念，不引入含义不清的 `accepted recipient set`，也不公开
explicit/inline 合并机制。

### `rovai gather --to` CLI help

完整替换为：

```text
Canonical member target; repeat for each additional distinct member.
```

该正向表达同时说明 `--to` 可重复用于多个不同成员，并与 input schema 的 `uniqueItems: true` 保持一致。

## 明确不变

- `camp.message.send` 与 Gather 的 inline canonical/display-name compatibility parser、识别位置、cluster、
  invalid-tail 宽松 Text、malformed canonical token 拒绝和 code/URL/escape exclusions 不变。
- `@惠 @响子` 仍可由 Core-only fallback 解析为两位收件人；`@惠 @Principal` 仍只路由惠并把后半正文
  保持 Text，不因本次教学收敛而拒绝。
- `--to`、`--public-only`、`--to-principal`、`taskId`、Gather、caller return、Delivery、A2A budget、fanout、
  membership、自身/祖先、防环、幂等、receipt、replay 与 dispatch 行为不变。
- `publicOnly` 仍在任何 roster/alias lookup 与正文解析前旁路；与显式 `to`/`taskId` 的冲突仍原子拒绝，
  完整正文保持 Text，零 Effective Recipient、零 Delivery、零 Agent wake。
- Gather explicit input 仍使用 `uniqueItems: true`；CLI/schema 调用中的重复同一 Agent ID 仍在发送前校验失败，
  Core 在有效 explicit 与兼容 inline occurrence 汇合后仍按 canonical byte order 排序、去重并冻结。
- `camp.message.send.body`、`to`、`mentionUser`、`taskId`、`files` schema description，`--to`、
  `--to-principal`、`--file`、body newline help 与三条 CLI 示例逐字不变。
- Principal Attention、Structured Current User Mention、Agent/Human audience projection、CampMessage Structured
  Content、Renderer、数据库、Migration、input/output JSON shape、error code 与持久对象均不变。
- Authority boundaries、MEMBER_IDENTITY、Memory Entrypoint、Dynamic Context sections、History/Task/Gather 选择与
  预算、ContextManifest shape、Delivery Profile 和 Runtime Input shape 不变。

## 版本、迁移与恢复

Session Charter revision 从 4 升至 5，并继续进入既有 Adapter Binding compatibility digest。升级后的下一次
执行不能复用 revision 4 的 Native Binding，将通过既有兼容路径创建新 Binding 并投递 revision 5 Charter；
不新增显式重启机制或数据库迁移。新的 Bootstrap Evidence 冻结实际 revision 5 文本和摘要，历史 Binding、
Bootstrap Evidence、ContextManifest 与 Runtime 输入保留原始 bytes/digest，不原地改写。

Send operation summary、`publicOnly` schema description 与 Gather input descriptions 会改变
`builtin_tool_catalog_digest`；下一次正常执行同样复用既有 Adapter Binding compatibility 路径替换旧 catalog
Binding。CLI-only help 不单独进入 catalog digest。

已接受的 Camp Message Send v18 与 Gather v4 不原地改写。确认后分别建立 Camp Message Send v19 与 Gather v5
作为新的 current teaching contract，旧合同转为 historical route。Native Session Bootstrap contract v3、
Bootstrap Formatter 3、AgentRun Formatter 22、ContextManifest 22、Context Delivery Profile 4、Built-in Tool
Transport v21、CLI/capability version、IPC、Envelope、receipt 与 Agent Output version 均保持不变。

没有数据库迁移、历史回填、双写、wire clean break 或 parser migration。升级前已接受的同一 request identity
继续按原 receipt 幂等重放；只有新 request identity 使用既有当前 parser 产生新的发送效果。

## 二次确认

开发者在阅读 revision 1 的完整前后文本、不变边界、版本与恢复策略后，于 2026-09-01 对本 revision 的
确认请求明确回复“确认，改完pr到main merge”。该回复直接承接唯一待确认的 revision 1，并同时授权完成
实现、PR 与 main 合并。

本确认只授权实施本文定义的 Agent-visible teaching 收敛、Session Charter revision 5、catalog digest 自然轮换
及对应文档/测试；不授权修改 inline parser、发送效果、严格度、投递、Principal Attention 或历史数据。

## 验证

- 扩展既有 `context::slow_tests::session_charter_publishes_one_cli_only_builtin_contract`，逐字断言完整 revision 5
  Charter，并负向断言 Built-in CLI section 不再教学 inline addressing；其他 Charter section 逐字不变。
- 更新 `context_contract::tests::binding_contract_freezes_each_context_axis_version`，验证 revision 5 写入
  compatibility digest，revision 4 与无 revision Binding 均不兼容。
- 更新 `camp_message_send_teaching` 与 `rovai` CLI 既有 owner，逐字断言新的 summary/schema/help，并负向断言
  Send Agent-visible teaching 不再暴露 inline grammar；Principal、文件、body、`--to` 与示例断言保留。
- 扩展 Gather 既有 schema/CLI help owner，逐字断言新的 `body`、`to` 和 `--to` 文本，并验证同一 Agent ID
  重复输入仍由 `uniqueItems: true` 在发送前拒绝、不同成员仍可重复使用 `--to`。
- 原样运行既有 inline parser、SQLite multi-recipient、literal invalid-tail 与 PublicOnly owner，证明本次无行为
  变化；不新增平行 parser fixture，也不放宽任何拒绝或路由断言。
- 定向测试后运行 `cargo fmt --all --check`、`cargo clippy --workspace --all-targets --features slow-tests -- -D warnings`、
  `pnpm test:rust:pr`、`pnpm test`、`pnpm typecheck`、`pnpm build:desktop`、`pnpm docs:test`、`pnpm docs:check`、
  固定 PR base 的 `pnpm docs:check:ci` 与 `git diff --check`。
- 不调用真实 Runtime 或模型，不发送 Camp/渠道消息。完成 main 合并后再从精确 merge commit 打包，并使用独立
  userData/Skill Library 验收；日常 App 采用 non-terminating daily install，当前运行进程不被终止。

## 实际实施

revision 1 已确认，尚未开始实现。治理文档先通过独立 PR 合入 main；编码从该 governance merge commit 建立
新 worktree 后开始。本节在实现完成时追加实际版本、迁移结论与验证结果，不改写已确认的前后合同。
