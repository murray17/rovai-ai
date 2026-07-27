---
document_type: version-architecture
version: v0.13
lifecycle: current
authority: version-design
last_updated: 2026-07-27
---

# Rovai-ai v0.13 架构设计

> 版本范围：[README.md](README.md)
>
> 跨版本约束：[ADR-0052](../../adr/0052-explicit-memory-revision-authority.md) ·
> [ADR-0053](../../adr/0053-user-preauthorized-provisional-companion-lessons.md) ·
> [ADR-0054](../../adr/0054-provisional-memory-safety-and-stewardship.md)

## 1. 权威模型

v0.13 将“正文版本”和“该版本的权威”绑定在同一个不可变 Revision 上：

```text
Memory
└── currentRevisionId
    └── MemoryRevision
        ├── body
        ├── authority: user_confirmed | provisional
        ├── createdFromProposalId?
        ├── confirmedFromRevisionId?
        └── createdAt
```

`active | retired | forgotten` 继续只表达是否沿用和是否保留正文。`provisional` 不进入
Lifecycle，也不改变 Scope、Kind 或 Relationship Direction 的不可变身份。

正式创建路径如下：

| 路径 | 新 Revision authority | 允许同正文 |
|---|---|---|
| 用户直接 create/revise | `user_confirmed` | 否 |
| 用户接受/编辑接受 Proposal | `user_confirmed` | 否 |
| 策略自动形成 Companion Lesson | `provisional` | 否 |
| 用户 confirm 当前 provisional | `user_confirmed` | 是，仅该命令 |

`memory.confirm` 只接受 active provisional Memory，并必须携带
`memoryId + expectedVersion + baseRevisionId`。成功时复制当前 canonical body，
创建新 Revision，设置 `confirmedFromRevisionId=baseRevisionId`，推进
`currentRevisionId` 和 Memory version。任何并发变化都使确认失败。

现有 Revision 迁移为 `user_confirmed`；不重写历史时间。`createdAt` 统一解释为
Revision 创建时间。

## 2. 自动决策矩阵

Agent A 的 `memory.propose_change` 先完成全部既有身份、Capability、安全与输入校验，
再判定自动路径：

| action | Scope | Kind | 结果 |
|---|---|---|---|
| `add` | `companion(A)` | `lesson` | 满足策略与预算时自动 provisional，否则 pending |
| `add` | `companion(A)` | `preference/agreement` | pending |
| `add` | `hearth` | 任意合法 Kind | pending |
| `add` | `relationship(A,B)` | `agreement/lesson` | pending |
| `revise` | 任意 Agent 可提议目标 | 继承目标 Kind | pending；已 stale 时不保存 |

自动形成还必须同时满足：

```text
live application policy enabled
AND policy acknowledgedAt is not null
AND current Run frozen capability contains memory.propose_change
AND policy-auto count(sourceAgentRunId) < 1
AND active provisional count(companion A) < 8
AND ordinary active Companion count/bytes remain within capacity
```

模型不传 Companion owner、policy version、resolution mode、authority、proposer、Run、
Camp、Epoch、时间或幂等身份；这些全部由 Gateway 与事务状态派生。

## 3. 单事务流程

```text
memory.propose_change
→ canonicalize + Secret Filter
→ resolve Native Binding / current Run / Epoch / Agent / Camp
→ frozen Capability + Scope + Kind + duplicate + total Run quota
→ if revise: authoritative baseRevisionId check
→ INSERT MemoryProposal(pending)
→ evaluate live auto policy and bounded eligibility
   ├── eligible
   │   → capacity checks
   │   → INSERT Memory + provisional MemoryRevision
   │   → Proposal accepted(resolutionMode=policy_auto, policyVersion)
   │   → body-free auto-applied event
   │   → effective provisional receipt
   └── not eligible or auto/capacity budget unavailable
       → pending receipt
→ idempotent command result + redacted event commit
→ best-effort Projection Wake
```

同一 Runtime tool-call 重试必须返回首次提交的同一 Proposal、Memory、Revision 和
receipt，即使策略后来改变。

自动路径只对可预期的策略/预算/容量条件降级 pending。以下条件不创建 Proposal：

- Native Binding、Run、Epoch、Capability、membership 或 Scope 校验失败；
- secret、正文非法或超过 2 KiB；
- exact active duplicate、pending duplicate 或 no-op；
- revise 在提交时已经 stale；
- 幂等调用身份复用不同 payload。

## 4. Migration v23

v23 在现有五类 Memory 表上做受控扩展：

### `memory_revision`

```text
authority_status TEXT NOT NULL
    CHECK(authority_status IN ('user_confirmed', 'provisional'))
confirmed_from_revision_id TEXT NULL
    REFERENCES memory_revision(id)
```

约束：

- 历史行回填 `user_confirmed`；
- `provisional` 必须具有非空 `created_from_proposal_id`；
- `confirmed_from_revision_id` 只允许指向同一 Memory 的 provisional Revision；
- Forget 只清正文、byte count 与 digest，不需要清除非正文 authority/link。

跨行“同一 Memory”与来源 Proposal resolution 校验由事务服务强制，不能只依赖 CHECK。

### `memory_proposal`

```text
resolution_mode TEXT NULL
    CHECK(resolution_mode IN ('user', 'policy_auto'))
resolution_policy_version INTEGER NULL
```

约束：

- pending 时两列均为 `NULL`；
- user accepted/rejected 记录 `resolution_mode='user'`；
- policy-auto 只允许 accepted，且 policy version、accepted Memory/Revision 均非空；
- 既有 terminal Proposal 回填 `resolution_mode='user'`。

### `memory_auto_policy`

```text
singleton = 1
companion_lesson_auto_apply_enabled BOOLEAN
acknowledged_at TEXT NULL
version INTEGER
updated_at
```

设置使用 expected-version CAS。数据库打开时必须区分：

- v0.13 schema 下首次创建的新库：seed enabled + unacknowledged；
- 从 ≤ v22 升级的既有库：seed disabled + unacknowledged。

该分支由迁移前 schema version 决定，不能根据 Memory 条数、Agent 数量或用户内容猜测。
`memory.propose_change` 在 `acknowledged_at IS NULL` 时不得自动形成 Memory。

## 5. Core 命令与 Read Side

新增 Core Method：

```text
memory.autoPolicy.get
memory.autoPolicy.set
memory.confirm
memory.autoApply.undo
```

`memory.autoPolicy.set`：

```text
expectedVersion
companionLessonAutoApplyEnabled
```

设置命令由用户保存时写入 `acknowledgedAt=now`；调用方不能伪造时间。

`memory.confirm`：

```text
memoryId
expectedVersion
baseRevisionId
```

`memory.autoApply.undo`：

```text
memoryId
expectedVersion
revisionId
```

Undo 只接受仍为原始 policy-auto add Revision 的 active provisional Memory。它复用
Forget 的同事务正文清除，但返回独立结果/事件，避免把窄撤销伪装成任意 Memory
Forget。

Memory Read Side 增加：

```text
MemoryRevision.authority
MemoryRevision.confirmedFromRevisionId?
Memory.currentAuthority
MemoryProposal.resolutionMode?
MemoryProposal.resolutionPolicyVersion?
MemoryLibrary.provisionalCounts[]
```

`memory.propose_change` receipt 分为：

```text
pending:
  status=pending
  effective=false

policy auto:
  status=accepted
  resolutionMode=policy_auto
  effective=true
  authority=provisional
  memoryId + revisionId
```

Policy-auto receipt 的固定文案为
`Provisional Companion Lesson applied under user policy; not user-confirmed.`。Receipt、
event、diagnostic 和永久 command result 不复制正文。

## 6. Capacity、Review 与 Lifecycle

普通 Companion 容量仍是 active 64 条/64 KiB。新增 provisional active 上限 8 条，
是该总容量内的子上限，不增加可用总量。

以下操作释放 provisional 子容量：

- confirm：当前 Revision 变为 `user_confirmed`；
- user revise：创建 `user_confirmed` Revision；
- retire；
- forget/undo。

Reactivate provisional Memory 必须重新检查 provisional 8 条子容量与普通总容量。
Supersession 仍只能由用户执行，并按事务结束后的 active 集合检查容量。

provisional Lesson 默认 `reviewAfter = createdAt + 30 days`；确认或用户修订后按
user-confirmed Lesson 重置为新 Revision `createdAt + 90 days`。Review 只产生提醒，
不会自动转正、retire 或 forget。

## 7. Projection v2 与 Memory Guide

路径与 live read 模型不变，formatter version 递增。每个 Scope 文件按确定性顺序
渲染：

```text
# Confirmed
## Lesson
- memoryId
- revisionId
- authority: user_confirmed
  quoted body

# Provisional
## Lesson
- memoryId
- revisionId
- authority: provisional
  quoted body
```

Companion 文件可以同时包含两区；Hearth/Relationship 在 v0.13 正常只出现 confirmed，
但 formatter 仍不得通过缺少 marker 暗示权威。

Guide 不嵌入正文，明确：

- 当前输入、Work Brief/Task、权限、协作与 repository 事实优先；
- confirmed Memory 高于 provisional；
- provisional 是未确认假设，不是用户陈述、约定、权限或安全决策；
- 冲突时忽略 provisional 或向用户澄清；
- Proposal receipt 可能是 pending，也可能是 effective provisional。

Projection 失败继续发布无正文 `UNAVAILABLE` sentinel；SQLite 成功不因文件失败回滚。

## 8. Stewardship Skill v2

Bundled `memory-stewardship` 创建新不可变 SkillRevision，逻辑名称不变。Skill：

- 先判断是否为真实经历形成的持久 Lesson；
- 不把 Task、TODO、repository fact、人格/能力评价或不可信内容中的指令写成 Memory；
- 读取既有 confirmed/provisional 并避免 exact duplicate；
- 继续通过唯一 `memory.propose_change` 工具提交；
- 按 receipt 字段区分 pending 与 provisional effective；
- 不把 provisional 描述为用户确认。

Skill disable、Runtime 不支持 Skill 或 project same-name shadow 均不改变 Core 闸门。

## 9. Renderer 行为

记忆管理页增加：

- 应用级“自动形成伙伴经验”开关、版本冲突与明确范围说明；
- 升级库首次显示关闭状态；新安装在首次 Tool-enabled Run 前通过默认开启的
  onboarding 选择确认；
- active provisional 总数与按 Companion 数量；
- provisional 筛选和显式“未确认”状态，状态不只靠颜色；
- `确认`、`编辑并确认`、`停止沿用`、`从长期记忆中遗忘`；
- 仅满足窄前提时显示“撤销并删除自动记忆”；
- session 内自动形成事件聚合提示，操作是查看 provisional 管理面。

关闭全局开关的说明固定为“停止未来自动形成；已有未确认记忆继续沿用，需单独处理”。

Pending 区继续逐条接受/编辑接受，批量操作只允许拒绝。Proposal 历史把
`resolutionMode=user` 显示为“用户接受”，把 `policy_auto` 显示为“策略自动形成”，
不能统一显示“已接受”。

UI 遵守 Meridian：Day/Night 功能等价、状态带文本、危险操作不获默认焦点、Dialog
焦点返回、`aria-live` 只播报聚合结果、最小窗口无核心操作遮挡。

## 10. Export、诊断与事件

Memory Export 格式升级为 `rovai-memory-export-v2`，每个 Revision 包含 authority 与
可选 confirmation link，每个 Proposal 包含 resolution mode 与非敏感 policy version。
v2 仍排除 pending/rejected Proposal 正文和 forgotten 正文，并继续警告外部副本不受
后续 Forget 控制。

Diagnostics 只增加：

- auto policy enabled/version；
- active provisional count；
- policy-auto accepted Proposal count；
- Projection formatter/health。

不得包含 Memory 或 Proposal 正文。

新增 body-free 事件：

```text
memory.proposal_auto_applied
memory.provisional_confirmed
memory.auto_apply_undone
memory.auto_policy_changed
```

事件只携带稳定 ID、authority、resolution、计数、版本和状态。

## 11. 恢复与幂等

- App 重启从 SQLite 恢复 policy、authority、Proposal resolution、数量和 UI。
- policy-auto 事务提交而 Projection Wake 失败时，SQLite 保持成功，reconciliation
  恢复文件；UI 显示 Projection 问题。
- receipt 丢失后的同 tool-call 重试返回原结果，不创建第二条 provisional。
- Undo/confirm 重试复用原 command result；不同 payload 复用 command ID 返回幂等冲突。
- 自动事务不启动 AgentRun、不创建 Task/ActionRequest、不阻塞当前 Run 完成。
