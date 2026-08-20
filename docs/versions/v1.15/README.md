---
document_type: version-overview
version: v1.15
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
model_context_change: true
last_updated: 2026-08-20
---

# Rovai-ai v1.15：Windows x64 产品实现与资格闭环

> 当前状态：v1.05 形成的 Windows 长期决定、Contract、Architecture 与 Interaction Delta 继续有效；本版在
> 已发布的 v1.14 基线上实施这些约束。平台 seam、native frame、Runtime 平台准入、native executable
> resolver、原子 Job 启动、私有 Core/Desktop data root、handle-relative Attachment、managed Skill Library、
> crash-recoverable Skill Projection 与共享异步 Named Pipe client 已进入代码。固定 Windows CI 实跑、Windows
> client OS 验收、逐 Runtime 资格、NSIS 与签名尚未完成，因此不得宣称 Windows 已发布。
>
> 模型上下文补充：[排除自身发布 recent public message 的 revision 1](model-context-change-self-authored-recent-messages.md)
> 已由开发者二次确认并实现为 Context Delivery Profile v4、ContextManifest Evidence v19、schema 53 与
> Migration 98；定向 Rust/Contract/文档与 workspace 回归结果记录在变更说明末尾。
>
> [Camp Published Attachment Runtime View revision 2](model-context-change-runtime-attachment-session-projection.md)
> 已由开发者二次确认并实施：Authority Attachment 保持在私有 data directory，Draft 保持 Core-private，
> Published Attachment 通过实例隔离、Camp-shared View 供当前 Camp Runtime 枚举和只读访问。新输入使用
> Formatter 21、Manifest 20、Run Facts v2、schema 54 与 Migration 99；Run/Agent Session projection 方案均撤回。
>
> 执行台位置的本机安装级全局偏好已完成设计确认并进入 [V1.15-D05](decisions.md#v1-15-d05)与
> [Run Process Detail Surface v14](../../contracts/run-process-detail-surface-v14.md)；生产代码、自动测试与
> packaged App 验收尚未实施，不能把文档状态当作交付完成。
>
> 前置版本：[v1.14 `camp.read` 安全 Timeline 默认](../v1.14/README.md)。v1.14 已完成并冻结为 historical。

## 版本目标

在不回退 v1.10 Camp identity、v1.11 Runtime 模型目录、v1.12 AgentRun 局部停止、v1.13 实际 Runtime 模型
观测、v1.14 `camp.read` 安全 Timeline 默认与 Built-in Transport v17、macOS 能力和安全边界的前提下，交付
Windows 10 22H2+ 与 Windows 11 native x64 Desktop：Core、CLI、Desktop 可构建和安装，进程、IPC、私有存储、
Attachment、MCP、Skill Projection 与 Renderer 具有真实 Windows backend；每个 Runtime 只有在独立证据完成后
才可被选择和执行。

本版实现依据 [v1.05 Windows 决策记录](../v1.05/decisions.md)、当前 Windows Contracts 与 Windows Desktop
Platform。历史 v1.05 只保留当时设计过程和未实施快照，不作为当前实现状态来源。

## 交付范围

- 完成 `x86_64-pc-windows-msvc` 全 targets、Desktop sidecar staging、native frame 与平台目录布局；
- 所有 Runtime、Probe 与 one-shot 通过原子 `CreateProcessW + STARTUPINFOEXW + JOB_LIST + HANDLE_LIST` launcher；
- Windows Runtime search、native EXE/validated Node shim、file identity 与平台资格矩阵保持单一 Rust 权威；
- `%LOCALAPPDATA%` Core/User Data/Session Data/Logs/CrashDumps 使用 local NTFS admission 和创建时 protected DACL；
- Attachment 使用 retained handle 与 handle-relative traversal，拒绝 reparse、identity drift 与非准入存储；
- 新增 journaled Camp Published Attachment View、统一 Runtime path resolver、Camp generation fence 与
  Migration 99 clean break/backfill，同时保持 Authority、历史 Manifest/Blob/Evidence 和 `contentDigest` 不变；
- Skill Library 使用 Windows logical mode；Skill Projection 使用同父目录 copy、schema 2 journal、operationId、
  NTFS entry identity、持久 Run registration、bounded sharing retry 和 crash-window recovery；
- 完成 secured Named Pipe Built-in Transport v17、Windows Renderer Interaction Delta、NSIS、PE/manifest verifier、
  Authenticode 与真实 Windows 10/11 acceptance；
- 执行台在底部与 Inspector 间移动同一 DOM，统一四轨 Tool 行、九类 SVG、精简队员入口和
  展开后完整 Tool 结果的内部滚动/键盘语义；
- 执行台最后一次成功的显式位置选择成为 Main-owned 本机安装级偏好，跨 Camp、页面切换和应用重启，
  旧偏好缺失字段时只补默认底部，并与 Inspector 显隐独立；
- 十个 Adapter 逐一取得 digest-bound Windows evidence；未完成者保持 `not_qualified`。

## 数据迁移

已发布的 Migration 96 保持归属于 v1.13：它从 `v1.10 / projection schema 50` 增加 nullable
`agent_run.runtime_observed_model_id`，并推进到 `v1.13 / schema 51`。产品 v1.14 没有数据库 Migration 或
持久数据 shape 变化，Windows 不复用或重写 Migration 96。

Migration 97 只接受已完整应用 Migration 96 的 `v1.13 / projection schema 51`，安装：

- `skill_projection_observation.operation_id` 与唯一非空索引；
- `skill_projection_observation.entry_identity`，绑定投影目录的 canonical volume/file ID；
- `skill_projection_run_registration`，以 AgentRun execution epoch 和 canonical root identity 持久化 Windows
  Execution Root Projection Gate；
- Data Contract `v1.15 / projection schema 52`。

该迁移不重写 ContextManifest 18、Formatter 20、Camp identity、AgentRun 实际模型、Built-in Transport v17
或已有 Skill exposure。schema 52 无 downgrade reader；不满足精确 v1.13/schema 51 来源条件的 store 继续按
既有 admission/quarantine 策略 fail closed。

Migration 98 只接受已完整应用 Migration 97 的 `v1.15 / projection schema 52`。它将
`context_manifest.context_delivery_profile_version` 从 3 clean break 到 4，关闭非终态 Run/Turn/Delivery/
Gather，移除旧 frozen context、Manifest/Input/Bootstrap/compaction/resume evidence，清除 Native
Session/Binding 与 accepted boundary，并推进到 `v1.15 / projection schema 53`。CampMessage、Camp、Task、
Memory、Agent 与 Runtime/Library 业务事实保留；没有 Profile v3/Manifest v18 reader、dual write 或 downgrade。

Migration 99 只接受已完整应用 Migration 98 的 `v1.15 / projection schema 53`，且在 SQLite mutation 前要求
当前实例 Runtime Files Root 已通过 admission、为空并完成 Authority/quota preflight。它按 accepted input、
delivery 与 action evidence 诚实终结所有旧非终态 Formatter 20 执行，fence 当前 Session/Binding，但逐字节保留
历史 Manifest 19、模型输入 Blob、ACK、Execution Evidence、摘要和 Authority `storage_path/contentDigest`。
随后从 `message_attachment` 回填 Camp Published Attachment View，绝不投影 `prepared_attachment`，并推进到
`v1.15 / projection schema 54`。新写入只允许 Formatter 21 / Manifest 20 / Run Facts v2 pairing。

执行台位置不产生 Core 数据库 Migration。Main-owned General Preferences 自身推进到 schema 3；旧 v1/v2
文件在读取时保留可识别字段并补 `executionConsolePlacement=bottom`，不从历史 Camp 或 Renderer 瞬时状态
回填，也不提供 downgrade reader。

## 验收边界

- macOS workspace、Core tests、Desktop 与既有文档门禁保持通过；
- Windows Rust 全 targets 和 Windows-only tests 在固定 CI image 编译并执行；
- Skill journal 在每个 copy/rename/journal/DB/cleanup transition 的 crash injection 后可恢复或稳定关闭准入；
- 相同内容但不同 NTFS file identity、project-owned、reparse、DACL drift 与 ambiguous journal 均保留且不覆盖；
- Windows 10 22H2 与 Windows 11 的 native frame、DPI、Forced Colors、NVDA、IME、Explorer、安装/升级/卸载
  由真实 client OS 验收；Windows Server CI 不替代这些证据；
- 每个 `qualified` Runtime 独立覆盖 discovery、identity、authentication、first run、continuation、Built-in Tool、
  approval、cancel、terminal、process cleanup 与 planned shutdown；
- 执行台位置覆盖旧偏好默认、跨 Camp/一级页面/重启、原子写失败不移动、Inspector hidden 组合和首个
  Camp meaningful paint 无 bottom→inspector 闪跳；
- Electron EXE、`rovai-core.exe`、`rovai.exe` 和 installer 分别验证架构、manifest、hash、签名与时间戳后才可发布。

## 明确不做

- 不支持 Windows x86/ARM64、WSL Core、Linux、MSIX/Store、企业 MSI、系统服务或自动更新；
- 不支持 UNC/network/removable/non-NTFS workspace，也不在安装器中修改 HKLM long-path policy；
- 不使用 localhost TCP、PowerShell、通用 cmd/bat launcher、spawn 后 attach Job、PID 猜测或先创建后补 ACL；
- 不用 Windows Server CI、三类 execution-shape 测试或 green build 代替逐 Runtime/client OS 资格；
- 不建立第二套 Renderer 组件树、主题、信息架构或 Windows 专属产品世界。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.14 冻结为 historical；本概览、实施计划和版本索引建立唯一 current v1.15。 |
| Decisions | 已更新 | [V1.15-D01](decisions.md#v1-15-d01)记录运行中 AgentRun 优先完整 Evidence chronology；[V1.15-D02](decisions.md#v1-15-d02)记录用户显式展开后完整 Tool 结果与稳定执行台 DOM；[V1.15-D03](decisions.md#v1-15-d03)记录自身公屏输出不再作为同一 Agent 的 recent 未读候选；[V1.15-D04](decisions.md#v1-15-d04)记录 Camp-shared Published Attachment View；[V1.15-D05](decisions.md#v1-15-d05)记录 Main-owned 本机安装级执行台位置偏好。 |
| Contracts | 已更新 | [Run Process Detail Surface v14](../../contracts/run-process-detail-surface-v14.md)成为执行台当前入口；[Camp Published Attachment View v1](../../contracts/camp-published-attachment-view-v1.md)、[Camp Attachment v2](../../contracts/camp-attachment-v2.md)、[ContextManifest Evidence v20](../../contracts/context-manifest-evidence-v20.md)、[Run Facts v2](../../contracts/run-facts-v2.md)、[Runtime Launch and Verification v10](../../contracts/runtime-launch-and-verification-v10.md)、[Accepted Input Recovery v2](../../contracts/accepted-input-recovery-v2.md)、[Camp Permanent Deletion v2](../../contracts/camp-permanent-deletion-v2.md)与[Windows Private Storage v2](../../contracts/windows-private-storage-v2.md)继续拥有其各自当前边界。 |
| Architecture | 已更新 | [Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)继续拥有 Authority/View、publication gate、generation、恢复与生命周期；[产品/执行表面不变量](../../architecture/foundational-invariants.md#product-execution-surface)增加 Main-owned 全局 placement、旧偏好默认及独立 Inspector visibility。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)保留 AgentRun 直接停止、完整 chronology、唯一 Drawer DOM 与完整 Tool 结果，并增加跨 Camp/重启的位置偏好、写失败及 Inspector hidden 组合。 |
| Runtime Activity | 确认无需更新 | 平台 backend 与资格状态不改变 Canonical Runtime Activity mapping；出现新 telemetry 时再按维护指南评审。 |
| Runtime compatibility | 已更新 | 所有 Adapter 当前 attachment visibility 均记录为 `generation_fenced_v1`；没有 TRAE live-append 正向 Probe，Windows 行继续保持 `not_qualified`。 |
| Documentation routing | 已更新 | 文档导航、Architecture/Contract 索引、决定导航、UI 验收、版本概览和实施计划路由到 Run Process Detail Surface v14；既有 Camp Published Attachment View 与 Manifest 20/Run Facts v2 路由继续有效。 |
| Root README | 确认无需更新 | Windows 尚未完成真实验收或发布，根 README 不提前声明常青 Windows 支持。 |

## References

- [模型上下文变更 revision 1：排除自身发布的 recent public message](model-context-change-self-authored-recent-messages.md)
- [模型上下文变更 revision 2：Camp Published Attachment Runtime View](model-context-change-runtime-attachment-session-projection.md)
- [实施与验收计划](implementation-plan.md)
- [v1.15 决策记录](decisions.md)
- [Camp Published Attachment View](../../architecture/camp-published-attachment-view.md)
- [Camp Published Attachment View v1](../../contracts/camp-published-attachment-view-v1.md)
- [Camp Attachment v2](../../contracts/camp-attachment-v2.md)
- [Context Delivery Profile v4](../../contracts/context-delivery-profile-v4.md)
- [ContextManifest Evidence v20](../../contracts/context-manifest-evidence-v20.md)
- [Run Facts v2](../../contracts/run-facts-v2.md)
- [v1.05 Windows 决策记录](../v1.05/decisions.md#历史-adr-索引)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Windows Skill Projection v1](../../contracts/windows-skill-projection-v1.md)
- [Windows Private Storage v2](../../contracts/windows-private-storage-v2.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
- [Managed Runtime Process v1](../../contracts/managed-runtime-process-v1.md)
- [Runtime Launch and Verification v10](../../contracts/runtime-launch-and-verification-v10.md)
- [Built-in Tool Transport v17](../../contracts/builtin-tool-transport-v17.md)
- [Run Process Detail Surface v14](../../contracts/run-process-detail-surface-v14.md)
- [Camp Open Projection v5](../../contracts/camp-open-projection-v5.md)
- [Windows Interaction Delta](../../ui/windows-interaction-delta.md)
- [Windows packaging guide](../../development/packaging-windows.md)
