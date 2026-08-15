---
document_type: version-overview
version: v0.87
lifecycle: historical
authority: version-scope-and-status
design_status: accepted
implementation_status: complete
last_updated: 2026-08-16
---

# Rovai-ai v0.87：TRAE 静态检测与执行期验证

> 交付状态：P0/P1/P2 实现、全量回归、macOS 打包与 `/Applications` 提升均已完成；
> 可复现证据见[实施计划](implementation-plan.md)。
>
> 前置版本：[v0.86 Benchmark Tool-use Measurement v2](../v0.86/README.md)

## 历史勘误（2026-08-16）

v0.88 建立时，本版本的实现已经提交，但长耗时全量回归与安装提升尚未回填，因而历史切换提交把
`implementation_status` 冻结成了 `in_progress`。同日完成的门禁、隔离启动和安装证据证明 v0.87
交付闭合；本次只更正该状态与验收事实，不改变已经生效的 v0.88 current 指针或本版本技术范围。

## 版本目标

消除 Rovai 对 TRAE CLI 的非任务启动。TRAE 的 `--version` 会进入凭据存储初始化并可能触发 macOS
钥匙串 UI，因此自动发现、设置页检查、安装刷新、诊断、自检和派发前校验都只能读取文件与可信静态
元数据。真正的登录及 ACP 能力验证延迟到用户实际发起的 AgentRun，并复用该任务已经启动的同一个
TRAE 进程继续执行，不增加 Probe 或失败诊断进程。

## 交付范围

- 以 `RuntimeLaunchPurpose` 统一约束所有 Runtime 子进程启动；TRAE 只允许
  `AgentExecution`，其他目的默认拒绝；
- TRAE discovery、`runtime.product.check/ensure`、managed/custom refresh、health probe 和 dispatch
  preflight 全部走静态路径、普通文件/执行位/canonical path/fingerprint 校验；
- 新增 `installed_unverified`，明确区分“已安装”与 Ready；静态证据不能声明登录或 ACP 能力；
- 未验证的 TRAE 可以用 Runtime default model 与安全 `permission_mode=default` 原子保存成员配置；
  显式模型与额外权限必须等待真实 Session catalog；
- 首次 AgentRun 的同一 ACP Host 保留 `initialize` 与 `session/new|load` 证据，成功后原子升级为 Ready，
  失败则使用该进程已有错误分类，不启动第二个诊断进程；
- `reportedVersion` 允许为 `null`；只在进程内读取 `.app/Contents/Info.plist` 或明确的 Go main-module
  build information，未知时不退回 `traecli --version`；
- 设置页与队员页显示“已安装，待首次运行验证”，TRAE 操作命名为“重新扫描安装”；其他 Runtime
  的主动后台检查和用户操作保持不变。

## 边界

- 本版本不修改用户钥匙串、默认 keychain、TRAE token store 或登录配置，也不猜测未公开的禁用开关；
- 实际 AgentRun 仍会启动 TRAE，因而上游自身启动阶段的钥匙串行为仍由 TRAE 负责；Rovai 保证不为
  元数据、检查或诊断额外启动它；
- `installed_unverified` 不是弱化的 Ready，不允许静态能力、登录、模型目录或 Session 兼容性声明；
- v0.83 的真实准入证据继续作为目标版本历史兼容性记录，但不再作为每次本机检查都要重放的流程。

## 跨版本文档影响

| 范围 | 结论 | 证据或理由 |
| --- | --- | --- |
| Version lifecycle | 已更新 | v0.86 冻结为 historical；本概览、[实施计划](implementation-plan.md)与[版本索引](../README.md)建立唯一 current v0.87。 |
| ADR | 已更新 | [ADR-0192](../../adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)冻结目的化启动权限、TRAE 静态检测和同一真实进程验证边界。 |
| Contracts | 已更新 | [Runtime Launch and Verification v1](../../contracts/runtime-launch-and-verification-v1.md)定义启动目的、`installed_unverified`、nullable version 与状态迁移。 |
| Architecture | 已更新 | [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)记录静态 Installation、执行期验证和 Ready 保留规则。 |
| UI | 已更新 | [Member workspace brief](../../../apps/desktop/.impeccable/surfaces/member-workspace.md)与[Settings workspace brief](../../../apps/desktop/.impeccable/surfaces/settings-workspace.md)加入“已安装/首次运行验证”和“重新扫描安装”语义。 |
| Runtime Activity | 确认无需更新 | 启动检查与 capability snapshot 不是 Canonical Runtime Activity；AgentRun 事件、Tool/Approval/Message 映射均未变化。 |
| Runtime compatibility | 已更新 | [兼容性清单](../../runtime-compatibility.md)区分 v0.83 历史 Probe 证据与当前执行期再验证规则。 |
| Documentation routing | 已更新 | [文档导航](../../README.md)、ADR CURRENT、Contract 与 Architecture 索引路由到新边界。 |
| Root README | 确认无需更新 | 项目定位、常青能力和支持的 Product Runtime 集合未改变；本版本收窄的是 TRAE 的本机检查副作用。 |

## References

- [实施与验收计划](implementation-plan.md)
- [ADR-0192](../../adr/0192-purpose-scoped-runtime-launch-and-execution-deferred-verification.md)
- [Runtime Launch and Verification v1](../../contracts/runtime-launch-and-verification-v1.md)
- [Runtime Catalog Boundaries](../../architecture/runtime-catalog-boundaries.md)
- [TRAE CLI CN v0.83 准入记录](../../runtime-compatibility.md#trae-cli-cn-v083-准入记录)
