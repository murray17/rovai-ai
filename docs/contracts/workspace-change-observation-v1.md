---
document_type: contract
contract: workspace-change-observation
version: v1
status: accepted
last_updated: 2026-08-26
---

# Workspace Change Observation v1

本合同定义 Command Diff projection 与 Workspace Change Window 的 v1 字段、状态、捕获、授权和失败语义。
accepted 只表示目标语义已冻结；当前实现状态由 [v1.29 实施计划](../versions/v1.29/implementation-plan.md)拥有。

## 1. Closed product layers

产品只存在以下两层：

| 层 | 定义 | 不证明 |
| --- | --- | --- |
| `command_diff` | Runtime 对一个精确 Canonical Tool/Command Operation 明确报告的修改 | 当前磁盘最终状态、其他 Operation、单文件完整历史 |
| `workspace_change_window` | 当前 Camp、exact execution root 的重叠 Run 集合在两个稳定 synthetic tree 捕获点之间的 Git 净变化 | 单个 Run/Agent/Tool 的因果归属，或没有用户/外部程序写入 |

两层不能互相补全、去重或覆盖。非 Git execution root 不创建 Workspace Window。

## 2. Command Diff Evidence 与 projection

### 2.1 Admission

一个 Runtime event 只有同时满足以下条件才可生成 normalized diff Evidence：

1. `adapterKind + observedRuntimeVersion + eventKind + fieldPath` 命中 Runtime Activity Registry 中的明确 allowlist；
2. allowlist 声明其语义是 `unified_diff_snapshot | complete_patch_snapshot | exact_mutation | complete_before_after`；
3. event 与一个精确 Canonical Activity identity 相关联；
4. 每个路径都能相对该 Run 冻结的 canonical execution root 做纯词法规范化，且不为空、不绝对、不含 root escape
   或 Git metadata path；该检查不解析 symlink target、不打开路径，也不把报告路径升级为文件 identity；
5. bytes、file count 和 patch size 满足对应 adapter profile 的严格上限。

局部 before/after、仅路径、自由文本中的 fenced diff、语义未声明的 `diff` / `patch` 字段和需要读取当前文件才能
补全的数据必须拒绝进入 Diff View。拒绝可以产生安全 diagnostic，但不能伪造 diff Evidence。

### 2.2 Append-only Evidence

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

### 2.3 Existing Canonical Activity projection

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

### 3.2 Authoritative record

Core DB 至少持久：

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

Window 是唯一持久对象；Participant/AgentRun 只引用 `windowId`，不复制 OID、状态、summary 或 blob。capture
manifest 冻结排序后的 path、mode、source kind、boundary/sparse provenance 与对应 entry OID，供 final sticky-path
选择和完整性验证；它与 diff 一样是 Core-private Managed Blob。DB OID 必须按冻结 `objectFormat` 验证格式和对象
类型。Git ref 不是权威字段，不能代替 DB recovery 或 authorization。

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
4. Participant release 只有在 Run lease 已 fence/unbind，且该 Run 的 Runtime、CLI、Tool descendants 已有权威
   quiescence evidence 后成立。IdleWarm Host 不属于该 Run 的活跃后代；
5. 同一 physical execution root 存在 `closing` Window 时，任何 scope 的新 Run bind 最多等待冻结的 strict
   deadline。旧 Window 成功或不可用后立即释放；deadline 到达必须把旧 Window收敛为 unavailable 并释放，不能
   永久排队；
6. non-Git root 直接跳过本领域，不创建 not-applicable 假对象。

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

## 8. Diff persistence

final stable tree 与 baseline 相同或规范 tree diff 为空时，Window 为 `closed/no_changes`，不创建空 patch blob。
否则：

1. 使用 raw tree-to-tree diff，禁用 textconv/external diff；
2. rename detection 使用冻结的有界 profile；无法在上限内完成时整个 Window unavailable，不把 delete/add 猜成 rename；
3. binary、mode-only、add/delete/modify/rename 和截断必须结构化区分；patch 超限不得伪装完整，可将整个 v1 Window
   标记 unavailable，直到合同另行定义 summary-only 成功态；
4. patch bytes 进入 Core Managed Blob，DB 在同一 publication 边界写 authoritative reference、summary、final OID、
   timestamps 与 `closed/complete`；
5. 只有 publication 成功后清理 refs。Managed Blob reference 必须进入现有 GC root，不能由 Git object/ref 代替。

## 9. Authorization and reads

公开 Window read 的最小输入是：

```text
WorkspaceChangeWindowReadInput {
  campId
  windowId
}
```

Core 必须在同一 read transaction 验证 Window 精确属于 `campId`，并验证当前 User/Desktop principal 对该 Camp
的读取资格。v1 不向 Agent built-in、Runtime 或模型上下文开放该 read。cross-Camp、未知或未授权统一返回安全
not-found；不得泄露存在性。禁止以下入口：

- 仅以 `windowId`、AgentRun ID、ref、OID 或 Managed Blob ID 全局读取；
- 让 public client 使用本地路径直接打开 diff blob；
- 通过 Participant 查询枚举其他 Camp Window。

安全 View 可返回：schemaVersion、windowId、lifecycle、captureStatus、安全 execution-root label、当前 Camp 内
participants `(agentRunId, executionEpoch)`、capture timestamps、summary、safe unavailable reason、
`externalWriterObserved` 与 `hasDiffContent`。它不得返回 repositoryRoot/worktreeGitDir/gitCommonDir、raw ref、OID、
Managed Blob ID 或其他 scope identity。

diff 内容分页/读取继续提交相同 `campId + windowId`，Core 内部解析 Managed Blob reference。完成 Window 可从多个
参与 Run 详情链接到同一 View，但只有一个逻辑对象。

Window OID、manifest、summary 或 diff 不进入 Session Bootstrap、Dynamic Context、Camp public message 或 Runtime
输入；同 Camp membership 本身不把工作区内容授权给模型。

## 10. External writers and presentation truthfulness

`externalWriterObserved=true` 的精确定义是：Window 活跃/关闭期间，Core Coordinator 观察到另一个
Rovai-managed、不同 WindowKey 的运行范围与当前 physical workspace path 重叠。它不说明写入实际发生，也不表示
Core 观察到所有用户、shell、IDE、hook 或外部进程。

任何 future consumer/presentation 必须保留以下语义：Window 不归因给单个 Agent/Run；结果可能包含用户编辑器、
外部程序或其他并行运行修改；`externalWriterObserved` 不泄露对方 identity；`complete | no_changes | unavailable`
不可混淆；非 Git root 没有 Window。布局、组件、入口、具体文案和交互不由本合同冻结，留待独立 UI 方案确认。

## 11. Cleanup and deletion

- 正常 complete/no_changes publication 后立即尝试 expected-OID ref cleanup；
- startup recovery 可依据 DB candidate/ready OID 重试未完成的 compare-and-delete，但不得移动 ref、采用 ref target
  作为 checkpoint、rescan 或执行 prune；
- Camp 永久删除先走既有 Run fence/quiescence，再删除 Window rows 与 Managed Blob roots；checkpoint cleanup 是
  best-effort、有持久诊断的外部清理，用户仓库不可达不能把 Core 领域删除永久卡住；
- Window retention 由 Core 数据/Managed Blob policy 管理，不能通过长期保留 Git ref 实现。

## References

- [Workspace Change Observation 架构](../architecture/workspace-change-observation.md)
- [AgentRun Recovery](../architecture/agent-run-recovery.md)
- [v1.29 决策](../versions/v1.29/decisions.md)
