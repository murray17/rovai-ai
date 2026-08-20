---
document_type: model-context-change
version: v1.15
change_id: runtime-attachment-semantic-receipt
revision: 1
confirmation_status: confirmed
confirmed_revision: 1
confirmed_by: murray17
confirmed_at: 2026-08-20T11:19:10+08:00
authority: proposed-model-input-change-statement
implementation_baseline: 635431162ba16fe8c9c5bf88acc9bbab7463130f
last_updated: 2026-08-20
---

# v1.15 核心模型上下文变更说明：Runtime Attachment 语义 Receipt

本文是开发者已二次确认的 revision 1。它只修复已经实施的 Camp Published Attachment View 中，冻结
Context 错把可重建文件系统身份当作长期语义证据的问题。Camp-shared Published Attachment 授权、
generation-fenced publication、Runtime 可见绝对路径和模型输入 bytes 均不改变。

在开发者看到本文完整 revision 1 并明确确认前：

- 可以继续调查、测试设计和编辑本提案；
- 不修改 Rust、Schema、当前 Contract/Architecture 或本机 SQLite；
- 不执行 Migration 100、clean break、push、打包或替换 `/Applications/Rovai AI.app`。

## Revision 变更记录

| Revision | 状态 | 结论 |
| --- | --- | --- |
| 1 | confirmed | Context 只冻结稳定语义 receipt；物理 View identity 只进入当前本机完整性和 Runtime dispatch receipt。 |

## 变更前

### 1. 版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              3
AgentRun Context Formatter:       21
ContextManifest Evidence:         20
Context Delivery Profile:         4
RUN_FACTS Schema:                 2
Gather Completion Input:          3
Camp Attachment View Contract:    1
Camp Attachment View Receipt:     1
Runtime Attachment Auth Receipt:  1
Data Contract:                    v1.15
Projection Schema:                54
Latest Migration:                 99
```

Context section 顺序、Profile v4 选择与预算、Formatter 21 的最终模型输入，以及 Run Facts v2 均由当前合同
拥有，本次不改变。

### 2. ContextManifest 中的完整 View receipt

Manifest 20 保存以下 `CampAttachmentViewReceiptV1`：

```ts
type CampAttachmentViewReceiptV1 = {
  schemaVersion: 1
  campId: string
  publishedAttachmentRoot: string       // 当前实例绝对路径
  rootIdentityDigest: string             // Runtime Files Root 的物理 identity
  minimumReadyGeneration: number         // append 和 controlled rebuild 都推进
  catalogEntryCount: number
  catalogDigest: string                   // 见下方物理 catalog entry
  referencedAttachmentIds: string[]      // UTF-8 byte order，去重
  referencedAttachmentSetDigest: string  // 上述 ID 数组的 canonical digest
}
```

`catalogDigest` 的每个完整 entry 输入为：

```ts
type CatalogEntryReceiptV1 = {
  attachmentId: string
  kind: 'file' | 'directory'
  byteSize: number
  fileCount: number
  directoryCount: number
  nodeCount: number
  contentDigest: string
  authoritySafeLeaf: string
  rootRelativeFinalPath: string
  entryIdentityDigest: string       // Unix 包含 device/inode/type/size
  publishedGeneration: number       // rebuild 后重写
  publicationOperationId: string    // rebuild 每次新建
}
```

Manifest receipt canonical digest 也被冻结，并由 Context 恢复、Message Delivery frozen context 与 A2A
预冻结流程重新验证。

### 3. 当前验证与重建行为

`validate_append_only_view_receipt` 同时要求：

- 当前绝对 root 等于 `publishedAttachmentRoot`；
- 当前 root identity 等于 `rootIdentityDigest`；
- 当前 generation 不小于 `minimumReadyGeneration`；
- referenced Entry 的 `publishedGeneration` 不晚于冻结 generation；
- 通过冻结 generation 重算的 catalog count/digest 等于 receipt；
- 同 generation 时当前物理 catalog digest 也必须相等。

controlled rebuild 删除并重建 Runtime View 文件和 Entry 行，为全部 Entry 生成新的 inode/file identity、
operation ID 和 published generation，同时推进 View generation。即使 Authority bytes、`contentDigest` 和
Runtime 可见路径完全不变，旧 Manifest receipt 仍会失败。

### 4. 当前 Runtime dispatch 物理证据

Runtime Input Delivery 保存以下 `RuntimeAttachmentAuthReceiptV1`：

```ts
type RuntimeAttachmentAuthReceiptV1 = {
  schemaVersion: 1
  campId: string
  publishedAttachmentRoot: string
  rootIdentityDigest: string
  dispatchGeneration: number
  catalogDigestAtDispatch: string
  visibilityMode: 'generation_fenced_v1' | 'live_append_v1'
  compatibilityGeneration: number | null
  manifestViewReceiptDigest: string
}
```

该 receipt 与 Runtime request digest 绑定，证明本次 dispatch 实际授权的本机 View。它本来就应反映当前
物理 root、generation 和 catalog；问题只在于 Manifest V1 把同类物理事实提升成历史 Context 有效性的条件。

## 变更后

### 1. 版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter:              3 (unchanged)
AgentRun Context Formatter:       21 (unchanged)
ContextManifest Evidence:         21
Context Delivery Profile:         4 (unchanged)
RUN_FACTS Schema:                 2 (unchanged)
Gather Completion Input:          3 (unchanged)
Camp Attachment View Contract:    2
Camp Attachment View Receipt:     2
Runtime Attachment Auth Receipt:  1 (unchanged)
Data Contract:                    v1.15 (unchanged)
Projection Schema:                55
Latest Migration:                 100
```

Formatter 保持 21，因为模型可见 section、JSON、选择、顺序、路径和最终 UTF-8 bytes 完全不变。Manifest
推进到 21，只因为不可见于模型的冻结 Evidence shape 与兼容验证语义改变。Profile、Run Facts、Bootstrap、
ACP/Codex Host compatibility schema 和 Runtime Auth Receipt shape 不变。

### 2. 稳定语义 catalog

View 持久化把两个事实轴显式分开：

```text
catalogRevision / publishedCatalogRevision
  只在 Published Attachment 集合发生 append 时推进；controlled rebuild 不改变。

generation / publishedGeneration / root identity / entry identity /
publication operation / physicalCatalogDigest
  描述当前本机物化与 Host compatibility；append 和 controlled rebuild 都可以改变。
```

语义 catalog entry 的完整 canonical shape 为：

```ts
type SemanticAttachmentEntryV1 = {
  attachmentId: string
  kind: 'file' | 'directory'
  byteSize: number
  fileCount: number
  directoryCount: number
  nodeCount: number
  contentDigest: string
  rootRelativePayloadPath: string
  // 精确为 camps/<camp-id>/attachments/<attachment-id>/payload/<authority-safe-leaf>
}
```

`semanticCatalogDigest` 是全部 `SemanticAttachmentEntryV1` 按 `attachmentId` UTF-8 bytes 排序后的 canonical
array digest。它不包含 device/inode、root/entry identity、operation ID、physical generation、mode/DACL、
绝对 root 或任何 rebuild revision。

一次普通 publication 在同一消息事务中把 `catalogRevision` 加一，本批新增 Entry 使用同一
`publishedCatalogRevision`。controlled rebuild 必须逐项证明 Authority 与既有语义 entry 完全一致，只更新
物理 identity/operation/generation；它保留 `catalogRevision`、`publishedCatalogRevision` 和
`semanticCatalogDigest`。语义不一致不是 rebuild，而是 integrity failure，保持 fail closed。

### 3. ContextManifest 21 的完整 View receipt

Manifest 21 保存以下 `CampAttachmentViewReceiptV2`：

```ts
type CampAttachmentViewReceiptV2 = {
  schemaVersion: 2
  campId: string
  attachmentRootRelativePath: string
  // 精确为 camps/<camp-id>/attachments；相对当前实例 Runtime Files Root
  catalogRevision: number
  catalogEntryCount: number
  semanticCatalogDigest: string
  referencedEntries: SemanticAttachmentEntryV1[]
  // 只包含最终 Current/origin/reference/recent/Shared occurrence 引用的附件；
  // 按 attachmentId UTF-8 bytes 排序并去重
  referencedEntriesDigest: string
  // 上述完整 referencedEntries canonical array digest
}
```

V2 明确不包含：

- `publishedAttachmentRoot` 绝对路径；
- Runtime Files Root 的 device/inode/file ID 或 identity digest；
- Entry inode/file ID 或 identity digest；
- publication/rebuild operation ID；
- `generation`、`publishedGeneration` 或 compatibility generation；
- 当前物化的物理 catalog digest。

Current Input、Shared Conversation、Manifest `attachmentRefs` 和最终模型输入中的附件 path 仍是 Runtime
实际可打开的当前实例绝对 View path；它们在同一实例内跨 controlled rebuild 保持不变。本次不做 path
替换、不回退 Authority path，也不改变 `attachmentDigest`。

### 4. V2 append-only 验证

Context 恢复与 A2A 预冻结只按以下稳定事实验证 V2：

1. receipt canonical digest、schema、Camp ID、relative root shape、排序/去重和 referenced digest 正确；
2. 当前 View state 为 `ready`，且当前 `catalogRevision >= receipt.catalogRevision`；
3. 每个 `referencedEntries` 在当前语义 catalog 中存在、字段逐项相等，且
   `publishedCatalogRevision <= receipt.catalogRevision`；
4. 只取 `publishedCatalogRevision <= receipt.catalogRevision` 的 Entry 重算 count 与
   `semanticCatalogDigest`，必须与 receipt 相等；
5. 当前 revision 与冻结 revision 相等时，当前语义 count/digest 也必须相等。

因此：

- append 后旧 receipt 仍是合法 ancestor；
- 同字节、同 `contentDigest`、同相对 path 的 controlled rebuild 后旧 receipt 仍有效；
- root/Entry inode、operation ID、physical generation 改变不影响历史 Context；
- attachment bytes、kind、counts、content digest 或稳定 relative payload path 改变仍失败；
- Published Attachment 缺失、替换或 catalog 非 append-only 仍失败。

### 5. 独立的本机完整性与 Runtime Auth

物理证据不再决定历史 Context 语义有效性，但不会被删除：

- startup reconciliation、Camp read admission 与 Runtime launch 继续检查 root marker/identity、Entry
  identity、权限、文件树、Authority digest、物理 catalog 和未知节点；
- 失败先进入 `integrity_failed`、fence Host，并按既有 generation-fenced contract controlled rebuild；
- dispatch 使用重建后的当前 `publishedAttachmentRoot`、root identity、physical generation、physical catalog
  生成新的 `RuntimeAttachmentAuthReceiptV1`；
- `manifestViewReceiptDigest` 指向冻结的 V2 digest；Runtime request digest 继续绑定 Auth Receipt digest；
- 已 accepted 的历史 Runtime Input Delivery receipt 保留原物理证据，不被改写或冒充为新 dispatch。

这使“Context 语义是否仍成立”和“当前本机物化是否安全可授权”成为两个相邻但独立的验证层。

### 6. generation fence 与发送并发保持不变

本 revision 不采用 live append，也不修改产品规则：Camp 内存在 active/current or Warm Runtime 时，带附件
publication 仍必须等待 mutation gate，并按 `generation_fenced_v1` 停止/fence 不兼容 Host；55 秒 busy
边界、Draft 不消费和消息不部分接受保持不变。

同轮实现会把 publication staging 的大文件遍历、copy、digest 与 fsync 移出 Core 全局 Database mutex：

```text
短 DB 阶段：冻结 immutable CopyPlan、journal、quota reservation、状态 planned→copying
无 DB mutex：copy、digest、identity、fsync、staging sync
短 DB 阶段：复核 Draft/CopyPlan，CAS copying→staged，并持久化 copy receipt
```

这是执行并发修复，不改变 Context 或 publication 线性化点。CampMessage、`message_attachment`、View Entry、
catalog revision/generation 和 Draft consumption 仍在 mutation gate 内的单一短事务提交。

## 明确不变

- Authority Attachment 继续位于 `<data_dir>/camp-attachments/`；不迁移、不改写 `storage_path`；
- Draft Attachment、`.rovai-attachment.json` 和未发送附件继续不进入 Runtime View；
- Published Attachment 仍是 Camp-shared，只读、append-only View；
- Runtime 仍只收到当前 Camp 精确 `attachments` root，不收到 Authority 或实例/Camps parent；
- 普通文件和目录仍 copy，不使用 symlink/hardlink；权限、quota、journal、Camp 删除与 orphan cleanup 不变；
- `contentDigest`、Context Profile v4、Formatter 21 模型 bytes、Run Facts v2、History/Task/Gather/Skill/MCP
  选择、预算、omission、Managed Blob 和 accepted ACK 语义不变；
- 运行期间禁止带附件 publication 的 generation fence 是明确保留的产品合同。

## Migration 100 与兼容策略

Migration 100 只接受完整 schema 54/Migration 99 state：

1. 在 SQLite mutation 前要求 Runtime Files Root 已通过现有 admission，并完成 View/Authority preflight；
2. 按现有 accepted delivery/action evidence 诚实终结所有旧非终态 Manifest 20/Receipt V1 Run、Turn、Delivery
   与可恢复 execution，fence 当前 Binding/Session；不把它们伪装为未发送；
3. 逐字节保留历史 Manifest 20、模型输入 Blob、Runtime Input Delivery/Auth Receipt、ACK、摘要和执行证据；
4. 为现有 View 建立稳定 semantic catalog：空 catalog 使用 revision 0；非空现有 catalog 作为 revision 1，
   全部既有 Entry 使用 `publishedCatalogRevision = 1`；从稳定字段计算 semantic digest；
5. 安装 Manifest 20 read-only / Manifest 21 current-write pairing、Receipt V2 与新的 immutable trigger；
6. 推进到 Data Contract `v1.15 / projection schema 55 / Migration 100`。

不提供 Manifest V1→V2 rewrite、历史 digest 重算、dual write、dispatch-time receipt translation 或 downgrade
reader。Migration 后新 Run 全部使用 Manifest 21/Receipt V2；历史已完成记录保留但不再 dispatch。

## 验证

### Context 与 View regression owner

扩展 `camp_attachment_view` 现有 publication/append/rebuild owner，至少证明：

- 同一 frozen V2 receipt 在 append 后继续有效；
- 删除并 controlled rebuild 为新 inode/operation/physical generation 后，旧 V2 receipt 继续有效；
- rebuild 前后 `catalogRevision`、`publishedCatalogRevision`、semantic digest 和稳定相对 path 不变；
- Authority/content digest、kind/count/path 任一语义漂移时旧 receipt 失败；
- 当前物理 identity 被替换时本机完整性检查仍失败，rebuild 后新的 Runtime Auth Receipt 使用新 identity；
- receipt 中注入绝对 root、物理字段、乱序/重复 referenced entry 或未知字段均 fail closed。

### Database 与恢复 owner

- schema 54→55 只接受 Migration 99 完整来源；错误 source contract/schema/migration 集合 fail closed；
- 旧非终态 V1 输入诚实终结，历史 Manifest/Blob/Auth Receipt/ACK/Evidence bytes 保留；
- 新 insert 只接受 Manifest 21 + Formatter 21 + Profile 4 + Run Facts 2 + Receipt 2；旧 pairing 只读；
- fresh database、受支持 migration 和 startup reconciliation 均生成一致 semantic catalog。

### Publication concurrency owner

扩展发送/attachment publication 现有 owner，以受控 barrier 暂停无 DB copy phase，并证明：

- copy phase 进行时，另一项独立 Core Database mutex 操作能在有界时间内取得锁并完成；
- Draft 或 CopyPlan 在 copy 期间改变时，短 CAS 阶段拒绝 staged publication，公共消息与 Draft 不被部分消费；
- copy/digest/fsync 失败按 journal 回滚，quota reservation 收敛；
- mutation gate、55 秒 busy、Warm Host fence 和最终消息事务行为不变。

### 执行门禁

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test -p rovai-core --lib
cargo test -p rovai-core --features slow-tests --lib slow_tests::
cargo test -p rovai-core --bin rovai
cargo test -p rovai-core --bin rovai-core
pnpm typecheck
pnpm test
pnpm test:rust:pr
pnpm docs:test
pnpm docs:check
DOCS_BASE_REF=635431162ba16fe8c9c5bf88acc9bbab7463130f pnpm docs:check:ci
pnpm build:desktop
git diff --check
```

打包后另按 macOS packaging guide 验证 App/Core/CLI 的 architecture、签名、UUID 与 canonical path 安装结果；
不启动第二个日用实例，不修改日常 `userData`。

## 二次确认

当前状态：`confirmed`。

开发者确认记录明确指向：

```text
runtime-attachment-semantic-receipt revision 1
```

开发者 `murray17` 于 `2026-08-20T11:19:10+08:00` 确认 revision 1。若上述 receipt shape、版本轴、
Migration、Context bytes 或 clean-break 语义发生变化，revision 必须递增并重新确认。

## References

- [Camp Published Attachment Runtime View revision 2](model-context-change-runtime-attachment-session-projection.md)
- [核心模型上下文变更治理](../../development/model-context-change-governance.md)
- [Camp Published Attachment View architecture](../../architecture/camp-published-attachment-view.md)
- [Camp Published Attachment View v1](../../contracts/camp-published-attachment-view-v1.md)
- [ContextManifest Evidence v20](../../contracts/context-manifest-evidence-v20.md)
- [Rust 测试准入与退役门槛](../../development/testing.md#rust-测试准入与退役门槛)
