---
document_type: version-overview
version: v1.24
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: in_progress
model_context_change: false
last_updated: 2026-08-21
---

# Rovai-ai v1.24：Runtime Probe v18 与 Windows x64 本机闭环

> 当前状态：`origin/main@217a46d4` 已交付 Runtime Probe 完整 identity 边界、Superseded 有界自动恢复及
> macOS 非终止安装交接；Windows 分支已合入该最新基线，最终全量门禁与本机安装、Runtime 复跑正在执行。
> Windows 10 上此前的 native/NSIS/legal、安装生命周期、planned shutdown、七 ACP 与九个当前可调用 Runtime
> 矩阵均已通过。Antigravity `1.1.17` 登录有效，但 Flash 账号额度返回 `429 RESOURCE_EXHAUSTED`；Windows 11、
> Authenticode/RFC 3161、SmartScreen 与逐 Runtime immutable evidence 尚未完成，因此不得宣称 Windows 已发布。
>
> 前置版本：[v1.23 按需 Built-in CLI Help 与 Charter 精简](../v1.23/README.md)已按完成事实冻结为
> historical；其 Built-in Transport v20、Session Charter revision 2 与安装事实继续作为本版基线。

## 版本目标

本版沿两条互不削弱的交付轨道推进：一是关闭 v1.22 Runtime 更新容错的剩余入口，使 Adapter 的 version、认证、
能力、协议和模型检查处于同一 executable identity 保护范围，并让连续两次 Superseded 后的执行检查自动恢复；
二是在不回退 v1.23 Transport v20、v1.21 User Automation 与 v1.20 Attachment View 的前提下，把 Windows x64
实现迁到最新 `main`，完成 build、NSIS、隔离安装、planned shutdown 与十 Runtime 的真实本机复核。

## Runtime Probe v18 交付范围

- 删除 managed Runtime resolution 在 Adapter Deep Probe 外重复执行的 `--version` gate；Adapter Deep Probe
  成为版本、认证、能力、协议与模型目录的唯一 manager-owned 结果；
- 保留每轮 Probe 前后 identity 复核、首次 Superseded 后约 300 ms 重绑、最多两轮、同一 attempt ID、
  single-flight 槽与 90 秒绝对 deadline；
- Execution 两轮 Superseded 后按 Runtime 写入三秒进程内冷却；Scheduler 不续期，到期后自动建立新的有界检查，
  Catalog Open 或 User Check 可提前清除；
- manager-level fake Runtime 与临时 SQLite 覆盖 Ready commit、新 fingerprint failure 和冷却到期自动放行；
- Runtime Launch and Verification 升级为 v18；公开 `ready | stable_failure | deferred` wire、LKG/Ready 分离、
  24 小时 TTL、正常 AgentRun 执行链和各 Adapter Probe 子命令保持不变。

## Windows x64 交付范围

- 合入 `origin/main@217a46d4`，保留 Runtime Probe v18、Built-in Transport v20、Attachment View、Runtime Files
  Root、User Automation 与外置 legal payload 门禁；
- 完成 Windows extended-path 到 Runtime-visible Win32 path 的统一投影、Antigravity execution/attachment/run-tmp
  roots、Runtime config 原子写入和 Windows 进程、私有存储边界；
- 生成并验证 native x64 Desktop/Core/CLI、per-user NSIS、PE32+ resources、manifest、hash、CLI/Core contract
  与外置 legal payload，并在隔离数据中验收 clean install/start/same-version upgrade/uninstall/data-preserve；
- 安装并探测 Codex、OpenCode、Copilot、Claude、Antigravity、Kiro、Qoder、CodeBuddy、Qwen 与 TRAE；适用矩阵覆盖
  ACP、Approval、Built-in CLI、Missing-Send、MCP Projection、原生 Skill 和恢复路径；
- DeepSeek 路径固定使用 `deepseek-v4-flash`，不使用 DK V4 Pro；Qoder 使用官方 BYOK 条目
  `deepseek/deepseek-v4-flash-pg`，不保留手写重复 custom model；
- 修正 CodeBuddy API-key ACP、显式 custom model 与 Idle metadata，Kiro 私有 Idle lifecycle 和 Windows Skill
  恢复 lineage，以及 warm Runtime 文件 handle 的即时 POSIX unlink fallback；
- 修正 Git Bash/native `rovai.exe`/`jq.exe` 的 Win32 `--input-file` 边界、Missing-Send PowerShell quoting 与
  Qwen/TRAE `cmd.exe` Tool 投递；真实 packaged Desktop 覆盖正常退出、Job descendant cleanup 和重启恢复。

## 明确不做

- Runtime Probe 不增加逐子命令 SHA、完整 Probe Identity Lease、数据库 CAS、文件锁、更新锁、binary 副本、
  无限重试或 Runtime 专用分支；
- Windows 开发态通过不替代 Windows 11、正式签名、SmartScreen 或 digest-bound 平台资格；
- 不把 Provider 额度、用户凭据或临时诊断内容写入仓库、Context、Evidence 或发布报告。

## 数据与 Context 兼容性

Runtime Probe v18 不修改公开 wire、数据库 Schema、模型上下文、Renderer wire 或正常 AgentRun 执行链。Windows
实现不修改 ContextManifest、Formatter、Run Facts、Camp Attachment View、User Automation 或 Built-in Transport
v20 wire shape；本机 Runtime 配置与 API key 只留在用户目录和用户环境。

## 已有交付结果

- 上游实现提交 `7f67ddde` 的 Runtime Probe v18 回归、macOS arm64 package/legal/signature、隔离 onboarding、
  User Automation status 与受控退出均已通过；新包已非终止方式安装到 `/Applications/Rovai AI.app`；
- Windows 10 Pro 22H2 x64 build `19045.6466` 上，合并前及上一 main 基线的 Rust/TypeScript/Node/文档门禁、
  native/NSIS/legal、installer lifecycle、Release verifier 与 planned shutdown 已通过；
- 七个 ACP Runtime 与九个当前可调用 Runtime 的 Built-in v20、Missing-Send、MCP、Skill 已通过；Antigravity
  静默认证成功，但模型服务仍由账号 Code Assist quota 阻断，备用 Gemini API key 不改变该路由。

## 验收边界

- Windows 10 build `19045.6466` 是当前唯一 client OS 本机证据；
- 开发验收可对单个 Adapter 使用显式 platform override，正式 Release 不可继承；
- `qualified` 仍要求 Windows 10/11、独立 authentication/cancel/process cleanup/planned shutdown 与不可变
  digest-bound evidence；正式 packaged Release 继续拒绝所有缺证据 Windows Runtime；
- unsigned NSIS 与本机 installer lifecycle 只证明安装实现，不能替代 Authenticode、timestamp 或 SmartScreen；
- Groq TPM、Gemini free-tier window、Antigravity quota 与 Gemini thought-signature 差异只按 Provider 事实记录，
  不解释为 Windows 实现失败，也不以单次点测掩盖。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.23 按完成事实冻结；本概览、计划、决定与版本索引建立唯一 current v1.24。 |
| Decisions | 已更新 | [V1.24-D01](decisions.md#v1-24-d01)记录完整 Probe identity 边界与有界自动恢复；Windows 长期取舍继续由 v1.05/v1.15 拥有。 |
| Contracts | 已更新 | [Runtime Launch and Verification v18](../../contracts/runtime-launch-and-verification-v18.md)替代 v17；Windows 不改变 Platform Admission、Managed Process、Private Storage、Planned Shutdown、Attachment View 或 Built-in Transport v20 wire。 |
| Architecture | 已更新 | Runtime Catalog Boundaries、基础不变量和相关路由同步 v18；Windows 继续实施既有 Windows Desktop Platform、Attachment View 与 Planned Shutdown 职责。 |
| UI | 已更新 | 会话工作区文档同步当前执行 Inspector 与任务优先次序；不建立替代视觉世界。 |
| Runtime Activity | 确认无需更新 | Superseded/cooldown 属于 Availability 控制面，Windows 修正不增加 Activity 或 Evidence kind。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)记录 Windows 本机版本、Flash/Adapter 差异和开发态矩阵，同时保持正式 Windows admission 为 `not_qualified`。 |
| Documentation routing | 已更新 | Version、Contract、Architecture、Decision 与任务入口指向 v1.24/v18；Windows packaging guide 保留发布边界。 |
| Root README | 已更新 | 中文 README 的产品叙事已随上游更新；未提前声明常青 Windows 支持。 |

## References

- [实施与验收计划](implementation-plan.md)
- [V1.24-D01](decisions.md#v1-24-d01)
- [Runtime Launch and Verification v18](../../contracts/runtime-launch-and-verification-v18.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [Windows Desktop Platform](../../architecture/windows-desktop-platform.md)
- [Built-in Tool Transport v20](../../contracts/builtin-tool-transport-v20.md)
- [Runtime Platform Admission v1](../../contracts/runtime-platform-admission-v1.md)
- [Windows packaging guide](../../development/packaging-windows.md)
- [Runtime 兼容性清单](../../runtime-compatibility.md)
- [v1.05 Windows 决策记录](../v1.05/decisions.md)
- [v1.15 Windows 实施历史](../v1.15/README.md)
