---
document_type: protocol-contract
contract: current-input-skill-links-v1
authority: structured-skill-selection-and-model-projection
status: accepted
version: 1
last_updated: 2026-08-17
---

# Current Input Skill Links v1 Contract

本合同定义 Composer Skill Picker 的结构化身份、Direct AgentRun 发送时快照、start-time 解析和模型可见
`CURRENT_INPUT.skills`。决策理由见 [ADR-0203](../versions/v0.98/decisions.md#adr-0203)，完整
实施前后对照见 [v0.98 model-context-change revision 1](../versions/v0.98/model-context-change.md)。

## Structured Content

`StructuredCampMessageSegment` closed union 增加：

```json
{
  "kind": "skill_mention",
  "skillId": "skill-123",
  "nameAtSend": "review-pr"
}
```

`skillId` 必须非空、无首尾空白且 UTF-8 byte length 不超过 256。`nameAtSend` 必须是 1～64 bytes 的
canonical Skill name：只含小写 ASCII 字母、数字与内部单个 hyphen，不以 hyphen 开头/结尾、不连续。
未知字段或非法值拒绝 whole submitted Structured Content。

正文投影精确为 `"/" + nameAtSend`。Picker 选择创建一个 `skill_mention` 后跟普通 Text 空格；删除 token
删除整个 segment。手写、粘贴和旧 Draft/消息中的 Slash 文本保持 `text`，不得反解析或自动升级。
Skill 当前不存在、disabled、deleting、renamed 或 unassigned 是语义不可用，不是 malformed wire；正文仍
可以发送。

## SkillSelectionSnapshot v1

Direct user send 为每个新 AgentRun 在同一事务保存：

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

entries 按第一次 segment index 升序；同一 `skillId` 只保留第一次，不同 ID 不合并。无选择和所有非
Direct Run 都保存 `{"schemaVersion":1,"entries":[]}`，不得在 retry、recovery 或 delayed Delivery
materialization 时扫描正文。

eligible 需要发送事务内 Skill 存在、`lifecycle_status=active`、enabled、当前 name 与 `nameAtSend` 相同，
且 Assignment 与该 Run 冻结 Adapter Delivery Groups 有非空交集。false entry 必须按以下优先级保存一个
reason；true entry 不得保存 reason：

```text
missing_at_send
inactive_at_send
disabled_at_send
name_mismatch_at_send
runtime_group_unassigned_at_send
```

snapshot digest 对 canonical JSON 使用现有 SHA-256 `canonical_json_digest`，格式是无前缀的 64 位小写
hex。发送时 false 永远不能因后来状态变化变为本 Run 的模型 link。

## Start-time resolution

首次 Context materialization 在 serialized preparation critical section 内读取每个选择的
`RunSkillAvailabilityView`：

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

matching groups 是 start-time Assignment 与冻结 Adapter Groups 的交集，按冻结 Adapter group precedence
排序。解析按 selection 顺序，依次要求 eligible、present/active/enabled/name match、非空 matching group，
以及全量 verified SkillExposureSnapshot 中同 ID/同 name/相容 group/status ready/有效 entryPath 的候选。
多个 ready 候选先按冻结 group precedence，再按 entryPath bytewise 升序选择。模型文件必须是可信绝对
`entryPath/SKILL.md`。

`prepare_run_exposure()` 仍验证该 Run 的全量 Skill projection。任何 entry 的 error/stale、Revision/content
digest mismatch 或 ownership failure 在 resolver 前阻止 launch；未选择不构成豁免。Resolver 不写
filesystem、不扫描 Runtime-native inventory、不猜路径、不调用 Reconciler。

## Model projection

只有至少一个成功解析项时，Direct user `CURRENT_INPUT` 增加 optional sibling `skills`：

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

每个 entry 只含 `name` 和 `path`；顺序按 first segment，同 ID 最多一项。零项时完全省略 `skills`，不输出
null 或 empty array。`source/message/mentionsCurrentUser/attachments` 的值、选择、顺序与省略语义不变。
紧凑 JSON 延续 bytewise object-key canonical order；上例 exact bytes 为：

```text
{"attachments":["/repo/.rovai/camp-attachments/spec.pdf"],"mentionsCurrentUser":false,"message":"/review-pr 123","skills":[{"name":"review-pr","path":"/repo/.codex/skills/review-pr/SKILL.md"}],"source":{"type":"user"}}
```

`CURRENT_INPUT` 仍是 Dynamic Context 最后一节。A2A/member call/Gather/manual Slash 不增加字段。Skill link
不是 Attachment、permission、Runtime load receipt 或模型理解证明。

## Omission and recovery

发送时 ineligible、start-time missing/inactive/disabled/unassigned/renamed、Exposure missing/name mismatch/
non-ready/incompatible 或 Skill file unavailable 都只省略对应 entry；正文与附件不变。全量 Exposure
完整性错误不是 omission，仍 fail closed。

一旦 ContextManifest v16 存在，active Run recovery 复用其冻结 selection reference、availability、
resolution、Exposure 和 exact payload；不得读取后来变化的 Library 或 filesystem 改写 Manifest。

## Runtime transport

Runtime Adapter 继续接收并传输现有完整 prepared payload，不解析 `SkillMention`，不添加 Provider-specific
Skill item，不重复正文，也不把 Skill link 放入 Attachment transport。

## References

- [ADR-0203](../versions/v0.98/decisions.md#adr-0203)
- [ContextManifest Evidence v16](context-manifest-evidence-v16.md)
- [Skill Projection Reconciliation](../architecture/skill-projection-reconciliation.md)
- [Camp 会话工作区](../ui/components/conversation-workspace.md)
