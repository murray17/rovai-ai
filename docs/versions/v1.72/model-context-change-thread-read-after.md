---
document_type: model-context-change
version: v1.72
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: local_user
confirmed_at: 2026-10-22
confirmation_message_id: db6478ff-b52c-40ad-a8e7-c32985463e2e
last_updated: 2026-10-22
---

# Thread read 正向增量读取与提示词 r1

本稿整理 User 已审阅的接口方案与三处提示词清单。接口方案由 Thread 消息
`a0d9da2e-2099-4b96-bea8-a08a549f01d3` 交付，提示词清单由
`d8dac489-a71a-4431-91aa-7d7e6b780fd6` 交付；User 在
`db6478ff-b52c-40ad-a8e7-c32985463e2e` 明确授权“可以，改完后pr”，随后在
`4b6dfff3-3347-4e57-a096-0c6bc7ac79f4` 要求合并 main。
此记录来自用户确认，不代表实现、测试或评测已完成。

## 二次确认

User 在上述完整接口方案与提示词清单后确认 r1 实施与 PR，并随后明确要求合入 main。
确认消息 ID 与日期见 Front Matter；本稿只整理该已确认范围，不扩大模型输入或实现语义。

## 基线与范围

- 当前版本：[版本索引](../README.md)的 v1.72，不切换产品版本。
- 源码基线：`1dde043f6cb3b074682141d328a52e3d3c7e4ad8`。
- 分支：`rovai/thread-read-after`；worktree：`../rovai-ai-thread-read-after`。
- Governance：本次接口与提示词已在 Thread 确认；无治理 PR 必须先合入主线的要求。
- 工作状态：ready，等待合并门槛。只增加 `thread read --after N`，同步三处按需帮助。

## 变更前

`thread read` 仅提供最新页、排他 before 向旧页翻阅、单条详情和回复链。
默认 20、显式 1–100，页内升序；没有 after/since/all 输入。
内部已有 After 查询分支，入口始终传 Before。当前 reference 还有旧 addressing 字段及冻结目录教学。

## 变更后

- `after` 是同一 Thread 的非负整数消息序列号，严格 `sequence > N`；0 从最早可见消息起读。
- 每页取 N 后最早的 limit 条，返回升序；limit 默认 20、范围 1–100。
- before 保持正整数与排他上界，与 after 互斥。messageId 不接受任一 cursor、replyChain 或 limit。
- replyChain 只选择回复链，after 仍按 Thread 的 sequence 比较，允许 cursor 早于锚点。
- N 不必对应现存消息；序列空洞、N 等于或超过当前边界时正常返回可见结果或空页。
- after 页 `direction=after`，hasMore 按本次读视图判断；有后续页时 nextCursor 为本页末项 sequence，无后续页为 null。
- 调用方处理成功后记录本范围最后 sequence，空页保留原值。Thread/回复链范围分别记录；historyHint 不作为已处理凭据。
- 每次调用重取当前边界；新消息可进入后续调用，hasMore=false 不承诺未来无消息。旧消息的修改或撤回不作为新序列重发。
- 不新增 since、all、direction、通用 cursor 或服务端已读状态。

### 完整输入 Schema 前后对照

以下是 catalog 的完整输入构造。互斥通过封闭 oneOf 分支表达，兼容现有 validator，不扩展全局 Schema 引擎。

**变更前**

```rust
pub fn camp_read_input_schema() -> Value {
        json!({
            "type": "object",
            "oneOf": [
                {
                    "additionalProperties": false,
                    "required": ["messageId"],
                    "properties": {
                        "threadId": {"type": "string", "pattern": CAMP_ID_PATTERN},
                        "messageId": {"type": "string", "minLength": 1}
                    }
                },
                {
                    "additionalProperties": false,
                    "required": ["replyChain"],
                    "properties": {
                        "threadId": {"type": "string", "pattern": CAMP_ID_PATTERN},
                        "replyChain": {"type": "string", "minLength": 1},
                        "before": {"type": "integer", "minimum": 1},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT}
                    }
                },
                {
                    "additionalProperties": false,
                    "properties": {
                        "threadId": {"type": "string", "pattern": CAMP_ID_PATTERN},
                        "before": {"type": "integer", "minimum": 1},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT}
                    }
                }
            ]
        })
    }
```

**变更后**

```rust
pub fn camp_read_input_schema() -> Value {
        json!({
            "type": "object",
            "oneOf": [
                {
                    "additionalProperties": false,
                    "required": ["messageId"],
                    "properties": {
                        "threadId": {"type": "string", "pattern": CAMP_ID_PATTERN},
                        "messageId": {"type": "string", "minLength": 1}
                    }
                },
                {
                    "additionalProperties": false,
                    "required": ["replyChain"],
                    "properties": {
                        "threadId": {"type": "string", "pattern": CAMP_ID_PATTERN},
                        "replyChain": {"type": "string", "minLength": 1},
                        "before": {"type": "integer", "minimum": 1},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT}
                    }
                },
                {
                    "additionalProperties": false,
                    "required": ["replyChain", "after"],
                    "properties": {
                        "threadId": {"type": "string", "pattern": CAMP_ID_PATTERN},
                        "replyChain": {"type": "string", "minLength": 1},
                        "after": {"type": "integer", "minimum": 0},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT}
                    }
                },
                {
                    "additionalProperties": false,
                    "properties": {
                        "threadId": {"type": "string", "pattern": CAMP_ID_PATTERN},
                        "before": {"type": "integer", "minimum": 1},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT}
                    }
                },
                {
                    "additionalProperties": false,
                    "required": ["after"],
                    "properties": {
                        "threadId": {"type": "string", "pattern": CAMP_ID_PATTERN},
                        "after": {"type": "integer", "minimum": 0},
                        "limit": {"type": "integer", "minimum": 1, "maximum": MAX_PAGE_LIMIT}
                    }
                }
            ]
        })
    }
```

### 提示词清单与完整替换文本

| 位置 | 改动 |
| --- | --- |
| tool description / CLI help summary | 增加 after 的边界、顺序、互斥及同方向续页；其余公开可见性与 mentions 说明保留 |
| CLI examples | 以 after 123 替换重复的 limit 20，示例数量不变；Schema 自动提供 after flag |
| cli-operations history reference | 双向分页与处理位置；同页修正 mentions/实时目录的旧教学 |

#### Tool description

**变更前**

```text
Read published messages from one public Thread using its live state, including an explicit historical Thread. Target membership is not a read permission. With no selector, return the newest page; use before/nextCursor for older messages. Default limit: 20; range: 1-100. Use messageId for one message or replyChain for a reply chain. messageId cannot combine with replyChain, before or limit. Normal items include mentions: Agent entries {id,name} are persisted effective targets; {id:"user"} marks a structured current User mention. Mentions do not indicate reading or execution; withdrawn items contain only a withdrawal marker. IDs and cursors never bypass visibility.
```

**变更后**

```text
Read published messages from one public Thread using its live state, including an explicit historical Thread. Target membership is not a read permission. Default: newest 20 messages; limit 1-100. before N reads sequence < N; after N reads sequence > N, oldest first. Both return ascending order. before and after are mutually exclusive. after 0 starts at the oldest visible message. While hasMore, pass nextCursor with the same flag. Use messageId for one message or replyChain for a reply chain. messageId cannot combine with replyChain, before, after or limit. Normal items include mentions: Agent entries {id,name} are persisted effective targets; {id:"user"} marks a structured current User mention. Mentions do not indicate reading or execution; withdrawn items contain only a withdrawal marker. IDs and cursors never bypass visibility.
```

#### CLI examples

**变更前**

```sh
rovai thread read --limit 20
rovai thread read --before 123
rovai thread read --message-id '<message-id>'
rovai thread read --reply-chain '<message-id>' --limit 20
```

**变更后**

```sh
rovai thread read --after 123
rovai thread read --before 123
rovai thread read --message-id '<message-id>'
rovai thread read --reply-chain '<message-id>' --limit 20
```

#### History reference 完整正文

**变更前**

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

**变更后**

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

Bare `rovai thread read` returns the latest 20 visible messages. `--thread-id` selects one public Thread; reads use its live state, including historical Threads. Target membership is not a read permission. New Runs list Threads live; cross-Thread message searches retain the Run's frozen boundary.

```bash
rovai thread read --after <lastProcessedSequence>
rovai thread read --before <nextCursor>
rovai thread read --message-id <message-id>
rovai thread read --reply-chain <message-id> --limit 20
```

For timeline or reply-chain pages, use `--before` for older messages or `--after` for newer messages, excluding the given sequence. Use only one flag; while hasMore, pass nextCursor with that same flag. Exact messageId cannot combine with replyChain, before, after or limit; there are no mode or direction input fields.

For later incremental reads, reuse the last successfully processed sequence for the same Thread and scope; keep it on empty pages. hasMore=false describes this read only.

Normal items include mentions: Agent {id,name} entries are saved effective recipients; {id:"user"} marks a structured current User mention. Withdrawn markers have no mentions. Mentions do not prove reading or execution.

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

## 明确不变

SESSION_CHARTER、MEMBER_IDENTITY、COLLABORATION_STATE、RUN_INPUT、RUN_FACTS、Skill 首页和发现 description
均不增加文本；Bootstrap/Formatter/Manifest/Profile 版本保持。读取不 claim Delivery、不关闭撤回、
不推进 accepted watermark、不创建消息或执行，不引入后台轮询。现有公开 Thread、私有 Single Chat policy、
撤回 marker、tombstone、quotes 和附件投影保持。输入 cursor 不能越权。
返回封闭 Schema 及普通/撤回 item shape 保持，现有 direction enum 已支持 after。

## 合同、迁移与恢复

[History v15](../../contracts/camp-history-v15.md)、[Transport v44](../../contracts/builtin-tool-transport-v44.md)
拥有当前输入规则。History 14→15；Transport/CLI 43→44、capability builtin_cli.transport.v44；
IPC 3、Envelope 2、Agent Output 14 不变。配套 CLI/Core 仍执行版本准入。
无数据库迁移、历史回填、旧 receipt 改写、Session clean break 或 Native Binding 恢复规则变化。
局部可逆参数扩展不满足新增 Version Decision 的三项准入条件。

## 验证计划与 Rust owner

扩展既有 owner，不新增、删除或停用 Rust 测试：

- `team_tool_catalog::tests::camp_search_and_read_accept_an_omitted_or_explicit_single_camp_target`：after 0/正数、链、负数/非整数/类型及互斥。旧实现拒绝合法 after。
- CLI 既有 help/parser owner：实际参数发现、解析和兼容禁用参数，示例数量保持。
- `camp_history::slow_tests::camp_read_returns_the_selected_page_and_item_body_without_size_clipping`：同一内存 SQLite fixture 双向跨页、可见集合一致、tombstone 空洞、撤回 marker。
- `context::slow_tests::current_history_reads_live_state_without_id_guessing`：通过真实 read 入口验证默认方向、after 0、末页/空页、后续新增、回复链以及领域层互斥；复用原 Core fixture，因为只测 SQL 不能证明入口与实时边界。
- 默认 `pnpm test:rust:pr`、上述 slow owners、`cargo fmt --all --check`、生产 workspace check；文档与 Skill 通用门禁。

模型可见教学涉及 cli-operations，按[评测规则](../../development/evaluation.md#上下文改动-gate)
采用十二个通用 Case，基线/候选相同 Runtime、模型、预算和 Judge。关键判断为跨页补齐、
末页保留位置与按需读取；最多两次 campaign，保留失败与不足证据。
实际冻结配置须使用可验证的 Runtime/Judge 身份和预算；未执行或无充分 Judge 证据不记为通过。

## 跨版本文档影响

| 范围 | 结论 | 依据 |
| --- | --- | --- |
| Version lifecycle | 确认无需更新 | 保持 v1.72 current；概览/实施记录增加本次范围 |
| Decisions | 确认无需更新 | 局部可逆扩展，无新决定；CURRENT 路由更新 |
| Contracts | 已更新 | History v15、Transport v44 |
| Architecture | 已更新 | Built-in Runtime 路由及 History/运输不变量 |
| UI | 确认无需更新 | 无 Renderer 变更 |
| Runtime Activity | 确认无需更新 | operation identity、活动类型保持 |
| Runtime compatibility | 确认无需更新 | 无新 Runtime 或 Native Binding 资格 |
| Documentation routing | 已更新 | 合同、Architecture、CURRENT 与 docs 导航 |
| Root README | 确认无需更新 | 无定位或安装入口变化 |

## 实施与验证记录

2026-10-22：实现与确定性验证完成。以下结果均来自本 worktree 的实际执行：

| 验证 | 结果 |
| --- | --- |
| `pnpm test:rust:pr` | 474 passed，1 个既有 ignored；0 failed |
| `cargo test -p rovai-core --features slow-tests --lib camp_history::` | 7 passed；双向完整集合、跨页、空洞及撤回占位 |
| `cargo test -p rovai-core --features slow-tests --lib current_history_reads_live_state_without_id_guessing` | 1 passed；真实入口、末页后新增和回复链正向续读 |
| `cargo check --workspace` / `cargo fmt --all --check` | 通过 |
| `pnpm typecheck` | 通过 |
| `pnpm test` | 最终通过：252 个 Vitest 文件，2864 passed / 2 skipped；Node 主集 357 passed / 2 skipped；文档/Skill 子集通过 |
| `pnpm docs:test` / `pnpm docs:check` / 基于原始 SHA 的 `pnpm docs:check:ci` | 通过 |
| `pnpm skills:check` / `git diff --check` | 通过 |
| 实际构建 `rovai` CLI | help 展示 after 与顺序；负数、双 cursor、messageId+after、since 四个无 IPC 负向调用均返回 invalid_input |

首次全量 Node 测试发现 Product Contract Fingerprint 的既有断言仍写 Transport 43；
已更新为 44 并完整复跑 pnpm test，通过。没有掩盖该失败或扩大产品改动。

真实任务 Gate 尚未执行：检查到的现有通用 Gate 配置均为 judge=null，当前环境没有已配置的
可验证固定模型版本 Judge。按评测合同，这只能产生证据不足，不能替代通过。
在取得可用配置并通过完整 Gate，或 User 明确豁免本次该项之前，不把它记为通过或完成合并。
