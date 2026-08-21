---
document_type: version-overview
version: v1.21
lifecycle: current
authority: version-scope-and-status
design_status: accepted
implementation_status: implemented
model_context_change: false
last_updated: 2026-08-21
---

# Rovai-ai v1.21：User Automation 与 Runtime Diagnostic Trial

> 当前状态：设计、实现、推送、macOS arm64 打包、隔离成品验收与本机安装均已完成。`rovai app` 是随
> Desktop 安装、供普通用户在终端使用的正式本机自动化入口，
> 不是调试后门；Runtime Diagnostic Trial V1 是 CLI-owned 的诊断闭环，不构成 Benchmark 或正式资格。
>
> 前置版本：[v1.20 会话附件系统打开](../v1.20/README.md)已按完成事实冻结为 historical。

## 版本目标

让用户或外部 Agent 在不依赖 Computer Use 的情况下，通过可审计、最小权限的终端 API 创建 Camp、发送任务、
观察一个 AgentRun，并导出安全诊断资料；同时保持 Agent Runtime Built-in CLI 的 process-private 权力与普通
用户自动化完全隔离。

## 交付范围

- 单一 `rovai` binary 新增 `app` namespace；已有 Agent CLI 命令、transport 和调用身份保持不变；
- Electron Main 提供 macOS 当前用户私有 User Automation socket、随机实例 credential、原子 context 和封闭
  operation dispatcher；Desktop 未运行时稳定返回 `app_not_running`，V1 不自动启动；
- 支持 status、Runtime/成员读取、Camp create/send/open、AgentRun show/watch/export/cancel 和 Trial run；
- `camp send` 以一个幂等 Core Domain Command 原子复用正式 Message/Turn/Run seam，不接触用户 Composer，并冻结
  显式预算；`pendingExecution != null` fail closed；
- macOS Core-managed Runtime/Probe 进程树由统一 OS sandbox deny `automation-v1` credential tree；Runtime 内 CLI
  同时隐藏并拒绝 `app` namespace 作为纵深防御；
- Core 增加 allowlist `AgentRunDiagnosticView`，只公开冻结配置 digest、ContextManifest metadata、Git/Evidence
  摘要以及正式 CampMessage 公共输出；
- Trial 在首次 Core mutation 前持久化 journal，恰好创建一个 root AgentRun，以 domain/evidence 双 cursor 等待，
  并生成私有、可恢复、明确 `formalQualification: false` 的诊断 bundle；
- `camp open` 由 Main 先向 Core 验证 Camp，再复用现有 Renderer activation，不暴露任意 route/path。

## 数据与 Context 兼容性

本版不增加数据库 Migration，不修改 Agent Runtime Context、Native Session Bootstrap、Built-in Tool catalog、
Agent result projection 或模型输入字节。新增 Core method 是 Desktop 用户自动化专用原子 mutation/read seam；
Managed Process 只增加 macOS credential tree deny，不改变 Runtime 输入。Trial journal 与 bundle 位于应用数据库之外，
不成为 Core authority。

## 实施结果

- Electron Main 已实现独立 User Automation Server、instance/credential 校验、4 MiB frame 上限、私有权限、
  shutdown cleanup、封闭 Core dispatch 与稳定无路径错误；Server 启动失败只降级 Automation，不退出 Desktop；
- `rovai app` 已实现普通用户命令、JSON stdout/exit contract、App-not-running 行为、预算解析、Trial journal、
  单 Run admission、双 cursor watch、partial recovery 与安全 export；领域拒绝/Run failed/cancelled 返回 `1`，
  settlement indeterminate 返回 `3`；
- Automation Camp send 已收敛为一个事务/幂等 receipt，重放不重复消息或 Run，且现有 Composer draft 原样保留；
- Managed Process 已在 macOS 对所有受管 Runtime purpose 施加 `automation-v1` read/write deny，缺少 sandbox 时
  Runtime launch fail closed；
- Core 已实现事务一致的 AgentRun diagnostic projection，并通过 allowlist 排除 raw effective config、Runtime
  payload/final output、secret、environment、context/bootstrap bytes 与 Authority path；
- Renderer 只增加 Main-owned Camp open navigation hook，复用既有 Camp activation，没有视觉系统或新 surface；
- TypeScript、71 个前端测试文件/484 项 Vitest、189 项协议测试、20 项 CLI、272 项 slow suite、严格 Clippy、
  Desktop production build 与文档门禁已通过；Rust PR suite 的功能无关唯一失败是 v1.20 已记录的 Runtime
  compatibility register 摘要 digest 基线失配；Core binary 套件另有 5 项既存 ACP fixture/run-tmp 前置条件
  失败，本次未修改这些模块；
- 提交 `55dc5aa0` 的 macOS arm64 App 已通过深度验签，Main/Core/CLI 均为 arm64；包内 Core/CLI UUID 分别为
  `FB4F6BBE-6FA1-3B8F-928C-9E4603F0BE19` 与 `C56BCB47-97DA-3FFF-962B-661E604781A6`，SHA-256 分别为
  `ed60da48de5c5545587703af206269abc3e6e73b684ab4f7c0078e7315703b08` 与
  `c2260fb4b54aa93593f04f890b11badb809a3cab7cbd7ab65d0a421d16adbe2b`；
- 全新隔离 `userData` 已验证 Automation status、instance credential、`0700/0600/0600` 权限、Runtime CLI
  guard 与受控关闭清理；同一成品已非终止安装到 `/Applications/Rovai AI.app`，替换前成品保留在
  `/Applications/Rovai AI.backup-before-55dc5aa0.app`，原日常 App/Core 进程未被终止，用户级 PATH 继续使用
  `~/.local/bin/rovai`。

## 当前版本维护修复（2026-08-21）

- Diagnostics 的 Git 检查改为复用 `RuntimeSearchEnvironment`，解析首个可执行文件的绝对路径后再进入
  Managed Process，消除“系统 Git 可用但界面报告 PATH 不可用”的误报；
- 用户显式 `skills.reconcile` 可清理 Observation 已证明、目标不存在且严格指向旧
  `$HOME/.lumen/skills/revisions/<UUID>/<UUID>` 的 symlink，再按当前 Library 状态投影；自动 preflight、
  terminal reconcile、普通文件/目录、其他外部链接和未登记入口仍保持不动；
- Diagnostics 对这类问题显示“Skill 投影包含旧的断开链接”和“清理旧链接并重新同步”，不再把原因模糊描述为
  与当前 Revision 不一致。
- macOS Desktop 派生 Runtime Files Root 时与子 Core 共享同一非空 `HOME`，修复隔离验收或其他显式 Home
  启动中 Main/Core root admission 不一致导致的 Core 启动失败。

## 明确不做

- 不提供 generic Core invoke、远程自动化、独立 daemon、自动启动 Desktop 或共享 credential；
- 不修改成员 Runtime，不删除 Camp，不公开 raw input/config/context/environment/Runtime output；
- 不支持 pending execution，不提供 AgentRun list 或通用 Evidence browser；
- 不新增 Core Trial/Benchmark/Qualification entity，不发布 score、pass rate 或 Runtime 资格；
- 不声明 Windows User Automation 已准入。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v1.20 按完成事实冻结；本概览、实施计划与索引建立唯一 current v1.21。 |
| Decisions | 已更新 | [V1.21-D01](decisions.md#v1-21-d01)至[V1.21-D04](decisions.md#v1-21-d04)记录双 transport、诊断/评测、Runtime OS 隔离与原子发送边界。 |
| Contracts | 已更新 | [User Automation v1](../../contracts/user-automation-v1.md)冻结 IPC、命令、错误、诊断 view、Trial 与 bundle。 |
| Architecture | 已更新 | [User Automation Architecture](../../architecture/user-automation.md)和基础不变量定义进程、权威与安全边界。 |
| UI | 已更新 | [UI 路由](../../ui/README.md)明确 automation Camp open 复用既有 activation，未增加视觉 surface。 |
| Runtime Activity | 确认无需更新 | 不增加 Runtime source grammar、Canonical Activity kind 或映射规则；只读取现有 Evidence。 |
| Runtime compatibility | 确认无需更新 | 不改变 Runtime catalog、实测版本、能力或宿主平台资格结论。 |
| Documentation routing | 已更新 | 文档导航、Architecture/Contract 索引和当前决定导航增加 User Automation 入口。 |
| Root README | 已更新 | 增加普通用户终端入口、App 运行前提与 macOS 安装包内 CLI 使用说明。 |

## References

- [v1.21 实施与验收计划](implementation-plan.md)
- [v1.21 决策记录](decisions.md)
- [User Automation v1](../../contracts/user-automation-v1.md)
- [User Automation Architecture](../../architecture/user-automation.md)
