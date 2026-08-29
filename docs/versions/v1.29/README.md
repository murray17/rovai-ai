---
document_type: version-overview
version: v1.29
lifecycle: current
authority: version-scope-and-status
design_status: confirmed
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-30
---

# Rovai-ai v1.29：Camp 动态队员管理与 Runtime 文件变化

> 当前状态：动态 Camp membership、Message Delivery zero-attempt cancellation、Managed Attachment v2、安全退出、
> ACP Client FS/Terminal 权限收敛，以及 Runtime Evidence 驱动的 Command Diff / AgentRun 文件变化主路径已经实现并
> 通过定向回归；Runtime Activity 已切换到 `activity-v2` 新 operation 写入、类型化 Search Operation、Renderer 中文标题与
> 七类图标；Desktop Navigation 已切换为提交后事件驱动、全局 generation drain 与 20 秒前台安全刷新。
> 真实打包 App 的多 Runtime 文件变化复测仍待完成。
>
> 本版本未发布，因此文件变化能力采用 clean break：完全删除 Git tree、Workspace Change Window、baseline/final
> filesystem capture、checkpoint ref、Window RPC/Read Model 与旧 Workspace Window Review，不保留兼容 reader 或
> 旧 schema 数据迁移。新的 Files Changed Review 只读取每 Run 的 typed projection 与 detail blob。

前置版本：[v1.28 Grok Build + MiniMax M3](../v1.28/README.md)已按冻结时事实转为 historical。

## 版本目标

本版本允许用户在既有 Camp 中继续增加或移除队员，并保证成员变化不会复活旧 Run、Delivery、Gather 或业务工具
授权；新增只影响未来冻结的 Run，移除以原子 cutover 立即停止新业务效果，再由持久 reconciliation 完成结算。

文件变化能力只回答 Runtime 能证明的两类问题：

1. `Command Diff`：这一次成功 Operation 明确报告了哪个文件以及哪些可靠内容；
2. `AgentRun File Changes`：这一个 `agentRunId + executionEpoch` 在 terminal 前累计报告了哪些成功文件变化。

两者共享 append-only Execution Evidence，但使用独立 projector。Core 不扫描工作区、不读取当前文件、不解析 shell
命令，也不使用 Git；因此 Git 与非 Git Camp 行为一致，并行 Run 各自产生自己的卡片。

## 交付范围

- Migration 109 建立 Windows Runtime command-shim identity；Migration 110 建立动态 Camp membership；Migration
  111 接受 Message Delivery zero-attempt cancelled terminal；Migration 112 建立 Managed Attachment v2；
- Migration 113 保留 `v1.25 / projection schema 66`，把 durable shutdown cycle 扩为 v2/v3；Migration 114 只为
  既有 Canonical Activity 增加 typed Command Diff projection；Migration 115 建立
  `agent_run_file_change_projection` 与 `complete | no_changes` 幂等 checkpoint，并把当前 Data Contract 升为
  `v1.28 / projection schema 69`；Migration 116 只把新 operation 的 classifier 切换为
  `v1.29 / projection schema 70 / activity-v2`，不重写历史 v1 row；
- 不创建或迁移任何 Workspace Window、participant、coordinator、baseline/final、manifest、OID 或 ref cleanup
  表；使用过未发布中间 schema 的本地数据按 current Data Contract clean break 处理；
- 新增 `camps.members.add`、`camps.members.removalPreview`、`camps.members.remove`；Camp 至少保留一位 active
  member，移除采用 generation/version CAS 与 durable reconciliation；
- 每个 Agent 业务工具、Delivery、Gather completion 与 publication 都绑定 exact membership lifetime；重新添加
  同一 Agent 得到新 lifetime，旧工作不能恢复授权；
- 新附件使用 Managed Attachment v2、CampMessage refs 与 durable ingest intent，不等待或 fence 活跃 AgentRun；
  Context 继续使用 DB-only descriptor，legacy v1 只读兼容；
- 退出、重启与更新统一取消全部非终态 AgentRun；稳定快照后关闭 terminal/route 准入，短时请求 Runtime 中断，
  再完成 Run 取消审计、未知效果保留与本地收口；冷启动与关闭均使用 400ms 防闪反馈；
- ACP Client FS 与 Terminal 只作 fenced 执行代理。文件与 Shell 权限由 Runtime/OS 拥有；execution root 是默认
  cwd 和相对路径基准，不是 sandbox；
- Runtime 文件 Evidence 保留四种语义：`full_before_after`、`unified_diff_snapshot`、`exact_mutation`、
  `operation_only`；只有 Adapter 能从可靠终态证明的数据才能准入；
- execution root 同时作为 display root：root 内文件显示相对路径，Runtime 明确报告的 root 外文件显示规范化绝对
  路径并继续进入该 Run 卡片；当前 Built-in Tool Process 的精确 `ROVAI_RUN_TMP` 及后代除外，它们在 Evidence
  ingress 前按 path component 排除；
- Codex Command View 使用 terminal completed `fileChange`；Run card 优先使用 matching turn completed 后发布的
  最新 `turn/diff/updated` snapshot，空 snapshot 表示 display root 内 no-change；显式 root 外 terminal fileChange
  仍补入卡片，缺失或不可解析时回退全部 terminal fileChange；
- ACP 累计同 ToolCall 的标准 Diff、location、stable meta 与 adapter 允许的 rawInput aliases；完整 old/new 形成
  FullBeforeAfter，可靠单路径形成 OperationOnly，失败/取消不发布；
- Claude Code 只从成功配对的原生 `Edit` 生成 ExactMutation；`replace_all=true`、Write、NotebookEdit、
  ApplyPatch 与 Antigravity 不补猜；
- 一个 Run 的连续完整状态链归约为首态到末态；roundtrip 文件消失；链断裂只降级该文件；exact mutation 保留时序；
  operation-only 保留时序与计数但不参与 Diff 统计；只有每个文件都有可靠统计时才显示全局 `+A −D`；
- 会话每 Run 最多显示一张 `Files Changed` 卡片，默认显示三行并可原位展开文件清单；header `View` 与文件行进入
  同一独立 Review。Command View 仍扁平显示 `修改 xxx`，没有 `apply_patch` 父行或“编辑了 N 个文件”聚合层；
- managed output 与普通文件混合时只展示普通文件；全 managed Run snapshot 成为权威空结果。历史 Evidence 与
  卡片不迁移、不重新投影，通过临时区发布的附件继续由 Camp Attachment 独立展示；
- Camp Open Snapshot 升为 schema 34、Open schema 5；detail 只允许
  `campId + agentRunId + executionEpoch` 授权读取，受管 detail blob 不进入模型上下文。
- Desktop Navigation 使用一个全局 refresh coordinator：Core 在影响投影的提交后发失效提示，Renderer 以
  80ms debounce、single-flight generation drain、1/2/5/10 秒失败退避与 focus 抢占收敛；隐藏时暂停，前台
  20 秒安全刷新只作漏事件兜底，Overview 附属模块失败不再关闭侧栏恢复。
- Runtime Activity 新写入只产生 Shell/File/Tool/Runtime/Unknown 五域，file/web/generic search 使用不同
  semantic kind；已有 v1 operation 继续用 v1 结算，Read Side 双读 v2/v1，历史不回填；
- Renderer 统一拥有中文标题与 Terminal/File/Web/Tool/Rovai/Runtime/Unknown 七类图标；Rovai 图标只认 Core
  Catalog identity，不认标题或 Shell `rovai` 文本；搜索词只从 available `runtimeSearchOperation` 与 Canonical
  Web identity 的交集展示，不按任意 `query` 字段升级，不做敏感词过滤；单项直接显示，多项以 `query` 保留首项、
  `queries` 保留顺序并用中文逗号展示，Web 搜索计入连续 Tool 组操作数。

## 明确不做

- 不创建 Git synthetic tree、baseline/final capture、checkpoint ref、Window coordinator 或 workspace scanner；
- 不把用户编辑器、shell、其他 Run 或外部进程未被 Runtime 报告的写入加入卡片；
- 不把当前 `ROVAI_RUN_TMP` 内的临时交付文件加入 Command 或 Run 卡片，也不把排除范围扩大到整个 data dir；
- 不跨 Run、Camp 或 execution epoch 合并文件变化；
- 不读取当前文件补齐 partial mutation，不从 Tool title、自由文本、output 或命令推断 diff；
- 不把 operation-only 或 exact mutation 包装为完整文件净差异；
- 不建立第二套 Activity，不为逐文件 presentation row 分配独立 phase/outcome；
- 不从 Review 跳转编辑器、读取当前 workspace 或补造缺失 diff；不在执行台增加共享 workspace observation；
- 不借本功能修改会话 rail、底部/右侧执行台 placement、Tool list 整行宽度或其他既有视觉结构。

## 模型上下文边界

`Collaboration State` 保持 schema v2。每个新 AgentRun 冻结当下 active peers；既有 Run 不被原位修改。membership
generation、reconciliation 与文件变化 projection 都不进入模型上下文。Runtime File Change Evidence、卡片 summary
与 detail blob 只属于 Core audit/read side，不追加到 Context、Bootstrap、Camp public message 或 Agent built-in。

## 核心验收口径

- 每个 `agentRunId + executionEpoch` 至多一个 `complete | no_changes` projection；startup recovery 重放确定且幂等；
- terminal ingress flush 后才投影；failed/cancelled Run 可包含此前成功变化，failed/cancelled Operation 不进入；
- 三个并行 Run 产生三张独立卡片，不互相等待；非 Git目录与 Git目录得到同一行为；
- Codex 最新 matching turn snapshot 权威，空 snapshot 抑制 fallback；没有 snapshot 时 terminal fileChange 可回退；
- exact `ROVAI_RUN_TMP` 在 macOS/Linux/Windows 均于 ingress 排除；mixed Evidence 保留普通文件，
  `run-tmp-copy` 与普通 root 外用户路径不误伤，旧 projection 不回写；
- ACP sparse terminal 能使用同 ToolCall 缓存的可靠字段；Kiro `file:` URI、绝对/相对路径严格规范化，root 外
  文件保留绝对展示路径；Kimi/Qoder path-only 生成 `修改 xxx` 与 operation-only 记录，同文件后续可靠 Diff
  仍可生成内容与增删统计；
- Claude ExactMutation 没有虚假 `@@`/行号；连续 Edit 保留顺序；完整 A→B、B→C 收敛 A→C，A→B、B→A 不显示；
- `runtime_diff_no_changes` 不进入卡片；同文件剩余可靠 Diff 可继续归约 `+A −D`，path-only operation 只计入时序
  与操作数；任一纯 operation-only 文件仍使整张卡片回退为修改次数；
- detail 读取强制 Camp 归属、Run、epoch 与 blob identity；Managed Blob GC 保留 active projection root；
- 当前数据库不存在 workspace change tables，Core 启动、Run claim/cancel/terminal 不执行 Git capture；
- Migration 116 不改写 v1 Canonical row；新 operation 使用 v2，升级前已开始的 operation 仍在 v1 结算；
- Web/file/generic search 分类、精确单项/多项 query、无标签直接展示、Tool 组计数、Renderer 中文标题与七类图标
  fixture 通过；字面 Shell `rovai ...` 保持 Terminal，Core-verified `camp.read` 使用 Rovai 图标；
- Renderer 保留现有会话连接轨、执行台形态和 Tool 横条，仅增加明确的 Command rows 与 Run timeline card；
- 动态 membership、Managed Attachment v2 与 ACP Client FS/Terminal 既有验收继续通过；
- 修复后的 Kimi Code `0.38.0`、Qoder `1.1.28`、Kiro `2.18.1`、Codex、Claude 及其他可用 Runtime 真实 App
  file-change smoke 完成前，不把 fixture 表述成真实 Runtime 交付证据。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.28 按冻结时事实转为 historical；本概览、[实施计划](implementation-plan.md)、[决定](decisions.md)与[版本索引](../README.md)建立唯一 current v1.29。 |
| Decisions | 已更新 | [V1.29-D01–D06](decisions.md#v1-29-d01)冻结 membership、Delivery 与 Attachment；[D07](decisions.md#v1-29-d07)冻结安全退出；[D08](decisions.md#v1-29-d08)冻结共享 Evidence/独立 projector；[D09](decisions.md#v1-29-d09)彻底放弃 Workspace capture；[D10](decisions.md#v1-29-d10)冻结 Command inline 与 Run Review presentation；[D11](decisions.md#v1-29-d11)冻结 ACP FS/Terminal Runtime-owned 权限；[D12](decisions.md#v1-29-d12)冻结 Navigation 提交后失效与 generation drain；[D13](decisions.md#v1-29-d13)冻结 managed run output exclusion；[D14](decisions.md#v1-29-d14)冻结 activity-v2、无历史回填、类型化 Search Operation 与图标 identity。 |
| Contracts | 已更新 | 新增 [Camp Membership v1](../../contracts/camp-membership-v1.md)、[Planned Shutdown v3](../../contracts/planned-shutdown-v3.md)，并以 [Runtime File Change Observation v2](../../contracts/runtime-file-change-observation-v2.md)替代 v1；Runtime Launch v28 与 ACP Client Terminal v2 收口代理权限；[Run Process Detail Surface v25](../../contracts/run-process-detail-surface-v25.md)继承 v24 并成为当前活动展示入口。 |
| Architecture | 已更新 | 新增[动态 Camp 队员关系](../../architecture/dynamic-camp-membership.md)、[Runtime File Change Observation](../../architecture/runtime-file-change-observation.md)与[Desktop Navigation Refresh](../../architecture/desktop-navigation-refresh.md)；[计划关闭](../../architecture/planned-shutdown.md)切换为退出取消全部 AgentRun；基础不变量同步无 Git/无扫描的每 Run Evidence projection。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)冻结 `修改 xxx` rows、每 Run 卡片、七类 Activity 图标、Search Operation disclosure、Shell `$ command` 连续结果与关闭等待面；[App Shell](../../ui/components/app-shell-navigation.md)冻结 400ms 冷启动反馈与事件驱动 Navigation 新鲜度；其他布局不变。 |
| Runtime Activity | 已更新 | Registry 切换 `activity-v2` 新 operation mapping，记录五域、三类 search、v2/v1 双读和无历史回填；Run snapshot 仍是独立 Evidence event。 |
| Runtime compatibility | 已更新 | 13 个 adapter 按实际协议族归类；当前 fixture 覆盖 Codex、ACP、Claude 与 Antigravity negative gate，修复后真实 App 复测仍待完成。 |
| Documentation routing | 已更新 | 文档总导航、Architecture/Contract 索引与当前决定导航切换到 Runtime File Change Observation，并加入 Desktop Navigation Refresh；不保留 Window 当前入口。 |
| Root README | 确认无需更新 | 当前仍为 in-progress，且不改变项目定位或已交付的常青能力声明。 |

## References

- [实施与验收计划](implementation-plan.md)
- [版本决定](decisions.md)
- [Runtime File Change Observation 架构](../../architecture/runtime-file-change-observation.md)
- [Runtime File Change Observation v2 合同](../../contracts/runtime-file-change-observation-v2.md)
- [Run Process Detail Surface v25](../../contracts/run-process-detail-surface-v25.md)
- [Runtime Activity Mapping Registry](../../runtime-activity/registry.md)
- [Runtime Launch and Verification v28](../../contracts/runtime-launch-and-verification-v28.md)
- [ACP Client Terminal v2](../../contracts/acp-client-terminal-v2.md)
- [Desktop Navigation Refresh](../../architecture/desktop-navigation-refresh.md)
