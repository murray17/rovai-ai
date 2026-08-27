---
document_type: model-context-change
version: v1.30
change_id: feishu-external-principal-and-quote
revision: 1
confirmed_revision: 1
confirmation_status: confirmed
confirmed_by: murray.xue
confirmed_at: 2026-08-27
authority: confirmed-model-input-change-statement
implementation_baseline: f588c773c2652a9e78887a31d17de8ed37524bb0
implementation_status: implemented
acceptance_status: verified
last_updated: 2026-08-27
---

# v1.30 核心模型上下文变更说明：飞书 ExternalPrincipal 与 ExternalQuote

本文把开发者在本次任务中提供并确认的飞书补充方案 revision 1 固化为仓库版本说明。确认内容是：飞书消息
作者只作为 ExternalPrincipal 来源，任意飞书 reply 作为当前唯一触发 CampMessage 的 Structured Content
`ExternalQuote`，并通过标准 Context projector 进入 `CURRENT_INPUT`；不建立内部 reply 或 prompt override。

## 变更前

### 1. 版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              3
Session Charter revision:         2
AgentRun Context Formatter:       21
ContextManifest Evidence:         21
Context Delivery Profile:         4
Run Facts:                        2
Message Projection Audience:      agent_v1
```

### 2. Direct Current Input

直接 Run 的触发 CampMessage 只接受 `authorType = user`。完整 source shape 为：

```json
{"type":"user"}
```

Direct `CURRENT_INPUT` 的完整 top-level shape 为：

```json
{
  "source": {"type":"user"},
  "message": "<agent_v1 projected body>",
  "mentionsCurrentUser": false
}
```

`message` 来自触发 CampMessage 的标准 body/Structured Content projection。Structured Content 的 closed union 为：

```ts
type StructuredCampMessageSegment =
  | { kind: 'text'; text: string }
  | { kind: 'member_mention'; agentId: string }
  | { kind: 'all_members_mention' }
  | { kind: 'current_user_mention'; userId: 'local_user' }
  | { kind: 'skill_mention'; skillId: string; nameAtSend: string }
```

`CampMessage.authorType` 的 closed set 为 `user | agent | system`。没有 ExternalPrincipal author，也没有外部引用
segment。Rovai 本地 reply 仍通过 `replyToCampMessageId` 和 reference closure 进入上下文。

### 3. 既有完整 Dynamic Context

Section order 为：

```text
[COLLABORATION_STATE]? -> [SELF_ACTIVE_TASKS]? -> [SHARED_CONVERSATION]?
-> [RUN_FACTS] -> [A2A_GUIDANCE]? -> [CURRENT_INPUT]
```

Profile 4 选择最近 15 条 eligible public message，排除当前触发与当前 Agent 自身消息，再执行既有 body/总预算、
reference closure、omission evidence、Skill link 和 attachment projection。A2A source 是完整
`member_call` shape；Gather Completion 是 schema 3 typed payload。上述完整结构由共享
`agent-run-context-v21` fixture 与 Manifest 21/Formatter 21 pairing 证明。

## 变更后

### 1. 新版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter:              3 (unchanged)
Session Charter revision:         2 (unchanged)
AgentRun Context Formatter:       22
ContextManifest Evidence:         22
Context Delivery Profile:         4 (unchanged)
Run Facts:                        2 (unchanged)
Message Projection Audience:      agent_v1 (unchanged)
```

### 2. ExternalPrincipal source

Direct Run 增加 `authorType = external_principal`。其完整 source shape 为：

```json
{
  "type": "external_principal",
  "provider": "feishu",
  "displayName": "Alice"
}
```

完整 direct `CURRENT_INPUT` shape 仍为：

```json
{
  "source": {
    "type": "external_principal",
    "provider": "feishu",
    "displayName": "Alice"
  },
  "message": "<complete agent_v1 projected trigger CampMessage>",
  "mentionsCurrentUser": false
}
```

`source` closed set 只新增上述 variant。ExternalPrincipal ID、open/user/union ID、tenant、App、chat/topic、external
message ID、本机路径和任何授权字段都不进入模型输入。

### 3. ExternalQuote segment

Structured Content union 新增：

```ts
type ExternalQuote = {
  kind: 'external_quote'
  senderDisplayName: string
  body: string
  attachmentSummaries: Array<{
    name: string
    mediaType: string | null
  }>
  contentDigest: `sha256:${string}`
}
```

约束为：sender 显示名非空、trimmed、最多 120 Unicode scalar 且无 control char；body 最多 8,000 scalar；
attachments 最多 20，每个 name 最多 256 scalar，media type 最多 128 bytes；content digest 是 canonical quote
内容的 prefixed SHA-256。

Agent-facing exact projection：

```text
引用 <senderDisplayName>：
> <body line 1>
> <body line 2>
> [附件] <name> (<mediaType>)
```

空 body 精确投影 `> （无文本）`；media type 为空时不输出括号。ExternalQuote、结构化 Agent mention 和当前文本按
segment 顺序组成当前唯一触发 CampMessage；最终完整字符串进入 `CURRENT_INPUT.message`。

例如：

```json
[
  {
    "kind":"external_quote",
    "senderDisplayName":"Bob",
    "body":"新版接口字段变了",
    "attachmentSummaries":[],
    "contentDigest":"sha256:<canonical digest>"
  },
  {"kind":"member_mention","agentId":"agent_1"},
  {"kind":"text","text":" 检查一下影响"}
]
```

投影为：

```text
引用 Bob：
> 新版接口字段变了

@<agent_1 current display name> 检查一下影响
```

Segment 不自动插入额外分隔字节；Core 构造的显式 `"\n\n"` Text segment 分隔引用与当前消息。`ExternalQuote`
是 channel-owned segment，Composer/user-authored content validation 必须拒绝伪造。被引用飞书消息不单独成为
CampMessage，飞书触发 CampMessage 的 `replyToCampMessageId` 固定为空。因此 reference closure 不重复该引用。

### 4. Manifest evidence

Manifest 22 继续冻结 source CampMessage content digest、agent_v1 projected body digest、mentions-current-user、
exact Dynamic Context bytes digest、Profile/section/omission evidence、attachment receipt 与 Runtime delivery bytes。
新增 source variant 不新增 Manifest 字段；其效果已由 exact projected/current-input bytes 覆盖。

Closed pairing 增加：

```text
ContextManifest 22 + Formatter 22 + Run Facts 2 + View Receipt 2
```

Migration 113 保留历史 pairing 19/20、20/21、21/21，只把新 write trigger 切到 22。

## 明确不变

- SESSION_CHARTER、MEMBER_IDENTITY、MEMORY_ENTRYPOINT 的文本、字段、顺序和 Bootstrap bytes；
- Dynamic Context section order、optional section 条件、Profile 4 数量/字符预算、recent-self exclusion、reference
  closure、omission evidence 和 accepted watermark；
- local user、A2A member call、Gather Completion 3 的 source/payload shape；
- Collaboration State 2、Self-active Tasks、Run Facts 2、Skill links、Camp Attachment View Receipt 2 与 Runtime Auth
  Receipt 1；
- 当前用户 mention 的 `@Principal` agent projection、A2A/History/Gather 的 `agent_v1` audience；
- Rovai 本地 UI reply 的 `replyToCampMessageId` 和 reference closure；
- Runtime Adapter transport、Bootstrap Redelivery、accepted ACK、权限、MCP、Memory、Task 和 publication fence。

飞书 Host 只提交 Structured Content，不生成 `rendered_message_override`、`current_input_override`、quote prompt
字段或 Runtime prompt；external message ID 只属于有 TTL 的 transport aggregation。

## 二次确认

当前状态：`confirmed`。开发者先提供两份字段级补充，明确 ExternalQuote 的 Segment 结构、CURRENT_INPUT 标准
链路、`replyTo=null`、删除 external-message projection 与无 prompt override；随后在本次任务中明确接受这些
结论并要求开始完整实现。确认记录：

```yaml
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray.xue
confirmed_at: 2026-08-27
```

任何加入原始飞书 ID、独立 quote prompt field、内部 reply resolution、Host-rendered Runtime override、不同
ExternalQuote 投影文本或改变 Profile/预算/section order 的方案都必须递增 revision 并重新确认。

## 验证

- shared fixture 同时冻结 Formatter/Manifest 22、全部不变轴与 ExternalPrincipal source shape；
- direct local user、A2A、Gather Completion fixture 保持原 shape；
- ExternalPrincipal direct Run 必须拥有可解析 display name/provider，缺失时 preparation fail closed；
- ExternalQuote round-trip、canonical digest、上下限、空正文、附件摘要和 agent-facing exact bytes；
- 飞书 reply 的 trigger CampMessage `replyToMessageId = null`，且引用只出现于 Structured Content/投影正文；
- ContextManifest 保存 source/projected/exact payload digest，Runtime Input Delivery bytes 与 prepared payload一致；
- negative：Host override、ExternalPrincipal raw identity、external message ID、被引消息单独 CampMessage、历史 reply
  projection 和 Formatter 21 new write 均不存在；
- Migration 113 从 v1.25/schema 66 保留历史 Manifest/消息并安装 22/22 pairing 与 schema 67；Migration 114
  只增加 Feishu Developer Identity/publication intent 并推进到 v1.27/schema 68，不改变或重写 Context pairing。
