---
document_type: model-context-change
version: v1.10
change_id: canonical-camp-identity
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: user
confirmed_at: 2026-08-18
authority: confirmed-model-input-change-statement
last_updated: 2026-08-18
---

# v1.10 核心模型上下文变更说明：唯一 Rovai Camp ID

本文冻结 Camp identity clean break 对 Agent 模型输入、Agent-facing retrieval 和证据版本的字段级变化。
开发者在审阅完整 revision 1 后明确确认实施；Runtime public failure 是同版独立增量，不改变本文的模型输入。

## 变更前

### 版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              3
AgentRun Context Formatter:       19
ContextManifest Evidence:         17
Context Delivery Profile:         3
Gather Completion Input:          3
Camp History Retrieval:           2
Built-in Tool Transport:          15
```

### Camp identity shape

Camp 主键由 `Uuid::new_v4().to_string()` 生成，模型和 Agent Tool 把它当作无格式约束的 `string`。典型
`SHARED_CONVERSATION` 顶层为：

```json
{
  "campId": "550e8400-e29b-41d4-a716-446655440000",
  "recentMessages": []
}
```

`campId` 适用于该 section 的 origin/reference/recent messages；Message shape、Agent audience、body 与 offset
规则由 Formatter19/Manifest17 冻结。Section 触发、顺序和省略规则为：

```text
COLLABORATION_STATE?
→ SELF_ACTIVE_TASKS?
→ SHARED_CONVERSATION?
→ RUN_FACTS?
→ A2A_GUIDANCE?
→ CURRENT_INPUT
```

Agent-facing Camp History/Built-in 字段把 Camp identity 作为普通字符串：

```text
camp.list:           camps[].campId
camp.search:         input.campId? / items[].campId
camp.read:           input.campId? / result.campId
history.search:      input.campIds[]? / items[].campId
Task/Camp results:   campId
```

Camp ID 与 provider Native Session/Thread ID 都可能是标准 UUID，模型无法仅从命名空间区分。旧 catalog、
ContextManifest 和 Binding 也不证明 Camp value 属于 Rovai 自有 identity。

## 变更后

### 版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter:              3 (unchanged)
AgentRun Context Formatter:       20
ContextManifest Evidence:         18
Context Delivery Profile:         3 (unchanged)
Gather Completion Input:          3 (unchanged)
Camp History Retrieval:           3
Built-in Tool Transport:          16
```

### 完整 Camp identity shape

唯一 Camp ID 为：

```text
rvcamp_<26 位小写 canonical Crockford Base32>
```

suffix 必须解码为 RFC-compatible UUIDv7；精确 lexical pattern 为：

```text
^rvcamp_[0-7][0123456789abcdefghjkmnpqrstvwxyz]{25}$
```

`SHARED_CONVERSATION` shape、字段顺序和省略规则不变，`campId` 的 value contract 改为：

```json
{
  "campId": "rvcamp_01h47kvsy5fk1shh6w1g60eecf",
  "recentMessages": []
}
```

Formatter20 的 section 顺序与 Formatter19 完全相同；没有新增、删除或重排 section。所有 Message、
`CURRENT_INPUT`、`RUN_FACTS`、A2A guidance、Gather v3 和 Principal projection 字段完全不变。

Agent-facing Camp History/Built-in 的同名字段保持原位置和 optionality，但每个 Camp value 都必须是同一个
canonical identity：

```text
camp.list:           camps[].campId = CampId
camp.search:         input.campId? / items[].campId = CampId
camp.read:           input.campId? / result.campId = CampId
history.search:      input.campIds[]? / items[].campId = CampId
Task/Camp results:   campId = CampId
```

显式 target 在授权前严格解析；省略 target 时使用当前 AgentRun 已验证的 CampId。旧 UUID、uppercase、Base32
alias、非 v7 payload 或错误 RFC variant 均失败，不进行猜测、转换或 alias 查询。

### Native Session 保持独立

以下字段的 value contract 不变：

```text
native_session_id
native_thread_id
native_turn_id
acp_session_id
codex_thread_id
conversation_id
native_binding_id
```

它们只能来自 provider/Conversation binding。`rvcamp_...` 不能进入 `thread/resume`、`session/resume`、
`session/load` 或等价 Runtime API；标准 UUID Native ID 也不能作为 Camp target。

## 明确不变

- Session Charter 全文、Bootstrap 三段 wrapper、Member Identity、Memory Entrypoint 与投递模式不变；
- Dynamic Context section 顺序、触发、budget、history selection、omission、body projection 与 Unicode offset 不变；
- Context Delivery Profile v3、Gather Completion Input v3、Run Facts v1、Collaboration State v2 不换版；
- Camp membership、Manifest/live fence、publication、authorization、receipt/replay 与 idempotency 语义不变；
- Agent、Task、Run、Message、Conversation、Native Session/Turn 和其他实体的 ID 格式不变；
- Runtime public failure 的 `RuntimeFailureView` 不进入模型上下文，是同版独立 Renderer/read-model 增量。

## 数据迁移、失效与兼容策略

Migration 94 先为 Runtime public failure 安装 Data Contract v1.10 / projection schema 49。Migration 95 再安装
Formatter20/Manifest18 和 projection schema 50。v95：

- 清除 ContextManifest、History Camp、Runtime Input Delivery、Bootstrap/compaction/redelivery evidence；
- 清除 Conversation Native Session/Binding compatibility、secret、generation、accepted public boundary 与 digests；
- 失败关闭非终态 AgentRun/CampTurn/Message Delivery/Attempt/Gather，稳定 code 为
  `context_formatter_v20_required`；
- rebuild `context_manifest` 的 Formatter CHECK 19→20，并记录 migration 95。

生产打开不符合当前预发布 Data Contract 的 Rovai-owned store 时，将数据库和受管目录移入
`inactive-data-quarantine/`，再创建当前 store。不会为旧 Camp UUID 生成新 ID、映射或兼容 reader。Renderer
timeline storage 升至 v2，navigation/onboarding/pin/restorable state 只恢复 canonical Camp ID。

## 二次确认

开发者在审阅本文完整 revision 1 后明确回复“确认，你执行吧”，同意按该 revision 实施，并要求继续推送
`main`、打包和替换 `/Applications/Rovai AI.app`。该确认对应本文 Front Matter 中的
`confirmation_status: confirmed`、`confirmed_revision: 1`、`confirmed_by: user` 与
`confirmed_at: 2026-08-18`；原始需求、首次方案同意或实现者判断均未替代本次二次确认。

## 验证

- Rust `CampId` 验证 UUIDv7 generation、canonical parse、Serde/SQLite round trip，并拒绝 uppercase、溢出、
  非 alphabet、非 v7、错误 variant 与裸 UUID；
- TypeScript `isCampId` 对 fixture 做相同 version/variant 与 lexical 验证；
- Context fixture `agent-run-context-v20.json`、Camp History v3 与 Built-in v16 golden 固定 `rvcamp_...`；
- Desktop 参数、领域 command、Camp History explicit target 和 Attachment path 在使用前拒绝旧 ID；
- `v95_invalidates_native_session_context_and_nonterminal_runs` 证明 schema 49→50、Formatter20、binding/context
  清除和执行失败关闭；
- 全量 Rust、TypeScript、Renderer、Contract、文档与 Desktop build 门禁共同防止版本轴或 fixture 漂移。

## References

- [v1.10 版本概览](README.md)
- [ADR-0219](../../adr/0219-single-namespaced-camp-identity.md)
- [Camp Identity v1](../../contracts/camp-identity-v1.md)
- [ContextManifest Evidence v18](../../contracts/context-manifest-evidence-v18.md)
- [Camp History Retrieval v3](../../contracts/camp-history-v3.md)
- [Built-in Tool Transport v16](../../contracts/builtin-tool-transport-v16.md)
