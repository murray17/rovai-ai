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
- `camp send` 复用 Composer 与正式 message send，冻结显式预算；`pendingExecution != null` fail closed；
- Core 增加 allowlist `AgentRunDiagnosticView`，只公开冻结配置 digest、ContextManifest metadata、Git/Evidence
  摘要以及正式 CampMessage 公共输出；
- Trial 在首次 Core mutation 前持久化 journal，恰好创建一个 root AgentRun，以 domain/evidence 双 cursor 等待，
  并生成私有、可恢复、明确 `formalQualification: false` 的诊断 bundle；
- `camp open` 由 Main 先向 Core 验证 Camp，再复用现有 Renderer activation，不暴露任意 route/path。

## 数据与 Context 兼容性

本版不增加数据库 Migration，不修改 Agent Runtime Context、Native Session Bootstrap、Built-in Tool catalog、
Agent result projection 或模型输入字节。新增 Core method 是 Desktop 用户自动化专用安全 Read Model；Trial journal
与 bundle 位于应用数据库之外，不成为 Core authority。

## 实施结果

- Electron Main 已实现独立 User Automation Server、instance/credential 校验、4 MiB frame 上限、私有权限、
  shutdown cleanup、封闭 Core dispatch 与稳定无路径错误；
- `rovai app` 已实现普通用户命令、JSON stdout/exit contract、App-not-running 行为、预算解析、Trial journal、
  单 Run admission、双 cursor watch、partial recovery 与安全 export；
- Core 已实现事务一致的 AgentRun diagnostic projection，并通过 allowlist 排除 raw effective config、Runtime
  payload/final output、secret、environment、context/bootstrap bytes 与 Authority path；
- Renderer 只增加 Main-owned Camp open navigation hook，复用既有 Camp activation，没有视觉系统或新 surface；
- TypeScript、71 个前端测试文件/483 项 Vitest、189 项协议测试、18 项 CLI、269 项 slow suite、严格 Clippy、
  Desktop production build 与文档门禁已通过；Rust PR suite 的功能无关唯一失败是 v1.20 已记录的 Runtime
  compatibility register 摘要 digest 基线失配；
- 提交 `d87eeee4` 的 macOS arm64 App 已通过深度验签，Main/Core/CLI 均为 arm64，包内 Core/CLI UUID 分别为
  `759104C5-4CAA-301C-A8D3-2B8D6F12EEAA` 与 `9504A773-419B-38EB-A0C8-C32881F04ECB`；
- 全新隔离 `userData` 已验证 Automation status、instance credential、`0700/0600/0600` 权限与受控关闭清理；
  同一成品已非终止安装到 `/Applications/Rovai AI.app`，旧包保留为可恢复备份，用户级 PATH 已提供
  `~/.local/bin/rovai`。

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
| Decisions | 已更新 | [V1.21-D01](decisions.md#v1-21-d01)与[V1.21-D02](decisions.md#v1-21-d02)记录双 transport seam 和诊断/评测边界。 |
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
