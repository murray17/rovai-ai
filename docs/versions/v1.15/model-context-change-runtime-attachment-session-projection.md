---
document_type: model-context-change
version: v1.15
change_id: camp-published-attachment-runtime-view
revision: 2
confirmation_status: confirmed
confirmed_revision: 2
confirmed_by: murray17
confirmed_at: 2026-08-20T01:51:18+08:00
withdrawn_revision: 1
authority: proposed-model-input-change-statement
implementation_baseline: b9fae31f2def9042b2ce067b54252219f513509a
last_updated: 2026-08-20
---

# v1.15 核心模型上下文变更说明：Camp 已发布附件共享视图

本文是开发者已二次确认的 revision 2。开发者已经撤回 revision 1 的 Run 级与 Agent Session 级附件投影；
revision 1 的确认记录随语义变化失效，不能授权实现、迁移、push 或打包。

本 revision 的产品语义是：

> Draft Attachment 是 Core 私有数据；Attachment 随 Camp Message 正式发布后，成为该 Camp 全体 Agent
> 可主动枚举和读取的共享、不可变文件。

审阅基线为 `main@b9fae31f2def9042b2ce067b54252219f513509a`。在开发者看到本文完整 revision 2
并明确二次确认前：

- 只允许调查和编辑本提案；
- 不修改 Rust、Electron、Schema、当前 Contract/Architecture 或本机 SQLite；
- 不启动 Core、Desktop、打包 App 或真实 Runtime Probe；
- 不移动、删除或改名 `<data_dir>/camp-attachments/`；
- 不执行 clean break，不终结本机 AgentRun；
- 不提交、不 push，也不改写历史 ContextManifest、模型输入 Blob、摘要或执行证据。

## Revision 变更记录

| Revision | 状态 | 结论 |
| --- | --- | --- |
| 1 | withdrawn | Run/Agent Session 按最终模型输入累积授权；该确认已失效，不得继续实现。 |
| 2 | confirmed | Camp 是 Published Attachment 的共享授权域；开发者已授权按本文实施。 |

revision 2 明确删除 revision 1 的 `Projection Session`、`Session Incremental`、`Run Isolated`、
`Final Attachment Set`、`LogicalContextPlan` 和 Run/Session `Attachment Projection Receipt`。这些概念不进入
新 Schema、Context、Runtime compatibility 或恢复流程。

## 变更前

### 1. 当前版本轴

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3
Bootstrap Formatter:              3
AgentRun Context Formatter:       20
ContextManifest Evidence:         19
Context Delivery Profile:         4
RUN_FACTS Schema:                 1
Gather Completion Input:          3
ACP Host Compatibility Digest:    schema 2
Codex Host Compatibility Digest:  schema 1
Camp Attachment View Receipt:     none
Runtime Attachment Auth Receipt:  none
Data Contract:                    v1.15
Projection Schema:                53
Latest Migration:                 98
```

Formatter 20 的 section 顺序为：

```text
COLLABORATION_STATE?
→ SELF_ACTIVE_TASKS?
→ SHARED_CONVERSATION?
→ RUN_FACTS?
→ A2A_GUIDANCE?
→ CURRENT_INPUT
```

`CURRENT_INPUT` 必须存在且最后。Profile v4 的 recent candidate、origin/reference closure、数量、字符预算、
omission 和 Runtime payload 裁剪优先级由当前合同拥有。

### 2. 当前附件存储与发布语义

Camp Attachment v1 把普通文件和目录保存为不可变权威快照：

```text
<data_dir>/camp-attachments/<camp-id>/<attachment-id>/<authority-safe-leaf>
```

Attachment parent 中的 `.rovai-attachment.json` 是 Core-private metadata。`prepared_attachment` 表示 Draft；
消息发送事务把整组 Prepared Attachment 原子消费为 `message_attachment`，后者表示附件已经随 CampMessage
发布。发送后的附件在长期架构语义上已经是 Camp 公共资源，消息寻址不缩小其授权范围。

当前实现尚没有独立 Runtime 共享视图：

- `message_attachment.storage_path` 仍指向权威私有路径；
- Context 直接把该路径写入 Current Input、Shared Conversation 和 Manifest evidence；
- Runtime launch 把当前 Camp 的权威附件根作为 `attachmentAccessRoot`；
- Draft 与 Published 依赖数据库关系区分，但 Runtime 获得的是整个权威 Camp 根；
- TRAE 等 Runtime 可能无法穿过权威 Camp/Attachment parent 的 execute-only 目录。

### 3. 当前模型可见附件 shape

Current CampMessage 输入的完整附件相关 shape 为：

```ts
type CurrentCampMessageInputV20 = {
  source:
    | { type: 'user' }
    | { type: 'member_call'; senderAgentId: string; senderName: string }
  message: string
  mentionsCurrentUser: boolean
  skills?: Array<{ name: string; path: string }>
  attachments?: string[] // 当前为 authority absolute path
}
```

Gather Completion Input v3 的完整既有 shape 不变；当其 request CampMessage 带附件时，同一顶层
`attachments?: string[]` 也来自该 request 的 `message_attachment.storage_path`。只由私有
ConversationMessage 触发的 member call 不增加附件字段。

Shared Conversation 的附件 occurrence 为：

```ts
type SharedMessageAttachmentV20 = {
  name: string
  mediaType: string
  path: string // 当前为 authority absolute path
}
```

Manifest 的 Current Input `attachmentRefs` 为：

```ts
type AttachmentRefV19 = {
  attachmentId: string
  path: string // 当前为 authority absolute path
  contentDigest: string
}
```

每个 Shared Message evidence 另存同一 attachment ID、name、mediaType、authority path 和 contentDigest。

### 4. 当前 RUN_FACTS v1

```ts
type RunFactsV1 = {
  schemaVersion: 1
  taskContext?: {
    taskId: string
    referenceMode: 'frozen'
    laterChangesRetargetRun: false
  }
  sessionContinuity?: {
    state: 'lost'
    requiredAction: 'recheck_private_session_assumptions'
  }
  externalEffect?: {
    state: 'unsettled'
    requiredAction: 'reconcile_before_repeat'
  }
  gather?: {
    role: 'member'
    returnTarget: 'current_input_source'
    returnWakesTarget: false
    authoritativeResult: 'last_accepted_captured_return_current_run_retry_generation'
    finalReturnMustBeComplete: true
    fallback: {
      source: 'successful_runtime_final_output'
      when: 'no_captured_return_current_run_retry_generation'
    }
  }
  delegation?: {
    newA2aDispatchAllowed: false
    newA2aTargetContactAllowed: false
    capturedGatherReturnBlockedByDelegationBudget?: false
  }
}
```

全部 optional fact 缺失时，Formatter 20 省略整个 `RUN_FACTS` section。模型没有另一个稳定字段告诉它
Camp 已发布附件根在哪里；仅把目录加入 Runtime allowlist 不能证明模型可以主动发现该根。

### 5. 当前恢复边界

- `runtime_input_delivery = accepted` 只证明 Runtime 接受输入，不证明执行或外部效果完成；
- `prepared` 崩溃后必须先按 delivery uncertainty 收敛，不能猜测为未发送；
- accepted 且结果未知的 Run 只能诚实收敛为 `failed/accepted_input_outcome_unknown`；
- ContextManifest、模型输入 bytes、Runtime Input Delivery、Native Binding 和 Run status 是不同 evidence；
- Migration 98 已把当前 store 推进到 schema 53、Formatter 20、Manifest 19、Profile 4。

## 变更后

### 1. 新版本轴

revision 2 提议的完整版本轴为：

```text
Native Session Bootstrap Contract: native_session_bootstrap_v3 (unchanged)
Bootstrap Formatter:              3 (unchanged)
AgentRun Context Formatter:       21
ContextManifest Evidence:         20
Context Delivery Profile:         4 (unchanged)
RUN_FACTS Schema:                 2
Gather Completion Input:          3 (unchanged)
Camp Attachment View Contract:    1 (new)
Camp Attachment View Receipt:     1 (new)
Runtime Attachment Auth Receipt:  1 (new)
ACP Host Compatibility Digest:    schema 3
Codex Host Compatibility Digest:  schema 2
Data Contract:                    v1.15 (unchanged)
Projection Schema:                54
Latest Migration:                 99
```

Formatter 21 是唯一的新附件 path 与 `RUN_FACTS.campResources` formatter。Profile 保持 v4，因为消息候选、
排序、数量/字符预算、omission 和裁剪优先级不变；新根路径和 mandatory Run Fact 改变实际 UTF-8 bytes，
因此 Formatter 21 必须用最终路径重新测量现有 Runtime payload budget。

### 2. 术语、权威与授权

| 术语 | 精确定义 |
| --- | --- |
| Authority Attachment | `<data_dir>/camp-attachments/` 中由 Camp Attachment v1 管理的不可变快照。 |
| Draft Attachment | 仍由 `prepared_attachment` 引用、尚未被成功发送事务消费的 Core-private 附件。 |
| Published Attachment | 已由成功 Camp Message 发送事务写入 `message_attachment` 的 Camp 共享附件。 |
| Instance Runtime Files Root | 当前 Desktop/Core 实例独占、可删除、可重建的派生文件根。 |
| Camp Published Attachment View | 一个 Camp 全部 Published Attachment 的 Runtime 可读、只增不改视图。 |
| View Entry | 一个 attachment ID 在当前 Camp View 中唯一、稳定、不可变的副本。 |
| View Generation | Camp View 每次成功追加或受控重建后单调递增的兼容性事实。 |

权威关系固定为：

```text
prepared_attachment ──成功 Camp Message publication──> message_attachment
       Draft / Core-private                               Published / Camp-shared
                                                                  │
                                                                  └─copy + verify─> View Entry
```

授权合同为：

- Draft 只存在于权威存储，不进入 Runtime View，也不能由任何 Agent 枚举；
- Published Attachment 对当前 Camp 全体 Agent 可枚举、可读，不要求进入当前 Prompt；
- Context selection 只决定显式显示哪些 attachment path，不授予或撤销 Camp 文件权；
- 发布者、接收者、Run、Conversation、Native Session 和模型预算都不缩小 Camp 共享范围；
- 其他 Camp、Draft、authority metadata 和 instance parent 不属于该授权；
- 同一个 attachment ID 的内容变化必须产生新 ID；Published Entry 在 Camp 生命周期内不替换、不删除。

Runtime View 是派生数据；`message_attachment`、Authority Attachment 和 contentDigest 继续是真源。

### 3. Instance Runtime Files Root

#### 3.1 macOS

Electron Main 从已经生效的 canonical `userDataPath` 派生实例 key：

```text
instance-key = "v1-" + lowercase_hex(
  SHA-256("rovai-runtime-camp-files-instance-v1\0" || utf8(canonicalUserDataPath))
)

instance-runtime-files-root =
  <canonical Electron home>/.rovai/instances/<instance-key>/runtime-files
```

SHA-256 使用完整 64 个 hex 字符，不截断。正式 App、`pnpm dev`、显式 `--user-data-dir` 和隔离验收实例因
canonical userDataPath 不同而得到不同根；同一路径的 symlink alias canonicalize 后得到同一个 key。

Desktop 启动 Core 时必须显式传：

```text
--runtime-camp-files-root <absolute-instance-runtime-files-root>
```

Core 不读取 `HOME` 自行推断，不回退到 `~/.rovai/runtime-files` 或其他全局共享根。缺失、重复、相对或空参数
在打开 SQLite 前失败。

#### 3.2 Windows

Windows 不使用用户 Home 隐藏目录。Desktop 仍显式传同一个参数，但精确根是现有 protected Core data root
中的受管 child：

```text
<data_dir>\runtime-files
```

默认安装对应：

```text
%LOCALAPPDATA%\Rovai AI\Core\runtime-files
```

这是 Windows Private Storage 对派生 Runtime 文件的唯一 overlap 例外，不是新的 Authority Attachment 根。
Runtime 只收到其下精确 Camp `attachments` 根，不收到 `<data_dir>` 或 `runtime-files` parent。

#### 3.3 Root admission 与锁

Core 按固定顺序取得 data-dir instance lock，再取得 runtime-files-root exclusive lock，进程存续期不释放。
root admission 必须证明：

- 参数是绝对、规范化路径；
- 从受信 anchor 到 root 的每个既有组件都不是 symlink/reparse point；
- macOS root 与 `data_dir`、Authority Attachment、Managed Blob、Skill root、SQLite、workspace 互不包含；
- Windows 只允许上节精确受管 child，仍拒绝与 Authority Attachment、workspace 或另一个实例根重叠；
- root 位于当前用户拥有的本地文件系统；macOS private root 为 `0700`，Windows 满足 protected DACL/local
  NTFS admission；
- root marker 的 schema、instanceKey、dataDirIdentityDigest、platform 与实际 volume/file identity 一致；
- ancestor 中不存在另一个 runtime-files-root marker，root 内也不存在不同 instance marker；
- `.runtime-camp-files.lock` 的 OS exclusive lock 可取得；
- 每次 dispatch 再检查当前 canonical workspace 没有与 root 漂移为重叠。

marker 不保存 data-dir 明文路径。marker、identity 或 containment 不一致时 fail closed；Core 不接管、不清空
未知目录。

### 4. View 布局与稳定路径

```text
<instance-runtime-files-root>/
├── .runtime-camp-files-root.json
├── .runtime-camp-files.lock
├── .staging/
│   └── <operation-id>/...
└── camps/
    └── <camp-id>/
        └── attachments/
            └── <attachment-id>/
                └── payload/
                    └── <authority-safe-leaf>
```

`.staging`、marker、lock 和 `camps` parent 都不授权给 Runtime。每个 Runtime 只收到：

```text
<instance-runtime-files-root>/camps/<current-camp-id>/attachments
```

禁止传入 instance root、`camps` parent、其他 Camp root 或 `<data_dir>/camp-attachments`。

`authority-safe-leaf` 复用 Camp Attachment ingress 已冻结的安全末级名称；模型可见 `name` 继续使用原始
`displayName`。Camp ID、attachment ID 和 leaf 分别通过单组件 parser，拒绝 `/`、`\`、NUL、`.`、`..`、
Windows 保留名、尾随点/空格和多组件解释。

同一 Camp/attachment ID 的稳定路径为：

```text
<root>/camps/<camp-id>/attachments/<attachment-id>/payload/<authority-safe-leaf>
```

同一 ID 被多处 Context 或未来多条消息引用时复用同一路径和同一物理 Entry。View 不保存
`.rovai-attachment.json`、索引文件、display metadata、receipt 或其他 Core-private sidecar。

### 5. PublishedAttachmentPathResolver v1

唯一 resolver 输入为：

```text
admitted instance root
+ canonical camp ID
+ published attachment ID
+ persisted ready View Entry receipt
+ authority-safe-leaf
```

输出为 exact absolute Runtime path、当前 Camp exact authorization root 和 receipt digest。resolver：

- 只接受属于该 Camp `message_attachment` 的 ready Entry；
- 不从 `storage_path` 做字符串前缀替换；
- 不扫描 Authority Attachment 目录发现候选；
- 不接受模型文本、Manifest 或 CLI 提供的 arbitrary absolute path；
- 被 Current Input、Origin、Reference、Recent、Shared Conversation、A2A preflight、恢复验证、Manifest 和
  Runtime launch 共用；
- 任一调用得到不同 canonical root/path/receipt digest 时 fail closed。

Authority `storage_path` 只供 CampAttachmentStore 打开复制源；它不再进入新的模型输入或 Runtime launch。

### 6. Formatter 21 的完整模型变化

section 顺序保持不变，但 `RUN_FACTS` 因 mandatory `campResources` 在每个 AgentRun 都存在：

```text
COLLABORATION_STATE?
→ SELF_ACTIVE_TASKS?
→ SHARED_CONVERSATION?
→ RUN_FACTS
→ A2A_GUIDANCE?
→ CURRENT_INPUT
```

新的完整 `RUN_FACTS` shape 为：

```ts
type RunFactsV2 = {
  schemaVersion: 2
  campResources: {
    campId: string
    publishedAttachmentRoot: string
    access: 'enumerate_and_read'
    scope: 'current_camp'
    mutability: 'read_only'
  }
  taskContext?: {
    taskId: string
    referenceMode: 'frozen'
    laterChangesRetargetRun: false
  }
  sessionContinuity?: {
    state: 'lost'
    requiredAction: 'recheck_private_session_assumptions'
  }
  externalEffect?: {
    state: 'unsettled'
    requiredAction: 'reconcile_before_repeat'
  }
  gather?: {
    role: 'member'
    returnTarget: 'current_input_source'
    returnWakesTarget: false
    authoritativeResult: 'last_accepted_captured_return_current_run_retry_generation'
    finalReturnMustBeComplete: true
    fallback: {
      source: 'successful_runtime_final_output'
      when: 'no_captured_return_current_run_retry_generation'
    }
  }
  delegation?: {
    newA2aDispatchAllowed: false
    newA2aTargetContactAllowed: false
    capturedGatherReturnBlockedByDelegationBudget?: false
  }
}
```

`campResources` 是模型主动发现 Camp 文件的唯一入口；它不是附件列表，也不复制每个附件 metadata。其余
Run Fact 字段、literal、出现条件和键顺序与 v1 相同。

Current CampMessage 输入变为：

```ts
type CurrentCampMessageInputV21 = {
  source:
    | { type: 'user' }
    | { type: 'member_call'; senderAgentId: string; senderName: string }
  message: string
  mentionsCurrentUser: boolean
  skills?: Array<{ name: string; path: string }>
  attachments?: string[] // PublishedAttachmentPathResolver v1 path
}
```

Gather Completion Input v3 的字段、排序、request/item shape 和摘要完全不变；其 optional 顶层
`attachments` 若存在，也使用同一 resolver。ConversationMessage member call 仍无附件字段。

Shared Message occurrence 变为：

```ts
type SharedMessageAttachmentV21 = {
  name: string
  mediaType: string
  path: string // PublishedAttachmentPathResolver v1 path
}
```

除此之外，Shared Message 的 `messageId / sequence / senderType / senderId / replyToMessageId / body /
mentionsCurrentUser / nextBodyOffset`、Current Input、A2A Guidance、Task、Collaboration State、Skill link 和
omission shape 均不变。

### 7. Context materialization 与 A2A

每个 direct 或 A2A 输入使用同一顺序：

```text
1. 取得 Camp View read lease，要求整个 View = ready
2. 冻结 root identity、minimum ready generation 和 catalog digest
3. 执行现有 Profile v4 消息选择、reference closure、Task 与 omission
4. 用 PublishedAttachmentPathResolver v1 解析全部显式 occurrence
5. 加入 mandatory RUN_FACTS.campResources
6. 按 Formatter 21 的最终 UTF-8 bytes 执行现有 Runtime payload 裁剪
7. 冻结 ContextManifest v20、Managed Blob 和 prepared Runtime Input Delivery
8. dispatch 前再次取得同一 Camp View read lease并验证 append-only compatibility
```

View read lease 与 publication/rebuild/delete mutation gate 互斥。任何 Published Entry pending、缺失、摘要不符或
View catalog 未收敛时，当前 Camp 的 direct materialization、A2A preflight、launch、resume 和 prompt dispatch
全部关闭；不能只检查本轮显式引用，因为 Agent 获得的是整个 Camp catalog。

不新增 `LogicalContextPlan`。View 路径在 Camp 生命周期内稳定，现有 selector 可以在同一 materialization
边界直接用最终路径测量并冻结。A2A prospective preflight 与 direct 共用 selector、resolver 和 receipt；已冻结
Delivery 的 retry/recovery 复用 exact Formatter 21 bytes，不重选历史、不改写路径。

View generation 可以在 Manifest 冻结后因另一个已发布附件单调增加。只要 root identity 不变、旧 Entry receipt
仍一致且 current generation 是 receipt generation 的同一 append-only 后继，旧 frozen input 仍可 dispatch；
实际 launch generation 由 Runtime Attachment Auth Receipt v1 另行记录。重建 generation、root identity 变化或
Entry 漂移不是 append-only 后继，必须 fence。

### 8. ContextManifest v20 与 Runtime evidence

Manifest v20 保留 v19 的全部 selection、Profile、Current Input、Shared Message、Task、omission、Bootstrap、
Skill/MCP 和 exact payload evidence。Current `attachmentRefs` 与每个 Shared Message attachment evidence 的
shape 不变，唯一语义变化是 `path` 必须为 Camp View path。

每个 Manifest 另存：

```ts
type CampAttachmentViewReceiptV1 = {
  schemaVersion: 1
  campId: string
  publishedAttachmentRoot: string
  rootIdentityDigest: string
  minimumReadyGeneration: number
  catalogEntryCount: number
  catalogDigest: string
  referencedAttachmentIds: string[]
  referencedAttachmentSetDigest: string
}
```

`referencedAttachmentIds` 是最终模型输入全部 Current/Origin/Reference/Recent/Shared occurrence 的 attachment ID
去重并按 UTF-8 bytes 排序；没有显式 occurrence 时为空数组。`catalogDigest` 对该 generation 全部 ready Entry
receipt 的 canonical JSON 排序结果计算，只保存 digest，不把完整 Camp catalog 放入 Manifest 或模型。

Manifest v20 新增或收紧：

```text
context_manifest_version = 20
run_facts_schema_version = 2
camp_attachment_view_receipt_version = 1
camp_attachment_view_receipt_json
camp_attachment_view_receipt_digest
```

Runtime Input Delivery 增加：

```ts
type RuntimeAttachmentAuthReceiptV1 = {
  schemaVersion: 1
  campId: string
  publishedAttachmentRoot: string
  rootIdentityDigest: string
  dispatchGeneration: number
  catalogDigestAtDispatch: string
  visibilityMode: 'live_append_v1' | 'generation_fenced_v1'
  compatibilityGeneration: number | null
  manifestViewReceiptDigest: string
}
```

`live_append_v1` 的 `compatibilityGeneration` 必须为 null；`generation_fenced_v1` 必须等于
`dispatchGeneration`。Runtime requestDigest 继续绑定 exact payload、Binding identity 和实际 launch input，
并新增 Auth Receipt digest。只有 Runtime accepted ACK 证明这些 bytes 真正被接受。

Migration 99 为历史 row 增加显式 `context_manifest_version = 19`，新 row 固定为 20；Schema 允许读取
`Manifest19/Formatter20/no-view-receipt` 与写入 `Manifest20/Formatter21/ViewReceipt1` 的封闭 pairing，安装
只读 trigger 禁止迁移后新增旧 pairing。不存在 dispatch-time path replacement、v21→v20 fallback 或 dual write。

### 9. Camp View 持久状态与 journal

Projection Schema 54 新增三个 Core-private 派生状态集合：

```text
camp_attachment_view
camp_attachment_view_entry
camp_attachment_view_operation
camp_attachment_view_operation_entry
```

`camp_attachment_view` 每 Camp 恰好一行，至少拥有：

```text
camp_id
state = initializing | ready | mutating | rebuilding | integrity_failed | cleanup_pending
generation
root_relative_path
root_identity_digest
entry_count
aggregate_bytes
catalog_digest
active_operation_id?
last_error_code?
created_at / updated_at
```

`camp_attachment_view_entry` 每个 Published Attachment ID 恰好一行，至少拥有：

```text
camp_id + attachment_id
kind / byte_size / file_count / directory_count / node_count
content_digest
authority_safe_leaf
root_relative_final_path
entry_identity_digest
published_generation
publication_operation_id
created_at
```

Entry receipt 只存在 SQLite，不复制到 Runtime View。

operation kind 为：

```text
publish | initial_backfill | controlled_rebuild | camp_delete_cleanup
```

publication operation 的封闭状态为：

```text
planned → copying → staged → gated → promoting → promoted → committing → committed → completed
                  ↘ rolling_back → rolled_back
                                      ↘ recovery_required
```

OperationEntry 保存 expected authority receipt、root-relative staging/final path、staging/final identity 和
`planned | copied | promoted | committed | rolled_back`。每次推进使用短事务；复制、递归摘要、chmod、fsync、
rename 和删除都不在 SQLite transaction 内。

所有 filesystem mutation 从已打开 instance root handle、typed Camp/attachment/operation ID 与 root-relative path
重建；SQLite、Manifest、CLI、模型文本或目录项中的 absolute path 永远不能直接成为递归删除目标。

### 10. Camp Message 附件发布线性化

revision 2 采用“先在 Runtime 不可达位置完成复制，再在短 gate 内 promote 并提交既有消息事务”。
`projection_pending` 只允许作为未接受消息的 Core-private operation state，不成为已公开 CampMessage 的状态。

完整顺序为：

#### 10.1 Preflight 与 staging

1. 在短事务中按 command ID、Camp、Draft ID/revision、Prepared Attachment ID 顺序、authority receipt 和 quota
   注册幂等 publication operation；这一步不消费 Draft、不创建公共 CampMessage/Turn/Run；
2. 从 CampAttachmentStore 的 no-follow handle API 打开每个 Authority Attachment；
3. 复制到 `<instance-root>/.staging/<operation-id>/`，普通文件总是新 inode，目录按 Camp Attachment v1
   canonical 顺序遍历；
4. 拒绝 symlink/reparse point、hardlink source、socket、FIFO、device、mount escape 和类型/identity drift；
5. 不复制 executable mode、ACL、xattr、resource fork 或 `.rovai-attachment.json`；
6. 重新计算 contentDigest、byteSize、fileCount、directoryCount、nodeCount、depth，和 authority receipt 对比；
7. staging directory/file 使用 `0700/0600`，全部 flush/fsync 且校验通过后进入 `staged`。

任一失败只删除本 operation 的 staging subtree；Draft、Prepared Attachment 和公共 timeline 不变。

#### 10.2 Camp View mutation gate

Core 取得 per-Camp mutation gate，关闭该 Camp 的新 Context freeze、Host acquire、resume 和 prompt admission。
已有 Busy Runtime route 必须先自然进入可靠 quiescent；publication 不取消活跃 Run。无法在调用方 command
deadline 内取得 gate 时返回 `camp_attachment_view_busy`，Draft 保持原 revision，staging 清理或由同 command
幂等重试接管。

只有同时满足下列条件的 IdleWarm Host 可以在 gate 期间保留：

- Fleet 证明没有 active Run lease、prompt、tool route 或 built-in lease；
- Adapter qualification 证明 IdleWarm 不会自主访问附件目录，并在 Core transport/liveness 丢失时停止或失效；
- visibility mode 已证明为 `live_append_v1`。

其余 Host 在 promote 前 fence/stop。该 gate 是受管调度正确性边界，不是对恶意同 UID 进程的强隔离声明。

#### 10.3 Promote 与消息 acceptance

持有 gate 后：

1. 再验证 staging identity、receipt 和 quota reservation；
2. 把 Runtime-visible directory 设为 `0500`、file 设为 `0400`；
3. 仅在 rename 的最短窗口临时给予 destination `attachments` parent owner-write；
4. 将完整 `<attachment-id>` subtree 在同一 filesystem 原子 rename 到稳定路径，随后恢复 `0500` 并 fsync
   parent；
5. 多附件逐项 journal；目标已存在时只接受已 committed、attachment ID 和完整 receipt 均一致的 Entry，
   digest 不同永不覆盖；
6. 全部 Entry promote 后，在一个短 SQLite transaction 中重新验证 command/Draft/Camp/version/quota/gate，
   执行现有 all-or-none CampMessage、message_attachment、CampTurn、AgentRun/Delivery、Draft consumption 和
   notification mutation，同时写 View Entry receipts、增加一次 Camp generation并把 operation 标为 committed；
7. SQLite commit 是 Camp Message 正式发布和 Draft→Published 授权切换的线性化点；commit 成功时全部路径已经
   存在并通过校验；
8. commit 后标记 completed、释放 gate并唤醒现有 dispatch pump。

SQLite commit 失败时，按 journal 反向删除本 operation 新 promote 的 Entry，Draft 仍未消费、CampMessage
不存在。回滚不完整时 View 进入 `integrity_failed/recovery_required`，所有 Camp Runtime admission 关闭；
绝不为了恢复可用性接受一个缺附件的公共消息。

#### 10.4 Crash recovery

| Crash point | 启动恢复 |
| --- | --- |
| planned/copying | 清理或继续精确 staging operation；无公共消息。 |
| staged/gated | 验证后重试 gate，或回滚；无公共消息。 |
| partial promoted，消息事务未 commit | 在任何 Host admission 前按 journal 删除本 operation final Entry；Draft/消息 DB 事实决定 rollback。 |
| 消息事务已 commit，operation 未 completed | 验证 `message_attachment`、Entry receipt 和路径后一致性 adopt 为 completed；不重新复制。 |
| commit outcome 可由 SQLite 查询确定 | 有 matching CampMessage/Entry rows 即 adopt；没有即 rollback，不凭进程/日志猜测。 |
| committed Entry 缺失或篡改 | View `integrity_failed`、fence Camp Host，进入受控 rebuild；不在活跃 Host 下静默补文件。 |
| cleanup/rebuild 中断 | 只按 typed root-relative journal 继续；未知目录保留并阻断，不扩大删除范围。 |

Core startup 必须先取得 instance locks、完成 SQLite recovery 和 View journal convergence，再允许任何 Runtime
launch。managed Host 的 Core-liveness 行为必须在真实 acceptance 中验证；不能用“通常会退出”填补 crash 窗口。

### 11. Runtime launch、Camp identity 与 Host compatibility

所有 Adapter 都只消费当前 Camp exact `attachments` root。Camp root、Formatter 21/Manifest 20 和 Runtime
Attachment Auth Receipt v1 进入实际 Runtime/Native Binding compatibility；同一 Agent 在 Camp A 与 Camp B
不能复用同一个 Host/Session/Binding。

ACP Host Compatibility Digest schema 3 在 schema 2 现有字段上把旧 `attachmentAccessRoot` 替换为：

```json
{
  "schemaVersion": 3,
  "campAttachmentViewContractVersion": 1,
  "campAttachmentRoot": "/absolute/current-camp/attachments",
  "campAttachmentVisibilityMode": "live_append_v1",
  "campAttachmentGeneration": null
}
```

`generation_fenced_v1` 时最后一项必须是当前正整数 generation。Codex Host Compatibility Digest schema 2
加入相同四个语义字段；one-shot Adapter 把它们作为 frozen launch receipt，不虚构额外 Host schema。

规则为：

- `live_append_v1`：compatibility 不含 generation；同一 root 原子追加后可继续复用已证明兼容的 IdleWarm Host；
- `generation_fenced_v1`：compatibility 包含 generation；每次附件发布使旧 Host 不兼容，gate 内 fence/stop，
  下一次 dispatch 仍授权同一个 Camp root；
- `unsupported`：Adapter 没有可信目录授权时，该 Camp 的 Runtime dispatch fail closed；不退回 authority root，
  也不授权 instance/Camps parent。

对所有可复用 Host，`generation_fenced_v1` 是未取得真实正向证据时的默认值。one-shot Runtime 每次启动自然
获得当前 generation，但仍记录 Auth Receipt。

### 12. TRAE Warm Host Probe

TRAE 的 `live_append_v1` 必须由隔离、可重复的真实 Probe 取得，绑定：

```text
platform + architecture
TRAE executable fingerprint + reported version
ACP protocol/initialize capability digest
permission/sandbox/launch configuration digest
Camp Attachment View Probe contract v1
```

功能序列为：

```text
1. 在临时 instance root 创建空 Camp attachments root
2. session/new 只授权该 exact root；第一轮确认可枚举且为空
3. 第一轮可靠 terminal，证明同 Host/Session 进入 quiescent IdleWarm
4. 通过正式 staging + mutation gate + publish 流程原子加入 file attachment A
5. 同一 Host/Session 第二轮主动枚举 root、读取 A并核对内容
6. 再原子加入含 dotfile/空目录/普通文件的 directory attachment B
7. 同一 Host/Session 第三轮枚举并读取完整目录
8. 证明全程未再次 session/new/load，root/Host/Session identity 不变
```

同一 artifact 还必须验证：

- IdleWarm 没有 active prompt/tool/built-in lease，Core transport 丢失时 Host 退出或被可靠 fence；
- Runtime 未收到 instance/Camps/other-Camp/authority root；
- Draft、`.staging`、marker、journal、`.rovai-attachment.json` 和 Core metadata 不可通过授权根枚举；
- projected file/directory 普通写入失败；
- 已知 sibling Camp 和 Authority Attachment 的可读性按实际 sandbox 证据分类；
- source 特殊节点在 publish 前被拒绝。

功能结论为：

```text
live_append_visible | startup_snapshot_only | indeterminate
```

安全结论独立为：

```text
runtime_sandbox_enforced | same_uid_sandbox_dependent | unsafe_ambient_access
```

只有 `live_append_visible` 且 quiescence/liveness 条件通过，才启用 TRAE `live_append_v1`。其余可安全授权结果
使用 `generation_fenced_v1`；`unsafe_ambient_access` 阻断附件 Runtime 能力，重启 Host 不能伪装成隔离修复。

### 13. 配额与失败语义

Authority ingress 既有限额继续先行适用：

| Boundary | Limit |
| --- | ---: |
| Top-level attachments per Draft/send | 10 |
| One regular file | 25 MiB |
| Aggregate bytes per Draft/send | 64 MiB |
| Regular files inside one directory attachment | 2,000 |
| Files + directories below one directory root | 4,000 |
| Maximum directory depth | 32 |

Camp View v1 新增按 unique attachment ID 计数的累积限额：

| Boundary | Limit |
| --- | ---: |
| One Camp Published View aggregate bytes | 4 GiB |
| One instance all Camp Views aggregate bytes | 16 GiB |
| One instance aggregate staging bytes | 512 MiB |
| Concurrent staging operations per instance | 8 |

同一 ID 的多个 Context occurrence 只计一次。额度 reservation 与 commit 在 SQLite 中串行，staging 完成后按
实际遍历结果复核；filesystem ENOSPC、copy、digest、fsync、rename 或 quota 失败发生在消息 acceptance 前，
公共消息不创建、Draft 不消费。已发布 Entry 不因配额被驱逐，Core 不静默裁剪附件、不自动删除旧 Camp 文件，
也不把消息置于永久 pending。

Migration 99 backfill 先对现有全部 `message_attachment` 做精确 quota preflight；若当前本机事实已经超过任一
新累积限额，迁移在修改 Schema、DB 状态或 View 前 fail closed并给出精确诊断，不能丢弃历史附件来通过门禁。
这些数值是 revision 2 待确认合同；调整任一数值必须递增 revision。

### 14. 权限与真实安全边界

macOS/Unix mode：

```text
instance private root / staging      0700
staging file                         0600
Core-only traversal parent           0100
Runtime-visible attachments/dirs     0500
Runtime-visible regular files        0400
```

Core 在 mutation gate 内仅为必要 parent 临时增加 owner-write，随后恢复并复核。Windows 使用 protected DACL、
no-reparse handle 和等价只读加固。所有输出文件是 copy-created 新 inode；不使用 symlink 或 hardlink。

这些 mode 是防误写与完整性加固，不是同 UID/SID 进程间强隔离。真实边界为：

- Rovai 只向 Adapter 传当前 Camp exact root；
- Host compatibility 同时绑定 Camp ID、Agent ID 和 exact root；
- Runtime sandbox/native directory allowlist 必须通过 Adapter×platform 真实 Probe；
- 如果同 UID Runtime 可绕过 allowlist读取已知 sibling path，则跨 Camp 保证只能标为
  `same_uid_sandbox_dependent`，不能宣称 POSIX mode 已提供强隔离；
- 如果存在无约束 ambient filesystem access，附件能力 fail closed，不能把 opaque ID 当 access control；
- workspace write、Runtime permission、Built-in lease、Camp attachment read 是独立 capability；
- Authority Attachment、metadata、Draft 和其他 Camp 从不因某一 capability 自动授权。

每次 dispatch/resume 复核 root identity、mode、View state、Entry receipt 和 append-only generation。检测到
修改、删除、多出非法节点或 identity drift 时 fence Camp View/Host；不在同一路径、活跃 Host 背后静默修复。

### 15. 生命周期、完整性与清理

```text
Create empty Camp View:
  Camp 初始化或首次 backfill 时

Publish Entry:
  Camp Message 附件发送事务 commit 时

Retain:
  Camp 存在期间；Run/Session/Context 生命周期不影响 Entry

Append:
  后续 Published Attachment 在 mutation gate 下增加稳定 Entry

Controlled rebuild:
  startup/integrity recovery 中，所有相关 Host 已 fence且有 durable journal

Delete:
  Camp 永久删除后的受管 cleanup
```

Core startup 对每个 Camp 比较：

```text
Desired = 全部 message_attachment（包括不再进入 Context 的历史消息）
Actual  = 当前 View Entry receipts + filesystem entries
```

规则为：

- Migration/backfill 尚无 committed Entry receipt 的 missing item 可以从 authority 物化；
- journal 中断项按 crash matrix adopt 或 rollback；
- committed ready Entry 缺失、摘要不符或被替换是 integrity incident，不是普通 cache miss；
- integrity incident 先标记 `integrity_failed`、停止/fence Camp Hosts并保存诊断，再通过独立
  `controlled_rebuild` operation 重建整个 Camp View、复核全部 Authority digest并增加 generation；
- Authority 本身不一致时 fail closed，不以当前 View 内容反向修复 authority；
- filesystem 有合法 typed attachment ID、但 DB 不存在对应 `message_attachment`/operation 时才是 orphan；
- 未知名称、symlink/reparse point、跨 volume identity 或 containment 异常保留并阻断，不递归跟随。

Camp 删除事务前捕获 typed Camp View cleanup identity并 fence/stop相关 Host；业务删除仍按现有 Camp aggregate
合同提交，派生 View 通过 post-commit journal清理。清理失败不复活 Camp，下一次 startup 根据 captured identity
继续；Authority Attachment 继续由现有 Camp attachment cleanup boundary 管理。

### 16. Migration 99、历史回填与本机 clean break

Migration 99 只接受完整 `v1.15 / schema 53 / Migration 98 / Formatter 20 / Manifest 19 / Profile 4` store，
推进到 schema 54。它兼容读取历史终态 evidence，但禁止任何旧非终态 Formatter 20 输入继续 dispatch。

#### 16.1 执行前门槛

1. 旧 Rovai Desktop、Core 和全部 Runtime 已退出；
2. 新 Core 取得 data-dir lock 和正确 runtime-files-root lock；
3. root marker/admission、DB source matrix 和 authority attachment preflight 全部通过；
4. 保存非终态 Run/Delivery/Action 分类与全部 Published Attachment count/digest；
5. quota/backfill preflight 通过；
6. 任一条件失败时不修改 SQLite、Authority Attachment 或现有历史 evidence。

#### 16.2 非终态 accepted-input 分类

Migration 不能只看 `agent_run.status`：

| Evidence | Clean-break 结果 | 必须保留 |
| --- | --- | --- |
| 可证明 prompt 未 handoff；无 accepted/delivery-unknown input、无可能外部效果 | `cancelled / camp_attachment_view_v1_clean_break` | 原 Manifest/Blob（若存在）、未接受 Delivery 与审计。 |
| prepared 且 handoff 不能排除，或已有 delivery_unknown | `failed / input_delivery_outcome_unknown`；Delivery 保持 uncertainty | checkpoint、Manifest/Blob 和 uncertainty evidence。 |
| accepted 且已有可靠失败终态 | 按可靠 settlement 收敛为对应 failed | accepted ACK、执行和失败 evidence。 |
| accepted，但结果/工具/外部效果无法证明 | `failed / accepted_input_outcome_unknown`，`manualRetryAllowed=false` | accepted Delivery、Manifest/Blob、Execution/Action/Git/Workspace evidence。 |
| Action 可证明未派发 | Action `not_executed / ...clean_break`，再按 input evidence 分类 Run | Action/Attempt/Approval audit。 |
| Action 可能派发或 active unknown | 保持 effect unknown，resolutionSource=`migration`；Run 不得普通 cancelled | 全部外部效果不确定性 evidence。 |

Pending/running A2A Delivery、Gather 和 CampTurn 按目标 Run 收敛；从未尝试 dispatch 的 Delivery 保持现有
`interrupted_before_dispatch` 边界。旧 frozen input/Manifest/Blob 可标为 legacy/non-dispatchable，但不删除、
不改 bytes、不改 digest。

#### 16.3 Binding 与历史 evidence

clean break：

- fence 所有旧 Native Binding/Session/Host，清除 current resume/compatibility/secret/accepted-boundary pointer；
- 保留旧 Binding ID/generation 在历史 Delivery、Bootstrap、Manifest 和 fence audit 中的引用；
- 下一 Binding 使用更高 generation 与 Formatter21/Manifest20 compatibility，不把 generation 重置为 0；
- 所有旧非终态输入终结后，不允许 Formatter20 Manifest 进入 launch/resume/dispatch。

以下逐 byte/逐 row 保留：

```text
prepared_attachment
message_attachment 及 authority storage_path
<data_dir>/camp-attachments/
历史 ContextManifest v19 / Formatter20
历史 rendered/runtime model-input Managed Blob
历史 attachment contentDigest 与 Context Summary
历史 Runtime Input Delivery/accepted ACK
历史 Execution/Action/Approval/Git/Workspace evidence
历史终态 AgentRun、CampMessage、Task、Memory 与 audit event
```

不做 SQL 路径前缀替换，不重算历史摘要，不把历史 authority path 改成 View path。

#### 16.4 Published View 回填

Migration SQLite transaction 只安装 schema、终结旧非终态输入并为每个 Camp 建立 `initializing` desired state；
不在 transaction 中复制文件。随后在所有 Runtime admission 关闭时：

1. 从空、已验证的当前实例 Runtime Files Root 开始；
2. 只查询 `message_attachment`，按 Camp ID、attachment ID 稳定排序；
3. `prepared_attachment` 永不进入 desired set；
4. 通过正式 staging/copy/verify/publish journal 建立全部 Camp View；
5. 每个 Camp 完整 catalog 成功后一次性提交 ready generation/catalog digest；
6. backfill 未 ready 的 Camp 不能启动、恢复或 dispatch Runtime；
7. 全部历史 View path 只服务后续新 Context，历史 Manifest/Blob 保持原值。

数据不兼容清理只能删除 marker/lock/identity 已证明属于当前实例的派生 root，并从
`message_attachment` 重建；不能触达 Authority Attachment、SQLite、Managed Blob、workspace 或其他实例。

### 17. 失败分类

| Code | 行为 |
| --- | --- |
| `runtime_camp_files_root_invalid` | Core startup fail closed；不打开/迁移 SQLite。 |
| `runtime_camp_files_root_locked` | 第二实例拒绝启动；不清理 root。 |
| `camp_attachment_view_not_ready` | 当前 Camp materialization/launch 阻断，等待 journal/backfill 收敛。 |
| `camp_attachment_view_busy` | publication 未取得 mutation gate；Draft 与公共消息不变。 |
| `camp_attachment_view_source_invalid` | 特殊节点、identity/type drift 或 path escape；消息 acceptance 前失败。 |
| `camp_attachment_view_digest_mismatch` | authority/复制摘要不一致；不猜测新 digest。 |
| `camp_attachment_view_quota_exceeded` | 消息 acceptance 前 deterministic failure；不裁剪、不驱逐。 |
| `camp_attachment_view_storage_unavailable` | ENOSPC/fsync/rename 失败；回滚 operation，Draft 保留。 |
| `camp_attachment_view_publish_failed` | 回滚 promoted Entry；不完整则 View recovery_required。 |
| `camp_attachment_view_integrity_failed` | fence Camp Hosts并进入受控 rebuild；不活跃原地静默修复。 |
| `camp_attachment_view_backfill_failed` | 对应 Camp Runtime admission 关闭；历史/authority 保留。 |
| `camp_attachment_view_runtime_unsupported` | Adapter 无安全 exact-root 授权；不退回 authority/public parent。 |
| `camp_attachment_view_generation_mismatch` | 不是同一 append-only 后继；fence Host/Binding，不改 frozen input。 |
| `camp_attachment_view_recovery_required` | startup/dispatch 阻断，等待 journal/显式诊断；不扩大删除。 |

这些 publication 错误都发生在新的 Runtime input accepted 前，不得伪造 accepted ACK。已经 accepted 的历史输入
继续由 Accepted Input Recovery、Action unknown 和 Planned Shutdown 合同拥有。

## 明确不变

- Authority Attachment 继续位于 `<data_dir>/camp-attachments/`，不迁入 `~/.rovai`；
- `prepared_attachment.storage_path`、`message_attachment.storage_path` 和历史引用不改写；
- Camp parent、Attachment parent 不可枚举，authority payload 只读且不可变；
- `.rovai-attachment.json` 只供 Core 使用，不进入 View、Runtime、模型或 Renderer；
- Camp Attachment v1 的 file/directory、displayName、mediaType、fileCount、byteSize、safe leaf、canonical tree
  digest 和 contentDigest 算法/值；
- Draft revision、整组附件发送、Camp timeline、Renderer preview、History/Search 和 `camp.read` metadata 语义；
- Native Session Bootstrap 文本、Bootstrap Formatter 3、Session Charter、Member Identity、Memory Entrypoint 和
  Bootstrap redelivery；
- Formatter section 相对顺序；除 mandatory `campResources` 和附件 path 外的模型字段、literal、键顺序与
  省略规则；
- Profile v4 的 candidate、self-authored filter、origin/reference、数量/字符预算、omission 和裁剪优先级；
- Gather Completion Input v3、Current Input 业务来源、A2A addressing/delivery、Task、Skill 和 MCP 语义；
- Runtime accepted ACK、Manifest、模型 input bytes、Binding/Session 和 Run status 互不替代；
- 历史 Manifest、Blob、摘要、contentDigest 和 evidence bytes/digest 不重写；
- Windows Authority Attachment 继续位于 protected Core data root，不迁入用户 Home；
- POSIX mode/DACL 不被描述为同 UID/SID 强安全隔离。

## 二次确认

当前状态：

```text
revision: 2
confirmation_status: confirmed
confirmed_revision: 2
confirmed_by: murray17
confirmed_at: 2026-08-20T01:51:18+08:00
withdrawn_revision: 1
```

开发者在看到本文完整 revision 2 后以“完成后 push main，打包到 applications”明确授权实施，并要求完成
验证后直接提交、push `main`，构建 macOS App 并安装到 `/Applications`。revision 1 的确认仍保持失效。

以下任一变化必须递增 revision 并重新确认：

- Draft/Published/Camp-shared 授权边界；
- instance-key、平台 root、flag、root admission 或 lock；
- View layout、stable path、resolver 或 Runtime exact-root contract；
- `RUN_FACTS.campResources`、Formatter/Manifest/Profile/receipt 版本；
- publication 线性化点、mutation gate、journal 或 crash adopt/rollback；
- 任一 quota；
- TRAE Probe pass 条件或 generation-fenced fallback；
- backfill、integrity rebuild、Camp deletion 或 orphan cleanup；
- Migration 99 accepted-input 分类或历史 evidence 保留。

## 验证

确认并实施后，至少完成以下可执行验证；本轮只冻结要求，不运行：

1. **Authority/Draft privacy**：staging、失败、重试和 crash 都不让未 accepted Draft 出现在授权 Camp root；
2. **Camp sharing**：Agent A 发布后，Agent B/C 不靠当前 Prompt attachment ref即可从 root 枚举、读取；
3. **Cross-Camp negatives**：Runtime 不收到 instance/Camps/other-Camp/authority root，Draft/metadata 不可枚举；
4. **Formatter 21 fixture**：mandatory RUN_FACTS v2、完整 section order、Current/Shared/View paths 与键顺序稳定；
5. **Model discoverability**：无显式 attachment occurrence 的 Run 仍获得 exact `publishedAttachmentRoot`，并能主动列出；
6. **Resolver parity**：Current、Origin、Reference、Recent、Shared、A2A、Gather、Manifest 和 launch 输出同一 path；
7. **Budget exactness**：新 root 长度和 mandatory fact 计入 UTF-8 byte gate，Profile v4 裁剪优先级不变；
8. **Manifest/Delivery evidence**：Manifest20/ViewReceipt1/AuthReceipt1 canonical digest、minimum/dispatch generation
   和 exact Runtime requestDigest 可复核；
9. **Publish atomicity**：每个 journal transition、copy、fsync、rename、SQLite commit 前后 crash injection；不存在
   accepted 公共消息引用缺失 Entry；
10. **Multi-attachment visibility**：受控 prompt 不能观察半组 Entry；gate timeout 保留 Draft；
11. **Directory fidelity**：普通文件、Unicode、dotfile、空目录完整；symlink/reparse/hardlink/socket/FIFO/device、
    mount escape 和 copy-during-change 全部拒绝；
12. **Permissions**：Unix final directory/file 为 `0500/0400`，临时 write window恢复；Windows DACL/no-reparse 通过；
13. **Quota boundaries**：所有数值 limit-1/limit/limit+1、并发 reservation、ENOSPC 和 backfill over-quota 均 fail closed；
14. **Host compatibility**：Camp A/B、root、visibility mode、generation 与 Formatter/Manifest drift 都拒绝错误复用；
15. **TRAE positive**：正向 Probe 后同一 Warm Host/Session 读取两次原子追加，compatibility generation 为 null；
16. **TRAE fallback**：snapshot/indeterminate 使用 generation-fenced，同一 Camp root不变，新 generation停止旧 Host；
17. **Same-UID disclosure**：sandbox enforced/dependent/unsafe 三类按真实证据报告，不用 mode 位冒充隔离；
18. **Startup backfill**：只从 message_attachment 重建全部 Camp，Prepared 为零，未 ready Camp 不 launch；
19. **Integrity recovery**：ready Entry 修改/删除后先 fence，再 journaled whole-Camp rebuild；Authority mismatch 不修复；
20. **Lifecycle**：Run/Session terminal 不删除，Camp delete捕获并清理精确 root，orphan cleanup不越界；
21. **Migration 99**：schema53→54、全部非终态分类、monotonic Binding generation、历史 v19/Formatter20/Blob/
    accepted evidence byte-preserving且无旧 dispatch；
22. **Platform isolation**：正式、dev、显式 user-data和测试实例 key/root/lock不同；Windows只使用 protected child；
23. **No legacy access**：全仓断言 Runtime launch不再传 Authority Camp root，新模型输入不含 authority path；
24. **Regression**：相关 Rust integration/slow tests、TypeScript launcher tests、固定 Windows CI、真实隔离 TRAE
    acceptance、fmt/clippy、workspace build/tests 与通用文档门禁。

确认后实施必须同步形成或更新当前权威，预计至少包括 Camp Attachment、ContextManifest Evidence、Runtime
Launch and Verification、Accepted Input Recovery、Camp Permanent Deletion、Built-in Tool Runtime、
Foundational Invariants、Windows Private Storage、Runtime compatibility evidence、v1.15 decisions/implementation
plan 与 AgentRun Context v21 fixture。pending 阶段不提前修改这些当前权威。

## References

- [核心模型上下文变更治理](../../development/model-context-change-governance.md)
- [v1.15 版本概览](README.md)
- [已确认的 Profile v4 模型上下文变更](model-context-change-self-authored-recent-messages.md)
- [ContextManifest Evidence v20](../../contracts/context-manifest-evidence-v20.md)
- [Run Facts v2](../../contracts/run-facts-v2.md)
- [Context Delivery Profile v4](../../contracts/context-delivery-profile-v4.md)
- [Camp Attachment v2](../../contracts/camp-attachment-v2.md)
- [Camp Published Attachment View v1](../../contracts/camp-published-attachment-view-v1.md)
- [Camp Published Attachment View architecture](../../architecture/camp-published-attachment-view.md)
- [Camp Message Send v10](../../contracts/camp-message-send-v10.md)
- [Camp Permanent Deletion v2](../../contracts/camp-permanent-deletion-v2.md)
- [Accepted Input Recovery v2](../../contracts/accepted-input-recovery-v2.md)
- [Runtime Launch and Verification v10](../../contracts/runtime-launch-and-verification-v10.md)
- [Camp 资源不变量](../../architecture/foundational-invariants.md#camp-resources)
- [ContextManifest 与结构化 Run Facts 不变量](../../architecture/foundational-invariants.md#context-manifest-run-facts)
- [Runtime 进程与校验不变量](../../architecture/foundational-invariants.md#runtime-process-verification)
- [Runtime 恢复与关闭不变量](../../architecture/foundational-invariants.md#runtime-recovery-shutdown)
- [Runtime Compatibility Evidence](../../runtime-compatibility.md)
- [Windows Private Storage v2](../../contracts/windows-private-storage-v2.md)
