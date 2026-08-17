---
document_type: adr
id: ADR-0204
title: On-Demand Runtime Deep Verification with Manager-Owned Attempts
status: accepted
date: 2026-08-17
decision_scope: cross-version
source_version: v0.98
supersedes: []
intended_supersedes: []
superseded_by: null
---

# ADR-0204: On-Demand Runtime Deep Verification with Manager-Owned Attempts

## Context

Product Runtime discovery曾在启动和重扫结束后隐式排队主动 Probe。Probe 会启动第三方 CLI、建立协议
Session、读取认证与模型目录；任一子进程、reader 或 worker 未正常返回时，分散在 worker 内的
`checking`/`scheduled` 清理还会留下永久“正在检查”。文件已安装、可以尝试运行与已经验证登录和协议能力
是不同证据，但旧公共状态把前两者投影为持续 checking。

## Decision

1. 启动和 `runtime.discovery.rescan` 只执行 executable path、权限、metadata/fingerprint 与 Adapter 声明为
   无副作用的有界 one-shot 身份命令。只有该命令成功、输出未超限且能够识别基础版本或身份，非 TRAE
   Runtime 才生成 `light_ready` 静态证据；单纯找到 executable 是 `found_uninspected`，不能冒充 checking 或
   light-ready。`light_ready` 允许 Runtime-default 成员配置和尝试真实运行，但不声明认证、协议、模型、
   Session 或 capability Ready。TRAE 继续使用 ADR-0192 的 `installed_unverified` execution-deferred 特例，
   且静态阶段不执行 `traecli --version`。
2. discovery、rescan、应用启动、页面加载、成员选择、缓存失效和定时过期都不得自动触发深检。深检只由
   用户显式“检查可用性”或首次真实 AgentRun admission 发起；Adapter launch policy 可以进一步收窄允许目的。
3. UI 可以把 `light_ready` 表示为“可用”，其含义严格限定为当前 executable 已通过有界轻度启动与身份验证，
   是可选择、可尝试执行的候选。
   明确深检或真实启动失败后表示“需要处理”；fingerprint、待复验与 attempt identity 只属于内部诊断。
4. Runtime Check Manager 是 attempt lifecycle 的唯一所有者。每个 attempt 具有内部 `attempt_id`、Runtime、
   总 deadline 和 task identity；success、error、timeout、panic/JoinError、abort、cancel 与 shutdown 都通过同一
   finalize 路径移除 activity、唤醒 waiters并至多发布一个 terminal availability event。产品失败写产品诊断，
   supervisor deadline/panic 写 transient/internal 诊断；superseded、cancel 与 shutdown 只清理，不伪造产品失败
   或退避。
5. 同一 Runtime 同时最多一个 attempt；全局深检并发上限为二。真实执行优先于用户检查，用户检查优先于任何
   后台工作。本决定不启用后台深检或 24 小时自动刷新。
6. 深检提交必须同时匹配当前 search generation 与 executable fingerprint。身份改变只使旧深检证据失效并
   写入新的静态快照，不自动启动 Probe；旧 attempt 不得覆盖新身份。
7. 所有短生命周期 Runtime 子进程使用统一的受限 Probe process owner：独立进程树、绝对总 deadline、有限
   stdout/stderr 与单行容量、truncation 记录、bounded child/reader cleanup。当前交付平台使用 Unix process
   group 整树终止；未来支持 Windows 前必须提供等价 Job Object `KILL_ON_JOB_CLOSE`。

本决定局部覆盖 ADR-0083 的统一后台主动检查与 24 小时刷新语义、ADR-0192 中“其他 Runtime 保持主动检查”
的默认策略，以及旧 UI 对 `found_uninspected` 的 checking 投影；不改变 Product Runtime Catalog、TRAE
同进程执行验证、Ready capability evidence 或真实 AgentRun 的 admission authority。

## Consequences

- Core ready 与重扫响应不再被 ACP、Session、认证或模型枚举阻塞，第三方 CLI 副作用只发生在明确的产品动作。
- 用户可能在首次任务或显式检查时才发现登录、版本或 capability 问题；界面必须区分“可尝试”与深检证明。
- manager 和 Probe process owner 承担更多集中式生命周期责任，但 panic、取消和孙进程继承 stdio 不再制造
  永久 checking。
- 静态权限 descriptor 与 Runtime-default sentinel 只用于配置/admission，不成为 capability evidence；深检成功
  后必须用真实 catalog 重绑再启动非 TRAE Runtime。

## Rejected Alternatives

- **减少启动 ACP 步骤但仍自动 Probe。** 仍执行第三方产品代码，也无法消除认证和子进程生命周期风险。
- **给 checking 增加 UI 超时。** 只隐藏 stale manager state，不清理任务、waiter、进程树或错误提交。
- **把 executable 存在写成 Ready。** 会伪造认证、协议、模型和 capability 证据。
- **fingerprint 改变后立即后台复验。** 把不可预测的第三方启动重新放回发现关键路径。
- **每个 Probe 自己实现 timeout/kill/read。** 分散实现会继续遗漏孙进程、无限输出或 reader cleanup 路径。

## References

- [v0.98 version scope](../versions/v0.98/README.md)
- [Runtime Launch and Verification v3](../contracts/runtime-launch-and-verification-v3.md)
- [Runtime Catalog Boundaries](../architecture/runtime-catalog-boundaries.md)
- [ADR-0083](0083-background-runtime-checks-and-actionable-status.md)
- [ADR-0192](0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)
