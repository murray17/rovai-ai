---
document_type: version-overview
version: v1.29
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-27
---

# Rovai-ai v1.29：Camp 动态队员管理与 Workspace Change Observation

> 当前状态：动态 Camp membership、Message Delivery zero-attempt cancellation 与 Managed Attachment v2 已完成；
> Workspace Change Observation 的产品、安全与 UI 边界已确认，Core/Renderer 主路径已实现并通过定向回归，
> 跨平台 Git fixture、Codex/ACP 真实 Runtime file-diff smoke 与删除/恢复长尾仍待补齐；Claude Code `2.1.220`
> 原生 Edit smoke 已通过。
> 本版本只声明两层变更观察：Runtime 对单个
> Operation 明确报告的 Command Diff，以及当前 Camp、精确 execution root 内一组重叠 Run 之间的
> Workspace Change Window Diff。后者是 Git 工作区的有界净变化观察，不是对 Agent 的因果归因。

前置版本：[v1.28 Grok Build + MiniMax M3](../v1.28/README.md)已按冻结时事实转为 historical。

## 版本目标

本版本先允许用户在已创建的 Camp 中继续增加或移除队员，并保证成员关系变化不会复活旧 Run、Delivery、Gather
或业务工具授权；新增只影响之后冻结的 AgentRun，移除以原子 cutover 立即停止新业务效果，再由持久
reconciliation 完成已接受工作的正式结算。

同时，在不引入专用 worktree 或 workspace writer lease 的前提下，让用户可以检查：

1. Runtime 对具体 Tool / Command Operation 明确报告了哪些修改；
2. 同一 Camp、同一精确 execution root 的一组重叠运行，在两个稳定 Git 捕获点之间留下了哪些工作区净变化。

两层结果都必须保留来源、可用性与不确定性。产品不得把 Workspace Window 误称为单个 Agent 的修改，也不得
把路径、局部片段或语义不明的 Runtime 字段包装成完整文件差异。

## 交付范围

- Migration 109 建立 Windows Runtime command-shim entrypoint identity；Migration 110 建立
  `v1.23 / projection schema 64` 的动态 Camp membership；Migration 111 升为 `v1.24 / schema 65`，允许
  Message Delivery 零 attempt cancelled terminal；Migration 112 升为 `v1.25 / schema 66`，建立 Managed
  Attachment v2；Migration 113 升为 `v1.26 / schema 67`，建立 Runtime diff projection 与 Workspace
  Change Window 存储；
- 新增 `camps.members.add`、`camps.members.removalPreview`、`camps.members.remove` Desktop API；添加不创建
  Conversation，也不修改已冻结 AgentRun 的 Collaboration State；
- Camp 始终至少保留一位 active member。移除以 generation/version CAS 原子结束 membership、修复 Default Lead、
  取消目标 Run/Gather/Delivery 并释放未终态 Task；仍需终态结算的工作进入持久 reconciliation；
- 每个 Agent 业务工具、Delivery、Gather completion 与 publication 都绑定对应 exact membership lifetime；离开后
  再次添加得到新的 lifetime，旧工作不能恢复授权；
- 外部成员同步只作受信提示；System allowlist、source binding 与递增 reconciliation generation 通过后仍由 Core
  正式命令提交权威状态；
- Camp 会话增加添加入口、成员菜单、权威移除影响预览、最后成员禁用说明与非阻塞 reconciliation 状态；
- 新附件使用 Managed Attachment v2、CampMessage refs 与 durable ingest intent，不再进入 legacy publication gate，
  不等待或 fence 活跃 AgentRun；Context 继续使用 DB-only descriptor，legacy v1 只读兼容；
- 在 append-only Execution Evidence 之上为既有 Canonical Activity 增加 typed `diffProjection`；
  `phase`、`outcome` 和活动 identity 继续由现有 Canonical Activity 拥有，不建立第二套活动权威；
- 仅接纳 Adapter/version 明确声明为 unified diff snapshot、complete patch snapshot、exact mutation 或完整
  before/after 的 Runtime 数据；路径必须相对冻结 execution root 规范化并做越界检查，但该检查不授予额外文件读取权；
- 建立唯一持久的 `WorkspaceChangeWindow`，以
  `campId + canonicalExecutionRoot + observedRepositoryWorktreeIdentity` 为 key；同一 repository 的不同 Camp 或
  execution root 不共享 Window；
- 由 Core DB 持久化 Window、baseline/final tree OID、生命周期与捕获状态；完成时以不可变
  `WorkspaceDiffCompleted Evidence + diff blob` 保存历史卡片权威；
  `refs/rovai/w/<window-token>/b|f` 只是用户 Git object database 中 checkpoint object 的临时 GC pin；
- synthetic tree 只覆盖 exact execution root 下的 tracked 文件、捕获时非 ignored 的 untracked 文件，以及
  baseline 已纳入且 final 时即使变为 ignored 仍需观察的路径；
- baseline 与 final 都只有在连续两次 synthetic tree OID 相同时才接受，并受严格时间、文件数和总字节上限；
  产品语义是两个稳定捕获点之间的净变化，不声称原子文件系统快照；
- Window Coordinator 原子协调 Run join 与 `active -> closing`；最后一个 Run 的 lease 已 fence/unbind 且其
  Runtime、CLI、Tool 后代已证明 quiescent 后才开始 final capture，IdleWarm Host 不阻止结算；
- Git 观察始终 fail-open：baseline 或 final 失败、超时、仓库身份变化、ref 缺失/漂移或超限时将 Window 标记为
  `unavailable`，普通文件工作继续，且不事后重新扫描猜测旧边界；
- 非 Git execution root 不创建 Window，也不伪造 not-applicable 持久对象。
- Codex、ACP 与 Claude Edit 的可靠终态文件 Evidence 扁平显示为同级 `修改 xxx` 行；完整 Review 只属于会话中的
  `Files Changed` 历史卡片。

## 明确不做

- 不创建专用 worktree，不引入 workspace writer lease，也不阻止用户编辑器或外部程序写入；
- 不把 Workspace Window Diff 归因给单个 Run、Agent、Tool 或 Camp 外写入者；
- 不跨 Camp、跨精确 execution root 或跨 repository worktree identity 合并 Window；
- 不修改用户真实 index、staged 状态、普通 branch/ref，不执行 `git add`、clean filter、LFS clean、textconv 或
  external diff；
- 不递归进入 nested repository 或 submodule，不跟随 symlink，不把 sparse-checkout 未物化文件视为删除；
- 不允许 public client、Runtime 或知道 ref/OID/Run ID 的调用者绕过 `campId + windowId` 读取；
- 不为旧 Evidence 做无法证明正确的 diff 回填；
- 不展示 `apply_patch` 父行、“编辑了 N 个文件”聚合层、Operation 专用 Review 或执行台 Workspace observation；
- 不借本功能修改现有会话 rail、底部/右侧执行台 placement、Tool list 宽度或其他视觉结构。

## 模型上下文边界

`Collaboration State` 保持 schema v2，既有选择与冻结规则不变。每个新 AgentRun 在冻结时读取当下 active peers；
已冻结 Run 不被原位补丁修改。模型不会收到 `rosterVersion`、membership generation、成员变化 delta 或“某某本轮已离队”
之类额外叙事，授权与对账状态只属于 Core。因此动态 membership 没有 Formatter/Profile/Manifest 或模型输入合同变更；
只是既有 v2 投影开始消费用户新近改变的权威成员数据。Workspace Change Observation 同样只进入 Evidence、Canonical
Activity 与 Renderer，不追加模型上下文。

## 核心验收口径

- 同 key 的重叠 Run 只加入一个 Window；不同 Camp 或 execution root 不共享对象、参与者或文件活动；
- 新 Run join 与最后参与者关闭互斥；同一 physical execution root 的 closing 窗口只造成有截止时间的短暂 bind 等待；
- baseline 在首个 Runtime 获准写入前已落库为 `baseline_ready` 或明确 `unavailable`；Window 不可用不阻止 Run；
- ref 以 create-if-absent CAS 创建，以 expected-OID compare-and-delete 清理；diff 前 ref 必须仍精确指向 DB OID；
- synthetic tree 的路径集合、symlink、executable bit、sparse-checkout、nested repository/submodule 和稳定捕获规则
  由跨平台 fixture 验证；
- Window 的 `lifecycle` 与 `captureStatus` 独立，`no_changes` 与 `unavailable` 不混淆；
- Command Diff 只来自 adapter/version allowlist，replay 后 `revision`、`sourceEvidenceIds` 和 conflict/availability
  结果确定；
- `Files Changed` 卡片只读完成 Evidence，后续 Window、当前 workspace 或临时 ref 清理不改变旧卡片；
- presentation 不把 Window 结果归因给单个 Run/Agent；`externalWriterObserved` 只表示 Core 观察到的其他 Rovai
  运行发生物理范围重叠，不声称探测所有外部写入者；
- Codex terminal fileChange、十个 ACP adapter 的标准 Diff 通路，以及 Claude 原生 Edit 的 matching
  tool-use/result `exact_mutation` 均有 fixture；Claude 其他 Tool 与 Antigravity 因缺少等价可靠内容明确 fail closed；
- 动态 membership 覆盖 add/remove 幂等与冲突、最后成员、Lead 替换、所有业务工具 exact-run fence、
  Delivery/Gather/terminal publication、Migration clean break、双主题与键盘交互；
- Managed Attachment v2 覆盖从 Migration 111 升级 112、活跃 source Run 下 14 MiB 附件直接 dispatch、ref-only
  复用与 DB-only Context path 回归。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.28 按冻结时事实转为 historical；本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.29。 |
| Decisions | 已更新 | [V1.29-D01–D06](decisions.md#v1-29-d01)冻结 membership cutover、exact lifetime、受信外部同步、零 attempt 取消与 Managed Attachment v2；[V1.29-D07](decisions.md#v1-29-d07)冻结两层 diff 与既有 Canonical Activity 权威；[V1.29-D08](decisions.md#v1-29-d08)冻结 Camp/exact-root Window、受控 Git checkpoint 和 fail-open Coordinator；[V1.29-D09](decisions.md#v1-29-d09)冻结终态文件行与历史卡片交互。 |
| Contracts | 已更新 | 新增 [Camp Membership v1](../../contracts/camp-membership-v1.md)与 [Workspace Change Observation v1](../../contracts/workspace-change-observation-v1.md)，并升级 Camp Open、Attachment、Composer、Message Delivery、Gather 与 Missing-Send Recovery 等相关合同。 |
| Architecture | 已更新 | 新增[动态 Camp 队员关系](../../architecture/dynamic-camp-membership.md)与 [Workspace Change Observation](../../architecture/workspace-change-observation.md)；附件架构切换为 Managed v2 当前写入与 legacy v1 只读兼容，[基础架构不变量](../../architecture/foundational-invariants.md#camp-workspace)同步长期边界。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)冻结成员管理、Canonical Activity presentation rows、`Files Changed` 卡片与只读 View；其他布局不变。 |
| Runtime Activity | 已更新 | Registry 记录 Codex terminal fileChange、ACP terminal standard Diff、Claude Edit exact mutation 和 Antigravity fail-closed 边界。 |
| Runtime compatibility | 已更新 | 13 个 adapter 均已按实际协议族归类；当前代码 fixture 覆盖 Codex、十个 ACP adapter、Claude Edit 与 Antigravity negative gate；Claude Code `2.1.220` Edit 已完成真实 smoke，Codex/ACP 真实 file-diff smoke 仍待补。 |
| Documentation routing | 已更新 | 文档总导航、Architecture/Contract 索引与当前决定导航已增加动态 membership、Managed Attachment v2 与 Workspace Change Observation 入口。 |
| Root README | 确认无需更新 | 当前仍为 in-progress，且不改变项目定位或已交付的常青能力声明。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Workspace Change Observation 架构](../../architecture/workspace-change-observation.md)
- [Workspace Change Observation v1 合同](../../contracts/workspace-change-observation-v1.md)
