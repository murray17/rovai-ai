---
document_type: model-context-change
version: v1.39
change_id: pi-managed-system-prompt
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray17
confirmed_at: 2026-09-03
authority: confirmed-model-input-change-statement
implementation_baseline: aae13734669c363e7b307a6407e6868eda1e6b8e
last_updated: 2026-09-03
---

# v1.39 核心模型上下文变更：Pi managed system prompt

本说明冻结新 Pi Adapter 如何把既有 Session Bootstrap 与每轮 Dynamic Context 交给模型。开发者在看到
revision 1 后明确回复“确认 model-context-change revision 1，按此实施”；本记录不授权任何其他模型上下文变化。

## 变更前

基线没有 `AdapterKind::Pi`，因此不存在 Pi 模型输入、Pi Bootstrap delivery mode、Pi Native Binding 或 Pi receipt。
现有 Runtime 继续使用以下当前版本轴与选择：

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              3
AgentRun Context Formatter:       22
ContextManifest Evidence:         22
Context Delivery Profile:         4
Run Facts:                         2
Bootstrap Redelivery Envelope:    2
Bootstrap Redelivery Formatter:   2
```

完整 Bootstrap bytes 始终是以下 exact wrapper；三个插值分别是现有已冻结 Charter、six-field Member Identity pretty
JSON 和 Memory Entrypoint，均先按现有 formatter 规则 trim：

```text
[SESSION_CHARTER]
{sessionCharter.trim()}
[/SESSION_CHARTER]

[MEMBER_IDENTITY]
{memberIdentityPrettyJson}
[/MEMBER_IDENTITY]

[MEMORY_ENTRYPOINT]
{memoryEntrypoint.trim()}
[/MEMORY_ENTRYPOINT]
```

Dynamic Context 仍按 Formatter 22 的既有 exact section 顺序、选择、预算、JSON shape 与 omission 规则生成，并以
`CURRENT_INPUT` 结尾。基线 `native_session_bootstrap_evidence.delivery_mode` 只允许 `native_append | first_payload`。

## 变更后

只对 Pi 新增第三种 delivery mode：`managed_system_prompt`。每个 Pi Prompt 的输入分为两个互不替代的通道：

```text
effectiveSystemPrompt = piBaseSystemPrompt + "\n\n" + completeBootstrapBytes
promptInput           = exact Formatter-22 Dynamic Context bytes
```

官方 Pi extension 在当前 Session 的 `before_agent_start` 中完成第一式；Dynamic Context 仍作为该轮唯一用户输入，
不重复 Bootstrap。extension 必须先获得 Core 对以下 closed receipt 的确认 nonce，才能返回 effective system prompt：

```ts
interface PiManagedInputReceiptV1 {
  schemaVersion: 1
  extensionVersion: 'rovai-pi-host-v3'
  hostInstanceId: string
  hostBindingGeneration: integer
  agentRunId: string
  executionEpoch: integer
  nativeBindingId: string
  nativeBindingGeneration: integer
  runtimeInputDeliveryId: string
  nativePromptId: string
  nativeSessionId: string
  nativeSessionFileDigest: lowercaseSha256
  cwd: canonicalAbsolutePath
  bootstrapEvidenceId: string
  bootstrapPayloadDigest: lowercaseSha256
  skillExposureDigest: lowercaseSha256
  piBaseSystemPromptDigest: lowercaseSha256
  effectiveSystemPromptDigest: lowercaseSha256
  skillCatalog: Array<{
    name: string
    descriptionDigest: lowercaseSha256
    entryPath: canonicalAbsolutePath
    modelVisible: boolean
  }>
  skillCatalogDigest: lowercaseSha256
  activeToolNames: string[]
  mcpToolCatalog: Array<{
    serverId: string
    serverName: string
    toolName: string
    runtimeName: string
    descriptionDigest: lowercaseSha256
    inputSchemaDigest: lowercaseSha256
  }>
  mcpToolCatalogDigest: lowercaseSha256
  mcpProjectionDigest: lowercaseSha256
  bindingDocumentDigest: lowercaseSha256
}
```

所有字段必需，object 拒绝未知字段；catalog 以实现固定的 UTF-8 byte order 排序后做 canonical JSON digest。
`nativeSessionFileDigest` 是不可逆 locator digest，完整 file path 不进入 receipt JSON、公开事件、Activity、diagnostic
或 read model。确认 nonce 为
`sha256("rovai-pi-managed-input-receipt-v1\n" + canonicalJson(receipt))`，只有当前 Host/run/epoch/binding/session/
delivery/prompt 全部匹配时 Core 才回传。SQLite receipt commit 与 `runtime_input_delivery.status=accepted` 在同一事务；
任一字段、nonce、catalog 或 binding 漂移都不发送模型请求。

## 明确不变

- Session Charter 文本、Member Identity 六字段、Memory Entrypoint、三段顺序和 Bootstrap Formatter 3 不变。
- Formatter 22、ContextManifest 22、Profile 4、Run Facts 2 的 Dynamic Context bytes、section 顺序、预算、附件授权、
  Skill links、MCP exposure 与 public-history 选择完全不变；共享 fixtures 不改。
- 既有 Runtime 的 `native_append`、`first_payload` 与 Bootstrap redelivery 行为不变。
- Pi compaction 策略为 `native_system_prompt_preserved`；不把 Bootstrap 变成普通 first payload，也不新增 redelivery
  envelope。下一次 Prompt 仍用新 receipt 证明 effective system prompt。
- 完整 Session file 只属于 Core 私有 exact-resume locator；模型看不到 path 或 digest。
- 本次不改变 Current Input、Session Charter、Built-in CLI 教学或 Member Identity 文案。

版本轴只推进持久数据合同：`v1.44/schema85 → v1.45/schema86`、Migration 135。Bootstrap/Formatter/Profile/
Manifest/Run Facts 不推进，因为现有模型可见 bytes 与选择没有变化；Pi binding compatibility 使用新增的
`pi-jsonl-rpc-v1:managed-system-prompt-v1` clean identity，不能与其他 Runtime 或旧 Pi Session 互认。

## 二次确认

```yaml
confirmation_status: confirmed
confirmed_by: murray17
confirmed_at: 2026-09-03
revision: 1
confirmed_revision: 1
confirmation_text: "确认 model-context-change revision 1，按此实施"
```

任何改变 concat bytes、receipt shape/字段语义、Dynamic Context bytes、版本轴或 compaction 策略的后续修改都必须
递增 revision，并重新取得开发者二次确认。

## 验证

- exact fixtures 覆盖 receipt canonicalization、完整字段、nonce、Host/run/epoch/binding/session/delivery/prompt、Skill
  catalog、MCP catalog、base/effective prompt digest 与未知字段拒绝。
- Migration test 证明 managed delivery 未有 receipt 时不能 accepted，错 binding/generation 不能写入，合法 receipt
  与 acceptance 原子提交，receipt 不可 update/delete，重开幂等且 `foreign_key_check=0`。
- Pi 0.84.4 隔离 smoke 证明首次 Session、Core/Host restart exact resume、warm reuse 的输入都获得匹配 receipt；公开
  trace 不含 `sessionFile`/`nativeSessionFile`。
- deterministic A→B→A、并发 Host、late epoch/binding、compaction 后下一 Prompt、Skill/MCP 刷新和 receipt drift
  测试证明 Bootstrap 不重复、不丢失、不串 Session。
