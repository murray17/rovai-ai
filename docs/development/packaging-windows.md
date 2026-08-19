---
document_type: development-guide
authority: windows-desktop-build-packaging-routing
status: accepted-design
source_version: v1.05
last_updated: 2026-08-20
---

# Windows x64 构建、打包与发布设计

本文路由 Windows x64 的实现与验收边界。当前 `package.json` 尚未提供可运行的 Windows package/accept 命令，
产品代码、NSIS 和签名流水线也尚未完成；在 [v1.05 实施计划](../versions/v1.05/implementation-plan.md)相应
Checkpoint 关闭前，不得照抄预期命令、把 CI artifact 当正式安装包，或宣称 Windows 已发布。

## 目标与前置条件

首版目标为 Windows 10 22H2+/Windows 11 native x64、MSVC、per-user、non-admin 和 local NTFS。构建主机使用
仓库锁定的 Node/pnpm/Rust 工具链与 `x86_64-pc-windows-msvc` target。Windows ARM64/x86、MSIX/Store、企业 MSI、
系统服务、WSL Core 与 network/removable/non-NTFS workspace 不在本版。

实现完成后，`package.json#scripts` 才是命令真源；新增、改名或删除 Windows build/package/accept script 时，
必须在同一改动更新本文件、[开发索引](README.md)和当前版本实施计划。

## Target-isolated staging

每次构建使用目标专属 sidecar staging，至少区分 macOS 与 Windows x64。Windows App 只接收当前构建生成且经过
hash/PE/manifest 检查的 `rovai-core.exe` 与 `rovai.exe`；不得复用未清理的 `resources/bin`、从 PATH 拾取同名文件，
或让两个 target 的输出互相覆盖。

三个 shipped EXE 都嵌入 `longPathAware` 和正确的 x64/version resources。Host long-path policy 是诊断事实；App 与
安装器不修改 HKLM。构建验证必须在启动 Electron 前检查 sidecar 名称、架构、hash 和 manifest。

## Package 与 unsigned CI artifact

目标 package 为 x64 NSIS per-user installer，同时保留 unpacked App 用于隔离 Smoke。安装器默认不提权，不注册系统
服务，不创建 login-start task，不更改 long-path policy。CI 使用固定 `windows-2022`（或仓库锁定的精确 image
revision）完成 compile、test、unpacked/NSIS build 和 unsigned verifier；不使用浮动 `windows-latest` 作为可复现证据。

Unsigned CI artifact 仅供测试。它必须标注 source commit、toolchain、lockfile、三个 PE hash、installer hash、架构、
manifest 与 verifier 版本，不能与正式签名发布混用，也不能用 Windows Server UI 结果替代 Windows 10/11 验收。

## 安装、升级与卸载

- clean install：新用户安装、启动、Core ready、v17 Built-in roundtrip 与现有 Onboarding gate 通过；
- upgrade：先要求正在运行的 App 正常关闭，等待 Planned Shutdown 完成，再替换被锁定的 sidecar；新旧 Core 不并行；
- downgrade：检测 schema incompatibility 后在启动前阻断，显示当前/目标版本和安全下一步；
- uninstall：默认保留 `%LOCALAPPDATA%\Rovai AI` 数据；删除数据是未默认选中的显式选项，并二次确认精确范围；
- failure：安装/升级失败保留可审阅日志和回滚结果，不把半替换状态报告为成功。

所有 Smoke/acceptance 使用独立 data root，不能指向日常 App；私有目录布局和创建时 DACL 由
[Windows Private Storage v2](../contracts/windows-private-storage-v2.md)决定。

## 正式签名与发布验证

正式发布分别 Authenticode-sign Electron EXE、`rovai-core.exe`、`rovai.exe` 和 installer，使用 SHA-256 与 RFC 3161
timestamp。release verifier 对每个 PE 检查 x64、long-path manifest、version/icon resources、当前发布 signer allowlist、
timestamp 与 release-manifest hash。SmartScreen reputation 与签名有效性分别记录，不能用“签名有效”推断 reputation。

可复现性定义为 pinned source/toolchain/lockfile 加完整 manifest/verifier；带 timestamp 的签名 artifact 不承诺 bit-identical。

## Acceptance routing

固定 Windows Server CI 证明编译、打包和自动化；正式发布另在 Windows 10 22H2 与 Windows 11 客户端环境完成 native
frame、DPI、Forced Colors/High Contrast、NVDA、中文 IME、Explorer、安装/升级/卸载和 SmartScreen 验收。逐 Runtime
资格证据仍按 [Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)独立取得，三类 execution-shape
基础设施测试不能批量放行十个 Adapter。

## References

- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [Windows Interaction Delta](../ui/windows-interaction-delta.md)
- [v1.05 实施计划](../versions/v1.05/implementation-plan.md)
- [桌面 UI 验收](ui-acceptance.md)
