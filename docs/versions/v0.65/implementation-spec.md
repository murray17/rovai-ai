---
document_type: implementation-specification
version: v0.65
authority: version-implementation-specification
status: accepted
implementation_status: closed_incomplete
last_updated: 2026-08-13
---

# v0.65 统一实现规格

> 本规格在当前用户注意力与渐进式 CLI 教学尚未进入业务实施时随 v0.65 冻结；目录附件是由
> ADR-0169 与 Camp Attachment v1 独立拥有的已实施增量，不属于本规格。下文的 Migration 77、
> Data Contract `v0.65 / 32` 与 CampSnapshot 30 都是当时拟议目标，未发布也未保留编号；当前实际
> Migration 77 与 Data Contract `v0.66 / 32` 由 v0.66 权威链拥有。

本文把已确认的产品决定映射为可直接实施的模块、状态和验收边界。长期理由由
[ADR-0165](../../adr/0165-core-owned-current-user-message-attention.md)、
[ADR-0166](../../adr/0166-progressive-built-in-cli-teaching.md)与
[ADR-0167](../../adr/0167-seven-skill-official-inventory.md)分别拥有，完整 wire shape 由
[Camp Message Send v4](../../contracts/camp-message-send-v4.md)、
[Current User Attention v1](../../contracts/current-user-attention-v1.md)、
[Built-in Tool Transport v7](../../contracts/builtin-tool-transport-v7.md)与
[ContextManifest Evidence v12](../../contracts/context-manifest-evidence-v12.md)拥有；本文不建立平行协议。

## 1. 一个版本、两阶段、一个完成门槛

```text
Phase 1: --to-user domain contract
    ↓ all Phase 1 implementation and tests pass
Phase 2: progressive CLI teaching
    ↓ all Phase 2 implementation and tests pass
v0.65 release gate: migration + full gates + nine Runtime real smoke
```

Phase 1 先建立 Core 真源、事务、Transport 和 Renderer，使后续教学引用真实 operation；Phase 2 再
收敛 Charter 与 Skills。Phase 1 完成只能成为内部检查点，不能把版本概览或计划标记为 complete，
也不能另建产品版本号。

## 2. 领域轴与权威流

```text
submittedBody
  ├─ strict inline @agent_<id> parsing ─► Member Mention segments
  └─ mentionUser=true ──────────────────► Current User Mention(local_user)
                         │
                         ▼
         Structured Camp Message Content (sole content authority)
                         │
                         ├─► projectedBody: UI/read/search/context/copy/summary/a11y
                         ├─► Agent recipients ─► Message Delivery / AgentRun / A2A budget
                         └─► mentions current user ─► durable User Mention Notification
```

`submittedBody` 是 command input 与调用证据，不是持久消息的第二正文。Agent routing 与 User
attention 是同一消息上的两个独立维度；Current User Mention 不进入 recipient set，不创建 Delivery，
也不消耗 A2A slot。

## 3. Phase 1 详细实现

### 3.1 Current User Resolver

新增 Core-internal deep module `CurrentUserResolver`（具体 Rust 文件可以与 identity module 合并），
只公开以下语义：

```rust
const CURRENT_USER_ID: &str = "local_user";

struct ResolvedCurrentUser {
    user_id: &'static str,       // always local_user
    display_name: String,        // presentation only
}
```

- 领域身份永远是 `local_user`；display name 只用于当前投影，不参与 content digest、notification
  uniqueness、replay 或 authorization；
- 若本版本实现时仍没有本地用户资料表，Core 使用本地化 presentation fallback：zh-CN `你`、英文
  `You`。不得从触发消息作者、A2A caller、Renderer 文案或 Agent input 推断身份；
- accepted message 的 segment 和 notification recipient 固定保存 `local_user`；改名只改变随后读取
  的显示投影，不改写历史 segment 或 notification source；
- clean break 把旧内部 literal `local-user` 统一重建为 `local_user`。旧值不作为 alias 被 Agent、CLI、
  Renderer 或持久 reader 接受。

### 3.2 Structured Content 生成与投影

Agent input：

```json
{
  "body": "请确认采用方案 A 还是方案 B。",
  "to": ["agent_5"],
  "mentionUser": true,
  "taskId": null
}
```

生成顺序：

1. 验证 `submittedBody` 非空、trim 后非空且 UTF-8 bytes 不超过 32 KiB；
2. 仅在 `submittedBody` 的可解析文本区域识别 strict inline Agent Addressing Tokens；
3. 把这些 token 原位置转为 `member_mention(agentId)`，其余内容保持 Text；
4. `mentionUser=true` 时把 `current_user_mention(local_user)` 作为第一个 segment；
5. normalization 只删除空 Text、合并相邻 Text，不合并或删除 Mention occurrence；
6. 从最终 Structured Content 计算 canonical content digest 和全部消费者投影。

因此带 inline Agent token 的真实规范内容不是把整个 body 降级成一个 Text，而是：

```json
[
  {"kind":"current_user_mention","userId":"local_user"},
  {"kind":"text","text":"请 "},
  {"kind":"member_mention","agentId":"agent_5"},
  {"kind":"text","text":" 复核方案。"}
]
```

Current User Mention 的文本投影是 `@{displayName}`。当它作为 Core 生成的首段且后面还有正文时，
projection 在 token 与下一段之间插入一个 U+0020；该分隔是确定性 projection rule，不修改
`submittedBody`，也不产生可独立编辑的正文列。其他 segment 继续逐段连接。例：

```text
@你 请确认采用方案 A 还是方案 B。
```

必须统一覆盖：

| 消费者 | v0.65 projection |
| --- | --- |
| Camp timeline / exact read / search | 当前显示名称的 `projectedBody` |
| search index | `projectedBody`；另有可过滤/诊断的 `mentionsCurrentUser` boolean |
| Context Current Input / Shared Conversation | `projectedBody` + `mentionsCurrentUser` metadata |
| plain-text Clipboard | 可见 `@displayName` |
| private structured Clipboard | 保留 `current_user_mention` segment；用户 Composer paste 时降级 Text |
| Notification summary | 从同一 projection 产生的有界摘要，不是持久第二正文 |
| accessibility | Mention 自身 `提及当前用户：{displayName}`；消息全文按 projected text 阅读 |

`canonical_content_digest` 包含 `kind=current_user_mention` 与 `userId=local_user`；显示名称和投影空格
不进入 semantic digest。手写 `@你`、任意用户显示名、`@local_user`、`@local-user` 只形成 Text。

现有 `camp_message.body` 在 v0.65 保留为 Core-owned、可重建的 `projectedBody` cache，以继续服务
legacy Read Side、FTS trigger 与迁移；它不是可独立写入的正文。消息接受事务同时从 Structured Content
写入该 cache。当前用户显示名或 fallback locale 变化时，Core 在同一事务内重投影所有仍保留且包含
Current User Mention 的消息并通过现有 body-update path 刷新 FTS，之后才发布资料/locale change event；
任一步失败全部回滚。普通 read/search result 仍从 Structured Content 形成当前正文并可校验 cache，
已冻结的 Context Formatter bytes 不参与重投影。

### 3.3 Message Send 接受事务

Core 在一次 Immediate SQLite transaction 中按以下顺序处理：

1. 从 durable invocation / authenticated Run 解析 Camp、source Run、epoch、reply reference 与
   `local_user`；
2. 验证 closed input、Agent recipient sources、membership/self/lineage/fanout/budget 和 Task；
3. 形成 normalized Structured Content、projectedBody、digest、Effective Agent Recipients 与每条
   frozen `forward | return` edge；
4. 为 recipient 数量预留 CampTurn slots；
5. 写入一个 CampMessage 及每个 recipient 一个 Message Delivery；
6. 当且仅当 `mentionUser=true`，写入一条
   `camp_message_user_mention(local_user, campId, messageId)`；
7. 写 receipt、canonical result、domain events 并提交；随后才可触发 recipient dispatch 与 Renderer wake。

任何一步失败都不得留下消息、segment、notification、Delivery、slot 或半完成 receipt。Notification
insert 必须发生在同一 transaction，不能由提交后 event consumer 补写。

`taskId` admission 只计算 Effective Agent Recipients：

| Agent recipient count | mentionUser | taskId result |
| ---: | --- | --- |
| 0 | false/true | `message.task_recipient_ambiguous` |
| 1 | false/true | 可继续校验 Task |
| 2+ | false/true | `message.task_recipient_ambiguous` |

### 3.4 Notification 持久模型

在现有 `in_app_notification` 上增加 `camp_message_user_mention`、`source_message_id` 与 user-mention
presentation/read fields；具体 DDL 必须实现：

```text
UNIQUE(kind, recipient_user_id, source_message_id)
  WHERE kind = 'camp_message_user_mention'
```

`source_message_id` 对该 kind 必填；创建事务必须验证它与 `camp_id` 指向同一 CampMessage，其他现有
kind 不伪造该字段。它保存稳定 opaque locator，不建立会随单条 CampMessage 删除而级联的外键；
`camp_id` 继续引用 Camp 并 `ON DELETE CASCADE`。因此 Camp 仍存在但原消息因 tombstone、单条删除、
权限或其他原因不可读时，notification 的稳定身份、已读和 clear state 仍可读，
`sourceAvailable=false`，点击不得落到同 Camp 的另一条消息；删除整个 Camp 时沿用现有级联并删除通知。
Read Side 的 `sourceType="camp_message"` 由该 kind 闭合派生，不增加可与 kind 分叉的持久 source-type
列。

Read Side item schema 升版并为该 kind 返回：

```json
{
  "kind": "camp_message_user_mention",
  "camp": {"id":"camp_123","title":"…"},
  "sourceType": "camp_message",
  "sourceMessageId": "message_123",
  "sourceAvailable": true,
  "messageSummary": "@你 请确认采用方案 A…"
}
```

`messageSummary` 每次读取时从当前 projectedBody 形成，使用 Unicode scalar-safe 的 160 字符上限；
表中不保存 summary/body。`sourceAvailable=false` 时该字段精确为 `null`，Renderer 使用本地化固定文案
“来源不可用”，不泄露 tombstone 内容。

保留规则继续是 90 天、每用户最新 1,000 项、clear 后 1 天清理；现有 `clear` 就是 UI
删除/归档通知的持久动作，不新增第二个 archive state，且 cleared notification 不删消息。Camp 仍在时，
消息不可用也不自动 clear notification。每条 Message Mention 是独立 Inbox row，不跨消息聚合。

Preference schema 增加 `userMentionHeadsUpEnabled: boolean`，fresh/upgrade default `true`，仍受总
`headsUpEnabled` gate；关闭或重开不补弹旧通知，也不影响创建、未读、clear、retention 或导航。

Heads-up 保留单槽、8 秒、hover/focus 暂停、最多三项和 overflow summary。新增规则只聚合当下待显示的
`camp_message_user_mention`：在第一项 8 秒生命周期内到达、同一 `campId` 的后续项合成
“本 Camp 还有 N 条消息提及你”；聚合点击打开 Notification Center 并筛到相关新项，不批量 read/clear，
不改变底层 queue/Inbox rows。跨 Camp、不同 kind 或超出窗口的项不合并。

### 3.5 exact Camp read 与 Context

只有 `camp.read(mode="item")` 的唯一 item 增加：

```json
"addressing": {
  "effectiveAgentRecipients": ["agent_5"],
  "mentionsCurrentUser": true
}
```

- recipient order 使用消息接受时冻结的 canonical order；
- `mentionsCurrentUser` 从 Structured Content segment 派生，不以 notification 是否 retained/cleared
  反推；
- 每个 body slice 都返回同一 addressing，便于长正文逐段读取时保持判断；
- around/thread/timeline/search 不增加该对象，需要精确判断时以 stable campId/messageId 调用 item；
- 不返回 notification ID、recipient user ID、Delivery IDs 或可由 Agent 重放的 internal identity。

Context Formatter 新版本在每个 model-visible Camp message 上保留当前 body projection，并增加
`mentionsCurrentUser: true`（false 时仍显式返回 false，以免模型根据字面 `@` 猜测）。Current Input、
originating message、reference closure 和 recent messages 使用相同 shape；ContextManifest 新版本冻结
Structured Content digest、projected body digest、boolean 与 exact Formatter bytes。Recovery 复用 frozen
bytes，不因显示名、notification state 或当前 Renderer locale 重投影旧 input。

### 3.6 Clean-break 版本矩阵

| Surface | v0.64 baseline | v0.65 target | 升版原因 |
| --- | --- | --- | --- |
| Data Contract / projection schema | `v0.62 / 31` | `v0.65 / 32` | segment、notification source、preference 与 frozen context 清理 |
| SQLite migration | `76` | `77` | 原子 User Mention Notification、`local_user` clean break 与技术投影重建 |
| CampSnapshot / Read Model | `29` | `30` | Structured Content union 与 Renderer message/notification projection |
| In-App Notification item | `2` | `3` | `sourceType/sourceMessageId/sourceAvailable/messageSummary` |
| Context Formatter / Manifest | `13 / 11` | `14 / 12` | projected body 与显式 `mentionsCurrentUser` evidence |
| Built-in Tool contract / CLI / capability | `6` | `7` | Send v4、exact addressing 与精确 help/recovery |

Migration 77 只接受仓库已声明的当前可升级 marker，并最终写入 `v0.65 / 32`；不得把缺失 migration 的
marker 直接认作 current。它删除或重建不兼容的 ContextManifest、Runtime Input Delivery、Bootstrap
technical evidence、frozen A2A delivery context 和 Native Binding context markers，并按现有恢复边界
收敛受影响的非终态执行。兼容的 Camp/Task/Memory/终态执行与用户 Project 保留；旧 Transport、Formatter、
Notification item、`local-user` literal 或 nullable compatibility shape 不进入 current reader。

### 3.7 Agent output 与 recovery

成功 stdout 不变：

```json
{"messageId":"message_123","effectiveRecipients":["agent_5"]}
```

`messageId` 表示完整接受事务；输入含 `mentionUser=true` 时，其成功已经包含 segment 和 notification。
`effectiveRecipients` 始终只含 Agent IDs。

`confirm_outcome`：

- 有 Core 返回的 `messageId` 或 host-controlled 权威 CampMessage locator 时，使用 exact `camp.read item`
  检查 addressing；
- 普通 Agent stdout 的 `builtin_tool.outcome_indeterminate` 不携带 locator 时，不按正文、时间、作者或
  search snippet 猜测，不把“目标 Agent 尚未完成”当作 send 失败，不创建第二次 send；
- Agent 通过当前 Runtime outcome 向用户/上层说明结果不确定并停止 mutation。它不再另发一条 Camp
  消息来“说明不确定”，因为该动作本身是新的 mutation。

## 4. Phase 2 详细实现

### 4.1 三层教学职责

| 层 | 拥有 | 不拥有 |
| --- | --- | --- |
| Session Charter | 固定命令集合、精确 help 入口、输入来源、公共 send 义务、compact output、恢复安全 | 全 flags、完整 schema、命令决策树、Memory 全治理 |
| operation `--help` | 一个具体 operation 的 flags、闭合输入、关键 cardinality/error、短例子 | command-family 策略、多 operation workflow |
| `cli-operations` | command family 选择、message→Task、多操作协调、复杂 recovery | 普通单命令 flags、常规 `--to-user` 使用 |

精简后的 Charter 必须完整保留以下闭合义务，不能把它们搬进可选 Skill 后从每个 Session 消失：

1. 内置操作是固定的十三个本地 CLI command，不是 MCP tools；
2. 所有 eligible member 可调用公开 command，但每次调用仍由 Core 做当前 authorization/scope admission；
3. 每次调用恰好使用 direct flags、一个 stdin JSON object 或一个 `--input-file`，不得合并输入源；
4. `rovai send` 使用当前 authenticated AgentRun Camp；需要公开答复时必须在结束前成功 send；
5. 普通成功只输出 compact business-result JSON，普通业务失败只输出安全的 `error` 与 `recovery`；
6. send acceptance 只证明消息及冻结效果提交，不证明下游 Agent 已启动或完成；
7. `confirm_outcome` 仅在有权威 locator 时 exact-read；无 locator 时公开说明不确定并停止 mutation；
8. command success 只证明对应 Rovai operation，不证明总体质量、测试、评审或用户意图已满足。

所有教学使用：

```text
Run `rovai --help` to choose an operation, then run that operation's exact
`--help`. Do not assume that a command family has its own help entry.
```

有效 help 路径只有根 help、`rovai send --help` 与完整 group+action，例如
`rovai task create --help`、`rovai camp read --help`、`rovai memory write --help`。

### 4.2 `cli-operations` package

目录：

```text
skills/cli-operations/
├── SKILL.md
├── agents/openai.yaml
└── references/
    ├── send.md
    ├── task.md
    ├── camp-history.md
    ├── memory.md
    └── recovery.md
```

Front matter description 精确使用已确认的窄触发含义；正文开头必须给出“不加载”的快速路径。每个
reference 只通过 `[Send](references/send.md)` 这类有效相对链接访问，不出现聊天 URL、失效绝对路径、
嵌套代码 fence 或 family-level help。

```yaml
---
name: cli-operations
description: 当不确定当前工作应使用 CampMessage、持久 Task、Camp/History 检索还是 Memory，普通消息是否应升级为 Task，一次业务事件需要协调多个 Rovai 操作，或 CLI 返回要求 refresh、confirm_outcome 等业务状态判断时使用。普通单一操作、收件人参数和具体 flags 应直接查看对应 operation 的 --help，不要因此自动加载本 Skill。
---
```

`agents/openai.yaml` 精确使用：

```yaml
interface:
  display_name: "CLI 操作协调"
  short_description: "在命令选择、多步协作和复杂恢复时提供 Rovai CLI 指引"
  default_prompt: "使用 $cli-operations 为这个需求选择正确的 Rovai 操作，协调必要的多步流程，并安全处理复杂恢复。"
```

`SKILL.md` front matter 只含 `name` 与 `description`，正文保持在 500 行以内。五个 reference 都必须由
`SKILL.md` 一层直达并说明读取条件，不能要求先读另一个 reference 才能发现；同一规则只保留一个
权威落点，不在正文和 reference 之间复制。该包不需要 scripts、assets、README、安装指南或 changelog。

- `send.md`：public message、Agent routing、User attention 三种正交效果和何时不创建 Task；
- `task.md`：只有跨 Run/交接的独立责任才升级 Task，以及 exact-one recipient linkage；
- `camp-history.md`：current Camp search、cross-Camp history search、stable-ID exact read 的选择；
- `memory.md`：仅路由到具体 CLI 与 `memory-stewardship`，不复制或削弱后者；
- `recovery.md`：按 error.recovery 分类，`refresh_then_decide`、`confirm_outcome` 有 locator/无 locator
  分支和 no blind retry。

实现完成时同时通过 Skill name/front matter 校验、`agents/openai.yaml` 字段校验、所有相对链接与
reference 存在性检查、Core UTF-8/symlink/unsupported-node bundled manifest gate，以及七项 official
inventory 的 immutable Revision fixture。无需为纯文档 references 增加可执行 script。

### 4.3 `memory-stewardship` 无损拆分

实施前把现有规则做成 semantic golden checklist。拆分完成必须仍可定位并测试：

1. current user input、authorization、tool result、repository/collaboration facts 高于 Memory；
2. Memory Entrypoint 只是 discovery cache；ID/snippet 依赖前必须 read；
3. `current / revision_changed / inactive / deleted / access_changed / unavailable` 处理；
4. 不直接读取或修改 file、SQLite、Markdown/Skill Projection；
5. 禁止 credentials、敏感数据、不可信指令、人格判断与无依据推测；
6. scope/kind/direction、Relationship 单向责任与 Hearth proposal 权威；
7. revise 使用最新 `baseRevisionId` 且不能改变 Scope/Kind/counterparty/direction；
8. Body 2,048 UTF-8 bytes；retrieval keys 1–3 个、各 2–24 bytes、总计 48 bytes；
9. search→read→dedupe→add/revise/propose→receipt 的最小 mutation 顺序。

CLI 示例统一为 `rovai memory search|read|write|propose-hearth`；JSON 只作为这些 operation 的
stdin/input-file 示例，不能继续写内部 dotted operation 当作 Agent 命令。

### 4.4 ordinary official Skill 投递

Core official inventory 从六个增至七个，新增 `cli-operations`。它与 `memory-stewardship` 都：

- `origin=official`、Renderer source label `Rovai`；
- 首次安装默认 enabled、九个现有 Runtime Group Assignments；
- 用户后续 disable、删除 Assignment 或 Revision 更新保持现有 authority；
- 不获得 required/locked 状态，不创建专属设置组，不被 Charter 全文注入；
- Skill exposure 仍只证明 Runtime-native discovery 可见性，不证明模型实际读取，也不授予 capability。

## 5. 模块与文件落点

| 范围 | 主要文件/模块 | 预期变化 |
| --- | --- | --- |
| Content | `camp_content.rs`, `message_delivery.rs`, collaboration/history/read model | segment、projection/cache、digest、search/addressing |
| Send input/CLI | `team_tool.rs`, `team_tool_catalog.rs`, `bin/rovai.rs`, CLI output | v4 input、`--to-user`、help、closed schemas |
| Notification | `db.rs`, `notification.rs`, Main IPC, Renderer Notification components | kind/source/pref/read schema、navigation、aggregation |
| Context | `context.rs`, manifest/data contract constants | boolean metadata、new formatter/manifest, frozen recovery |
| Renderer message | `CampWorkspace.tsx`, structured mention model/clipboard, styles/tests | Current User token、copy/paste、a11y |
| Teaching | `resources/charter-rovai-cli.md`, `skills/cli-operations/**`, `skills/memory-stewardship/**` | progressive layers and lossless split |
| Skill inventory | `skill.rs`, smoke/capture/tests, Settings docs/tests | seventh official Skill, ordinary delivery |
| Compatibility | `scripts/smoke-builtin-cli.mjs`, qualification fixtures, register | v7 and nine Runtime evidence |

文件名可以随代码结构小幅调整，但不得把 Current User identity、message projection 或 notification
creation 分散到 Renderer/CLI 多个真源；Core module API 应隐藏持久化与 projection 细节。

## 6. 测试矩阵

| Case | message | structured user mention | Agent Deliveries | notification | exact addressing |
| --- | ---: | ---: | ---: | ---: | --- |
| body only | 1 | 0 | 0 | 0 | `[], false` |
| `--to-user` only | 1 | 1 | 0 | 1 | `[], true` |
| one `--to` | 1 | 0 | 1 | 0 | `[agent], false` |
| one `--to` + `--to-user` | 1 | 1 | 1 | 1 | `[agent], true` |
| inline + same `--to` + user | 1 | 1 | 1 | 1 | deduped Agent + true |
| handwritten `@你`/`@local_user` | 1 | 0 | 0 | 0 | `[], false` |
| task + user only | 0 | 0 | 0 | 0 | ambiguous error |
| task + one Agent + user | 1 | 1 | 1 | 1 | one Agent + true |
| task + two Agents + user | 0 | 0 | 0 | 0 | ambiguous error |
| same invocation replay | original | original | original | original | original |
| notification insert failure | 0 | 0 | 0 | 0 | no partial receipt |
| no-locator indeterminate | unknown | unknown | no resend | no inference | stop |

发布验收还必须证明：显示名变化不改变 semantic digest；notification clear/retention 不改变
`mentionsCurrentUser`；source unavailable 不跳错消息；private structured paste 不能让用户 Draft 伪造该
segment；九 Runtime 普通单操作不会因存在 `cli-operations` 而被要求先加载 Skill。
