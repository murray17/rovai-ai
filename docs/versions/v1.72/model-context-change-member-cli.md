---
document_type: model-context-change
version: v1.72
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: local_user
confirmed_at: 2026-10-06
confirmation_message_id: d283c49e-6894-4274-a584-ce449b544d44
last_updated: 2026-10-07
---

# Member CLI 提示词与帮助前后对比 r1

本文 r1 已由 User 在完整对比方案交付后确认实施、创建 PR 并合入 main；确认不代表实现或验收已经完成。以下前后文本保持批准时原文。

## 基线与范围

| 项目 | 内容 |
| --- | --- |
| 源码基线 | `0baa74144ba52de257c98656e72b445c9bc43d4e`，已与 `origin/main` 核对 |
| 当前版本 | [版本索引](../README.md)中的 v1.72，不切换版本 |
| 分支 | `rovai/member-cli` |
| Worktree | `../rovai-ai-member-cli`（仓库同级独立 worktree） |
| Governance | User 已确认 r1；无治理文档必须先合入 main 的额外要求 |
| 工作状态 | active：已确认 r1，功能实施中 |
| 需求依据 | Thread 输入 `9917638a-cf75-4fbb-ada0-95e3bdd4e939` 的最小增量约束，及 `de3ec357-6d61-4adb-9902-b46ab6029eb6` 的完整前后对比要求 |

仅新增 `member list/get/update`；保留 `member create`。更新六个身份字段及同一个 `avatarRef` 的 source/portrait 与裁切 icon。
不加入 Runtime、模型、权限、Presence、排序、邀请、移除或全局发现能力；不新增独立授权、幂等存储、通用资产服务或跨文件系统事务框架。

提示词保持英文，面向 User 的回复继续使用 User 的语言。中文说明属于审阅文档，不投递给 Runtime。

| 入口 | 应承担的说明 | 本次增量 |
| --- | --- | --- |
| Bootstrap 的 `SESSION_CHARTER` | 命令发现与通用协作规则 | 只扩展现有 member 命令索引 |
| `cli-operations/SKILL.md` | 多步任务中选择和衔接操作 | 一行映射、一段成员流程；不复制 flags |
| CLI 根帮助 | 当前可执行命令清单 | 同样扩展 member 命令索引 |
| 精确命令 help | 使用条件、输入、清空、图片操作及失败后的下一步 | 新增 list/get/update 三份完整帮助 |
| `member-studio` | 创建前的提案与确认 | 保持原文；不承担已有 Profile 编辑 |

## 变更前

源码实际只有 `member.create`；新三个子命令的 `--help` 都返回 `builtin_tool.invalid_input`，退出码 2。
Bootstrap 与 CLI 根帮助列出 `member create`；`cli-operations` 没有成员资料操作的选择或衔接说明。

以下“变更前”由本基线源码及已安装 CLI 的只读 help 核对，不用旧版本设计稿代替现行原文。
Bootstrap 的公共区块从 `build_session_charter` 和 `charter-rovai-cli.md` 还原；包含现有的完整公共 Charter。

## 变更后

本节给出完整可替换文本。新 help 中的 flags 是本提案拟定的接口；确认后再落到封闭 Schema、catalog 和 CLI renderer。
不是通过提示词宣称现有命令已经具备能力。

### 1. Bootstrap：完整公共 SESSION_CHARTER

**变更前**

```text
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

- Use the local `rovai` CLI for the complete built-in operation catalog: `rovai send`; `rovai member create`; `rovai task create|get|list|update`; `rovai thread list|search|read|runs`; `rovai history search`; `rovai memory view|search|read|write`; and `rovai mission list|get|update|status`.
- Use `rovai --help` to choose an operation and its exact `--help` for syntax. Reuse help already available in the current Native Session.
- Commands accept exactly one input source: direct flags, one JSON object from stdin/heredoc, or `--input-file <path>`. Do not merge sources.
- `rovai send` always publishes one public Thread message. When the current responsibility has a Thread-visible answer, result, status, or summary, successfully call it before ending; Runtime narration and Runtime final responses are not Thread messages.
- Use `--public-only` when the message must not wake an Agent.
- Without `--public-only`, `--to` may schedule work. Agent addressing is not CC; use it only for a concrete new action or blocking question, never for acknowledgement, agreement, thanks, closure, standby, no-new-information, or repeated conclusions. Member calls do not require courtesy replies.
- Ordinary Thread messages are visible to the User. Use `--to-user` only for a new decision, answer or action needed from them, or an explicitly requested important-result notification.
- A successful `rovai send` proves only that its message and effects were committed; it does not prove that recipient work has started or completed.
[/SESSION_CHARTER]
```

**变更后**

```text
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
```


这里只有 `rovai member create` → `rovai member list|get|create|update` 一处替换。
不在 Bootstrap 增加 PATCH、头像裁切、授权例外、重试教程或内部存储说明。

### 2. cli-operations：SKILL.md 全文

**变更前**

```markdown
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
```

**变更后**

```markdown
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
```


保持原 description，避免扩大自动触发范围或变更冻结的平台 Skill 索引；已有“已知单操作直接看 help”规则足够。
新正文让跨操作任务发现 Member 路线。没有新增 reference 文件；现有 recovery reference 继续拥有通用恢复规则。
`agents/openai.yaml`、NOTICE、平台索引的名称、路径和 description 均保持。

### 3. CLI 根帮助：Agent 视图

**变更前**

```text
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
```

**变更后**

```text
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
```


不增加 `member --help` 家族入口、别名或新的工具发现机制。普通用户终端原有的 User Automation 尾段保持原文：

```text
User Automation:
  rovai app --help

Agent operations keep their process-private transport. `rovai app` uses the running Desktop App's separate User Automation transport.
```

### 4. member list --help

**变更前**

```text
{"error":{"code":"builtin_tool.invalid_input","message":"Command input does not match the accepted arguments.","recovery":"fix_input"}}
```

**变更后**

```text
rovai member list
List all current Thread members, including yourself and away members, with IDs, names, roles, responsibilities and Default Lead flags. Exclude departed or removed members. This does not discover the global roster.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.


Examples:
  rovai member list
```


“变更前”为执行 `rovai member list --help` 的完整 stdout，退出码 2；变更后退出码 0。
查询当前 Thread 的实时成员关系，包含自己、away；排除 left/removed。无分页、无全局 selector；成功返回完整当前成员集合。

### 5. member get --help

**变更前**

```text
{"error":{"code":"builtin_tool.invalid_input","message":"Command input does not match the accepted arguments.","recovery":"fix_input"}}
```

**变更后**

```text
rovai member get
Read a member's six identity fields, version and icon/portrait paths. The target must be a current Thread member or a member you created in this Thread, verified by Core. Image paths last only for this Run; null paths have a separate image status.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.

  --agent-id                   field=agentId type=string required

Examples:
  rovai member get --agent-id agent_27
```


“变更前”为执行 `rovai member get --help` 的完整 stdout，退出码 2；变更后退出码 0。
读取范围为当前成员，或同 Thread 中由调用 Agent 创建且 Core 可验证来源的队员。知道 ID、Lead 身份或旧工具结果不扩大范围。
Core 每次验证当前调用身份；创建来源只使用现有持久创建记录，后续 Run 可继续读取，不改写创建回执。

### 6. member update --help

**变更前**

```text
{"error":{"code":"builtin_tool.invalid_input","message":"Command input does not match the accepted arguments.","recovery":"fix_input"}}
```

**变更后**

```text
rovai member update
Patch a member's global Profile only at the User's explicit request in a direct user-triggered Run. Use the version from member get and send only intended changes. Omitted fields stay unchanged; text and image references commit together. Saving does not refresh an existing Session.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.

  --agent-id                   field=agentId type=string required
      A current Thread member, or a member you created in this Thread.
  --avatar-center-x            field=avatarCenterX type=number
      Supply center X, center Y and size together to crop the source. Centers: 0-1; size: 0.12-1; the crop must fit inside the source.
  --avatar-center-y            field=avatarCenterY type=number
  --avatar-file                field=avatarFile type=string
      Run-readable PNG/JPEG source. Replaces the portrait and generates its icon; omit the crop fields to use the default crop.
  --avatar-size                field=avatarSize type=number
      With all crop fields and no avatarFile, re-crop the existing source without replacing the portrait.
  --clear-avatar               field=clearAvatar type=boolean
      Clear both images. Cannot combine with avatarFile or any crop field.
  --display-name               field=displayName type=string
  --expected-version           field=expectedVersion type=integer required
      Use member get's version. On conflict, read again and decide whether a new update is needed.
  --growth-topic               field=growthTopic type=string
  --personality-traits         field=personalityTraits type=array repeatable
  --professional-responsibilities field=professionalResponsibilities type=string
  --request-id                 field=requestId type=string required
      Generate one lowercase UUID for this update. Reuse it only for an exact retry allowed by error.recovery; never change the patch under that ID.
  --team-role                  field=teamRole type=string
  --working-principles         field=workingPrinciples type=string

Provide at least one change. Clear optional text with ""; clear personalityTraits with [] in JSON. displayName cannot be empty.
If an image fails, fix the image; do not silently drop it and save only text. For multiline text, use a UTF-8 JSON file.

Examples:
  rovai member update --agent-id agent_27 --expected-version 3 --request-id 51d668e1-6dc7-4f39-80b2-0555f823715a --team-role 'Researcher'
  rovai member update --input-file member-update.json
```


“变更前”为执行 `rovai member update --help` 的完整 stdout，退出码 2；变更后退出码 0。
三个裁切字段复用 CLI 已有 number 解析，直接映射现有 crop 的 centerX/centerY/size；不添加通用 object 参数解析器。
crop size 以 source 的短边为基准。只裁切时 source 不变，保存新的复合资产引用；缺失或不可读 source 时拒绝。
上传 source 时 portrait 是规范化源图，icon 由源图裁切生成；本轮不承诺两张互不相关图片的独立上传。

`requestId` 是现有请求身份的显式传入，不是新增 `updateKey`：仅在新 update 入口使用相同值贯通 CLI 请求与领域命令身份。
现有 CLI 每次启动生成新 UUID，无法让另一个 CLI 进程持有原调用身份；这就是所需最小扩展的具体场景。
继续复用现有摘要冲突、持久 `command.result` 和 receipt，不建立第二份结果表、授权令牌或后台恢复机制。
当前租约和目标权限仍须验证；可回放不意味着旧调用身份可以绕过离队、removed 或失效租约。
`retry_same_request` 才表示获准按返回的界限重试；`confirm_outcome` 沿用 recovery reference，不能凭当前资料相同就声称某次命令成功。

### 7. member create --help：完整保留

**变更前**

```text
rovai member create
Create one durable Rovai member from the final member card only after the user explicitly confirms it in this direct user-triggered run. Reuse creationKey only for an exact retry. avatarFile is optional and must name a run-readable local PNG or JPEG; Rovai safely normalizes and imports it without persisting the path. If image preparation is unavailable or fails, retry without avatarFile to use the default avatar.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.

  --avatar-file                field=avatarFile type=string
      Optional run-readable PNG/JPEG path. If unavailable, omit it and Rovai uses the default avatar.
  --creation-key               field=creationKey type=string required
      Generate one new lowercase UUID after confirmation; reuse it only for an exact retry.
  --display-name               field=displayName type=string required
  --growth-topic               field=growthTopic type=string
  --personality-traits         field=personalityTraits type=array repeatable
  --professional-responsibilities field=professionalResponsibilities type=string
  --team-role                  field=teamRole type=string
  --working-principles         field=workingPrinciples type=string

Examples:
  rovai member create --creation-key 2b945f3f-4b45-4ae5-92b2-739fce600338 --display-name 'Nova' --team-role 'Researcher'
  rovai member create --input-file confirmed-member.json
```

**变更后**

```text
rovai member create
Create one durable Rovai member from the final member card only after the user explicitly confirms it in this direct user-triggered run. Reuse creationKey only for an exact retry. avatarFile is optional and must name a run-readable local PNG or JPEG; Rovai safely normalizes and imports it without persisting the path. If image preparation is unavailable or fails, retry without avatarFile to use the default avatar.

Input: direct flags, JSON stdin/heredoc, or --input-file <path>. Choose exactly one input source.

  --avatar-file                field=avatarFile type=string
      Optional run-readable PNG/JPEG path. If unavailable, omit it and Rovai uses the default avatar.
  --creation-key               field=creationKey type=string required
      Generate one new lowercase UUID after confirmation; reuse it only for an exact retry.
  --display-name               field=displayName type=string required
  --growth-topic               field=growthTopic type=string
  --personality-traits         field=personalityTraits type=array repeatable
  --professional-responsibilities field=professionalResponsibilities type=string
  --team-role                  field=teamRole type=string
  --working-principles         field=workingPrinciples type=string

Examples:
  rovai member create --creation-key 2b945f3f-4b45-4ae5-92b2-739fce600338 --display-name 'Nova' --team-role 'Researcher'
  rovai member create --input-file confirmed-member.json
```


这里特意保留原文，便于核对创建行为、creationKey 和默认头像回退没有被 update 的失败语义替换。
新 update 的图片失败不得静默删除图片字段再提交文字；create 的既有行为仍由其当前合同和用户已确认方案约束。

## 新命令的模型可见输入与输出

下列 shape 与上述 help 配套，均为封闭对象。未列出的字段拒绝；不用现有完整 `AgentProfileView` 直接透传。
这部分是实现合同草案，不追加到 Bootstrap 或 Skill；字段类型和错误描述通过精确 help／结构化结果传达。

### list

输入恰为 `{}`；不接受 Thread ID、筛选、limit 或 Runtime 参数。输出：

```typescript
type MemberListResult = {
  threadId: string
  items: {
    agentId: string
    displayName: string
    teamRole: string
    professionalResponsibilities: string
    isDefaultLead: boolean
  }[]
}
```

顺序沿用当前成员顺序；不新增排序配置。Lead 标识来自相同读取快照。

### get

```typescript
type MemberGetInput = { agentId: string }

type ImageStatus = "available" | "absent" | "unavailable"

type MemberGetResult = {
  agentId: string
  displayName: string
  teamRole: string
  professionalResponsibilities: string
  personalityTraits: string[]
  workingPrinciples: string
  growthTopic: string
  version: number
  images: {
    icon: string | null
    portrait: string | null
  }
  imageStatus: {
    icon: ImageStatus
    portrait: ImageStatus
  }
}
```

所有输出字段必有；`version` 是当前 Profile 的正整数版本。路径仅在对应 status 为 available 且物化成功时非 null。
absent 表示 Profile 没有该视觉资产；unavailable 表示资产存在引用但无法安全读取或物化。
读取失败不返回内部路径或底层异常，不返回占位路径，不把不存在与越权区分成可用于全局探测的信息。
半身照和头像复用同一版本的 `avatarRef` 快照，分别表示可用性；资料可成功读取而某个图像 variant 不可用。

内置及 managed 资产都经受控解析后物化到当前 Run 的 exact tmp root。输出是目标 Runtime 可访问的文件路径，无 base64 和永久私有存储位置。
后续 Run 重新 get；历史工具结果或冻结 Evidence 不承诺文件仍存在。当前身份重新授权后才可物化，不把旧回放结果中的路径直接当作可读文件。

### update

```typescript
type MemberUpdateInput = {
  requestId: string
  agentId: string
  expectedVersion: number
  displayName?: string
  teamRole?: string
  professionalResponsibilities?: string
  personalityTraits?: string[]
  workingPrinciples?: string
  growthTopic?: string
  avatarFile?: string
  avatarCenterX?: number
  avatarCenterY?: number
  avatarSize?: number
  clearAvatar?: boolean
}

type MemberUpdateResult = {
  agentId: string
  version: number
  changed: boolean
}
```

- requestId 为 canonical lowercase UUID，expectedVersion 为正整数；ID 只定位，不授权。
- 六个身份字段沿用现有规范化、长度及名称唯一性检查。省略不赋默认值；字符串字段不接受 null；可清空字段用空字符串，traits 用空数组；displayName 不得清空。
- 三个裁切字段全部提供或全部省略；归一化坐标和裁切范围复用当前头像校验。clearAvatar 缺省/false 不清空；true 与文件或任何裁切字段互斥。
- 至少有一个字段修改请求；仅 ID/version 或 clearAvatar:false 不算 PATCH。值与当前相同可返回 changed:false，不递增版本或重复发失效通知。
- 授权复用当前 active Run/lease、目标范围和 direct User-triggered 门槛。User 的具体修改意图由 Agent 遵守；Core 不从自然语言猜批准、不新增审批凭据。授权失败时不得导入图片。
- Core 先完成图片准备，再在同一 Profile 事务内重验版本、授权所需实时状态、合并身份、校验并提交引用。图片失败、冲突或领域校验失败均不产生部分 Profile 更新。
- 幂等按请求身份及现有规范化语义摘要判断。相同已提交命令返回原结果；不同语义冲突。冲突重读后若决定更改，是新请求；结果未知不得盲目换 ID 重试。图片输入路径不是持久领域数据。
- 成功结果只说明全局 Profile 已保存。首次实际提交触发既有 members.invalidated；不改历史消息、创建回执、已冻结 Run 或 Native Session。

下面是同时修改一个文字字段和整套视觉资产的完整 JSON 文件示例；数字版本和图片路径仅为示例，实际调用使用 get 及真实文件：

```json
{
  "requestId": "51d668e1-6dc7-4f39-80b2-0555f823715a",
  "agentId": "agent_27",
  "expectedVersion": 3,
  "teamRole": "Researcher",
  "avatarFile": "/current-run/portrait.png"
}
```

```bash
rovai member update --input-file member-update.json
```

清空使用同一输入 shape 中的 `teamRole: ""`、`personalityTraits: []` 或 `clearAvatar: true`；每个新的修改意图生成新的 requestId。
不把这些字段追加在 `--input-file` 后面，仍只能使用一个输入来源。

## 明确不变

- Bootstrap 的 section 名称、顺序、MEMBER_IDENTITY、Memory Entrypoint、平台 Skill 索引 shape 与选择/预算不变；只替换公共 Charter 的 member 索引。
- Dynamic Context、RUN_INPUT、COLLABORATION_STATE、Run facts、ContextManifest 字段与选择、accepted 水位和冻结投递不变。新增 get 是显式工具读取，不把所有 peers 完整人格注入上下文。
- `member-studio/SKILL.md`、身份与头像 references 及 metadata 全部不变；不安装 hooks，不改变创建确认要求。
- 既有 CLI 操作、别名、单输入来源规则、JSON stdout／错误 envelope 和退出码不变。Root 与 Bootstrap 现有其他命令清单差异不在本轮顺带调整。
- Single Chat 独立 Charter 和封闭 operation policy 不变；本轮不把 Member 管理加入 Single Chat allowlist。
- User Automation、Renderer 的编辑交互、Runtime 配置和权限体系不变。
- 不新增数据库字段或表，不迁移 Profile、创建回执或历史结果，不增加跨文件系统事务框架。

公共 Charter 的以下条件追加文本逐字保持。它们不进入上文无条件公共文本的差异：

| 条件 | 保持位置与规则 |
| --- | --- |
| Codex | 公共 Charter 末尾现有一句完整 Final 交付要求 |
| 外部渠道绑定 | 现有显式文件交付说明 |
| 当前 Thread 有 Mission | 现有 Mission Contract 尾段 |
| Single Chat | 使用其独立模板，完全不套用上文公共 Charter |

```text
- When publishing the Thread-visible final answer with `rovai send`, use the complete final response in polished Markdown; do not send a compressed one-line summary and then write a richer Runtime final.

- This Thread is connected to an external channel. Local file paths and Runtime image previews are not delivered there; when the recipient needs the file itself, include `--file <path>` in the corresponding `rovai send` message.

Rovai Mission Contract

- All current members may use `rovai mission get|update|status` to maintain this Thread's Mission.
- Use `rovai mission get` when the current Mission's full definition is missing or outdated; judge completion against that definition.
- The Mission working directory is already prepared. Continue follow-up work there on its current checkout by default. Do not create or switch branches, or create another Worktree, merely because a new Run starts, context is compacted, or more changes are requested. Follow explicit user requests for a different branch or baseline.
- Change status only when the whole Mission's state changes, not merely when your Run ends.
```

## 版本、发布与恢复

| 轴 | 当前基线 | 拟实施 |
| --- | --- | --- |
| Session Charter revision | 19 | 20 |
| Bootstrap contract / formatter | native_session_bootstrap_v5 / 5 | 保持 |
| Native Binding 兼容 tuple | v4 / 4 / 16 / 26 / 26 | 保持 |
| 普通 Run formatter / manifest | 28 / 28 | 保持 |
| Public batch formatter / manifest | 32 / 32 | 保持 |
| Built-in Contract / CLI | 35 / 35 | 36 / 36 |
| Agent Output contract | 8 | 9，新增三个 operation 的封闭结果 |
| Runtime capability | builtin_cli.transport.v35 | builtin_cli.transport.v36 |
| CLI operation 数 | 27 | 30 |
| IPC / Envelope / receipt / Evidence projection | 2 / 1 / 1 / 4 | 保持 |
| Antigravity Native Binding tool compatibility | 32 及现有固定 digest | 保持 |
| 数据库 schema / Migration | 当前值 | 保持，无新增持久字段 |

数字以本稿基线为准；若并行工作占用后继版本，实施前更新提案记录，不静默复用冲突版本。
确认后同步 [Built-in 合同](../../contracts/builtin-tool-transport-v35.md)、[工具运行架构](../../architecture/builtin-tool-runtime.md)
及当前版本概览/计划；本次提案不提前把新能力写成现行合同。

已有 Native Session 沿用其冻结 Bootstrap 和原生连续性；resume 或 redelivery 仍用该 Session 的旧文本，不强制旋转 Binding。
新 Binding 生成新的公共 Charter。旧 Session 通过 live root help 和新 operation help 可发现新命令，旧 create 命令继续有效。
Core 既有 ManagedSkills 同步机制沿相同路径更新 Skill 正文；已经进入对话历史的旧正文不改写，不发送额外刷新消息。
description 不变，冻结的 Skill 索引仍准确指向同一文件；不为该功能建立新的同步或补投机制。

## 二次确认

本稿 revision 为 1，confirmation_status 为 confirmed。User `local_user` 于 2026-10-06 在完整 r1 交付后明确要求“执行完pr到main merge”（Thread 消息 `d283c49e-6894-4274-a584-ce449b544d44`），据此记录本次实施及 PR 合并授权。

[核心模型上下文变更治理](../../development/model-context-change-governance.md)要求：

> 二次确认必须发生在开发者已经看过完整变更说明之后，并且明确同意实施该 revision。

同一规则允许调查和编辑提案，但确认前不得修改实现、Schema、当前合同或执行 clean break。
本轮只提交本文；批准后实施上述精确文本、最小身份传递和已确认功能，语义变动须升 revision。

## 验证

### 本提案的验证

- 逐段比对 Bootstrap 与 cli-operations 的“变更前”源文件；根 help 与 create help 对照当前只读输出；新三个 help 的旧状态实际为错误及退出码 2。
- 检查 Bootstrap 只有一处替换，Skill 只新增目标映射和 Member operations 段，create help 前后相同；统计新增正文大小，不将 Markdown 文档体积当作 Runtime 提示词开销。
- 运行 `pnpm docs:test`、`pnpm docs:check`、`DOCS_BASE_REF=0baa74144ba52de257c98656e72b445c9bc43d4e pnpm docs:check:ci`。
  待确认文档应被确认门禁阻止进入实施；不把 pending 改成 confirmed 来取得绿灯，也不加 checker 例外。

### 实施后的确定性验证

复用既有测试 owner，通过公开操作验证行为，不创建只匹配措辞的重复测试。Rust 测试增补遵循
[测试准入与退役规则](../../development/testing.md#rust-测试准入与退役门槛)。

| 范围 | 关键验证 |
| --- | --- |
| 入口与帮助 | 三个命令可发现；直传、stdin 和 input-file 行为一致；未知字段/混合来源拒绝；create 兼容 |
| 授权与范围 | self/away 可列；left/removed 排除；知道 ID、Lead、跨 Thread 创建记录和旧租约不能越权；同 Thread 原创建者后续 Run 可 get/update |
| PATCH | 单字段不覆盖；显式清空；不可清空名称；空 PATCH；no-op；版本冲突；文字与图片引用只有一次提交 |
| 图片 | 内置及 managed 双图可读；源图更新及仅裁切；坏图、缺失源图、裁切越界、无 tmp 权限不部分保存 |
| 幂等与恢复 | 同 requestId 精确重放；异义冲突；提交后响应丢失、重新 CLI 调用；不重复递增版本、通知或创建记录 |
| 临时结果 | 当前 Runtime 实际可读，后续 lease 清理，get 重取；旧结果不返回已不存在的路径 |
| 输出与上下文 | 封闭字段无 Runtime/权限/Presence/永久目录/base64；Profile 保存不热改 Session、历史或创建回执 |
| 兼容投递 | 新 Binding 取新 Charter；旧 Session resume/redelivery 原文不变；旧索引读取同路径新 Skill；Single Chat policy 不扩权 |

执行 `pnpm skills:check`、`pnpm skills:test` 和文档门禁；按 Rust owner 的实际 feature 列出并运行目标测试。
实现前读取 [本地隔离流程](../../development/local-workflow.md)，所有 Core/Runtime 验收使用独立 data-dir、Skill Library 与 tmp，不触及日常实例。

### 真实任务 Gate

本次触及 Bootstrap 与核心 Skill，按 [双轨评测](../../development/evaluation.md#上下文改动-gate)使用现有通用集：
Suite 2.12.0 的 DEMO-101–112，scoring-v2.10，每例 baseline/candidate 各一次；同环境、同队员/Runtime/model/权限，
不改变现有 Case、评分或关键协作门槛。每 campaign 14,400 秒、Case 并行 2、Judge 2,400 秒，最多两次；保留失败与 unknown。
通过标准沿用冻结 POLICY 的硬失败、质量、协作、资源和证据完备要求，不能以静态检查替代模型行为证据。

实际 Runtime/model、三位队员及 Judge 配置在执行前写入现有 freeze plan；当前没有运行真实模型 Gate，也没有沿用其他任务的豁免。
本轮交付的是文本提案，不启动真实 Runtime 或新增评测基础设施。Member 的特有边界由上述确定性 owner 覆盖；通用集不冒充这些边界的专属验收。

## 文本开销

以下为 UTF-8 字节和空白分词数，不冒充具体模型的 tokenizer 计数。统计完整正文；只有实际加载的 help／Skill 才消耗对应上下文。

| 表面 | 变更前字节 | 变更后字节 | 增量 |
| --- | --- | --- | --- |
| 公共 SESSION_CHARTER 内容 | 2527 | 2543 | +16 |
| cli-operations 完整文件 | 2194 | 2652 | +458 |
| Agent 根帮助 | 447 | 463 | +16 |
| member list help | 无 | 362 | 按需读取 |
| member get help | 无 | 480 | 按需读取 |
| member update help | 无 | 2540 | 按需读取 |

新 Skill 段只有 59 个空白分词（含标题）。
update help 的参数列表和例子留在单操作入口；不把数据库、asset manifest 或版本迁移说明写进运行提示词。

## 2026-10-06 提案验证记录

- 21 个 fenced code block 检查通过：现有 Skill、Bootstrap 公共资源、根帮助和 create 帮助与来源一致；create 前后逐字相同；update 的 14 个字段均使用现有 CLI 支持的值类型。
- `git diff --cached --check` 通过；本轮只新增本文，没有修改源码、现行 Skill、Schema 或合同。
- `pnpm docs:test`：10/10 通过。
- `DOCS_BASE_REF=0baa74144ba52de257c98656e72b445c9bc43d4e node scripts/check-doc-decisions.mjs --require-base`：通过，包含文档链接和 diff-aware 治理检查。
- `pnpm docs:check` 与 `DOCS_BASE_REF=0baa74144ba52de257c98656e72b445c9bc43d4e pnpm docs:check:ci`：未通过，原因仅为本文仍是 pending、缺少真实的 confirmed_revision/confirmed_by/confirmed_at。保持待确认状态，未绕过门禁。
- 本轮未执行产品代码测试或真实任务 Gate；这份文本对比不是功能已实现或模型效果已验证的证据。

## 2026-10-06 实施与验收记录

本节记录后续实施事实，不改动上面的 r1 前后文本。User 确认消息为
`d283c49e-6894-4274-a584-ce449b544d44`；实施分支 `rovai/member-cli`，最终集成基线为
`5421fed778fcdd62f3b2c0e7f517a6e3e2b86c51`。同步 main 时仅版本概览出现文本冲突，已保留两项并行工作的记录。

- 版本轴按 r1 落地：CLI/Transport 36、Agent Output 9、Charter 20、30 项操作；其他上下文与 Session 兼容轴不变。
- 仅新增 list/get/update。六个身份字段由 Core 在版本检查下合并；文字与同一复合资产引用原子提交。
  未新增数据库表、持久字段、授权系统、幂等键库或通用资产服务。
- 完整读取使用封闭投影并重新授权；图片物化到既有 Run tmp，租约轮换负责清理。
  现有创建回执支持同 Thread 原创建者在后续 Run 读取、编辑尚未加入 Thread 的成员。
- 上传复用现有请求绑定资产和领域回执。源文件消失后仍可匹配持久回执；源文件存在时核验规范化内容，
  已提交请求不得重新发布缺失的资产 ID。等价 source/crop/icon 保留原引用，不增加 Profile 版本。
- 内置半身图原先仅以 renderer AVIF 存在，无法进入 Core 的既有 PNG/JPEG 读取与裁切流程；
  本次增加四张同源 PNG 编译资源，没有增加运行期解码依赖。

以最终集成基线运行的确定性验证：

| 验证 | 结果 |
| --- | --- |
| `cargo fmt --all --check`、`git diff --check` | 通过 |
| `pnpm test:rust:pr` | 454 项通过；1 项原有真实 Runtime smoke 保持忽略 |
| `extended-tests` 的 `member_` owner | 18 项通过；覆盖权限、创建后编辑、PATCH/版本/原子性、图片及回放 |
| `extended-tests` 的 `builtin_tool_runtime::tests::` | 2 项通过；覆盖 Run tmp 轮换清理、重取与锁边界 |
| `slow-tests` 的 Bootstrap/冻结补发/新 Session owner | 4 项通过；既有冻结内容与兼容轴保持 |
| 实际构建的 `rovai` 与 r1 文本对照 | 根帮助及 list/get/create/update 帮助逐字一致；Bootstrap 资源和 cli-operations 正文与批准稿一致 |
| 实际 CLI stdin / `--input-file` | 对同一含禁止字段的输入返回相同退出码 2 和封闭错误；使用独立 tmp 与不存在的 Core context，无日常实例调用 |
| `pnpm docs:test`、`pnpm skills:test`、`pnpm skills:check` | 10 项文档测试、3 项 Skill 测试与 12 项 Skill 校验通过 |
| `pnpm docs:check`、`pnpm docs:check:ci` | 通过；diff-aware 基线为本节列出的最终集成基线 |

真实模型 Gate 尚未执行。该 Gate 需要实际三位队员的 Runtime/model 和固定快照 Judge 配置，
不能使用其他工作项的豁免，也不能以以上确定性检查或以下代码复核替代。

### Standards

此前标准问题已闭合，未发现新增可确认缺陷。已提交上传只验证既有资产；等价图片保留当前引用。
新增断言覆盖重复上传不增版本及缺失资产不得重绑。默认裁切重复已消除，未发现值得单列的新气味。
收口缺口为真实模型 Gate；当前记录没有声明其通过。

### Spec

两项 P2 已闭合，未发现相关新错误：等价 source/crop/icon 保留当前引用；已有回执时缺失或损坏资产
直接拒绝，不重新发布 UUID。既有 Member owner 覆盖这些边界，授权仍先于图片操作，事务内重验权限和版本。
本次代码复核不代表真实模型 Gate 通过。

复核汇总：Standards 未关闭代码问题 0 项、另有 Gate 证据缺口 1 项；Spec 未关闭代码问题 0 项，Gate 仍待验收。

### User 追加复核：无 Lead 与相对图片路径

User 在消息 `8472d677-5582-4a97-b941-7aef594d043c` 指出 `c069b3f5` 的两项 P2，均复现：

- 原 SQL 在 Lead 为 null 时返回 null，既有 Member owner 加入该分支后报 `Invalid column type Null`。
  查询改用 `COALESCE(...,0)`，名单、顺序保持，所有 Lead 标记为 false；读取后 Lead 仍为 null。
- 原 CLI 把相对 `avatarFile` 原样发给 Core。隔离的调用者与接收端使用不同 cwd，各有不同内容的同名 PNG；
  修复前实际 CLI 的直接参数、JSON 文件、stdin 三路均传相对路径，接收端均读到自己目录的图片。
  现于三路共用的 CLI 输入出口转为调用者 cwd 下的绝对路径，在 IPC 与请求 digest 前固定。
  不做 canonicalize 或提前检查存在性，保留源文件清理后的回放；create 与批准的提示词文本不变。

沿用两个已有 Rust owner 补断言，未新增持久字段、授权／资产机制或测试 owner。
双进程验证使用隔离 IPC 接收夹具，没有启动真实 Core/Runtime，也不替代真实模型 Gate。
本次修复的最终回归结果记录在[实施计划](implementation-plan.md#member-cli-最小增量)。

### 2026-10-07：create/update 统一 AgentRun 文件语义

User 在消息 `21d8d8c4-2789-4b96-9f84-a34c98639337` 要求撤销上述 CLI cwd 转换，
create/update 都使用普通 Agent 文件的 Run-relative 语义；这取代上一阶段的调用者 cwd 方案。
CLI 保留原始 `avatarFile`，Core 认证 Run 后复用 `agent_file_ingress_scope` 读取冻结 workspace，
相对路径由 `resolve_agent_local_path` 与 `execution_root` 拼接，绝对路径原样保留。
附件入口共用该小 helper；头像只做即时导入，不生成附件 ID／记录，也不新增持久字段或机制。

原 CLI、创建、PATCH 与附件 owner 补充边界，覆盖原始路径保留、冻结 Run 根目录优先、
同名异图、失效 epoch／缺失 workspace、缺失源回放、绝对路径及 symlink 拒绝。
规范化不做 canonicalize 或提前存在性检查；安全检查继续由头像 importer 执行。
本次不改输入／结果字段或已批准的 Bootstrap、Skill、CLI help 文本，真实模型 Gate 仍待验收。
修复后的验证结果记录在[实施计划](implementation-plan.md#member-cli-最小增量)。

### 2026-10-07：后续 PR 与合并指令

在已明确告知真实模型 Gate 未执行、PR／合并尚未完成后，User `local_user` 在 Thread 消息
`10a0a3f7-2d2b-478f-bb99-6726b07d37cb` 再次指示“pr main merge”。按这次后续指令推进本项
PR 和 main 合并，并在 PR 中保留真实模型验证未运行的事实；不记为 Gate 通过，不继承其他工作的豁免。
已批准的 r1 提示词文本与二次确认保持不变。合入当前主线 `520320a8` 后继续执行本地回归、
独立代码复核及远端 CI，结果写入实施计划。

最终独立复核以 `520320a8...33547860` 为固定比较：Standards 代码检查与 Spec 均通过。
Standards 发现的当前文档版本漂移已补正并复核关闭（入口统一 Transport v36，Charter revision 20），
最终两轴未关闭问题均为 0。复核不等同于真实模型 Gate 通过。
