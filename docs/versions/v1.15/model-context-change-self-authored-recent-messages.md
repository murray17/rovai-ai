---
document_type: model-context-change
version: v1.15
change_id: exclude-self-authored-recent-public-messages
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray17
confirmed_at: 2026-08-19T23:52:57+08:00
authority: confirmed-model-input-change-statement
implementation_baseline: 5a3ea00dcbe67062d78d767a6156862350b160e3
last_updated: 2026-08-20
---

# v1.15 核心模型上下文变更说明：排除自身发布的 recent public message

本文是在实施前保存的字段级模型输入变更说明。revision 1 只改变当前 Agent 的
`SHARED_CONVERSATION.recentMessages` 公共消息候选资格及与该资格对应的 omission evidence；它不删除或
改写 CampMessage，也不改变 `CURRENT_INPUT`。开发者已在完整审阅后明确要求开启 worktree 实施
revision 1；本次确认只覆盖本文冻结的语义，后续实现若发生语义偏离必须递增 revision 并重新确认。

审阅与实现基线为 `main@5a3ea00dcbe67062d78d767a6156862350b160e3`。

## 变更前

### 1. 当前版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              3
AgentRun Context Formatter:       20
ContextManifest Evidence:         18
Context Delivery Profile:         3
Gather Completion Input:          3
Data Contract:                    v1.15
Projection Schema:                52
Latest Migration:                 97
```

Context Delivery Profile v3 的完整 resolved JSON 为：

```json
{
  "profileVersion": 3,
  "maxPublicMessages": 15,
  "maxPublicHistoryChars": 24000,
  "maxMessageBodyChars": 2000,
  "maxPublicReferenceChainMessages": 3,
  "maxSelfActiveTasks": 8
}
```

### 2. 当前 Dynamic Context 与 Shared Conversation shape

Formatter 20 的完整 section 顺序为：

```text
COLLABORATION_STATE?
→ SELF_ACTIVE_TASKS?
→ SHARED_CONVERSATION?
→ RUN_FACTS?
→ A2A_GUIDANCE?
→ CURRENT_INPUT
```

除 `CURRENT_INPUT` 必须存在且最后外，其余 section 按既有条件省略。与本 revision 直接相关的
`SHARED_CONVERSATION` closed projection 为：

```text
{
  campId: string,
  originatingPublicUserMessage?: Message,
  referenceClosure?: [{ distance: integer >= 1, ...Message }],
  recentMessages?: [Message],
  omittedMessages?: {
    count: integer >= 1,
    sequenceStart: integer,
    sequenceEnd: integer
  }
}
```

每个 `Message` 的完整 shape 为：

```text
{
  messageId: string,
  sequence: integer,
  senderType: string,
  senderId: string,
  replyToMessageId?: string,
  attachments?: [{ name: string, mediaType: string, path: string }],
  body: string,
  mentionsCurrentUser?: true,
  nextBodyOffset?: integer >= 0
}
```

- `messageId`、`sequence`、`senderType`、`senderId`、`body` 必需；
- reply、非空附件、literal `true` mention 和正文截断 continuation 才出现对应 optional 字段；
- reference item 只额外增加同层 `distance`；
- origin、reference、recent 的空集合分别省略；只有这些字段和 `omittedMessages` 全部不存在时，整个
  `SHARED_CONVERSATION` 才省略；
- `recentMessages` 最终按 `sequence ASC` 投影；top-level `campId` 适用于全部消息。

### 3. 当前 recent public candidate 选择

`previousBoundary` 为兼容 Native Binding 的 `last_accepted_public_boundary_sequence`；新建、替换或不兼容
Native Session 使用 `0`。`currentBoundary` 为冻结在当前 AgentRun 上的
`initial_camp_context_through_sequence`。当前初始候选等价于：

```sql
SELECT camp_message.*
FROM camp_message
WHERE camp_message.camp_id = :current_camp_id
  AND camp_message.sequence > :previous_boundary
  AND camp_message.sequence <= :current_boundary
  AND camp_message.tombstoned_at IS NULL
  AND (
    :trigger_camp_message_id IS NULL
    OR camp_message.id <> :trigger_camp_message_id
  )
ORDER BY camp_message.sequence DESC
LIMIT 15;
```

查询后反转为 `sequence ASC`，再执行当前既有流程：

1. 按 Agent audience 重新投影正文，每条最多保留 2,000 Unicode scalars；
2. 独立选择最多三层 `referenceClosure`；
3. 从 recent 中去除已经进入 reference closure 的重复 Message ID，但不回填新的 recent candidate；
4. 独立选择 `originatingPublicUserMessage`，并去除与 reference closure 的重复；
5. 对 recent、origin 和 reference closure 应用合计 24,000 Unicode scalar 公共历史预算；
6. 若完整 Runtime payload 仍超预算，按既有优先级继续移除 optional public history。

当前 SQL 不检查作者。因而，只要位于 boundary 内、不是当前 trigger 且未 tombstone，当前 Agent 上一轮通过
`rovai send` 发布的 `author_type = 'agent' AND author_id = current Agent ID` 消息与用户、其他 Agent 和
system 消息资格相同：它可以进入 top 15、占用 `maxPublicMessages` 名额并出现在下一 AgentRun 的
`recentMessages`。新建或替换 Native Session 从 boundary `0` 重选时也相同。

### 4. 当前 omission 与 Evidence

模型可见 `omittedMessages` 对 `(previousBoundary, currentBoundary]` 内所有未 tombstone、非当前 trigger、且
最终未进入 origin/reference/recent 的 CampMessage 做 `COUNT/MIN(sequence)/MAX(sequence)`。因此当前 Agent
自身消息属于该全历史候选总体：进入 recent 时成为 included evidence；因 15 条上限、历史预算或 Runtime
payload budget 未进入时，则计入 omission aggregate 或对应 exact omission evidence。

ContextManifest Evidence v18 冻结 Profile v3 JSON/digest、边界、origin/reference/recent selection、每条已投影
消息 evidence、omission evidence、Formatter 20、exact rendered Dynamic Context blob/digest 与 Runtime Input
Delivery 关系。A2A Delivery preflight 与直接 Runtime materialization 共用同一个 recent selector；preflight
冻结的 `frozenContext` 在重试或恢复时不会重新选择。

## 变更后

### 1. 新版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter:              3 (unchanged)
AgentRun Context Formatter:       20 (unchanged)
ContextManifest Evidence:         19
Context Delivery Profile:         4
Gather Completion Input:          3 (unchanged)
Data Contract:                    v1.15 (unchanged)
Projection Schema:                53
Latest Migration:                 98
```

Formatter 20 保持不变，因为 section、JSON shape、字段名、顺序、序列化与省略规则均不改变。Profile 必须升为
v4，因为本 revision 改变其拥有的公共消息候选资格；Manifest 必须升为 v19，因为 selection、omission 和
Profile evidence 的解释发生改变。

Context Delivery Profile v4 的完整 resolved JSON 为：

```json
{
  "profileVersion": 4,
  "maxPublicMessages": 15,
  "maxPublicHistoryChars": 24000,
  "maxMessageBodyChars": 2000,
  "maxPublicReferenceChainMessages": 3,
  "maxSelfActiveTasks": 8
}
```

除 `profileVersion` 和下述候选资格外，全部数值、Task selection、排序和预算优先级不变。

### 2. 新 recent public candidate 选择

Core 从当前 AgentRun 的 `RunSnapshot.agent_id` 取得 `currentAgentId`。直接 materialization 中该值来自已冻结
Run 所属 Conversation；A2A preflight 中该值来自被投递的 recipient Conversation/Agent，不由消息正文、
Runtime 或 Renderer 推断。

初始 recent candidate 的完整新谓词为：

```sql
SELECT camp_message.*
FROM camp_message
WHERE camp_message.camp_id = :current_camp_id
  AND camp_message.sequence > :previous_boundary
  AND camp_message.sequence <= :current_boundary
  AND camp_message.tombstoned_at IS NULL
  AND (
    :trigger_camp_message_id IS NULL
    OR camp_message.id <> :trigger_camp_message_id
  )
  AND NOT (
    camp_message.author_type = 'agent'
    AND camp_message.author_id = :current_agent_id
  )
ORDER BY camp_message.sequence DESC
LIMIT 15;
```

执行顺序固定为：

1. 按现有 sequence boundary 选择当前 Camp 的未读公共消息；
2. 排除当前 trigger CampMessage；
3. 排除 `author_type = 'agent' AND author_id = currentAgentId`；
4. 仅对剩余 eligible candidate 执行 `sequence DESC`、`LIMIT maxPublicMessages`；
5. 反转为 `sequence ASC`，再执行既有 Agent body projection、单条 2,000 scalars、reference 去重、公共历史
   24,000 scalars 和 Runtime payload budget。

过滤是严格的 `(author_type, author_id)` 联合判断：

- 用户消息继续 eligible；
- `author_type = 'agent'` 且 `author_id != currentAgentId` 的其他 Agent 消息继续 eligible；
- system 消息继续 eligible；
- 只有 `author_type = 'agent'` 且 ID 精确等于当前 Agent 的消息失去 recent candidate 资格；
- 自身消息无论来自当前还是更早 Native Session、是否具有 `source_agent_run_id`，都不进入
  `recentMessages`；
- 自身消息不占用 15 条名额，查询会继续选择更早的 eligible 用户、其他 Agent 或 system 消息，直到达到
  limit 或 eligible candidate 耗尽。

### 3. omission、boundary 与其他投影

Profile v4 的 whole-history omission aggregate 使用与 recent selector 相同的自身作者排除谓词。当前 Agent
自身消息不是 eligible recent candidate，因此：

- 不进入模型可见 `omittedMessages.count/sequenceStart/sequenceEnd`；
- 不因 recent candidate 过滤本身产生 `max_public_messages`、`history_budget` 或 `runtime_payload_budget`
  omission evidence；
- 仅作为被过滤的 recent message 时，不因数量或正文长度消耗公共历史预算。

Runtime accepted ACK 仍把 Conversation 的公共历史 boundary 推进到本次 `currentBoundary`。被排除的自身消息
sequence 会随 boundary 一同跨过，后续不会因“尚未投影”被重新注入。新建、替换或不兼容 Native Session
虽然从 boundary `0` 开始，但仍应用相同自身作者过滤。

该过滤不是全局隐藏规则：

- 当前 trigger 仍由 `CURRENT_INPUT` 独立、完整传递；recent filter 不读取或修改 `CURRENT_INPUT`；
- `originatingPublicUserMessage` 仍只按现有 user lineage 选择；
- `referenceClosure` 的祖先选择与 live authorization 不变。若理解一条 eligible 消息需要当前 Agent 自己
  发布的父消息，该父消息仍可作为 reference closure 出现，但不得同时作为 `recentMessages` candidate；该
  reference candidate 若被 chain/history/runtime budget 排除，仍按现有 reference omission 规则留下 exact
  evidence；
- Camp timeline、`camp.read`、`camp.search`、`history.search`、Renderer、公屏持久化、消息投递、reply、mention
  与附件合同全部不变；
- direct materialization 与 A2A preflight 调用同一 selector 和 omission predicate，结果语义一致。

### 4. ContextManifest Evidence v19

ContextManifest Evidence v19 保留 v18 全部字段和 JSON shape，不新增、删除或重命名列。变化仅为：

```text
context_delivery_profile_version = 4
context_delivery_profile_json.profileVersion = 4
context_delivery_profile_digest = digest(Profile v4 exact JSON)
recent selection = Profile v4 eligible set
omission aggregate/evidence = Profile v4 eligible set minus final included set
```

每条实际进入 origin/reference/recent 的 `sharedMessageEvidence`、全部 body/attachment digest、边界、Formatter 20、
exact rendered payload blob/digest 与 Runtime accepted ACK 继续按 v18 规则冻结。自身消息通过 reference closure
出现时仍有完整 message evidence；仅因 recent 作者过滤而未出现时，不创建伪 omission evidence。

### 5. Migration 98、失效与恢复

Migration 98 只接受已完整应用 Migration 97 的 `v1.15 / projection schema 52` store，并原子推进到
`v1.15 / projection schema 53`。迁移固定执行：

1. 将非终态 AgentRun、CampTurn、Message Delivery/Attempt 与 Gather 失败或取消关闭，稳定原因码使用
   `context_delivery_profile_v4_required`；尚未 dispatch 的 Delivery 继续保持现有
   `interrupted_before_dispatch`/人工重试边界；
2. 移除 Message Delivery 中已冻结的旧 `frozenContext` 与旧 ContextManifest 引用；
3. 清除 ContextManifest、ContextManifest history-camp、Runtime Input Delivery、Bootstrap/redelivery、compaction
   和 Native Session resume evidence；
4. 清除 Conversation 的 Native Session/Binding compatibility、secret、generation、accepted public boundary 与
  关联 digest，使下一次执行建立符合 Manifest 19/Profile 4 的新 Binding；
5. 重建 `context_manifest`，保持 `CHECK(formatter_version = 20)`，将
   `CHECK(context_delivery_profile_version = 3)` 改为 `= 4`；
6. 记录 Migration 98 和 projection schema 53。

Camp、CampMessage、Conversation 逻辑记录、Task、Memory、Agent profile、Runtime installation、Skill/MCP Library
以及已终态执行不被删除。没有 Profile v3/Manifest v18 compatibility reader、旧 frozen input replay、dual write、
downgrade reader 或对旧 Manifest 的就地重写；不满足精确 schema 52 来源条件的 store 继续按既有 admission/
quarantine 策略 fail closed。

## 明确不变

- Session Charter 全文、Bootstrap wrapper、Member Identity、Memory Entrypoint、Bootstrap Formatter 3 与投递模式；
- Formatter 20 的 section 顺序、section 名、JSON shape、字段名、字段顺序、compact serialization 和省略规则；
- `maxPublicMessages = 15`、单条 2,000 scalars、公共历史 24,000 scalars、三层 reference chain、八项 self-active
  Task 及 Runtime payload gate 的数值和优先级；
- 当前 trigger 排除、tombstone 排除、Camp/boundary authorization、最终 recent `sequence ASC`；
- 用户、其他 Agent 和 system public message 的 recent candidate 资格；
- `CURRENT_INPUT` 的 source、message、mention、Skill、attachment、Gather v3 与 A2A guidance 语义；
- origin 与 reference closure 的选择、reference distance、body projection、附件和 live authorization；
- 公屏消息保存、timeline/Renderer 展示、History/Search/Built-in projection、消息投递和通知；
- Runtime accepted ACK 是公共历史 boundary 推进的唯一权威，冻结 A2A context 在重试时不重选；
- Camp、Agent、Message、Run、Conversation、Native Session 等 identity value contract。

## 二次确认

开发者在看到本文完整 revision 1 后明确回复“开启 worktree 实现，完成后 pushmain，打包到 app，删除
worktree”，要求按本文实施并完成交付。该指令构成 revision 1 的二次确认，记录为：

```text
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray17
confirmed_at: 2026-08-19T23:52:57+08:00
```

原始需求、调查结论和本文起草没有替代本次确认。

若上述候选谓词、omission 语义、版本轴、Migration 98 或不变项发生语义变化，必须把 `revision` 递增，当前
确认失效并重新审阅确认。

## 验证

确认并实施后必须覆盖以下可执行验证：

1. direct materialization：boundary 内当前 Agent 自身消息不进入 `recentMessages`，用户、其他 Agent 和 system
   消息保持 `sequence ASC`；
2. pre-limit 负向测试：放入超过 15 条更新的自身消息和至少 15 条更早 eligible 消息，结果仍选中 15 条
   eligible 消息，证明自身消息不占 top-15 名额；
3. trigger/current input：当前 trigger 不进入 recent，但 `CURRENT_INPUT` 字节完整且与 revision 前相同；
4. omission：仅存在自身消息时不生成 `omittedMessages` 或 omission entry；混合消息时 count/range/reason 只覆盖
   eligible 未投影消息；
5. budget：长自身正文不消耗单条或公共历史预算，不挤出用户/其他 Agent 消息；
6. boundary：accepted ACK 跨过自身消息 sequence，下一 Run 不重新注入；未 accepted 时仍按现有 recovery
   boundary 重试，但重选时继续过滤自身消息；
7. Native Session：兼容 continuation 与从 boundary `0` 开始的新建/替换 Session 都过滤当前 Agent；
8. A2A：prospective preflight 与随后 direct materialization 使用相同 Agent ID、候选和 omission 结果，frozen
   retry 不发生漂移；
9. reference closure：自身父消息仍可按现有三层 closure 出现并获得完整 Evidence，但不作为 recent candidate；
10. Profile/Manifest：Profile v4 canonical digest、Manifest 19 fixture、Formatter 20 fixture与恢复读取拒绝 v3/v18；
11. Migration：schema 52→53 成功，Manifest CHECK 变为 Profile 4，旧 Binding/Evidence 清除，非终态执行稳定关闭，
    CampMessage 完整保留；非法来源、重复 Migration 与 downgrade reader 均失败关闭；
12. 运行相关 Rust 单测、Context/DB migration tests、shared Contract fixture、文档门禁和 workspace 既有回归。

## 实施结论

Revision 1 已按确认语义实现，没有修改上述 candidate、omission、reference、boundary 或 Renderer 不变项。
实际版本轴为 Formatter 20（不变）、Context Delivery Profile 4、ContextManifest 19、Data Contract v1.15、
projection schema 53、Migration 98。Profile v4 canonical digest 为
`022688d6f133ea3bb6e6d5773cd30aec1db7a184e4419bbc0fe9c554518bc8d9`。

实现验证结果：

- Context 41 项定向 slow tests 全部通过，包括 current/replacement Binding 自身输出过滤、pre-limit 15 条
  eligible 回填、用户/其他 Agent/system 保留与 omission 排除；
- DB/Migration 23 项定向 tests 全部通过，包括 schema 52→53、Profile CHECK 3→4、非终态
  Run/Turn/Delivery/Gather 收敛、Binding/Evidence 清除、CampMessage 保留与重复打开幂等；
- `pnpm test:rust:pr` 通过（Rust lib 264、CLI 15、slow 264）；
- `cargo clippy --workspace --all-targets -- -D warnings`、`cargo fmt --all --check`、`pnpm typecheck`、
  `pnpm test`、`pnpm build:desktop` 全部通过；
- `pnpm docs:test`、`pnpm docs:check` 与
  `DOCS_BASE_REF=0194dc56580a3269d4b18f85d3eff38b7ef3aa4e pnpm docs:check:ci` 全部通过。

## References

- [核心模型上下文变更治理](../../development/model-context-change-governance.md)
- [v1.15 版本概览](README.md)
- [v1.15 实施与验收计划](implementation-plan.md)
- [Context Delivery Profile v4](../../contracts/context-delivery-profile-v4.md)
- [ContextManifest Evidence v19](../../contracts/context-manifest-evidence-v19.md)
- [公共上下文与 ContextManifest 不变量](../../architecture/foundational-invariants.md#context-public-history)
