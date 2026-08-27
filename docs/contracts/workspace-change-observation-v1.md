---
document_type: contract
contract: workspace-change-observation
version: v1
status: accepted
last_updated: 2026-08-27
---

# Workspace Change Observation v1

本合同定义 Runtime File Operation presentation、Command Diff projection 与 Workspace Change Window 的 v1
字段、状态、捕获、授权和失败语义。
accepted 只表示目标语义已冻结；当前实现状态由 [v1.29 实施计划](../versions/v1.29/implementation-plan.md)拥有。

## 1. Closed product layers

产品存在三个彼此独立的观测概念：

| 层 | 定义 | 不证明 |
| --- | --- | --- |
| `runtime_file_operation` | Runtime 对一个成功 Tool Operation 以协议结构化字段明确报告的单文件写操作与可靠路径 | old/new 内容、增删行数、当前磁盘状态或最终净变化 |
| `command_diff` | Runtime 对一个精确 Canonical Tool/Command Operation 明确报告的修改 | 当前磁盘最终状态、其他 Operation、单文件完整历史 |
| `workspace_change_window` | 当前 Camp、exact execution root 的重叠 Run 集合在两个稳定 synthetic tree 捕获点之间的 Git 净变化 | 单个 Run/Agent/Tool 的因果归属，或没有用户/外部程序写入 |

三个概念不能互相补全、去重或覆盖。`runtime_file_operation` 与 `command_diff` 可以投影到同一条 Canonical
Activity；前者存在不要求后者存在。非 Git execution root 不创建 Workspace Window。

## 2. Runtime 文件操作与 Command Diff Evidence

### 2.1 单文件操作 admission

ACP v1 的一个 ToolCall 只有同时满足以下条件，才可在其既有 Canonical Activity 上投影一条
`修改 <basename>` 文件操作行：

1. 同一 `toolCallId` 的 terminal `session/update.tool_call_update` 明确为 `completed`；
2. 累计结构化 `kind` 为 `edit | write`。首次可信结构化 kind 不得被后续冲突 kind 覆盖，因而
   `read -> terminal edit` 不可伪造成写操作；
3. 同一 ToolCall 的标准 `locations[].path` 累计状态能确定唯一、非空路径；terminal 省略或给出空 locations 时，
   可以复用该 ToolCall 先前已报告的非空 location；
4. 路径能相对该 Run 冻结的 canonical execution root 做纯词法规范化，且不为空、不含 root escape 或 Git
   metadata path。

该通路不读取 `rawInput`、title、output、shell command 或当前文件，不从成功文案提取路径，也不声明 old/new
内容或增删行数。路径缺失、多个候选、失败、取消、kind 冲突或规范化失败时保持普通 Tool Activity。终态
`runtimeFileOperation` 作为同一条 append-only Execution Evidence 的安全子投影落库，不创建第二条 Activity。

Codex terminal `fileChange` 与 Claude `Edit` exact mutation 本身已经同时证明文件操作与内容，继续直接投影
`修改 <basename>`；Antigravity 没有等价的可靠单文件终态路径，因此不按 Tool 名补造。

### 2.2 Command Diff admission

一个 Runtime event 只有同时满足以下条件才可生成 normalized diff Evidence：

1. `adapterKind + observedRuntimeVersion + eventKind + fieldPath` 命中 Runtime Activity Registry 中的明确 allowlist；
2. allowlist 声明其语义是 `unified_diff_snapshot | complete_patch_snapshot | exact_mutation | complete_before_after`；
3. event 与一个精确 Canonical Activity identity 相关联；
4. 每个路径都能相对该 Run 冻结的 canonical execution root 做纯词法规范化，且不为空、不绝对、不含 root escape
   或 Git metadata path；该检查不解析 symlink target、不打开路径，也不把报告路径升级为文件 identity；
5. bytes、file count 和 patch size 满足对应 adapter profile 的严格上限。

除明确 allowlist 为 `exact_mutation` 的局部替换外，局部 before/after、仅路径、自由文本中的 fenced diff、语义未声明的
`diff` / `patch` 字段和需要读取当前文件才能补全的数据必须拒绝进入 Diff View。可靠的仅路径事件可以按 2.1
生成文件操作行，但仍不得获得 `diffProjection`、`+A −D` 或 inline diff。拒绝可以产生安全 diagnostic，但不能
伪造 diff Evidence。

v1 的 Runtime allowlist 冻结为：

| 协议族 | 可靠终态 | 内容语义 | v1 处理 |
| --- | --- | --- | --- |
| Codex app-server | `item/completed` 且 `item.type=fileChange`、`item.status=completed` | `changes[].kind=update` 的 `diff` 是 unified diff；add/delete 的 `diff` 是完整新/旧内容 | 规范化为逐文件 unified diff 后准入 |
| ACP v1 | `session/update.tool_call_update` 最终累计状态为 `completed` | 标准 `ToolCallContent::Diff { path, oldText?, newText }`；collection update 是 replace，不是 append | 只从该 ToolCall 的终态累计 content 生成完整 before/after Evidence；没有 Diff 时不影响 2.1 的路径操作行 |
| Claude stream-json | `assistant.tool_use(name=Edit)` 与相同 `tool_use_id` 的非错误 `user.tool_result` 配对 | `file_path + old_string + new_string` 只证明一次精确片段替换，不证明真实文件行号或完整文件 before/after | 仅准入 `Edit` 的 `exact_mutation`；保存片段，不读取文件，不生成 hunk 行号 |
| Antigravity stream-json | 没有等价的终态完整文件集合 | Tool 名称和 step terminal 不能证明 patch | 不准入，不按名称推测 |

Codex 的 `item/started`、`item/fileChange/patchUpdated`、`turn/diff/updated` 以及任何名为 `apply_patch` 的 Tool
都不是 v1 Command Diff 数据源。`apply_patch` 输入不解析；异常退出时没有上述可靠终态就不生成文件 presentation。

Kiro `2.18.1` 的实测终态同时包含标准 ACP Diff 与唯一 location，但旧 Evidence 只持久化了
`runtime_diff_path_outside_root`，没有保留被拒绝的原始 path。为覆盖 Kiro 已知的 rooted-relative wire shape，仅当
adapter 为 Kiro、终态只有一个 Diff entry、同 ToolCall 已准入唯一 location，且去掉 Diff path 的根锚后与该
location 完全相等时，Core 才以 location 对齐该 entry。任一条件不满足仍返回
`runtime_diff_path_outside_root`；其他 ACP adapter 不使用此兼容规则。

Claude Code v1 只暂存完整 `assistant.tool_use` 中、`name` 精确为 `Edit` 且字段类型完整的 mutation：

```text
{
  semantics: "exact_mutation"
  path
  oldText
  newText
}
```

只有相同 `tool_use_id` 的 `user.tool_result` 明确非错误时才把该 mutation 写入终态 Evidence。缺失 result、错误、
取消、字段不完整、`old_string == new_string`、`replace_all=true` 或非布尔 `replace_all` 均不生成 Diff；暂存状态随
stream 结束丢弃。`old_string` 不含真实文件位置，因此 Core 不读取 workspace 搜索或补全它，也不生成
`@@ -L,+L @@`。Bash/shell 文本不解析；`Write / NotebookEdit / ApplyPatch` 保持普通 Tool Activity，除非未来协议提供
可靠完整 before/after。

### 2.3 Append-only Evidence

normalized update 至少冻结：

```text
CommandDiffEvidence {
  evidenceId
  agentRunId
  executionEpoch
  canonicalActivityId
  adapterKind
  observedRuntimeVersion
  sourceEventKind
  sourceSequence
  semanticKind
  normalizedEntries
  observedAt
}
```

`normalizedEntries` 只能表达来源已证明的路径、change kind、mode、binary 标记、hunk/patch 或完整 before/after；不得
加入从 workspace 读取的 bytes。Evidence 是 append-only，重复 source identity 必须幂等，迟到或乱序事件仍按既有
Activity replay order 归约。

### 2.4 Existing Canonical Activity projection

既有 Tool/Command Activity 可选增加：

```text
diffProjection: null | {
  schemaVersion: 1
  source: "runtime_reported"
  revision: u64
  sourceEvidenceIds: EvidenceId[]
  status: "available" | "unavailable" | "conflict"
  semanticKind?: "unified_diff_snapshot" | "complete_patch_snapshot" |
                 "exact_mutation" | "complete_before_after"
  entries?: NormalizedDiffEntry[]
  safeReasonCode?: string
}
```

约束：

- `revision` 随投影内容变化严格单调；相同 Evidence replay 不推进；
- `sourceEvidenceIds` 包含形成当前结论的全部已排序来源，不因新 snapshot 覆盖而删除审计 lineage；
- `available` 才可携带可渲染 `entries`；`unavailable` 不保留部分 patch；互不兼容且无法由 adapter 规则确定性排序/
  合并的完整声明得到 `conflict`，不得最后写入胜出；
- 成功的 `runtimeFileOperation` 可把同一 Activity 归约为 `file.write` 并给出 `修改 <basename>` presentation hint；
  它不创建 `diffProjection`。只有同一 Evidence 另有已准入 Diff 时，Renderer 才显示增删计数和 inline diff；
- Activity `phase`、`outcome`、标题、identity 和排序不从 `diffProjection` 推导；
- 任何 consumer 都不得把 projection 变成第二条可独立排序、写入或拥有 phase/outcome 的 Activity；具体 UI 形式
  不由本合同冻结。

## 3. Workspace Window identity 与持久记录

### 3.1 Window key

```text
WindowKey =
  campId
  + canonicalExecutionRoot
  + observedRepositoryWorktreeIdentity

observedRepositoryWorktreeIdentity = {
  repositoryRoot
  worktreeGitDir
  gitCommonDir
  objectFormat
  objectDatabaseDir
  objectAlternatesDigest?
}
```

前四项是最低身份集合；v1 还冻结实际 object database directory 与规范化 alternates layout digest。所有路径在
Core 内使用平台适配的绝对 canonical identity 比较；display path 是独立安全投影。linked worktree 因
`worktreeGitDir` 不同而不同。HEAD、branch 或 commit 改变不改变该 identity；任一冻结字段在 final 前变化则
capture 变为 `unavailable`。

同一 repository 的不同 `campId` 或 `canonicalExecutionRoot` 不共享 Window。Window ID 使用密码学安全随机源并含
至少 128-bit 熵；用于 ref 的 token 是该 identity 的固定长度、路径安全编码，不接受调用方提供值。

### 3.2 Coordinator state 与历史 Evidence

Core DB 对未完成 Window 的协调状态保持唯一写入权威：

```text
WorkspaceChangeWindowRecord {
  windowId
  campId
  canonicalExecutionRoot
  observedRepositoryWorktreeIdentity
  lifecycle
  captureStatus
  baselineOid?
  finalOid?
  baselineCaptureManifestRef?
  finalCaptureManifestRef?
  captureProfileVersion
  baselineCaptureStartedAt?
  baselineCapturedAt?
  finalCaptureStartedAt?
  finalCapturedAt?
  unavailableReasonCode?
  externalWriterObserved
  diffSummary?
  diffManagedBlobRef?
  createdAt
  updatedAt
}

WorkspaceChangeWindowParticipant {
  windowId
  agentRunId
  executionEpoch
  joinedAt
  releasedAt?
}
```

Window 完成且存在非空净变化时，在同一 publication 边界追加一条不可变历史 Evidence：

```text
WorkspaceDiffCompleted {
  evidenceId
  windowId
  campId
  canonicalExecutionRoot
  participantRuns[]
  files[]
  additions
  deletions
  diffBlobId
  capturedAt
  baselineOid?   // 仅诊断
  finalOid?      // 仅诊断
}
```

`WorkspaceChangeWindowRecord` 负责 opening/active/closing、恢复和清理；`WorkspaceDiffCompleted + diffBlobId`
是历史卡片和只读 View 的长期权威。完成后的读取不得重新执行 Git diff，不得读取当前 workspace，也不得依赖
baseline/final ref 或 tree 仍存在。`no_changes` 与 `unavailable` 只收口 Window 状态，不创建历史卡片 Evidence。

Participant/AgentRun 只引用 `windowId`，不复制 OID、状态、summary 或 blob。capture manifest 冻结排序后的 path、
mode、source kind、boundary/sparse provenance 与对应 entry OID，供 final sticky-path 选择和完整性验证；manifest
是 Core-private Managed Blob。DB OID 必须按冻结 `objectFormat` 验证格式和对象类型。Git ref 不是会话历史、
恢复索引或授权权威。

## 4. Lifecycle 与 capture state

```text
lifecycle = "opening" | "active" | "closing" | "closed"
captureStatus = "pending" | "baseline_ready" | "complete" | "no_changes" | "unavailable"
```

允许的稳定组合：

| lifecycle | captureStatus | 含义 |
| --- | --- | --- |
| `opening` | `pending` | baseline 正在有界捕获，尚未允许首个参与 Runtime 写入 |
| `active` | `baseline_ready` | baseline 受保护，一个或多个参与 Run 可写 |
| `active` | `unavailable` | baseline 已失败但 Run 继续；重叠 Run 仍加入同一不可用 Window |
| `closing` | `baseline_ready` | 无参与者，final 正在有界捕获 |
| `closing` | `unavailable` | 已确定无法形成 diff，正在持久收口和释放 gate |
| `closed` | `complete` | final 与非空 diff/summary 已持久化 |
| `closed` | `no_changes` | baselineOid 与 finalOid 相同，或规范 diff 为空 |
| `closed` | `unavailable` | 捕获、身份、ref、上限、恢复或持久化边界无法证明 |

禁止 `active | closing | closed` 搭配 `pending`，禁止仍有 active Participant 时进入 `closing | closed`，禁止
`complete | no_changes` 缺少两个已验证 OID、manifest 和两个 capture timestamp。`opening/pending` 或
`closing/baseline_ready` 可以暂存尚未提升的 candidate OID/manifest，以完成 DB -> ref -> DB 的 recoverable saga；
candidate 不得被读取为 ready checkpoint。状态转换使用 DB transaction/CAS，重试必须幂等，`closed` 不可重新打开。

## 5. Admission 与 quiescence

1. Scheduler 发现 Git-valid exact execution root 后，在允许首个 Runtime 写入前以 active-key unique/CAS 创建或加入
   `opening/pending` Window；并发首个 Run 不得各自创建 baseline，只有一个 capture owner，其他 admission 有界等待
   同一 opening 结论；
2. baseline 成功时按第 7.2 节的 recoverable saga 持久 candidate、建立并验证 ref pin，再以 DB CAS 转为
   `active/baseline_ready`；失败或超时时转为 `active/unavailable`。两种结果都允许 Run bind；
3. 同 key `active` Window 的新 Run 原子加入 Participant；`new join` 与最后 Participant release 触发
   `active -> closing` 必须由同一 Coordinator mutex/transaction 决定；
4. 普通 Participant release 与 final capture 只有在 Run lease 已 fence/unbind，且该 Run 的 Runtime、CLI、Tool
   descendants 已有权威 quiescence evidence 后成立。IdleWarm Host 不属于该 Run 的活跃后代；
5. 取消 ACK 后必须在冻结期限内等待同一后代 quiescence。期限内无法证明时，不得等待未知 terminal callback，也
   不得捕获 final；Core 原子把该 participant 标为已释放并把旧 Window 收敛为 `unavailable`，从而允许下一 Window。
   此处 `releasedAt` 只表示不再参与该观察窗口，不构成 Runtime 或外部效果已经停止的证据；
6. 同一 physical execution root 存在 `closing` Window 时，任何 scope 的新 Run bind 最多等待冻结的 strict
   deadline。旧 Window 成功或不可用后立即释放；deadline 到达必须把旧 Window收敛为 unavailable 并释放，不能
   永久排队；
7. non-Git root 直接跳过本领域，不创建 not-applicable 假对象。

Core restart 后，只要旧 Window 的结束边界不能由持久 fence/quiescence 精确证明，就必须标记 unavailable；不得在
启动后扫描当前文件并声称是旧 final。

## 6. Stable synthetic tree capture

### 6.1 Scope

每次 capture 的候选集合严格是 exact execution root 下：

1. tracked path；
2. 本次 capture 时非 ignored 的 untracked path；
3. final 时 baseline 已纳入、即使现在变为 ignored 仍需继续观察的 sticky path。

不得扩大到 repository root。`.git` 文件/目录和其解析目标永久排除。路径规范化、读取和打开都必须 no-follow；
发现路径逃逸、循环或 capture 中 boundary 改变则整个 capture unavailable，不返回部分树。

### 6.2 File semantics

- materialized tracked/untracked regular file 写入 raw bytes，mode 为 `100644 | 100755`；tracked executable bit 按 Git
  metadata 保留，untracked 按冻结的平台 policy 计算；
- symlink 写入 link target bytes 和 mode `120000`，禁止跟随；
- sparse-checkout 明确未物化的 tracked path 复用其索引 OID/mode，不视为删除；无法证明是 sparse omission 时才按
  普通路径消失处理。若同一路径在 baseline/final 之间切换 materialized 与 sparse-omitted 来源，且无法在不执行
  clean/smudge filter 的前提下证明两种表示等价，则 Window unavailable，不产生伪 modification；
- submodule 只表达外层 gitlink boundary；nested repository 和 submodule 内部不递归、不生成内部文件 patch；
- 普通已纳入路径消失由 tree 差异形成 delete；rename 只由 bounded tree-to-tree rename detection 推导。

### 6.3 Stability and limits

baseline 与 final 分别重复构造完整 synthetic tree，只有连续两次 root tree OID 完全相同才接受。每个 capture
从第一次尝试前记录 `captureStartedAt`，在接受第二个相同 OID 后记录 `capturedAt`。以下任一情况得到
`unavailable`，不得降级为部分成功：

- strict wall-clock deadline 到达；
- file count、total raw bytes 或单项安全上限超过冻结 profile；
- 读取错误、路径/boundary 竞态或持续不能得到两个相同 OID；
- repository/worktree identity 或 object format 变化。

若 capture/ref/diff 使用 Git 子进程，每个调用必须消费同一捕获或发布边界的剩余绝对 deadline，并在读取过程中
限制 stdout/stderr；超时或超限必须终止并 reap 所属进程树。先无限等待、再在完整输出进入内存后检查大小不满足
strict wall-clock 或 bounded-memory 要求。

产品语义严格是 baseline `capturedAt` 与 final `capturedAt` 两个稳定点之间的净变化，不声称原子 snapshot。

## 7. Git objects 与 ref protocol

### 7.1 Raw writes

Capture 只可通过 gix 或受控 Git plumbing 写 raw blob/tree object。若使用 Git 子进程，必须清除/拒绝继承的
`GIT_DIR`、`GIT_WORK_TREE`、`GIT_INDEX_FILE`、object/alternate directory 与 config 注入覆盖，绑定冻结的显式路径，
并用 Core-private empty hooks directory 禁止 `reference-transaction` 等 hook 执行。禁止：

- 读取或写入用户真实 index 作为 snapshot authority；
- `git add`、clean/smudge filter、LFS clean、textconv、external diff；
- 修改 staged state、HEAD、普通 branch/tag/ref；
- Rovai 主动调用 `git prune` 或改变用户 GC 配置。

### 7.2 Temporary pins

ref 名固定为：

```text
refs/rovai/w/<window-token>/b
refs/rovai/w/<window-token>/f
```

- 创建必须使用 expected-absent CAS；已存在即 collision/tamper，Window unavailable，不覆盖；
- Window row/token 已先持久化。稳定 capture 后，DB 在未 ready 状态持久 candidate OID/manifest，创建并验证 ref，
  再以 DB CAS 把 candidate 提升为 verified baseline/final OID；baseline 进入 `baseline_ready`，final 仍保持
  `closing/baseline_ready` 直到 diff publication。任一中间失败通过 expected-OID cleanup 和持久 recovery ledger
  收口。该 saga 不声称跨数据库与 Git ref 原子；
- diff 前分别验证 ref 存在且精确指向 DB baseline/final OID，并验证对象是冻结格式的 tree；
- 缺失、类型错误或漂移直接 unavailable，不 rescan、不跟随 ref 新 target；
- diff Managed Blob 与摘要成功持久化后，以 DB expected OID compare-and-delete；target 已变化时不得删除他人值。
  diff 前发现漂移使 Window unavailable；publication 后的 cleanup mismatch 只记录外部清理异常并保留 ref，不得
  反向改写已经验证并持久化的 `complete | no_changes` 结果；
- 删除 ref 不表示 object bytes 立即删除。Rovai 不对用户仓库提供即时磁盘回收保证。
- expected baseline/final OID 必须先写入独立持久 cleanup ledger，再尝试删除；该 ledger 不受 Window lifecycle
  过滤。ref 已不存在是幂等成功；target 已改变、仓库不可达或执行超时都保留 expected OID、失败码和重试次数。
  final publication 失败关闭时还必须在同一事务清空 `finalCandidateOid` 与失败的 final manifest reference。

## 8. Diff persistence

final stable tree 与 baseline 相同或规范 tree diff 为空时，Window 为 `closed/no_changes`，不创建空 patch blob。
否则：

1. 使用 raw tree-to-tree diff，禁用 textconv/external diff；
2. rename detection 使用冻结的有界 profile；无法在上限内完成时整个 Window unavailable，不把 delete/add 猜成 rename；
3. binary、mode-only、add/delete/modify/rename 和截断必须结构化区分；patch 超限不得伪装完整，可将整个 v1 Window
   标记 unavailable，直到合同另行定义 summary-only 成功态；
4. patch bytes 进入 Core Managed Blob；DB 在同一 transaction 写 Window 的 final 状态，并追加不可变
   `WorkspaceDiffCompleted`（文件摘要、participant audit、`diffBlobId`、`capturedAt`）；只有两者都成功才发布卡片；
5. 只有 publication 成功后清理 refs。Managed Blob reference 必须进入现有 GC root，不能由 Git object/ref 代替。

## 9. Authorization and reads

公开 Window read 的最小输入是：

```text
WorkspaceChangeWindowReadInput {
  campId
  windowId
}
```

Core 必须在同一 read transaction 验证 `WorkspaceDiffCompleted` 精确属于 `campId + windowId`，并验证当前 User/Desktop principal 对该 Camp
的读取资格。v1 不向 Agent built-in、Runtime 或模型上下文开放该 read。cross-Camp、未知或未授权统一返回安全
not-found；不得泄露存在性。禁止以下入口：

- 仅以 `windowId`、AgentRun ID、ref、OID 或 Managed Blob ID 全局读取；
- 让 public client 使用本地路径直接打开 diff blob；
- 通过 Participant 查询枚举其他 Camp Window。

会话卡片和 View 只返回 `WorkspaceDiffCompleted` 的安全投影：schemaVersion、windowId、`complete`、安全
execution-root label、文件摘要、总增删、capturedAt 与 `hasDiffContent`。当前 UI 不公开 participant、ref、OID、
Managed Blob ID、repositoryRoot/worktreeGitDir/gitCommonDir 或其他 scope identity。`no_changes/unavailable` 没有历史
Evidence，因此不提供卡片或 diff read；其诊断仍保留在 Core Window state。

diff 内容读取继续提交相同 `campId + windowId`，Core 内部从不可变 Evidence 解析 Managed Blob reference。删除临时
Git ref、用户继续编辑或产生后续 Window 都不得改变旧 View。

Window OID、manifest、summary 或 diff 不进入 Session Bootstrap、Dynamic Context、Camp public message 或 Runtime
输入；同 Camp membership 本身不把工作区内容授权给模型。

## 10. External writers and presentation truthfulness

`externalWriterObserved=true` 的精确定义是：Window 活跃/关闭期间，Core Coordinator 观察到另一个
Rovai-managed、不同 WindowKey 的运行范围与当前 physical workspace path 重叠。它不说明写入实际发生，也不表示
Core 观察到所有用户、shell、IDE、hook 或外部进程。

v1 presentation 冻结为：

- Command 层不展示 `apply_patch` 父行或“编辑了 N 个文件”聚合层；成功 Edit/Write 的唯一可靠路径直接把原 Tool
  Activity 呈现为 `修改 <basename>`。没有可靠内容时不显示增删计数、不提供空 inline diff，也不伪造 Diff；
- 一条另有可靠 Command Diff 的 Activity 才把每个 change 呈现为同级
  `修改 <basename>  +A −D` presentation row，独立展开当前文件 inline diff，不跳转文件、不打开独立 Review；
- `exact_mutation` 展开只显示 `oldText/newText` 片段的 `− / +` 行，不展示文件行号、hunk header、上下文定位或任何
  从当前 workspace 推测出的内容；同一文件连续 Edit 仍按各自 Tool identity 显示为多行，不合并净变化；
- 多个文件 row 仍共享一条 Evidence 与一条 Canonical Activity，不获得独立 phase/outcome/排序身份；文件 row
  放在现有“已执行 N 项操作”集合内，集合计数按 Canonical Activity 而非 presentation row 计算；Tool 列表顶格，
  inline diff 使用现有整行宽度；
- Workspace 层只有 `complete` 在会话时间线追加 `Files Changed` 卡片。卡片上半区整体可点击并以无边框、中性
  黑字 `View` 作为低强调 affordance；文件名顶格、行间无分隔，每个文件行独立可点击并选择 Review 中的该文件；
  卡片不显示时间、已保存、参与运行或底部归因 footer；
- 卡片上半区与文件行读取同一历史 Evidence/blob，在现有 Camp surface 内展示文件列表和完整 diff，差别仅是
  初始文件 selection。执行台不增加共享工作区观察；会话 rail、执行台 placement、Tool 列表宽度与其他现有结构
  不因本功能改变；
- `no_changes`、`unavailable`、pending 和非 Git root 不生成卡片。Window 结果不归因给单个 Agent/Run，可能包含
  用户编辑器、外部程序或其他并行运行修改；`externalWriterObserved` 不泄露对方 identity。

## 11. Cleanup and deletion

- 正常 complete/no_changes publication 后立即尝试 expected-OID ref cleanup；
- startup recovery 可依据 DB candidate/ready OID 重试未完成的 compare-and-delete，但不得移动 ref、采用 ref target
  作为 checkpoint、rescan 或执行 prune；重试必须包含已 `closed` Window 的持久 cleanup ledger；
- Camp 永久删除先走既有 Run fence/quiescence，再删除 Window rows 与 Managed Blob roots；checkpoint cleanup 是
  best-effort、有持久诊断的外部清理，用户仓库不可达不能把 Core 领域删除永久卡住；
- Window retention 由 Core 数据/Managed Blob policy 管理，不能通过长期保留 Git ref 实现。

## References

- [Workspace Change Observation 架构](../architecture/workspace-change-observation.md)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
- [v1.29 决策](../versions/v1.29/decisions.md)
