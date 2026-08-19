---
document_type: version-overview
version: v1.15
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
model_context_change: true
last_updated: 2026-08-19
---

# Rovai-ai v1.15：Windows x64 产品实现与资格闭环

> 当前状态：v1.05 形成的 Windows 长期决定、Contract、Architecture 与 Interaction Delta 继续有效；本版在
> 已发布的 v1.14 基线上实施这些约束。平台 seam、native frame、Runtime 平台准入、native executable
> resolver、原子 Job 启动、私有 Core/Desktop data root、handle-relative Attachment、managed Skill Library、
> crash-recoverable Skill Projection 与共享异步 Named Pipe client 已进入代码。固定 Windows CI 实跑、Windows
> client OS 验收、逐 Runtime 资格、NSIS 与签名尚未完成，因此不得宣称 Windows 已发布。
>
> 模型上下文补充：[排除自身发布 recent public message 的 revision 1](model-context-change-self-authored-recent-messages.md)
> 已由开发者二次确认，当前进入隔离 worktree 实施；本文档提交仍不宣称实现已经完成。
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
- Skill Library 使用 Windows logical mode；Skill Projection 使用同父目录 copy、schema 2 journal、operationId、
  NTFS entry identity、持久 Run registration、bounded sharing retry 和 crash-window recovery；
- 完成 secured Named Pipe Built-in Transport v17、Windows Renderer Interaction Delta、NSIS、PE/manifest verifier、
  Authenticode 与真实 Windows 10/11 acceptance；
- 执行台在底部与 Inspector 间移动同一 DOM，统一四轨 Tool 行、九类 SVG、精简队员入口和
  展开后完整 Tool 结果的内部滚动/键盘语义；
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

## 验收边界

- macOS workspace、Core tests、Desktop 与既有文档门禁保持通过；
- Windows Rust 全 targets 和 Windows-only tests 在固定 CI image 编译并执行；
- Skill journal 在每个 copy/rename/journal/DB/cleanup transition 的 crash injection 后可恢复或稳定关闭准入；
- 相同内容但不同 NTFS file identity、project-owned、reparse、DACL drift 与 ambiguous journal 均保留且不覆盖；
- Windows 10 22H2 与 Windows 11 的 native frame、DPI、Forced Colors、NVDA、IME、Explorer、安装/升级/卸载
  由真实 client OS 验收；Windows Server CI 不替代这些证据；
- 每个 `qualified` Runtime 独立覆盖 discovery、identity、authentication、first run、continuation、Built-in Tool、
  approval、cancel、terminal、process cleanup 与 planned shutdown；
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
| Decisions | 已更新 | [V1.15-D01](decisions.md#v1-15-d01)记录运行中 AgentRun 优先完整 Evidence chronology；[V1.15-D02](decisions.md#v1-15-d02)记录用户显式展开后完整 Tool 结果、稳定执行台 DOM 与旧预览/复制取舍的局部替代；Windows 平台决定继续继承 v1.05。 |
| Contracts | 已更新 | [Windows Skill Projection v1](../../contracts/windows-skill-projection-v1.md)把 Migration 97 目标推进到 Data Contract v1.15/schema 52；[Run Process Detail Surface v13](../../contracts/run-process-detail-surface-v13.md)继承 AgentRun 直接停止，并定义四轨指令行、九类 SVG、精简队员入口与完整 Tool 结果；[Camp Open Projection v5](../../contracts/camp-open-projection-v5.md)继承 activation-aware enter，并完整投影 non-terminal Evidence。 |
| Architecture | 已更新 | [Skill Projection Reconciliation](../../architecture/skill-projection-reconciliation.md)记录 Migration 97 的 v1.15 目标；[Windows Desktop Platform](../../architecture/windows-desktop-platform.md)继续组合其他平台边界；[Camp Open Read Path](../../architecture/camp-open-read-path.md)记录 activation-aware enter、meaningful Pending 冷启动恢复与完整 non-terminal Evidence。 |
| UI | 已更新 | [Camp 会话工作区](../../ui/components/conversation-workspace.md)保留 AgentRun 直接停止与完整运行 chronology；底部/Inspector 移动同一 Drawer DOM，Tool 行固定对齐，队员入口去除可见状态文案，完整结果在有最大高度的 region 中内部滚动。 |
| Runtime Activity | 确认无需更新 | 平台 backend 与资格状态不改变 Canonical Runtime Activity mapping；出现新 telemetry 时再按维护指南评审。 |
| Runtime compatibility | 确认无需更新 | 当前尚无新的真实 Windows Adapter 资格证据；所有 Windows 行继续保持 `not_qualified`。 |
| Documentation routing | 已更新 | 版本指针、索引和本版 References 路由到 v1.15；Windows 长期任务入口保持指向当前 Contract、Architecture 与历史决定理由。 |
| Root README | 确认无需更新 | Windows 尚未完成真实验收或发布，根 README 不提前声明常青 Windows 支持。 |

## References

- [模型上下文变更 revision 1：排除自身发布的 recent public message](model-context-change-self-authored-recent-messages.md)
- [实施与验收计划](implementation-plan.md)
- [v1.15 决策记录](decisions.md)
- [v1.05 Windows 决策记录](../v1.05/decisions.md#历史-adr-索引)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Windows Skill Projection v1](../../contracts/windows-skill-projection-v1.md)
- [Windows Private Storage v1](../../contracts/windows-private-storage-v1.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
- [Managed Runtime Process v1](../../contracts/managed-runtime-process-v1.md)
- [Built-in Tool Transport v17](../../contracts/builtin-tool-transport-v17.md)
- [Run Process Detail Surface v13](../../contracts/run-process-detail-surface-v13.md)
- [Camp Open Projection v5](../../contracts/camp-open-projection-v5.md)
- [Windows Interaction Delta](../../ui/windows-interaction-delta.md)
- [Windows packaging guide](../../development/packaging-windows.md)
