---
document_type: model-context-change
version: v1.72
revision: 4
confirmation_status: pending
implementation_status: not_started
source_commit: 70c9214bf47a677d018a7f2448583d6ec3422d22
last_updated: 2026-10-10
---

# Send 正文文件方案与模型上下文对照 r4

`rovai send --input-file` 同时支持正文文件和既有 JSON 请求文件：严格通过现有封闭 Send Schema 的 JSON 对象作为完整请求，其余合法文本作为正文。新教学默认演示正文文件；已有合法 JSON 调用和冻结 Session 继续可用。

本稿供 User 审阅完整行为与精确文案。Bootstrap 和 Skill 主文只保留输入规则的帮助入口，具体用法集中在 `send --help`；不新增 TMP 目录教学。本文是待确认方案，不是现行合同或已交付能力。

r4 经整体检查，删除错误处理段中可能把兼容规则重新引向 help 的表述，并精简 Skill、根 help 与 Send help 的重复指导。旧 JSON 文件的兼容规则只留在实现与测试中；新教学只讲正文文件及发送参数。

## 范围与依据

| 项目 | 本稿选择 |
| --- | --- |
| 基线 | `70c9214bf47a677d018a7f2448583d6ec3422d22`；2026-10-10 本地源码与只读命令帮助 |
| 当前版本 | 由[版本索引](../README.md)解析为 v1.72；不切换版本 |
| 修改入口 | 只扩展 Agent `rovai send --input-file`，不新增 `--body-file` 或格式选择参数 |
| Core 边界 | CLI 生成原有请求对象；Core 不读取正文文件路径，不新增 `bodyFile` |
| 合法旧调用 | 完整 JSON 请求的字段、寻址、附件、回执与重试语义保留 |
| Agent 教学 | Send 只教直接参数与正文文件；旧文件格式及兼容处理不进入教学 |
| 文件位置 | 任何现有权限允许读取的位置；不要求放进 `ROVAI_RUN_TMP` |
| 本轮交付 | 本方案、完整前后文案、上下文入口审计、实施与验收边界 |
| 未授权范围 | 本稿未取得实施二次确认；不修改实际提示词、Skill、Schema、产品代码或当前合同 |

当前输入解析见 [rovai.rs](../../../crates/rovai-core/src/bin/rovai.rs)，Schema 与正文业务校验见 [team_tool.rs](../../../crates/rovai-core/src/team_tool.rs)，教学真源见 [camp_message_send_teaching.rs](../../../crates/rovai-core/src/camp_message_send_teaching.rs)。本方案遵循[上下文变更治理](../../development/model-context-change-governance.md)和[渐进加载分层](../../development/skill-authoring.md#渐进加载分层)。

## 输入行为

本节描述实现与测试合同，不作为 Agent 提示词。兼容适配由 CLI 文件读取入口完成，再交给 Core 处理标准请求；不让 Agent 承担格式兼容。

### 文件读取

1. 接受普通文件，包括符号链接最终指向的普通文件；不依赖扩展名。目录、设备、管道在可能阻塞的读取前拒绝，不能先 `fs::read` 再判断类型。
2. `--input-file` 的相对路径仍相对 CLI 当前工作目录；绝对路径直接使用。文件中的附件路径仍由现有 Core 规则处理，不改为相对 JSON 文件目录。
3. 严格读取 UTF-8，移除开头至多一个 UTF-8 BOM；拒绝非法编码和原始 NUL。无编码猜测、格式转换或正文抽取。扩展名不是内容格式的保证。
4. 正文模式保留剩余文本的空白、CRLF/LF、真实换行、字面 `\n`、引号和反斜杠；CLI 不 trim、不解码 JSON 字符串、不添加代码围栏。
5. 本版不引入独立的原始文件大小上限。最终 `body` 继续受 32 KiB UTF-8 字节上限约束；完整 JSON 的外壳、缩进和转义不计入解码后的正文长度。读取或资源分配失败则不发送；不截断、不自动拆条。
6. 普通文本检查只作用于 Send 文件入口。旧 JSON 内的字符串仍按原有 JSON 规则解码；例如转义的 `\u0000` 不等于文件中存在原始 NUL，本版不额外改变 Core 字符策略。

PDF、DOCX、图片等不提供正文提取能力；仅凭 UTF-8/NUL 检查不承诺识别所有二进制格式。需要交付源文件时继续使用附件机制。

### 格式识别

`JSON parse → 既有输入规范化 → 现有封闭 Send Schema 校验` 全部成功时，分类为完整请求；保留整个对象并进入现有规范化、Schema 校验与 Core 业务链。任何格式步骤未命中时，以原始文件文本构造 `body`。

识别只复用 `builtin_tool_description("thread.message.send").input_schema` 及现有 validator，不复制字段清单，不用 Rust 反序列化成功代替 Schema 校验，不把正文是否非空、收件人是否存在等业务校验放进识别器。当前 Send JSON 没有字段别名转换；保留通用规范化顺序即可，不新增猜测或别名。

Schema 的长度、数组数量、唯一性和类型限制同样参与识别。重复 JSON key 沿用现有 JSON parser 行为，不在本版新增独立准入规则。分类一旦确定为请求，任何后续失败都不能退回正文重发。

| 文件内容或条件 | 分类与结果 |
| --- | --- |
| Markdown、普通文本、合法 UTF-8 的非法 JSON | 全文作为正文 |
| JSON 字符串、数组、数字、含多个顶层值的 JSONL | 全文作为正文，不解包字符串或拆行 |
| `{"status":"done","count":3}` | 未通过 Send Schema，全文作为正文 |
| `{"body":"完成","publicOnly":true}` | 完整请求，保留 `publicOnly` |
| `{"body":"完成","publicOnly":true,"extra":1}` | 未知字段，全文作为正文 |
| `{"body":123}` 或 `{"body":"完成","publicOnly":"true"}` | 类型不符，全文作为正文 |
| `{}`、`{"publicOnly":true}` | 通过当前 Schema；随后因缺少正文和附件而业务失败 |
| `{"files":["report.pdf"]}` | 完整请求，保留纯附件发送 |
| `{"body":"完成","publicOnly":true,"to":["agent_5"]}` | 完整请求；参数业务冲突，不发送，不降级 |
| 符合 Schema，但随后发生收件人或附件业务拒绝 | 完整请求；按原业务错误处理，不降级 |
| 将旧请求 JSON 放入 Markdown 代码围栏 | 整份文件不再是 JSON 对象，作为正文 |

当前 Schema 没有必填字段。不能为了避免 `{}` 被识别而增加“必须含 body”的自建条件，否则会破坏纯附件调用。

**兼容承诺仅覆盖合法旧请求。** 错误 JSON 过去可能报错，新版可能作为正文发布。识别时未通过 Schema 是格式分流；最终组成的请求未通过校验才是拒绝。裸请求 JSON 的双重含义仍由请求优先解决，不引入模糊检测。此边界只记录在实现说明与测试中，不向 Agent 追加格式识别、代码围栏或兼容冲突教程。

### 参数组合

| 输入方式 | 行为 |
| --- | --- |
| 正文文件 + `--public-only / --to / --to-user / --task-id / --file` | 允许组合，仍受原业务约束 |
| 完整 JSON 请求文件，无直接业务参数 | 保留旧行为 |
| 完整 JSON 请求文件 + 任意直接业务参数 | 输入冲突，不合并或覆盖，即使值相同也拒绝 |
| `--body` + `--input-file` | 两个正文来源，拒绝，与文件内容无关 |
| 重复 `--input-file` | 拒绝 |
| 空白正文文件，无附件 | 原业务校验拒绝 |
| 空白正文文件 + 合法附件 | 按原纯附件能力处理，不新增“文件必须非空”限制 |
| JSON stdin/heredoc | 保持原 JSON 对象语义，不扩展为文本正文 |
| 其他命令的 `--input-file` | 保持原 JSON 输入和来源互斥规则 |

参数在文件前后均等价。保留 `--to-principal` 到 `mentionUser` 的 CLI 兼容别名及重复别名拒绝规则。存在文件或直接参数时不探测、读取或等待继承的 stdin；正文模式不自动增加 `publicOnly`、通知或收件人。

## 上下文入口清单

| 入口 | 模型何时可见 | 本次处理 |
| --- | --- | --- |
| 公共 Bootstrap 的 CLI Contract | 新 Session Bootstrap；旧 Session 使用冻结版本 | 删除绝对互斥句；保留已有 exact-help 入口，不增加新句 |
| `rovai send --help` | Agent 主动查询 | 只教直接参数与正文文件；不含旧 JSON 格式、识别规则或兼容说明 |
| `cli-operations/SKILL.md` | 按需加载 Skill | 删除旧操作步骤 2，沿用开头已有的 help 指引；后续步骤顺次编号 |
| `cli-operations/references/send.md` | 按需读取 Send reference | 不变；沿用已有 help 指引 |
| Skill description、平台索引、UI 默认提示 | Bootstrap/Run 索引、原生发现或用户选取 | 不变；不增加常驻文件教程 |
| 根 help、其他命令 help | 按需查询 | 根 help 删除通用输入枚举，只保留命令帮助入口；其他命令 help 不变 |
| Catalog summary、Schema descriptions | help 或已有目录投影消费 | 不变；不增加文件业务字段 |
| 错误与成功结果 | CLI 调用返回 | 结构、恢复和业务意义不变，详见后文 |
| 飞书文件提示、Codex 完整答复提示、Mission/A2A 指导 | 按现有条件进入上下文 | 不变；现有发送/附件语义仍成立 |
| Single Chat Charter、Runtime 指导、Dynamic Context | 对应执行上下文 | 不变；不扩大 Send 权限或加入新教学 |
| 其他 bundled Skill 的 `--body` 示例 | 加载对应 Skill 时 | 不变；合法直接正文调用仍支持 |

## 整体检查结论

r3 的新版提示词已不含旧 JSON 兼容教学，但方案说明仍有一处可能引回兼容教程的表述，以及几处重复指导。r4 已逐项收敛：

| 检查项 | 处理与原因 |
| --- | --- |
| 错误处理段的“具体组合规则由帮助说明” | 删除；错误与恢复保持现有合同，不借此把旧格式说明加回 help |
| Skill 协调步骤中的再次读取 help | 删除整个旧步骤 2；Skill 开头已有命令帮助入口，不再用另一句重复指导替换它 |
| 根 help 的统一输入枚举 | 删除；各命令自己的 help 负责具体输入，根 help 只负责找到命令 |
| Send help 页头与示例的重复说明 | 页头合并为一句；示例删除重复的“使用文件写入工具”，该操作只在正文帮助中说明一次 |
| 正文发送的必要说明 | 保留直接写入 UTF-8 文件、`--body` 互斥和写入成功后再发送；分别明确文件内容、正文来源和避免发送同名旧文件 |
| 寻址、通知、附件、回执与恢复 | 保留现有业务含义；这些决定实际发送效果，不属于旧文件兼容教学 |
| 其他上下文入口 | 已核对 Skill 索引与元数据、条件 Bootstrap、Runtime/恢复提示、其他 Skill 和测试投影；本次不新增兼容通知、目录约束、编码教程或迁移指导 |

当前源码中的旧 JSON 教学仍存在，因为本轮只修改待评审提案。它们的替换位置已在下文完整列出；其他命令真实支持的 JSON 输入、历史消息和冻结 Bootstrap 不作清除。

## 变更前

当前 CLI 只把 `--input-file` 解析为 JSON 对象，所有命令均禁止和直接参数混用。帮助首例要求创建 JSON 请求文件。Bootstrap 和 Skill 主文重述输入来源互斥。

下节按每个实际表面提供完整前后文本。通用公共 Charter 展示全部共用文本；条件追加段另行列出，成员身份、Memory 等动态内容不伪造固定样本。文档中的“变更后”均为 r4 提案，不是当前程序输出。

## 变更后

正文文件成为新教学的首选方式。Send help 只说明正文文件怎么发送；Bootstrap 与 Skill 沿用帮助入口。旧文件格式、识别条件及兼容规则不进入这些教学文本。所有新增模型指令均使用现有英文风格，方案说明用中文。

### 公共 Bootstrap 完整共用 Charter

来源：[公共 Charter 组装](../../../crates/rovai-core/src/context.rs)与 [CLI Contract 资源](../../../crates/rovai-core/resources/charter-rovai-cli.md)。唯一改动是删除输入来源互斥句；其余共用文本逐字不变。

**变更前**

````text
[SESSION_CHARTER]
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

- Use the local `rovai` CLI for the complete built-in operation catalog: `rovai send`; `rovai member list|get|create|update`; `rovai task create|get|list|update`; `rovai thread list|search|read|runs`; `rovai history search`; `rovai memory view|search|read|write`; and `rovai mission list|get|update|status`.
- Use `rovai --help` to choose an operation and its exact `--help` for syntax. Reuse help already available in the current Native Session.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` always publishes one public Thread message. When the current responsibility has a Thread-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Thread messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Thread messages are visible to the User. Use `--to-user` only for a new decision, answer or action needed from them, or an explicitly requested important-result notification.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
[/SESSION_CHARTER]
````

**变更后**

````text
[SESSION_CHARTER]
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

- Use the local `rovai` CLI for the complete built-in operation catalog: `rovai send`; `rovai member list|get|create|update`; `rovai task create|get|list|update`; `rovai thread list|search|read|runs`; `rovai history search`; `rovai memory view|search|read|write`; and `rovai mission list|get|update|status`.
- Use `rovai --help` to choose an operation and its exact `--help` for syntax. Reuse help already available in the current Native Session.
- `rovai send` always publishes one public Thread message. When the current responsibility has a Thread-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Thread messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Thread messages are visible to the User. Use `--to-user` only for a new decision, answer or action needed from them, or an explicitly requested important-result notification.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
[/SESSION_CHARTER]
````

**变更介绍：** 只删除“所有命令只能选择一种输入源、不得混用”这一句，沿用已有的 `--help` 指引，不增加正文文件或临时目录教程。旧 Session 的冻结文本保持原样，旧 JSON 调用仍可使用。

### Send help 整页

来源：[帮助渲染](../../../crates/rovai-core/src/bin/rovai.rs)与[集中教学常量](../../../crates/rovai-core/src/camp_message_send_teaching.rs)。普通命令继续使用原页头；Send 专用页头只改变本命令的输入说明。

**变更前**

````text
rovai send
Publish one public Thread message. Use --public-only when the message must not address any Agent; it prevents Agent addressing, creates no Agent Delivery, and wakes no Agent. Without --public-only, --to may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the User. Use --to-user only for a new unresolved User decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.

  --body                       field=body type=string
      Use --body for simple single-line text; \n remains literal.
      For multiline text, Markdown, or content containing backticks or $(), write a UTF-8 JSON request with a file-write tool and use --input-file <path>.
  --file                       field=files type=array repeatable
      Attach a recipient-facing file or directory at its actual path; repeat to preserve attachment order. Rovai references the current file without copying or changing permissions. Temporary files may become unavailable when their source is cleaned up.
  --to-user                    field=mentionUser type=boolean
      Mention the User and create an Inbox notification.

      Ordinary public Thread messages are already visible to the User. Use this flag only when the message creates a new unresolved decision, answer, or action for the User, or when the User explicitly requested notification of an important result.

      It creates no Agent Delivery, does not represent approval, and may be combined with --public-only. User attention is message-local and is never inherited by replies, Tasks, or downstream A2A work.
  --public-only                field=publicOnly type=boolean
      Guarantee that this public message wakes no Agent.

      effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.

      Do not combine this option with --to or --task-id. It may be combined with --to-user.
  --task-id                    field=taskId type=string
  --to                         field=to type=array repeatable
      Explicit Agent recipient to wake; repeat as needed.
      Agent addressing schedules concrete continuing work, not CC.
      Do not use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or a repeated conclusion.
      This option is invalid with --public-only.

Examples:
  Write request.json with a file-write tool:
    {"publicOnly":true,"body":"Result:\n\nUpdated `src/example.rs`."}
  rovai send --input-file request.json
  rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'
  rovai send --public-only --to-user --body 'Please choose whether to roll back the client or continue the token investigation.'
````

**变更后**

````text
rovai send
Publish one public Thread message. Use --public-only when the message must not address any Agent; it prevents Agent addressing, creates no Agent Delivery, and wakes no Agent. Without --public-only, --to may schedule Agents. Agent addressing schedules concrete continuing work, not CC; never use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Ordinary public messages are already visible to the User. Use --to-user only for a new unresolved User decision, answer, or action, or an explicitly requested important-result notification. Always inspect agentAddressingMode, effectiveRecipients, and deliveryIds. A successful send proves only that its message and effects were committed; it does not prove recipient work has started or completed.

Input: direct flags, or --input-file <path> with send flags except --body.

  --body                       field=body type=string
      Use --body for simple single-line text; \n remains literal.
      For multiline, Markdown, or complex text, use a file-write tool to write the body directly to a UTF-8 file.
  --file                       field=files type=array repeatable
      Attach a recipient-facing file or directory at its actual path; repeat to preserve attachment order. Rovai references the current file without copying or changing permissions. Temporary files may become unavailable when their source is cleaned up.
  --to-user                    field=mentionUser type=boolean
      Mention the User and create an Inbox notification.

      Ordinary public Thread messages are already visible to the User. Use this flag only when the message creates a new unresolved decision, answer, or action for the User, or when the User explicitly requested notification of an important result.

      It creates no Agent Delivery, does not represent approval, and may be combined with --public-only. User attention is message-local and is never inherited by replies, Tasks, or downstream A2A work.
  --public-only                field=publicOnly type=boolean
      Guarantee that this public message wakes no Agent.

      effectiveRecipients and deliveryIds are empty, and no Agent Delivery is created.

      Do not combine this option with --to or --task-id. It may be combined with --to-user.
  --task-id                    field=taskId type=string
  --to                         field=to type=array repeatable
      Explicit Agent recipient to wake; repeat as needed.
      Agent addressing schedules concrete continuing work, not CC.
      Do not use it for acknowledgement, agreement, thanks, closure, standby, no-new-information, or a repeated conclusion.
      This option is invalid with --public-only.

Examples:
  Write reply.md:
    Result:

    Updated `src/example.rs`.
  After the write succeeds:
    rovai send --public-only --input-file reply.md
  rovai send --to agent_5 --body 'Please reproduce on the previous client build and return the version and result.'
  rovai send --public-only --to-user --body 'Please choose whether to roll back the client or continue the token investigation.'
````

**变更介绍：** 多行正文教学和首个示例改为“直接写正文文件，写入成功后发送”。页头合并为一句，只说明正文文件可配合发送参数、不能同时使用 `--body`；文件写入工具只提一次。旧 JSON 教学全部删除，另外两个主示例不变。

`--body` 的字面 `\n` 规则、寻址帮助、附件帮助和回执判断不变。新文案不禁止工具调用自身的 JSON 编码，也不要求特定临时路径。

Send help 不再列举 JSON stdin/heredoc；该入口仍按原语义支持，只是不在新的 Send 教学中推广。根 help 也不再统一列举输入形式；其他命令的现行 JSON 输入说明保持原样。

### cli-operations 主文全文

来源：[SKILL.md](../../../skills/cli-operations/SKILL.md)。删除 `Coordinate operations` 的旧步骤 2，后续步骤顺次编号；frontmatter、description、其他流程与 reference 路由不变。

**变更前**

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
| Member identity, profile images or a requested profile edit | Member |
| Default Lead requests independent work from several members | One ThreadMessage with repeated `--to`; replies return separately |
| Responsibility that survives Runs and can be handed off and accepted independently | Task |
| Thread or message evidence | Thread/History |
| Who is running, queued or waiting | Thread execution query |
| Durable collaboration preference, agreement or lesson | Memory governance |

Choose the smallest object that fully serves the request. Tasks own durable responsibilities; project sources and history own their facts.

## Member operations

`member get` supplies the current Profile version and image paths; `member update` changes the global Profile. Send only the fields the User asked to change. For a newly created member, use the `agentId` returned by `member create`, even before it joins this Thread. Use `member-studio` for creation proposals and confirmation, not edits to an existing Profile.

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

**变更后**

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
| Member identity, profile images or a requested profile edit | Member |
| Default Lead requests independent work from several members | One ThreadMessage with repeated `--to`; replies return separately |
| Responsibility that survives Runs and can be handed off and accepted independently | Task |
| Thread or message evidence | Thread/History |
| Who is running, queued or waiting | Thread execution query |
| Durable collaboration preference, agreement or lesson | Memory governance |

Choose the smallest object that fully serves the request. Tasks own durable responsibilities; project sources and history own their facts.

## Member operations

`member get` supplies the current Profile version and image paths; `member update` changes the global Profile. Send only the fields the User asked to change. For a newly created member, use the `agentId` returned by `member create`, even before it joins this Thread. Use `member-studio` for creation proposals and confirmation, not edits to an existing Profile.

## Coordinate operations

1. Read the authoritative state needed for the decision.
2. Inspect the committed business result before taking the next step.
3. Publish any required Thread-visible answer before ending the Run.

A successful operation proves its own commit, not downstream execution, validation or completion of the user's objective.

## References

- [Send](references/send.md): public messages, Agent routing, parallel invitations and User attention.
- [Task](references/task.md): durable responsibility and Task-linked messages.
- [Mission](references/mission.md): objective, status and public explanation.
- [Thread/History](references/camp-history.md): message reads, addressing, execution state and pagination.
- [Memory](references/memory.md): route durable information to `memory-stewardship`.
- [Recovery](references/recovery.md): follow `error.recovery`, especially uncertain outcomes.
````

**变更介绍：** 删除“每次只用一种输入源”这一步，后续步骤顺次编号。Skill 开头已有读取命令帮助的指引，因此不再补一条同义指导。

### cli-operations Send reference 全文

来源：[references/send.md](../../../skills/cli-operations/references/send.md)。保持全文不变，沿用已有 help 指引；不增加格式清单或兼容教程。

**变更前**

````markdown
# Send

Read `rovai send --help` for current inputs. A Send can independently:

- publish a message visible to everyone in the current Thread;
- route concrete work to Agents through frozen Deliveries;
- request User attention without creating an Agent Delivery.

Use `--public-only` for a public record that must wake no Agent. Use `--to` for concrete continuing work; repeat it for parallel recipients. Replies go to the requester. Do not address Agents for acknowledgements, closure or status with no new action.

## User attention

Ordinary messages are already visible to the User. Add `--to-user` only for a new unresolved decision, answer or action, or an explicitly requested important asynchronous result notification.

Attention belongs to this message; replies, Tasks and downstream work do not inherit it. The Agent responsible for the user-facing outcome normally decides when to request attention. Internal reviewers return results to their caller; this is workflow guidance, not a Core permission rule.

Combine `--to` and `--to-user` only when each recipient has an independent action. If Agent work depends on a human decision, obtain that decision first.

A one-time answer, update, question or request uses a message. Use a [Task](task.md) only for durable, independently transferable responsibility. A Task-linked Send requires exactly one effective Agent recipient; User attention does not count.

A successful Send proves publication and its frozen effects, not that a recipient has started or finished.

## Files

Use `--file <path>` to publish a file or directory with the message; repeat it to preserve attachment order. No separate upload is required. At least one file can form a message without a body.
````

**变更后**

````markdown
# Send

Read `rovai send --help` for current inputs. A Send can independently:

- publish a message visible to everyone in the current Thread;
- route concrete work to Agents through frozen Deliveries;
- request User attention without creating an Agent Delivery.

Use `--public-only` for a public record that must wake no Agent. Use `--to` for concrete continuing work; repeat it for parallel recipients. Replies go to the requester. Do not address Agents for acknowledgements, closure or status with no new action.

## User attention

Ordinary messages are already visible to the User. Add `--to-user` only for a new unresolved decision, answer or action, or an explicitly requested important asynchronous result notification.

Attention belongs to this message; replies, Tasks and downstream work do not inherit it. The Agent responsible for the user-facing outcome normally decides when to request attention. Internal reviewers return results to their caller; this is workflow guidance, not a Core permission rule.

Combine `--to` and `--to-user` only when each recipient has an independent action. If Agent work depends on a human decision, obtain that decision first.

A one-time answer, update, question or request uses a message. Use a [Task](task.md) only for durable, independently transferable responsibility. A Task-linked Send requires exactly one effective Agent recipient; User attention does not count.

A successful Send proves publication and its frozen effects, not that a recipient has started or finished.

## Files

Use `--file <path>` to publish a file or directory with the message; repeat it to preserve attachment order. No separate upload is required. At least one file can form a message without a body.
````

**变更介绍：** 变更前后完全相同。原文已经引导读取 `send --help`，无需再列出格式或兼容主题。

## 其他可能进入上下文的部分

### 根帮助与其他命令帮助

来源：[root_help_text](../../../crates/rovai-core/src/bin/rovai.rs)。根 help 只保留操作目录与精确帮助入口，删除统一列举输入形式的句子。以下为受管 Runtime 的完整前后文本。

**变更前**

````text
Rovai CLI

Agent operations:
  rovai send
  rovai member list|get|create|update
  rovai task create|get|list|update
  rovai thread list|search|read|runs
  rovai history search
  rovai memory view|search|read|write
  rovai automation list|get|create|run|close|update|delete
  rovai mission list|get|update|status

Run an Agent operation's exact `--help` for its closed inputs. Each Agent operation supports direct flags, JSON stdin/heredoc, or --input-file <path>.
````

**变更后**

````text
Rovai CLI

Agent operations:
  rovai send
  rovai member list|get|create|update
  rovai task create|get|list|update
  rovai thread list|search|read|runs
  rovai history search
  rovai memory view|search|read|write
  rovai automation list|get|create|run|close|update|delete
  rovai mission list|get|update|status

Run an Agent operation's exact `--help` for its closed inputs.
````

**变更介绍：** 只删除最后一句对 direct flags、JSON stdin/heredoc 与 `--input-file` 的统一枚举，保留命令目录和原有 help 指引。具体输入由对应命令帮助说明。

非受管进程复用这段公共根帮助；其已有 User Automation 追加段不变，不引入 Agent 文件输入教学。

其他命令的页头继续为：

````text
Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.
````

`member create/update`、`memory write`、`thread runs` 等 JSON 文件示例不变，不将本次功能外推到其他业务命令。`rovai app` 仍属独立 User Automation；不增加共享正文文件能力。

### Catalog、Schema 和 CLI 结果

[Send summary](../../../crates/rovai-core/src/camp_message_send_teaching.rs)与 [Send Schema](../../../crates/rovai-core/src/team_tool.rs)前后不变，包括 `body/to/mentionUser/publicOnly/taskId/files` 的属性描述、默认值和约束。`body` 仍是字符串；CLI 的文件类型不成为 Core Schema 的新分支。

| 模型可见结果 | 变更前 | 变更后 |
| --- | --- | --- |
| 文件读取、来源或格式输入错误 | `builtin_tool.invalid_input`，`fix_input`，exit 2 | 同左 |
| 通用 parse 错误消息 | `Command input does not match the accepted arguments.` | 同左 |
| Schema 字段 issue | 现有有界、安全字段信息 | 同左；针对最终组成的请求 |
| Core 业务拒绝 | 现有业务 code、safe message、recovery，exit 1 | 同左；不触发正文降级 |
| 不明提交结果 | `builtin_tool.outcome_indeterminate`、`confirm_outcome` | 同左；不另发新请求试探 |
| 成功回执 | 原有 `messageId / agentAddressingMode / effectiveRecipients / deliveryIds` 等字段 | 同左；不添加输入格式或文件路径字段 |

本版保留安全通用 parse 错误，不在模型错误中回显本地路径、文件正文或底层 I/O 错误，也不追加旧格式兼容教程。输入冲突测试验证错误 code、退出和零发布，不声称新增详细错误文案。

### Bootstrap 条件追加段

以下文本的变更前与变更后逐字相同；触发条件和顺序也不变。

飞书渠道附件交付提示：

````text
This Thread is connected to an external channel. Local file paths and Runtime image previews are not delivered there; when the recipient needs the file itself, include `--file <path>` in the corresponding `rovai send` message.
````

Codex 完整公开答复提示：

````text
When publishing the Thread-visible final answer with `rovai send`, use the complete final response in polished Markdown; do not send a compressed one-line summary and then write a richer Runtime final.
````

Mission 追加 Contract：

````text
Rovai Mission Contract

- All current members may use `rovai mission get|update|status` to maintain this Thread's Mission.
- Use `rovai mission get` when the current Mission's full definition is missing or outdated; judge completion against that definition.
- The Mission working directory is already prepared. Continue follow-up work there on its current checkout by default. Do not create or switch branches, or create another Worktree, merely because a new Run starts, context is compacted, or more changes are requested. Follow explicit user requests for a different branch or baseline.
- Change status only when the whole Mission's state changes, not merely when your Run ends.
````

A2A 返回指导中的公开答复句：

````text
If it changes the User-facing conclusion, publish exactly one Thread update with `rovai send --public-only`.
````

来源均为 [context.rs](../../../crates/rovai-core/src/context.rs)。正文文件是 CLI 的输入来源，`--file` 仍是给收件人的附件，因此不修改渠道交付提示。其他 A2A 指令、继续执行与缺失 Send 恢复指导不变，不用动态补发通知推广新用法。

### Skill 索引、其他 Skill 和 Runtime 上下文

`cli-operations` 的名称、description 与下列 UI 元数据前后相同；平台索引没有新增常驻文本：

````yaml
interface:
  display_name: "CLI 操作协调"
  short_description: "在 Send、Task、检索与 Memory 之间选择并安全协调"
  default_prompt: "使用 $cli-operations 选择正确的 Rovai 操作，协调并行消息或必要的多步流程，并安全处理复杂恢复。"
````

已核对以下仍包含发送示例或临时目录提示的入口：

| 入口 | 当前用途 | 本版处理 |
| --- | --- | --- |
| [campfire lead](../../../skills/campfire/references/lead.md)、[member](../../../skills/campfire/references/member.md)、[notes](../../../skills/campfire/references/notes.md) | 工作请求、完整结果、讨论结论的 `--body` 占位示例 | 保留；不重复具体输入编码教程 |
| [grill-duo](../../../skills/grill-duo/SKILL.md)、[grill-duo-with-docs](../../../skills/grill-duo-with-docs/SKILL.md) | 问题与建议的消息流示例 | 保留 |
| [review-duo](../../../skills/review-duo/SKILL.md) | 审核分工、回传、公开结论 | 保留 |
| [member-studio 头像来源](../../../skills/member-studio/references/avatar-sourcing.md) | 头像素材的已有可选临时目录建议 | 保留；不推广为 Send 目录要求 |
| [Single Chat Charter](../../../crates/rovai-core/resources/charter-rovai-single-chat.md) | 私聊专用允许目录，不提供 Send | 保留；不加入正文文件教程 |
| Runtime Adapter 提示、原生工具输入 Schema | 提供原生文件/命令执行能力 | 保留；不注入第二份 Rovai Send 文案 |
| `MEMBER_IDENTITY / COLLABORATION_STATE / SELF_ACTIVE_TASKS / RUN_FACTS / RUN_INPUT` 等 | 成员、职责和实际消息输入 | shape、选择、预算、投递和解释语义均不变 |
| Memory Entrypoint、Skill 索引、历史与引用 | 按既有权限和选择规则加载 | 不重写旧文字，不注入迁移通知 |

源码中的测试 fixture、当前 Architecture/Contracts 和本文可由开发 Agent 主动读取，但不会因为本次功能而新增为产品模型上下文。实施时更新约束说明与测试；不改写历史版本和冻结证据。

## 明确不变

- Core 接收标准请求对象；CLI 不将输入文件注册为附件，不自动删除输入文件，不让 Core 根据客户端路径删除文件。
- `--public-only / --to / --to-user / --task-id / --file` 的业务含义、权限、寻址与附件路径规则不变；正文仍走既有结构化内容和渲染链。
- 临时目录建议力度不增加。已有 exact Run tmp 的文件变化排除、解绑和清理机制不变，其他目录可用；不承诺消除其他目录或历史文件变化卡片。
- 原有 Schema 与正文 32 KiB 字节上限不变。Schema 的 `maxLength` 按字符计数，Core 仍按 UTF-8 字节校验；本版不借识别功能改变共享 Schema validator。
- 其他命令的输入方式、Send 的 stdin JSON、旧合法 JSON 文件和直接参数调用继续保留。
- Native Binding、旧 Bootstrap Evidence、历史上下文、旧回执、数据库与 Runtime 身份不迁移。恢复和压缩补发继续复用原冻结内容。
- 不新增业务默认、格式选择参数、文件转换器、迁移通知、上下文同步服务或新的临时文件管理器。

## 版本与兼容

以下数值以本稿源码基线为准；当前 Transport v36 文档仍写 Agent Output 9，而源码已为 10。本方案采用源码现状 10，不把旧文档文字当成降级授权。实施时沿用最新已交付输出版本。

| 版本轴 | 基线 | r4 拟实施 |
| --- | --- | --- |
| Built-in Contract / CLI / capability | 36 / 36 / `builtin_cli.transport.v36` | 37 / 37 / `builtin_cli.transport.v37`，标识输入语义扩展 |
| Session Charter revision | 20 | 21，仅新 Bootstrap 删除通用互斥句 |
| Native Binding Charter compatibility | 16 | 16，不因本次教学换 Session |
| Bootstrap contract / formatter | v5 / 5 | 不变 |
| 普通 Context formatter / manifest | 28 / 28 | 不变 |
| 公共批次 formatter / manifest | 33 / 33 | 不变 |
| Context Delivery Profiles / Run Facts | 当前版本 | 不变 |
| IPC / Envelope / receipt | 2 / 1 / 1 | 不变 |
| Agent Output | 10（当前源码） | 10 |
| Operation 数量、Send Schema、输出字段 | 当前目录 | 不变 |
| 数据库 Schema、应用版本指针 | 当前状态 | 不因本方案改变 |

来源：[context_contract.rs](../../../crates/rovai-core/src/context_contract.rs)、[builtin_tool_transport.rs](../../../crates/rovai-core/src/builtin_tool_transport.rs)。Antigravity 等 Runtime 已有固定兼容身份不被 live catalog 版本替换。若实施前编号已被其他交付占用，重新核对当前基线和版本记录，不静默覆盖别人已交付的版本语义。

新 CLI 能力、帮助和受管 Skill 随同一产品版本发布，避免新教学遇到旧解析器。新 Run 按既有 preflight 使用兼容 CLI/Core，本文不承诺独立混装新旧二进制。已有 Session 保持冻结 Bootstrap，合法 JSON 继续执行；受管 Skill 沿原路径同步，旧 Session 主动读取时可看到新版文件，但不承诺其自动改变习惯。

回滚使用上一份匹配的产品/CLI/Core/受管 Skill 组合，不只回滚解析器而留下新教学；不新增自动回滚或 Session 迁移系统。

## 实施边界与顺序

1. 在 CLI 内把 Send 文件输入单独分流：先解析参数并处理重复文件与双正文冲突，再读取和分类文件；完整请求与直接业务参数冲突，正文模式合成请求。
2. 合成后的请求复用 `parse_and_validate_operation_input` 及现有 Core 发送链。其他 operation 保持当前解析路径；显式来源不读 stdin。
3. 保持 `camp_message_send_teaching.rs` 为 Send 文案真源；让 Send 专用输入说明、正文帮助与示例由同一模块提供，`rovai.rs` 负责渲染。新教学不含旧 JSON 格式、识别条件、兼容冲突或特殊写法；Schema descriptions 与 summary 不改。
4. 删除本文列出的 Bootstrap 互斥句、Skill 旧步骤 2 与根 help 输入枚举；Skill 后续步骤顺次编号，更新对应 snapshot/owner tests。Send reference、其他命令 help、其他 Skill 和各 Runtime 提示保持原样。
5. 确认后同步版本概览、实施计划、当前 Transport/Send 合同与 Built-in 输入不变量，记录请求优先的歧义和有效旧调用兼容边界。按通用文档治理判断版本决定准入，不新增数字 ADR 或功能专属 checker 例外。
6. 完成确定性验证和真实上下文 Gate，再交付新能力与新教学。实施时以最终确认的 revision 为准；语义调整应更新 revision。

本轮只新增方案与版本入口链接。下一阶段才更新当前规范和产品代码，避免将提案当成已生效规则。

## 二次确认

`revision: 4`、`confirmation_status: pending`。User 要求整体检查兼容逻辑与不必要指导；本次据此清理残留表述和重复教学，未取得实施确认。

[核心模型上下文变更治理](../../development/model-context-change-governance.md#二次确认门槛)要求：

> 二次确认必须发生在开发者已经看过完整变更说明之后，并且明确同意实施该 revision。

确认前可以完成调查、提案和验证准备；不得修改实现、Schema、当前合同或执行 clean break。后续真实确认应记录 `confirmed_revision / confirmed_by / confirmed_at` 和确认消息定位，不以“同意方向”或自动检查通过替代。

## 验证

### 本稿的文档与文本验证

- 逐字核对“变更前”的公共 Charter、实际 Send/root help、完整 Skill 与 reference；记录基线 SHA。
- 验证 Bootstrap 只删除一句，Skill 只删除旧步骤 2 并顺次编号，根 help 只删除输入枚举，Send reference 全文不变；Send help 只改输入说明、正文帮助和首个示例，完整新 Send help 不含 JSON 格式或兼容教学。
- 检查新增教学没有 `ROVAI_RUN_TMP`、目录限制、其他命令文件输入扩展或强制 Session 更新。
- 核对其他命令 help、description、Schema、summary、条件追加段和其他 Skill 保持原样。
- 运行 `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=70c9214bf47a677d018a7f2448583d6ec3422d22 pnpm docs:check:ci`，并独立运行 diff-aware 文档治理检查。
- 待确认文档应如实触发现有确认门禁；不伪造确认、不修改 checker，也不把门禁失败称为已通过。

### 实施后的确定性验收

复用现有 CLI 输入、Send 业务、Context/Skill 与文件变化 owner，遵循 [Rust 测试准入规则](../../development/testing.md#rust-测试准入与退役门槛)。不新建只复制实现步骤或只匹配措辞的平行测试。

| 场景组 | 必须验证的行为 |
| --- | --- |
| 原文保留 | 中文、emoji、引号、反斜杠、LF/CRLF、首尾空白、真实换行和字面 `\n`；代码围栏包裹请求 JSON |
| 请求识别 | 正文、JSON scalar/array、JSONL、普通对象、非法 JSON；未知字段、错误类型、null、数组重复/超限 |
| Schema 边界 | `{}`、仅 `publicOnly` 命中后业务失败；纯附件 JSON 保持；不过度要求 body |
| 参数组合 | `--input-file` 在发送参数前后都一致；重复文件、双 body、旧请求与直接参数均拒绝，零发布 |
| 原业务校验 | `publicOnly + to/taskId`、无效收件人、无效附件在命中请求后拒绝，绝不退回正文重发 |
| 编码与文件 | 一个/两个 BOM、原始 NUL、非法 UTF-8、缺失/不可读文件、目录/设备/FIFO；普通文件 symlink；FIFO 测试有外层超时 |
| 正文上限 | 32 KiB 边界及超一字节、中文/emoji 字节边界；旧 JSON 文件因转义/缩进大于上限但解码正文合法仍可用 |
| 空正文与附件 | 空文件/空白文件，无附件拒绝，有合法附件沿原纯附件行为 |
| stdin 与其他命令 | 显式来源不触碰保持打开的继承 stdin；JSON stdin 不扩展；其他命令文件+参数仍冲突 |
| 旧 CLI 兼容 | 合法 JSON 保留全部字段，`--to-principal` 仍可用，重复别名仍拒绝 |
| 旧 Session | 冻结 Bootstrap 经恢复/补发后字节不变，旧 JSON 能发送；新 Session 保留帮助指引且不再含通用互斥句 |
| 文件变化 | exact Run tmp 与源码修改同 Run 时只排除前者；其他允许目录正文文件可读，不扩大排除范围 |
| 结果与权限 | 成功字段和恢复语义不变，无输入路径回显、隐式删除、额外附件、隐式通知或新增权限 |

运行受影响 Rust owner、`pnpm skills:test`、`pnpm skills:check` 和通用文档门禁。启动任何 Core/App/真实 Runtime 前按[本地隔离流程](../../development/local-workflow.md)建立独立验收实例，不使用日常 userData。

### 真实上下文 Gate

本次触及 Bootstrap 与核心 `cli-operations`，按[双轨评测](../../development/evaluation.md#上下文改动-gate)使用 [Suite 2.12.0](../../../qualification/context-regression/suite.json) 的 DEMO-101 至 DEMO-112，共 12 个任务。baseline/candidate 各一次，固定三位队员的 Runtime、模型、权限和 Judge 配置；沿用 scoring-v2.10，不改 Case 或评分标准。

每 campaign 14,400 秒、Case 并行 2、Judge 2,400 秒，最多两次，保留所有失败和 unknown。执行前用现有 freeze plan 固定实际模型、二进制、源码、Judge 及证据目录；缺少有效 Judge 或完整证据不能判通过。通过标准沿用现有硬性规则、任务质量、关键协作项、资源退化和证据要求，不以文案字节变少推断模型效果。

专项文件行为由上表确定性 owner 验证；通用集只验证上下文和协作回归，不能冒充所有文件边界的真实 Runtime 覆盖。本轮仅交付文档，不启动真实模型 Gate。

## 文本开销

下表统计 UTF-8 字节与空白分词，不是模型 tokenizer 的 token 数；文档为便于审阅而重复展示前后版本，不会一起注入模型。

| 表面 | 前字节 | 后字节 | 字节变化 | 前分词 | 后分词 |
| --- | --- | --- | --- | --- | --- |
| 公共 Charter 共用文本（含 section 标记） | 2581 | 2439 | -142 | 374 | 353 |
| Send help 整页（按需） | 3202 | 3124 | -78 | 409 | 405 |
| cli-operations 完整主文（按需） | 2653 | 2576 | -77 | 371 | 359 |
| Send reference 全文（按需） | 1731 | 1731 | +0 | 265 | 265 |
| 根 help（按需） | 464 | 376 | -88 | 48 | 37 |

常驻 Bootstrap 删除一个过时句子，不增加新指令；格式识别与旧文件兼容只由实现和测试处理，不进入新教学。Skill 不复制帮助正文，Send reference 不变。以上五组前后对照的 `ROVAI_RUN_TMP` 出现次数均为 0，既有头像 Skill 的目录建议不变。

## 来源快照

| 文件 | 基线 SHA-256 |
| --- | --- |
| [crates/rovai-core/resources/charter-rovai-cli.md](../../../crates/rovai-core/resources/charter-rovai-cli.md) | `6fc8b98edd8e1bdaf99cc85eceb5e30ff73b913a49c5ebd091412e2c56168bd0` |
| [crates/rovai-core/src/bin/rovai.rs](../../../crates/rovai-core/src/bin/rovai.rs) | `eb47a548a8ba15602d2096d53837ae21d2fc405e447ceae9affc5c3db1251659` |
| [crates/rovai-core/src/camp_message_send_teaching.rs](../../../crates/rovai-core/src/camp_message_send_teaching.rs) | `ad043af06d76d095d163d1544b372cbb7ca9f9e213c4db8e4a4e46745bc9007f` |
| [skills/cli-operations/SKILL.md](../../../skills/cli-operations/SKILL.md) | `58eb093bd43fffc383bb3b005d71d2df1294c94a5ff3d0fb7a5b4a79ccec9755` |
| [skills/cli-operations/references/send.md](../../../skills/cli-operations/references/send.md) | `db28fa639b4eb1b4d8008feb7645bf1198e6a2290030cb19950ce288123c3928` |
| [crates/rovai-core/src/context.rs](../../../crates/rovai-core/src/context.rs) | `422605947774deb5380cde820f3284cddd7829f01334f4f62c77732f4b533466` |
| [crates/rovai-core/src/context_contract.rs](../../../crates/rovai-core/src/context_contract.rs) | `55094c915b06a3742e48fbaaf93b7cd19391baf6cfec449594e3d8de676cd9b6` |
| [crates/rovai-core/src/team_tool.rs](../../../crates/rovai-core/src/team_tool.rs) | `401e46bb5c10ec91270da64eb1c4ff401ea36aefdaf35b78dfbac1239492bb4e` |
| [crates/rovai-core/src/builtin_tool_transport.rs](../../../crates/rovai-core/src/builtin_tool_transport.rs) | `90b3a9e979763bed71faa81a465d9705a24ab6f47c0de0a51c950a7747bf3cd4` |

## 文档交付验证记录

- 16 个完整 fenced block 核对通过：前文与源码/当前只读帮助一致；Bootstrap 只删除一句，Skill 删除旧步骤 2 并顺次编号，根 help 删除输入枚举，Send reference 保持原样；完整新 Send help 不含 JSON 格式或兼容教学，拟修改表面没有新增 TMP 目录教学。
- `pnpm docs:test`：10/10 通过。
- `DOCS_BASE_REF=70c9214bf47a677d018a7f2448583d6ec3422d22 node scripts/check-doc-decisions.mjs --require-base`：在仅含 Git 跟踪内容及本次两份文档的临时副本中通过，包含链接与通用治理校验。主工作区同项检查受已忽略的本机 `docs/prototypes` 旧原型失效链接影响；未修改这些原型或 checker。临时副本已清理。
- `pnpm docs:check` 与 `DOCS_BASE_REF=70c9214bf47a677d018a7f2448583d6ec3422d22 pnpm docs:check:ci`：确认门禁未通过，四项均属于本稿尚无真实实施确认：confirmation_status、confirmed_revision、confirmed_by、confirmed_at。保持 pending，不伪造确认。
- 本轮仅修改本文与当前版本入口，不修改产品源码、现行 Skill、Schema 或合同；未执行产品功能测试或真实 Runtime Gate。
