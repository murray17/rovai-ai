---
document_type: version-overview
version: v1.29
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: not_started
model_context_change: false
last_updated: 2026-08-26
---

# Rovai-ai v1.29：Command Diff 与 Workspace Change Window

> 当前状态：产品与安全边界已确认，实现尚未开始。本版本只声明两层变更观察：Runtime 对单个
> Operation 明确报告的 Command Diff，以及当前 Camp、精确 execution root 内一组重叠 Run 之间的
> Workspace Change Window Diff。后者是 Git 工作区的有界净变化观察，不是对 Agent 的因果归因。

前置版本：[v1.28 Grok Build + MiniMax M3](../v1.28/README.md)已按冻结时事实转为 historical。

## 版本目标

在不引入专用 worktree 或 workspace writer lease 的前提下，让用户可以检查：

1. Runtime 对具体 Tool / Command Operation 明确报告了哪些修改；
2. 同一 Camp、同一精确 execution root 的一组重叠运行，在两个稳定 Git 捕获点之间留下了哪些工作区净变化。

两层结果都必须保留来源、可用性与不确定性。产品不得把 Workspace Window 误称为单个 Agent 的修改，也不得
把路径、局部片段或语义不明的 Runtime 字段包装成完整文件差异。

## 交付范围

- 在 append-only Execution Evidence 之上为既有 Canonical Activity 增加 typed `diffProjection`；
  `phase`、`outcome` 和活动 identity 继续由现有 Canonical Activity 拥有，不建立第二套活动权威；
- 仅接纳 Adapter/version 明确声明为 unified diff snapshot、complete patch snapshot、exact mutation 或完整
  before/after 的 Runtime 数据；路径必须相对冻结 execution root 规范化并做越界检查，但该检查不授予额外文件读取权；
- 建立唯一持久的 `WorkspaceChangeWindow`，以
  `campId + canonicalExecutionRoot + observedRepositoryWorktreeIdentity` 为 key；同一 repository 的不同 Camp 或
  execution root 不共享 Window；
- 由 Core DB 持久化 Window、baseline/final tree OID、生命周期、捕获状态、授权关系与最终 Managed Blob；
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

## 明确不做

- 不创建专用 worktree，不引入 workspace writer lease，也不阻止用户编辑器或外部程序写入；
- 不把 Workspace Window Diff 归因给单个 Run、Agent、Tool 或 Camp 外写入者；
- 不跨 Camp、跨精确 execution root 或跨 repository worktree identity 合并 Window；
- 不修改用户真实 index、staged 状态、普通 branch/ref，不执行 `git add`、clean filter、LFS clean、textconv 或
  external diff；
- 不递归进入 nested repository 或 submodule，不跟随 symlink，不把 sparse-checkout 未物化文件视为删除；
- 不允许 public client、Runtime 或知道 ref/OID/Run ID 的调用者绕过 `campId + windowId` 读取；
- 不为旧 Evidence 做无法证明正确的 diff 回填。
- 本次设计不冻结 UI 的布局、组件、入口、文案或交互；这些在后续独立 UI 讨论中确定。

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
- 任一未来 presentation 都不得把 Window 结果归因给单个 Run/Agent，且必须保留“可能包含用户编辑器、外部程序
  或其他并行运行修改”的不确定性；`externalWriterObserved` 只表示 Core 观察到的其他 Rovai 运行发生物理范围
  重叠，不声称探测所有外部写入者。具体 UI 形式留待后续确认。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.28 按冻结时事实转为 historical；本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.29。 |
| Decisions | 已更新 | [V1.29-D01](decisions.md#v1-29-d01)冻结两层 diff 与既有 Canonical Activity 权威；[V1.29-D02](decisions.md#v1-29-d02)冻结 Camp/exact-root Window、受控 Git checkpoint 和 fail-open Coordinator。 |
| Contracts | 已更新 | [Workspace Change Observation v1](../../contracts/workspace-change-observation-v1.md)定义 Command Diff projection、Window 字段、状态、授权、捕获、ref 和读取语义。 |
| Architecture | 已更新 | [Workspace Change Observation](../../architecture/workspace-change-observation.md)定义 Evidence、Window Coordinator、Git capture、Managed Blob 与授权读取的职责组合；[基础架构不变量](../../architecture/foundational-invariants.md#camp-workspace)补充长期边界。 |
| UI | 确认无需更新 | 本次只冻结 presentation-neutral 的数据真实性边界；布局、组件、入口、文案与交互留待后续独立 UI 方案确认。 |
| Runtime Activity | 确认无需更新 | 设计阶段不虚构任何 Adapter 已提供完整 diff；实施时必须先更新 public normalizer、Registry 与 replay fixture，才可把对应字段加入 allowlist。 |
| Runtime compatibility | 确认无需更新 | 本版本尚未形成 Runtime/version 的实测 diff 能力结论；现有兼容性清单不因目标合同而改变。 |
| Documentation routing | 已更新 | 文档总导航、Architecture/Contract 索引与当前决定导航已增加本版本的当前入口。 |
| Root README | 确认无需更新 | 功能尚未实现，且本次版本设计不改变项目定位或已交付的常青能力声明。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Workspace Change Observation 架构](../../architecture/workspace-change-observation.md)
- [Workspace Change Observation v1 合同](../../contracts/workspace-change-observation-v1.md)
