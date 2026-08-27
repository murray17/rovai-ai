---
document_type: development-guide
authority: windows-desktop-build-packaging-routing
status: implemented-pending-release-qualification
source_version: v1.15
last_updated: 2026-08-26
---

# Windows x64 构建、打包与发布

本文路由 Windows x64 的实现、命令与验收边界。v1.15 已实现 native x64 Core/CLI/Desktop、per-user NSIS、
PE resource/manifest verifier 和隔离安装验收。Windows 10 x64 上 Claude Code 已完成独立 Runtime 资格；其余
Runtime、Windows 11 client OS、正式 Authenticode/RFC 3161 签名和 SmartScreen reputation 证据仍未完成。
当前对外口径只能是 `Windows x64 Preview — unsigned`，不得宣称 Windows 全面支持或所有 Runtime 已支持。

## 目标与前置条件

首版目标为 Windows 10 22H2+/Windows 11 native x64、MSVC、per-user、non-admin 和 local NTFS。构建主机使用
仓库锁定的 Node/pnpm/Rust 工具链与 `x86_64-pc-windows-msvc` target。Windows ARM64/x86、MSIX/Store、企业 MSI、
系统服务、WSL Core 与 network/removable/non-NTFS workspace 不在本版。

`package.json#scripts` 是命令真源；新增、改名或删除 Windows build/package/accept script 时，
必须在同一改动更新本文件、[开发索引](README.md)和当前版本实施计划。

## 本机构建与验收命令

以下命令必须在 native Windows x64 主机运行；它们使用目标隔离的 sidecar staging，且 acceptance 在发现已有
Rovai 安装时 fail closed：

```powershell
pnpm build:windows:x64
pnpm package:windows:x64
pnpm dist:windows:x64
pnpm verify:windows
pnpm accept:planned-shutdown
pnpm accept:windows:installer
```

`package:windows:x64` 生成 unpacked App 并执行 verifier；`dist:windows:x64` 生成 unsigned NSIS installer。外层产品名和安装目录为
`Rovai AI`，内部兼容可执行文件继续是 `Rovai-ai.exe`，发布 artifact 使用 URL 安全的
`Rovai-AI-<version>-x64.exe`。两条命令都验证
App/Core/CLI 的 PE32+ 架构、icon/version/manifest、hash、CLI contract 与隔离 Core health。`accept:windows:installer`
执行 per-user clean install、已安装 App Onboarding、同版本 upgrade、默认卸载和数据保留，并把报告与截图写入
`dist/windows-installation-acceptance/`。`accept:planned-shutdown` 默认使用 `dist/win-unpacked/Rovai-ai.exe`，
在隔离 `userData` 中验证真实 Runtime 运行期间的受控退出、子进程回收和重启恢复。正式签名构建使用
`dist:windows:release:x64`，且必须提供签名材料和
`ROVAI_WINDOWS_SIGNER_SHA256` allowlist；缺少任一发布条件时 verifier 必须失败。

NSIS Release 还必须同版本上传 installer、`.exe.blockmap` 与 `latest.yml`。verifier 会检查 packaged
`app-update.yml` 指向官方 GitHub 通道，并核对 `latest.yml` 中 installer 的版本、sha512 和大小。它还从
[`build/release-notes.md`](../../build/release-notes.md) 读取与 `package.json.version` 绑定的共用 Markdown，
要求 `latest.yml.releaseNotes` 存在且与源文件完全相同；缺少、为空、版本标题陈旧、内容漂移或缺少任一
更新文件时不得发布应用内升级。初始安装仍使用 assisted installer，应用内“安装并重启”使用 silent
upgrade，不再次展示安装向导。verifier 还冻结运行中升级协调器：先向安装目录内旧 Electron 主窗口发送
标准关闭请求，完整等待 20 秒 Planned Shutdown，再进入最多 5 秒的精确安装树强制回收；不得恢复
electron-builder 默认的 1 秒等待或仅按相同路径前缀批量结束进程。

正式打包 App 主动检查该发布集合，但不自动下载；用户显式“下载更新”后才进入一轮互斥下载，并在
`ready_to_install` 再确认“安装并重启”。Updater 必须先同步 stage/启动 silent installer，Main 随后在其
`before-quit` 中完成同一 Planned Shutdown；同步 stage 失败时 App/Core 保持运行并允许重试。检查来源、
提示代次、状态与 fallback 由 [App Update v1](../contracts/app-update-v1.md)统一约束。

## Target-isolated staging

每次构建使用目标专属 sidecar staging，至少区分 macOS 与 Windows x64。Windows App 只接收当前构建生成且经过
hash/PE/manifest 检查的 `rovai-core.exe` 与 `rovai.exe`；不得复用未清理的 `resources/bin`、从 PATH 拾取同名文件，
或让两个 target 的输出互相覆盖。

三个 shipped EXE 都嵌入 `longPathAware` 和正确的 x64/version resources。Host long-path policy 是诊断事实；App 与
安装器不修改 HKLM。构建验证必须在启动 Electron 前检查 sidecar 名称、架构、hash 和 manifest。

## Package 与 unsigned CI artifact

目标 package 为 x64 NSIS per-user assisted installer，同时保留 unpacked App 用于隔离 Smoke。安装向导允许用户选择
安装目录；默认目录仍位于当前用户范围，且因为安装器不提权，自定义目录必须是当前用户可写路径。安装器不注册系统
服务，不创建 login-start task，不更改 long-path policy。verifier 必须同时锁定 assisted、per-user、不可提权与可选择
安装目录四项配置。CI 使用固定 `windows-2022`（或仓库锁定的精确 image
revision）完成 compile、test、unpacked/NSIS build 和 unsigned verifier；不使用浮动 `windows-latest` 作为可复现证据。

Unsigned CI artifact 必须标注 source commit、toolchain、lockfile、三个 PE hash、installer hash、架构、manifest 与
verifier 版本，不能与正式签名发布混用，也不能用 Windows Server UI 结果替代 Windows 10/11 验收。只有在真实
客户端完成相应验收后，才允许以 `Windows x64 Preview — unsigned` 发布；公开说明必须包含 SmartScreen 可能显示
未知发布者，并要求用户只从官方 GitHub Release 下载。

## 安装、升级与卸载

- clean install：新用户安装、启动、Core ready、v20 Built-in roundtrip 与现有 Onboarding gate 通过；
- upgrade：安装器先请求正在运行的 App 正常关闭，并给 Planned Shutdown 20 秒完整预算；交互安装超时后由
  用户选择再等待、仅强制关闭已证明属于精确安装目录的进程树，或取消。silent upgrade 只在该预算耗尽后
  进入有界强制回收；若 PowerShell 被策略禁用、无法证明进程路径，安装器只允许手动关闭或安全停止，
  不按映像名强杀；新旧 Core 不并行；
- downgrade：检测 schema incompatibility 后在启动前阻断，显示当前/目标版本和安全下一步；
- uninstall：默认保留 `%LOCALAPPDATA%\Rovai AI` 数据；删除数据是未默认选中的显式选项，并二次确认精确范围；
- failure：安装/升级失败保留可审阅日志和回滚结果，不把半替换状态报告为成功；“进程未退出”和“旧版
  卸载程序失败”必须分别记录，不能把后者误报成 App 留在后台。

`accept:windows:installer` 默认验证“当前 installer clean install → 运行已安装 App → 同版本 silent upgrade”，
并要求升级由自然 Planned Shutdown 完成、原 App/Core/Helper 进程树全部退出。需要验证已发布旧版本时，传入
精确 baseline installer；脚本仍先确认机器上没有既有 Rovai 安装：

```powershell
$env:ROVAI_WINDOWS_UPGRADE_BASE_INSTALLER = 'C:\acceptance\Rovai-AI-0.0.1-x64.exe'
pnpm accept:windows:installer
```

如果开发机已经安装日常版、不能安全运行完整安装验收，可以先对隔离的
`dist/win-unpacked` 运行安装器关闭协调验收；它不写安装注册表，也不会匹配其他安装目录：

```powershell
pnpm accept:windows:installer-shutdown
```

该验收必须看到 App、Core 与 Electron 子进程全部退出，并从 Desktop 日志读到
`forcedSignal: null` 与 `report.status: completed`。它不能替代带旧版安装器的完整升级验收，
但可以在日常开发机上证明安装器使用的 `WM_CLOSE` 路径确实进入 Planned Shutdown。

报告中的 `crossVersionUpgrade`、`baselineVersion` 和 `runningAppUpgrade` 是跨版本结论的必要证据；
未传 baseline 时不得把同版本结果表述为 0.0.1→0.0.3 已实测。

所有 Smoke/acceptance 使用独立 data root，不能指向日常 App；私有目录布局和创建时 DACL 由
[Windows Private Storage v2](../contracts/windows-private-storage-v2.md)决定。

## 正式签名与发布验证

正式发布分别 Authenticode-sign Electron EXE、`rovai-core.exe`、`rovai.exe` 和 installer，使用 SHA-256 与 RFC 3161
timestamp。release verifier 对每个 PE 检查 x64、long-path manifest、version/icon resources、当前发布 signer allowlist、
timestamp 与 release-manifest hash。SmartScreen reputation 与签名有效性分别记录，不能用“签名有效”推断 reputation。

可复现性定义为 pinned source/toolchain/lockfile 加完整 manifest/verifier；带 timestamp 的签名 artifact 不承诺 bit-identical。

## Acceptance routing

固定 Windows Server CI 证明编译、打包和自动化；`.github/workflows/windows-package.yml` 使用 `windows-2022`、
Node 26、pnpm 11.20.0、Rust 1.97.1 与 frozen lockfile 生成并上传 unsigned 证据。正式发布另在 Windows 10 22H2 与 Windows 11 客户端环境完成 native
frame、DPI、Forced Colors/High Contrast、NVDA、中文 IME、Explorer、安装/升级/卸载和 SmartScreen 验收。逐 Runtime
资格证据仍按 [Runtime Platform Admission v1](../contracts/runtime-platform-admission-v1.md)独立取得，三类 execution-shape
基础设施测试不能自行批量放行十二个 Adapter。当前 Windows 10 x64 设置页范围内十一种 Runtime 由同一份
adapter-scoped digest-bound evidence revision 逐行准入；设置页范围外的 Cursor Agent 继续 `not_qualified`。

## References

- [Windows Desktop Platform](../architecture/windows-desktop-platform.md)
- [Windows Interaction Delta](../ui/windows-interaction-delta.md)
- [v1.15 实施计划](../versions/v1.15/implementation-plan.md)
- [桌面 UI 验收](ui-acceptance.md)
