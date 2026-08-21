---
document_type: version-overview
version: v1.23
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: implemented
model_context_change: false
last_updated: 2026-08-21
---

# Rovai-ai v1.23：Windows x64 本机实现与 Runtime 复核闭环

> 当前状态：v1.05 与 v1.15 冻结的 Windows 边界已经迁入包含 v1.22 的最新 `main`，Windows 10 22H2 x64
> 本机代码、打包、安装生命周期、计划关闭和十 Runtime 开发态矩阵已在最新 `main` 上完成最终全量复跑。
> 正式 packaged Release 继续阻断所有缺少 immutable evidence 的 Windows Runtime，Windows 11、
> Authenticode/RFC 3161 与 SmartScreen 尚未完成，因此不得宣称 Windows 已发布。
>
> 前置版本：[v1.22 Runtime Probe 更新容错](../v1.22/README.md)已按完成事实冻结为 historical。

## 版本目标

在不回退 v1.22 Runtime Probe supersession、v1.21 User Automation、v1.20 Camp Published Attachment View、
Built-in Transport v19 与当前 Runtime/Context 合同的前提下，把 Windows x64 实现迁到最新 `main`，完成 native
build、NSIS、隔离安装、planned shutdown 和十个 Runtime 的真实本机验收；开发态本机成功与发布平台资格必须
保持不同证据层级。

## 交付范围

- 合入 `origin/main` 到 v1.22 的实现，保留 Probe supersession、Attachment View、Runtime Files Root、User
  Automation 与最新 Built-in CLI 行为；
- 完成 Windows extended-path 到 Runtime-visible Win32 path 的统一投影、Antigravity execution/attachment/run-tmp
  roots、Runtime config 原子写入和 Windows 进程/私有存储细节；
- 生成并验证 native x64 Desktop/Core/CLI、per-user NSIS、PE32+ resources、manifest、hash 和 CLI/Core contract；
- 在隔离用户数据中完成 clean install/start/same-version upgrade/uninstall/data-preserve；
- 安装并探测十个 Product Runtime，完成 ACP、Approval、Built-in CLI、Missing-Send、MCP Projection 与原生 Skill
  的适用矩阵；DeepSeek 路径固定使用 `deepseek-v4-flash`，不使用 DK V4 Pro；
- 修正 CodeBuddy `2.137.1` 官方 API-key ACP 启动、显式 custom model 与 `_codebuddy.ai/command` Idle metadata；
- 修正 Kiro `2.19.0` 的精确私有 Idle lifecycle notification 与 Windows Skill 共享投影转直接副本的恢复 lineage；
- 修正 warm Runtime 持有 Skill 文件 handle 时 Windows legacy delete-on-close 未立即解除目录项的问题，使用精确
  opened handle 的 POSIX disposition，并保留不支持平台的兼容 fallback；
- 修正 Git Bash 与 native `rovai.exe`/`jq.exe` 在 `MSYS2_ARG_CONV_EXCL=*` 下的 `--input-file` Win32 path
  边界，以及 Missing-Send 中 Bash/PowerShell `$env:` quoting 和 Qwen/TRAE 直接 `cmd.exe` Tool 投递；
- 在真实 packaged Desktop 中完成 Windows 正常退出、Job descendant cleanup、durable shutdown fence 与重启恢复。

## 数据与 Context 兼容性

本版不增加数据库 Migration，不修改 Runtime Launch and Verification v17、ContextManifest、Formatter、Run Facts、
Camp Attachment View、User Automation 或 Built-in Transport wire shape。Windows backend 和验收脚本使用当前 v1.22
已发布的数据/上下文合同；Runtime 本机配置与 API key 留在用户目录/用户环境，不进入仓库、Context、Evidence
或诊断输出。

## 验收边界

- Windows 10 Pro 22H2 x64 build `19045.6466` 是本版唯一 client OS 本机证据；
- 开发验收可对正在测试的单个 Adapter 使用显式 platform override，正式 Release 不可继承；
- `qualified` 仍要求 Windows 10/11、独立 authentication/cancel/process cleanup/planned shutdown 和不可变
  digest-bound evidence；本版不伪造 evidence revision；
- unsigned NSIS 和本机 installer lifecycle 只证明安装实现，不能替代 Authenticode、timestamp 或 SmartScreen；
- 用户 API key 不回显、不写仓库；临时失败 Fixture 在完成取证后删除。
- 完整 Flash 矩阵后的用户 Provider 切换只按实际证据记录：Groq TPM、Gemini free-tier request window、Qoder/TRAE
  账号 quota 与 Gemini thought-signature 差异均不被解释为 Windows 实现失败，也不被点测成功掩盖；用户随后
  授权恢复的日常 DeepSeek 路径仍只使用 `deepseek-v4-flash`。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.22 冻结为 historical；本概览、实施计划与版本索引建立唯一 current v1.23。 |
| Decisions | 确认无需更新 | Windows 长期取舍继续由 v1.05/v1.15 决定和当前 Architecture/Contracts 拥有；本版不改变 v1.22 Probe supersession 决定。 |
| Contracts | 确认无需更新 | 不改变 Runtime Launch v17、Runtime Platform Admission、Managed Process、Private Storage、Planned Shutdown、Attachment View 或 Built-in Transport 字段/wire/error 语义。 |
| Architecture | 确认无需更新 | 继续实施 Windows Desktop Platform、Runtime Fleet、Attachment View、Probe supersession 和 Planned Shutdown 的现有组件职责，没有新增权威或 transport。 |
| UI | 确认无需更新 | Windows Renderer 修正沿用同一组件树、设计 token 和 Windows Interaction Delta，没有新增 surface 或产品视觉世界。 |
| Runtime Activity | 确认无需更新 | 不增加 Runtime source grammar、Canonical Activity kind 或映射规则。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录本机版本、Flash 边界、CodeBuddy ACP 差异、Windows handle 边界与开发态矩阵，同时保持正式 Windows admission 为 `not_qualified`。 |
| Documentation routing | 已更新 | 版本索引路由到 v1.23；[Windows packaging guide](../../development/packaging-windows.md)继续记录已实现命令与发布边界。 |
| Root README | 确认无需更新 | Windows 11、正式签名和逐 Runtime immutable qualification 未完成，根 README 不提前声明常青 Windows 支持。 |

## References

- [v1.23 实施与验收计划](implementation-plan.md)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Runtime Launch and Verification v17](../../contracts/runtime-launch-and-verification-v17.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
- [Windows packaging guide](../../development/packaging-windows.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
- [v1.05 Windows 决策记录](../v1.05/decisions.md)
- [v1.15 Windows 实施历史](../v1.15/README.md)
