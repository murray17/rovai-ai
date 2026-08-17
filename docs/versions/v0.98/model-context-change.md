---
document_type: model-context-change
version: v0.98
change_id: structured-current-input-skill-links
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray17
confirmed_at: 2026-08-17
authority: confirmed-model-input-change-statement
implementation_baseline: 595c234319472efcf63e02eac16d26effae83673
last_updated: 2026-08-17
---

# v0.98 核心模型上下文变更说明：结构化 Skill 文件链接

本文是实施前的精确变更说明。审阅基线是
`main@595c234319472efcf63e02eac16d26effae83673`，当时唯一 current 版本为 v0.97。

只允许实施本文 revision 1。任何改变模型可见 shape、发送/省略条件、Evidence、clean break 或版本轴的
语义调整，都必须先递增 revision，并重新取得开发者确认。

开发者已在完整审阅 revision 1 后明确确认。该确认发生在实现、Schema、当前 Contract、当前 ADR 和版本
指针变更之前；本文以相同前后合同进入新的 current v0.98。

## 变更前

### Structured CampMessage Content

`StructuredCampMessageSegment` 是 closed tagged union，当前只有以下四种形状：

```json
{ "kind": "text", "text": "普通文本" }
{ "kind": "member_mention", "agentId": "agent-123" }
{ "kind": "all_members_mention" }
{ "kind": "current_user_mention", "userId": "local_user" }
```

Skill Picker 选择 `review-pr` 时，Renderer 只插入普通 Text：

```json
[{ "kind": "text", "text": "/review-pr " }]
```

因此 Picker 选择、手工输入和粘贴的 `/review-pr` 在 Core 中没有身份差异。CampMessage 正文投影只处理 Text
和三类 Mention；Skill Library 状态、Skill ID、Revision、Assignment 与投影路径不参与消息正文。

### 用户 CampMessage 的 `CURRENT_INPUT`

没有附件时，Direct 用户输入的精确对象 shape 为：

```json
{
  "source": { "type": "user" },
  "message": "/review-pr 123",
  "mentionsCurrentUser": false
}
```

存在附件时，Core 在同一对象末尾增加 `attachments`：

```json
{
  "source": { "type": "user" },
  "message": "/review-pr 123",
  "mentionsCurrentUser": false,
  "attachments": [
    "/repo/.rovai/camp-attachments/spec.pdf"
  ]
}
```

对象由 AgentRun Context Formatter v17 序列化，并作为 Dynamic Context 的最后一节：

```text
[CURRENT_INPUT]
{"attachments":["/repo/.rovai/camp-attachments/spec.pdf"],"mentionsCurrentUser":false,"message":"/review-pr 123","source":{"type":"user"}}
[/CURRENT_INPUT]
```

Pretty JSON 只表达对象 shape；Formatter v17 的紧凑 JSON 使用现有 `serde_json::Map` canonical bytewise key
顺序，因此上面的 `attachments -> mentionsCurrentUser -> message -> source` 才是当前 exact bytes。

`CURRENT_INPUT` 不含 `skills`。手写 Slash 文本不会触发 Skill 路径发现，Runtime Adapter 也没有独立的
Provider Skill input item。

### 其他 `CURRENT_INPUT` 变体

现有 A2A CampMessage、ConversationMessage member call 和 Gather Completion 使用各自现有 source/payload
shape。它们不从文本解析 Skill，也不提供 Skill 文件路径。本次变更前后都不改变这些输入的字段、选择或
语义。

### Skill Projection 与 Evidence

每个新 Run 在 Runtime launch 前执行 root-scoped `prepare_run_exposure()`：

```text
Skill Library desired state
  -> execution-root reconciliation
  -> Revision/content digest/ownership verification
  -> SkillExposureSnapshot v2
```

`SkillExposureSnapshot.skills[]` 冻结 `skillId`、name、revisionId、contentDigest、groupKey、可选
deliveredViaGroupKey、status、可选 entryPath/reasonCode 和 conflictStatuses。任意 entry 为 `error` 或
`stale` 时，现有 preflight fail closed，Runtime 不启动。

ContextManifest Evidence v15 保存完整 Exposure 与 digest，但没有用户选择快照，也没有
`CURRENT_INPUT.skills` 的解析证据。最终 rendered payload blob/digest 证明 Formatter v17 的完整 Dynamic
Context 字节。

### 当前版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              v3
AgentRun Context Formatter:       v17
ContextManifest Evidence:         v15
Context Delivery Profile:         v3
Data Contract:                    v0.96
Projection Schema:                45
latest Schema Migration:          90
```

## 变更后

### Structured Skill identity

在 closed `StructuredCampMessageSegment` union 中增加且只增加以下 variant：

```json
{
  "kind": "skill_mention",
  "skillId": "skill-123",
  "nameAtSend": "review-pr"
}
```

字段规则：

- `skillId` 必须非空、没有首尾空白，UTF-8 byte length 不超过 256；
- `nameAtSend` 必须满足当前 Skill canonical name 规则：1 至 64 bytes，只含小写 ASCII 字母、数字和单个
  `-`，不能以 `-` 开头或结尾，也不能包含连续 `--`；
- tagged union 继续 `deny_unknown_fields`；非法字段或非法值使用户提交成为 malformed structured
  content；
- Skill 不存在、已禁用、正在删除、名称已变化或未分配，不属于 wire malformed，不拒绝整条消息；这些是
  后述的语义省略条件。

Picker 选择产生：

```json
[
  { "kind": "skill_mention", "skillId": "skill-123", "nameAtSend": "review-pr" },
  { "kind": "text", "text": " 123" }
]
```

正文投影规则增加：

```text
SkillMention { nameAtSend } -> "/" + nameAtSend
```

因此 CampMessage.body、时间线展示和 `CURRENT_INPUT.message` 仍是：

```text
/review-pr 123
```

Picker 在 token 后提供一个可编辑的普通空格。删除 token 删除整个 `SkillMention`。手工输入、粘贴以及旧
Draft/旧消息里的 `/review-pr` 永远保持 `Text`，不按当前 Skill 名称反向识别或升级。Draft 恢复保留 token
的 `skillId/nameAtSend` 和可见 Marker；正文投影不查询当前 Skill 名称。

### 发送时 per-Run 冻结

用户发送事务在结构化内容校验、正文投影、接收者解析和每个接收者 Runtime 配置冻结之后，为每个将创建的
AgentRun 生成不可变 `SkillSelectionSnapshot v1`，并与该 AgentRun 在同一数据库事务提交。

这里特指 Composer 用户消息的 Direct dispatch：现有路径在同一发送事务创建各接收者 AgentRun。稍后才
从 Message Delivery 物化 AgentRun 的 A2A/Gather 路径不接受 Picker 选择，必须写入 versioned empty
snapshot；不得在延迟物化时扫描 Slash 文本或借用后来变化的 Skill Library 状态。

每个 AgentRun 新增：

```text
agent_run.skill_selection_snapshot_json   TEXT NOT NULL
agent_run.skill_selection_snapshot_digest TEXT NOT NULL
```

snapshot digest 使用现有 `canonical_json_digest`：对 canonical JSON 计算 SHA-256，保存 64 位小写 hex，
不带 `sha256:` 前缀。

JSON 完整 shape：

```json
{
  "schemaVersion": 1,
  "entries": [
    {
      "skillId": "skill-123",
      "nameAtSend": "review-pr",
      "firstSegmentIndex": 4,
      "eligibleAtSend": true
    },
    {
      "skillId": "skill-456",
      "nameAtSend": "grilling",
      "firstSegmentIndex": 8,
      "eligibleAtSend": false,
      "omissionReason": "disabled_at_send"
    }
  ]
}
```

`entries` 按第一次结构化出现的 segment index 升序。相同 `skillId` 在正文出现多次时，正文保留全部
Marker，快照只保留第一次；不同 `skillId` 不因同名而合并。没有 `SkillMention` 时保存
`{"schemaVersion":1,"entries":[]}`，而不是在恢复时重新推断。

发送时只有同时满足以下条件，`eligibleAtSend` 才为 true：

1. `skillId` 在事务内指向存在且 `lifecycle_status = active` 的 Skill；
2. Skill 在事务内 `enabled = true`；
3. Skill 当前 canonical name 与 `nameAtSend` byte-for-byte 相同；
4. Skill 当前 Assignment 至少有一个 groupKey 与该 Run 已冻结 Adapter 的 Delivery Group 集合相交。

false entry 必须有且只能有以下一个 `omissionReason`，按此优先级选择：

```text
missing_at_send
inactive_at_send
disabled_at_send
name_mismatch_at_send
runtime_group_unassigned_at_send
```

true entry 不得有 `omissionReason`。发送时 false 后来变成 enabled/active/assigned/name-match，也不能回溯
进入该 Run。重试和恢复只读取持久快照，不重新计算发送时资格。

### Start-time Library availability

在首次 Context materialization 的 serialized Core preparation critical section 内，Core 从数据库读取一份
`RunSkillAvailabilityView`。它与同次 materialization 使用的 AgentRun、冻结 Adapter/Runtime 配置和
Exposure 一起形成 Context Source State；不能由 Settings 缓存或 filesystem 猜测替代。

每个选择对应以下 union 之一：

```json
{ "state": "missing" }
```

或：

```json
{
  "state": "present",
  "active": true,
  "enabled": true,
  "name": "review-pr",
  "matchingGroupKeys": ["codex"]
}
```

`matchingGroupKeys` 只含当前 Assignment 与该 Run 冻结 Delivery Group 的交集，并按 Adapter 的冻结 group
precedence 排序。它可以为空。已经存在 ContextManifest 的 active Run 恢复时，复用 Manifest 内冻结的
availability/resolution 与 Exposure，不读取后来变化的 Library 来改写旧 Manifest。

### Current Input Skill Resolver

Core 新增只读/纯计算解析 seam：

```text
resolve(
  SkillSelectionSnapshot v1,
  RunSkillAvailabilityView,
  PreparedSkillExposure v2,
  frozen Delivery Group precedence
) -> CurrentInputSkillResolution v1
```

它不得创建、修复、切换或删除 symlink，不得扫描 Runtime 原生 Skill 目录，不得从 name 或 execution root
猜路径，也不得重新运行 Reconciler。

按选择快照顺序，对每个 entry 依次要求：

1. `eligibleAtSend = true`；
2. start-time Skill 仍存在、active、enabled，当前 name 仍等于 `nameAtSend`；
3. start-time `matchingGroupKeys` 非空；
4. Exposure 中存在同 `skillId`、同 name、status `ready` 的候选；
5. 候选 groupKey 或 deliveredViaGroupKey 与冻结 Runtime Delivery Group 相容；
6. 多个 ready 候选按冻结 group precedence 选择，仍并列时按 `entryPath` bytewise 升序选择；
7. `entryPath` 必须是经 preflight 证明的投影 entry 目录；模型路径精确派生为
   `entryPath + "/SKILL.md"`，并通过 safe-path/absolute-path/file-exists 校验。

`shadowed`、`pending_removal`、缺少 entryPath 或其他非 `ready` 候选均不产生模型路径。

现有全量 `prepare_run_exposure()` 门禁保持不变：Exposure 中任何 `error`、`stale`、Revision/content
digest mismatch 或 ownership 完整性错误，仍在解析前阻止 Runtime launch；不能因为本次未选择该 Skill
而 fail open，也不能缩窄为 selected-only 验证。

### `CURRENT_INPUT.skills`

只有 Direct 用户 CampMessage 中至少一个结构化选择成功解析时，AgentRun Context Formatter v18 在
`CURRENT_INPUT` 对象中增加 `skills`。它与 `source`、`message`、`mentionsCurrentUser`、`attachments`
同级。继续使用现有 canonical bytewise object-key 顺序；所有可选字段都存在时精确顺序为：

```text
attachments -> mentionsCurrentUser -> message -> skills -> source
```

完整模型可见 shape：

```json
{
  "source": { "type": "user" },
  "message": "/review-pr 123",
  "mentionsCurrentUser": false,
  "skills": [
    {
      "name": "review-pr",
      "path": "/repo/.codex/skills/review-pr/SKILL.md"
    }
  ],
  "attachments": [
    "/repo/.rovai/camp-attachments/spec.pdf"
  ]
}
```

精确 Dynamic Context 文本为一行 canonical compact JSON，`CURRENT_INPUT` 仍最后：

```text
[CURRENT_INPUT]
{"attachments":["/repo/.rovai/camp-attachments/spec.pdf"],"mentionsCurrentUser":false,"message":"/review-pr 123","skills":[{"name":"review-pr","path":"/repo/.codex/skills/review-pr/SKILL.md"}],"source":{"type":"user"}}
[/CURRENT_INPUT]
```

模型字段规则：

- `skills` entry 只有 `name` 和 `path`，不暴露 `skillId`、revisionId、digest、groupKey、发送/省略原因；
- `name` 等于已在发送时、start time 和 Exposure 三次核对成功的 `nameAtSend`，不含 `/`；
- `path` 是当前 Run execution root 内可信投影 entry 下的绝对 `SKILL.md` 文件路径，不是目录；
- entry 顺序是结构化 Skill 第一次出现顺序，相同 `skillId` 最多一个 entry；
- 没有成功解析项时完全省略 `skills`，不输出 `null` 或 `[]`；
- `message` 的内容、Marker、字节和正文选择不因 `skills` 改变；
- `attachments` 的值、顺序、路径、预算和省略规则不变；Skill path 不是 Attachment；
- A2A、ConversationMessage member call、Gather Completion 和普通手写 Slash 文本不增加 `skills`；
- 文件指针只证明 Core 提供了可信路径，不证明 Runtime 或模型读取、理解或执行了 Skill。

若没有 resolved Skill，Formatter v18 对该 `CURRENT_INPUT` 的字段和值保持原样。例如 Draft 期间 Skill 被
禁用且发送时仍禁用：

```json
{
  "source": { "type": "user" },
  "message": "/review-pr 123",
  "mentionsCurrentUser": false,
  "attachments": [
    "/repo/.rovai/camp-attachments/spec.pdf"
  ]
}
```

正文照常发送，不出现 Skill 文件链接，也不因合法无路径单独失败。

### 时间语义

| 发送时 | Context materialization / preflight 时 | 模型结果 | Run 结果 |
| --- | --- | --- | --- |
| disabled / inactive / missing / unassigned | 后来恢复可用 | 省略 entry | 正常继续 |
| eligible | active + enabled + name/group match + ready | 输出 `{name,path}` | 正常继续 |
| eligible | 后来 disabled / inactive / missing / unassigned | 省略 entry | 全局 Exposure 可信时正常继续 |
| eligible | 后来 rename | 省略 entry | 正常继续 |
| eligible | 只有 shadowed / pending_removal 候选 | 省略 entry | 正常继续 |
| eligible | 任意 Exposure `error` / `stale` / digest mismatch | 不构造输入 | 现有 preflight 阻止 launch |
| 仅手写或粘贴 `/name` | 任意 | 无 Skill entry | 正常正文 |

### 多接收者

同一共享 CampMessage 保存相同 `SkillMention(skillId,nameAtSend)` 和相同正文，但每个 AgentRun 独立冻结发送
资格并按自己的 execution root、Adapter Delivery Group 与 Exposure 解析。AgentRun A 可以得到路径，
AgentRun B 可以省略；任何 Run-specific 路径都不写回共享 CampMessage。

### ContextManifest Evidence v16

ContextManifest Evidence v16 保留 v15 全部 source/selection/truncation、Exposure、Bootstrap linkage、
rendered payload blob/digest 和 Runtime Input Delivery 关系，并新增：

```text
agent_run.skill_selection_snapshot_json
agent_run.skill_selection_snapshot_digest
context_manifest.current_input_skill_resolution_json
context_manifest.current_input_skill_resolution_digest
```

`current_input_skill_resolution_json` 完整 shape：

```json
{
  "schemaVersion": 1,
  "selectionSnapshotDigest": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "skillExposureDigest": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
  "entries": [
    {
      "skillId": "skill-123",
      "nameAtSend": "review-pr",
      "firstSegmentIndex": 4,
      "eligibleAtSend": true,
      "runAvailability": {
        "state": "present",
        "active": true,
        "enabled": true,
        "name": "review-pr",
        "matchingGroupKeys": ["codex"]
      },
      "outcome": "included",
      "path": "/repo/.codex/skills/review-pr/SKILL.md",
      "revisionId": "revision-456",
      "contentDigest": "sha256:content",
      "groupKey": "codex"
    },
    {
      "skillId": "skill-789",
      "nameAtSend": "grilling",
      "firstSegmentIndex": 8,
      "eligibleAtSend": false,
      "sendOmissionReason": "disabled_at_send",
      "runAvailability": {
        "state": "present",
        "active": true,
        "enabled": false,
        "name": "grilling",
        "matchingGroupKeys": ["codex"]
      },
      "outcome": "omitted",
      "reason": "not_eligible_at_send"
    }
  ]
}
```

若 chosen Exposure 使用转发 group，included entry 另含：

```json
{ "deliveredViaGroupKey": "claude_compatible" }
```

否则省略该字段。included entry 必须含 path/revisionId/contentDigest/groupKey，不含 reason；omitted entry
必须含 reason，不含 path/revisionId/contentDigest/groupKey/deliveredViaGroupKey。`sendOmissionReason` 只在
发送快照 false 时复制。`runAvailability` 使用前述 `missing`/`present` union。

omitted `reason` 只允许：

```text
not_eligible_at_send
missing_at_start
inactive_at_start
disabled_at_start
name_mismatch_at_start
runtime_group_unassigned_at_start
exposure_missing
exposure_name_mismatch
exposure_not_ready
exposure_group_incompatible
skill_file_unavailable
```

`entries` 与 selection snapshot 一一对应并保持顺序；没有结构化选择时仍保存空 entries 的 resolution。
resolution digest 与 selection/Exposure 一样使用 64 位小写 hex canonical JSON digest，不带
`sha256:` 前缀。Skill Revision `contentDigest` 和 rendered payload digest 继续沿用各自现有带前缀格式。
现有 Exposure JSON/digest 继续证明全量 preflight，现有
rendered payload blob/digest 继续是最终模型字节的唯一完整证明；新增 digest 不替代它们。

四层 authority 仍保持分离：

1. CampMessage Structured Content、per-Run selection snapshot 与 Run availability 是 Context Source State；
2. `CURRENT_INPUT.skills` 是 Model Context Projection；
3. Exposure、resolution 与 exact rendered payload 是 Context Projection Evidence；
4. Runtime Input Delivery accepted ACK 只证明与 Manifest/epoch/Binding generation 绑定的输入被 Runtime
   接受，不证明 Skill 文件被读取。

### Runtime transport

所有 Runtime Adapter 继续只接收并传输现有完整 `prepared_context.rendered_payload` / runtime payload。
不新增 Provider-specific input item，不重复正文，不把 Skill 文件作为 attachment，不让 Adapter 解释
`SkillMention` 或选择路径。

### Skill Projection 生命周期

SkillProjectionReconciler 继续是创建、修复、验证、切换和清理投影 filesystem 的唯一权威。Resolver 只
消费持久 Exposure。普通 Run 结束不删除项目投影；disable、unassign、delete 和 Project removal 仍由现有
reconciliation/active-Run protection 规则处理。本变更不创建 per-Run Skill 内容副本，也不冻结 Skill 文件
内容副本。

### 版本轴、迁移与恢复

确认并实施 revision 1 时，版本轴精确变为：

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter:              v3 (unchanged)
AgentRun Context Formatter:       v18
ContextManifest Evidence:         v16
Context Delivery Profile:         v3 (unchanged)
Data Contract:                    v0.98
Projection Schema:                46
Schema Migration:                 91
```

Migration 91 是一次 Context technical-state clean break：

- 为 `agent_run` 增加非空 selection snapshot JSON/digest，为既有终态 Run 写入 versioned empty snapshot；
- 重建 `context_manifest`，增加非空 resolution JSON/digest，并把 formatter check 收窄为 `= 18`；
- 删除不兼容的 ContextManifest、ContextManifest history camp、Runtime Input Delivery、Bootstrap Redelivery/
  compaction/resume technical state、Native Session Bootstrap Evidence 和冻结 delivery context；
- 将 queued/running/waiting AgentRun、active CampTurn、pending/running Message Delivery 与 Gather 按已有
  clean-break 终态规则显式失败或取消，记录 `context_formatter_v18_required` 与
  `structured_skill_context_clean_break`；
- 清除 Native Binding/Session identity 与 compatibility/watermark，让后续工作创建新 Binding/Session 并
  物化 Formatter v18 / Manifest v16；
- 保留 Camp、CampMessage、Structured Content、附件、Task、终态执行和监控业务历史；
- 既有普通 `/skill` Text 不回填为 `SkillMention`，既有消息不获得 Run-specific 路径；
- 不保留 Formatter v17/Manifest v15 reader，不 dual write，不提供旧字段 alias。

如果实现开始前 main 已有别的 Schema/Context successor，本文语义不得静默改编号：必须更新本节、递增
revision 并重新确认。

## 明确不变

- Session Charter、MEMBER_IDENTITY、Memory Entrypoint、COLLABORATION_STATE v2、SELF_ACTIVE_TASKS、
  SHARED_CONVERSATION 和 RUN_FACTS v1 的模型文本、shape、选择、顺序与预算不变；
- Context Delivery Profile 保持 v3，origin/reference/recent selection、引用闭合、历史字符/payload budget、
  omission 与 locator 语义不变；
- `CURRENT_INPUT` 保持完整且为 Dynamic Context 最后一节；`source`、`message`、
  `mentionsCurrentUser`、`attachments` 现有语义不变；
- Gather Completion Input v2、A2A/member-call source、CampMessage Delivery、Recipient、Task 和当前用户
  attention 语义不变；
- Native Session Bootstrap v3、Bootstrap Formatter v3、Bootstrap Evidence 和 Charter delivery mode 不因
  模型字段本身扩张；clean break 只使旧技术实例失效；
- Skill Library desired state、Assignment、Delivery Group、Revision、Projection ownership 和全量 fail-closed
  preflight 权威不变；
- Runtime Adapter transport、Native Runtime input identity、accepted/delivery_unknown/not_accepted 状态机、
  epoch、Binding generation 和 ACK 权威不变；
- 附件的 prepared/consume、公共路径、数量/大小预算与清理不变；
- `skills.path` 不构成 Runtime load receipt、模型理解证明、操作权限或用户批准；
- Core 在每次 invocation 重新授权；任何 projected path、ID、digest 或 Manifest evidence 都不是授权 token。

## 二次确认

开发者 `murray17` 在审阅本文完整 revision 1 后回复“确认”，明确同意按 revision 1 实施，并要求继续
推送 main、打包和替换 `/Applications/Rovai AI.app`。该确认发生在实现代码、Schema、当前 Contract、
当前 ADR 与版本指针变更之前。

确认记录：

```text
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray17
confirmed_at: 2026-08-17
```

原始需求、此前产品方向同意、要求“开始实现”或本文作者自己的判断均未替代该确认。

## 验证

### Structured Content / Renderer

- Picker 生成 `skill_mention` token，后随可编辑空格；正文精确显示 `/name`；
- 手输、逐字输入、输入法输入和粘贴 `/name` 均只产生 Text；
- token 删除、undo/redo、Draft 保存/恢复、发送和时间线读取保留 ID/name；
- Draft 期间禁用且发送时仍禁用：正文发送，selection ineligible，模型无路径；
- closed union、未知字段、非法 ID/name、segment/text 上限负向测试；
- 旧 Draft/旧消息不反解析，不因当前 Skill 名称变化重写正文；
- Renderer manual detector、focused component tests、typecheck 与既有 Composer 键盘/无障碍回归通过。

### 发送事务

- active/enabled/name match/group match 才 eligible；五种发送 omission reason 及优先级逐项测试；
- 多接收者按各自冻结 Adapter Groups 得到不同 snapshot；
- 同 Skill 重复 Marker 正文保留、快照 first occurrence 去重；异常同名不同 ID 不串配；
- AgentRun 与 snapshot 原子提交；rollback 不留下任一半状态；
- queue/retry/recovery 只读快照，发送后启用不能回溯。

### Resolver / preflight

- eligible + current available + ready 输出 `entryPath/SKILL.md`；
- 后续 disable/unassign/delete/rename 即使旧 link 因 active Run protection 仍存在，也静默省略；
- shadowed/pending_removal/missing/name/group mismatch/file unavailable 分别产生确定 omission evidence；
- 多 group 按冻结 precedence、再按 entryPath 稳定选择；forwarded group evidence 完整；
- 全量任意 error/stale/revision/content/ownership mismatch 仍阻断 launch，包括未选择的 Skill；
- 纯 Resolver 测试证明不发生 filesystem mutation 或 Reconciler 调用。

### Model Context / Evidence

- `skills` 与 `source/message/mentionsCurrentUser/attachments` 同级；紧凑 JSON 延续 canonical bytewise
  object-key 顺序；
- message 和 attachments 的值/顺序不变；零 entry 时字段完全省略；
- 多 Skill 按第一次结构化出现排序，同 ID 去重；
- Direct 多接收者可得到不同路径；A2A/member call/Gather/manual Slash 无字段；
- `CURRENT_INPUT` 仍最后，Formatter v18 exact bytes/fixture/digest 可复现；
- selection/resolution/Exposure/rendered payload 四类 digest 均做正向与 tamper 负向测试；
- 已有 Manifest 恢复复用冻结 availability/resolution/Exposure，不受后来 Library 变化影响。

### Migration / Runtime / packaging

- Migration 91 从 current v0.96/schema 45/migration 90 fixture 升级，foreign-key check 与 idempotent reopen
  通过；
- business history 保留，in-flight technical state 显式收口，旧 Formatter/Manifest 无 reader/dual write；
- 九种 Runtime Adapter 的 prepared payload transport 不增加 Provider item、不重复正文；
- Runtime Input Delivery ACK、recovery、watermark 和 accepted-input blocker 回归通过；
- `pnpm docs:check`、Rust workspace tests、rustfmt、Clippy `-D warnings`、TypeScript typecheck/Vitest、Node
  protocol/acceptance tests、`git diff --check` 通过；
- 从隔离 userData 启动打包 App，完成 Picker -> send -> current-input evidence 的真实 smoke；
- 最终只从 `/Applications/Rovai AI.app` 启动安装版验收，并确认 main/origin/main 指向同一验收提交。

## 实施结果

revision 1 已由实现提交 `d95b17940689665299ee632f2dedce688248ecda` 完成；本节只记录实施证据，未改写
已确认的“变更前”“变更后”或“明确不变”。

- Rust 全量 602 项通过、3 项手工 Runtime smoke 按设计 ignored；最终 `main` monitoring 增量另有 19 项
  library 与 79 项 Core binary 测试通过；Vitest 388 项、Node 187 项、TypeScript、docs、skills、fmt、
  Clippy 与 diff 门禁通过；
- 打包 App 的隔离 smoke 从 Picker 生成 `skill_mention`，accepted Run 的 selection/resolution/rendered payload
  digest 可复现，最终 `CURRENT_INPUT` 同级输出 `message` 与 `skills[{name,path}]`，其中 path 为绝对
  `SKILL.md`；
- 最终 arm64 包严格 codesign 通过；app.asar/Core/CLI SHA-256 分别为
  `d9f70f812d25122ec7337bef191b99e561e6cf45c69cbd79416c3996300e0bc3`、
  `dc8cd896265bc5cefa1ddd4621e3c91bd4be83662c4e2ce081c9107de3492f4e`、
  `d6c721598e34aee7c3ac91abe3cb648dd47f83807cda888e5476742ce39d418a`；
- `/Applications/Rovai AI.app` 已替换并只从该路径稳定启动，日常数据库已进入 v0.98/schema 46/Migration
  91 且 foreign-key check 为空；原 v0.97 可恢复备份位于
  `/Users/murray.xue/Downloads/Rovai AI.app.backup-v0.97-20260817-122925`。
