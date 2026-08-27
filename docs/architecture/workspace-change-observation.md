---
document_type: architecture
architecture: workspace-change-observation
authority: command-diff-and-workspace-change-window-boundaries
status: accepted
last_updated: 2026-08-27
---

# Workspace Change Observation 架构

字段、状态与授权接口见 [Workspace Change Observation v1](../contracts/workspace-change-observation-v1.md)。本架构把
Runtime 对单个 Operation 的声明与工作区边界观察分开，同时复用既有 Evidence、Canonical Activity、Run lease、
Managed Blob 和 Camp authorization 权威。

## 产品模型

```text
Runtime structured event
  -> public normalizer + Adapter/version semantic allowlist
  -> append-only Execution Evidence
  -> existing Canonical Activity.diffProjection
  -> original Tool / Command row

first admitted Run for WindowKey
  -> Window Coordinator
  -> stable baseline synthetic tree
  -> DB OID + temporary refs/rovai GC pin
  -> one or more overlapping participant Runs
  -> lease fence/unbind + descendant quiescence
  -> stable final synthetic tree
  -> verified tree-to-tree diff
  -> immutable WorkspaceDiffCompleted Evidence + Managed Blob
  -> one Camp-scoped Files Changed card / read-only View
```

`Command Diff` 的权威来源是 Runtime 对精确 Operation 的结构化报告。`Workspace Change Window Diff` 的权威来源
是两个稳定 synthetic tree 之间的比较。二者都不是文件写入因果证明，不能互相补全或覆盖。

## 组件职责

### Adapter normalizer 与 Canonical Activity

- 每个 Adapter/version 必须声明可接受事件的 wire 位置、完整性和更新语义。public normalizer 只保留已声明字段；
- normalized diff update 作为 append-only Evidence 落库。Canonical Activity Projection 从全部 source Evidence
  确定性归约单调 revision、source IDs 与 availability/conflict；
- Activity identity、顺序、phase 和 outcome 继续由现有 Canonical Activity 拥有。不存在可独立写入或排序的
  `OperationDiffActivity`；
- 路径只能相对 Run 冻结的 canonical execution root 解析。规范化和越界检查不获得文件读取权，也不以当前文件
  内容补足 Runtime 的局部数据。

当前有三种来源完成准入：Codex app-server 的 terminal `fileChange`、ACP v1 terminal ToolCall 的标准
`ToolCallContent::Diff` 累计内容，以及 Claude stream-json 中完整 `assistant.tool_use(name=Edit)` 与相同
`tool_use_id` 的非错误 `user.tool_result` 配对。Codex add/delete 的完整文件内容在 Core 规范化为 unified diff；
ACP collection update 按协议 replace 语义缓存到 terminal；Claude 只保存 `file_path/old_string/new_string` 所证明的
`exact_mutation` 片段，不读取文件定位、不生成 hunk 行号，`replace_all` 与其他 Tool 均 fail closed。Antigravity
仍没有等价可靠内容，不按 Tool 名或 shell 文本补造 diff。

### Window Coordinator

Window Coordinator 是 Workspace Window 生命周期的唯一写入者。它与 Scheduler/Run lease 边界协调，但 Git diff
只是附加观察能力，不是 Runtime Ready 或普通文件写入的权威。

- Window key 是 `campId + canonicalExecutionRoot + observedRepositoryWorktreeIdentity`。同 key 的重叠 Run
  共享一个 baseline；不同 Camp、不同 exact root 或不同 worktree identity 永远不共享持久对象。并发首个 Run
  通过 active-key 唯一约束加入同一个 `opening` Window，只有一个 capture owner；
- 首个参与者只能在 baseline 已持久成为 `baseline_ready` 或 `unavailable` 后获准 bind 到可写 Runtime；
- 同 key 的新 Run join 与最后参与者触发 closing 在一个原子互斥边界中决定；
- “最后一个 Run 结束”要求其 lease 已 fence/unbind，且该 Run 的 Runtime、CLI、Tool 后代已证明 quiescent。
  可复用但不再绑定该 Run 的 IdleWarm Host 不阻止 closing；
- 同一 physical execution root 已 closing 时，新 Run bind 只等待到严格 deadline。final 成功或任何不可用结论都会
  立即关闭旧 Window 并释放下一 Window；
- baseline 失败不会阻止首个 Run，final 失败不会阻止下一 Window。一个 active 且 baseline 已失败的 Window 保持
  `captureStatus=unavailable`，后续同 key 重叠 Run 继续加入，直到最后参与者退出后关闭；不反复尝试伪造新 baseline；
- Core restart、未知 quiescence、仓库身份替换或 checkpoint 不一致不能用事后 rescan 恢复旧边界，只能收敛为
  `unavailable`。

Coordinator 可以在内部判断另一个 Rovai-managed scope 的物理路径是否与当前 Window 重叠，但当前 Window 只保存
`externalWriterObserved=true`。该字段不保存或公开对方 Camp、Run 或文件活动，也不表示 Core 能观察用户编辑器、
任意 shell 或其他程序；任何未来 presentation 都必须保留这些未受控写入者带来的不确定性。

### Git Capture

Git Capture 是受控写入用户仓库的适配层：它可以向当前 worktree 的 object database 写 raw objects，并在专用
namespace 创建短期 refs，但不能修改用户真实 index、staged 状态或普通 refs。

1. 开始时发现并冻结 repository root、worktree Git dir、common Git dir、object format 与有效 object database
   layout；exact execution root 必须位于该 worktree 内。Git 环境覆盖被清除/拒绝，所有调用绑定显式冻结路径；
2. 扫描 exact root，按合同构造 synthetic tree。blob/tree 通过 gix 或受控 plumbing 直接写入，不调用
   `git add`，不经过 clean/LFS filter；symlink 不跟随，nested repository/submodule 不递归；
3. 只有连续两次扫描得到同一 tree OID 才形成稳定捕获。时间、文件数或总字节超限以及持续变化都返回明确
   unavailable reason；
4. DB 在 capture 仍 pending/closing 时先持久化 candidate OID 与 capture manifest；随后以 create-if-absent CAS
   创建确定性的短 ref并复核 target；只有两者都成功后，DB 才把 candidate 提升为 verified baseline/final OID。
   baseline 随后进入 `baseline_ready`，final 仍在 closing 中等待 diff publication。该
   recoverable saga 不声称跨 SQLite 与 Git ref 原子；ref 仍只是 GC pin；
5. final 前重新观测同一 repository/worktree identity。HEAD、branch 或普通工作内容变化不是身份替换；root、
   worktree Git dir、common Git dir 或 object format 变化则不可用；
6. diff 前同时验证 DB OID、ref target 和对象类型。缺失或漂移直接不可用，不从文件系统重建；
7. tree-to-tree diff 禁用 textconv/external diff，使用有界 rename detection。结果和摘要持久进入 Managed Blob/DB 后，
   以 expected-OID compare-and-delete 清除 refs。

Rovai 不主动对用户仓库执行 prune。成功删除 ref 只撤销 Rovai 的 GC pin，不表示 object bytes 立即从磁盘消失；
其后生命周期由用户 Git 的可达性与 GC 策略决定。

### Synthetic Tree Builder

每次 Window 的 synthetic tree 只表达 exact execution root，不为方便 diff 扩大到 repository root：

- 包含该 root 下的 tracked 路径和捕获时非 ignored 的 untracked 路径；final 还继续观察 baseline 已纳入、此后变为
  ignored 的路径；
- materialized tracked file 使用捕获时工作区 bytes；sparse-checkout 明确未物化的 tracked entry 保留其索引对象和
  mode，不能因路径不存在推导删除；
- symlink 使用 `120000` mode 和 link target bytes，不跟随目标；普通文件保留 Git executable bit；
- `.git` 永远排除。submodule 保留外层 gitlink 边界，nested repository 和 submodule 内部都不递归生成文件 diff；
- 普通路径消失形成 delete。rename 只由最终 tree-to-tree bounded rename detection 推导，不在采集阶段猜测；
- 两次扫描使用相同的路径、ignore、sparse 与 boundary 规则；遗漏、超限或不稳定不能降级为部分“成功”。

`captureStartedAt` 是首次稳定性尝试前的 wall-clock，`capturedAt` 是接受第二个相同 OID 后的 wall-clock。因此产品只
声称两个稳定捕获点之间的净变化，不声称任一捕获是原子文件系统 snapshot。

### Core Store、Managed Blob 与授权

- Core DB 的 Window row 是 active coordination、participant、capture、recovery 与 cleanup 的状态权威；Git ref 不是
  恢复索引或读取授权；
- `WorkspaceDiffCompleted` 是完成历史的不可变权威。它冻结 Window ID、Camp、participant audit、文件摘要、
  `diffBlobId` 与 capturedAt；历史卡片和 View 只读该 Evidence/blob，不读 mutable Window row、当前 workspace 或 Git tree；
- AgentRun 只保存 `windowId` 参与引用，不复制 Window、Evidence 或 diff blob；
- Window capture manifest 与 diff/summary 的 Managed Blob reference 是 Core GC root。public projection 不返回
  原始磁盘路径、ref、OID 或 blob ID；
- 任何 Window 或 diff read 都提交 `campId + windowId`，Core 在同一读边界验证 Camp 归属和当前 principal 授权。
  知道 Run ID、ref、OID 或底层 blob identity 不提供读取或存在性 oracle；
- Camp 删除在 quiescence/fence 后清除 DB/Managed Blob root，并对仍存在的 checkpoint ref 做 best-effort
  expected-OID cleanup。用户仓库暂不可达不能使已授权的 Core 领域删除永久失败；遗留 pin 通过有界恢复清理记录处理。
- v1 Window read 只面向已授权的 User/Desktop read side；它不进入 Session Bootstrap、Dynamic Context、
  Camp public message、Agent built-in 或 Runtime 输入，也不因同 Camp membership 自动授权给模型。

## Presentation boundary

- Command Diff 始终是既有 Canonical Activity 的 typed 子投影；`available | conflict | unavailable` 不从 Activity
  outcome 推断，也不形成可独立排序或写入的 Activity；
- Renderer 把一条 available Activity 的 entries 扁平投影为同级 `修改 xxx` 行。每行只展开自己的 inline diff；
  不展示 `apply_patch`、文件数聚合父行或 Operation Review；
- `exact_mutation` 只显示 `− oldText / + newText` 片段，不显示文件行号或 `@@`；同一文件的多个 Edit 保留各自
  Tool identity 和时序，不合并为 Command 层净变化；
- Workspace `complete` Evidence 在 Camp 会话时间线追加一张 `Files Changed` 卡片，`View` 读取不可变 blob。
  `no_changes | unavailable` 与非 Git execution root 不新增卡片，执行台不新增共享工作区观察；
- 卡片与 View 不指定修改作者，也不显示 participant audit。结果可能包含用户编辑器、外部程序或其他并行运行；
  `externalWriterObserved=true` 只表示 Core 观察到其他 Rovai scope 重叠；
- 现有 Camp 会话 rail、底部/右侧执行台 placement、Tool list 宽度、主题、字体和图标体系保持不变。

## References

- [Workspace Change Observation v1](../contracts/workspace-change-observation-v1.md)
- [AgentRun Recovery](agent-run-recovery.md)
- [当前基础架构不变量](foundational-invariants.md)
- [Runtime Activity Registry](../runtime-activity/registry.md)
