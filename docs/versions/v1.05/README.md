---
document_type: version-overview
version: v1.05
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-18
---

# Rovai-ai v1.05：Windows x64 平台闭环与逐 Runtime 准入

> 当前状态：Windows 技术设计、五项跨版本 ADR、五项字段/状态机 Contract 和 Windows Interaction Delta
> 已进入文档闭环；产品代码、Windows 打包和真实 Runtime 资格证据尚未实施。本版本不得从 accepted 文档推断
> Windows 已发布。
>
> 前置版本：[v1.04 TRAE Cold Resume](../v1.04/README.md)
>
> 后续版本：[v1.06 Camp History Target 与 Public A2A 可见性](../v1.06/README.md)

## 版本目标

在不回退 macOS 能力、安全边界和 Runtime 终态权威的前提下，建立 Windows 10 22H2+/Windows 11 native x64
Desktop 的可实施平台结构：可构建、可安装、私有 IPC、原子受管进程、local-first 私有存储、可恢复 Skill
Projection、平台诚实的 Runtime 准入，以及遵循 Windows 原生交互的同一 Rovai AI 产品界面。

## 交付范围

- 平台模块集中承载 Local IPC、managed process、Runtime search、file identity、private storage 和文件安全；
- Built-in Tool Transport v14 clean break：Unix Socket/Windows Named Pipe、IPC v2、创建时 DACL 与完整 macOS 回归；
- Windows `CreateProcessW + STARTUPINFOEXW + JOB_LIST + HANDLE_LIST` 原子受管启动，禁止 spawn 后 attach；
- `Product Runtime Catalog → Runtime Platform Admission → Product Runtime Availability → Settings Preview` 四层权威；
- Windows Runtime resolver 只执行 native EXE 或 Adapter-owned `ValidatedNodeShim`，不提供通用 cmd/bat launcher；
- `%LOCALAPPDATA%\Rovai AI` 独立 Core/User Data/Session Data/Logs/CrashDumps，local NTFS admission 与创建时
  protected DACL；
- 三个自有 EXE 的 long-path manifest、host policy 诊断与诚实 tested-envelope blocker；
- Windows Skill copy backend 的多阶段 journal、fs/DB crash-window 幂等恢复和 Execution Root Projection Gate；
- Electron native Windows frame、平台 copy/shortcut、Runtime admission states、Explorer/路径、Forced Colors/NVDA/IME
  与 Installer/Upgrade 的 Windows Interaction Delta；
- target-aware sidecar staging、x64 NSIS、unsigned CI artifact、逐 PE verifier、Authenticode 和真实 Windows 10/11
  acceptance。

## 第一版主机边界

支持目标为 Windows 10 22H2 或更新版本、Windows 11、x64、MSVC、per-user、非管理员和 local NTFS。
Windows x86/ARM64、WSL Core、Linux、MSIX/Store、企业 MSI、系统服务、UNC/network/removable/non-NTFS workspace、
自动更新与自定义无边框 Windows 标题栏不在本版。

主机通过不等于 Runtime 通过。当前十个 Adapter 的 `windows-x64` 证据基线均为 `not_qualified`；只有逐 Adapter
完整验收并写入 digest-bound evidence revision 后，才可在 Windows 上选择、检查或执行。

## 明确不做

- 不通过禁用 Built-in Tool、Attachment、Skill Projection 或私有权限获得 Windows green build；
- 不用 localhost TCP、`taskkill`、PowerShell、通用 `cmd.exe /s /c`、PID 猜测或先创建后补 ACL；
- 不把三类 execution-shape 测试冒充十个 Adapter 的产品准入；
- 不让 TypeScript 维护第二份 Runtime platform allowlist；
- 不在安装器中修改 HKLM long-path policy，不声称支持任意 32K 路径；
- 不把 Windows 差异扩张为第二套组件树、主题或产品信息架构；
- 不在应用运行时直接覆盖 sidecar，不允许新旧 Core 并行，不允许 schema-incompatible downgrade。

## 验收边界

- Windows Rust 全 targets、Desktop、unpacked App、NSIS、Core ready 与 v14 Built-in roundtrip 通过；
- immediate-grandchild race、normal/Core kill/Main kill、nested Job 和 handle leak 均有可复现证据；
- private object 从创建时即满足 DACL，Attachment reparse escape 与非准入存储 fail closed；
- Skill journal 每个 filesystem/journal/DB transition 的 crash injection 可恢复或明确阻断；
- macOS 全 Runtime Transport v14、Unix process-group、打包和现有 UI 回归通过；
- Windows 上每个可选择 Runtime 独立完成资格矩阵，未完成者保持不可选；
- Windows 10 22H2 与 Windows 11 的 native frame、DPI、High Contrast/Forced Colors、NVDA、IME、Explorer、
  install/upgrade/uninstall 通过真实 acceptance；固定 Server CI 不替代这些证据；
- 正式发布分别验证 Electron EXE、`rovai-core.exe`、`rovai.exe` 和 installer 的签名、时间戳、架构、manifest 与
  release manifest，SmartScreen reputation 单独记录。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.04 冻结为 historical；本概览、实施计划和版本索引建立唯一 current v1.05。 |
| ADR | 已更新 | ADR-0210～0214 分别冻结平台准入、原子进程启动、Transport v14、私有存储与 Windows Skill Projection。 |
| Contracts | 已更新 | 新增 Runtime Platform Admission v1、Managed Runtime Process v1、Built-in Tool Transport v14、Windows Private Storage v1 与 Windows Skill Projection v1；Diagnostics/Memory 消费方切到平台准入与 v14。 |
| Architecture | 已更新 | 新增 Windows Desktop Platform，并更新 Runtime Catalog、Built-in Tool Runtime、Skill Projection、Planned Shutdown、Diagnostics 与 Online Memory 组合。 |
| UI | 已更新 | Windows Interaction Delta、App Shell、设置/队员 brief、主题与无障碍矩阵定义同一产品的 Windows 差异和 HTML 原型。 |
| Runtime Activity | 确认无需更新 | v14 与平台层不改变 canonical Runtime Activity mapping；真实 Adapter 准入如暴露新 telemetry 再按维护指南评审。 |
| Runtime compatibility | 已更新 | 兼容性清单记录十个 Adapter 的 Windows `not_qualified` 证据基线与逐项提升条件。 |
| Documentation routing | 已更新 | 顶层导航、ADR CURRENT/HISTORY、Architecture、Contracts、UI、Development 与 Version 索引路由到 Windows 当前权威。 |
| Root README | 确认无需更新 | Windows 尚未实现或发布；根 README 不提前宣称常青支持，完成发布后再更新。 |

## References

- [实施与验收计划](implementation-plan.md)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Windows Interaction Delta](../../ui/windows-interaction-delta.md)
- [Windows Interaction Delta HTML](../../prototypes/windows-interaction-delta/index.html)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
- [Built-in Tool Transport v14](../../contracts/builtin-tool-transport-v14.md)
