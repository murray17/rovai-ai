---
document_type: version-decisions
version: v1.29
lifecycle: current
last_updated: 2026-08-27
---

# v1.29 决策记录

本文件只记录本版本满足准入门槛的重要取舍；当前行为规范由链接的 Architecture 与 Contract 拥有。

<a id="v1-29-d01"></a>
## V1.29-D01：两层 diff 共存，但不建立第二套 Activity 权威

### 背景

Runtime 有时会在一个 Operation 的结构化事件中明确报告 patch 或完整 before/after；另一方面，用户最终关心的
是一组可能重叠的运行期间工作区留下了什么净变化。前者接近 Operation，后者只能观察工作区边界，二者的来源、
完整性和归因能力不同。若把二者合并为一个“Agent 修改”，会让 Runtime 声明、文件系统观察和因果归因互相替代。

### 决定

1. 产品固定保留两层：`Command Diff` 是 Runtime 对具体 Operation 的结构化报告；
   `Workspace Change Window Diff` 是当前 Camp、exact execution root 内一组重叠 Run 的 Git 工作区净变化；
2. Command Diff 继续写 append-only Evidence，并归约到既有 Canonical Activity 的 typed `diffProjection`；
   不创建 `OperationDiffActivity`，也不复制 `phase`、`outcome` 或 Activity identity；
3. projection 保留单调 `revision`、全部 `sourceEvidenceIds` 和明确的 availability/conflict 状态；
4. 只有 Adapter/version 明确声明语义的数据可进入 projection。局部片段、仅路径或语义不明的 `diff` / `patch`
   字段不得包装为完整文件差异；
5. `diffProjection` 不是可独立排序或写入的新 Activity。旧 Evidence 不做无法证明正确的回填；v1 presentation
   由 [V1.29-D03](#v1-29-d03)冻结。

当前规范见 [Workspace Change Observation](../../architecture/workspace-change-observation.md)与
[Workspace Change Observation v1](../../contracts/workspace-change-observation-v1.md)。

### 后果

- Runtime 声明与 Git 观察保留独立来源和不确定性，可由后续 UI 方案分别呈现；
- replay 仍从 append-only Evidence 确定性重建，不增加可独立写入的活动聚合；
- 每个 Adapter/version 必须先完成 public normalizer、Registry、fixture 和语义证明，接入成本高于字段名猜测；
- Command Diff 不自动证明文件最终状态，也不替代 Workspace Window。

### 被拒绝方案

- **为 diff 新建第二类活动：** 会复制现有 Tool/Command 的 phase、outcome 与排序权威；
- **按字段名自动识别 `diff` / `patch`：** 无法区分局部片段、增量事件与完整快照；
- **读取当前文件补全 Runtime 片段：** 会扩大文件读取授权，并把晚到工作区状态伪装成 Operation 证据；
- **把 Git 最终差异附到每个 Run：** 重叠写入下无法证明单 Run 因果归属。

<a id="v1-29-d02"></a>
## V1.29-D02：Camp/exact-root Window 使用受控 Git checkpoint，Coordinator 有界 fail-open

### 背景

临时 index 不能完全隔离用户仓库；Git object 写入本身会进入用户 object database。专用 worktree 或
workspace writer lease 可以强化隔离和归因，但会显著增加 v1 的调度、磁盘与用户工作流成本。与此同时，按 Run
各自拍快照会在重叠运行时产生互相覆盖、重复投影和不真实归因。

### 决定

1. 唯一持久对象是 `WorkspaceChangeWindow`，key 为
   `campId + canonicalExecutionRoot + observedRepositoryWorktreeIdentity`；身份至少冻结
   `repositoryRoot + worktreeGitDir + gitCommonDir + objectFormat`；
2. 同 key 重叠 Run 共享 baseline；最后一个参与 Run 的 lease 已 fence/unbind，且属于它的 Runtime、CLI、Tool
   后代已证明 quiescent 后捕获 final。IdleWarm Host 不参与该判定；
3. Core DB 的 Window row 是 active coordination、OID、恢复与清理权威；完成时追加的不可变
   `WorkspaceDiffCompleted + diffBlobId` 是历史卡片/读取权威。随机 `windowId` 至少含 128-bit 熵；
   `refs/rovai/w/<window-token>/b|f` 只以 CAS 方式临时保护计算材料；
4. snapshot 只写 raw blob/tree，不经过 index、`git add`、clean filter、LFS clean、textconv 或 external diff；
   不修改 staged 状态、普通 branch/ref，也不主动执行 prune；
5. synthetic tree 只覆盖 exact execution root，并遵守 ignored/untracked、symlink、executable bit、sparse-checkout、
   nested repository/submodule 与稳定双捕获边界；
6. 新 Run join 与 `active -> closing` 原子互斥；同一 physical execution root 在 closing 时只允许有严格截止时间的
   bind 等待；任何 baseline/final/ref/身份/限制故障都使观察 `unavailable`，但 Run 和普通文件工作继续；
7. 读取必须以 `campId + windowId` 授权。其他 Camp/scope 的重叠 Rovai Run 只设置布尔观察，不暴露其 Camp、Run
   或文件活动。用户编辑器与任意外部程序始终只通过通用免责声明表达，不能假称被完整探测。

当前规范见 [Workspace Change Observation](../../architecture/workspace-change-observation.md)与
[Workspace Change Observation v1](../../contracts/workspace-change-observation-v1.md)。

### 后果

- v1 不需要改造所有 Runtime 的 workspace 模型，也不承诺单写者或因果归因；
- 用户仓库会收到 Rovai raw objects 和短期专用 refs；删除 ref 后 object bytes 何时消失仍由 Git 自身 GC 决定；
- DB OID 与 ref 一旦不一致就不可用，不允许通过事后扫描掩盖边界丢失；
- 同一 repository 的不同 Camp/execution root 保持授权隔离，但物理写入仍可能互相影响，任何未来 presentation
  必须保留该不确定性；
- 严格上限或持续变化可能牺牲 diff 可用性，以换取 Scheduler 不被 checkpoint 永久阻塞。

### 被拒绝方案

- **临时 index 并声称完全隔离：** 仍可能触发 filter/LFS，且 object database 不是隔离存储；
- **专用 worktree：** v1 的生命周期、磁盘和用户预期成本过高；
- **workspace writer lease：** 会改变并行执行产品语义，超出观察能力的范围；
- **跨 Camp 或跨 execution root 共享 Window：** 破坏授权边界并暴露参与者信息；
- **ref 作为长期权威：** 用户或工具可移动/删除 ref，且无法承载 Camp 授权与生命周期；
- **失败后重新扫描补 final：** 无法恢复原来的时间边界，会把后续用户修改混入结果。

<a id="v1-29-d03"></a>
## V1.29-D03：终态文件变更扁平呈现，完整 Review 只属于 Window Evidence

### 背景

把 `apply_patch`、文件数汇总和逐文件 diff 嵌套成三层，会重复 Runtime 的实现名并制造第二个 Activity 层级；
同时，把 Workspace Window 状态塞进执行台会改变现有会话/执行布局，也会暗示它属于某个 Run。不同 Runtime 的
文件事件名并不一致，必须以协议终态内容而不是 Tool 名称统一。

### 决定

1. Codex 只从 `item/completed + fileChange + completed` 接纳最终 `changes[]`；不消费 started、patchUpdated、
   turn diff 或 `apply_patch` input。Codex add/delete 完整内容在 Core 规范化为 unified diff；
2. 全部 ACP adapter 只从 terminal `tool_call_update` 的标准 `ToolCallContent::Diff` 累计内容接纳完整
   before/after。Claude Code 与 Antigravity 没有等价终态内容，保持普通 Tool Activity；
3. 一条 FileChange Evidence 与一条 Canonical Activity 可以投影多条同级 `修改 <basename> +A −D` 行；每行
   独立展开 inline diff。删除 `apply_patch` 父行和“编辑了 N 个文件”聚合层，不创建逐文件权威 Activity；
4. 完整 Review 只从 `WorkspaceDiffCompleted → diffBlobId` 打开。会话卡片标题固定 `Files Changed`，右侧只放
   中性 `View`；文件行顶格且无分隔，不显示时间、已保存、参与运行或底部 metadata；
5. 执行台不增加共享工作区观察，不改变会话 rail、底部/右侧 placement、Tool list 整行宽度或其他既有样式。

### 后果

- 非 Git 项目仍可显示 Runtime 可靠终态的 `修改 xxx` 行；Workspace 卡片仍只在 Git Window `complete` 时出现；
- 一个 Runtime 没有可靠 terminal file content 时，UI 不显示占位或推测摘要；
- 后续 Window 不覆盖旧卡片，Git refs/objects 或当前 workspace 不再参与历史读取；
- Renderer 只消费 Canonical typed projection，不维护 Runtime-specific 分支或第二套 Activity。

### 被拒绝方案

- **展示 `apply_patch → 编辑了 N 个文件 → files`：** 重复层级且把 Runtime 实现名误当产品语义；
- **只展示“编辑了 N 个文件”文字：** 无法直接定位和独立展开单文件变化；
- **在执行台展示 Window observation：** 混淆 Operation Evidence 与共享净变化，并破坏现有执行布局；
- **从 Tool 名、路径或 shell 命令猜 diff：** 无法证明完整性，异常退出时尤其会产生伪结果。
