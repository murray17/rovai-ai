---
document_type: contract
contract: memory-capture-v1
status: accepted
target_version: v0.73
last_updated: 2026-08-13
---

# Memory Capture v1

本合同拥有在线 Agent Memory 捕获、actor-bounded mutation、Hearth Review Item、审核并发、候选隔离与
清除的字段级语义。Memory Search/Read 的 Entrypoint、授权、cache state、FTS fail-closed 与 guessed-ID
anti-oracle 继续由 [ADR-0068](../adr/0068-brokered-memory-retrieval-and-session-entrypoint.md)拥有；Agent CLI
presentation 与 stdout 由 [Built-in Tool Transport v9](builtin-tool-transport-v9.md)拥有。

`accepted` 表示设计成立，不表示 v0.73 已完成实现。当前交付事实只从
[v0.73 实施计划](../versions/v0.73/implementation-plan.md)判断。

## 1. 服务等级与 Actor

自然语言中的显式或隐式长期信息通过 Runtime-native `memory-stewardship` discovery 进入在线流程，统一
属于 best-effort。Skill 是 system-required 并不证明模型在某一 turn 已加载它。合同不提供显式意图
Router、Session Charter 捕获条款、Run 结束 checkpoint 或离线反射。

两个 Actor 边界互不替代：

| Actor | 可以执行 | 不可以执行 |
| --- | --- | --- |
| Agent | `memory.search`、`memory.read`、`memory.write(add|revise)` | lifecycle、review decision、mutual Relationship、反向 directed、替其他 Companion 写入 |
| User | 任意合法 Scope 的 create/revise、mutual Relationship、review accept/reject、retire/reactivate/forget/supersede | 通过 Renderer optimistic state 绕开 Core command |

“忘掉这条记忆”的自然语言本身不授权 Agent Forget。确定性 Forget 只来自结构化 user-actor 命令。

## 2. Agent `memory.write` 输入

输入是 closed discriminated union。未知字段、字段出现在错误分支、空正文、非法 key、非法 Kind/Scope
组合都返回 `memory.invalid_input`，不会做宽松忽略。

### 2.1 Add

```json
{
  "action": "add",
  "scope": "companion | relationship | hearth",
  "kind": "preference | agreement | lesson",
  "body": "one canonical Memory body",
  "retrievalKeys": ["key one"],
  "counterpartyAgentId": "agent_7",
  "direction": "directed"
}
```

字段矩阵：

| Scope | Kind | Agent target fields | Core outcome |
| --- | --- | --- | --- |
| `companion` | preference/agreement/lesson | `counterpartyAgentId`、`direction` 必须缺失 | 当前 Agent 的 active Memory |
| `relationship` | agreement/lesson | 两字段必填；`direction` 只能是 `directed` | `current Agent -> present counterparty` active Memory |
| `hearth` | preference/agreement/lesson | 两字段必须缺失 | pending Hearth Review Item |

Add 禁止 `memoryId` 与 `baseRevisionId`。Agent 不能提交自身 Agent ID、Camp ID、Run ID、Execution Epoch、
directed actor 或 user identity；Core 从 current lease/Binding/domain state 推导。

### 2.2 Revise

```json
{
  "action": "revise",
  "memoryId": "memory_123",
  "baseRevisionId": "revision_456",
  "body": "replacement canonical Memory body",
  "retrievalKeys": ["complete", "replacement", "set"]
}
```

Revise 禁止 `scope`、`kind`、`counterpartyAgentId` 与 `direction`。目标身份决定路由：

- Companion 只允许 `Companion(current Agent)`；
- Relationship 只允许 actor 为 current Agent 的 directed Memory，且 counterparty 仍是当前 Camp 的另一个
  present current Member；
- Hearth 形成 pending revise Review Item；
- mutual、反向 directed、inactive、forgotten、不可适用或未知目标统一不能被 Agent 修订；
- `baseRevisionId` 必须等于调用事务中的 current Revision；Agent 在冲突后先 read，再重新判断。

## 3. 正文、Keys、查重与资源边界

正文 canonicalization 固定为 CRLF/CR 转 LF、trim 外部 whitespace、拒绝 LF/TAB 之外的 C0 control；
canonical body 必须非空且不超过 2,048 UTF-8 bytes。Secret Filter 在任何持久化之前运行且不记录命中
文本。

Retrieval Keys 每个 Revision/Review candidate 提交完整集合：1–3 个、每个 2–24 UTF-8 bytes、总计不超过
48 UTF-8 bytes；trim、collapse whitespace、ASCII case-fold 后去重，并拒绝 control、新行、table
separator 与 closed generic stop-term。

Exact 规则：

- Add 的 active duplicate identity 是 immutable Scope + Kind + canonical body；不同 Retrieval Keys 不允许
  绕过 duplicate；
- Revise 的 no-change 是 target current canonical body + 完整 normalized Retrieval Keys 都相同；
- Core 不做 semantic similarity、merge、supersede 或自动改写；
- pending Review duplicate 规则见第 6 节。

成功持久化的 Agent mutation（effective Memory/Revision 或 pending Review Item）每 AgentRun 合计最多 4 次；
idempotent replay 与任何拒绝不重复消耗。容量保持：

```text
active Hearth                                      32
active Companion per Agent                         32
active Relationship per unordered pair            12
active Relationship applicable to one Agent       48
Agent-origin Companion per Agent                    8
Agent-origin Relationship per pair                  4
Agent-origin Relationship applicable to one Agent 16
```

Review Item 不占 active 或 Agent-origin Memory capacity。接受 add 时重新检查 Hearth active capacity。

Formation origin 是 `user | agent | accepted_hearth_review`；只有 `agent` 计入 Agent-origin capacity，后续
Revision actor 不改 formation origin。Lesson 无论 origin 默认 90 天后进入 advisory Memory Review；
Preference/Agreement 无 automatic review date。Review due 不改变 Lifecycle/effect，且 Agent 无权安排或
处理该治理提醒。

## 4. Agent 成功与失败输出

成功 stdout 只可能是：

```json
{
  "outcome": "effective",
  "memoryId": "memory_123",
  "revisionId": "revision_456"
}
```

或：

```json
{
  "outcome": "review_pending",
  "reviewItemId": "review_789"
}
```

`review_pending` 不表示 Memory 已保存、Revision 已发布、用户已接受或内容已进入任何 Agent 读取面。
Agent stdout 不是 receipt，不包含 `operation`、`requestId`、`receipt` 或完整 Envelope。

业务失败继续为：

```json
{
  "error": {
    "code": "memory.revision_conflict",
    "message": "safe bounded message",
    "recovery": "refresh_then_decide"
  }
}
```

稳定 Memory 错误至少包括：

| Code | Recovery | 语义 |
| --- | --- | --- |
| `memory.invalid_input` | `fix_input` | closed input、Kind/Scope/字段或正文/keys 非法 |
| `memory.secret_rejected` | `stop` | Secret Filter 拒绝；message/details 不含命中文本 |
| `memory.scope_forbidden` | `stop` | Actor 无权改变该 Scope/direction/target |
| `memory.unavailable` | `stop` | 未证明可读或当前不可适用的目标；不形成存在性 oracle |
| `memory.revision_conflict` | `refresh_then_decide` | `baseRevisionId` 已不是 current |
| `memory.no_change` | `stop` | exact no-change |
| `memory.duplicate` | `stop` | exact active add duplicate |
| `memory.duplicate_pending` | `stop` | 已有 exact pending Review candidate；不返回其 ID、body、snippet 或 keys |
| `memory.capacity_exceeded` | `stop` | active capacity 已满 |
| `memory.agent_origin_capacity_exceeded` | `stop` | Agent-origin capacity 已满 |
| `memory.run_quota_exceeded` | `stop` | 当前 Run 已使用 4 次成功 mutation |

Transport、lease、outcome-indeterminate 与 receipt recovery 仍服从 Transport v9。

## 5. Hearth Review Item read model

Review Item 只通过 authenticated user read model 返回。Agent 持有 `reviewItemId` 也不能读取 candidate；
Memory Search/Read 对它没有分支。

```ts
type HearthReviewItemStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "invalidated"

type HearthReviewInvalidationReason =
  | "target_forgotten"
  | "exact_candidate_published"

interface HearthReviewItemView {
  reviewItemId: string
  requestedAction: "add" | "revise"
  status: HearthReviewItemStatus
  stale: boolean
  version: number
  candidateKind: "preference" | "agreement" | "lesson" | null
  candidateBody: string | null
  candidateRetrievalKeys: string[] | null
  targetMemoryId: string | null
  baseRevisionId: string | null
  sourceAgentId: string
  sourceCampId: string
  sourceAgentRunId: string
  sourceExecutionEpoch: number
  acceptedMemoryId: string | null
  acceptedRevisionId: string | null
  resolvedByUserId: string | null
  invalidationReason: HearthReviewInvalidationReason | null
  editedBeforeAcceptance: boolean | null
  createdAt: string
  resolvedAt: string | null
}
```

不变量：

- `pending add`：candidate Kind/body/keys 非空，target/base 为空；
- `pending revise`：candidate body/keys 与 target/base 非空，candidate Kind 为空并从 target 展示；
- terminal：candidate Kind/body/keys 均为空；
- `accepted`：accepted Memory/Revision、resolver、resolvedAt 非空，invalidationReason 为空；
- `rejected`：resolver、resolvedAt 非空，accepted refs 与 invalidationReason 为空；
- `invalidated`：invalidationReason 与 resolvedAt 非空，resolver 为空；
- source references 是弱引用；源对象不可导航不改变 Review status 或恢复 source body；
- candidate digest 永远不出现在 read model。

`stale` 只按当前读事务派生：

```text
status == pending
AND requestedAction == revise
AND (
  target absent
  OR target.lifecycle != active
  OR target.scope != hearth
  OR target.currentRevisionId != baseRevisionId
)
```

其他情况 `stale=false`。Stale 不是 terminal status，不触发 fan-out update；stale item 不能 accept 或
edit-and-accept，但可以 reject。UI navigation dismiss 不是领域决定。

## 6. Pending digest 与不可见去重

Store 为 pending candidate 保存一个内部 SHA-256 canonical JSON digest：

```text
add:
  {domain, action:add, scope:hearth, kind, canonicalBody}

revise:
  {domain, action:revise, targetMemoryId, baseRevisionId,
   canonicalBody, normalizedRetrievalKeys}
```

`domain` 是版本化固定 literal，防止跨算法误比较。Add digest 不含 Retrieval Keys，与 active exact duplicate
规则一致；同 Kind/body 但 keys 不同仍是 duplicate pending。Digest 只用于 pending exact dedupe、formal
publication reconciliation 与 Forget safeguard；terminal transaction 必须清除它。

相同 digest 已有 pending row 时，新调用返回 `memory.duplicate_pending`。响应、event、durable command
result 与 diagnostics 不返回 earliest ID、digest、candidate Kind/body/keys、snippet、proposer list 或计数。

## 7. User review commands

### 7.1 Accept / edit-and-accept

```ts
interface AcceptHearthReviewItemCommand {
  reviewItemId: string
  expectedReviewItemVersion: number
  finalBody?: string
  finalRetrievalKeys?: string[]
}
```

`finalBody` 与 `finalRetrievalKeys` 必须同时缺失（原样接受）或同时存在（edit-and-accept）；Kind、target 与
base 不能编辑。成功结果 body-free：

```json
{
  "reviewItemId": "review_789",
  "status": "accepted",
  "memoryId": "memory_123",
  "revisionId": "revision_456",
  "version": 2
}
```

共同检查：user actor、status pending、expected Review version、candidate 存在、canonicalization、Secret
Filter。Add 另检查 exact active duplicate 与 Hearth capacity。Revise 另检查 target exists + active + Hearth +
`currentRevisionId == baseRevisionId`，并检查 final body/keys 不是 no-change。Edit 不得改变或 rebase target。

成功事务按顺序形成一个原子结果：创建 formal Memory/Revision；维护 FTS；把当前 item 设为 accepted 并
清除 candidate/digest；对 final Kind/body 执行第 8 节 pending-add reconciliation；写 body-free event 和
idempotent command result。

### 7.2 Reject

```ts
interface RejectHearthReviewItemCommand {
  reviewItemId: string
  expectedReviewItemVersion: number
}
```

只有 pending（包括 derived stale）可 reject。成功设置 `rejected`，清除 candidate/digest，并返回：

```json
{
  "reviewItemId": "review_789",
  "status": "rejected",
  "version": 2
}
```

Review 错误：

| Code | Recovery | 语义 |
| --- | --- | --- |
| `memory.review_not_found` | `stop` | user review item 不存在 |
| `memory.review_version_conflict` | `refresh_then_decide` | `expectedReviewItemVersion` 不匹配 |
| `memory.review_conflict` | `refresh_then_decide` | item 不再 pending |
| `memory.review_stale` | `refresh_then_decide` | revise target/base 不再可接受；不能 silent rebase |

## 8. Formal publication reconciliation

任何 user-direct 或 review-accepted 的 Hearth formal add/revise publication，在同一事务中按最终 current
Kind + canonical body 计算 add digest，并处理所有其他 matching pending add：

```text
status -> invalidated
invalidationReason -> exact_candidate_published
candidateKind/body/retrievalKeys/digest -> null
resolvedAt -> transaction time
version -> version + 1
```

这包括 edit-and-accept 的最终正文命中另一候选。Pending revise 不因普通 publication 被批量改状态；其
`stale` 从 target current Revision 动态派生。

## 9. Forget closure

Memory Forget 在一个事务中：

1. 若目标仍是可读 Hearth Memory，在清除正文前对该 Memory 每个尚未清除的 formal Revision Kind/body 运行
   第 8 节 add-digest reconciliation；不能只比较 current Revision，因为 v3 之前的 pending add 可能等于
   一个后来被替换的历史 Revision；
2. 删除全部目标 Revision Retrieval Keys 与 FTS rows，按 Memory Domain Forget 清除正式正文和受控
   provenance；
3. 对 `targetMemoryId == forgottenMemoryId` 的 pending Review Item 设置 `invalidated / target_forgotten` 并
   清除 candidate/digest；
4. 对 `acceptedMemoryId == forgottenMemoryId` 及其他相关 terminal rows 再执行幂等 candidate/digest 清空；
5. 写入 body-free Forget event 与 durable command result。

Forget 后不允许通过 Revision、Review Item、digest、FTS、Supersession、event、command result、diagnostic
projection 或 export 恢复正文。外部 Runtime 历史、已完成 Run 输入和用户自行导出的副本仍遵守既有
Memory Forget 边界，不在本合同中伪称可远程擦除。

## 10. Migration and compatibility

v3 migration 保留 formal Memory、Revision、Retrieval Keys 与 Supersession。旧 Hearth Proposal 转换规则：

| 旧状态 | 新状态 | Candidate 处理 |
| --- | --- | --- |
| pending add/revise | pending，计算新 digest | 保留供 user review；若 add 已等于任一 retained formal Hearth Revision，转 invalidated |
| accepted | accepted，保留 accepted refs/source/resolution | 清除 Kind/body/keys/digest |
| rejected | rejected，保留 source/resolution | 幂等清除 Kind/body/keys/digest |

旧 `accepted_hearth_proposal` formation origin 映射为当前 `accepted_hearth_review`，不改变 Memory effect 或
capacity class。既有 Agent-origin mutual Relationship 保留且仍可按 ADR-0068 读取；迁移不自动 retire、
revise 或 Forget，但 v0.73 之后 Agent mutation guard 禁止继续修改。

## References

- [ADR-0178: Best-Effort Online Memory Capture](../adr/0178-best-effort-online-memory-capture-and-actor-bounded-mutation.md)
- [ADR-0179: Normalized Memory Store v3](../adr/0179-normalized-memory-store-v3-with-isolated-hearth-review.md)
- [ADR-0180: Single Agent Memory Write Command](../adr/0180-single-agent-memory-write-command.md)
- [Built-in Tool Transport v9](builtin-tool-transport-v9.md)
- [Online Memory Capture architecture](../architecture/online-memory-capture.md)
- [v0.73 implementation plan](../versions/v0.73/implementation-plan.md)
